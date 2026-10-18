// What a page that is on screen hands back when its data cannot be loaded again (README, "Live updates").
//
// React Router drops a route's data when its loader throws, and shows the nearest error boundary in its place. For a visitor who navigates
// to a page that is the honest answer. For one whose home page asks for new data every few seconds, a 503 once is not a reason to replace
// the page they are reading with an apology: the page keeps what it shows, its times keep counting up, and the next beat tries again.
//
// The home route's `clientLoader` runs the server's loader through `reload`. The page tells `show` what it is showing (and `show`'s result
// is called when it goes). A failure with nothing of that page on screen (a navigation to it from elsewhere, another network) is thrown as
// before.

export interface OnScreen<T> {
  /** Says that `data` is what the page of `scope` shows. Returns what to call when that page leaves the screen. */
  show(scope: string, data: T): () => void;
  /**
   * `load()`, or what the page of `scope` shows when `load` fails (and that page is on screen). A redirect (a thrown `Response` with a 3xx
   * status) is React Router's to follow: it is never swallowed. An answer that `behind` says is older than what is shown is not taken either.
   */
  reload(scope: string, load: () => Promise<T>): Promise<T>;
}

/** A thrown redirect, which React Router follows. (Any other thrown `Response`, a 503 say, is a failure like any error.) */
const isRedirect = (error: unknown): boolean => error instanceof Response && error.status >= 300 && error.status < 400;

export function createOnScreen<T>(options: { behind?: (next: T, shown: T) => boolean } = {}): OnScreen<T> {
  let shown: { scope: string; data: T } | undefined;

  return {
    show(scope, data) {
      const mine = { scope, data };
      shown = mine;
      // A page that left must not take away the one that came after it.
      return () => {
        if (shown === mine) shown = undefined;
      };
    },
    async reload(scope, load) {
      let next: T;
      try {
        next = await load();
      } catch (error) {
        if (shown?.scope === scope && !isRedirect(error)) return shown.data;
        throw error;
      }
      return shown?.scope === scope && options.behind?.(next, shown.data) ? shown.data : next;
    },
  };
}
