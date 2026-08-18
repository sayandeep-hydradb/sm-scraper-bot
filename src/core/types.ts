export type Platform =
  | 'reddit'
  | 'twitter'
  | 'hackernews'
  | 'devto'
  | 'medium'
  | 'substack';

export type SortOrder = 'relevance' | 'new' | 'top' | 'hot' | 'old';

export interface Author {
  id?: string;
  username: string;
  displayName?: string;
  url?: string;
  avatarUrl?: string;
  bio?: string;
  followersCount?: number;
  verified?: boolean;
}

export interface EngagementMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  upvotes?: number;
  downvotes?: number;
  score?: number;
  bookmarks?: number;
}

export interface Post {
  id: string;
  platform: Platform;
  url: string;
  title?: string;
  content?: string;
  author: Author;
  publishedAt?: string;
  tags?: string[];
  engagement: EngagementMetrics;
  /** Unmapped original payload from the underlying source, kept for debugging / extension. */
  raw?: unknown;
}

export interface Comment {
  id: string;
  postId: string;
  platform: Platform;
  content: string;
  author: Author;
  publishedAt?: string;
  engagement: EngagementMetrics;
  parentId?: string;
  raw?: unknown;
}

export interface DateRange {
  /** ISO 8601 date string, inclusive lower bound. */
  from?: string;
  /** ISO 8601 date string, inclusive upper bound. */
  to?: string;
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface SearchOptions extends PaginationOptions {
  query: string;
  sort?: SortOrder;
  dateRange?: DateRange;
}

/** Options for a batched, multi-keyword search — same as SearchOptions minus the single `query`. */
export type BatchSearchOptions = Omit<SearchOptions, 'query'>;

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
  total?: number;
}
