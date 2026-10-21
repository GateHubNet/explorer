// The raw query of a request's URL, and the form a canonical query writes its values in. Pure: the loaders, the routes and the browser
// import this file.
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

/**
 * A value of a query, as the canonical queries write it: `encodeURIComponent`, and `'` too, which that leaves as it is and a URL parser
 * rewrites to `%27` in a query. The canonical query must be what the request's URL says once it is serialized (`queryOf(request.url)`),
 * or a redirect to it would not end. Every page's canonical query writes its free-text values (a marker, an asset's text) with this.
 */
export function queryValue(text: string): string {
  return encodeURIComponent(text).replace(/'/g, "%27");
}
