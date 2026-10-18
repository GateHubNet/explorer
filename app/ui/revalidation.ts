import type { ShouldRevalidateFunction } from "react-router";

/**
 * The `shouldRevalidate` of a layout whose data depends on its URL parameters and nothing else (`/:net`: the network, and the origin of
 * the request): its loader runs again when a parameter changed, and never otherwise.
 *
 * Why it matters on the home page: that page asks for its data again every few seconds (`useLiveRefresh`), and React Router fetches the data of
 * every route that revalidates in one request. A layout that came along would fail with the page when that request fails, and its error
 * boundary would replace the whole page frame, `clientLoader` or not (`on-screen.ts`). Without it the request is for the page's route alone
 * (`?_routes=routes/net._index`), which is also less to send and to store. It never says yes when React Router already said no.
 */
export const onlyWhenParamsChange: ShouldRevalidateFunction = ({ currentParams, nextParams, defaultShouldRevalidate }) =>
  defaultShouldRevalidate && JSON.stringify(currentParams) !== JSON.stringify(nextParams);
