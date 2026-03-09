import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppEnv } from "./env.server";
import { createSupabaseAdminClient } from "./supabase/admin.server";
import { ingestTopStories } from "./hn.server";

type PipelineRefreshOptions = {
  ingestLimit?: number;
  batchSize?: number;
  maxBatches?: number;
};

type ProcessJobBatchOptions = {
  batchSize?: number;
};

type EnqueueJobArgs = {
  jobType: "fetch_article" | "extract_article" | "summarize_article" | "ingest_topstories";
  hnItemId?: number;
  articleFetchId?: string;
  articleExtractionId?: string;
  dedupeKey?: string;
  payload?: Record<string, unknown>;
};

type ClaimedJob = {
  id: string;
  job_type: "fetch_article" | "extract_article" | "summarize_article" | "ingest_topstories";
  hn_item_id: number | null;
  article_fetch_id: string | null;
  article_extraction_id: string | null;
  payload: Record<string, unknown>;
  attempt_count: number;
  lease_token: string | null;
};

type ExtractionResult = {
  title: string | null;
  byline: string | null;
  siteName: string | null;
  publishedAt: string | null;
  excerpt: string | null;
  contentText: string;
  wordCount: number;
  extractionQuality: "good" | "partial" | "poor";
  riskFlags: string[];
  metadata: Record<string, unknown>;
};

const FETCH_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_LENGTH = 1_000_000;
const MAX_EXTRACTED_TEXT_LENGTH = 24_000;
const SUMMARY_SCHEMA_VERSION = "v2";

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary_bullets",
    "why_it_matters",
    "topic_tags",
    "reading_time_minutes",
    "summary_confidence",
    "risk_flags",
    "extraction_quality",
  ],
  properties: {
    summary_bullets: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: { type: "string" },
    },
    why_it_matters: { type: "string" },
    topic_tags: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
    },
    reading_time_minutes: {
      type: "integer",
      minimum: 1,
      maximum: 60,
    },
    summary_confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    risk_flags: {
      type: "array",
      items: { type: "string" },
    },
    extraction_quality: {
      type: "string",
      enum: ["good", "partial", "poor"],
    },
  },
} as const;

export async function runPipelineRefresh(
  env: AppEnv,
  options: PipelineRefreshOptions = {},
) {
  const ingestResult = await ingestTopStories(env, {
    limit: options.ingestLimit ?? 30,
  });

  let processedJobs = 0;
  const maxBatches = Math.max(1, options.maxBatches ?? 4);

  for (let index = 0; index < maxBatches; index += 1) {
    const batch = await processJobBatch(env, {
      batchSize: options.batchSize ?? 5,
    });

    processedJobs += batch.processed;

    if (batch.processed === 0) {
      break;
    }
  }

  return {
    ...ingestResult,
    processedJobs,
  };
}

export async function processJobBatch(
  env: AppEnv,
  options: ProcessJobBatchOptions = {},
) {
  const admin = createSupabaseAdminClient(env);
  const { data, error } = await admin.rpc("claim_jobs", {
    requested_types: null,
    batch_size: Math.max(1, options.batchSize ?? 5),
    lease_seconds: 300,
  });

  if (error) {
    throw new Error(`Failed to claim jobs: ${error.message}`);
  }

  const jobs = (data ?? []) as ClaimedJob[];

  for (const job of jobs) {
    try {
      switch (job.job_type) {
        case "fetch_article":
          await processFetchJob(admin, env, job);
          break;
        case "extract_article":
          await processExtractJob(admin, env, job);
          break;
        case "summarize_article":
          await processSummarizeJob(admin, env, job);
          break;
        case "ingest_topstories":
          await ingestTopStories(env);
          break;
      }

      await markJobSucceeded(admin, job);
    } catch (error) {
      await markJobFailed(admin, job, error);
    }
  }

  return {
    processed: jobs.length,
  };
}

export async function enqueueJob(admin: SupabaseClient, args: EnqueueJobArgs) {
  const { error } = await admin.from("jobs").insert({
    job_type: args.jobType,
    hn_item_id: args.hnItemId ?? null,
    article_fetch_id: args.articleFetchId ?? null,
    article_extraction_id: args.articleExtractionId ?? null,
    dedupe_key: args.dedupeKey ?? null,
    payload: args.payload ?? {},
  });

  if (!error) {
    return true;
  }

  if (error.code === "23505") {
    return false;
  }

  throw new Error(`Failed to enqueue ${args.jobType}: ${error.message}`);
}

