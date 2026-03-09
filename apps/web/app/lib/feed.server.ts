import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppEnv } from "./env.server";
import { createSupabaseAdminClient } from "./supabase/admin.server";
import { ingestTopStories } from "./hn.server";

export type FeedStory = {
  id: number;
  title: string;
  sourceDomain: string | null;
  articleUrl: string | null;
  discussionUrl: string;
  score: number;
  comments: number;
  freshness: string;
  publishedFreshness: string | null;
  summaryBullets: string[];
  whyItMatters: string | null;
  badges: string[];
  saved: boolean;
  dismissed: boolean;
  summaryConfidence: "high" | "medium" | "low" | null;
};

export type DiagnosticsSnapshot = {
  itemsCount: number;
  fetchCount: number;
  extractionCount: number;
  summaryCount: number;
  pendingJobsCount: number;
  recentJobs: Array<{
    id: string;
    jobType: string;
    status: string;
    attemptCount: number;
    hnItemId: number | null;
    updatedAt: string;
    lastError: string | null;
  }>;
};

type JobSnapshotRow = {
  id: string;
  job_type: string;
  status: string;
  attempt_count: number;
  hn_item_id: number | null;
  updated_at: string;
  last_error: string | null;
};

type FeedLoaderOptions = {
  viewerId?: string | null;
  limit?: number;
  includeDismissed?: boolean;
};

type ItemRow = {
  id: number;
  title: string;
  url: string | null;
  source_domain: string | null;
  score: number;
  descendants: number;
  topstories_rank: number | null;
  hn_created_at: string;
  text_content: string | null;
};

type SummaryRow = {
  id: string;
  hn_item_id: number;
  article_extraction_id: string;
  summary_bullets: unknown;
  why_it_matters: string | null;
  summary_confidence: "high" | "medium" | "low" | null;
  risk_flags: string[] | null;
  extraction_quality: "good" | "partial" | "poor" | null;
  created_at: string;
};

type ExtractionRow = {
  id: string;
  hn_item_id: number;
  published_at: string | null;
  extraction_quality: "good" | "partial" | "poor";
  risk_flags: string[] | null;
  created_at: string;
};

type FetchRow = {
  id: string;
  hn_item_id: number;
  fetch_status: string;
  response_status: number | null;
  created_at: string;
};

type StateRow = {
  hn_item_id: number;
  saved_at: string | null;
  dismissed_at: string | null;
};

export async function loadFeedStories(
  env: AppEnv,
  options: FeedLoaderOptions = {},
) {
  const admin = createSupabaseAdminClient(env);
  const limit = Math.max(1, Math.min(options.limit ?? 24, 50));

  let { data: items, error } = await admin
    .from("hn_items")
    .select(
      "id, title, url, source_domain, score, descendants, topstories_rank, hn_created_at, text_content",
    )
    .order("topstories_rank", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load feed stories: ${error.message}`);
  }

  if ((items ?? []).length === 0) {
    await ingestTopStories(env, { limit });

    const retry = await admin
      .from("hn_items")
      .select(
        "id, title, url, source_domain, score, descendants, topstories_rank, hn_created_at, text_content",
      )
      .order("topstories_rank", { ascending: true, nullsFirst: false })
      .limit(limit);

    items = retry.data ?? [];
    error = retry.error ?? null;

    if (error) {
      throw new Error(`Failed to load feed stories after bootstrap: ${error.message}`);
    }
  }

  const stories = await hydrateStories(admin, (items ?? []) as ItemRow[], options.viewerId);

  return stories
    .filter((story) => options.includeDismissed || !story.dismissed)
    .slice(0, limit);
}

export async function loadSavedStories(env: AppEnv, viewerId: string) {
  return loadFeedStories(env, {
    viewerId,
    includeDismissed: true,
    limit: 50,
  }).then((stories) => stories.filter((story) => story.saved));
}

export async function loadStoryDetail(
  env: AppEnv,
  hnItemId: number,
  viewerId?: string | null,
) {
  const admin = createSupabaseAdminClient(env);
  const { data: item, error } = await admin
    .from("hn_items")
    .select(
      "id, title, url, source_domain, score, descendants, topstories_rank, hn_created_at, text_content",
    )
    .eq("id", hnItemId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load HN item ${hnItemId}: ${error.message}`);
  }

  if (!item) {
    return null;
  }

  const [story] = await hydrateStories(admin, [item as ItemRow], viewerId);
  return story ?? null;
}

