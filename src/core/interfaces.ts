import type {
  Author,
  BatchSearchOptions,
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

  /**
   * Optional batched search: run every keyword in `queries` and return up to
   * `options.limit` merged posts. Providers back this with a SINGLE upstream
   * call where the source supports it (e.g. one Apify actor run with all search
   * terms, or one RSS/tag-pool fetch), which is what keeps per-run cost flat as
   * the keyword list grows. Providers that omit it fall back to per-keyword
   * `search()` in the service layer.
   */
  searchMany?(queries: string[], options?: BatchSearchOptions): Promise<PaginatedResult<Post>>;

  getPost(urlOrId: string): Promise<Post>;
  getComments(postUrlOrId: string, options?: PaginationOptions): Promise<PaginatedResult<Comment>>;
  getAuthor(usernameOrUrl: string): Promise<Author>;
  getTrending(options?: PaginationOptions): Promise<PaginatedResult<Post>>;
  getLatest(options?: PaginationOptions): Promise<PaginatedResult<Post>>;
}
