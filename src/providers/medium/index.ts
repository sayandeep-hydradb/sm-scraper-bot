import { runActorAndGetItems } from '../../api/apifyClient.js';
import { config } from '../../config/env.js';
import type { ScraperProvider } from '../../core/interfaces.js';
import { NotFoundError } from '../../core/errors.js';
import type { Author, Comment, PaginatedResult, PaginationOptions, Post, SearchOptions } from '../../core/types.js';
import { filterByDateRange, sortPosts } from '../../utils/filterAndSort.js';
import { paginateArray } from '../../utils/pagination.js';
import { mapToAuthor, mapToPost, type MediumItem } from './mapper.js';

const ACTOR_ID = config.actors.medium;

async function runMedium(input: Record<string, unknown>, maxItems?: number): Promise<MediumItem[]> {
  return runActorAndGetItems<MediumItem>({ platform: 'medium', actorId: ACTOR_ID, input, maxItems });
}

export class MediumProvider implements ScraperProvider {
  readonly platform = 'medium' as const;

  async search(options: SearchOptions): Promise<PaginatedResult<Post>> {
    const limit = options.limit ?? 25;
    const items = await runMedium({ searchTerms: [options.query], maxItems: limit }, limit);
    let posts = items.map(mapToPost);
    posts = filterByDateRange(posts, options.dateRange);
    posts = sortPosts(posts, options.sort);
    return paginateArray(posts, options);
  }

  async getPost(urlOrId: string): Promise<Post> {
    const url = urlOrId.startsWith('http') ? urlOrId : `https://medium.com/p/${urlOrId}`;
    const items = await runMedium({ startUrls: [{ url }], maxItems: 1 }, 1);
    if (items.length === 0) throw new NotFoundError('medium', `post "${urlOrId}"`);
    return mapToPost(items[0]);
  }

  /**
   * Best-effort: Medium "responses" (comments) aren't reliably exposed by
   * most third-party actors. We ask for them via a commonly-used flag name
   * and degrade to an empty page rather than fail if the actor ignores it.
   */
  async getComments(postUrlOrId: string, options?: PaginationOptions): Promise<PaginatedResult<Comment>> {
    const url = postUrlOrId.startsWith('http') ? postUrlOrId : `https://medium.com/p/${postUrlOrId}`;
    const limit = options?.limit ?? 25;
    const items = await runMedium({ startUrls: [{ url }], scrapeResponses: true, maxItems: limit }, limit);
    const comments: Comment[] = items
      .filter((item) => item['content'] || item['text'])
      .map((item) => ({
        id: String(item['id'] ?? ''),
        postId: postUrlOrId,
        platform: 'medium' as const,
        content: String(item['content'] ?? item['text'] ?? ''),
        author: mapToAuthor(item),
        engagement: {},
        raw: item,
      }));
    return paginateArray(comments, options);
  }

  async getAuthor(usernameOrUrl: string): Promise<Author> {
    const url = usernameOrUrl.startsWith('http') ? usernameOrUrl : `https://medium.com/@${usernameOrUrl.replace(/^@/, '')}`;
    const items = await runMedium({ startUrls: [{ url }], maxItems: 1 }, 1);
    if (items.length === 0) throw new NotFoundError('medium', `user "${usernameOrUrl}"`);
    return mapToAuthor(items[0]);
  }

  /** Approximated via a popular tag page - Medium exposes no global "trending" feed. */
  async getTrending(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const limit = options?.limit ?? 25;
    const items = await runMedium({ startUrls: [{ url: 'https://medium.com/tag/technology' }], maxItems: limit }, limit);
    return paginateArray(items.map(mapToPost), options);
  }

  async getLatest(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const limit = options?.limit ?? 25;
    const items = await runMedium({ startUrls: [{ url: 'https://medium.com/tag/technology/latest' }], maxItems: limit }, limit);
    return paginateArray(items.map(mapToPost), options);
  }
}
