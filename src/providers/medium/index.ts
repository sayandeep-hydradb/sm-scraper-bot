import { getText } from '../../api/httpClient.js';
import { scraperConfig } from '../../config/scraperConfig.js';
import type { ScraperProvider } from '../../core/interfaces.js';
import { NotFoundError } from '../../core/errors.js';
import type {
  Author,
  BatchSearchOptions,
  Comment,
  PaginatedResult,
  PaginationOptions,
  Post,
  SearchOptions,
} from '../../core/types.js';
import { filterByDateRange, sortPosts } from '../../utils/filterAndSort.js';
import { paginateArray } from '../../utils/pagination.js';
import { parseFeed, stripHtml, RSS_HEADERS, type RssItem } from '../../utils/rss.js';

// Medium exposes free per-tag RSS feeds (medium.com/feed/tag/<tag>). We pull a
// handful of topic-relevant tags instead of paying an Apify actor; the pipeline's
// keyword/LLM scoring decides relevance afterwards (same strategy as Dev.to).
const DEFAULT_TAGS = [
  'graph-database',
  'knowledge-graph',
  'rag',
  'vector-database',
  'neo4j',
  'llm',
  'artificial-intelligence',
  'machine-learning',
];

function configuredTags(): string[] {
  const tags = scraperConfig.medium?.tags;
  return tags && tags.length > 0 ? tags : DEFAULT_TAGS;
}

function tagFeedUrl(tag: string): string {
  return `https://medium.com/feed/tag/${encodeURIComponent(tag)}`;
}

function toPost(item: RssItem): Post {
  return {
    id: item.id || item.link,
    platform: 'medium',
    url: item.link,
    title: item.title || undefined,
    content: stripHtml(item.contentHtml),
    author: { username: item.author ?? 'unknown' },
    publishedAt: item.publishedAt,
    tags: item.categories,
    engagement: {},
    raw: item,
  };
}

async function fetchTagFeed(tag: string): Promise<Post[]> {
  try {
    const xml = await getText(tagFeedUrl(tag), { platform: 'medium', headers: RSS_HEADERS });
    return parseFeed(xml).map(toPost);
  } catch {
    // A single failing/empty feed contributes nothing rather than failing the platform.
    return [];
  }
}

/** Fetches all configured tag feeds once and dedupes by URL. */
async function fetchPool(): Promise<Post[]> {
  const perTag = await Promise.all(configuredTags().map(fetchTagFeed));
  const seen = new Set<string>();
  const pool: Post[] = [];
  for (const post of perTag.flat()) {
    const key = post.url || post.id;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    pool.push(post);
  }
  return pool;
}

export class MediumProvider implements ScraperProvider {
  readonly platform = 'medium' as const;

  async search(options: SearchOptions): Promise<PaginatedResult<Post>> {
    let posts = await fetchPool();
    posts = filterByDateRange(posts, options.dateRange);
    posts = sortPosts(posts, options.sort);
    return paginateArray(posts, options);
  }

  /** Medium RSS has no per-keyword query, so this returns the shared tag pool once. */
  async searchMany(_queries: string[], options?: BatchSearchOptions): Promise<PaginatedResult<Post>> {
    let posts = await fetchPool();
    if (options?.dateRange) posts = filterByDateRange(posts, options.dateRange);
    posts = sortPosts(posts, options?.sort);
    if (options?.limit) posts = posts.slice(0, options.limit);
    return { items: posts, hasMore: false, total: posts.length };
  }

  async getLatest(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const posts = sortPosts(await fetchPool(), 'new');
    return paginateArray(posts, options);
  }

  /** Medium has no global trending feed; approximate with the latest tag pool. */
  async getTrending(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    return this.getLatest(options);
  }

  async getAuthor(usernameOrUrl: string): Promise<Author> {
    const handle = usernameOrUrl.replace(/^https?:\/\/medium\.com\//, '').replace(/^@/, '');
    try {
      const xml = await getText(`https://medium.com/feed/@${handle}`, { platform: 'medium', headers: RSS_HEADERS });
      const items = parseFeed(xml);
      if (items[0]?.author) return { username: items[0].author, url: `https://medium.com/@${handle}` };
    } catch {
      // fall through to a minimal author
    }
    return { username: handle, url: `https://medium.com/@${handle}` };
  }

  async getPost(urlOrId: string): Promise<Post> {
    // Single-post fetch isn't available from RSS feeds.
    throw new NotFoundError('medium', `post "${urlOrId}" (RSS-backed Medium provider only exposes feeds, not single posts)`);
  }

  /** Medium RSS feeds don't expose responses/comments; degrade to an empty page. */
  async getComments(): Promise<PaginatedResult<Comment>> {
    return { items: [], hasMore: false };
  }
}
