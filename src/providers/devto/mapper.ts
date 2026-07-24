import type { Author, Comment, Post } from '../../core/types.js';

export interface DevtoUser {
  name?: string;
  username: string;
  twitter_username?: string;
  github_username?: string;
  website_url?: string;
  profile_image?: string;
}

export interface DevtoArticle {
  id: number;
  title: string;
  description?: string;
  body_markdown?: string;
  url: string;
  published_at?: string;
  // The list endpoint (/articles) returns this as string[]; the single-article
  // endpoint (/articles/{id}) returns the same field as a comma-separated string.
  tag_list?: string[] | string;
  user: DevtoUser;
  public_reactions_count?: number;
  positive_reactions_count?: number;
  comments_count?: number;
  page_views_count?: number;
}

export interface DevtoComment {
  id_code: string;
  created_at: string;
  body_html: string;
  user: DevtoUser;
  children?: DevtoComment[];
}

export interface DevtoFullUser {
  id: number;
  username: string;
  name?: string;
  summary?: string;
  website_url?: string;
  profile_image?: string;
}

function normalizeTags(tagList: string[] | string | undefined): string[] | undefined {
  if (!tagList) return undefined;
  if (Array.isArray(tagList)) return tagList;
  return tagList
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function authorFrom(user: DevtoUser): Author {
  return {
    username: user.username,
    displayName: user.name,
    url: `https://dev.to/${user.username}`,
    avatarUrl: user.profile_image,
  };
}

export function mapToPost(article: DevtoArticle): Post {
  return {
    id: String(article.id),
    platform: 'devto',
    url: article.url,
    title: article.title,
    content: article.body_markdown ?? article.description,
    author: authorFrom(article.user),
    publishedAt: article.published_at,
    tags: normalizeTags(article.tag_list),
    engagement: {
      likes: article.positive_reactions_count ?? article.public_reactions_count,
      comments: article.comments_count,
      views: article.page_views_count,
    },
    raw: article,
  };
}

/** Flattens dev.to's nested comment tree into a flat list, preserving parentId links. */
export function flattenComments(comments: DevtoComment[], postId: string, parentId?: string): Comment[] {
  return comments.flatMap((comment) => {
    const mapped: Comment = {
      id: comment.id_code,
      postId,
      platform: 'devto',
      content: comment.body_html,
      author: authorFrom(comment.user),
      publishedAt: comment.created_at,
      parentId,
      engagement: {},
      raw: comment,
    };
    const children = comment.children ? flattenComments(comment.children, postId, comment.id_code) : [];
    return [mapped, ...children];
  });
}

export function mapToAuthor(user: DevtoFullUser): Author {
  return {
    id: String(user.id),
    username: user.username,
    displayName: user.name,
    url: `https://dev.to/${user.username}`,
    avatarUrl: user.profile_image,
    bio: user.summary,
  };
}
