import { data, Link } from "react-router";

import type { Route } from "./+types/home";
import { SetupPanel } from "../components/setup-panel";
import { StoryCard } from "../components/story-card";
import { hasSupabaseAdminEnv, type AppEnv } from "../lib/env.server";
import { loadFeedStories } from "../lib/feed.server";
import { processJobBatch } from "../lib/pipeline.server";
import { handleStoryStateAction } from "../lib/story-state.server";
import { getViewer } from "../lib/viewer.server";

export const meta: Route.MetaFunction = () => [{ title: "HNSkim | Feed" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as AppEnv;
  const { responseHeaders, viewer } = await getViewer({ env, request });
  const isConfigured = hasSupabaseAdminEnv(env);

  if (!isConfigured) {
    return data(
      {
        isConfigured,
        nextPath: new URL(request.url).pathname,
        stories: [],
        viewer,
      },
      { headers: responseHeaders },
    );
  }

  const stories = await loadFeedStories(env, {
    viewerId: viewer?.user.id,
    limit: 24,
  });

  context.cloudflare.ctx.waitUntil(
    processJobBatch(env, { batchSize: 4 }).catch((error) => {
      console.error("Home route background job batch failed", error);
    }),
  );

  return data(
    {
      isConfigured,
      nextPath: new URL(request.url).pathname,
      stories,
      viewer,
    },
    { headers: responseHeaders },
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as AppEnv;
  return handleStoryStateAction({ env, request });
}

export default function HomeRoute({ loaderData }: Route.ComponentProps) {
  if (!loaderData.isConfigured) {
    return (
      <main className="page">
        <SetupPanel
          title="Configure Supabase before the feed can hydrate."
          copy="The feed reads from the database-backed ingestion pipeline. Add the Supabase bindings and apply the initial migration before expecting live Hacker News cards here."
        />
      </main>
    );
  }

  return (
    <main className="page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Top stories</p>
          <h1 className="hero-title">
            {loaderData.viewer
              ? "Read the signal before the click."
              : "Skim the front page without opening twenty tabs."}
          </h1>
          <p className="hero-text">
            HNSkim pulls top Hacker News stories, follows the linked article, extracts the readable
            text, and shows a compact grounded summary next to the metadata that actually matters
            when deciding whether to open the link.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/diagnostics">
              Run the pipeline
            </Link>
            <Link className="button button-secondary" to="/saved">
              Open saved queue
            </Link>
          </div>
        </div>
        <aside className="hero-aside">
          <p className="eyebrow">Field guide</p>
          <h2 className="aside-title">Every card tells you whether the system trusts itself.</h2>
          <ul className="feature-list">
            <li>
              <code>summary_pending</code> means the article is still moving through fetch,
              extraction, or summary generation.
            </li>
            <li>
              <code>extract_failed</code> and <code>low_confidence</code> are product features,
              not hidden errors.
            </li>
            <li>Self-posts stay visible even when there is no outbound article to summarize.</li>
          </ul>
        </aside>
      </section>

      <section className="section-header">
        <div>
          <p className="eyebrow">Live feed</p>
          <h2 className="section-title">Open fewer links. Miss less.</h2>
        </div>
        <p className="section-copy">
          {loaderData.viewer
            ? "Save the few stories worth revisiting and dismiss the rest."
            : "Guest mode still shows the feed and pipeline state. Save and dismiss will route through auth."}
        </p>
      </section>

      {loaderData.stories.length > 0 ? (
        <section className="card-grid" aria-label="Hacker News stories">
          {loaderData.stories.map((story) => (
            <StoryCard key={story.id} story={story} nextPath={loaderData.nextPath} />
          ))}
        </section>
      ) : (
        <section className="route-panel">
          <p className="eyebrow">No stories yet</p>
          <h2 className="panel-title">The feed is empty right now.</h2>
          <p className="panel-copy">
            The first ingestion run has not written any Hacker News items yet. Open diagnostics and
            run a manual refresh, or wait for the scheduled worker to do the first pass.
          </p>
        </section>
      )}
    </main>
  );
}
