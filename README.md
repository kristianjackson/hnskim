# HNSkim

Skim Hacker News without opening twenty tabs.

HNSkim is a personal, summary-first Hacker News reader. It pulls `topstories`, follows the linked article, extracts readable text, generates a grounded AI summary, and presents everything as a card you can scan in a few seconds.

The goal is simple: read less, know enough.

Live app: `https://hnskim-web.kristian-jackson.workers.dev`

## Why It Exists

Hacker News is great at surfacing interesting links, but expensive in attention. HNSkim adds a trustworthy triage layer on top of the feed so you can decide what deserves a click before you leave the page.

## What You Get

- a single-column feed built for fast scrolling
- story cards with title, domain, score, comment count, and freshness
- compact article summaries with visible confidence and failure states
- article and Hacker News discussion links side by side
- save and dismiss state for signed-in users
- scheduled background refresh so the feed keeps moving without manual babysitting

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

## How It Works

1. Pull story IDs and metadata from the official Hacker News API
2. Fetch outbound article pages
3. Extract readable article text
4. Generate structured summaries
5. Store results and render cards

## Local Development

Start here:

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run typecheck
npm run build
npm run deploy:web
npm run smoke:web
```

For environment variables, Supabase setup, and schema bootstrapping, see [docs/setup.md](./docs/setup.md).

## Repo Layout

- `apps/web`: web application deployed to Cloudflare Workers
- `docs`: setup, architecture, roadmap, and release notes
- `scripts`: smoke checks and utility scripts
- `supabase`: schema, migrations, and config

## Principles

- summary-first, not click-first
- source-grounded, not bluff-driven
- audit-friendly storage across fetch, extraction, and summary stages
- graceful degradation when article fetching or extraction fails

## Documentation

- [Setup](./docs/setup.md)
- [Architecture](./docs/architecture.md)
- [Roadmap](./docs/roadmap.md)
