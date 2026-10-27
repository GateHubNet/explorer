import { afterEach, describe, expect, it } from "vitest";

import { anchors, pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The NFT pages with every switch "off" (the `worker-off` project, README "Switches"), as production has them until the owner turns `NFTS` on (NFT spec 1.4, 15). `NFTS` is
// page-level: every route of the NFT pages is a 404 of class `short` made before any call (neither the path's other segments nor the query is read: no redirect, no "not a
// collection"), and the header's NFTs item is the "soon" label. The `worker` project's cases, with the switch on, are nfts-list.spec.ts and the specs of the later NFT pages;
// the later pages add their routes and their other places (the image, the account's tab, plain ids, search) to this file.

const { get, page, storedAs } = pageClient("198.18.62");

const SHORT = { cls: "short", ttl: 30 };

let mock: UpstreamMock | undefined;
afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  expect(unused ?? []).toEqual([]);
});

describe("the NFT list and the older sales with NFTS off", () => {
  it.each([
    ["/xrpl/nfts", "NFT", "XRPL"],
    ["/xahau/nfts?period=7day", "URIToken", "Xahau"],
    ["/xrpl/nfts/sales", "NFT", "XRPL"],
    ["/xahau/nfts/sales", "URIToken", "Xahau"],
    // A view that the list would redirect, one behind a marker, one with an issuer that is no address, and one whose marker is none: none of them is read.
    ["/xrpl/nfts?order=desc&sort=volume", "NFT", "XRPL"],
    ["/xrpl/nfts?x=1&period=7day", "NFT", "XRPL"],
    ["/xrpl/nfts?back=M1", "NFT", "XRPL"],
    ["/xrpl/nfts?marker=WzAsInI0cUhNN3ZXZUxUdFdQVm9FekRqVDZBc2twUWpTbXVpN0IiLDBd", "NFT", "XRPL"],
    ["/xrpl/nfts?marker=%25", "NFT", "XRPL"],
    ["/xrpl/nfts?issuer=nope", "NFT", "XRPL"],
    ["/xrpl/nfts/sales?marker=WzEwNzg4NjE2Myw4MywxXQ", "NFT", "XRPL"],
    ["/xrpl/nfts/sales?x=1", "NFT", "XRPL"],
    ["/xrpl/nfts/sales?marker=%25", "NFT", "XRPL"],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path, word, name) => {
    mock = mockUpstream(path.startsWith("/xahau") ? "xahau" : "xrpl");
    const response = await get(path);
    const html = await response.text();

    expect(response.status, html.slice(0, 400)).toBe(404);
    expect(textOf(html)).toContain(`We couldn’t find the ${word} pages on ${name}.`);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it.each([
    ["the list", "/xrpl/nfts.data?_routes=routes%2Fnet.nfts._index"],
    ["the older sales", "/xrpl/nfts/sales.data?_routes=routes%2Fnet.nfts.sales"],
  ])("answers the .data URL of %s (a client-side navigation) with a 404 too, and no call", async (_what, path) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    await response.text();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });
});

describe("the header with NFTS off", () => {
  it.each(["/xrpl", "/xahau"])("shows NFTs on %s as 'soon', a label and not a link", async (path) => {
    mock = mockUpstream(path === "/xrpl" ? "xrpl" : "xahau");
    const { html } = await page(path);

    expect(html).toContain('<span class="nav-item is-soon" aria-disabled="true"><span>NFTs</span><span class="soon">soon</span></span>');
    expect(html).not.toMatch(/href="\/(xrpl|xahau)\/nfts"/);
    expect(anchors(html).map((a) => a.text)).not.toContain("NFTs");
  });
});
