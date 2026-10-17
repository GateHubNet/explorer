import { createContext, RouterContextProvider } from "react-router";

/**
 * What the Worker is configured with: `vars` and `ratelimits` of wrangler.jsonc, the two secrets
 * (`.dev.vars` locally) and `BUILD_ID`, which vite.config.ts adds to the vars of every build.
 */
export interface Env {
  XRPL_DATA_API_URL: string;
  XAHAU_DATA_API_URL: string;
  XRPL_NODE_URL: string;
  XAHAU_NODE_URL: string;
  DATA_API_KEY: string;
  SENTRY_DSN?: string;
  BUILD_ID: string;
  VISITOR_LIMITER: RateLimit;
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
// middleware read it back with getEnv and getExecutionContext.
const workerContext = createContext<{ env: Env; ctx: ExecutionContext }>();

/** The load context for one request. Pass it to the request handler in workers/app.ts. */
export function createLoadContext(env: Env, ctx: ExecutionContext): RouterContextProvider {
  const context = new RouterContextProvider();
  context.set(workerContext, { env, ctx });
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
