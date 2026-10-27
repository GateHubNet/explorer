import { afterEach, describe, expect, it } from "vitest";

import { shortAddress } from "../../app/domain/format";
import { anchors, elementText, hrefs, pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The NFT pages with every switch "off" (the `worker-off` project, README "Switches"), as production has them until the owner turns `NFTS` on (NFT spec 1.4, 15). `NFTS` is
// page-level: every route of the NFT pages, and the link-preview image of an NFT, is a 404 of class `short` made before any call (neither the path's other segments nor the query is
// read: no redirect, no "not a collection", no "not an id"), and the header's NFTs item is the "soon" label. The `worker` project's cases, with the switch on, are nfts-list.spec.ts and the specs of the later NFT pages;
// the later pages add their routes and their other places (the image, the account's tab, plain ids, search) to this file.

const { get, page, storedAs } = pageClient("198.18.62");

const SHORT = { cls: "short", ttl: 30 };
const ISSUER = "rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy";
/** An NFT id, and a URIToken's. */
const NFT_ID = "00190BB8DAEF366CB05EE8DCC919EF9A1AA24DD22B3D62C9D848920A0669E96F";
const URI_ID = "9613336614047483F3AEC00173139D88FE9BA70720CAC2B46E12711A71A9AAE9";

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
    // A collection: a path that the page would redirect (the other network's form of the key, a taxon with leading zeros, a path in another case), one it would refuse (an issuer
    // that is no address, a taxon that is none), and a view with a marker, a query to tidy and an owner that is no address.
    [`/xrpl/nfts/${ISSUER}/1`, "NFT", "XRPL"],
    ["/xahau/nfts/rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb", "URIToken", "Xahau"],
    [`/xrpl/nfts/${ISSUER}`, "NFT", "XRPL"],
    [`/xrpl/nfts/${ISSUER}/01`, "NFT", "XRPL"],
    [`/xahau/nfts/${ISSUER}/1`, "URIToken", "Xahau"],
    [`/xrpl/NFTs/${ISSUER}/1`, "NFT", "XRPL"],
    ["/xrpl/nfts/rBad/1", "NFT", "XRPL"],
    [`/xrpl/nfts/${ISSUER}/4294967296`, "NFT", "XRPL"],
    [`/xrpl/nfts/${ISSUER}/x`, "NFT", "XRPL"],
    [`/xrpl/nfts/${ISSUER}/1?tab=holders&x=1`, "NFT", "XRPL"],
    [`/xrpl/nfts/${ISSUER}/1?marker=%25`, "NFT", "XRPL"],
    [`/xrpl/nfts/${ISSUER}/1?tab=nfts&owner=nope&marker=AAAA`, "NFT", "XRPL"],
    // An NFT: its page, the id in lower case (which the page would redirect), a query to tidy, a marker that is none, an id that is none, and a URIToken.
    [`/xrpl/nft/${NFT_ID}`, "NFT", "XRPL"],
    [`/xrpl/nft/${NFT_ID.toLowerCase()}`, "NFT", "XRPL"],
    [`/xrpl/nft/${NFT_ID}?offers=1`, "NFT", "XRPL"],
    [`/xrpl/nft/${NFT_ID}?x=1&offers=0`, "NFT", "XRPL"],
    [`/xrpl/nft/${NFT_ID}?marker=%25`, "NFT", "XRPL"],
    [`/xrpl/nft/${NFT_ID}?offers=1&marker=WzEwNzg3ODc3NSwxMzAsMF0`, "NFT", "XRPL"],
    ["/xrpl/nft/nope", "NFT", "XRPL"],
    [`/xahau/nft/${URI_ID}`, "URIToken", "Xahau"],
    [`/xahau/nft/${URI_ID.toLowerCase()}?x=1`, "URIToken", "Xahau"],
    ["/xahau/nft/nope", "URIToken", "Xahau"],
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
    ["a collection", `/xrpl/nfts/${ISSUER}/1.data?_routes=routes%2Fnet.nfts.%24issuer.%24taxon`],
    ["a Xahau collection", "/xahau/nfts/rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb.data?_routes=routes%2Fnet.nfts.%24issuer.%24taxon"],
    ["an NFT", `/xrpl/nft/${NFT_ID}.data?_routes=routes%2Fnet.nft.%24id`],
    ["an NFT in lower case", `/xrpl/nft/${NFT_ID.toLowerCase()}.data?_routes=routes%2Fnet.nft.%24id`],
    ["a URIToken", `/xahau/nft/${URI_ID}.data?_routes=routes%2Fnet.nft.%24id`],
  ])("answers the .data URL of %s (a client-side navigation) with a 404 too, and no call", async (_what, path) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    await response.text();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });
});

describe("the link-preview image of an NFT with NFTS off", () => {
  it.each([
    ["an NFT", `/og/xrpl/nft/${NFT_ID}.png`, "xrpl"],
    ["a URIToken", `/og/xahau/nft/${URI_ID}.png`, "xahau"],
    // What the image would redirect or refuse is not read: the id in lower case (a 302 with the switch on), and an id that is none.
    ["an NFT id in lower case", `/og/xrpl/nft/${NFT_ID.toLowerCase()}.png`, "xrpl"],
    ["an id that is none", "/og/xrpl/nft/nope.png", "xrpl"],
  ] as const)("answers %s with a 404 of class short that is no image, noindex, and asks nothing upstream", async (_what, path, net) => {
    mock = mockUpstream(net);
    const response = await get(path);
    await response.arrayBuffer();

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("answers a path with a query with the redirect to the bare path, as every image does: it is not an NFT page", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/og/xrpl/nft/${NFT_ID}.png?a=1`);
    await response.arrayBuffer();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/og/xrpl/nft/${NFT_ID}.png`);
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

describe("the NFTs of a transaction with NFTS off", () => {
  // The recorded NFTokenAcceptOffer and NFTokenMint of transaction.spec.ts, where the same ids are links.
  const ACCEPT = "423839F3B288D53874DAECE9AE3ACCE2A23E20E2C16E5DA594F425907D9E2052";
  const ACCEPTED = "00081388AF09C1D4B4D1E8031467F3508DFFADABEA73255F370449870655E6D8";
  const MINT = "7D16D6C749CAB260C906BEC2D9CF9B37F7D1D36F26421873CF838C9BCDF056AD";
  const MINTED = "00081388AF09C1D4B4D1E8031467F3508DFFADABEA73255FA9ECC9070655E758";

  it("shows the NFT of an accepted offer as its short id in mono with the whole id as the title, and no link to an NFT page", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${ACCEPT}`);

    expect(anchors(html).filter((a) => /href="\/(xrpl|xahau)\/nft\//.test(a.attrs))).toEqual([]);
    expect(hrefs(html).some((href) => href.includes("/nft/"))).toBe(false);
    expect(html).toContain(`<span class="mono" title="${ACCEPTED}">00081388…E6D8</span>`);
    expect(textOf(html)).toContain("NFT 00081388…E6D8");
  });

  it("reads 'minted NFT …' with the id as text, in the sentence and in the details", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${MINT}`);

    expect(elementText(html, "sentence")).toBe(`${shortAddress("rKqqb5QZXVAL3VqXJL6obfRGeHou1DtyBV")} minted NFT 00081388…E758, taxon 500, transfer fee 5%.`);
    expect(html.split(`<span class="mono" title="${MINTED}">00081388…E758</span>`)).toHaveLength(3);
    expect(hrefs(html).some((href) => href.includes("/nft/"))).toBe(false);
  });
});
