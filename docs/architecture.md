# Architecture

## Platform Choices

- Hosting: Cloudflare Workers
- Web framework: React Router
- Database and auth: Supabase
- LLM provider: OpenAI

## Product Surfaces

HNSkim should be treated as three surfaces:

1. Public or personal feed for story cards
2. Authenticated saved-story view
3. Internal diagnostics surface for ingestion, fetch, extraction, and summarization health

## Data Flow

The system should separate these stages clearly:

1. HN discovery
2. article fetch
3. content extraction
4. summary generation
5. feed presentation

Each stage should store its own output so failures are inspectable and reruns are possible without recomputing everything.

## Discovery Layer

Source of truth for feed discovery:
- official Hacker News API

Expected input records:
- HN item id
- title
- url
- score
- descendants/comment count
- by
- time
- type

The discovery layer should update existing stories rather than duplicating them.

## Fetch Layer

For each HN item with an outbound URL:
- fetch article HTML
- record HTTP status, final URL, content type, and fetch timestamp
- hash raw content where useful for dedupe/change detection

This layer should tolerate:
- timeouts
- blocked fetches
- rate limits
- paywalls
- non-HTML content

## Extraction Layer

Take fetched HTML and derive:
- normalized title
- byline if available
- publish date if available
- readable main text
- extraction quality

The key architectural rule is:
- extraction output is not the same thing as raw fetch output

## Summary Layer

Use the OpenAI Responses API to summarize extracted article text.

Use strict structured output, not free-form parsing.

Summary records should store:
- schema version
- model name
- token usage
- timestamps
- confidence
- source extraction id

## UI Layer

The feed is a triage interface, not a reader.

Cards should prioritize:
- source credibility cues
- scannability
- summary usefulness
- visible failure state
- direct links to source and HN discussion

## Data Model

Expected core tables:
- `profiles`
- `hn_items`
- `article_fetches`
- `article_extractions`
- `article_summaries`
- `user_story_states`
- `jobs`

### Notes

- `hn_items` is the canonical story/item layer
- `article_fetches` records raw network attempts
- `article_extractions` records normalized article text
- `article_summaries` records structured model output
- `user_story_states` handles saved and dismissed state
- `jobs` supports retries and async work

## Background Processing

Do not force all processing into user requests.

Preferred flow:
1. scheduled refresh discovers HN items
2. queued jobs fetch articles
3. queued jobs extract content
4. queued jobs summarize
5. UI reads the latest available result

## Access Model

- feed content can be public or auth-light
- save and dismiss state is per-user
- diagnostics should stay restricted
- raw extraction and fetch detail should not dominate the reader-facing UI

## Reliability Principles

- never lose source linkage
- never summarize without storing the source extraction reference
- prefer explicit failure states over silent omission
- avoid repeated summarization of unchanged content
- make the pipeline resumable
