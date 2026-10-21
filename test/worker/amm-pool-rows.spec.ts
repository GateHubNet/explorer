import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The check is the mocked module's: the route's graph is loaded with this file, not inside the first request.
import "../../app/routes/net.amm.$pool";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration } from "../../app/server/env";
import { pageClient, textOf } from "../support/pages";
import { cold } from "../support/subrequest-miss";
import { mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// A page of the pool's older rows (AMM spec 3.3, step 2) whose rows do not build, on the real Worker. The data API client's shape check refuses such an answer
// before the page sees it (amm-shape.ts `checkSwapsPage`, a 503), so the case cannot be had through it: here the check is wrapped, and lets the one answer of
// the test through as it is. What the page does then is what it does for any row that passes the check and still fails to build: the list's card says it could
// not load, the problem is logged, and the request is degraded, so the failed card is served and never stored as the page behind the marker (an hour). The rest
// of the page behind a marker is amm-pool.spec.ts.

/** Whether the swaps' shape check lets the answer through as it is. Only the test below sets it. */
let unchecked = false;

vi.mock("../../app/server/amm-shape", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../app/server/amm-shape")>();
  return { ...real, checkSwapsPage: (body: unknown) => (unchecked ? (body as ReturnType<typeof real.checkSwapsPage>) : real.checkSwapsPage(body)) };
});

const { get } = pageClient("198.18.53");

/** XRP/RLUSD: the fixtures have its pool (#1). */
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const MARKER = "EEEE";
const SWAPS = `GET /v2/amm/pools/${POOL}/swaps?descending=true&limit=20&marker=${MARKER}`;

let mock: UpstreamMock | undefined;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  unchecked = false;
  vi.restoreAllMocks();
  expect(unused ?? []).toEqual([]);
});

afterAll(() => {
  vi.useRealTimers();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the edge cache holds a copy of `path` now (for after the answer has been read; waits a moment for a store that is not wanted). */
async function isStored(path: string) {
  await sleep(120);
  return (await caches.default.match(edgeCacheKey(`https://explorer.test${path}`, cacheGeneration(env)))) !== undefined;
}

describe("a page of older rows whose rows do not build", () => {
  it("fails the list's card in its place, logs the problem, and is degraded: served, and not stored", async () => {
    cold();
    unchecked = true;
    mock = mockUpstream("xrpl", { [SWAPS]: { result: "success", count: 1, exchanges: [null] } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = `/xrpl/amm/${POOL}?marker=${MARKER}`;
    const response = await get(path);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(statusesOf(mock, SWAPS)).toEqual([200]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
    // The card says so in its place, and the rest of the page stands.
    const failed = [...html.matchAll(/<div class="notice notice--error" role="alert">([\s\S]*?)<button/g)].map((match) => textOf(match[1]!));
    expect(failed).toEqual([expect.stringContaining("the swaps")]);
    expect(textOf(html)).toContain("Back to the pool");
    const logged = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the AMM pool page behind a marker could not load a card"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("the swaps: ");
  });
});
