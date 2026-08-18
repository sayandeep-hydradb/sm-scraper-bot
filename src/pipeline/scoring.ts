import type { ScraperConfig } from '../config/scraperConfig.js';
import type { Post } from '../core/types.js';
import { engagementScore } from '../utils/filterAndSort.js';

export interface ScoredPost extends Post {
  score: number;
  matchedKeywords: string[];
  /** 0–100 relevance judged by the LLM step (undefined if the step was skipped). */
  relevance?: number;
  /** One-line rationale from the LLM for why this post matters. */
  reason?: string;
  /** One-line suggested follow-up action from the LLM. */
  followUp?: string;
}

function recencyScore(post: Post, lookbackHours: number): number {
  if (!post.publishedAt) return 0;
  const hoursOld = (Date.now() - Date.parse(post.publishedAt)) / (60 * 60 * 1000);
  return Math.max(0, lookbackHours - hoursOld);
}

/** Scores a post against the configured keyword list and weights. */
export function scorePost(post: Post, config: ScraperConfig): { score: number; matchedKeywords: string[] } {
  const title = (post.title ?? '').toLowerCase();
  const content = (post.content ?? '').toLowerCase();
  const matchedKeywords: string[] = [];
  let score = 0;

  for (const keyword of config.keywords) {
    const needle = keyword.toLowerCase();
    const inTitle = title.includes(needle);
    const inContent = content.includes(needle);
    if (!inTitle && !inContent) continue;

    matchedKeywords.push(keyword);
    score += config.scoring.keywordMatchWeight;
    if (inTitle) score += config.scoring.titleMatchBonus;
  }

  score += engagementScore(post) * config.scoring.engagementWeight;
  score += recencyScore(post, config.lookbackHours) * config.scoring.recencyWeight;

  return { score, matchedKeywords };
}
