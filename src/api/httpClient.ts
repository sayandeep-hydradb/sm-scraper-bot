import { config } from '../config/env.js';
import { UpstreamRequestError } from '../core/errors.js';
import { RateLimiter } from '../utils/rateLimiter.js';
import { withRetry, withTimeout } from '../utils/retry.js';
import { Logger } from '../utils/logger.js';

const limiters = new Map<string, RateLimiter>();
function limiterFor(platform: string): RateLimiter {
  let limiter = limiters.get(platform);
  if (!limiter) {
    limiter = new RateLimiter(config.rateLimit.perMinute, 60_000);
    limiters.set(platform, limiter);
  }
  return limiter;
}

const logger = new Logger('http', config.logLevel);

export interface GetJsonOptions {
  platform: string;
  headers?: Record<string, string>;
}

/** Fetches JSON from a direct/official API, with the same retry+timeout+rate-limit policy Apify calls get. */
export async function getJson<T>(url: string, options: GetJsonOptions): Promise<T> {
  const { platform, headers } = options;
  await limiterFor(platform).acquire();

  return withRetry(
    () =>
      withTimeout(
        async (signal) => {
          const response = await fetch(url, { headers, signal });
          if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new UpstreamRequestError(
              platform,
              response.status,
              `GET ${url} failed with HTTP ${response.status}: ${body.slice(0, 500)}`,
            );
          }
          return (await response.json()) as T;
        },
        config.http.timeoutMs,
        platform,
      ),
    {
      maxRetries: config.http.maxRetries,
      baseDelayMs: config.http.retryBaseDelayMs,
      logger,
      label: `http:${platform}`,
      isRetryable: (error) => {
        if (error instanceof UpstreamRequestError) return error.statusCode === 429 || error.statusCode >= 500;
        return true;
      },
    },
  );
}
