import { useLocation, useNavigation } from "react-router";

/**
 * Whether the page is being loaded again for another view of itself (spec 2.8): a navigation is loading and goes to the pathname the page is
 * at, as a choice of period or currency does (`/xrpl/network?period=1y`). The page keeps what it shows, dimmed (`.is-refetching .chart`,
 * charts.css), and puts the new data in its place when it comes: no skeleton, and nothing jumps.
 *
 * A navigation to another page is not this: that page replaces this one. Nor is a beat of a live page, which is a revalidation and leaves
 * `navigation.state` idle: the page follows the chain and is never dimmed for it.
 */
export function useRefetching(): boolean {
  const navigation = useNavigation();
  const { pathname } = useLocation();
  return navigation.state === "loading" && navigation.location.pathname === pathname;
}
