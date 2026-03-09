# Roadmap

This file is the active planning reference for HNSkim.

## Current Objective

Build a working MVP that makes Hacker News faster to scan by replacing unnecessary clicks with trustworthy article summaries.

## Phase 1: Foundation

Target outcomes:
- scaffold the app with the TMAGen-style stack
- create initial Supabase schema
- wire auth
- establish local env and deploy flow
- publish setup and architecture docs

## Phase 2: HN Ingestion

Target outcomes:
- ingest top stories from the official HN API
- store canonical item metadata
- support repeated refresh without duplication
- prepare items for downstream fetch jobs

## Phase 3: Article Fetch And Extraction

Target outcomes:
- fetch outbound article pages
- store fetch metadata and failure states
- extract readable article text
- rate extraction quality
- avoid reprocessing unchanged articles

## Phase 4: LLM Summaries

Target outcomes:
- generate structured article summaries
- store schema version, model, and usage
- expose low-confidence and extraction-quality flags
- keep summary output grounded in extracted text

## Phase 5: Feed UI

Target outcomes:
- render card-based story feed
- show HN metadata and article source
- display summary bullets and `why it matters`
- support direct links to article and HN thread
- make the layout fast to scan on desktop and mobile

## Phase 6: Personal Actions

Target outcomes:
- save stories
- dismiss stories
- add a `/saved` view
- preserve per-user state cleanly

## Phase 7: Background Jobs And Refresh

Target outcomes:
- scheduled HN refresh
- async article fetch and summarization
- retries and status tracking
- visible partial-processing states in the UI

## Phase 8: Reliability

Target outcomes:
- smoke test for deployed app flow
- release checklist
- route validation after deploy
- pipeline observability for failures

## Later Backlog

Likely follow-on work:
- comment summarization
- topic filtering
- daily digest email
- semantic search across summarized stories
- custom domain and monitoring polish

## Working Principle

HNSkim should stay:
- summary-first
- source-grounded
- audit-friendly
- cheap enough to run routinely
- honest about uncertainty and extraction failure
