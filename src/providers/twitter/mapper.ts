import type { Author, Comment, Post } from '../../core/types.js';

/**
 * apidojo/tweet-scraper ("Tweet Scraper V2") output shape, defensively read.
 * Nested author object field names have varied slightly across versions
 * (`userName` vs `username`), so we fall back across both.
 */
export type TweetItem = Record<string, unknown>;

function pick<T = unknown>(item: Record<string, unknown>, keys: string[]): T | undefined {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) return item[key] as T;
  }
  return undefined;
}

function authorFrom(item: TweetItem): Author {
  const authorObj = (pick<Record<string, unknown>>(item, ['author', 'user']) ?? {}) as Record<string, unknown>;
  const username = pick<string>(authorObj, ['userName', 'username', 'screen_name']) ?? 'unknown';
  return {
    id: pick<string>(authorObj, ['id', 'userId']),
    username,
    displayName: pick<string>(authorObj, ['name', 'displayName']),
    url: `https://x.com/${username}`,
    avatarUrl: pick<string>(authorObj, ['profilePicture', 'profile_image_url']),
    bio: pick<string>(authorObj, ['description', 'bio']),
    followersCount: pick<number>(authorObj, ['followers', 'followersCount', 'followers_count']),
    verified: pick<boolean>(authorObj, ['isVerified', 'isBlueVerified', 'verified']),
  };
}

export function mapToPost(item: TweetItem): Post {
  const id = String(pick<string>(item, ['id', 'tweetId']) ?? '');
  return {
    id,
    platform: 'twitter',
    url: pick<string>(item, ['url', 'twitterUrl']) ?? `https://x.com/i/status/${id}`,
    content: pick<string>(item, ['text', 'fullText', 'full_text']),
    author: authorFrom(item),
    publishedAt: normalizeDate(pick(item, ['createdAt', 'created_at'])),
    tags: pick<string[]>(item, ['hashtags']),
    engagement: {
      likes: pick<number>(item, ['likeCount', 'favorite_count', 'likes']),
      shares: pick<number>(item, ['retweetCount', 'retweet_count']),
      comments: pick<number>(item, ['replyCount', 'reply_count']),
      views: pick<number>(item, ['viewCount', 'views']),
      bookmarks: pick<number>(item, ['bookmarkCount']),
    },
    raw: item,
  };
}

export function mapToComment(item: TweetItem, postId: string): Comment {
  return {
    id: String(pick<string>(item, ['id', 'tweetId']) ?? ''),
    postId,
    platform: 'twitter',
    content: pick<string>(item, ['text', 'fullText', 'full_text']) ?? '',
    author: authorFrom(item),
    publishedAt: normalizeDate(pick(item, ['createdAt', 'created_at'])),
    parentId: pick<string>(item, ['inReplyToId', 'in_reply_to_status_id']),
    engagement: {
      likes: pick<number>(item, ['likeCount', 'favorite_count']),
      shares: pick<number>(item, ['retweetCount']),
    },
    raw: item,
  };
}

function normalizeDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
