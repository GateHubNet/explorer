import { createRequestHandler } from "react-router";

import { withEdgeCache } from "../app/server/edge-cache";
import { createLoadContext, type Env } from "../app/server/env";
import { withEnvironmentHeaders } from "../app/server/environment";
import { withRequestLog, withSentryWhenConfigured } from "../app/server/logging";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

// Outside in: Sentry (only when SENTRY_DSN is set), the request id and log line, the environment's headers (`noindex` in the sandbox), the
// edge cache with the visitor limit, and React Router. The logic is in app/server/edge-cache.ts, app/server/environment.ts and
// app/server/logging.ts. The environment's headers go outside the edge cache, so that a stored copy gets them on the way out and nothing
// stored differs between the environments.
export default withSentryWhenConfigured({
  async fetch(request, env, ctx) {
    return withRequestLog(request, async () =>
      withEnvironmentHeaders(
        // The edge cache says which request to render: the one it was given, or, for a HEAD, the GET of the same URL.
        await withEdgeCache(request, env, ctx, (degraded, toRender) => requestHandler(toRender, createLoadContext(env, ctx, degraded))),
        env,
      ),
    );
  },
} satisfies ExportedHandler<Env>);
