#!/usr/bin/env node
import { scraperService } from './services/scraperService.js';
import { ScraperError } from './core/errors.js';
import type { Platform, SearchOptions, SortOrder } from './core/types.js';

const COMMANDS = ['search', 'post', 'comments', 'author', 'trending', 'latest'] as const;
type Command = (typeof COMMANDS)[number];

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function printUsage(): void {
  console.log(`sm-scraper - self-contained social media scraper

Usage:
  sm-scraper <platform> <command> [args] [--flags]

Platforms: ${scraperService.listPlatforms().join(', ')}
Commands:  ${COMMANDS.join(', ')}

Examples:
  sm-scraper reddit search "ai agents" --limit 20 --sort new
  sm-scraper hackernews trending --limit 10
  sm-scraper devto post https://dev.to/someuser/some-slug
  sm-scraper reddit comments https://www.reddit.com/r/programming/comments/abc123 --limit 30
  sm-scraper twitter author openai
  sm-scraper medium latest --limit 15

Flags:
  --limit <n>   Items per page (default 25)
  --page <n>    Page number (default 1)
  --cursor <c>  Opaque pagination cursor returned by a previous call
  --sort <s>    relevance | new | top | hot | old
  --from <iso>  Date range lower bound (ISO date)
  --to <iso>    Date range upper bound (ISO date)
`);
}

async function main(): Promise<void> {
  const [platformArg, commandArg, ...rest] = process.argv.slice(2);

  if (!platformArg || !commandArg) {
    printUsage();
    process.exitCode = platformArg ? 1 : 0;
    return;
  }

  const platform = platformArg as Platform;
  if (!scraperService.listPlatforms().includes(platform)) {
    console.error(`Unknown platform "${platformArg}". Supported: ${scraperService.listPlatforms().join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const command = commandArg as Command;
  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command "${commandArg}". Supported: ${COMMANDS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const { positional, flags } = parseFlags(rest);
  const pagination = {
    limit: flags.limit ? Number(flags.limit) : undefined,
    page: flags.page ? Number(flags.page) : undefined,
    cursor: flags.cursor,
  };

  let result: unknown;
  switch (command) {
    case 'search': {
      const query = positional.join(' ');
      if (!query) throw new Error('search requires a query, e.g. `sm-scraper reddit search "keyword"`');
      const options: SearchOptions = {
        query,
        ...pagination,
        sort: flags.sort as SortOrder | undefined,
        dateRange: flags.from || flags.to ? { from: flags.from, to: flags.to } : undefined,
      };
      result = await scraperService.search(platform, options);
      break;
    }
    case 'post':
      if (!positional[0]) throw new Error('post requires a URL or ID');
      result = await scraperService.getPost(platform, positional[0]);
      break;
    case 'comments':
      if (!positional[0]) throw new Error('comments requires a post URL or ID');
      result = await scraperService.getComments(platform, positional[0], pagination);
      break;
    case 'author':
      if (!positional[0]) throw new Error('author requires a username or profile URL');
      result = await scraperService.getAuthor(platform, positional[0]);
      break;
    case 'trending':
      result = await scraperService.getTrending(platform, pagination);
      break;
    case 'latest':
      result = await scraperService.getLatest(platform, pagination);
      break;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  if (error instanceof ScraperError) {
    console.error(`[${error.platform ?? 'sm-scraper'}] ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