async function processFetchJob(admin: SupabaseClient, env: AppEnv, job: ClaimedJob) {
  if (!job.hn_item_id) {
    return;
  }

  const { data: item, error: itemError } = await admin
    .from("hn_items")
    .select("id, url, is_deleted, is_dead")
    .eq("id", job.hn_item_id)
    .single();

  if (itemError) {
    throw new Error(`Failed to load HN item ${job.hn_item_id}: ${itemError.message}`);
  }

  if (!item?.url || item.is_deleted || item.is_dead) {
    return;
  }

  const { data: latestFetch } = await admin
    .from("article_fetches")
    .select("id, fetch_status, created_at")
    .eq("hn_item_id", job.hn_item_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    latestFetch?.id &&
    latestFetch.fetch_status === "succeeded" &&
    Date.now() - new Date(latestFetch.created_at).getTime() < FETCH_TTL_MS
  ) {
    await enqueueJob(admin, {
      jobType: "extract_article",
      hnItemId: job.hn_item_id,
      articleFetchId: latestFetch.id,
      dedupeKey: `extract:${latestFetch.id}`,
    });
    return;
  }

  const startedAt = new Date().toISOString();

  try {
    const response = await fetch(item.url, {
      headers: {
        "User-Agent": "HNSkimBot/0.1 (+https://hnskim.local)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });

    const finalUrl = response.url || item.url;
    const contentType = response.headers.get("content-type");
    const contentLength = parseInteger(response.headers.get("content-length"));
    const contentLanguage = response.headers.get("content-language");
    const isHtml = !contentType || contentType.includes("html");
    const bodyHtml = isHtml ? truncate(await response.text(), MAX_HTML_LENGTH) : null;
    const fetchStatus = determineFetchStatus(response.status, isHtml, bodyHtml);

    const { data: fetchRow, error: insertError } = await admin
      .from("article_fetches")
      .insert({
        hn_item_id: job.hn_item_id,
        request_url: item.url,
        final_url: finalUrl,
        fetch_status: fetchStatus,
        response_status: response.status,
        content_type: contentType,
        content_language: contentLanguage,
        content_length_bytes: contentLength,
        body_html: bodyHtml,
        body_sha256: bodyHtml ? await sha256(bodyHtml) : null,
        http_headers: headersToRecord(response.headers),
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      })
      .select("id, fetch_status")
      .single();

    if (insertError) {
      throw new Error(`Failed to insert fetch row: ${insertError.message}`);
    }

    if (fetchRow.fetch_status === "succeeded") {
      await enqueueJob(admin, {
        jobType: "extract_article",
        hnItemId: job.hn_item_id,
        articleFetchId: fetchRow.id,
        dedupeKey: `extract:${fetchRow.id}`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetch error";
    const fetchStatus = message.includes("timed out") ? "timeout" : "network_error";

    const { error: insertError } = await admin.from("article_fetches").insert({
      hn_item_id: job.hn_item_id,
      request_url: item.url,
      fetch_status: fetchStatus,
      error_message: message,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    });

    if (insertError) {
      throw new Error(`Fetch failed and could not be recorded: ${insertError.message}`);
    }
  }
}

async function processExtractJob(admin: SupabaseClient, _env: AppEnv, job: ClaimedJob) {
  if (!job.article_fetch_id || !job.hn_item_id) {
    return;
  }

  const { data: existingExtraction } = await admin
    .from("article_extractions")
    .select("id")
    .eq("article_fetch_id", job.article_fetch_id)
    .maybeSingle();

  if (existingExtraction?.id) {
    await enqueueJob(admin, {
      jobType: "summarize_article",
      hnItemId: job.hn_item_id,
      articleExtractionId: existingExtraction.id,
      dedupeKey: `summarize:${existingExtraction.id}:${SUMMARY_SCHEMA_VERSION}`,
    });
    return;
  }

  const { data: fetchRow, error: fetchError } = await admin
    .from("article_fetches")
    .select("id, final_url, body_html, fetch_status")
    .eq("id", job.article_fetch_id)
    .single();

  if (fetchError) {
    throw new Error(`Failed to load fetch row ${job.article_fetch_id}: ${fetchError.message}`);
  }

  if (fetchRow.fetch_status !== "succeeded" || !fetchRow.body_html) {
    return;
  }

  const extraction = extractArticle(fetchRow.body_html, fetchRow.final_url);

  const { data: extractionRow, error: insertError } = await admin
    .from("article_extractions")
    .insert({
      hn_item_id: job.hn_item_id,
      article_fetch_id: job.article_fetch_id,
      extractor_name: "hnskim-heuristic-readability",
      extractor_version: "v1",
      title: extraction.title,
      byline: extraction.byline,
      site_name: extraction.siteName,
      published_at: extraction.publishedAt,
      excerpt: extraction.excerpt,
      content_text: extraction.contentText,
      word_count: extraction.wordCount,
      content_sha256: await sha256(extraction.contentText),
      extraction_quality: extraction.extractionQuality,
      risk_flags: extraction.riskFlags,
      metadata: extraction.metadata,
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`Failed to insert extraction row: ${insertError.message}`);
  }

  await enqueueJob(admin, {
    jobType: "summarize_article",
    hnItemId: job.hn_item_id,
    articleExtractionId: extractionRow.id,
    dedupeKey: `summarize:${extractionRow.id}:${SUMMARY_SCHEMA_VERSION}`,
  });
}

async function processSummarizeJob(admin: SupabaseClient, env: AppEnv, job: ClaimedJob) {
  if (!job.article_extraction_id || !job.hn_item_id) {
    return;
  }

  const { data: existingSummary } = await admin
    .from("article_summaries")
    .select("id")
    .eq("article_extraction_id", job.article_extraction_id)
    .eq("summary_schema_version", SUMMARY_SCHEMA_VERSION)
    .eq("summary_status", "succeeded")
    .maybeSingle();

  if (existingSummary?.id) {
    return;
  }

  const { data: extraction, error: extractionError } = await admin
    .from("article_extractions")
    .select(
      "id, title, content_text, excerpt, word_count, content_sha256, extraction_quality, risk_flags",
    )
    .eq("id", job.article_extraction_id)
    .single();

  if (extractionError) {
    throw new Error(`Failed to load extraction ${job.article_extraction_id}: ${extractionError.message}`);
  }

  const { data: item } = await admin
    .from("hn_items")
    .select("id, title, url, source_domain")
    .eq("id", job.hn_item_id)
    .single();

  const reusedSummary = await findReusableSummary(admin, {
    hnItemId: job.hn_item_id,
    extractionId: job.article_extraction_id,
    contentSha256: extraction.content_sha256 ?? null,
  });

  if (reusedSummary) {
    const { error: insertError } = await admin.from("article_summaries").insert({
      hn_item_id: job.hn_item_id,
      article_extraction_id: job.article_extraction_id,
      summary_status: "succeeded",
      summary_schema_version: SUMMARY_SCHEMA_VERSION,
      model_name: reusedSummary.model_name,
      prompt_version: reusedSummary.prompt_version,
      summary_bullets: reusedSummary.summary_bullets,
      why_it_matters: reusedSummary.why_it_matters,
      topic_tags: reusedSummary.topic_tags,
      reading_time_minutes: reusedSummary.reading_time_minutes,
      summary_confidence: reusedSummary.summary_confidence,
      risk_flags: reusedSummary.risk_flags,
      extraction_quality: reusedSummary.extraction_quality,
      token_usage: reusedSummary.token_usage,
      response_metadata: {
        reused_from_summary_id: reusedSummary.id,
        reused_from_extraction_id: reusedSummary.article_extraction_id,
      },
    });

    if (insertError) {
      throw new Error(`Failed to insert reused summary row: ${insertError.message}`);
    }

    return;
  }

  if (!env.OPENAI_API_KEY || extraction.word_count < 80) {
    await insertFallbackSummary(admin, {
      hnItemId: job.hn_item_id,
      extractionId: job.article_extraction_id,
      title: item?.title ?? extraction.title ?? "Article",
      extractionQuality: extraction.extraction_quality,
      riskFlags: extraction.risk_flags ?? [],
      reason: !env.OPENAI_API_KEY
        ? "OpenAI API key is not configured."
        : "Readable article text was too limited for a reliable summary.",
    });
    return;
  }

  const response = await createStructuredSummary(env, {
    itemTitle: item?.title ?? extraction.title ?? "Untitled article",
    sourceDomain: item?.source_domain ?? null,
    articleUrl: item?.url ?? null,
    extractionTitle: extraction.title ?? null,
    excerpt: extraction.excerpt ?? null,
    contentText: extraction.content_text,
    extractionQuality: extraction.extraction_quality,
    riskFlags: extraction.risk_flags ?? [],
  });

  const { error: insertError } = await admin.from("article_summaries").insert({
    hn_item_id: job.hn_item_id,
    article_extraction_id: job.article_extraction_id,
    summary_status: "succeeded",
    summary_schema_version: SUMMARY_SCHEMA_VERSION,
    model_name: response.model,
    response_id: response.responseId,
    prompt_version: "summary-v1",
    summary_bullets: response.summary.summary_bullets,
    why_it_matters: response.summary.why_it_matters,
    topic_tags: response.summary.topic_tags,
    reading_time_minutes: response.summary.reading_time_minutes,
    summary_confidence: response.summary.summary_confidence,
    risk_flags: response.summary.risk_flags,
    extraction_quality: response.summary.extraction_quality,
    token_usage: response.usage,
    response_metadata: response.metadata,
  });

  if (insertError) {
    throw new Error(`Failed to insert summary row: ${insertError.message}`);
  }
}

async function findReusableSummary(
  admin: SupabaseClient,
  args: {
    hnItemId: number;
    extractionId: string;
    contentSha256: string | null;
  },
) {
  if (!args.contentSha256) {
    return null;
  }

  const { data: matchingExtractions, error: extractionError } = await admin
    .from("article_extractions")
    .select("id")
    .eq("hn_item_id", args.hnItemId)
    .eq("content_sha256", args.contentSha256)
    .neq("id", args.extractionId);

  if (extractionError) {
    throw new Error(`Failed to find matching extraction: ${extractionError.message}`);
  }

  const extractionIds = (matchingExtractions ?? []).map((extraction) => extraction.id);

  if (extractionIds.length === 0) {
    return null;
  }

  const { data: summary, error: summaryError } = await admin
    .from("article_summaries")
    .select(
      "id, article_extraction_id, model_name, prompt_version, summary_bullets, why_it_matters, topic_tags, reading_time_minutes, summary_confidence, risk_flags, extraction_quality, token_usage",
    )
    .in("article_extraction_id", extractionIds)
    .eq("summary_status", "succeeded")
    .eq("summary_schema_version", SUMMARY_SCHEMA_VERSION)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (summaryError) {
    throw new Error(`Failed to find reusable summary: ${summaryError.message}`);
  }

  return summary;
}

async function createStructuredSummary(
  env: AppEnv,
  args: {
    itemTitle: string;
    sourceDomain: string | null;
    articleUrl: string | null;
    extractionTitle: string | null;
    excerpt: string | null;
    contentText: string;
    extractionQuality: "good" | "partial" | "poor";
    riskFlags: string[];
  },
) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_RESPONSE_MODEL ?? "gpt-5-mini",
      store: false,
      reasoning: {
        effort: "minimal",
      },
      instructions:
        "You summarize Hacker News-linked articles for skim reading. Only use information present in the supplied extraction. Never invent facts. If extraction quality is partial or poor, say so explicitly inside the structured fields. Keep outputs concise and card-friendly. The full on-card summary must fit in one short paragraph: use 2 or 3 short summary_bullets, each exactly one short sentence, and keep why_it_matters to one short sentence. The combined result should read as 4 sentences or fewer.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `HN title: ${args.itemTitle}`,
                `Source domain: ${args.sourceDomain ?? "unknown"}`,
                `Article URL: ${args.articleUrl ?? "unknown"}`,
                `Extracted title: ${args.extractionTitle ?? "unknown"}`,
                `Extraction quality: ${args.extractionQuality}`,
                `Existing risk flags: ${args.riskFlags.join(", ") || "none"}`,
                `Excerpt: ${args.excerpt ?? "none"}`,
                "",
                "Return JSON matching the schema.",
                "",
                args.contentText,
              ].join("\n"),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "hnskim_article_summary",
          strict: true,
          schema: SUMMARY_SCHEMA,
        },
      },
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const errorPayload = payload.error;
    const errorMessage =
      errorPayload && typeof errorPayload === "object" && "message" in errorPayload
        ? errorPayload.message
        : null;

    throw new Error(
      typeof errorMessage === "string"
        ? errorMessage
        : "OpenAI Responses API request failed.",
    );
  }

  const outputText = extractResponseText(payload);

  if (!outputText) {
    throw new Error("OpenAI response did not include structured text output.");
  }

  let summary: Record<string, unknown>;

  try {
    summary = JSON.parse(outputText) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `OpenAI response returned invalid JSON: ${
        error instanceof Error ? error.message : "parse error"
      }`,
    );
  }

  return {
    responseId: payload.id as string,
    model: (payload.model as string) ?? (env.OPENAI_RESPONSE_MODEL ?? "gpt-5-mini"),
    usage: payload.usage ?? {},
    metadata: {
      status: payload.status ?? null,
      incomplete_details: payload.incomplete_details ?? null,
    },
    summary: summary as {
      summary_bullets: string[];
      why_it_matters: string;
      topic_tags: string[];
      reading_time_minutes: number;
      summary_confidence: "high" | "medium" | "low";
      risk_flags: string[];
      extraction_quality: "good" | "partial" | "poor";
    },
  };
}

