import { redirect } from "react-router";

import type { AppEnv } from "./env.server";
import { getSafeNextPath } from "./auth-redirect";
import { createSupabaseServerClient } from "./supabase/server";
import { getViewer } from "./viewer.server";

type StoryStateIntent = "save" | "dismiss" | "clear";

type HandleStoryStateArgs = {
  env: AppEnv;
  request: Request;
  hnItemId?: number | null;
};

export async function handleStoryStateAction({
  env,
  request,
  hnItemId,
}: HandleStoryStateArgs) {
  const fallbackNext = getSafeNextPath(new URL(request.url).pathname);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "") as StoryStateIntent;
  const next = getSafeNextPath(formData.get("next") ?? fallbackNext);
  const targetHnItemId =
    hnItemId ?? Number.parseInt(String(formData.get("hnItemId") ?? ""), 10);

  if (!Number.isFinite(targetHnItemId)) {
    return redirect(next);
  }

  const { viewer } = await getViewer({ env, request });

  if (!viewer) {
    return redirect(`/auth?next=${encodeURIComponent(next)}`);
  }

  const responseHeaders = new Headers();
  const supabase = createSupabaseServerClient({
    env,
    request,
    responseHeaders,
  });

  if (intent === "clear") {
    const { error } = await supabase
      .from("user_story_states")
      .delete()
      .eq("user_id", viewer.user.id)
      .eq("hn_item_id", targetHnItemId);

    if (error) {
      throw new Error(`Failed to clear story state: ${error.message}`);
    }

    return redirect(next, { headers: responseHeaders });
  }

  const timestamp = new Date().toISOString();
  const payload =
    intent === "dismiss"
      ? {
          user_id: viewer.user.id,
          hn_item_id: targetHnItemId,
          saved_at: null,
          dismissed_at: timestamp,
        }
      : {
          user_id: viewer.user.id,
          hn_item_id: targetHnItemId,
          saved_at: timestamp,
          dismissed_at: null,
        };

  const { error } = await supabase.from("user_story_states").upsert(payload, {
    onConflict: "user_id,hn_item_id",
  });

  if (error) {
    throw new Error(`Failed to update story state: ${error.message}`);
  }

  return redirect(next, { headers: responseHeaders });
}
