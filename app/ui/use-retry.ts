import { useState } from "react";
import { useRevalidator } from "react-router";

/**
 * Retry of a section that could not be loaded: the route's own data is fetched again, in the browser, from the explorer's own Worker.
 *
 * `retrying` is this Retry's own: true from a press until the revalidation it started is over (the revalidator is idle again), and never for a
 * revalidation that something else started. A live page revalidates on every beat, and a button that disabled itself for each would lose the
 * keyboard focus of a visitor who is on it.
 */
export function useRetry(): { retry: () => void; retrying: boolean } {
  const revalidator = useRevalidator();
  const [pressed, setPressed] = useState(false);
  return {
    retry: () => {
      setPressed(true);
      // React Router settles the promise when the revalidation is over, a beat that joined it included.
      const done = () => setPressed(false);
      void revalidator.revalidate().then(done, done);
    },
    retrying: pressed && revalidator.state !== "idle",
  };
}
