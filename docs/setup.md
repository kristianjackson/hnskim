# Setup Guide

This guide follows the same development style as TMAGen.

## 1. Prerequisites

Install:
- Node.js 24+
- npm 11+
- Git
- a Supabase project
- a Cloudflare account
- an OpenAI API key

## 2. Create the Project

The repository should use:
- one workspace app at `apps/web`
- Cloudflare Workers
- React Router
- Supabase
- Wrangler

## 3. Configure Local Secrets

Create `apps/web/.dev.vars` and fill in:

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
OPENAI_RESPONSE_MODEL=
SESSION_SECRET=
```

Suggested starting model:
- `OPENAI_RESPONSE_MODEL=gpt-5-mini`

## 4. Supabase Setup

Create a Supabase project and apply the initial migration.

Recommended local flow:

```bash
npx supabase@latest db push
```

Expected early tables:
- `profiles`
- `hn_items`
- `article_fetches`
- `article_extractions`
- `article_summaries`
- `user_story_states`
- `jobs`

Auth only needs to support:
- sign-in
- sign-up
- per-user save and dismiss state

## 5. Cloudflare Setup

Create a Worker for the web app.

Configure secrets in Cloudflare from the same values used in `.dev.vars`.

Expected bindings at first:
- environment variables only

Background processing for the MVP uses:
- a scheduled Worker cron
- the `jobs` table plus `claim_jobs()`
- the internal `/diagnostics` route for manual local runs

## 6. Hacker News Integration

Use the official HN API for discovery:
- `https://hacker-news.firebaseio.com/v0/topstories.json`
- `https://hacker-news.firebaseio.com/v0/item/<id>.json`

Do not scrape the HN homepage for feed discovery.

## 7. Article Fetch And Extraction

For each HN item with a URL:
- fetch the article page
- record fetch status and metadata
- extract readable article text
- store extraction quality

If fetching or extraction fails:
- store failure state
- do not crash the rest of the feed update

## 8. Summary Generation

Use the OpenAI Responses API.

Use Structured Outputs with a strict schema for:
- `summary_bullets`
- `why_it_matters`
- `topic_tags`
- `reading_time_minutes`
- `summary_confidence`
- `risk_flags`
- `extraction_quality`

Store:
- model name
- schema version
- token usage
- timestamps
- source extraction reference

## 9. Local Development

Primary workflow:

```bash
npm run dev
npm run typecheck
npm run build
```

To hydrate the feed locally after the app boots:
- visit `/diagnostics`
- run `Ingest top stories` or `Run full refresh`

## 10. Deployment

Deploy flow:

```bash
npm run build
npm run deploy:web
```

After deploy, run a smoke test against the live site.

## 11. Recommended Next Move After Setup

Implement in this order:
1. schema and migrations
2. HN ingestion
3. article fetch and extraction
4. summary generation
5. feed UI
6. save and dismiss state
7. scheduled refresh
8. smoke test and release checklist
