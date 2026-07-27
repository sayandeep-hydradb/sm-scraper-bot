import type { Post } from '../core/types.js';

export interface DedupeResult {
  unique: Post[];
  duplicatesRemoved: number;
}

/** Deduplicates posts by platform+id, keeping the first occurrence seen. */
export function dedupePosts(posts: Post[]): DedupeResult {
  const seen = new Set<string>();
  const unique: Post[] = [];

  for (const post of posts) {
    const key = `${post.platform}:${post.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(post);
  }

  return { unique, duplicatesRemoved: posts.length - unique.length };
}
