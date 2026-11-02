import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The supply page with every switch "off" (the `worker-off` project, README "Switches"), as production has it until the owner turns `SUPPLY` on (supply spec 1 and 7, decision 11): the route is a 404 of
// class `short` made before the query is read and before any call, on both networks and for the page's `.data` URL. The `worker` project's cases, with the switch on, are supply-page.spec.ts.

const { get, storedAs } = pageClient("198.18.114");

const SHORT = { cls: "short", ttl: 30 };

let mock: UpstreamMock | undefined;
afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  expect(unused ?? []).toEqual([]);
});

describe("the project", () => {
  it("is the one with SUPPLY off", () => {
    expect((env as unknown as Record<string, string>).SUPPLY).toBe("off");
  });
});

describe("the supply page with SUPPLY off", () => {
  it.each([
    ["/xrpl/supply", "XRPL"],
    ["/xahau/supply", "Xahau"],
    // A made-up query is not read: no redirect to the one URL, only the not-found page.
    ["/xrpl/supply?x=1", "XRPL"],
    ["/xahau/supply?period=1y&marker=A", "Xahau"],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path, name) => {
    mock = mockUpstream(path.startsWith("/xahau") ? "xahau" : "xrpl");
    const response = await get(path);
    const html = await response.text();

    expect(response.status, html.slice(0, 400)).toBe(404);
    expect(textOf(html)).toContain(`We couldn’t find the supply page on ${name}.`);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("answers the .data URL of the page (a client-side navigation) with a 404 too, and no call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl/supply.data?_routes=routes%2Fnet.supply");
    await response.text();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });
});

describe("the menu with every switch off", () => {
  it("the menu's Supply item reads soon, in the header's soon style, as a span and not a link", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<span class="menu__item is-soon" aria-disabled="true">Supply <span class="soon">soon</span></span>');
    expect(html).not.toMatch(/href="\/(xrpl|xahau)\/supply"/);
    // Overview never reads soon.
    expect(html).toMatch(/<a class="menu__item" href="\/xrpl\/network"/);
    expect(html).toContain('<details class="menu" data-menu="network">');
  });
});
