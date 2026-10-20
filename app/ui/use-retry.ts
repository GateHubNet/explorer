import { useRevalidator } from "react-router";

/** Retry of a section that could not be loaded: the route's own data is fetched again, in the browser, from the explorer's own Worker. */
export function useRetry(): { retry: () => void; retrying: boolean } {
  const revalidator = useRevalidator();
  return { retry: () => void revalidator.revalidate(), retrying: revalidator.state !== "idle" };
}
