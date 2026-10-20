import { afterEach, describe, expect, it, vi } from "vitest";

import xrplLastValidated from "../fixtures/http/xrpl/data-api/last_validated.json";
import { pageClient, textOf } from "../support/pages";
import { mockUpstream, nodeError, type SeenRequest, type UpstreamMock } from "../support/upstream";

// The market pair page that follows the chain, on the real Worker (markets spec 3.8, 3.10): what many visitors at the same moment cost, what the
// open page's own `.data` URL is stored as and the build it says, and what the failure hold spares a failing node when the page is asked again
// within it.
//
// A file of its own, because what these tests need is *not yet in the cache*: the Worker keeps what the data API and the node said for 2 s and
// more, and a test that holds an answer back (the gate of the herd) or fails one (the book) must be the first to ask for it. A spec file's Cache
// API is its own, and so is its isolate's failure hold. The herd and the `.data` URL are XRP/RLUSD's; the failing book is LIONS/XRP's, which no
// other test of the file reads.

const { get, storedAs } = pageClient("198.51.110");

let mock: UpstreamMock | undefined;
afterEach(() => {
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
  expect(unused ?? []).toEqual([]);
});

const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const LIONS = "4C494F4E53000000000000000000000000000000+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";
const PAIR = `/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}`;
const LIONS_PAIR = "/xrpl/markets/LIONS.rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS/XRP";

/** A request as one call: a data API call by its key, a node call by its method and the assets it asks about. */
function callOf(request: SeenRequest): string {
  if (request.kind !== "node") return request.key;
  const { method, params } = request.body as { method: string; params: [Record<string, unknown>] };
  const subject = (value: unknown) => {
    const { currency, issuer } = value as { currency: string; issuer?: string };
    return issuer === undefined ? currency : `${currency}+${issuer}`;
  };
  const [p] = params;
  return method === "book_offers" ? `node book_offers ${subject(p.taker_gets)}_${subject(p.taker_pays)}` : `node ${method} ${subject(p.asset)}_${subject(p.asset2)}`;
}

describe("many visitors at the same moment", () => {
  it("render the pair once: the first renders, the others wait and are given its copy, and each call is made once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // The anchor is held: the chains wait for it, and so does the page. The other calls of the render go out at once.
    mock = mockUpstream("xrpl", {
      "GET /v2/last_validated": async () => {
        await gate;
        return new Response(JSON.stringify(xrplLastValidated), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    const visitors = Array.from({ length: 6 }, () => get(PAIR));

    await vi.waitFor(() => expect(mock!.requests.filter((request) => request.key === "GET /v2/last_validated")).toHaveLength(1), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    const responses = await Promise.all(visitors);
    const pages = await Promise.all(responses.map((response) => response.text()));

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    // One render's calls, each once: the anchor, the trades, the two chains, the traders, both sides of the book, the pool.
    const calls = mock.requests.map(callOf);
    expect(calls).toHaveLength(9);
    expect(new Set(calls).size).toBe(9);
    // One render (MISS); the others were given its copy (MISS-SHARED) or, if they came after it, the stored page (HIT).
    const labels = responses.map((response) => response.headers.get("X-Cache"));
    expect(labels.filter((label) => label === "MISS")).toHaveLength(1);
    expect(labels.filter((label) => label === "MISS-SHARED").length).toBeGreaterThanOrEqual(1);
    expect(labels.every((label) => label === "MISS" || label === "MISS-SHARED" || label === "HIT")).toBe(true);
    // The same page for everybody, and a whole one.
    expect(new Set(pages).size).toBe(1);
    expect(textOf(pages[0]!)).toContain("XRP / RLUSD");
    expect(textOf(pages[0]!)).not.toContain("Couldn’t load");
    for (const response of responses) expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("the page the open browser asks for", () => {
  it("is the route's own `.data` URL, stored as live-home for 1 s, and says which build answered and the ledger it is at", async () => {
    mock = mockUpstream("xrpl");
    const path = `${PAIR}.data?interval=15m&_routes=routes%2Fnet.markets.%24base.%24counter`;
    const response = await get(path);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/x-script");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs(path)).toEqual({ cls: "live-home", ttl: 1 });
    // The Worker's BUILD_ID (pinned in vitest.config.ts), so that a page of an older build can tell, and the anchor of the page.
    expect(text).toContain("test-build");
    expect(text).toContain("107721455");
    // The page's data, and nothing of the layout's or of the upstreams' answers.
    expect(text).toContain("XRP/RLUSD");
    expect(text).not.toContain('"origin"');
    expect(text).not.toContain("TakerGets");
    expect(text).not.toContain("tx_hash");
  });
});

describe("a failing node", () => {
  it("is asked once by two renders within the hold: the second is given the held failure, and both say the book is unavailable", async () => {
    const book = `node book_offers ${LIONS}_XRP`;
    mock = mockUpstream("xrpl", { [book]: nodeError("noNetwork") });

    const first = await get(LIONS_PAIR);
    const second = await get(LIONS_PAIR);
    const [one, two] = [textOf(await first.text()), textOf(await second.text())];

    expect([first.status, second.status]).toEqual([200, 200]);
    for (const text of [one, two]) expect(text).toContain("The network node did not answer, so the order book is missing.");
    expect(mock.requests.map(callOf).filter((call) => call === book)).toHaveLength(1);
  });
});
