// The home page's own `onScreen` (on-screen.ts): what the page keeps when a refresh does not work, and the two answers it will not draw: one
// that is older than the ledger on screen, and one from another build than the page's own (README, "Live updates").

import type { HomeLoaderData } from "../server/home-view";
import { createOnScreen, type OnScreen } from "./on-screen";

/** Where this tab remembers the pairs of builds it has reloaded for (`sessionStorage`, a JSON list of `from>to`). */
const MARKER = "explorer:build-reloads";

export interface HomeLiveDeps {
  /** `window.location.reload()`. */
  reload?: () => void;
  /** `window.sessionStorage`: it may throw, or be absent, where the visitor blocks storage. */
  storage?: () => Storage | undefined;
}

/**
 * A deploy while the page is open: the Worker that answers is of a new build and the code in the browser is the old one, and data of a new
 * shape must not be drawn by old code. The page reloads, and does so once for a pair of builds (the marker of the tab), so that a skew that
 * stays (a rollout in progress, an old copy somewhere) cannot make a loop. Where the marker cannot be written the page does not reload at all:
 * a loop is worse than an old page.
 */
function reloadOnce(from: string, to: string, { reload, storage }: Required<HomeLiveDeps>): void {
  const pair = `${from}>${to}`;
  let box: Storage | undefined;
  let done: string[] = [];
  try {
    box = storage();
    if (!box) return;
    const text = box.getItem(MARKER);
    try {
      const parsed: unknown = text === null ? [] : JSON.parse(text);
      done = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      // Not what this wrote: no pair is known.
    }
  } catch {
    return;
  }
  if (done.includes(pair)) return;
  try {
    box.setItem(MARKER, JSON.stringify([...done, pair]));
  } catch {
    return;
  }
  reload();
}

export function createHomeOnScreen(deps: HomeLiveDeps = {}): OnScreen<HomeLoaderData> {
  const resolved: Required<HomeLiveDeps> = {
    reload: deps.reload ?? (() => window.location.reload()),
    storage: deps.storage ?? (() => window.sessionStorage),
  };
  return createOnScreen<HomeLoaderData>({
    // Not to be drawn: an answer of another build (the document is reloaded, once), and an older one (the edge serves a stored copy, whatever
    // its age, when a render fails; the scope of `reload` is the network, so another network's ledger is not compared).
    refuse: (next, shown) => {
      if (next.build !== shown.build) {
        reloadOnce(shown.build, next.build, resolved);
        return true;
      }
      return next.latest.index < shown.latest.index;
    },
  });
}
