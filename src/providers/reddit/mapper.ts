import type { Author, Comment, Post } from '../../core/types.js';

/**
 * trudax/reddit-scraper returns a mixed dataset (`dataType` discriminates
 * post/comment/community/user) with loosely-typed fields that have shifted
 * names across actor versions. We read defensively via `pick()` fallback
 * chains and keep the untouched item on `raw` so callers can reach into
 * fields we didn't anticipate. If your actor run's output differs, this is
 * the only file you need to adjust.
 */
export type RedditItem = Record<string, unknown>;

function pick<T = unknown>(item: RedditItem, keys: string[]): T | undefined {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) return item[key] as T;
  }
  return undefined;
}

function toAuthor(item: RedditItem): Author {
  const username = pick<string>(item, ['username', 'author', 'authorName', 'userName']) ?? 'unknown';
  return {
    username,
    url: `https://www.reddit.com/user/${username}`,
    followersCount: pick<number>(item, ['authorKarma', 'karma', 'totalKarma']),
  };
}

export function mapToPost(item: RedditItem): Post {
  const id = String(pick<string>(item, ['id', 'parsedId', 'postId']) ?? '');
  const url = pick<string>(item, ['url', 'postUrl', 'permalink']) ?? '';
  return {
    id,
    platform: 'reddit',
    url: url.startsWith('http') ? url : `https://www.reddit.com${url}`,
    title: pick<string>(item, ['title']),
    content: pick<string>(item, ['body', 'selftext', 'text']),
    author: toAuthor(item),
    publishedAt: normalizeDate(pick(item, ['createdAt', 'created', 'date'])),
    tags: pick<string>(item, ['communityName', 'subreddit'])
      ? [String(pick<string>(item, ['communityName', 'subreddit']))]
      : undefined,
    engagement: {
      upvotes: pick<number>(item, ['upVotes', 'ups', 'score']),
      score: pick<number>(item, ['score', 'upVotes']),
      comments: pick<number>(item, ['numberOfComments', 'numComments', 'commentCount']),
    },
    raw: item,
  };
}

export function mapToComment(item: RedditItem, postId: string): Comment {
  return {
    id: String(pick<string>(item, ['id', 'parsedId', 'commentId']) ?? ''),
    postId,
    platform: 'reddit',
    content: pick<string>(item, ['body', 'text', 'comment']) ?? '',
    author: toAuthor(item),
    publishedAt: normalizeDate(pick(item, ['createdAt', 'created', 'date'])),
    parentId: pick<string>(item, ['parentId']),
    engagement: {
      upvotes: pick<number>(item, ['upVotes', 'ups', 'score']),
      score: pick<number>(item, ['score', 'upVotes']),
    },
    raw: item,
  };
}

export function mapToAuthor(item: RedditItem): Author {
  const username = pick<string>(item, ['username', 'name', 'author']) ?? 'unknown';
  return {
    username,
    displayName: pick<string>(item, ['displayName']),
    url: `https://www.reddit.com/user/${username}`,
    bio: pick<string>(item, ['description', 'bio']),
    followersCount: pick<number>(item, ['karma', 'totalKarma', 'commentKarma']),
  };
}

function normalizeDate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
