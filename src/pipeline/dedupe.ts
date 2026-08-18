import type { Post } from '../core/types.js';

export interface DedupeResult {
  unique: Post[];
  duplicatesRemoved: number;
}

/**
 * Deduplicates posts by platform + a stable identity, keeping the first seen.
 * Falls back from `id` to `url` to `title` because several third-party actors
 * leave `id` empty when their real ID field name differs from our mapper's
 * pick-list — keying on the empty string alone would collapse an entire
 * platform down to a single "post".
 */
export function dedupePosts(posts: Post[]): DedupeResult {
  const seen = new Set<string>();
  const unique: Post[] = [];

  for (const post of posts) {
    const identity = post.id || post.url || post.title || '';
    const key = `${post.platform}:${identity}`;
    // An item with no id, url, or title has no stable identity — keep it rather
    // than letting every such item collapse onto the same empty key.
    if (identity && seen.has(key)) continue;
    if (identity) seen.add(key);
    unique.push(post);
  }

  return { unique, duplicatesRemoved: posts.length - unique.length };
}
