import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnvFromWindow } from "../public-env";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    const publicEnv = getPublicEnvFromWindow();

    if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) {
      throw new Error("Supabase public environment is not configured.");
    }

    browserClient = createBrowserClient(
      publicEnv.supabaseUrl,
      publicEnv.supabaseAnonKey,
      {
        auth: {
          flowType: "pkce",
        },
        global: {
          headers: {
            "X-Client-Info": "hnskim/web-browser",
          },
        },
      },
    );
  }

  return browserClient;
}
