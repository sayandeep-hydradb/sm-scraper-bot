/**
 * Simple sliding-window rate limiter. Each `acquire()` call resolves
 * immediately if under budget, or waits until the oldest request in the
 * current window ages out. One instance is created per provider so
 * platforms never contend for each other's budget.
 */
export class RateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number = 60_000,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.timestamps.length > 0 && now - this.timestamps[0] >= this.windowMs) {
        this.timestamps.shift();
      }
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }
      const waitMs = this.windowMs - (now - this.timestamps[0]) + 1;
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 0)));
    }
  }
}
