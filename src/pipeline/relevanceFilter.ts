import { chatCompletion } from '../api/openrouterClient.js';
import { config, hasOpenRouterKey } from '../config/env.js';
import type { ScraperConfig } from '../config/scraperConfig.js';
import type { Platform } from '../core/types.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { Logger } from '../utils/logger.js';
import type { ScoredPost } from './scoring.js';

const logger = new Logger('relevance', config.logLevel);

const BATCH_SIZE = 12;
const BATCH_CONCURRENCY = 4;
const SNIPPET_CHARS = 300;

const SYSTEM_PROMPT = `You are a lead-qualification assistant for HydraDB, a graph database built for AI memory and RAG (retrieval-augmented generation) — an alternative to Neo4j, Amazon Neptune, and vector databases for storing and retrieving LLM/agent long-term memory and knowledge graphs.

Score each social-media post 0-100 for how useful it is as a signal for HydraDB's team to follow up on.
- HIGH (70-100): someone evaluating or comparing graph/vector databases; building RAG or agent-memory systems; hitting limits of vector DBs, Neo4j, or Neptune; asking for recommendations; discussing graph-RAG or knowledge-graph architecture.
- MEDIUM (40-69): generally on-topic (graph DBs, RAG, AI memory) but no clear engagement hook.
- LOW (0-39): generic news, unrelated tutorials, job posts, or off-topic content.

For each post also give a reason (<=12 words) and a suggested follow-up action for HydraDB's team (<=12 words).
Respond with ONLY JSON: {"results":[{"index":<number>,"relevanceScore":<0-100>,"reason":"...","followUp":"..."}]} with one entry per post.`;

interface LlmVerdict {
  index: number;
  relevanceScore: number;
  reason?: string;
  followUp?: string;
}

function postKey(post: ScoredPost): string {
  return `${post.platform}:${post.id || post.url || post.title || ''}`;
}

/** Top N per platform, preserving the incoming (score-desc) order. */
function selectCandidates(posts: ScoredPost[], maxPerPlatform: number): ScoredPost[] {
  const seenPerPlatform = new Map<Platform, number>();
  const selected: ScoredPost[] = [];
  for (const post of posts) {
    const count = seenPerPlatform.get(post.platform) ?? 0;
    if (count >= maxPerPlatform) continue;
    seenPerPlatform.set(post.platform, count + 1);
    selected.push(post);
  }
  return selected;
}

function snippet(post: ScoredPost): string {
  const text = `${post.title ? `${post.title}. ` : ''}${post.content ?? ''}`.replace(/\s+/g, ' ').trim();
  return text.slice(0, SNIPPET_CHARS);
}

function buildUserPrompt(batch: ScoredPost[]): string {
  const items = batch.map((post, i) => `#${i} [${post.platform}] ${snippet(post) || '(no text)'}`).join('\n');
  return `Score these ${batch.length} posts. Return one JSON result per post, keyed by the #index shown.\n\n${items}`;
}

function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1];
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) return content.slice(start, end + 1);
  return content;
}

function parseVerdicts(content: string): LlmVerdict[] {
  try {
    const parsed = JSON.parse(extractJson(content)) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed as { results?: unknown }).results;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((raw): LlmVerdict => {
        const r = raw as Record<string, unknown>;
        return {
          index: Number(r.index),
          relevanceScore: Number(r.relevanceScore ?? r.score ?? 0),
          reason: typeof r.reason === 'string' ? r.reason : undefined,
          followUp: typeof r.followUp === 'string' ? r.followUp : undefined,
        };
      })
      .filter((v) => Number.isFinite(v.index) && Number.isFinite(v.relevanceScore));
  } catch {
    return [];
  }
}

/**
 * LLM relevance gate + enrichment. Judges the top candidates per platform against
 * HydraDB's ICP, keeps those at/above `relevance.threshold`, and attaches a
 * reason + suggested follow-up. Degrades safely: if the step is disabled, no
 * OpenRouter key is set, or every batch errors, the input posts are returned
 * unchanged so the run still produces keyword-scored output.
 */
export async function filterByRelevance(posts: ScoredPost[], scraperConfig: ScraperConfig): Promise<ScoredPost[]> {
  const relevanceCfg = scraperConfig.relevance;
  if (!relevanceCfg?.enabled) return posts;
  if (!hasOpenRouterKey()) {
    logger.info('OPENROUTER_API_KEY not set — skipping LLM relevance filter, using keyword scores');
    return posts;
  }

  const candidates = selectCandidates(posts, relevanceCfg.maxCandidatesPerPlatform);
  if (candidates.length === 0) return posts;

  const batches: ScoredPost[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  let failedBatches = 0;
  const perBatch = await mapWithConcurrency(batches, BATCH_CONCURRENCY, async (batch) => {
    try {
      const content = await chatCompletion(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(batch) },
        ],
        { temperature: 0, jsonMode: true },
      );
      return { batch, verdicts: parseVerdicts(content) };
    } catch (error) {
      failedBatches++;
      logger.warn('relevance batch failed', { error: error instanceof Error ? error.message : String(error) });
      return { batch, verdicts: [] as LlmVerdict[] };
    }
  });

  if (failedBatches === batches.length) {
    logger.warn('all relevance batches failed — falling back to keyword-scored posts');
    return posts;
  }

  const verdictByKey = new Map<string, LlmVerdict>();
  for (const { batch, verdicts } of perBatch) {
    const byIndex = new Map(verdicts.map((v) => [v.index, v]));
    batch.forEach((post, i) => {
      const verdict = byIndex.get(i);
      if (verdict) verdictByKey.set(postKey(post), verdict);
    });
  }

  const threshold = relevanceCfg.threshold;
  const kept: ScoredPost[] = [];
  for (const post of candidates) {
    const verdict = verdictByKey.get(postKey(post));
    if (verdict) {
      if (verdict.relevanceScore >= threshold) {
        kept.push({ ...post, relevance: verdict.relevanceScore, reason: verdict.reason, followUp: verdict.followUp });
      }
    } else if (post.matchedKeywords.length > 0) {
      // No verdict (parse miss / partial failure): fall back to keeping keyword-relevant posts.
      kept.push(post);
    }
  }

  kept.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0) || b.score - a.score);
  logger.info('relevance filter applied', {
    candidates: candidates.length,
    kept: kept.length,
    threshold,
    failedBatches,
  });
  return kept;
}
