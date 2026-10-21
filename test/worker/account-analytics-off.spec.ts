import { afterEach, describe, expect, it } from "vitest";

import { anchors, pageClient } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The account's Analytics tab with every switch "off" (the `worker-off` project, README "Switches"): ACCOUNT_ANALYTICS off is the "soon" tab of
// before, and every URL of the view is a 302 to the account page, of class `short`, before any call (spec 1.2), as an unknown tab is. The
// `worker` project's cases are account-analytics.spec.ts.

const { get, page, storedAs } = pageClient("198.18.2");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const SHORT = { cls: "short", ttl: 30 };

describe("the account page with ACCOUNT_ANALYTICS off", () => {
  it("shows Analytics in the tab bar as 'soon', a label and not a link, and links nothing to the view", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}`);
    const nav = /<nav class="tabs" aria-label="Account activity">([\s\S]*?)<\/nav>/.exec(html);
    expect(nav).not.toBeNull();
    expect(anchors(nav![1]!).map((a) => a.text)).toEqual(["Transactions", "Payments", "Trades", "Offers", "Objects"]);
    expect(nav![1]).toMatch(/<span class="tabs__item is-soon" aria-disabled="true"><span>Analytics<\/span><span class="soon">soon<\/span><\/span>/);
    expect(html).not.toContain("tab=analytics");
  });

  it.each(["tab=analytics", "tab=analytics&period=90d", "period=1y&tab=analytics&tag=5"])(
    "answers ?%s with a 302 to the account page, class short, without a call",
    async (query) => {
      mock = mockUpstream("xrpl");
      const path = `/xrpl/account/${ACTIVE}?${query}`;
      const response = await get(path);
      await response.text();
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/xrpl/account/${ACTIVE}`);
      expect(mock.requests).toEqual([]);
      expect(await storedAs(path)).toEqual(SHORT);
    },
  );
});
