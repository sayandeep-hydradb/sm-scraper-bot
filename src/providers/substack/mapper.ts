import type { Author, Post } from '../../core/types.js';

/**
 * Same confidence caveat as the Medium provider: this is a long-tail
 * third-party actor whose exact field names aren't verifiable without a
 * live paid run. Read defensively, keep `raw` for anything unmapped, and
 * adjust the `pick()` key lists here if your actor's output differs.
 */
export type SubstackItem = Record<string, unknown>;

function pick<T = unknown>(item: SubstackItem, keys: string[]): T | undefined {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) return item[key] as T;
  }
  return undefined;
}

function authorFrom(item: SubstackItem): Author {
  const authorObj = (pick<Record<string, unknown>>(item, ['author', 'writer', 'publication']) ?? item) as Record<
    string,
    unknown
  >;
  const username =
    pick<string>(authorObj, ['username', 'handle', 'slug', 'subdomain']) ?? pick<string>(authorObj, ['name']) ?? 'unknown';
  return {
    username,
    displayName: pick<string>(authorObj, ['name', 'displayName']),
    url: pick<string>(authorObj, ['url', 'profileUrl']) ?? `https://${username}.substack.com`,
    bio: pick<string>(authorObj, ['bio', 'description']),
    followersCount: pick<number>(authorObj, ['subscriberCount', 'followersCount']),
  };
}

export function mapToPost(item: SubstackItem): Post {
  return {
    id: String(pick<string>(item, ['id', 'postId']) ?? pick<string>(item, ['url']) ?? ''),
    platform: 'substack',
    url: pick<string>(item, ['url', 'link', 'canonicalUrl']) ?? '',
    title: pick<string>(item, ['title']),
    content: pick<string>(item, ['content', 'subtitle', 'description', 'bodyText']),
    author: authorFrom(item),
    publishedAt: normalizeDate(pick(item, ['publishedAt', 'postDate', 'date', 'createdAt'])),
    tags: pick<string[]>(item, ['tags']),
    engagement: {
      likes: pick<number>(item, ['likeCount', 'reactionCount', 'likes']),
      comments: pick<number>(item, ['commentCount', 'commentsCount']),
    },
    raw: item,
  };
}

export function mapToAuthor(item: SubstackItem): Author {
  return authorFrom(item);
}

function normalizeDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
