import { useEffect, useEffectEvent, useRef } from "react";
import { useNavigation, useRevalidator } from "react-router";

/** How often an open page asks for its data again, in ms: about one ledger (they close every 3-4 s). */
export const LIVE_REFRESH_MS = 4000;

/**
 * Keeps the page's data as new as the chain: every `LIVE_REFRESH_MS` it has React Router run the route's loaders again
 * (`useRevalidator().revalidate()`), which fetches the explorer's own `.data` URL for the page, never the data API, and gives the page the
 * new data (the edge cache answers most of those from a copy that is at most a few seconds old).
 *
 * - Only while the tab is visible: a hidden tab stops the timer and costs nothing, and when it is shown again the data is asked for at
 *   once (the page may be minutes behind) and the beat goes on from there.
 * - Never two at a time, and never on top of a navigation: a beat that finds a revalidation running (`revalidator.state`) or a navigation
 *   in progress is skipped, so a slow answer is not met by another request.
 * - It stops when the page is left: the timer and the listener go with the component.
 *
 * It does nothing while rendering, so the server's HTML and the first render in the browser are what they were. A revalidation that fails
 * is the route's to handle (the home route hands the page's data back, `on-screen.ts`).
 */
export function useLiveRefresh(): void {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const busy = revalidator.state !== "idle" || navigation.state !== "idle";

  // `revalidator.state` is a render behind a revalidation that has just been started, and React Router restarts one that is asked for again
  // while it runs (aborting the loads under way): what this hook started and has not seen end is kept here too.
  const running = useRef(false);

  // Reads the latest `busy` and `revalidate` without being a reason to restart the timer.
  const beat = useEffectEvent(() => {
    if (document.visibilityState !== "visible" || busy || running.current) return;
    running.current = true;
    void Promise.resolve(revalidator.revalidate()).finally(() => {
      running.current = false;
    });
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(timer);
      timer = setInterval(() => beat(), LIVE_REFRESH_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        beat();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, []);
}