export async function loadDiagnosticsSnapshot(env: AppEnv): Promise<DiagnosticsSnapshot> {
  const admin = createSupabaseAdminClient(env);

  const [itemsCount, fetchCount, extractionCount, summaryCount, pendingJobsResult, recentJobs] =
    await Promise.all([
      getCount(admin, "hn_items"),
      getCount(admin, "article_fetches"),
      getCount(admin, "article_extractions"),
      getCount(admin, "article_summaries"),
      admin
        .from("jobs")
        .select("*", {
          count: "exact",
          head: true,
        })
        .in("status", ["pending", "running"]),
      admin
        .from("jobs")
        .select("id, job_type, status, attempt_count, hn_item_id, updated_at, last_error")
        .order("updated_at", { ascending: false })
        .limit(8),
    ]);

  if (pendingJobsResult.error) {
    throw new Error(`Failed to count pending jobs: ${pendingJobsResult.error.message}`);
  }

  if (recentJobs.error) {
    throw new Error(`Failed to load recent jobs: ${recentJobs.error.message}`);
  }

  return {
    itemsCount,
    fetchCount,
    extractionCount,
    summaryCount,
    pendingJobsCount: pendingJobsResult.count ?? 0,
    recentJobs: ((recentJobs.data ?? []) as JobSnapshotRow[]).map((job) => ({
      id: job.id,
      jobType: job.job_type,
      status: job.status,
      attemptCount: job.attempt_count,
      hnItemId: job.hn_item_id,
      updatedAt: job.updated_at,
      lastError: job.last_error,
    })),
  };
}

