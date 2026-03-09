import type { Route } from "./+types/auth-confirm";
import type { AppEnv } from "../lib/env.server";
import { handleAuthConfirmation } from "../lib/auth-confirm.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as AppEnv;
  return handleAuthConfirmation({ env, request });
}

export default function AuthConfirmRoute() {
  return null;
}
