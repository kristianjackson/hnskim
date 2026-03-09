Always use the OpenAI developer documentation MCP server if you need to work with the OpenAI API, ChatGPT Apps SDK, Codex, or related docs without me having to explicitly ask.

# Project: HNSkim

HNSkim is a personal news-reading web app that pulls stories from Hacker News, follows outbound article links, extracts readable article text, generates LLM summaries, and presents the results as scan-friendly cards so the user can decide what to read without opening every story.

## Product Goal

Reduce the time spent clicking through Hacker News by showing a trustworthy AI summary beside each story link.

## Stack

Match TMAGen unless there is a strong reason not to:
- Cloudflare Workers
- React Router
- Supabase
- OpenAI API
- same local/dev workflow style as TMAGen
- same deployment style as TMAGen
- same auth/storage conventions where reasonable

The OpenAI, Supabase, and Cloudflare accounts can be shared with TMAGen. Reuse the same patterns for `.dev.vars`, Wrangler secrets, auth handling, and deploy validation.

## Core UX

The feed should display cards with:
- story title
- source domain
- Hacker News score
- Hacker News comment count
- publish freshness if known
- AI-generated summary bullets
- a short `why it matters`
- status badges like `paywalled`, `extract_failed`, `low_confidence`
- links to the article and HN discussion
- per-user actions: `save`, `dismiss`

## Build Requirements

Implement this as four layers:
1. Discovery from the official Hacker News API
2. Fetch and readability-style extraction for outbound article URLs
3. Structured LLM summarization with the OpenAI Responses API
4. Card-based presentation optimized for scanning

## MVP

- ingest top stories from Hacker News
- store HN item metadata
- fetch and extract article text for stories with outbound URLs
- generate summaries
- render a card feed
- allow save and dismiss state per user
- schedule periodic refresh
- prevent unnecessary re-fetch and re-summarization

## Data Model Expectations

Create schema first.

Expected core tables:
- `profiles`
- `hn_items`
- `article_fetches`
- `article_extractions`
- `article_summaries`
- `user_story_states`
- `jobs`

Keep auditability:
- raw fetch separate from extracted content
- extracted content separate from summary
- summary linked to the extraction version it came from

## Feed Sources

Start with:
- `topstories`

Design for later:
- `newstories`
- `beststories`

Use the official HN API:
- `/v0/topstories.json`
- `/v0/item/<id>.json`

## Summary Output Schema

Use strict structured output for:
- `summary_bullets`: string[]
- `why_it_matters`: string
- `topic_tags`: string[]
- `reading_time_minutes`: number
- `summary_confidence`: `"high" | "medium" | "low"`
- `risk_flags`: string[]
- `extraction_quality`: `"good" | "partial" | "poor"`

## Quality Rules

- Never invent facts not supported by extracted text.
- If extraction quality is poor, say so.
- Summaries should be concise and useful on cards.
- Prefer explicit uncertainty over bluffing.
- Always preserve source URL and HN discussion URL.
- Make failure states visible in the UI.

## Background Processing

Preferred flow:
1. scheduled refresh ingests HN items
2. fetch jobs hydrate articles
3. extraction jobs clean text
4. summarization jobs create summaries
5. UI shows partial progress and failure states

## Routes

Expected first routes:
- `/`
- `/auth`
- `/saved`
- `/story/:hnItemId`
- optional internal route for ingestion diagnostics

## Build Order

Implement in this order:
1. project scaffolding with TMAGen-style stack
2. schema and migrations
3. HN ingestion
4. article fetching and extraction
5. summary generation
6. feed UI
7. save and dismiss state
8. scheduled refresh
9. smoke testing and release checklist

## Deliverables Expected Early

Before deep implementation, produce:
- `README.md`
- `docs/setup.md`
- `docs/architecture.md`
- `docs/roadmap.md`

Then proceed with implementation unless blocked.