async function hydrateStories(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  items: ItemRow[],
  viewerId?: string | null,
) {
  const storyIds = items.map((item) => item.id);

  if (storyIds.length === 0) {
    return [];
  }

  const [summariesResult, extractionsResult, fetchesResult, statesResult] = await Promise.all([
    admin
      .from("article_summaries")
      .select(
        "id, hn_item_id, article_extraction_id, summary_bullets, why_it_matters, summary_confidence, risk_flags, extraction_quality, created_at",
      )
      .in("hn_item_id", storyIds)
      .eq("summary_status", "succeeded")
      .order("created_at", { ascending: false }),
    admin
      .from("article_extractions")
      .select("id, hn_item_id, published_at, extraction_quality, risk_flags, created_at")
      .in("hn_item_id", storyIds)
      .order("created_at", { ascending: false }),
    admin
      .from("article_fetches")
      .select("id, hn_item_id, fetch_status, response_status, created_at")
      .in("hn_item_id", storyIds)
      .order("created_at", { ascending: false }),
    viewerId
      ? admin
          .from("user_story_states")
          .select("hn_item_id, saved_at, dismissed_at")
          .eq("user_id", viewerId)
          .in("hn_item_id", storyIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (summariesResult.error) {
    throw new Error(`Failed to load summaries: ${summariesResult.error.message}`);
  }

  if (extractionsResult.error) {
    throw new Error(`Failed to load extractions: ${extractionsResult.error.message}`);
  }

  if (fetchesResult.error) {
    throw new Error(`Failed to load fetch states: ${fetchesResult.error.message}`);
  }

  if (statesResult.error) {
    throw new Error(`Failed to load user story state: ${statesResult.error.message}`);
  }

  const summaries = (summariesResult.data ?? []) as SummaryRow[];
  const extractions = (extractionsResult.data ?? []) as ExtractionRow[];
  const fetches = (fetchesResult.data ?? []) as FetchRow[];
  const states = (statesResult.data ?? []) as StateRow[];

  const summaryByStory = firstByKey(summaries, "hn_item_id");
  const extractionByStory = firstByKey(extractions, "hn_item_id");
  const extractionById = new Map(extractions.map((extraction) => [extraction.id, extraction]));
  const fetchByStory = firstByKey(fetches, "hn_item_id");
  const stateByStory = firstByKey(states, "hn_item_id");

  return items.map((item) => {
    const summary = summaryByStory.get(item.id);
    const latestExtraction = extractionByStory.get(item.id);
    const summaryExtraction = summary
      ? extractionById.get(summary.article_extraction_id) ?? null
      : null;
    const displayExtraction = summaryExtraction ?? latestExtraction ?? null;
    const latestFetch = fetchByStory.get(item.id);
    const state = stateByStory.get(item.id);
    const hasNewerExtraction = Boolean(
      summary?.article_extraction_id &&
        latestExtraction?.id &&
        latestExtraction.id !== summary.article_extraction_id,
    );
    const summaryBullets = normalizeStringArray(summary?.summary_bullets);

    return {
      id: item.id,
      title: item.title,
      sourceDomain: item.source_domain ?? null,
      articleUrl: item.url ?? null,
      discussionUrl: getDiscussionUrl(item.id),
      score: item.score,
      comments: item.descendants,
      freshness: formatRelativeTime(item.hn_created_at),
      publishedFreshness: displayExtraction?.published_at
        ? formatRelativeTime(displayExtraction.published_at)
        : null,
      summaryBullets:
        summaryBullets ??
        buildPendingBullets({
          hasUrl: Boolean(item.url),
          latestFetchStatus: latestFetch?.fetch_status ?? null,
          textContent: item.text_content ?? null,
        }),
      whyItMatters: summary?.why_it_matters ?? null,
      badges: buildBadges({
        latestFetchStatus: latestFetch?.fetch_status ?? null,
        extractionQuality:
          displayExtraction?.extraction_quality ?? summary?.extraction_quality ?? null,
        summaryConfidence: summary?.summary_confidence ?? null,
        riskFlags: summary
          ? normalizeTextArray(summary.risk_flags)
          : normalizeTextArray(displayExtraction?.risk_flags),
        hasUrl: Boolean(item.url),
        hasSummary: Boolean(summaryBullets),
        hasNewerExtraction,
      }),
      saved: Boolean(state?.saved_at),
      dismissed: Boolean(state?.dismissed_at),
      summaryConfidence: summary?.summary_confidence ?? null,
    } satisfies FeedStory;
  });
}

function buildBadges(args: {
  latestFetchStatus: string | null;
  extractionQuality: string | null;
  summaryConfidence: string | null;
  riskFlags: string[];
  hasUrl: boolean;
  hasSummary: boolean;
  hasNewerExtraction: boolean;
}) {
  const badges = new Set<string>();

  if (!args.hasUrl) {
    badges.add("hn_discussion_only");
  }

  for (const flag of args.riskFlags) {
    badges.add(flag);
  }

  const shouldShowPending =
    args.hasUrl &&
    (args.hasNewerExtraction ||
      (!args.hasSummary &&
        (!args.latestFetchStatus || args.latestFetchStatus === "succeeded")));

  if (shouldShowPending) {
    badges.add("summary_pending");
  }

  if (args.latestFetchStatus && args.latestFetchStatus !== "succeeded") {
    badges.add(args.latestFetchStatus);
  }

  if (args.extractionQuality === "poor") {
    badges.add("extract_failed");
  }

  if (args.summaryConfidence === "low") {
    badges.add("low_confidence");
  }

  return Array.from(badges);
}

function buildPendingBullets(args: {
  hasUrl: boolean;
  latestFetchStatus: string | null;
  textContent: string | null;
}) {
  const textPreview = args.textContent ? buildTextPreview(args.textContent) : null;

  if (!args.hasUrl && textPreview) {
    return [
      textPreview,
      "This Hacker News self-post is shown as a discussion-first card until a richer reader view exists.",
    ];
  }

  if (!args.hasUrl) {
    return [
      "This Hacker News item does not link out to an external article.",
      "The MVP currently treats self-posts as discussion-first cards rather than full article summaries.",
    ];
  }

  if (!args.latestFetchStatus || args.latestFetchStatus === "succeeded") {
    return [
      "Article fetch and extraction have not completed yet.",
      "This card is already usable as a triage signal, but the summary is still pending.",
    ];
  }

  return [
    "The linked article could not yet produce a trustworthy summary.",
    "Use the badges and article/HN links to decide whether the story is still worth opening manually.",
  ];
}

function buildTextPreview(value: string) {
  const plainText = decodeEntities(
    value
      .replace(/<p>/gi, "")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );

  if (!plainText) {
    return "This Hacker News self-post includes body text, but the preview is still being normalized.";
  }

  return `${plainText.slice(0, 220).trim()}${plainText.length > 220 ? "..." : ""}`;
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeTextArray(value: string[] | null | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : null;
}

function firstByKey<T extends Record<string, unknown>>(items: T[], key: keyof T) {
  const result = new Map<T[keyof T], T>();

  for (const item of items) {
    const mapKey = item[key];

    if (!result.has(mapKey)) {
      result.set(mapKey, item);
    }
  }

  return result;
}

function getDiscussionUrl(id: number) {
  return `https://news.ycombinator.com/item?id=${id}`;
}

function formatRelativeTime(value: string) {
  const target = new Date(value).getTime();
  const diffMs = Date.now() - target;
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60_000));

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 48) {
    return `${diffHours}h ago`;
  }

  return `${Math.floor(diffHours / 24)}d ago`;
}

async function getCount(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
) {
  const { count, error } = await admin.from(table).select("*", {
    count: "exact",
    head: true,
  });

  if (error) {
    throw new Error(`Failed to count ${table}: ${error.message}`);
  }

  return count ?? 0;
}
