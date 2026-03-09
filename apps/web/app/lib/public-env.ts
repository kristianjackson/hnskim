export type PublicEnv = {
  appName: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  hasSupabase: boolean;
};

declare global {
  interface Window {
    __HNSKIM_ENV__?: PublicEnv;
  }
}

export function serializePublicEnvScript(publicEnv: PublicEnv) {
  return `window.__HNSKIM_ENV__ = ${JSON.stringify(publicEnv)};`;
}

export function getPublicEnvFromWindow() {
  if (typeof window === "undefined" || !window.__HNSKIM_ENV__) {
    throw new Error("HNSkim public environment is not available in the browser runtime.");
  }

  return window.__HNSKIM_ENV__;
}
