// What the worker specs of the NFT pages (test/worker/nfts-list.spec.ts, nft-collection.spec.ts and the specs of the later NFT pages) share to read a page's answer: the 503 a failing
// call is made to answer, the keys the upstream mock saw, whether the edge cache holds a copy, and the pieces of the HTML the pages have alike (the tiles, the links by their text, the
// `role="alert"` of a card that failed, `noindex, follow`). For the Workers runtime: `caches.default` and the Worker's `env`.

import { env } from "cloudflare:workers";
import { expect } from "vitest";

import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration } from "../../app/server/env";
import { anchors, elementText } from "./pages";
import { dataApiError, type UpstreamMock } from "./upstream";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The data API failing: a 503. */
export const unavailable = () => dataApiError(503, "unavailable");

/** The keys of the requests the mock saw (`GET /v2/last_validated`), in order. */
export const keysOf = (requests: UpstreamMock["requests"]) => requests.map((request) => request.key);

/**
 * Whether the edge cache holds a copy of `path` (for after the answer has been read). The copy is stored behind the answer, in `waitUntil`, so a store that is wanted may take a moment:
 * it polls for up to 2 s, as `pageClient`'s `stored` does, and answers as soon as it finds the copy. A copy that is not wanted (a degraded page, a 503) is therefore told absent only
 * after those 2 s, which is what makes "not stored" mean it: a store that was merely slower than a fixed wait would pass.
 */
export async function isStored(path: string): Promise<boolean> {
  const key = edgeCacheKey(`https://explorer.test${path}`, cacheGeneration(env));
  for (let tries = 0; tries < 80; tries += 1) {
    if ((await caches.default.match(key)) !== undefined) return true;
    await sleep(25);
  }
  return false;
}

/** A degraded page: 200, never kept by the browser or the edge. */
export async function expectDegraded(path: string, response: Response): Promise<void> {
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await isStored(path)).toBe(false);
}

/** Whether the head says `noindex, follow`, and has no canonical URL. */
export function isNoindex(html: string): boolean {
  return /<meta name="robots" content="noindex, follow"\/?>/.test(html) && !/<link rel="canonical"/.test(html);
}

/** The tiles (`StatTile figure`) of a page: each one's label and figure. */
export function tiles(html: string): Array<{ label: string | undefined; value: string | undefined }> {
  return [...html.matchAll(/<div class="stat stat--figure">([\s\S]*?)<\/div>/g)].map((match) => ({
    label: elementText(match[1]!, "stat__label"),
    value: elementText(match[1]!, "stat__value"),
  }));
}

/** The `href` of each anchor with this text. */
export const linksTo = (html: string, text: string) => anchors(html).filter((a) => a.text === text).map((a) => /href="([^"]*)"/.exec(a.attrs)?.[1]?.replace(/&amp;/g, "&"));

/** The number of `role="alert"` elements: one for each card that failed. */
export const alerts = (html: string) => (html.match(/role="alert"/g) ?? []).length;
