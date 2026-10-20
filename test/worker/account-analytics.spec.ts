import { afterEach, describe, expect, it } from "vitest";

import { pageClient } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The account's Analytics tab, `/{net}/account/{address}?tab=analytics…`, with ACCOUNT_ANALYTICS on (the `worker` project). One URL per view
// (spec 1.3): the canonical query is `tab=analytics`, then `period` when it is not the default; any other query string is a 302 to the canonical
// URL, of class `short`, before any call upstream. The off case is account-analytics-off.spec.ts.

const { get, storedAs } = pageClient("198.18.1");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

// The recorded accounts (test/fixtures/http, README "Upstream fixtures").
const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const XAHAU_ACTIVE = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";

const SHORT = { cls: "short", ttl: 30 };

/** The answer to `path`: a 302, where it leads, and what was asked upstream for it. */
async function redirectOf(path: string) {
  mock = mockUpstream(path.startsWith("/xahau/") ? "xahau" : "xrpl");
  const response = await get(path);
  await response.text();
  return { status: response.status, location: response.headers.get("Location"), requests: mock.requests };
}

describe("the URL of the analytics view", () => {
  const base = `/xrpl/account/${ACTIVE}`;

  it.each([
    ["the default period named", "tab=analytics&period=30d", "tab=analytics"],
    ["the period first", "period=90d&tab=analytics", "tab=analytics&period=90d"],
    ["a marker", "tab=analytics&marker=WzEwNzYxMjU3MywyNV0", "tab=analytics"],
    ["a trail of markers", "tab=analytics&back=a", "tab=analytics"],
    ["a destination tag", "tab=analytics&tag=5", "tab=analytics"],
    ["a currency", "tab=analytics&in=usd", "tab=analytics"],
    ["an unknown parameter", "tab=analytics&x=1", "tab=analytics"],
    ["an unknown period", "tab=analytics&period=2y", "tab=analytics"],
    ["a period twice", "tab=analytics&period=90d&period=1y", "tab=analytics&period=90d"],
    ["a period in capitals", "tab=analytics&period=1Y", "tab=analytics"],
    ["a period after a marker", "tab=analytics&marker=WzEwNzYxMjU3MywyNV0&period=all", "tab=analytics&period=all"],
    ["the tab twice", "tab=analytics&tab=analytics", "tab=analytics"],
    ["an escaped spelling of the tab", "tab=%61nalytics", "tab=analytics"],
    ["an escaped spelling of the period", "tab=analytics&period=%31y", "tab=analytics&period=1y"],
    ["an empty parameter", "tab=analytics&", "tab=analytics"],
  ])("redirects %s (?%s) to its canonical URL, class short, without a call", async (_what, query, canonical) => {
    const path = `${base}?${query}`;
    expect(await redirectOf(path)).toEqual({ status: 302, location: `${base}?${canonical}`, requests: [] });
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("redirects on Xahau to Xahau's canonical URL", async () => {
    const path = `/xahau/account/${XAHAU_ACTIVE}?period=all&tab=analytics&x=1`;
    expect(await redirectOf(path)).toEqual({ status: 302, location: `/xahau/account/${XAHAU_ACTIVE}?tab=analytics&period=all`, requests: [] });
    expect(await storedAs(path)).toEqual(SHORT);
  });

  // The view's loader is not built yet: until it is, a canonical URL leads back to the account page, as the switch's off case does.
  it.each(["tab=analytics", "tab=analytics&period=90d", "tab=analytics&period=1y", "tab=analytics&period=all"])(
    "answers the canonical ?%s, for now, with a 302 to the account page, class short, without a call",
    async (query) => {
      const path = `${base}?${query}`;
      expect(await redirectOf(path)).toEqual({ status: 302, location: base, requests: [] });
      expect(await storedAs(path)).toEqual(SHORT);
    },
  );
});
