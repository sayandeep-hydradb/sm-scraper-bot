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

// Substack has no global keyword search, but every publication exposes a free RSS
// feed at <publication>/feed. We poll a curated list from config; the pipeline's
// keyword/LLM scoring decides relevance. An empty list => the platform is skipped
// cleanly (returns nothing rather than erroring).
function configuredPublications(): string[] {
  return scraperConfig.substack?.publications ?? [];
}

function feedUrl(publication: string): string {
  const base = publication.replace(/\/+$/, '');
  return /\/feed$/.test(base) ? base : `${base}/feed`;
}

function publicationHost(publication: string): string {
  try {
    return new URL(publication).host;
  } catch {
    return publication;
  }
}

function toPost(item: RssItem, publication: string): Post {
  return {
    id: item.id || item.link,
    platform: 'substack',
    url: item.link,
    title: item.title || undefined,
    content: stripHtml(item.contentHtml),
    author: { username: item.author ?? publicationHost(publication) },
    publishedAt: item.publishedAt,
    tags: item.categories,
    engagement: {},
    raw: item,
  };
}

async function fetchPublicationFeed(publication: string): Promise<Post[]> {
  try {
    const xml = await getText(feedUrl(publication), { platform: 'substack', headers: RSS_HEADERS });
    return parseFeed(xml).map((item) => toPost(item, publication));
  } catch {
    return [];
  }
}

/** Fetches every configured publication feed once and dedupes by URL. */
async function fetchPool(): Promise<Post[]> {
  const publications = configuredPublications();
  if (publications.length === 0) return [];
  const perPub = await Promise.all(publications.map(fetchPublicationFeed));
  const seen = new Set<string>();
  const pool: Post[] = [];
  for (const post of perPub.flat()) {
    const key = post.url || post.id;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    pool.push(post);
  }
  return pool;
}

export class SubstackProvider implements ScraperProvider {
  readonly platform = 'substack' as const;

  async search(options: SearchOptions): Promise<PaginatedResult<Post>> {
    let posts = await fetchPool();
    posts = filterByDateRange(posts, options.dateRange);
    posts = sortPosts(posts, options.sort);
    return paginateArray(posts, options);
  }

  /** Substack RSS has no per-keyword query, so this returns the shared publication pool once. */
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

  /** No global trending feed; approximate with the latest pool across configured publications. */
  async getTrending(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    return this.getLatest(options);
  }

  async getAuthor(usernameOrUrl: string): Promise<Author> {
    const base = usernameOrUrl.startsWith('http') ? usernameOrUrl : `https://${usernameOrUrl}.substack.com`;
    return { username: publicationHost(base), url: base };
  }

  async getPost(urlOrId: string): Promise<Post> {
    throw new NotFoundError('substack', `post "${urlOrId}" (RSS-backed Substack provider only exposes feeds, not single posts)`);
  }

  /** Substack RSS feeds don't expose comments; degrade to an empty page. */
  async getComments(): Promise<PaginatedResult<Comment>> {
    return { items: [], hasMore: false };
  }
}
