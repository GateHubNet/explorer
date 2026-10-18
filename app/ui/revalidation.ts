import type { ShouldRevalidateFunction } from "react-router";

/**
 * The `shouldRevalidate` of a layout whose data depends on its URL parameters and nothing else (`/:net`: the network, and the origin of
 * the request): its loader runs again when a parameter changed, and never otherwise.
 *
 * Why it matters on the home page, which asks for its data again every few seconds (`useLiveRefresh`). React Router 8.4 asks the Worker for
 * a route that has a `clientLoader` (the home route) in a request of its own, `?_routes=routes/net._index`, when that `clientLoader` asks for
 * the server's loader (`singleFetchLoaderNavigationStrategy`, dom/ssr/single-fetch.js: `if (shouldAllowOptOut(m) && hasClientLoader)`), and
 * for the routes that have none (this layout) in another, in parallel, when any of them revalidates. A layout whose request fails (a 503) gets
 * the error, and its error boundary replaces the whole page frame, `clientLoader` or not (`on-screen.ts` keeps the *page's* data only). With
 * this, the layout does not revalidate, nothing is asked for it (`routesParams.size === 0` resolves the batch without a request), a
 * refresh is the one request for the page, and the layout's boundary cannot be reached by it. A navigation to the home page of the other
 * network does change the parameter: that makes both requests, in parallel. It never says yes when React Router already said no.
 */
export const onlyWhenParamsChange: ShouldRevalidateFunction = ({ currentParams, nextParams, defaultShouldRevalidate }) =>
  defaultShouldRevalidate && JSON.stringify(currentParams) !== JSON.stringify(nextParams);
