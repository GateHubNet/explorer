import { cacheClassHeaders } from "../server/edge-cache";

// Everything may be crawled but the search pages (they are `noindex, follow` too: every query is a page of its own).
// There is no sitemap in v1. The text changes only with a deploy, and the edge cache key includes the build id.
const ROBOTS = "User-agent: *\nDisallow: /*/search\n";

export function loader() {
  const headers = cacheClassHeaders("immutable");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(ROBOTS, { headers });
}
