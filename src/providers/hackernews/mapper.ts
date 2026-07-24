import type { Author, Comment, Post } from '../../core/types.js';

export interface HnFirebaseItem {
  id: number;
  type?: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time?: number;
  text?: string;
  dead?: boolean;
  deleted?: boolean;
  parent?: number;
  kids?: number[];
  url?: string;
  score?: number;
  title?: string;
  descendants?: number;
}

export interface HnFirebaseUser {
  id: string;
  created: number;
  karma: number;
  about?: string;
  submitted?: number[];
}

export interface HnAlgoliaHit {
  objectID: string;
  title?: string;
  url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
  story_text?: string;
  comment_text?: string;
  story_id?: number;
  parent_id?: number;
}

function itemUrl(id: number | string): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

export function mapFirebaseItemToPost(item: HnFirebaseItem): Post {
  return {
    id: String(item.id),
    platform: 'hackernews',
    url: item.url ?? itemUrl(item.id),
    title: item.title,
    content: item.text,
    author: { username: item.by ?? 'unknown', url: `https://news.ycombinator.com/user?id=${item.by ?? ''}` },
    publishedAt: item.time ? new Date(item.time * 1000).toISOString() : undefined,
    engagement: { score: item.score, comments: item.descendants },
    raw: item,
  };
}

export function mapFirebaseItemToComment(item: HnFirebaseItem, postId: string): Comment {
  return {
    id: String(item.id),
    postId,
    platform: 'hackernews',
    content: item.text ?? '',
    author: { username: item.by ?? 'unknown', url: `https://news.ycombinator.com/user?id=${item.by ?? ''}` },
    publishedAt: item.time ? new Date(item.time * 1000).toISOString() : undefined,
    parentId: item.parent ? String(item.parent) : undefined,
    engagement: {},
    raw: item,
  };
}

export function mapAlgoliaHitToPost(hit: HnAlgoliaHit): Post {
  return {
    id: hit.objectID,
    platform: 'hackernews',
    url: hit.url ?? itemUrl(hit.objectID),
    title: hit.title,
    content: hit.story_text,
    author: { username: hit.author ?? 'unknown', url: `https://news.ycombinator.com/user?id=${hit.author ?? ''}` },
    publishedAt: hit.created_at ? new Date(hit.created_at).toISOString() : undefined,
    engagement: { score: hit.points, comments: hit.num_comments },
    raw: hit,
  };
}

export function mapFirebaseUserToAuthor(user: HnFirebaseUser): Author {
  return {
    username: user.id,
    url: `https://news.ycombinator.com/user?id=${user.id}`,
    bio: user.about,
    followersCount: user.karma,
  };
}
