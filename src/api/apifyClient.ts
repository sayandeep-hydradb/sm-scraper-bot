import { config, requireApifyToken } from '../config/env.js';
import { ApifyRunError, UpstreamRequestError } from '../core/errors.js';
import { RateLimiter } from '../utils/rateLimiter.js';
import { withRetry, withTimeout } from '../utils/retry.js';
import { Logger } from '../utils/logger.js';

/** owner/name -> owner~name, as required by Apify's REST URL scheme. */
function toActorPath(actorId: string): string {
  return actorId.includes('/') ? actorId.replace('/', '~') : actorId;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface RunActorOptions {
  /** Which ScraperProvider is calling, used for error messages and its own rate-limit bucket. */
  platform: string;
  actorId: string;
  input: Record<string, unknown>;
  /** Max dataset items to request from Apify (maps to the `limit` query param on the sync endpoint). */
  maxItems?: number;
}

const limiters = new Map<string, RateLimiter>();
function limiterFor(platform: string): RateLimiter {
  let limiter = limiters.get(platform);
  if (!limiter) {
    limiter = new RateLimiter(config.rateLimit.perMinute, 60_000);
    limiters.set(platform, limiter);
  }
  return limiter;
}

const logger = new Logger('apify', config.logLevel);

/**
 * Runs an Apify actor synchronously and returns its dataset items.
 * Wraps the call in our own rate limiter, timeout, and retry policy so
 * every Apify-backed provider gets consistent resilience for free.
 */
export async function runActorAndGetItems<T = Record<string, unknown>>(options: RunActorOptions): Promise<T[]> {
  const { platform, actorId, input, maxItems } = options;
  const token = requireApifyToken(platform);

  await limiterFor(platform).acquire();

  const actorPath = toActorPath(actorId);
  const url = new URL(`${config.apify.baseUrl}/acts/${actorPath}/run-sync-get-dataset-items`);
  url.searchParams.set('token', token);
  if (maxItems) url.searchParams.set('limit', String(maxItems));

  return withRetry(
    () =>
      withTimeout(
        async (signal) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal,
          });

          if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new UpstreamRequestError(
              platform,
              response.status,
              `Apify actor "${actorId}" run failed with HTTP ${response.status}: ${body.slice(0, 500)}`,
            );
          }

          try {
            return (await response.json()) as T[];
          } catch (error) {
            throw new ApifyRunError(platform, actorId, 'Failed to parse actor response as JSON', error);
          }
        },
        config.apify.runTimeoutMs,
        platform,
      ),
    {
      maxRetries: config.http.maxRetries,
      baseDelayMs: config.http.retryBaseDelayMs,
      logger,
      label: `apify:${actorId}`,
      isRetryable: (error) => {
        if (error instanceof UpstreamRequestError) return isRetryableStatus(error.statusCode);
        return true;
      },
    },
  );
}
