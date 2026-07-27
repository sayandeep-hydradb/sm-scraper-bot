const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LEVELS)[number];

function levelIndex(level: LogLevel): number {
  return LEVELS.indexOf(level);
}

export class Logger {
  constructor(
    private readonly scope: string,
    private readonly minLevel: LogLevel = 'info',
  ) {}

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (levelIndex(level) < levelIndex(this.minLevel)) return;
    const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${this.scope}]`;
    const line = meta ? `${prefix} ${message} ${JSON.stringify(meta)}` : `${prefix} ${message}`;
    // All levels go to stderr, keeping stdout free for structured command output (e.g. the daily scraper's JSON array).
    console.error(line);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }
}
