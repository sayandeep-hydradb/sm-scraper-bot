import { config } from '../config/env.js';
import { scraperConfig } from '../config/scraperConfig.js';
import type { Platform, Post } from '../core/types.js';
import { RedditProvider } from '../providers/reddit/index.js';
import { scraperService } from '../services/scraperService.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { Logger } from '../utils/logger.js';
import { dedupePosts } from './dedupe.js';
import { filterByLookbackHours } from './recencyFilter.js';
import { filterByRelevance } from './relevanceFilter.js';
import { scorePost, type ScoredPost } from './scoring.js';

export type { ScoredPost } from './scoring.js';

export interface PlatformStat {
  /** Posts fetched from the source before dedupe/recency/scoring. */
  collected: number;
  /** Posts that survived into the final report. */
  kept: number;
}

export interface DailyScrapeResult {
  posts: ScoredPost[];
  /** Number of errors per platform; only populated for platforms that had failures. */
  platformErrors: Map<Platform, number>;
  /** collected→kept counts for every enabled platform, so silent drops (recency/dedupe/relevance) are visible. */
  platformStats: Map<Platform, PlatformStat>;
}

const logger = new Logger('daily-scraper', config.logLevel);
const redditProvider = new RedditProvider();

const DEFAULT_MAX_POSTS_PER_PLATFORM = 75;

/** How many items each platform is allowed to SCRAPE per run (what we pay for),
 *  before scoring/relevance/output-capping trims further. Overridable per platform
 *  via `maxItemsPerPlatform` in the scraper config. */
const DEFAULT_MAX_ITEMS_PER_PLATFORM: Partial<Record<Platform, number>> = {
  twitter: 150,
  reddit: 200,
  hackernews: 150,
  devto: 150,
  medium: 150,
  substack: 150,
};

function maxItemsFor(platform: Platform): number {
  return scraperConfig.maxItemsPerPlatform?.[platform] ?? DEFAULT_MAX_ITEMS_PER_PLATFORM[platform] ?? 150;
}

/** Keeps only each platform's top-scoring posts, so a keyword/subreddit list wide
 *  enough to surface good results doesn't also mean hundreds of posts to read daily. */
function capPerPlatform(posts: ScoredPost[], maxPerPlatform: number): ScoredPost[] {
  const countByPlatform = new Map<Platform, number>();
  const capped = posts.filter((post) => {
    const count = countByPlatform.get(post.platform) ?? 0;
    if (count >= maxPerPlatform) return false;
    countByPlatform.set(post.platform, count + 1);
    return true;
  });
  return capped;
}

function enabledPlatforms(): Platform[] {
  return scraperService.listPlatforms().filter((platform) => scraperConfig.platforms[platform] !== false);
}

/**
 * Reddit is fetched by pulling recent posts from named subreddits (sorted by New)
 * instead of per-keyword search — see `RedditProvider.fetchFromSubreddits` for why.
 * Relevance is determined later by the shared keyword-scoring step, same as every
 * other platform.
 */
async function runRedditScraper(): Promise<Post[]> {
  const subreddits = scraperConfig.reddit?.subreddits ?? [];
  const posts = await redditProvider.fetchFromSubreddits(subreddits, {
    lookbackHours: scraperConfig.lookbackHours,
    maxItems: maxItemsFor('reddit'),
  });
  return posts;
}

/**
 * Fetches one platform's candidate posts in a SINGLE batched call (all keywords
 * at once) instead of one call per keyword — this is what keeps per-run Apify
 * cost flat as the keyword list grows. Bounded to the lookback window and to
 * `maxItemsFor(platform)` so we never pay to scrape far more than we keep.
 */
