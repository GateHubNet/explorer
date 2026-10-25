// What the environment adds to every response (sandbox spec 8). Worker-only code; workers/app.ts puts it around the edge cache, so that a stored
// copy gets it on the way out and nothing stored differs between the environments.

import { environmentOf } from "../ui/environment";
import type { Env } from "./env";
import { withHeader } from "./logging";

/**
 * In the sandbox, `response` with `X-Robots-Tag: noindex`, so that nothing it serves (pages, `.data`, images, `robots.txt`, redirects, errors)
 * reaches a search result: the same object when its headers can be changed, else a copy (`new Response(body, response)`) with the header, for a
 * response whose headers are immutable (one from the Cache API, a redirect). Elsewhere `response` as it is: development and production are
 * indexable, and the images and CSVs keep the `noindex` of their own. `robots.txt` is the same in every environment, so that the crawlers of
 * link previews still read it.
 */
export function withEnvironmentHeaders(response: Response, env: Pick<Env, "ENVIRONMENT">): Response {
  return environmentOf(env.ENVIRONMENT) === "sandbox" ? withHeader(response, "X-Robots-Tag", "noindex") : response;
}
