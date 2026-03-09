import { createSupabaseAdminClient } from "./supabase/admin.server";
import type { AppEnv } from "./env.server";
import { enqueueJob } from "./pipeline.server";

export type HnApiItem = {
  id: number;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  dead?: boolean;
  deleted?: boolean;
};

type IngestOptions = {
  limit?: number;
};

const HN_API_BASE = "https://hacker-news.firebaseio.com/v0";
const DEFAULT_TOPSTORY_LIMIT = 30;

export async function ingestTopStories(env: AppEnv, options: IngestOptions = {}) {
  const admin = createSupabaseAdminClient(env);
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_TOPSTORY_LIMIT, 100));
  const topStoryIds = await fetchTopStoryIds(limit);
  const items = await fetchItems(topStoryIds);
  const records = items
    .filter((item): item is HnApiItem => Boolean(item?.id && item.title && item.time))
    .map((item, index) => toHnItemRecord(item, index + 1));

  if (records.length === 0) {
    return {
      ingestedCount: 0,
      queuedFetchJobs: 0,
    };
  }

  const { error } = await admin.from("hn_items").upsert(records, {
    onConflict: "id",
  });

  if (error) {
    throw new Error(`Failed to upsert HN items: ${error.message}`);
  }

  let queuedFetchJobs = 0;

  for (const item of items) {
    if (!item?.id || !item.url || item.deleted || item.dead) {
      continue;
    }

    const inserted = await enqueueJob(admin, {
      jobType: "fetch_article",
      hnItemId: item.id,
      dedupeKey: `fetch:${item.id}`,
      payload: {
        request_url: item.url,
      },
    });

    if (inserted) {
      queuedFetchJobs += 1;
    }
  }

  return {
    ingestedCount: records.length,
    queuedFetchJobs,
  };
}

export async function fetchTopStoryIds(limit = DEFAULT_TOPSTORY_LIMIT) {
  const response = await fetch(`${HN_API_BASE}/topstories.json`);

  if (!response.ok) {
    throw new Error(`Failed to fetch top stories: ${response.status} ${response.statusText}`);
  }

  const ids = (await response.json()) as number[];
  return ids.slice(0, limit);
}

async function fetchItems(ids: number[]) {
  return Promise.all(ids.map((id) => fetchItem(id)));
}

async function fetchItem(id: number) {
  const response = await fetch(`${HN_API_BASE}/item/${id}.json`);

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as HnApiItem | null;
}

function toHnItemRecord(item: HnApiItem, rank: number) {
  const url = normalizeUrl(item.url);

  return {
    id: item.id,
    type: normalizeItemType(item.type),
    byline: item.by ?? null,
    title: item.title ?? url ?? `HN Item ${item.id}`,
    url,
    text_content: item.text ?? null,
    score: item.score ?? 0,
    descendants: item.descendants ?? 0,
    hn_created_at: new Date((item.time ?? 0) * 1000).toISOString(),
    source_domain: url ? getSourceDomain(url) : null,
    feed_sources: ["topstories"],
    topstories_rank: rank,
    is_dead: Boolean(item.dead),
    is_deleted: Boolean(item.deleted),
    raw_payload: item,
    last_seen_at: new Date().toISOString(),
    discovered_at: new Date().toISOString(),
  };
}

function normalizeItemType(value: string | undefined) {
  switch (value) {
    case "job":
    case "comment":
    case "poll":
    case "pollopt":
      return value;
    default:
      return "story";
  }
}

function normalizeUrl(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function getSourceDomain(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
}
