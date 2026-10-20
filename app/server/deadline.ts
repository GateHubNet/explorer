// The deadline of a card of the live pages (spec 1.6, step 3): a card whose call has not answered by then is `failed`, so that one slow call
// cannot hold the whole page. Worker-only: the loader of the network page and the later live pages use it, and the validators pages read what a
// raced call came to with `partOf` and `asOutage`.

import { loaded, type Loaded } from "./account-view";
import { UpstreamError } from "./upstream";

/** What a card of a live page may take, from the start of its loader: under the data API's own 5 s, so that the page is sure to have its words. */
export const CARD_DEADLINE_MS = 4_500;

/** The call did not answer by its deadline (`byDeadline`). The card's reason is its message. */
export class TooLate extends Error {
  constructor() {
    super("took too long");
    this.name = "TooLate";
  }
}

/**
 * `work`, or a rejection with `TooLate` at the absolute time `at` (milliseconds, as `Date.now()`), whichever comes first. The timer is
 * cleared as soon as `work` settles. `work` itself is not stopped: it runs on to its own end, and what it gives late is dropped.
 */
export function byDeadline<T>(work: Promise<T>, at: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TooLate()), Math.max(0, at - Date.now()));
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * What a card raced with `byDeadline` came to, as `Promise.allSettled` gave it, for a view builder: a call that missed the deadline (`TooLate`) has
 * failed like one the upstream failed. What is neither is a bug, and `loaded` throws it again.
 */
export const partOf = <T>(result: PromiseSettledResult<T>): Loaded<T> =>
  result.status === "rejected" && result.reason instanceof TooLate ? { state: "failed" } : loaded(result);

/**
 * A raced card's failure as `upstreamOutage` reads it, for a page that cannot be drawn without it: a call that missed the deadline is an upstream that
 * did not answer in time (`timeout`, a 503 like the others), not a bug that `upstreamFailure` would throw again as a 500.
 */
export const asOutage = (reason: unknown): unknown => (reason instanceof TooLate ? new UpstreamError("timeout", reason.message, { cause: reason }) : reason);
