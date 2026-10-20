import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * False in the Worker's HTML and during hydration, true from the render after: a thing that only a script can do is left out of both, so
 * that they match (the same rule as `LiveToggle`). The kit's cursor needs it, and so do pages that draw no plot (the markets page's filter,
 * sort buttons and "Show all"), so it is a module of its own that imports only React: taken from `charts/Cursor.tsx` or `charts/Plot.tsx`, it
 * would put the plot's modules in such a page's first JavaScript (README, "The kit's boundaries").
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}
