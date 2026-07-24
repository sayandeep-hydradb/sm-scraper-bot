export class ScraperError extends Error {
  constructor(
    message: string,
    public readonly platform?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends ScraperError {}

export class ProviderNotFoundError extends ScraperError {
  constructor(platform: string) {
    super(`No provider registered for platform "${platform}"`, platform);
  }
}

export class NotFoundError extends ScraperError {
  constructor(platform: string, resource: string) {
    super(`${resource} not found`, platform);
  }
}

export class RateLimitError extends ScraperError {
  constructor(platform: string, retryAfterMs?: number) {
    super(`Rate limit exceeded for ${platform}`, platform);
    this.retryAfterMs = retryAfterMs;
  }
  retryAfterMs?: number;
}

export class TimeoutError extends ScraperError {
  constructor(platform: string, timeoutMs: number) {
    super(`Request to ${platform} timed out after ${timeoutMs}ms`, platform);
  }
}

export class UpstreamRequestError extends ScraperError {
  constructor(
    platform: string,
    public readonly statusCode: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, platform, cause);
  }
}

export class ApifyRunError extends ScraperError {
  constructor(platform: string, actorId: string, message: string, cause?: unknown) {
    super(`Apify actor "${actorId}" failed: ${message}`, platform, cause);
  }
}
