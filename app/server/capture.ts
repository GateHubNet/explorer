// Reporting the errors a loader throws that are bugs (a thrown `Response` or `data()` is an answer, not an error, and
// never gets here): one log line, and Sentry when the Worker has a `SENTRY_DSN`. Worker-only code; entry.server.tsx's
// `handleError` calls it.

import { getEnv, getExecutionContext } from "./env";
import { logProblem } from "./logging";

type SentryModule = { captureException(error: unknown): unknown };

/** `load` is a seam for tests. */
export async function reportLoaderError(
  error: unknown,
  args: { request: Request; context: unknown; params: unknown },
  load: () => Promise<SentryModule> = () => import("@sentry/cloudflare"),
): Promise<void> {
  // A visitor who left before the page was ready is not a bug of ours.
  if (args.request.signal.aborted) return;
  logProblem("loader failed", error, args.request);

  let dsn: string | undefined;
  try {
    dsn = getEnv(args.context).SENTRY_DSN;
  } catch {
    return; // not a context the Worker made: nothing to say about Sentry
  }
  // As in logging.ts: without a DSN nothing of Sentry is loaded.
  if (!dsn?.trim()) return;
  try {
    (await load()).captureException(error);
  } catch (failure) {
    logProblem("Sentry could not report a loader error", failure, args.request);
  }
}

/**
 * React Router's `handleError`, for entry.server.tsx: reports the error without holding up the answer, and keeps the
 * Worker running until the report is done.
 */
export function handleLoaderError(
  error: unknown,
  args: { request: Request; context: unknown; params: unknown },
  load?: () => Promise<SentryModule>,
): void {
  const reporting = reportLoaderError(error, args, load);
  try {
    getExecutionContext(args.context).waitUntil(reporting);
  } catch {
    // No execution context to wait with (not a context the Worker made): the report runs on its own.
  }
}
