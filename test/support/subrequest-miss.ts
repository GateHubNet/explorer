// The subrequest cache with nothing in it, for the page specs of test/worker/. What a Worker stores in the Cache API stays there for the rest of a spec file
// by the real clock, and a fake `Date` cannot empty it: so a test whose calls must reach the mock (an override, a list of calls) makes every lookup of a
// subrequest entry miss (`cold`), while what is stored is still written. `storedEntries` reads what each entry is stored with, and `keptFor` waits for one
// entry by its key (`entryOf`: the URL the Worker's subrequest cache stores it under). For the Workers runtime: `caches.default` and the Worker's `env`.

import { env } from "cloudflare:workers";
import { expect, vi } from "vitest";

/** Where the Worker's subrequest cache keeps its entries (app/server/edge-cache.ts). */
export const SUBREQUESTS = "https://subrequest-cache.invalid/";

const urlOf = (request: RequestInfo | URL) => (typeof request === "string" ? request : request instanceof URL ? request.href : request.url);

/**
 * Every lookup of a subrequest entry misses, from now until the test ends (`vi.restoreAllMocks`): every call of a render reaches the mock. Other lookups,
 * the edge cache's copies of the pages, are made as they are. `looked` is every subrequest entry looked up, in order (each call of a render looks its entry
 * up before it reaches the upstream).
 */
export function cold(): { looked: string[] } {
  const looked: string[] = [];
  const match = caches.default.match.bind(caches.default);
  vi.spyOn(caches.default, "match").mockImplementation((request, options) => {
    if (!urlOf(request).startsWith(SUBREQUESTS)) return match(request, options);
    looked.push(urlOf(request));
    return Promise.resolve(undefined);
  });
  return { looked };
}

/** The `Cache-Control` of every subrequest entry stored from now until the test ends, by the entry's URL (each is still stored). */
export function storedEntries(): Map<string, string | null> {
  const kept = new Map<string, string | null>();
  const put = caches.default.put.bind(caches.default);
  vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
    if (urlOf(request).startsWith(SUBREQUESTS)) kept.set(urlOf(request), response.headers.get("Cache-Control"));
    return put(request, response);
  });
  return kept;
}

/** The URL the subrequest cache stores a key under (edge-cache.ts: the build and the SHA-256 of the key). */
export async function entryOf(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return `${SUBREQUESTS}${encodeURIComponent(env.BUILD_ID)}/${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** How long the entry of `key` was stored for (`max-age=N`), once it has been: it is written behind the answer. `kept` is `storedEntries()`'s. */
export async function keptFor(kept: Map<string, string | null>, key: string): Promise<string | null | undefined> {
  const entry = await entryOf(key);
  await vi.waitFor(() => expect(kept.has(entry), `nothing stored for ${key}`).toBe(true), { timeout: 5_000 });
  return kept.get(entry);
}
