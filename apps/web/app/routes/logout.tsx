import { redirect } from "react-router";

import type { Route } from "./+types/logout";
import type { AppEnv } from "../lib/env.server";
import { hasSupabasePublicEnv } from "../lib/env.server";
import { createSupabaseServerClient } from "../lib/supabase/server";

export async function loader() {
  return redirect("/");
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as AppEnv;

  if (!hasSupabasePublicEnv(env)) {
    return redirect("/");
  }

  const responseHeaders = new Headers();
  const supabase = createSupabaseServerClient({
    env,
    request,
    responseHeaders,
  });

  await supabase.auth.signOut();

  return redirect("/", { headers: responseHeaders });
}

export default function LogoutRoute() {
  return null;
}
