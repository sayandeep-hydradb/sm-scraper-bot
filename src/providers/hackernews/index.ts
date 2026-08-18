import { getJson } from '../../api/httpClient.js';
import { config } from '../../config/env.js';
import type { ScraperProvider } from '../../core/interfaces.js';
import { NotFoundError } from '../../core/errors.js';
import type { Author, BatchSearchOptions, Comment, PaginatedResult, PaginationOptions, Post, SearchOptions } from '../../core/types.js';
import { paginateArray } from '../../utils/pagination.js';
import {
  mapAlgoliaHitToPost,
  mapFirebaseItemToComment,
  mapFirebaseItemToPost,
  mapFirebaseUserToAuthor,
  type HnAlgoliaHit,
  type HnFirebaseItem,
  type HnFirebaseUser,
} from './mapper.js';

const { firebaseUrl, algoliaUrl } = config.hackernews;

function extractId(urlOrId: string): string {
  const match = urlOrId.match(/id=(\w+)/);
  return match ? match[1] : urlOrId;
}

function getItem(id: string): Promise<HnFirebaseItem | null> {
  return getJson<HnFirebaseItem | null>(`${firebaseUrl}/item/${id}.json`, { platform: 'hackernews' });
}

async function getItems(ids: number[]): Promise<HnFirebaseItem[]> {
  const items = await Promise.all(ids.map((id) => getItem(String(id))));
  return items.filter((item): item is HnFirebaseItem => item !== null && !item.deleted && !item.dead);
}

export class HackerNewsProvider implements ScraperProvider {
  readonly platform = 'hackernews' as const;

  async search(options: SearchOptions): Promise<PaginatedResult<Post>> {
    const limit = options.limit ?? 25;
    const page = (options.page ?? 1) - 1;
    const endpoint = options.sort === 'new' ? 'search_by_date' : 'search';

    const params = new URLSearchParams({
      query: options.query,
      tags: 'story',
      page: String(page),
      hitsPerPage: String(limit),
    });
    if (options.dateRange?.from || options.dateRange?.to) {
      const filters: string[] = [];
      if (options.dateRange.from) filters.push(`created_at_i>${Math.floor(Date.parse(options.dateRange.from) / 1000)}`);
      if (options.dateRange.to) filters.push(`created_at_i<${Math.floor(Date.parse(options.dateRange.to) / 1000)}`);
      params.set('numericFilters', filters.join(','));
    }

    const result = await getJson<{ hits: HnAlgoliaHit[]; nbHits: number }>(
      `${algoliaUrl}/${endpoint}?${params.toString()}`,
      { platform: 'hackernews' },
    );
    const items = result.hits.map(mapAlgoliaHitToPost);
    return { items, hasMore: (page + 1) * limit < result.nbHits, total: result.nbHits };
  }

  /**
   * HN's Algolia search is per-query, so this fans out over the keywords (free
   * API), merges, dedupes by id, and trims to `limit`. Kept for a uniform
   * batched call site in the daily pipeline.
   */
  async searchMany(queries: string[], options?: BatchSearchOptions): Promise<PaginatedResult<Post>> {
    if (queries.length === 0) return { items: [], hasMore: false, total: 0 };
    const limit = options?.limit ?? 150;
    const perKeyword = Math.min(30, Math.max(10, Math.ceil(limit / queries.length)));

    const perQuery = await Promise.all(
      queries.map((query) =>
        this.search({ query, sort: options?.sort ?? 'new', dateRange: options?.dateRange, limit: perKeyword })
          .then((r) => r.items)
          .catch(() => [] as Post[]),
      ),
    );

    const seen = new Set<string>();
    const merged: Post[] = [];
    for (const post of perQuery.flat()) {
      const key = post.id || post.url;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(post);
    }
    return { items: merged.slice(0, limit), hasMore: false, total: merged.length };
  }

  async getPost(urlOrId: string): Promise<Post> {
    const item = await getItem(extractId(urlOrId));
    if (!item || item.type !== 'story') throw new NotFoundError('hackernews', `story "${urlOrId}"`);
    return mapFirebaseItemToPost(item);
  }

  async getComments(postUrlOrId: string, options?: PaginationOptions): Promise<PaginatedResult<Comment>> {
    const postId = extractId(postUrlOrId);
    const post = await getItem(postId);
    if (!post) throw new NotFoundError('hackernews', `story "${postUrlOrId}"`);

    const kidIds = post.kids ?? [];
    const page = paginateArray(kidIds, options);
    const items = await getItems(page.items);
    return { ...page, items: items.map((item) => mapFirebaseItemToComment(item, postId)) };
  }

  async getAuthor(usernameOrUrl: string): Promise<Author> {
    const username = extractId(usernameOrUrl);
    const user = await getJson<HnFirebaseUser | null>(`${firebaseUrl}/user/${username}.json`, { platform: 'hackernews' });
    if (!user) throw new NotFoundError('hackernews', `user "${usernameOrUrl}"`);
    return mapFirebaseUserToAuthor(user);
  }

  async getTrending(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const ids = await getJson<number[]>(`${firebaseUrl}/topstories.json`, { platform: 'hackernews' });
    const page = paginateArray(ids, options);
    const items = await getItems(page.items);
    return { ...page, items: items.map(mapFirebaseItemToPost) };
  }

  async getLatest(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const ids = await getJson<number[]>(`${firebaseUrl}/newstories.json`, { platform: 'hackernews' });
    const page = paginateArray(ids, options);
    const items = await getItems(page.items);
    return { ...page, items: items.map(mapFirebaseItemToPost) };
  }
}
