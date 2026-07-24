import type {
  Author,
  Comment,
  PaginatedResult,
  PaginationOptions,
  Platform,
  Post,
  SearchOptions,
} from './types.js';

/**
 * Every platform provider implements this exact surface so the rest of the
 * application (services, CLI) never needs to branch on which platform it's
 * talking to.
 */
export interface ScraperProvider {
  readonly platform: Platform;

  search(options: SearchOptions): Promise<PaginatedResult<Post>>;
  getPost(urlOrId: string): Promise<Post>;
  getComments(postUrlOrId: string, options?: PaginationOptions): Promise<PaginatedResult<Comment>>;
  getAuthor(usernameOrUrl: string): Promise<Author>;
  getTrending(options?: PaginationOptions): Promise<PaginatedResult<Post>>;
  getLatest(options?: PaginationOptions): Promise<PaginatedResult<Post>>;
}
