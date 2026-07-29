import { config } from '../config/env.js';
import { scraperConfig } from '../config/scraperConfig.js';
import type { Platform, Post } from '../core/types.js';
import { RedditProvider } from '../providers/reddit/index.js';
import { scraperService } from '../services/scraperService.js';
import { Logger } from '../utils/logger.js';
import { dedupePosts } from './dedupe.js';
import { filterLast24Hours } from './recencyFilter.js';
import { scorePost, type ScoredPost } from './scoring.js';

export type { ScoredPost } from './scoring.js';

const logger = new Logger('daily-scraper', config.logLevel);
const redditProvider = new RedditProvider();

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

  const collected: Post[] = [];

  for (const keyword of scraperConfig.keywords) {
    try {
      const { items } = await scraperService.search(platform, {
        query: keyword,
        limit: scraperConfig.search.maxItemsPerKeyword,
        sort: scraperConfig.search.sort,
      });
      collected.push(...items);
    } catch (error) {
      logger.error('scraper failed', {
        platform,
        keyword,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

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
  const allPosts: Post[] = [];

  for (const platform of platforms) {
    try {
      const items = await runPlatformScraper(platform);
      allPosts.push(...items);
    } catch (error) {
      logger.error('scraper crashed', {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

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
