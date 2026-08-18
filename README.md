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

| Platform  | Source                                             | Cost | Needs a key? |
|-----------|-----------------------------------------------------|------|--------------|
| Hacker News | Official [Firebase API](https://github.com/HackerNews/API) + [Algolia HN Search](https://hn.algolia.com/api) | Free | No |
| Dev.to    | Official [dev.to/api](https://developers.forem.com/api) | Free | No (optional `DEVTO_API_KEY` raises rate limits) |
| Medium    | Free per-tag RSS feeds (`medium.com/feed/tag/<tag>`) | Free | No |
| Substack  | Free per-publication RSS feeds (`<pub>/feed`) | Free | No |
| Reddit    | Apify actor (`trudax/reddit-scraper-lite` by default, $3.40/1k) | Paid | Yes — `APIFY_API_TOKEN` |
| X/Twitter | Apify actor (`apidojo/tweet-scraper` by default, $0.40/1k) | Paid | Yes — `APIFY_API_TOKEN` |

Only Reddit and X/Twitter cost money — they have no free official/RSS source. Get an Apify token at https://console.apify.com/account/integrations; both actor IDs are overridable in `.env`.

**Cost control.** The daily pipeline is built to run cheaply (~$2–3/day at twice daily): keywords are sent to each Apify actor in a **single batched run** (not one run per keyword), each platform is capped by `maxItemsPerPlatform`, runs are bounded to the `lookbackHours` window, and client timeouts never retry (an abandoned Apify run keeps billing, so a retry would double-charge). Medium/Substack were moved off paid actors onto free RSS. An optional LLM step (see below) then keeps only genuinely relevant posts.

**Why HN, Dev.to, Medium, and Substack don't go through Apify:** all four have free official APIs or RSS feeds, so paying a third-party actor for them is pure waste. Reddit's free `.json` endpoint was blocked in 2026, and X/Twitter has no free API, so those two stay on Apify.

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

1. Fetches each **enabled** platform's candidates in **one batched call** — all keywords in a single Apify run (Twitter) / subreddit pull (Reddit) / RSS-pool fetch (Medium, Substack, Dev.to), capped by `maxItemsPerPlatform`.
2. Merges all results across platforms.
3. Removes duplicate posts (by platform + id, falling back to url/title).
4. Filters to posts published within the last `lookbackHours` (default 12).
5. Scores each remaining post against the configured keywords/weights.
6. **LLM relevance pass** (optional): judges the top candidates per platform against HydraDB's ICP via OpenRouter, keeps those above `relevance.threshold`, and attaches a "why" + suggested follow-up. Skipped safely if `OPENROUTER_API_KEY` is unset.
7. Caps to the top `output.maxPostsPerPlatform` and returns the array (also written to `output/daily-scraper-result.json` + `.xlsx`).

If one platform fails, it's logged and skipped — the rest of the pipeline keeps running.

All of this is configured in **`config/scraper.config.json`** — no code changes needed to tune it:

```json
{
  "lookbackHours": 12,
  "platforms": { "reddit": true, "twitter": true, "hackernews": true, "devto": true, "medium": true, "substack": true },
  "keywords": ["microsoft graphrag", "graphiti github", "neo4j alternatives", "graph database for ai", "..."],
  "search": { "maxItemsPerKeyword": 25, "sort": "new" },
  "maxItemsPerPlatform": { "twitter": 150, "reddit": 200, "hackernews": 150, "devto": 200, "medium": 120, "substack": 120 },
  "medium": { "tags": ["graph-database", "knowledge-graph", "rag", "vector-database", "neo4j"] },
  "substack": { "publications": ["https://thesequence.substack.com", "https://www.latent.space"] },
  "output": { "maxPostsPerPlatform": 75 },
  "relevance": { "enabled": true, "threshold": 60, "maxCandidatesPerPlatform": 40 },
  "scoring": { "keywordMatchWeight": 10, "titleMatchBonus": 5, "engagementWeight": 0.05, "recencyWeight": 2 }
}
```

- `platforms` — set any platform to `false` to disable it for the daily run.
- `keywords` — searched against every enabled platform; also what posts are scored against.
- `maxItemsPerPlatform` — hard ceiling on how many items each platform **scrapes** per run (what you pay for). Tune down to cut cost further.
- `medium.tags` / `substack.publications` — which free RSS feeds to pull. An empty `substack.publications` list skips Substack cleanly.
- `relevance` — the LLM gate: `threshold` (0–100) is the minimum score a post must earn to survive; `maxCandidatesPerPlatform` caps how many posts per platform are sent to the LLM (bounds LLM cost).
- `scoring` — `keywordMatchWeight`/`titleMatchBonus` reward keyword matches (title matches get an extra bonus), `engagementWeight` rewards likes/upvotes/comments, `recencyWeight` rewards newer posts.

## Running on a schedule (GitHub Actions)

`.github/workflows/daily-social-report.yml` runs `npm run scrape` twice a day — at 02:30 UTC and 14:30 UTC (08:00 IST and 20:00 IST) — and can also be triggered manually from the Actions tab (`workflow_dispatch`). It fails clearly (before scraping anything) if required secrets aren't configured on the repo.

Required repo secrets: `APIFY_API_TOKEN`. Recommended: `OPENROUTER_API_KEY` (enables the LLM relevance pass; the run still works without it). Optional: `DEVTO_API_KEY`, `REDDIT_ACTOR_ID`, `TWITTER_ACTOR_ID` (actor overrides), `SLACK_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`. The run's output JSON + xlsx are uploaded as a workflow artifact (`scraper-result`).

## Architecture

```
src/
  core/            shared types, the ScraperProvider interface, error classes
  utils/           retry (exponential backoff), rate limiter, pagination, date filter/sort, rss parser, logger
  config/          .env loading + validation, actor IDs, timeouts
  api/              apifyClient.ts (runs Apify actors), httpClient.ts (direct APIs + RSS + POST), openrouterClient.ts (LLM)
  providers/
    reddit/  twitter/       Apify-backed (index.ts + mapper.ts)
    hackernews/  devto/      free official APIs (index.ts + mapper.ts)
    medium/  substack/       free RSS feeds (index.ts; RSS is normalized in utils/rss.ts)
      index.ts   - implements ScraperProvider for that platform
  services/
    scraperService.ts   platform-agnostic facade used by the CLI (and anything else)
  pipeline/
    runDailyScraper.ts  the daily orchestration entry point (batched fan-out, dedupe, filter, score, relevance, cap)
    runDaily.ts         CLI entrypoint for `npm run scrape` (writes output/daily-scraper-result.json + .xlsx)
    dedupe.ts / recencyFilter.ts / scoring.ts / relevanceFilter.ts   pipeline building blocks
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

- `APIFY_API_TOKEN` — required for reddit/twitter (Medium/Substack now use free RSS)
- `REDDIT_ACTOR_ID` / `TWITTER_ACTOR_ID` — swap actors without touching code
- `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` — enable + choose the LLM relevance model (default `deepseek/deepseek-v3.2`)
- `DEVTO_API_KEY` — optional, raises Dev.to rate limits
- `DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_RETRIES`, `DEFAULT_RETRY_BASE_DELAY_MS` — HTTP resilience knobs
- `RATE_LIMIT_PER_MINUTE` — per-provider request budget
- `APIFY_POLL_INTERVAL_MS`, `APIFY_RUN_TIMEOUT_MS` — Apify run behavior (timeout defaults to 300s, matching Apify's sync cap)
- `APIFY_MAX_TOTAL_CHARGE_USD` — optional hard per-run cost ceiling for pay-per-event actors (0 = off)

Keywords, scoring weights, and platform enable/disable flags for the daily pipeline live separately in `config/scraper.config.json` (see "Daily pipeline" above), overridable via `SCRAPER_CONFIG_PATH`.

## Known limitations (read before relying on this in production)

- **Reddit and Twitter field mappings are best-effort and should be verified once against a live run.** Both call third-party Apify actors; their `mapper.ts` reads fields defensively with fallback chains and always keeps the untouched payload on `Post.raw`. After your first real run, spot-check that `id` and `publishedAt` are populated in `output/daily-scraper-result.json` (an empty `id` or missing date means the actor uses a different field name — adjust that one mapper). This matters especially after switching Reddit to the Lite actor.
- **Medium and Substack read RSS**, so their post `title`/`link`/`publishedAt` are reliable, but single-post fetch (`getPost`) and comments are not available from feeds and degrade accordingly. Substack pulls only the publications listed in `config/scraper.config.json`.
- **Hacker News and Dev.to were verified against live traffic** while building this. Dev.to has no full-text search API, so it fetches recent articles by topic tag and relies on the keyword/LLM scoring for relevance.
- **"Trending" is an approximation** for Medium/Substack (latest from the feed pool) and X/Twitter (high-engagement recent search). Reddit and Hacker News have real trending endpoints.
- **The LLM relevance pass is optional and fail-safe.** Without `OPENROUTER_API_KEY`, or if every LLM batch errors, the pipeline falls back to keyword scoring and still produces a report.

## What was migrated from `social-media-scraping-apis-main`

Nothing, directly — that repository turned out to contain no scraper code. It was a generated Markdown catalog of ~10,500 third-party Apify Actor links (with affiliate referral codes) plus an unrelated promotional file. There was no scraping logic, auth, retry/rate-limit code, parsers, or models to port. Everything in `sm-scraper-bot` was built fresh; the only thing carried over from the old repo was using its catalog to identify which real Apify actors exist for Reddit/Twitter/Medium/Substack. `social-media-scraping-apis-main` can be deleted — this repo has no reference to it and no runtime dependency on it.
