// What the Worker tells the outside world about each request: an id, one log line, and, when it is
// configured, Sentry. Worker-only code; workers/app.ts puts it around everything else (spec 10).

import type { Env } from "./env";

/** The line written for each request. `cache` is the `X-Cache` of the answer, `NONE` when it had none. */
export interface RequestLine {
  id: string;
  method: string;
  /** The path only. A query string can hold whatever a visitor typed. */
  path: string;
  status: number;
  cache: string;
  /** Milliseconds from the request arriving to its answer (the headers; a streamed body may take longer). */
  ms: number;
}

/** What a Cloudflare Ray ID looks like (`8a1b2c3d4e5f6a7b-AMS`); anything else is not taken for an id. */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_PATH = 200;

/** The id of a request: Cloudflare's Ray ID when it gave one (so a log line matches Cloudflare's), else random. */
export function requestIdOf(request: Request): string {
  const ray = request.headers.get("CF-Ray");
  return ray !== null && SAFE_ID.test(ray) ? ray : crypto.randomUUID();
}

function pathOf(request: Request): string {
  const { pathname } = new URL(request.url);
  return pathname.length > MAX_PATH ? `${pathname.slice(0, MAX_PATH)}…` : pathname;
}

/** `response` with `name: value`; a copy, if the response's own headers are read-only (a `fetch` answer's are). */
function withHeader(response: Response, name: string, value: string): Response {
  try {
    response.headers.set(name, value);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.set(name, value);
    return copy;
  }
}

/**
 * Runs `handle` and gives its answer an `X-Request-Id`, then writes the one line for the request. A `handle`
 * that throws is logged as a 500 and still throws: the runtime answers it, and Sentry (outside this) sees it.
 */
export async function withRequestLog(request: Request, handle: () => Promise<Response>): Promise<Response> {
  const started = Date.now();
  const id = requestIdOf(request);
  let status = 500;
  let cache = "NONE";
  try {
    const response = await handle();
    status = response.status;
    cache = response.headers.get("X-Cache") ?? "NONE";
    return withHeader(response, "X-Request-Id", id);
  } finally {
    const ms = Date.now() - started;
    const line: RequestLine = { id, method: request.method, path: pathOf(request), status, cache, ms };
    console.log(JSON.stringify(line));
  }
}

/** A failure the Worker got past (a cache that did not answer, a render that threw): one structured line on stderr. */
export function logProblem(what: string, error: unknown, request?: Request): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      level: "error",
      what,
      path: request === undefined ? undefined : pathOf(request),
      error: message.length > 300 ? `${message.slice(0, 300)}…` : message,
    }),
  );
}

type SentryModule = Pick<typeof import("@sentry/cloudflare"), "withSentry">;

/**
 * `handler`, reported to Sentry when the Worker has a `SENTRY_DSN`. Without one nothing of Sentry is loaded or run:
 * the module is imported on the first request that needs it, and each request decides again, so adding the secret
 * to a running Worker is enough. If Sentry cannot be loaded the request is served unmonitored.
 *
 * `load` is a seam for tests.
 */
export function withSentryWhenConfigured(
  handler: ExportedHandler<Env>,
  load: () => Promise<SentryModule> = () => import("@sentry/cloudflare"),
): ExportedHandler<Env> {
  let monitored: Promise<ExportedHandler<Env>> | undefined;

  return {
    async fetch(request, env, ctx) {
      if (!env.SENTRY_DSN?.trim()) return handler.fetch!(request, env, ctx);

      let wrapped: ExportedHandler<Env>;
      try {
        // `withSentry` changes the handler it is given, so it gets a copy.
        monitored ??= load().then(({ withSentry }) =>
          withSentry((e: Env) => ({ dsn: e.SENTRY_DSN, release: e.BUILD_ID }), { fetch: handler.fetch }),
        );
        wrapped = await monitored;
      } catch (error) {
        monitored = undefined;
        logProblem("Sentry could not be loaded", error, request);
        return handler.fetch!(request, env, ctx);
      }
      return wrapped.fetch!(request, env, ctx);
    },
  };
}
