import type { PublicEnv } from "./public-env";

export type AppEnv = Env;

export function getPublicEnv(env: AppEnv): PublicEnv {
  const supabaseUrl = normalizeEnvValue(env.SUPABASE_URL);
  const supabaseAnonKey = normalizeEnvValue(env.SUPABASE_ANON_KEY);

  return {
    appName: env.APP_NAME ?? "HNSkim",
    supabaseUrl,
    supabaseAnonKey,
    hasSupabase: hasSupabasePublicEnv(env),
  };
}

export function requireEnvBinding<T extends keyof AppEnv>(env: AppEnv, key: T) {
  const value = env[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment binding: ${String(key)}`);
  }

  return value;
}

export function hasSupabasePublicEnv(env: AppEnv) {
  return Boolean(normalizeEnvValue(env.SUPABASE_URL) && normalizeEnvValue(env.SUPABASE_ANON_KEY));
}

export function hasSupabaseAdminEnv(env: AppEnv) {
  return Boolean(
    normalizeEnvValue(env.SUPABASE_URL) && normalizeEnvValue(env.SUPABASE_SERVICE_ROLE_KEY),
  );
}

export function hasOpenAiEnv(env: AppEnv) {
  return Boolean(normalizeEnvValue(env.OPENAI_API_KEY));
}

function normalizeEnvValue(value: string | undefined) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
