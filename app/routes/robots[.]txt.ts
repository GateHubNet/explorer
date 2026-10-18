import { cacheClassHeaders } from "../server/edge-cache";

// Everything may be crawled but the search pages (they are `noindex, follow` too: every query is a page of its own) and the payments CSVs
// (each crawl costs an upstream CSV of up to 1000 rows; the Payments tab's link is `rel="nofollow"` too). There is no sitemap in v1. The text
// changes only with a deploy, and the edge cache key includes the build id.
const ROBOTS = "User-agent: *\nDisallow: /*/search\nDisallow: /*/account/*/payments.csv\n";

export function loader() {
  const headers = cacheClassHeaders("immutable");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(ROBOTS, { headers });
}
