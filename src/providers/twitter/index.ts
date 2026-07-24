import { runActorAndGetItems } from '../../api/apifyClient.js';
import { config } from '../../config/env.js';
import type { ScraperProvider } from '../../core/interfaces.js';
import { NotFoundError } from '../../core/errors.js';
import type { Author, Comment, PaginatedResult, PaginationOptions, Post, SearchOptions } from '../../core/types.js';
import { filterByDateRange, sortPosts } from '../../utils/filterAndSort.js';
import { paginateArray } from '../../utils/pagination.js';
import { mapToComment, mapToPost, type TweetItem } from './mapper.js';

const ACTOR_ID = config.actors.twitter;

async function runTwitter(input: Record<string, unknown>, maxItems?: number): Promise<TweetItem[]> {
  return runActorAndGetItems<TweetItem>({ platform: 'twitter', actorId: ACTOR_ID, input, maxItems });
}

function extractTweetId(urlOrId: string): string {
  const match = urlOrId.match(/status\/(\d+)/);
  return match ? match[1] : urlOrId;
}

export class TwitterProvider implements ScraperProvider {
  readonly platform = 'twitter' as const;

  async search(options: SearchOptions): Promise<PaginatedResult<Post>> {
    const limit = options.limit ?? 25;
    const items = await runTwitter(
      {
        searchTerms: [options.query],
        maxItems: limit,
        sort: options.sort === 'new' ? 'Latest' : 'Top',
        ...(options.dateRange?.from ? { start: options.dateRange.from.slice(0, 10) } : {}),
        ...(options.dateRange?.to ? { end: options.dateRange.to.slice(0, 10) } : {}),
      },
      limit,
    );
    let posts = items.map(mapToPost);
    posts = filterByDateRange(posts, options.dateRange);
    posts = sortPosts(posts, options.sort);
    return paginateArray(posts, options);
  }

  async getPost(urlOrId: string): Promise<Post> {
    const id = extractTweetId(urlOrId);
    const items = await runTwitter({ startUrls: [`https://x.com/i/status/${id}`], maxItems: 1 }, 1);
    if (items.length === 0) throw new NotFoundError('twitter', `tweet "${urlOrId}"`);
    return mapToPost(items[0]);
  }

  async getComments(postUrlOrId: string, options?: PaginationOptions): Promise<PaginatedResult<Comment>> {
    const id = extractTweetId(postUrlOrId);
    const limit = options?.limit ?? 50;
    const items = await runTwitter({ conversationIds: [id], maxItems: limit + 1 }, limit + 1);
    const replies = items.filter((item) => String(item['id'] ?? item['tweetId']) !== id);
    return paginateArray(
      replies.map((item) => mapToComment(item, postUrlOrId)),
      options,
    );
  }

  async getAuthor(usernameOrUrl: string): Promise<Author> {
    const handle = usernameOrUrl.replace(/^https?:\/\/(x\.com|twitter\.com)\//, '').replace(/^@/, '');
    const items = await runTwitter({ twitterHandles: [handle], maxItems: 1 }, 1);
    if (items.length === 0) throw new NotFoundError('twitter', `user "${usernameOrUrl}"`);
    return mapToPost(items[0]).author;
  }

  async getTrending(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    // X's own "Trending" surface isn't exposed by this actor; approximate it
    // with a high-engagement, recent, Top-sorted search.
    const limit = options?.limit ?? 25;
    const items = await runTwitter({ searchTerms: ['lang:en min_faves:500'], sort: 'Top', maxItems: limit }, limit);
    return paginateArray(items.map(mapToPost), options);
  }

  async getLatest(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const limit = options?.limit ?? 25;
    const items = await runTwitter({ searchTerms: ['lang:en'], sort: 'Latest', maxItems: limit }, limit);
    return paginateArray(items.map(mapToPost), options);
  }
}
