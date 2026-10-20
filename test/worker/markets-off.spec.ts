import { afterEach, describe, expect, it } from "vitest";

import { pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The markets pages with every switch "off" (the `worker-off` project, README "Switches"): `MARKETS` is page-level, so every view of the markets
// page and of a pair page is the not-found page, a 404 of class `short` made before any call (neither the path nor the query is read: no
// redirect, and no "not a pair" either), and the header's Markets is the "soon" label. The `worker` project's cases are markets-page.spec.ts and
// market-pair.spec.ts.

const { get, storedAs } = pageClient("198.51.108");

const RLUSD = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const EVR = "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8";

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

describe("the markets page with MARKETS off", () => {
  it.each([
    ["/xrpl/markets", "XRPL"],
    ["/xrpl/markets?period=7d", "XRPL"],
    ["/xrpl/markets?period=24h&quote=USD", "XRPL"],
    ["/xahau/markets", "Xahau"],
    // The pair page: the natural and the inverted orientation, a view, a page behind a marker, a path that would be redirected, one that is no
    // pair at all, and the route's own `.data` URL.
    [`/xrpl/markets/XRP/RLUSD.${RLUSD}`, "XRPL"],
    [`/xrpl/markets/RLUSD.${RLUSD}/XRP?interval=4h&trades=amm`, "XRPL"],
    [`/xrpl/markets/XRP/RLUSD.${RLUSD}?marker=WzEwNzY3MTU5MSwxNCwxXQ`, "XRPL"],
    [`/xrpl/markets/xrp/RLUSD+${RLUSD}?interval=1h`, "XRPL"],
    ["/xrpl/markets/XRP/XRP", "XRPL"],
    [`/xahau/markets/EVR.${EVR}/XAH`, "Xahau"],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path, name) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(textOf(html)).toContain(`We couldn’t find the markets pages on ${name}.`);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("answers the pair route's .data URL 404 as well, with no call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/markets/XRP/RLUSD.${RLUSD}.data?_routes=routes%2Fnet.markets.%24base.%24counter`);
    await response.text();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });

  it("shows Markets in the header as 'soon', a label and not a link", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl");
    const html = await response.text();

    expect(response.status, html.slice(0, 400)).toBe(200);
    expect(html).toContain('<span class="nav-item is-soon" aria-disabled="true"><span>Markets</span><span class="soon">soon</span></span>');
    expect(html).not.toContain('href="/xrpl/markets"');
  });
});
