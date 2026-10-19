// The deadline of a card of the live pages (spec 1.6, step 3): a card whose call has not answered by then is `failed`, so that one slow call
// cannot hold the whole page. Worker-only, with no import: the loader of the network page and the later live pages use it.

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
