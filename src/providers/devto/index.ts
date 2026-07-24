import { getJson } from '../../api/httpClient.js';
import { config } from '../../config/env.js';
import type { ScraperProvider } from '../../core/interfaces.js';
import { NotFoundError } from '../../core/errors.js';
import type { Author, Comment, PaginatedResult, PaginationOptions, Post, SearchOptions } from '../../core/types.js';
import { filterByDateRange } from '../../utils/filterAndSort.js';
import { paginateArray } from '../../utils/pagination.js';
import { flattenComments, mapToAuthor, mapToPost, type DevtoArticle, type DevtoComment, type DevtoFullUser } from './mapper.js';

const { baseUrl, apiKey } = config.devto;

function headers(): Record<string, string> {
  return apiKey ? { 'api-key': apiKey } : {};
}

function parseArticleRef(urlOrId: string): { id?: string; usernameSlug?: string } {
  if (/^\d+$/.test(urlOrId)) return { id: urlOrId };
  const match = urlOrId.match(/dev\.to\/([^/]+)\/([^/?#]+)/);
  if (match) return { usernameSlug: `${match[1]}/${match[2]}` };
  if (urlOrId.includes('/')) return { usernameSlug: urlOrId };
  return { id: urlOrId };
}

async function fetchArticle(urlOrId: string): Promise<DevtoArticle> {
  const ref = parseArticleRef(urlOrId);
  const path = ref.id ? `/articles/${ref.id}` : `/articles/${ref.usernameSlug}`;
  const article = await getJson<DevtoArticle | null>(`${baseUrl}${path}`, { platform: 'devto', headers: headers() });
  if (!article) throw new NotFoundError('devto', `article "${urlOrId}"`);
  return article;
}

export class DevtoProvider implements ScraperProvider {
  readonly platform = 'devto' as const;

  /**
   * dev.to's public API has no full-text search endpoint, so we pull a pool
   * of recent/top articles (optionally scoped by tag, when the query looks
   * like one) and filter client-side by title/description match.
   */
  async search(options: SearchOptions): Promise<PaginatedResult<Post>> {
    const pool = await getJson<DevtoArticle[]>(
      `${baseUrl}/articles?per_page=100&top=30`,
      { platform: 'devto', headers: headers() },
    );
    const needle = options.query.toLowerCase();
    const matches = pool.filter((a) => {
      const tags = Array.isArray(a.tag_list) ? a.tag_list : (a.tag_list ?? '').split(',').map((t) => t.trim());
      return a.title.toLowerCase().includes(needle) || tags.some((t) => t.toLowerCase() === needle);
    });
    let posts = matches.map(mapToPost);
    posts = filterByDateRange(posts, options.dateRange);
    return paginateArray(posts, options);
  }

  async getPost(urlOrId: string): Promise<Post> {
    return mapToPost(await fetchArticle(urlOrId));
  }

  async getComments(postUrlOrId: string, options?: PaginationOptions): Promise<PaginatedResult<Comment>> {
    const article = await fetchArticle(postUrlOrId);
    const tree = await getJson<DevtoComment[]>(`${baseUrl}/comments?a_id=${article.id}`, {
      platform: 'devto',
      headers: headers(),
    });
    const comments = flattenComments(tree, String(article.id));
    return paginateArray(comments, options);
  }

  async getAuthor(usernameOrUrl: string): Promise<Author> {
    const username = usernameOrUrl.replace(/^https?:\/\/dev\.to\//, '').replace(/\/$/, '');
    const user = await getJson<DevtoFullUser | null>(`${baseUrl}/users/by_username?url=${encodeURIComponent(username)}`, {
      platform: 'devto',
      headers: headers(),
    });
    if (!user) throw new NotFoundError('devto', `user "${usernameOrUrl}"`);
    return mapToAuthor(user);
  }

  async getTrending(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const limit = options?.limit ?? 25;
    const articles = await getJson<DevtoArticle[]>(`${baseUrl}/articles?top=7&per_page=${limit}`, {
      platform: 'devto',
      headers: headers(),
    });
    return paginateArray(articles.map(mapToPost), options);
  }

  async getLatest(options?: PaginationOptions): Promise<PaginatedResult<Post>> {
    const limit = options?.limit ?? 25;
    const page = options?.page ?? 1;
    const articles = await getJson<DevtoArticle[]>(`${baseUrl}/articles?page=${page}&per_page=${limit}`, {
      platform: 'devto',
      headers: headers(),
    });
    return { items: articles.map(mapToPost), hasMore: articles.length === limit };
  }
}
