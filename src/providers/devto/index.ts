import { getJson } from '../../api/httpClient.js';
import { config } from '../../config/env.js';
import type { ScraperProvider } from '../../core/interfaces.js';
import { NotFoundError } from '../../core/errors.js';
import type { Author, BatchSearchOptions, Comment, PaginatedResult, PaginationOptions, Post, SearchOptions } from '../../core/types.js';
import { filterByDateRange } from '../../utils/filterAndSort.js';
import { paginateArray } from '../../utils/pagination.js';
import { flattenComments, mapToAuthor, mapToPost, type DevtoArticle, type DevtoComment, type DevtoFullUser } from './mapper.js';

const { baseUrl, apiKey } = config.devto;

// Dev.to tags that surface content relevant to graph databases, AI memory, and RAG.
// dev.to has no full-text search API, so we fetch recent articles by tag (free) and let
// the pipeline's keyword/LLM scoring determine relevance — same strategy as Reddit
// subreddits. Unknown tags just return [] (harmless), so the list can be generous.
const DEVTO_TAGS = [
  'database',
  'ai',
  'machinelearning',
  'llm',
  'rag',
  'neo4j',
  'vectordatabase',
  'knowledgegraph',
  'genai',
  'openai',
  'embeddings',
  'datascience',
];

// How many recent articles to pull per tag (free API). Higher = more candidates
// for the relevance step to choose from.
const PER_TAG_LIMIT = 60;

// Cached per process run so 22 keyword calls share one set of HTTP fetches.
let tagArticleCache: DevtoArticle[] | null = null;

function headers(): Record<string, string> {
  return apiKey ? { 'api-key': apiKey } : {};
}

async function fetchTagPool(): Promise<DevtoArticle[]> {
  if (tagArticleCache) return tagArticleCache;
  const perTag = await Promise.all(
    DEVTO_TAGS.map((tag) =>
      getJson<DevtoArticle[]>(`${baseUrl}/articles?tag=${tag}&per_page=${PER_TAG_LIMIT}`, {
        platform: 'devto',
        headers: headers(),
      }).catch(() => [] as DevtoArticle[]),
    ),
  );
  const seen = new Set<number>();
  const pool: DevtoArticle[] = [];
  for (const articles of perTag) {
    for (const a of articles) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        pool.push(a);
      }
    }
  }
  tagArticleCache = pool;
  return pool;
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
   * dev.to has no full-text search API. We fetch a pool of recent articles
   * from topic-relevant tags (cached per process) and return the whole pool
   * so the pipeline's keyword-scoring step can determine relevance. The
   * pipeline's capPerPlatform(75) handles the final cut-off.
   */
  async search(options: SearchOptions): Promise<PaginatedResult<Post>> {
    const pool = await fetchTagPool();
    let posts = pool.map(mapToPost);
    if (options.dateRange) posts = filterByDateRange(posts, options.dateRange);
    return { items: posts, hasMore: false, total: posts.length };
  }

  /**
   * dev.to has no full-text search, so keywords don't change what we fetch: this
   * returns the shared tag pool once (trimmed to `limit`) instead of re-fetching
   * per keyword. Relevance is decided later by keyword/LLM scoring.
   */
  async searchMany(_queries: string[], options?: BatchSearchOptions): Promise<PaginatedResult<Post>> {
    const pool = await fetchTagPool();
    let posts = pool.map(mapToPost);
    if (options?.dateRange) posts = filterByDateRange(posts, options.dateRange);
    if (options?.limit) posts = posts.slice(0, options.limit);
    return { items: posts, hasMore: false, total: posts.length };
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
