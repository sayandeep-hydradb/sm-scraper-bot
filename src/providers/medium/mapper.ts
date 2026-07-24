import type { Author, Post } from '../../core/types.js';

/**
 * NOTE ON CONFIDENCE: unlike Reddit/Twitter/HN/Dev.to (well-documented,
 * widely-used integrations), the Medium actor market is long-tail and each
 * actor's exact output field names aren't independently verifiable without
 * a live paid run. Fields are read defensively via `pick()` fallback
 * chains; the untouched item is always kept on `raw`. If your chosen
 * MEDIUM_ACTOR_ID returns different field names, this is the only file you
 * need to edit.
 */
export type MediumItem = Record<string, unknown>;

function pick<T = unknown>(item: MediumItem, keys: string[]): T | undefined {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) return item[key] as T;
  }
  return undefined;
}

function authorFrom(item: MediumItem): Author {
  const authorObj = (pick<Record<string, unknown>>(item, ['author', 'creator', 'writer']) ?? item) as Record<
    string,
    unknown
  >;
  const username = pick<string>(authorObj, ['username', 'authorUsername', 'name', 'handle']) ?? 'unknown';
  return {
    username,
    displayName: pick<string>(authorObj, ['name', 'fullName', 'displayName']),
    url: pick<string>(authorObj, ['profileUrl', 'url']) ?? `https://medium.com/@${username}`,
    bio: pick<string>(authorObj, ['bio']),
    followersCount: pick<number>(authorObj, ['followersCount', 'followers']),
  };
}

export function mapToPost(item: MediumItem): Post {
  return {
    id: String(pick<string>(item, ['id', 'postId', 'articleId']) ?? pick<string>(item, ['url']) ?? ''),
    platform: 'medium',
    url: pick<string>(item, ['url', 'link', 'postUrl']) ?? '',
    title: pick<string>(item, ['title']),
    content: pick<string>(item, ['content', 'subtitle', 'description', 'previewText']),
    author: authorFrom(item),
    publishedAt: normalizeDate(pick(item, ['publishedAt', 'firstPublishedAt', 'date', 'createdAt'])),
    tags: pick<string[]>(item, ['tags', 'topics']),
    engagement: {
      likes: pick<number>(item, ['claps', 'likes']),
      comments: pick<number>(item, ['responsesCount', 'commentsCount']),
    },
    raw: item,
  };
}

export function mapToAuthor(item: MediumItem): Author {
  return authorFrom(item);
}

function normalizeDate(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
