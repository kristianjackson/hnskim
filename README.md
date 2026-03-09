# HNSkim

HNSkim is a Cloudflare-hosted, Supabase-backed personal news reader that pulls stories from Hacker News, fetches linked articles, extracts readable content, generates AI summaries, and displays the results as scan-friendly cards.

## Current Goal

Build a fast, trustworthy "read less, know enough" layer on top of Hacker News.

## Stack

- Cloudflare Workers
- React Router
- Supabase
- OpenAI API

## Planned App Surfaces

- `/`: summary card feed
- `/auth`: sign-in and sign-up
- `/saved`: saved stories
- `/story/:hnItemId`: story detail view
- optional internal diagnostics route for fetch, extraction, and summarization state

## Core Pipeline

1. Pull story IDs and metadata from the official Hacker News API
2. Fetch outbound article pages
3. Extract readable article text
4. Generate structured summaries
5. Store results and render cards

## Repository Layout

- `apps/web`: web application deployed to Cloudflare Workers
- `docs`: setup, architecture, roadmap, and release notes
- `scripts`: ingestion and maintenance jobs
- `supabase`: schema, migrations, and config

## Commands

These should exist as the project is built:

```bash
npm run dev
npm run typecheck
npm run build
npm run ingest:hn
npm run summarize:stories
npm run smoke:web
```

## Principles

- summary-first, not click-first
- source-grounded, not hallucination-prone
- audit-friendly storage of fetch, extraction, and summary stages
- graceful degradation when article fetching or extraction fails
