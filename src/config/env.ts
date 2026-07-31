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
    runTimeoutMs: int('APIFY_RUN_TIMEOUT_MS', 120_000),
  },
  actors: {
    reddit: process.env.REDDIT_ACTOR_ID || 'solidcode/reddit-scraper',
    twitter: process.env.TWITTER_ACTOR_ID || 'apidojo/tweet-scraper',
    medium: process.env.MEDIUM_ACTOR_ID || 'easyapi/medium-posts-search-scraper',
    substack: process.env.SUBSTACK_ACTOR_ID || 'easyapi/substack-posts-scraper',
  },
  devto: {
    apiKey: process.env.DEVTO_API_KEY ?? '',
    baseUrl: 'https://dev.to/api',
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
