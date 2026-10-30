import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { anchors, hrefs, pageClient } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The account page's Delegation tab with every switch "off" (the `worker-off` project, README "Switches"), as production has it until the owner turns `DELEGATION` on (ledger object pages
// spec 6.1 and 10). On XRPL, which has delegation, the tab is the "soon" label, a label and not a link, as the NFTs' and Analytics' are, and its URL a 302 of class `short` to the account
// page before any call; on Xahau, which has none (`hasDelegation`), the switch does not matter: there is no tab at all, "soon" included, and the URL is the same 302. The `worker`
// project's cases, with the switch on, are delegation.spec.ts.

const { get, page, storedAs } = pageClient("198.18.93");

const SHORT = { cls: "short", ttl: 30 };
/** The recorded active accounts of the two networks (test/fixtures/http). */
const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const XAHAU_ACTIVE = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";
const MARKER = "WzEwNzYxMjU3MywyNV0";

let mock: UpstreamMock | undefined;
afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  expect(unused ?? []).toEqual([]);
});

describe("the project", () => {
  it("is the one with DELEGATION off", () => {
    expect((env as unknown as Record<string, string>).DELEGATION).toBe("off");
  });
});

describe("the account's Delegation tab with DELEGATION off", () => {
  it("shows the XRPL account's tab as 'soon', a label and not a link, and links nothing to it", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}`);
    const nav = /<nav class="tabs" aria-label="Account activity">([\s\S]*?)<\/nav>/.exec(html);
    expect(nav).not.toBeNull();
    // Every switch is off here: the NFTs and Analytics are the "soon" labels of before too.
    expect(anchors(nav![1]!).map((a) => a.text)).toEqual(["Transactions", "Payments", "Trades", "Offers", "Objects"]);
    expect(nav![1]).toContain(`<span class="tabs__item is-soon" aria-disabled="true"><span>Delegation</span><span class="soon">soon</span></span>`);
    // Between the NFTs and Analytics, where the tab is when it is on.
    expect(nav![1]!.indexOf("NFTs")).toBeLessThan(nav![1]!.indexOf("Delegation"));
    expect(nav![1]!.indexOf("Delegation")).toBeLessThan(nav![1]!.indexOf("Analytics"));
    expect(html).not.toContain("tab=delegation");
    expect(mock.requests.some((request) => request.key.includes("/delegations"))).toBe(false);
  });

  it("shows no Delegation tab on Xahau, not even the label: there is no delegation there for the switch to hold back", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/account/${XAHAU_ACTIVE}`);
    const nav = /<nav class="tabs" aria-label="Account activity">([\s\S]*?)<\/nav>/.exec(html)!;
    expect(nav[1]).not.toContain("Delegation");
    expect(html).not.toContain("tab=delegation");
    expect(hrefs(nav[1]!).some((href) => href.includes("delegation"))).toBe(false);
    expect(mock.requests.some((request) => request.key.includes("/delegations"))).toBe(false);
  });

  it.each([
    ["xrpl", "tab=delegation"],
    ["xahau", "tab=delegation"],
    // What the tab would redirect or refuse is not read: a marker (valid or not), a trail, a tag, another parameter.
    ["xrpl", `tab=delegation&marker=${MARKER}`],
    ["xrpl", "tab=delegation&marker=%25"],
    ["xrpl", "tab=delegation&marker=M2&back=M1"],
    ["xrpl", "tag=7&tab=delegation"],
  ] as const)("answers /%s/account/{address}?%s with a 302 to the account page, class short, without a call", async (net, query) => {
    mock = mockUpstream(net);
    const address = net === "xrpl" ? ACTIVE : XAHAU_ACTIVE;
    const path = `/${net}/account/${address}?${query}`;
    const response = await get(path);
    await response.text();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/${net}/account/${address}`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("tidies the .data URL of the tab (a client-side navigation) the same way: a redirect for React Router to follow, and no call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/account/${ACTIVE}.data?tab=delegation&_routes=routes%2Fnet.account.%24address`);
    const body = await response.text();
    expect(response.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(body).toContain(`/xrpl/account/${ACTIVE}`);
    expect(body).not.toContain("tab=delegation");
    expect(mock.requests).toEqual([]);
  });
});
