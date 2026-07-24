import { runActorAndGetItems } from '../../api/apifyClient.js';
import { config } from '../../config/env.js';
import type { ScraperProvider } from '../../core/interfaces.js';
import { NotFoundError } from '../../core/errors.js';
import type { Author, Comment, PaginatedResult, PaginationOptions, Post, SearchOptions } from '../../core/types.js';
import { filterByDateRange, sortPosts } from '../../utils/filterAndSort.js';
import { paginateArray } from '../../utils/pagination.js';
import { mapToAuthor, mapToPost, type SubstackItem } from './mapper.js';

const ACTOR_ID = config.actors.substack;

async function runSubstack(input: Record<string, unknown>, maxItems?: number): Promise<SubstackItem[]> {
  return runActorAndGetItems<SubstackItem>({ platform: 'substack', actorId: ACTOR_ID, input, maxItems });
}

export class SubstackProvider implements ScraperProvider {
  readonly platform = 'substack' as const;

  async search(options: SearchOptions): Promise<PaginatedResult<Post>> {
    const limit = options.limit ?? 25;
    const items = await runSubstack({ searchTerms: [options.query], maxItems: limit }, limit);
    let posts = items.map(mapToPost);
    posts = filterByDateRange(posts, options.dateRange);
    posts = sortPosts(posts, options.sort);
    return paginateArray(posts, options);
  }

  async getPost(urlOrId: string): Promise<Post> {
    if (!urlOrId.startsWith('http')) {
      throw new NotFoundError('substack', `post "${urlOrId}" (Substack posts must be referenced by full URL)`);
    }
    const items = await runSubstack({ startUrls: [{ url: urlOrId }], maxItems: 1 }, 1);
    if (items.length === 0) throw new NotFoundError('substack', `post "${urlOrId}"`);
    return mapToPost(items[0]);
  }

  /** Best-effort: comment support depends entirely on the configured actor; degrades to empty. */
  async getComments(postUrlOrId: string, options?: PaginationOptions): Promise<PaginatedResult<Comment>> {
    const limit = options?.limit ?? 25;
    const items = await runSubstack({ startUrls: [{ url: postUrlOrId }], scrapeComments: true, maxItems: limit }, limit);
    const comments: Comment[] = items
      .filter((item) => item['content'] || item['text'] || item['body'])
      .map((item) => ({
        id: String(item['id'] ?? ''),
        postId: postUrlOrId,
        platform: 'substack' as const,
        content: String(item['content'] ?? item['text'] ?? item['body'] ?? ''),
        author: mapToAuthor(item),
        engagement: {},
        raw: item,
      }));
    return paginateArray(comments, options);
  }

  async getAuthor(usernameOrUrl: string): Promise<Author> {
    const url = usernameOrUrl.startsWith('http') ? usernameOrUrl : `https://${usernameOrUrl}.substack.com`;
    const items = await runSubstack({ startUrls: [{ url }], maxItems: 1 }, 1);
    if (items.length === 0) throw new NotFoundError('substack', `publication "${usernameOrUrl}"`);
    return mapToAuthor(items[0]);
  }

  /** Approximated via Substack's Discover page - there is no single global "trending" API. */
  async getTrending(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const limit = options?.limit ?? 25;
    const items = await runSubstack({ startUrls: [{ url: 'https://substack.com/discover' }], maxItems: limit }, limit);
    return paginateArray(items.map(mapToPost), options);
  }

  async getLatest(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const limit = options?.limit ?? 25;
    const items = await runSubstack({ startUrls: [{ url: 'https://substack.com/discover' }], sort: 'new', maxItems: limit }, limit);
    return paginateArray(items.map(mapToPost), options);
  }
}
