# sm-scraper-bot

Self-contained social media scraping toolkit. Scrape **Reddit, X (Twitter), Hacker News, Dev.to, Medium, and Substack** through one consistent interface, with zero dependency on any other repository.

## Quick start

```bash
npm install
cp .env.example .env      # then fill in APIFY_API_TOKEN (see below)
npm run scrape             # runs the full daily pipeline (see "Daily pipeline" below)
```

`npm run scrape` runs the complete daily pipeline (`runDailyScraper()`), not the single-platform CLI. For ad hoc single-platform exploration during development, use the CLI directly:

```bash
npm run dev -- devto search "rust" --limit 5
```

## How each platform is sourced

| Platform  | Source                                             | Needs a key? |
|-----------|-----------------------------------------------------|--------------|
| Hacker News | Official [Firebase API](https://github.com/HackerNews/API) + [Algolia HN Search](https://hn.algolia.com/api) | No |
| Dev.to    | Official [dev.to/api](https://developers.forem.com/api) | No (optional `DEVTO_API_KEY` raises rate limits) |
| Reddit    | Apify actor (`trudax/reddit-scraper` by default) | Yes — `APIFY_API_TOKEN` |
| X/Twitter | Apify actor (`apidojo/tweet-scraper` by default) | Yes — `APIFY_API_TOKEN` |
| Medium    | Apify actor (`easyapi/medium-posts-search-scraper` by default) | Yes — `APIFY_API_TOKEN` |
| Substack  | Apify actor (`easyapi/substack-posts-scraper` by default) | Yes — `APIFY_API_TOKEN` |

Get an Apify token at https://console.apify.com/account/integrations. Every actor ID is overridable in `.env` if you'd rather point at a different actor — no code changes needed.

**Why Hacker News and Dev.to don't go through Apify:** the source catalog (`social-media-scraping-apis-main`) had no fit-for-purpose actor for either — only unrelated lead-gen "email scraper" listings. Both platforms have simple, free, official public APIs, so those are used directly instead of forcing a nonexistent or mismatched actor.

## Usage

```bash
sm-scraper <platform> <command> [args] [--flags]
```

Commands: `search <query>`, `post <urlOrId>`, `comments <postUrlOrId>`, `author <usernameOrUrl>`, `trending`, `latest`

Flags: `--limit`, `--page`, `--cursor`, `--sort` (`relevance|new|top|hot|old`), `--from`, `--to` (ISO dates)

```bash
sm-scraper reddit search "ai agents" --limit 20 --sort new
sm-scraper hackernews trending --limit 10
sm-scraper devto post https://dev.to/someuser/some-slug
sm-scraper reddit comments https://www.reddit.com/r/programming/comments/abc123 --limit 30
sm-scraper twitter author openai
sm-scraper medium latest --limit 15
```

Or use it as a library:

```ts
import { scraperService } from './src/index.js';

const { items } = await scraperService.search('hackernews', { query: 'rust', limit: 10 });
```

## Daily pipeline

`npm run scrape` (or `import { runDailyScraper } from './src/index.js'`) runs the full pipeline:

1. Runs every **enabled** platform's search for every configured **keyword**.
2. Merges all results across platforms.
3. Removes duplicate posts (by platform + id).
4. Filters to posts published within the last `lookbackHours` (default 24).
5. Scores each remaining post against the configured keywords/weights.
6. Sorts by score, descending.
7. Returns the sorted array (also written to `output/daily-scraper-result.json`).

If one platform or keyword search fails, it's logged and skipped — the rest of the pipeline keeps running.

All of this is configured in **`config/scraper.config.json`** — no code changes needed to tune it:

```json
{
  "lookbackHours": 24,
  "platforms": { "reddit": true, "twitter": true, "hackernews": true, "devto": true, "medium": true, "substack": true },
  "keywords": ["microsoft graphrag", "graphiti github", "neo4j alternatives", "graph database for ai", "..."],
  "search": { "maxItemsPerKeyword": 25, "sort": "new" },
  "scoring": { "keywordMatchWeight": 10, "titleMatchBonus": 5, "engagementWeight": 0.05, "recencyWeight": 2 }
}
```

- `platforms` — set any platform to `false` to disable it for the daily run.
- `keywords` — searched against every enabled platform; also what posts are scored against.
- `scoring` — `keywordMatchWeight`/`titleMatchBonus` reward keyword matches (title matches get an extra bonus), `engagementWeight` rewards likes/upvotes/comments, `recencyWeight` rewards newer posts.

## Running on a schedule (GitHub Actions)

`.github/workflows/daily-social-report.yml` runs `npm run scrape` daily at 04:30 UTC (10:00 IST), and can also be triggered manually from the Actions tab (`workflow_dispatch`). It fails clearly (before scraping anything) if required secrets aren't configured on the repo.

Required repo secrets: `APIFY_API_TOKEN`. Optional: `DEVTO_API_KEY`, `REDDIT_ACTOR_ID`, `TWITTER_ACTOR_ID`, `MEDIUM_ACTOR_ID`, `SUBSTACK_ACTOR_ID` (actor overrides). The run's output JSON is uploaded as a workflow artifact (`daily-scraper-result`).

## Architecture

```
src/
  core/            shared types, the ScraperProvider interface, error classes
  utils/           retry (exponential backoff), rate limiter, pagination, date filter/sort, logger
  config/          .env loading + validation, actor IDs, timeouts
  api/              generic HTTP clients: apifyClient.ts (runs any actor) and httpClient.ts (direct APIs)
  providers/
    reddit/  twitter/  hackernews/  devto/  medium/  substack/
      index.ts   - implements ScraperProvider for that platform
      mapper.ts  - normalizes the raw source payload into core/types.ts shapes
  services/
    scraperService.ts   platform-agnostic facade used by the CLI (and anything else)
  pipeline/
    runDailyScraper.ts  the daily orchestration entry point (fan-out, dedupe, filter, score, sort)
    runDaily.ts         CLI entrypoint for `npm run scrape` (writes output/daily-scraper-result.json)
    dedupe.ts / recencyFilter.ts / scoring.ts   pipeline building blocks
  cli.ts           single-platform terminal entrypoint (`npm run dev -- <platform> <command>`)
  index.ts         library entrypoint
```

Every provider implements the same interface (`src/core/interfaces.ts`):

```ts
search(options) / getPost(urlOrId) / getComments(postUrlOrId, options)
getAuthor(usernameOrUrl) / getTrending(options) / getLatest(options)
```

Callers (the CLI, `scraperService`, your own code) never branch on which platform they're talking to — `ScraperService` just resolves the right provider by name.

Cross-cutting concerns (retry, timeout, rate limiting) live once in `api/apifyClient.ts` and `api/httpClient.ts` and apply uniformly to every provider — no per-provider duplication.

## Configuration

All secrets and tunables live in `.env` (see `.env.example`). Nothing is hardcoded:

- `APIFY_API_TOKEN` — required for reddit/twitter/medium/substack
- `REDDIT_ACTOR_ID` / `TWITTER_ACTOR_ID` / `MEDIUM_ACTOR_ID` / `SUBSTACK_ACTOR_ID` — swap actors without touching code
- `DEVTO_API_KEY` — optional, raises Dev.to rate limits
- `DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_RETRIES`, `DEFAULT_RETRY_BASE_DELAY_MS` — HTTP resilience knobs
- `RATE_LIMIT_PER_MINUTE` — per-provider request budget
- `APIFY_POLL_INTERVAL_MS`, `APIFY_RUN_TIMEOUT_MS` — Apify run behavior

Keywords, scoring weights, and platform enable/disable flags for the daily pipeline live separately in `config/scraper.config.json` (see "Daily pipeline" above), overridable via `SCRAPER_CONFIG_PATH`.

## Known limitations (read before relying on this in production)

- **Reddit, Twitter, Medium, Substack field mappings are best-effort.** These providers call third-party Apify actors whose exact output field names I could not verify against a live paid run (no Apify token was available while building this). Each provider's `mapper.ts` reads fields defensively with fallback chains and always keeps the untouched payload on `Post.raw` / `Comment.raw`. If your actor's real output uses different field names, that mapper file is the single place to adjust — nothing else needs to change.
- **Hacker News and Dev.to were verified against live traffic** while building this (real search/post/comments/author/trending/latest calls all confirmed working) — one real bug was caught and fixed this way (Dev.to's single-article endpoint returns `tag_list` as a comma-separated string, while its list endpoint returns an array; both are now normalized).
- **"Trending" is an approximation** for Medium (tag page) and X/Twitter (high-engagement recent search) and Substack (Discover page), since none of those platforms/actors expose a real global trending feed. Reddit and Hacker News have real trending endpoints (`r/all` hot, Firebase `topstories`).
- **Comments/responses on Medium and Substack are best-effort** and depend entirely on whether your configured actor happens to expose them; the providers degrade to an empty page rather than erroring if not.

## What was migrated from `social-media-scraping-apis-main`

Nothing, directly — that repository turned out to contain no scraper code. It was a generated Markdown catalog of ~10,500 third-party Apify Actor links (with affiliate referral codes) plus an unrelated promotional file. There was no scraping logic, auth, retry/rate-limit code, parsers, or models to port. Everything in `sm-scraper-bot` was built fresh; the only thing carried over from the old repo was using its catalog to identify which real Apify actors exist for Reddit/Twitter/Medium/Substack. `social-media-scraping-apis-main` can be deleted — this repo has no reference to it and no runtime dependency on it.
