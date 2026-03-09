import { data, redirect } from "react-router";

import type { Route } from "./+types/saved";
import { SetupPanel } from "../components/setup-panel";
import { StoryCard } from "../components/story-card";
import { hasSupabaseAdminEnv, type AppEnv } from "../lib/env.server";
import { loadSavedStories } from "../lib/feed.server";
import { handleStoryStateAction } from "../lib/story-state.server";
import { getViewer } from "../lib/viewer.server";

export const meta: Route.MetaFunction = () => [{ title: "HNSkim | Saved" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as AppEnv;
  const { responseHeaders, viewer } = await getViewer({ env, request });

  if (!hasSupabaseAdminEnv(env)) {
    return data(
      {
        isConfigured: false,
        nextPath: new URL(request.url).pathname,
        stories: [],
      },
      { headers: responseHeaders },
    );
  }

  if (!viewer) {
    return redirect(`/auth?next=${encodeURIComponent("/saved")}`, {
      headers: responseHeaders,
    });
  }

  const stories = await loadSavedStories(env, viewer.user.id);

  return data(
    {
      isConfigured: true,
      nextPath: new URL(request.url).pathname,
      stories,
    },
    { headers: responseHeaders },
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as AppEnv;
  return handleStoryStateAction({ env, request });
}

export default function SavedRoute({ loaderData }: Route.ComponentProps) {
  if (!loaderData.isConfigured) {
    return (
      <main className="page page-feed">
        <SetupPanel
          title="Saved stories depend on Supabase auth and storage."
          copy="Apply the initial migration and configure the public and service-role Supabase bindings before using per-user story state."
        />
      </main>
    );
  }

  return (
    <main className="page page-feed">
      <section className="section-header">
        <div>
          <p className="eyebrow">Saved stories</p>
          <h1 className="section-title">Keep the few links worth revisiting.</h1>
        </div>
        <p className="section-copy">
          Saved cards stay grounded in the same pipeline state as the main feed, so low-confidence
          or extraction-failure stories remain visible as such.
        </p>
      </section>

      {loaderData.stories.length > 0 ? (
        <section className="card-grid" aria-label="Saved stories">
          {loaderData.stories.map((story) => (
            <StoryCard key={story.id} story={story} nextPath={loaderData.nextPath} />
          ))}
        </section>
      ) : (
        <section className="route-panel">
          <p className="eyebrow">Nothing saved</p>
          <h2 className="panel-title">Your shortlist is empty.</h2>
          <p className="panel-copy">
            Use the main feed to save stories you want to revisit. Dismissed stories are removed
            from this view automatically.
          </p>
        </section>
      )}
    </main>
  );
}
