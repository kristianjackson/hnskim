import { data, Form, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/diagnostics";
import { hasOpenAiEnv, hasSupabaseAdminEnv, hasSupabasePublicEnv, type AppEnv } from "../lib/env.server";
import { loadDiagnosticsSnapshot } from "../lib/feed.server";
import { ingestTopStories } from "../lib/hn.server";
import { processJobBatch, runPipelineRefresh } from "../lib/pipeline.server";
import { getViewer } from "../lib/viewer.server";

type DiagnosticsActionData = {
  error?: string;
  success?: string;
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as AppEnv;
  const { responseHeaders, viewer } = await getViewer({ env, request });
  const hasAdmin = hasSupabaseAdminEnv(env);

  return data(
    {
      hasSupabaseUrl: Boolean(env.SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(env.SUPABASE_ANON_KEY),
      hasSupabaseServiceRoleKey: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
      hasOpenAiKey: hasOpenAiEnv(env),
      hasSessionSecret: Boolean(env.SESSION_SECRET),
      responseModel: env.OPENAI_RESPONSE_MODEL ?? "gpt-5-mini",
      snapshot: hasAdmin ? await loadDiagnosticsSnapshot(env) : null,
      viewer,
    },
    { headers: responseHeaders },
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as AppEnv;

  if (!hasSupabaseAdminEnv(env)) {
    return data<DiagnosticsActionData>(
      {
        error: "Supabase admin bindings are required before diagnostics actions can run.",
      },
      { status: 500 },
    );
  }

  if (hasSupabasePublicEnv(env)) {
    const { responseHeaders, viewer } = await getViewer({ env, request });

    if (!viewer) {
      return redirect(`/auth?next=${encodeURIComponent("/diagnostics")}`, {
        headers: responseHeaders,
      });
    }
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "ingest") {
    const result = await ingestTopStories(env, { limit: 30 });

    return data<DiagnosticsActionData>({
      success: `Ingested ${result.ingestedCount} Hacker News items and queued ${result.queuedFetchJobs} fetch jobs.`,
    });
  }

  if (intent === "jobs") {
    const result = await processJobBatch(env, { batchSize: 10 });

    return data<DiagnosticsActionData>({
      success: `Processed ${result.processed} queued jobs.`,
    });
  }

  if (intent === "refresh") {
    const result = await runPipelineRefresh(env, {
      ingestLimit: 30,
      batchSize: 6,
      maxBatches: 4,
    });

    return data<DiagnosticsActionData>({
      success: `Refresh ingested ${result.ingestedCount} items, queued ${result.queuedFetchJobs} fetch jobs, and processed ${result.processedJobs} jobs.`,
    });
  }

  return data<DiagnosticsActionData>(
    {
      error: "Unknown diagnostics action.",
    },
    { status: 400 },
  );
}

export const meta: Route.MetaFunction = () => [{ title: "HNSkim | Diagnostics" }];

export default function DiagnosticsRoute({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const submittingIntent = navigation.formData?.get("intent");
  const checks = [
    { label: "SUPABASE_URL", ready: loaderData.hasSupabaseUrl },
    { label: "SUPABASE_ANON_KEY", ready: loaderData.hasSupabaseAnonKey },
    { label: "SUPABASE_SERVICE_ROLE_KEY", ready: loaderData.hasSupabaseServiceRoleKey },
    { label: "OPENAI_API_KEY", ready: loaderData.hasOpenAiKey },
    { label: "SESSION_SECRET", ready: loaderData.hasSessionSecret },
  ];

  return (
    <main className="page">
      <section className="route-panel">
        <p className="eyebrow">Internal diagnostics</p>
        <h1 className="panel-title">Environment and pipeline status</h1>
        <p className="panel-copy">
          This surface exists to bootstrap the app, inspect job flow, and manually advance the MVP
          pipeline before cron-based refreshes take over.
        </p>

        {actionData?.error ? <div className="message-banner is-error">{actionData.error}</div> : null}
        {actionData?.success ? (
          <div className="message-banner is-success">{actionData.success}</div>
        ) : null}

        <div className="diagnostics-grid">
          {checks.map((check) => (
            <div className="metric-card" key={check.label}>
              <span className="metric-label">{check.label}</span>
              <strong className={check.ready ? "metric-value is-ready" : "metric-value is-missing"}>
                {check.ready ? "configured" : "missing"}
              </strong>
            </div>
          ))}
          <div className="metric-card">
            <span className="metric-label">OPENAI_RESPONSE_MODEL</span>
            <strong className="metric-value">{loaderData.responseModel}</strong>
          </div>
        </div>
      </section>

      <section className="section-header">
        <div>
          <p className="eyebrow">Pipeline actions</p>
          <h2 className="section-title">Move the queue without leaving the app.</h2>
        </div>
        <p className="section-copy">
          {loaderData.viewer
            ? "Signed-in sessions can trigger ingestion and job processing from here."
            : "Actions require sign-in when Supabase auth is configured."}
        </p>
      </section>

      <section className="action-grid">
        <Form method="post" className="route-panel action-panel">
          <input type="hidden" name="intent" value="ingest" />
          <p className="eyebrow">Step 1</p>
          <h3 className="panel-title action-title">Ingest top stories</h3>
          <p className="panel-copy">
            Pull the latest <code>topstories</code> IDs from Hacker News and enqueue article fetch
            jobs.
          </p>
          <button className="button button-primary" disabled={navigation.state === "submitting"} type="submit">
            {submittingIntent === "ingest" ? "Ingesting..." : "Run ingestion"}
          </button>
        </Form>

        <Form method="post" className="route-panel action-panel">
          <input type="hidden" name="intent" value="jobs" />
          <p className="eyebrow">Step 2-4</p>
          <h3 className="panel-title action-title">Process a job batch</h3>
          <p className="panel-copy">
            Claim queued jobs and advance fetch, extraction, and summary work.
          </p>
          <button className="button button-secondary" disabled={navigation.state === "submitting"} type="submit">
            {submittingIntent === "jobs" ? "Processing..." : "Run jobs"}
          </button>
        </Form>

        <Form method="post" className="route-panel action-panel">
          <input type="hidden" name="intent" value="refresh" />
          <p className="eyebrow">Full refresh</p>
          <h3 className="panel-title action-title">Ingest and process in one pass</h3>
          <p className="panel-copy">
            This is the shortest path to a locally usable feed when cron has not run yet.
          </p>
          <button className="button button-primary" disabled={navigation.state === "submitting"} type="submit">
            {submittingIntent === "refresh" ? "Refreshing..." : "Run full refresh"}
          </button>
        </Form>
      </section>

      {loaderData.snapshot ? (
        <>
          <section className="diagnostics-grid" aria-label="Pipeline counts">
            {[
              ["HN items", loaderData.snapshot.itemsCount],
              ["Fetch rows", loaderData.snapshot.fetchCount],
              ["Extraction rows", loaderData.snapshot.extractionCount],
              ["Summary rows", loaderData.snapshot.summaryCount],
              ["Pending jobs", loaderData.snapshot.pendingJobsCount],
            ].map(([label, value]) => (
              <div className="metric-card" key={label}>
                <span className="metric-label">{label}</span>
                <strong className="metric-value">{value}</strong>
              </div>
            ))}
          </section>

          <section className="route-panel">
            <p className="eyebrow">Recent jobs</p>
            <h2 className="panel-title">Queue state at a glance</h2>
            <div className="job-list">
              {loaderData.snapshot.recentJobs.length > 0 ? (
                loaderData.snapshot.recentJobs.map((job) => (
                  <div className="job-row" key={job.id}>
                    <div>
                      <strong>{job.jobType}</strong>
                      <p className="job-copy">
                        status: {job.status} · attempts: {job.attemptCount}
                        {job.hnItemId ? ` · HN item ${job.hnItemId}` : ""}
                      </p>
                    </div>
                    <div className="job-meta">
                      <span>{formatTimestamp(job.updatedAt)}</span>
                      {job.lastError ? <span className="job-error">{job.lastError}</span> : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="panel-copy">No jobs have been recorded yet.</p>
              )}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
