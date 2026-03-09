import { createRequestHandler } from "react-router";

import type { AppEnv } from "../app/lib/env.server";
import { runPipelineRefresh } from "../app/lib/pipeline.server";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runPipelineRefresh(env as AppEnv, {
        ingestLimit: 30,
        batchSize: 6,
        maxBatches: 4,
      }).catch((error) => {
        console.error("Scheduled pipeline refresh failed", error);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