async function insertFallbackSummary(
  admin: SupabaseClient,
  args: {
    hnItemId: number;
    extractionId: string;
    title: string;
    extractionQuality: "good" | "partial" | "poor";
    riskFlags: string[];
    reason: string;
  },
) {
  const { error } = await admin.from("article_summaries").insert({
    hn_item_id: args.hnItemId,
    article_extraction_id: args.extractionId,
    summary_status: "succeeded",
    summary_schema_version: SUMMARY_SCHEMA_VERSION,
    model_name: "deterministic-fallback",
    prompt_version: "fallback-v1",
    summary_bullets: [
      `Readable extraction was insufficient for a trustworthy AI summary of "${args.title}".`,
      args.reason,
    ],
    why_it_matters:
      "This card still signals that the link may matter, but the source needs manual review because extraction quality was limited.",
    topic_tags: [],
    reading_time_minutes: 1,
    summary_confidence: "low",
    risk_flags: Array.from(new Set([...args.riskFlags, "low_confidence"])),
    extraction_quality: args.extractionQuality,
    token_usage: {},
    response_metadata: {
      fallback: true,
      reason: args.reason,
    },
  });

  if (error && error.code !== "23505") {
    throw new Error(`Failed to insert fallback summary: ${error.message}`);
  }
}

