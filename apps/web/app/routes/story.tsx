import { data } from "react-router";

import type { Route } from "./+types/story";
import { SetupPanel } from "../components/setup-panel";
import { StoryCard } from "../components/story-card";
import { hasSupabaseAdminEnv, type AppEnv } from "../lib/env.server";
import { loadStoryDetail } from "../lib/feed.server";
import { handleStoryStateAction } from "../lib/story-state.server";
import { getViewer } from "../lib/viewer.server";

export const meta: Route.MetaFunction = ({ params }) => [
  { title: `HNSkim | Story ${params.hnItemId}` },
];

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as AppEnv;
  const { responseHeaders, viewer } = await getViewer({ env, request });
  const hnItemId = Number.parseInt(params.hnItemId, 10);

  if (!Number.isFinite(hnItemId)) {
    throw new Response("Story not found", { status: 404 });
  }

  if (!hasSupabaseAdminEnv(env)) {
    return data(
      {
        isConfigured: false,
        nextPath: new URL(request.url).pathname,
        story: null,
      },
      { headers: responseHeaders },
    );
  }

  const story = await loadStoryDetail(env, hnItemId, viewer?.user.id);

  if (!story) {
    throw new Response("Story not found", { status: 404 });
  }

  return data(
    {
      isConfigured: true,
      nextPath: new URL(request.url).pathname,
      story,
    },
    { headers: responseHeaders },
  );
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as AppEnv;
  const hnItemId = Number.parseInt(params.hnItemId, 10);

  return handleStoryStateAction({
    env,
    request,
    hnItemId: Number.isFinite(hnItemId) ? hnItemId : null,
  });
}

export default function StoryRoute({ loaderData }: Route.ComponentProps) {
  if (!loaderData.isConfigured) {
    return (
      <main className="page">
        <SetupPanel
          title="Story detail needs the database-backed pipeline."
          copy="The detail view reads the canonical HN row plus its latest extraction and summary state. Configure Supabase first, then refresh the pipeline."
        />
      </main>
    );
  }

  if (!loaderData.story) {
    return null;
  }

  return (
    <main className="page">
      <section className="section-header">
        <div>
          <p className="eyebrow">Story detail</p>
          <h1 className="section-title">Single-story view for deeper inspection.</h1>
        </div>
        <p className="section-copy">
          This route keeps the same card surface as the feed, but without the surrounding noise.
        </p>
      </section>

      <StoryCard detail story={loaderData.story} nextPath={loaderData.nextPath} />
    </main>
  );
}
