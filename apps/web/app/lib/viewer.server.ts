import type { User } from "@supabase/supabase-js";

import { getPublicEnv, type AppEnv } from "./env.server";
import { createSupabaseServerClient } from "./supabase/server";

export type Viewer = {
  user: {
    id: string;
    email: string | null;
    displayName: string;
  };
  profile: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
};

type ViewerArgs = {
  env: AppEnv;
  request: Request;
};

export async function getViewer({ env, request }: ViewerArgs) {
  const responseHeaders = new Headers();

  if (!getPublicEnv(env).hasSupabase) {
    return {
      responseHeaders,
      viewer: null,
    };
  }

  try {
    const supabase = createSupabaseServerClient({
      env,
      request,
      responseHeaders,
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        responseHeaders,
        viewer: null,
      };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    return {
      responseHeaders,
      viewer: {
        user: {
          id: user.id,
          email: user.email ?? null,
          displayName: getUserDisplayName(user),
        },
        profile: profile
          ? {
              id: profile.id,
              displayName: profile.display_name,
              avatarUrl: profile.avatar_url,
            }
          : null,
      } satisfies Viewer,
    };
  } catch {
    return {
      responseHeaders,
      viewer: null,
    };
  }
}

function getUserDisplayName(user: User) {
  const metadataName = user.user_metadata?.display_name;

  if (typeof metadataName === "string" && metadataName.trim().length > 0) {
    return metadataName.trim();
  }

  if (user.email) {
    return user.email.split("@")[0];
  }

  return "Reader";
}
