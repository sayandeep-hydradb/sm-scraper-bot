import 'dotenv/config';
import { ConfigError } from '../core/errors.js';
import type { LogLevel } from '../utils/logger.js';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new ConfigError(`Environment variable ${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

export const config = {
  apify: {
    apiToken: process.env.APIFY_API_TOKEN ?? '',
    baseUrl: 'https://api.apify.com/v2',
    pollIntervalMs: int('APIFY_POLL_INTERVAL_MS', 1500),
    // Matches Apify's own run-sync ceiling (300s). A shorter client timeout just
    // abandons a run that keeps billing, so we never time out before Apify does.
    runTimeoutMs: int('APIFY_RUN_TIMEOUT_MS', 300_000),
    // Optional hard per-run cost ceiling in USD for pay-per-event actors. 0 = off.
    maxTotalChargeUsd: int('APIFY_MAX_TOTAL_CHARGE_USD', 0),
  },
  actors: {
    // Only Reddit and X/Twitter use Apify now — Medium and Substack were moved to
    // free RSS. Lite = pay-per-result ($3.40/1k) with no monthly rental, unlike the
    // full trudax/reddit-scraper ($45/mo + usage). Override via REDDIT_ACTOR_ID.
    reddit: process.env.REDDIT_ACTOR_ID || 'trudax/reddit-scraper-lite',
    twitter: process.env.TWITTER_ACTOR_ID || 'apidojo/tweet-scraper',
  },
  devto: {
    apiKey: process.env.DEVTO_API_KEY ?? '',
    baseUrl: 'https://dev.to/api',
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    baseUrl: 'https://openrouter.ai/api/v1',
    // DeepSeek V3.2 is the cheapest capable option for relevance scoring.
    model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v3.2',
  },
  hackernews: {
    firebaseUrl: 'https://hacker-news.firebaseio.com/v0',
    // Official HN search index, run by Algolia in partnership with YC.
    // The Firebase API has no search endpoint, so this covers search()/getLatest().
    algoliaUrl: 'https://hn.algolia.com/api/v1',
  },
  http: {
    timeoutMs: int('DEFAULT_TIMEOUT_MS', 30_000),
    maxRetries: int('DEFAULT_MAX_RETRIES', 3),
    retryBaseDelayMs: int('DEFAULT_RETRY_BASE_DELAY_MS', 500),
  },
  rateLimit: {
    perMinute: int('RATE_LIMIT_PER_MINUTE', 60),
  },
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL ?? '',
    botToken: process.env.SLACK_BOT_TOKEN ?? '',
    channelId: process.env.SLACK_CHANNEL_ID ?? '',
  },
  logLevel: (process.env.LOG_LEVEL as LogLevel) || 'info',
};

/** Call before running any Apify-backed provider; fails fast with a clear message. */
export function requireApifyToken(platform: string): string {
  if (!config.apify.apiToken) {
    throw new ConfigError(
      `APIFY_API_TOKEN is not set. Get one at https://console.apify.com/account/integrations and add it to .env`,
      platform,
    );
  }
  return config.apify.apiToken;
}

/** True when an OpenRouter key is configured, so the LLM relevance step can run. */
export function hasOpenRouterKey(): boolean {
  return Boolean(config.openrouter.apiKey);
}
