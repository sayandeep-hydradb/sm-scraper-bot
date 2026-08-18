import type { ScraperProvider } from '../core/interfaces.js';
import { ProviderNotFoundError } from '../core/errors.js';
import type { Author, BatchSearchOptions, Comment, PaginatedResult, PaginationOptions, Platform, Post, SearchOptions } from '../core/types.js';
import { RedditProvider } from '../providers/reddit/index.js';
import { TwitterProvider } from '../providers/twitter/index.js';
import { HackerNewsProvider } from '../providers/hackernews/index.js';
import { DevtoProvider } from '../providers/devto/index.js';
import { MediumProvider } from '../providers/medium/index.js';
import { SubstackProvider } from '../providers/substack/index.js';

const providers: Record<Platform, ScraperProvider> = {
  reddit: new RedditProvider(),
  twitter: new TwitterProvider(),
  hackernews: new HackerNewsProvider(),
  devto: new DevtoProvider(),
  medium: new MediumProvider(),
  substack: new SubstackProvider(),
};

/**
 * Platform-agnostic facade. Callers pass a `Platform` string and never need
 * to know which provider class or upstream API backs it.
 */
export class ScraperService {
  private resolve(platform: Platform): ScraperProvider {
    const provider = providers[platform];
    if (!provider) throw new ProviderNotFoundError(platform);
    return provider;
  }

  listPlatforms(): Platform[] {
    return Object.keys(providers) as Platform[];
  }

  search(platform: Platform, options: SearchOptions): Promise<PaginatedResult<Post>> {
    return this.resolve(platform).search(options);
  }

  /**
   * Batched multi-keyword search. Delegates to the provider's own `searchMany`
   * (one upstream call) when available; otherwise falls back to running each
   * keyword through `search()` and merging, tolerating per-keyword failures so
   * one bad query doesn't sink the whole platform.
   */
  async searchMany(platform: Platform, queries: string[], options?: BatchSearchOptions): Promise<PaginatedResult<Post>> {
    const provider = this.resolve(platform);
    if (provider.searchMany) return provider.searchMany(queries, options);

    const perQuery = await Promise.all(
      queries.map((query) => provider.search({ ...options, query }).then((r) => r.items).catch(() => [] as Post[])),
    );
    const items = perQuery.flat();
    const limited = options?.limit ? items.slice(0, options.limit) : items;
    return { items: limited, hasMore: false, total: items.length };
  }

  getPost(platform: Platform, urlOrId: string): Promise<Post> {
    return this.resolve(platform).getPost(urlOrId);
  }

  getComments(platform: Platform, postUrlOrId: string, options?: PaginationOptions): Promise<PaginatedResult<Comment>> {
    return this.resolve(platform).getComments(postUrlOrId, options);
  }

  getAuthor(platform: Platform, usernameOrUrl: string): Promise<Author> {
    return this.resolve(platform).getAuthor(usernameOrUrl);
  }

  getTrending(platform: Platform, options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    return this.resolve(platform).getTrending(options);
  }

  getLatest(platform: Platform, options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    return this.resolve(platform).getLatest(options);
  }
}

export const scraperService = new ScraperService();
