import { getJson } from '../../api/httpClient.js';
import { config } from '../../config/env.js';
import type { ScraperProvider } from '../../core/interfaces.js';
import { NotFoundError } from '../../core/errors.js';
import type { Author, Comment, PaginatedResult, PaginationOptions, Post, SearchOptions } from '../../core/types.js';
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
