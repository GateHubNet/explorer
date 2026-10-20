import { afterEach, describe, expect, it } from "vitest";

import { pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The markets page with every switch "off" (the `worker-off` project, README "Switches"): `MARKETS` is page-level, so every view of it is the
// not-found page, a 404 of class `short` made before any call (the query is not even read: no redirect either), and the header's Markets is the
// "soon" label. The `worker` project's cases are markets-page.spec.ts.

const { get, storedAs } = pageClient("198.51.108");

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

  it("shows Markets in the header as 'soon', a label and not a link", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl");
    const html = await response.text();

    expect(response.status, html.slice(0, 400)).toBe(200);
    expect(html).toContain('<span class="nav-item is-soon" aria-disabled="true"><span>Markets</span><span class="soon">soon</span></span>');
    expect(html).not.toContain('href="/xrpl/markets"');
  });
});
