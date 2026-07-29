import { config } from '../config/env.js';
import { scraperConfig } from '../config/scraperConfig.js';
import type { Platform, Post } from '../core/types.js';
import { RedditProvider } from '../providers/reddit/index.js';
import { scraperService } from '../services/scraperService.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { Logger } from '../utils/logger.js';
import { dedupePosts } from './dedupe.js';
import { filterLast24Hours } from './recencyFilter.js';
import { scorePost, type ScoredPost } from './scoring.js';

export type { ScoredPost } from './scoring.js';

const logger = new Logger('daily-scraper', config.logLevel);
const redditProvider = new RedditProvider();

/** How many keyword searches run in parallel per platform. Keeps wall-clock time
 *  roughly constant as the keyword list grows, instead of scaling linearly with
 *  it (which is what caused runs to exceed the job timeout after keywords 9 -> 22). */
const KEYWORD_CONCURRENCY = 5;

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
    maxItems: scraperConfig.reddit?.maxItems,
  });
  return posts;
}

/** Runs every configured keyword search for one platform, tolerating per-keyword failures. */
async function runPlatformScraper(platform: Platform): Promise<Post[]> {
  logger.info('scraper started', { platform });

  if (platform === 'reddit') {
    const posts = await runRedditScraper();
    logger.info('scraper completed', { platform, postsCollected: posts.length });
    return posts;
  }

  const results = await mapWithConcurrency(scraperConfig.keywords, KEYWORD_CONCURRENCY, async (keyword) => {
    try {
      const { items } = await scraperService.search(platform, {
        query: keyword,
        limit: scraperConfig.search.maxItemsPerKeyword,
        sort: scraperConfig.search.sort,
      });
      return items;
    } catch (error) {
      logger.error('scraper failed', {
        platform,
        keyword,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  });
  const collected = results.flat();

  logger.info('scraper completed', { platform, postsCollected: collected.length });
  return collected;
}

/**
 * Runs the complete daily scraping pipeline: executes every enabled platform's
 * configured keyword searches, merges results, removes duplicates, filters to
 * the last `lookbackHours`, scores posts against configured keywords, and
 * returns them sorted by relevance score.
 */
export async function runDailyScraper(): Promise<ScoredPost[]> {
  const platforms = enabledPlatforms();

  const perPlatformResults = await mapWithConcurrency(platforms, platforms.length, async (platform) => {
    try {
      return await runPlatformScraper(platform);
    } catch (error) {
      logger.error('scraper crashed', {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  });
  const allPosts = perPlatformResults.flat();

  logger.info('collection complete', { totalPostsCollected: allPosts.length });

  const { unique, duplicatesRemoved } = dedupePosts(allPosts);
  logger.info('duplicates removed', { duplicatesRemoved, remaining: unique.length });

  const recent = filterLast24Hours(unique, scraperConfig.lookbackHours);
  logger.info('recency filter applied', { lookbackHours: scraperConfig.lookbackHours, remaining: recent.length });

  const scored: ScoredPost[] = recent.map((post) => {
    const { score, matchedKeywords } = scorePost(post, scraperConfig);
    return { ...post, score, matchedKeywords };
  });
  scored.sort((a, b) => b.score - a.score);

  logger.info('daily scraper finished', { finalPostCount: scored.length });

  return scored;
}
