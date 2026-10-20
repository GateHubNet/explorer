import { createContext, RouterContextProvider } from "react-router";

import { FEATURE_VARS } from "../ui/features";
import type { SubrequestCache } from "./cache-class";
import { createDegradedMark, createSubrequestCache, type DegradedMark } from "./edge-cache";

/**
 * What the Worker is configured with: `vars` and `ratelimits` of wrangler.jsonc, the two secrets
 * (`.dev.vars` locally) and `BUILD_ID`, which vite.config.ts adds to the vars of every build.
 *
 * `VALIDATORS`, `AMM_DATA` and `MARKETS` are the switches (app/ui/features.ts lists them, README "Switches" says what each gates): each is "on"
 * or "off" in every environment of wrangler.jsonc, and the predeploy guard refuses a build where one is anything else.
 */
export interface Env {
  XRPL_DATA_API_URL: string;
  XAHAU_DATA_API_URL: string;
  XRPL_NODE_URL: string;
  XAHAU_NODE_URL: string;
  DATA_API_KEY: string;
  SENTRY_DSN?: string;
  BUILD_ID: string;
  VALIDATORS: "on" | "off";
  AMM_DATA: "on" | "off";
  MARKETS: "on" | "off";
  VISITOR_LIMITER: RateLimit;
}

const SORTED_SWITCHES = [...FEATURE_VARS].sort();

/**
 * What the edge cache keys every page, image and `.data` URL with (`edgeCacheKey` in edge-cache.ts): `BUILD_ID`, a colon, and every
 * switch as `NAME=value`, sorted by name and joined by commas (`3f2a9c1:AMM_DATA=on,MARKETS=on,VALIDATORS=off`). A deploy with another commit or
 * another switch value therefore never serves a copy stored under the old one. The subrequest cache keeps `BUILD_ID` alone: it holds
 * upstream data, which no switch changes. (edge-cache.ts and this file import each other; neither uses the other's exports until a
 * request is served, so the cycle is harmless. Keep it that way.)
 */
export function cacheGeneration(env: Env): string {
  return `${env.BUILD_ID}:${SORTED_SWITCHES.map((name) => `${name}=${env[name]}`).join(",")}`;
}

// `import { env } from "cloudflare:workers"` (the tests use it) is typed with the generated
// `Cloudflare.Env`, which has no secrets and no BUILD_ID; this makes it include them.
type AppEnv = Env;
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
  }
}

// Everything React Router 8 specific about getting the Worker's `env` and `ctx` into loaders is in
// this file: the entry (workers/app.ts) builds the load context with createLoadContext, loaders and
// middleware read it back with getEnv, getExecutionContext and getSubrequestCache.
const workerContext = createContext<{ env: Env; ctx: ExecutionContext; cache: SubrequestCache; degraded: DegradedMark }>();

/**
 * The load context for one request. Pass it to the request handler in workers/app.ts, with the `DegradedMark` the edge cache
 * made for this render (`withEdgeCache` gives it to `render`), so that a loader's `markDegraded` reaches the cache.
 */
export function createLoadContext(
  env: Env,
  ctx: ExecutionContext,
  degraded: DegradedMark = createDegradedMark(),
): RouterContextProvider {
  const context = new RouterContextProvider();
  // One subrequest cache per request, over the data centre's Cache API: every client the request's loaders make
  // shares it, and so does every request there.
  context.set(workerContext, { env, ctx, cache: createSubrequestCache(ctx, env.BUILD_ID), degraded });
  return context;
}

function workerOf(context: unknown) {
  if (context instanceof RouterContextProvider) {
    try {
      return context.get(workerContext);
    } catch {
      // Falls through to the error below.
    }
  }
  throw new Error("The loader context was not made by createLoadContext (workers/app.ts passes it to the request handler).");
}

/** The Worker's bindings, from a loader's or middleware's `context`. */
export function getEnv(context: unknown): Env {
  return workerOf(context).env;
}

/** The request's execution context (`waitUntil`), from a loader's or middleware's `context`. */
export function getExecutionContext(context: unknown): ExecutionContext {
  return workerOf(context).ctx;
}

/**
 * The cache the data API and node clients of this request keep their answers in (`clientsFor` in clients.ts hands it
 * to them), from a loader's or middleware's `context`.
 */
export function getSubrequestCache(context: unknown): SubrequestCache {
  return workerOf(context).cache;
}

/**
 * Says that the page this loader is answering has a part missing (the node did not answer, a section could not be loaded): the
 * edge cache serves it and does not store it, even if the section that failed streams after the header. From a loader's or
 * middleware's `context`; `reason` goes to the log line.
 */
export function markDegraded(context: unknown, reason: string): void {
  workerOf(context).degraded.mark(reason);
}
