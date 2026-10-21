import { afterEach, describe, expect, it, vi } from "vitest";

import { pageClient, textOf } from "../support/pages";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";

// The analytics calls' in-flight sharing and failure hold on the real Worker (spec 2.7): while one render's call of a key runs, another render's
// call of the same key waits for it instead of asking again; and a call that failed is held for 5 s, so the renders within them do not ask again.
// Both are per Worker instance (here: per isolate), in memory, so they are tested in a file of their own: no other file's call is in flight or
// held here. `statusesOf` tells a call that went out from one that was shared or held: only the first reaches the mock.

const { get } = pageClient("198.51.104");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const recordings = import.meta.glob("../fixtures/http/xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/analytics/*.json", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

async function recorded(name: string): Promise<unknown> {
  const load = recordings[`../fixtures/http/xrpl/data-api/accounts/${ACTIVE}/analytics/${name}.json`];
  if (!load) throw new Error(`no recording ${name}`);
  return JSON.parse(await load());
}

/** A render's answer, read to its end: the status, the cache label, and the text. */
async function render(path: string) {
  const response = await get(path);
  const text = textOf(await response.text());
  return { status: response.status, cache: response.headers.get("X-Cache"), text };
}

describe("in-flight sharing", () => {
  it("makes one counterparties call for two renders of a view at once (the page and its data URL), each of which shows it", async () => {
    const key = `GET /v2/accounts/${ACTIVE}/analytics/counterparties?limit=6&start=2026-07-20`;
    const answer = await recorded("counterparties@limit=6&start=2026-07-20");
    mock = mockUpstream("xrpl", { [key]: async () => (await sleep(1_000), Response.json(answer)) });

    // Two URLs, so two renders (the edge cache's single flight shares a page, not its subrequests).
    const [html, data] = await Promise.all([
      render(`/xrpl/account/${ACTIVE}?tab=analytics&period=90d`),
      get(`/xrpl/account/${ACTIVE}.data?tab=analytics&period=90d`).then(async (response) => ({ cache: response.headers.get("X-Cache"), body: await response.text() })),
    ]);

    expect([html.cache, data.cache]).toEqual(["MISS", "MISS"]);
    expect(html.status).toBe(200);
    expect(html.text).not.toContain("Still working");
    expect(html.text).not.toContain("Couldn’t load");
    // The data URL's counterparties are the answer's: its accounts are in it.
    expect(data.body).toContain("rq5QXrArpavMCfE5dRuR3uG55iV1rG8mj");
    expect(statusesOf(mock, key)).toEqual([200]);
  });
});

describe("the failure hold", () => {
  it("calls a failing balance_changes once across two renders within 5 s, and again after 5 s", async () => {
    // `Date` is the one clock the hold reads, so it alone is faked: the Cache API, the streams and the deadlines need the real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    const key = `GET /v2/accounts/${ACTIVE}/analytics/balance_changes?interval=week&start=2025-10-20`;
    mock = mockUpstream("xrpl", { [key]: dataApiError(500, "boom") });
    const path = `/xrpl/account/${ACTIVE}?tab=analytics&period=1y`;

    // A failed card is a page that is served and not stored, so each render is a render.
    const first = await render(path);
    expect(first.text).toContain("Couldn’t load the balance changes.");
    vi.setSystemTime(Date.now() + 1_000);
    const second = await render(path);
    expect([first.cache, second.cache]).toEqual(["MISS", "MISS"]);
    expect(second.text).toContain("Couldn’t load the balance changes.");
    expect(statusesOf(mock, key)).toEqual([500]);

    // Held until 5 s after the failure: the render after that asks again.
    vi.setSystemTime(Date.now() + 4_001);
    const third = await render(path);
    expect(third.text).toContain("Couldn’t load the balance changes.");
    expect(statusesOf(mock, key)).toEqual([500, 500]);
  });
});
