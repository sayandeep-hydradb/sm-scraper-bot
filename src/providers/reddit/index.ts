import { runActorAndGetItems } from '../../api/apifyClient.js';
import { config } from '../../config/env.js';
import type { ScraperProvider } from '../../core/interfaces.js';
import { NotFoundError } from '../../core/errors.js';
import type { Author, Comment, PaginatedResult, PaginationOptions, Post, SearchOptions } from '../../core/types.js';
import { filterByDateRange, sortPosts } from '../../utils/filterAndSort.js';
import { paginateArray } from '../../utils/pagination.js';
import { mapToAuthor, mapToComment, mapToPost, type RedditItem } from './mapper.js';

const ACTOR_ID = config.actors.reddit;

function toStartUrl(input: string): string {
  if (input.startsWith('http')) return input;
  return `https://www.reddit.com/r/all/`;
}

function toSort(sort?: SearchOptions['sort']): string {
  switch (sort) {
    case 'new':
      return 'new';
    case 'top':
      return 'top';
    case 'hot':
      return 'hot';
    case 'old':
      return 'old';
    default:
      return 'relevance';
  }
}

async function runReddit(input: Record<string, unknown>, maxItems?: number): Promise<RedditItem[]> {
  return runActorAndGetItems<RedditItem>({ platform: 'reddit', actorId: ACTOR_ID, input, maxItems });
}

export class RedditProvider implements ScraperProvider {
  readonly platform = 'reddit' as const;

  async search(options: SearchOptions): Promise<PaginatedResult<Post>> {
    const limit = options.limit ?? 25;
    const items = await runReddit(
      {
        searches: [options.query],
        searchPosts: true,
        skipComments: true,
        sort: toSort(options.sort),
        maxItems: limit,
        maxPostCount: limit,
      },
      limit,
    );
    let posts = items.map(mapToPost);
    posts = filterByDateRange(posts, options.dateRange);
    posts = sortPosts(posts, options.sort);
    return paginateArray(posts, options);
  }

  async getPost(urlOrId: string): Promise<Post> {
    const items = await runReddit(
      { startUrls: [{ url: toStartUrl(urlOrId) }], searchPosts: true, skipComments: true, maxItems: 1 },
      1,
    );
    if (items.length === 0) throw new NotFoundError('reddit', `post "${urlOrId}"`);
    return mapToPost(items[0]);
  }

  async getComments(postUrlOrId: string, options?: PaginationOptions): Promise<PaginatedResult<Comment>> {
    const limit = options?.limit ?? 50;
    const items = await runReddit(
      {
        startUrls: [{ url: toStartUrl(postUrlOrId) }],
        searchComments: true,
        skipComments: false,
        maxComments: limit,
      },
      limit,
    );
    const comments = items.map((item) => mapToComment(item, postUrlOrId));
    return paginateArray(comments, options);
  }

  async getAuthor(usernameOrUrl: string): Promise<Author> {
    const url = usernameOrUrl.startsWith('http')
      ? usernameOrUrl
      : `https://www.reddit.com/user/${usernameOrUrl.replace(/^u\//, '')}`;
    const items = await runReddit({ startUrls: [{ url }], searchUsers: true, maxUserCount: 1 }, 1);
    if (items.length === 0) throw new NotFoundError('reddit', `user "${usernameOrUrl}"`);
    return mapToAuthor(items[0]);
  }

  async getTrending(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const limit = options?.limit ?? 25;
    const items = await runReddit(
      { startUrls: [{ url: 'https://www.reddit.com/r/all/' }], searchPosts: true, sort: 'hot', maxItems: limit, maxPostCount: limit },
      limit,
    );
    return paginateArray(items.map(mapToPost), options);
  }

  async getLatest(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const limit = options?.limit ?? 25;
    const items = await runReddit(
      { startUrls: [{ url: 'https://www.reddit.com/r/all/' }], searchPosts: true, sort: 'new', maxItems: limit, maxPostCount: limit },
      limit,
    );
    return paginateArray(items.map(mapToPost), options);
  }

  /**
   * Pulls recent posts directly from named subreddits (sorted by New), instead of
   * keyword search. Reddit's keyword search caps out around ~1,000 results and its
   * comment index is degraded, whereas a named subreddit sorted by New pages through
   * its full history — so this is the recommended way to get volume from this actor.
   * Relevance filtering happens later in the pipeline via keyword scoring.
   */
  async fetchFromSubreddits(subreddits: string[], options: { lookbackHours?: number; maxItems?: number } = {}): Promise<Post[]> {
    if (subreddits.length === 0) return [];
    const maxItems = options.maxItems ?? 300;
    const items = await runReddit(
      {
        subreddits,
        sort: 'new',
        postDateLimit: options.lookbackHours ? `${options.lookbackHours} hours` : undefined,
        maxItems,
        skipCommunityInfo: true,
        skipComments: true,
      },
      maxItems,
    );
    return items.filter((item) => item['recordType'] === 'post').map(mapToPost);
  }
}
