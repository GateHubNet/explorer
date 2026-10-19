// What a page that is on screen hands back when its data cannot be loaded again, and how many refreshes in a row did not work
// (README, "Live updates").
//
// React Router drops a route's data when its loader throws, and shows the nearest error boundary in its place. For a visitor who navigates
// to a page that is the honest answer. For one whose home page asks for new data every few seconds, a 503 once is not a reason to replace
// the page they are reading with an apology: the page keeps what it shows, its times keep counting up, and the next beat tries again.
//
// The home route's `clientLoader` runs the server's loader through `reload`. The page tells `show` what it is showing (and `show`'s result
// is called when it goes). A failure with nothing of that page on screen (a navigation to it from elsewhere, another network) is thrown as
// before. What the page does about a failure is its polling's business, so `reload` counts them: the pace slows down with each one in a row
// and the page says so after two (`failures`, `subscribe`).

/** How long a refresh may take before it is given up on, in ms. A fetch that never settles must not be what stops the page from trying again. */
export const REFRESH_TIMEOUT_MS = 10_000;

export interface OnScreenOptions<T> {
  /**
   * Whether an answer is not to replace what is shown (older than it, or from another build). The page keeps what it shows, and the refresh
   * counts as one that did not work. Asked only when a page of the same scope is on screen.
   */
  refuse?: (next: T, shown: T) => boolean;
  /**
   * What the page of the same scope shows for an answer that is accepted: `next` is the answer, `shown` what is on screen. A page made of parts
   * that can fail on their own keeps the loaded ones (`keepLoaded`, live-page.ts). Never asked for an answer that is refused, for a page that
   * is not on screen (a navigation to it), or for a load that failed.
   */
  merge?: (next: T, shown: T) => T;
  /** `REFRESH_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface OnScreen<T> {
  /** Says that `data` is what the page of `scope` shows. Returns what to call when that page leaves the screen. */
  show(scope: string, data: T): () => void;
  /**
   * `load()`, or what the page of `scope` shows when `load` fails or takes more than `timeoutMs` (and that page is on screen: a navigation
   * to the page waits for the load as long as it takes). A redirect (a thrown `Response` with a 3xx status) and an abort are React Router's
   * own business and are never swallowed. An answer that `refuse` says no to is not taken; one that is taken is `merge`d with what is shown.
   */
  reload(scope: string, load: () => Promise<T>): Promise<T>;
  /** How many refreshes in a row did not work: failed, timed out, or were refused. Zero after one that did, and when a page appears or leaves. */
  failures(): number;
  /** Calls `listener` whenever `failures()` changes. Returns what stops it. */
  subscribe(listener: () => void): () => void;
}

/** A thrown redirect, which React Router follows. (Any other thrown `Response`, a 503 say, is a failure like any error.) */
const isRedirect = (error: unknown): boolean => error instanceof Response && error.status >= 300 && error.status < 400;

/** The abort of a navigation that interrupted the load: nobody's failure. */
const isAbort = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";

/** `work`, or a rejection after `ms`. A late answer is ignored; a late failure is handled (nothing is left unhandled). */
function giveUpAfter<T>(ms: number, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
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

export function createOnScreen<T>(options: OnScreenOptions<T> = {}): OnScreen<T> {
  const timeoutMs = options.timeoutMs ?? REFRESH_TIMEOUT_MS;
  let shown: { scope: string; data: T } | undefined;
  let failed = 0;
  const listeners = new Set<() => void>();

  const count = (next: number) => {
    if (next === failed) return;
    failed = next;
    for (const listener of [...listeners]) listener();
  };
  /** What the page of `scope` shows now, if it is on screen. */
  const showing = (scope: string) => (shown?.scope === scope ? shown : undefined);

  return {
    show(scope, data) {
      const mine = { scope, data };
      shown = mine;
      count(0);
      // A page that left must not take away the one that came after it.
      return () => {
        if (shown !== mine) return;
        shown = undefined;
        count(0);
      };
    },
    async reload(scope, load) {
      let next: T;
      try {
        next = await (showing(scope) ? giveUpAfter(timeoutMs, load()) : load());
      } catch (error) {
        const current = showing(scope);
        if (!current || isRedirect(error) || isAbort(error)) throw error;
        count(failed + 1);
        return current.data;
      }
      const current = showing(scope);
      if (!current) return next;
      if (options.refuse?.(next, current.data)) {
        count(failed + 1);
        return current.data;
      }
      count(0);
      return options.merge ? options.merge(next, current.data) : next;
    },
    failures: () => failed,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