async function markJobSucceeded(admin: SupabaseClient, job: ClaimedJob) {
  const { error } = await admin
    .from("jobs")
    .update({
      status: "succeeded",
      leased_until: null,
      lease_token: null,
      finished_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", job.id)
    .eq("lease_token", job.lease_token);

  if (error) {
    throw new Error(`Failed to mark job ${job.id} succeeded: ${error.message}`);
  }
}

async function markJobFailed(admin: SupabaseClient, job: ClaimedJob, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown job failure";
  const nextStatus = job.attempt_count >= 5 ? "failed" : "pending";
  const nextAvailableAt = new Date(Date.now() + Math.min(job.attempt_count, 5) * 60_000).toISOString();

  const { error: updateError } = await admin
    .from("jobs")
    .update({
      status: nextStatus,
      leased_until: null,
      lease_token: null,
      finished_at: nextStatus === "failed" ? new Date().toISOString() : null,
      last_error: message,
      available_at: nextStatus === "pending" ? nextAvailableAt : new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("lease_token", job.lease_token);

  if (updateError) {
    throw new Error(`Failed to mark job ${job.id} failed: ${updateError.message}`);
  }
}

function extractArticle(html: string, finalUrl: string | null): ExtractionResult {
  const title = firstNonEmpty(
    findMetaContent(html, "property", "og:title"),
    findMetaContent(html, "name", "twitter:title"),
    findTagText(html, "title"),
  );
  const byline = firstNonEmpty(
    findMetaContent(html, "name", "author"),
    findMetaContent(html, "property", "article:author"),
  );
  const siteName = firstNonEmpty(
    findMetaContent(html, "property", "og:site_name"),
    finalUrl ? safeHostname(finalUrl) : null,
  );
  const publishedAt = normalizeDate(
    firstNonEmpty(
      findMetaContent(html, "property", "article:published_time"),
      findMetaContent(html, "name", "pubdate"),
      findTimeDatetime(html),
    ),
  );

  const paywallDetected = /subscribe|sign in to continue|log in to continue|membership required|subscriber-only/i.test(html);
  const articleChunk = pickPrimaryContent(html);
  const contentText = truncate(cleanHtmlToText(articleChunk), MAX_EXTRACTED_TEXT_LENGTH);
  const wordCount = countWords(contentText);
  const excerpt = contentText.length > 0 ? `${contentText.slice(0, 220).trim()}${contentText.length > 220 ? "..." : ""}` : null;
  const extractionQuality =
    wordCount >= 400 ? "good" : wordCount >= 120 ? "partial" : "poor";
  const riskFlags = [];

  if (paywallDetected) {
    riskFlags.push("paywalled");
  }

  if (wordCount < 80) {
    riskFlags.push("extract_failed");
  }

  if (extractionQuality !== "good") {
    riskFlags.push("low_confidence");
  }

  return {
    title,
    byline,
    siteName,
    publishedAt,
    excerpt,
    contentText,
    wordCount,
    extractionQuality,
    riskFlags: Array.from(new Set(riskFlags)),
    metadata: {
      canonical_url: firstNonEmpty(findCanonicalUrl(html), finalUrl),
      paywall_detected: paywallDetected,
    },
  };
}

function pickPrimaryContent(html: string) {
  const article = findLongestTagContents(html, "article");
  const main = findLongestTagContents(html, "main");
  const body = findLongestTagContents(html, "body");

  return firstNonEmpty(article, main, body, html) ?? html;
}

function cleanHtmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<(nav|footer|header|aside|form|button|svg|figure|picture|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/section|\/article|\/li|\/h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n /g, "\n")
      .trim(),
  );
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
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function findMetaContent(html: string, attribute: "name" | "property", value: string) {
  const pattern = new RegExp(
    `<meta[^>]+${attribute}=["']${escapeRegex(value)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  return matchGroup(html, pattern, 1);
}

function findCanonicalUrl(html: string) {
  return matchGroup(
    html,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    1,
  );
}

function findTimeDatetime(html: string) {
  return matchGroup(html, /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i, 1);
}

function findTagText(html: string, tag: string) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(html);
  return match?.[1] ? cleanHtmlToText(match[1]) : null;
}

function findLongestTagContents(html: string, tag: string) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let longest: string | null = null;

  for (const match of html.matchAll(regex)) {
    const candidate = match[1];

    if (!longest || candidate.length > longest.length) {
      longest = candidate;
    }
  }

  return longest;
}

function determineFetchStatus(status: number, isHtml: boolean, bodyHtml: string | null) {
  if (status >= 200 && status < 300 && isHtml) {
    if (bodyHtml && /captcha|verify you are human/i.test(bodyHtml)) {
      return "blocked";
    }

    return "succeeded";
  }

  if (status === 401 || status === 403) {
    return "blocked";
  }

  if (!isHtml) {
    return "non_html";
  }

  return "http_error";
}

function headersToRecord(headers: Headers) {
  return Object.fromEntries(headers.entries());
}

function extractResponseText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];

  for (const item of output) {
    if (!item || typeof item !== "object" || (item as { type?: string }).type !== "message") {
      continue;
    }

    const content = Array.isArray((item as { content?: unknown[] }).content)
      ? (item as { content: Array<Record<string, unknown>> }).content
      : [];

    for (const part of content) {
      if (part.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
    }
  }

  return null;
}

function firstNonEmpty<T>(...values: Array<T | null | undefined | "">) {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();

      if (trimmed.length > 0) {
        return trimmed as T;
      }
    } else if (value !== null && value !== undefined) {
      return value;
    }
  }

  return null;
}

function matchGroup(text: string, pattern: RegExp, index: number) {
  const match = pattern.exec(text);
  return match?.[index] ?? null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseInteger(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function countWords(text: string) {
  return text.length === 0 ? 0 : text.trim().split(/\s+/).length;
}

function safeHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function sha256(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
