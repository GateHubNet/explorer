import { cacheClassHeaders } from "../server/edge-cache";

// Everything may be crawled but the search pages (they are `noindex, follow` too: every query is a page of its own), the payments CSVs
// (each crawl costs an upstream CSV of up to 1000 rows; the Payments tab's link is `rel="nofollow"` too) and the account's analytics views
// (a crawl is six aggregate reads of an account nobody else is looking at; the tab's links are `rel="nofollow"` too, and `*tab=analytics`
// matches either query order). There is no sitemap in v1. The text changes only with a deploy, and the edge cache key includes the build id.
const ROBOTS = "User-agent: *\nDisallow: /*/search\nDisallow: /*/account/*/payments.csv\nDisallow: /*/account/*tab=analytics\n";

export function loader() {
  const headers = cacheClassHeaders("immutable");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(ROBOTS, { headers });
}
