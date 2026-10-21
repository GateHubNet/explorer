// What the data API client and the node client have in common: their error type, their deadlines and the way
// they read a Retry-After. Worker-only code.

/** How long a data API request, answer included, may take. */
export const DATA_API_TIMEOUT_MS = 5000;
/**
 * How long the one slow data API request, `analytics/counterparties` of an account, may take (D2 asks for 15 s: 2 to 10 s for the heaviest accounts at 1 Y and All).
 * Too long for a page to await (`streamTimeout` is 5 s), so the page lets a late call finish in the background, under `waitUntil`, and keeps its answer 60 s.
 */
export const ANALYTICS_SLOW_TIMEOUT_MS = 15_000;
/** How long a node request, answer included, may take. */
export const NODE_TIMEOUT_MS = 3000;

export type UpstreamErrorKind =
  /** The thing asked for does not exist (data API 404; node `actNotFound`, `txnNotFound`, `lgrNotFound`). */
  | "not_found"
  /** The request itself was refused as malformed. */
  | "bad_request"
  /** The upstream is limiting us (429); `retryAfter` says for how long, if it did. */
  | "rate_limited"
  /** The upstream failed, or answered something unusable (5xx, a rejected key, a body that is not what it should be). */
  | "server"
  /** No answer within the deadline. */
  | "timeout"
  /** The connection failed. */
  | "network";

/**
 * A failed call to the data API or to a node. Never cached: a `SubrequestCache` stores only what `load` returns. (A call that asks for the
 * failure hold has its error remembered in memory for a few seconds, never in the Cache API: `SubrequestOptions` in cache-class.ts.)
 * Loaders turn it into a 404 page (`not_found`), a stale copy or a 503 page with `Retry-After` (the rest, see spec 10).
 */
export class UpstreamError extends Error {
  readonly kind: UpstreamErrorKind;
  /** The HTTP status of the upstream's answer, when there was one. */
  readonly status?: number;
  /** Seconds the upstream asked us to wait (`Retry-After`). */
  readonly retryAfter?: number;

  constructor(
    kind: UpstreamErrorKind,
    message = `upstream error: ${kind}`,
    details: { status?: number; retryAfter?: number; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "UpstreamError";
    this.kind = kind;
    this.status = details.status;
    this.retryAfter = details.retryAfter;
  }
}

/** The seconds in a `Retry-After` header, when it holds a whole number of seconds (the data API's always does). */
export function retryAfterOf(headers: Headers): number | undefined {
  const value = headers.get("Retry-After")?.trim();
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

/** A short, single-line piece of an upstream's own message, for ours. */
export function clip(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/**
 * Runs `request`, which makes a request and reads its answer, and gives up after `ms` milliseconds with a
 * `timeout` error, aborting the request through its signal. The deadline holds even when the request ignores the
 * signal, and it covers the reading of the body. Anything else that goes wrong outside an `UpstreamError` is a
 * `network` error.
 */
export async function withDeadline<T>(
  ms: number,
  what: string,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Reject first: the abort makes the request fail too, and the caller must hear "timeout", not "aborted".
      reject(new UpstreamError("timeout", `${what} did not answer within ${ms} ms`));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([request(controller.signal), deadline]);
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new UpstreamError("network", `${what} failed: ${clip(reason)}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}
