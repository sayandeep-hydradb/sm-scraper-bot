import type { Post } from '../core/types.js';

/**
 * Keeps only posts with a parseable `publishedAt` within the last `lookbackHours`.
 * Posts with a missing or unparseable date are dropped — recency can't be
 * confirmed for them, so they're excluded rather than assumed to pass.
 */
export function filterByLookbackHours(posts: Post[], lookbackHours: number): Post[] {
  const cutoffMs = Date.now() - lookbackHours * 60 * 60 * 1000;
  return posts.filter((post) => {
    if (!post.publishedAt) return false;
    const publishedMs = Date.parse(post.publishedAt);
    return Number.isFinite(publishedMs) && publishedMs >= cutoffMs;
  });
}