async function runPlatformScraper(platform: Platform): Promise<{ posts: Post[]; errors: number }> {
  logger.info('scraper started', { platform });

  if (platform === 'reddit') {
    const posts = await runRedditScraper();
    return { posts, errors: 0 };
  }

  const from = new Date(Date.now() - scraperConfig.lookbackHours * 60 * 60 * 1000).toISOString();
  try {
    const { items } = await scraperService.searchMany(platform, scraperConfig.keywords, {
      limit: maxItemsFor(platform),
      sort: scraperConfig.search.sort,
      dateRange: { from },
    });
    return { posts: items, errors: 0 };
  } catch (error) {
    logger.error('scraper failed', {
      platform,
      error: error instanceof Error ? error.message : String(error),
    });
    return { posts: [], errors: 1 };
  }
}

/**
 * Runs the complete daily scraping pipeline: executes every enabled platform's
 * configured keyword searches, merges results, removes duplicates, filters to
 * the last `lookbackHours`, scores posts against configured keywords, and
 * returns them sorted by relevance score.
 */
export async function runDailyScraper(): Promise<DailyScrapeResult> {
  const platforms = enabledPlatforms();

  const perPlatformResults = await mapWithConcurrency(
    platforms,
    platforms.length,
    async (platform): Promise<{ platform: Platform; posts: Post[]; errors: number }> => {
      try {
        const { posts, errors } = await runPlatformScraper(platform);
        logger.info('scraper completed', { platform, postsCollected: posts.length, errors });
        return { platform, posts, errors };
      } catch (error) {
        logger.error('scraper crashed', {
          platform,
          error: error instanceof Error ? error.message : String(error),
        });
        return { platform, posts: [], errors: scraperConfig.keywords.length };
      }
    },
  );

  const allPosts = perPlatformResults.flatMap((r) => r.posts);
  const platformErrors = new Map(
    perPlatformResults.filter((r) => r.errors > 0).map((r) => [r.platform, r.errors] as const),
  );

  logger.info('collection complete', { totalPostsCollected: allPosts.length });

  const { unique, duplicatesRemoved } = dedupePosts(allPosts);
  logger.info('duplicates removed', { duplicatesRemoved, remaining: unique.length });

  const recent = filterByLookbackHours(unique, scraperConfig.lookbackHours);
  logger.info('recency filter applied', { lookbackHours: scraperConfig.lookbackHours, remaining: recent.length });

  const scored: ScoredPost[] = recent.map((post) => {
    const { score, matchedKeywords } = scorePost(post, scraperConfig);
    return { ...post, score, matchedKeywords };
  });
  scored.sort((a, b) => b.score - a.score);

  // LLM relevance gate + enrichment (safely skipped if disabled / no API key).
  const relevant = await filterByRelevance(scored, scraperConfig);
  logger.info('relevance filter complete', { before: scored.length, after: relevant.length });

  const maxPerPlatform = scraperConfig.output?.maxPostsPerPlatform ?? DEFAULT_MAX_POSTS_PER_PLATFORM;
  const capped = capPerPlatform(relevant, maxPerPlatform);
  logger.info('capped to top posts per platform', { maxPerPlatform, remaining: capped.length });

  // Per-platform collected→kept, for every enabled platform (including zeros), so
  // a platform that silently lost everything to recency/dedupe/relevance is visible.
  const collectedByPlatform = new Map<Platform, number>(perPlatformResults.map((r) => [r.platform, r.posts.length]));
  const keptByPlatform = new Map<Platform, number>();
  for (const post of capped) keptByPlatform.set(post.platform, (keptByPlatform.get(post.platform) ?? 0) + 1);
  const platformStats = new Map<Platform, PlatformStat>(
    platforms.map((platform) => [
      platform,
      { collected: collectedByPlatform.get(platform) ?? 0, kept: keptByPlatform.get(platform) ?? 0 },
    ]),
  );

  logger.info('daily scraper finished', {
    finalPostCount: capped.length,
    perPlatform: Object.fromEntries([...platformStats].map(([p, s]) => [p, `${s.collected}→${s.kept}`])),
  });

  return { posts: capped, platformErrors, platformStats };
}
