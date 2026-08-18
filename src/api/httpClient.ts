import { config } from '../config/env.js';
import { TimeoutError, UpstreamRequestError } from '../core/errors.js';
import { RateLimiter } from '../utils/rateLimiter.js';
import { withRetry, withTimeout, type RetryOptions } from '../utils/retry.js';
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

/** Retry HTTP status codes: rate-limit and transient server errors. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryOptions(platform: string, opts?: { retryTimeouts?: boolean }): RetryOptions {
  const retryTimeouts = opts?.retryTimeouts ?? true;
  return {
    maxRetries: config.http.maxRetries,
    baseDelayMs: config.http.retryBaseDelayMs,
    logger,
    label: `http:${platform}`,
    isRetryable: (error) => {
      if (error instanceof UpstreamRequestError) return isRetryableStatus(error.statusCode);
      // Timeouts on non-idempotent/paid calls (e.g. LLM POSTs) should not be
      // retried, since the original request may still be doing billable work.
      if (error instanceof TimeoutError) return retryTimeouts;
      return true;
    },
  };
}

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
    retryOptions(platform),
  );
}

/** Fetches raw text (e.g. an RSS/Atom feed) with the same resilience policy as getJson. */
export async function getText(url: string, options: GetJsonOptions): Promise<string> {
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
          return await response.text();
        },
        config.http.timeoutMs,
        platform,
      ),
    retryOptions(platform),
  );
}

/**
 * POSTs a JSON body and parses a JSON response (used for the OpenRouter LLM API).
 * Timeouts are NOT retried here — the original call may still be running and
 * billing — so we don't fire a second paid request for the same work.
 */
export async function postJson<T>(url: string, body: unknown, options: GetJsonOptions): Promise<T> {
  const { platform, headers } = options;
  await limiterFor(platform).acquire();

  return withRetry(
    () =>
      withTimeout(
        async (signal) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
            body: JSON.stringify(body),
            signal,
          });
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new UpstreamRequestError(
              platform,
              response.status,
              `POST ${url} failed with HTTP ${response.status}: ${text.slice(0, 500)}`,
            );
          }
          return (await response.json()) as T;
        },
        config.http.timeoutMs,
        platform,
      ),
    retryOptions(platform, { retryTimeouts: false }),
  );
}
