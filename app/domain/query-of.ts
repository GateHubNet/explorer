// The raw query of a request's URL. Pure: the loaders, the routes and the browser import this file.
//
// It is apart from network-params.ts so that a route that needs only this (the validators list) does not import the network page's
// periods, displays and hrefs: the build puts a module that several routes import in a chunk those routes share, and the network page's
// params would then be loaded by every page that reads a query. network-params.ts re-exports `queryOf`, so the network, markets and other
// routes keep importing it from there.

/**
 * The raw query of a URL, without the `?`, and without the pairs React Router adds to a data request (`_routes=…`). Left as it came
 * otherwise, so that a query that is not canonical (`period=1y&`, `period=%37d`) stays different from a page's canonical query.
 */
export function queryOf(url: string): string {
  const start = url.indexOf("?");
  if (start < 0) return "";
  const hash = url.indexOf("#", start);
  const query = url.slice(start + 1, hash < 0 ? undefined : hash);
  return query
    .split("&")
    .filter((pair) => pair.split("=", 1)[0] !== "_routes")
    .join("&");
}
