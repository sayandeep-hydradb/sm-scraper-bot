import type { DateRange, Post, SortOrder } from '../core/types.js';

export function filterByDateRange<T extends { publishedAt?: string }>(items: T[], range?: DateRange): T[] {
  if (!range || (!range.from && !range.to)) return items;
  const fromMs = range.from ? Date.parse(range.from) : -Infinity;
  const toMs = range.to ? Date.parse(range.to) : Infinity;

  return items.filter((item) => {
    if (!item.publishedAt) return true;
    const ts = Date.parse(item.publishedAt);
    if (Number.isNaN(ts)) return true;
    return ts >= fromMs && ts <= toMs;
  });
}

/** Applies a common sort convention (new/old by date, top/hot by score) across providers. */
export function sortPosts(posts: Post[], sort?: SortOrder): Post[] {
  if (!sort || sort === 'relevance') return posts;

  const sorted = [...posts];
  switch (sort) {
    case 'new':
      return sorted.sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0));
    case 'old':
      return sorted.sort((a, b) => (Date.parse(a.publishedAt ?? '') || 0) - (Date.parse(b.publishedAt ?? '') || 0));
    case 'top':
    case 'hot':
      return sorted.sort((a, b) => engagementScore(b) - engagementScore(a));
    default:
      return sorted;
  }
}

export function engagementScore(post: Post): number {
  const e = post.engagement;
  return (e.score ?? 0) + (e.upvotes ?? 0) + (e.likes ?? 0) + (e.comments ?? 0) * 0.5;
}
