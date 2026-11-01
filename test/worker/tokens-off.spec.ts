import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { anchors, hrefs, pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The token pages with every switch "off" (the `worker-off` project, README "Switches"), as production has them until the owner turns `TOKENS` on (token pages spec 1.4 and 13). `TOKENS` is
// page-level: every route of the token pages, and the link-preview image of a token, is a 404 of class `short` made before any call (neither the query nor the marker is read: no redirect, no
// "not a page"), and the header's Tokens item is the "soon" label. The `worker` project's cases, with the switch on, are the specs of the token pages; the later tasks add their routes'
// 404s, the token image and the places that link a token to this file.

const { get, page, storedAs } = pageClient("198.18.94");

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
  it("is the one with TOKENS off", () => {
    expect((env as unknown as Record<string, string>).TOKENS).toBe("off");
  });
});

describe("the token list with TOKENS off", () => {
  it.each([
    ["/xrpl/tokens", "XRPL"],
    ["/xahau/tokens?q=USD", "Xahau"],
    // A view that the list would redirect, one behind a marker, one with a marker that is none, and the path in another case: none of them is read.
    ["/xrpl/tokens?all=1&q=USD", "XRPL"],
    ["/xrpl/tokens?kind=mpt", "XRPL"],
    ["/xrpl/tokens?back=M1", "XRPL"],
    ["/xrpl/tokens?marker=WyJpc3N1ZWQiLDQ4XQ", "XRPL"],
    ["/xrpl/tokens?marker=%25", "XRPL"],
    [`/xrpl/tokens?q=${"x".repeat(65)}`, "XRPL"],
    ["/xrpl/TOKENS", "XRPL"],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path, name) => {
    mock = mockUpstream(path.startsWith("/xahau") ? "xahau" : "xrpl");
    const response = await get(path);
    const html = await response.text();

    expect(response.status, html.slice(0, 400)).toBe(404);
    expect(textOf(html)).toContain(`We couldn’t find the token pages on ${name}.`);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("answers the .data URL of the list (a client-side navigation) with a 404 too, and no call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl/tokens.data?_routes=routes%2Fnet.tokens");
    await response.text();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });
});

describe("a token's page with TOKENS off", () => {
  const RLUSD = "RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
  const USD = "usd.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";

  it.each([
    [`/xrpl/token/${RLUSD}`, "XRPL"],
    // Another spelling, a made-up query, a marker, a marker that is none, an LP token, the native currency and what names no token: none is read, so none redirects or answers more than the not-found page.
    [`/xrpl/token/${USD}`, "XRPL"],
    [`/xrpl/token/${RLUSD}?x=1&back=M`, "XRPL"],
    [`/xrpl/token/${RLUSD}?marker=WzEwNzY0NDkxNiw1NF0`, "XRPL"],
    [`/xrpl/token/${RLUSD}?marker=%25`, "XRPL"],
    ["/xrpl/token/03ABABABABABABABABABABABABABABABABABABAB.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", "XRPL"],
    ["/xrpl/token/XRP", "XRPL"],
    ["/xahau/token/XAH", "Xahau"],
    ["/xahau/token/EVR.rEvernodee8dJLaFsujS6q1EiXvZYmHXr8", "Xahau"],
    ["/xrpl/TOKEN/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", "XRPL"],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path, name) => {
    mock = mockUpstream(path.startsWith("/xahau") ? "xahau" : "xrpl");
    const response = await get(path);
    const html = await response.text();

    expect(response.status, html.slice(0, 400)).toBe(404);
    expect(textOf(html)).toContain(`We couldn’t find the token pages on ${name}.`);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("answers the .data URL of a token (a client-side navigation) with a 404 too, and no call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/token/${RLUSD}.data?_routes=routes%2Fnet.token.%24token`);
    await response.text();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });
});

describe("the holders of a token with TOKENS off", () => {
  const RLUSD = "RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
  const USD = "usd.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";

  it.each([
    [`/xrpl/token/${RLUSD}/holders`, "XRPL"],
    // Another spelling, a made-up query, a marker, a marker that is none, an LP token, the native currency and what names no token: none is read, so none redirects or answers more than the not-found page.
    [`/xrpl/token/${USD}/holders`, "XRPL"],
    [`/xrpl/token/${RLUSD}/holders?x=1&back=M`, "XRPL"],
    [`/xrpl/token/${RLUSD}/holders?marker=WzIyMDE5LjI1NTE1NywicndISDRNaVZ2ZkNoZHp5VXNBZUViblk3N3FjUzhGWHB5USJd`, "XRPL"],
    [`/xrpl/token/${RLUSD}/holders?marker=%25`, "XRPL"],
    ["/xrpl/token/03ABABABABABABABABABABABABABABABABABABAB.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De/holders", "XRPL"],
    ["/xrpl/token/XRP/holders", "XRPL"],
    ["/xahau/token/EVR.rEvernodee8dJLaFsujS6q1EiXvZYmHXr8/holders", "Xahau"],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path, name) => {
    mock = mockUpstream(path.startsWith("/xahau") ? "xahau" : "xrpl");
    const response = await get(path);
    const html = await response.text();

    expect(response.status, html.slice(0, 400)).toBe(404);
    expect(textOf(html)).toContain(`We couldn’t find the token pages on ${name}.`);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("answers the .data URL of the holders (a client-side navigation) with a 404 too, and no call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/xrpl/token/${RLUSD}/holders.data?_routes=routes%2Fnet.token.%24token.holders`);
    await response.text();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });
});

describe("the places that link a token with TOKENS off (E11 spec 5.2)", () => {
  // The recorded active accounts (test/fixtures/http): XRPL's holds LIONS, Xahau's EVR. Every switch is off here, NAMES included: no name header, no currencies of a toml; the Tokens card is
  // there, with its codes as text, as it was before E11.
  it.each([
    ["xrpl", "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", "LIONS"],
    ["xahau", "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto", "EVR"],
  ] as const)("draws the code of the %s account's trust line as text, with no link to a token page anywhere on the page", async (net, address, code) => {
    mock = mockUpstream(net);
    const { response, html } = await page(`/${net}/account/${address}`);

    expect(response.status).toBe(200);
    expect(textOf(html)).toContain(`${code} `);
    const name = /<div class="token__name"><span[^>]*>([^<]*)<\/span>/.exec(html);
    expect(name?.[1]).toBe(code);
    expect(hrefs(html).filter((href) => href.includes("/token/"))).toEqual([]);
    expect(html).not.toContain("tokenlink");
  });
});

describe("the link-preview image of a token with TOKENS off (E11 spec 7.2)", () => {
  const RLUSD = "RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";

  // Every id is the same 404 of class short, made before the id is read and before any call: another spelling, an LP token, the native currency and what names no token do not redirect or differ.
  it.each([
    [`/og/xrpl/token/${RLUSD}.png`],
    ["/og/xrpl/token/usd.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B.png"],
    ["/og/xrpl/token/03ABABABABABABABABABABABABABABABABABABAB.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De.png"],
    ["/og/xrpl/token/XRP.png"],
    ["/og/xrpl/token/hello.png"],
    ["/og/xahau/token/EVR.rEvernodee8dJLaFsujS6q1EiXvZYmHXr8.png"],
  ])("answers %s with a 404 of class short, no image and no call", async (path) => {
    mock = mockUpstream(path.startsWith("/og/xahau") ? "xahau" : "xrpl");
    const response = await get(path);
    const body = await response.arrayBuffer();

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(new TextDecoder().decode(body)).toContain("There is no such image.");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("is the 404 whatever the query: a query string is still a redirect to the bare path (class immutable), and the bare path is the 404", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/og/xrpl/token/${RLUSD}.png?x=1`);
    await response.arrayBuffer();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/og/xrpl/token/${RLUSD}.png`);
    expect(mock.requests).toEqual([]);
  });
});

describe("search with TOKENS off (E11 spec 5.3)", () => {
  const BITSTAMP = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";
  const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
  const LP = "03B245BE580EC4F4386A751C084489EC4B514A2F";
  const search = (net: string, q: string) => `/${net}/search?q=${encodeURIComponent(q)}`;

  // The help page it was: what could be typed, the box holding it, and no word of a token anywhere. Asks nothing of anyone, and sends nowhere.
  it.each([
    ["xrpl", `USD.${BITSTAMP}`, "XRPL"],
    ["xrpl", `usd+${BITSTAMP}`, "XRPL"],
    ["xrpl", "RLUSD", "XRPL"],
    ["xrpl", `${LP}+${POOL}`, "XRPL"],
    ["xahau", "EVR.rEvernodee8dJLaFsujS6q1EiXvZYmHXr8", "Xahau"],
  ])("answers a search on %s for %s with today's help page, no link to a token and no call", async (net, q, name) => {
    mock = mockUpstream(net === "xahau" ? "xahau" : "xrpl");
    const response = await get(search(net, q));
    const html = await response.text();
    const text = textOf(html);

    expect(response.status, html.slice(0, 400)).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(text).toContain(`Nothing on ${name} looks like “${q}”.`);
    expect(text).toContain("An account address, starting with r, or an X-address");
    expect(text).not.toMatch(/A token: its code and issuer|among tokens/);
    expect(hrefs(html).filter((href) => /\/tokens?(\/|\?|$)/.test(href))).toEqual([]);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(search(net, q))).toEqual(SHORT);
  });
});

describe("the header with TOKENS off", () => {
  const SOON = '<span class="nav-item is-soon" aria-disabled="true"><span>Tokens</span><span class="soon">soon</span></span>';

  it("the header's Tokens item is the soon label", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl");

    expect(html).toContain(SOON);
    expect(html).not.toMatch(/href="\/(xrpl|xahau)\/tokens"/);
    expect(anchors(html).map((a) => a.text)).not.toContain("Tokens");
    // Between Transactions and Network, where the link is when it is on.
    expect(html.indexOf(SOON)).toBeGreaterThan(html.indexOf(">Transactions</a>"));
    expect(html.indexOf(SOON)).toBeLessThan(html.indexOf(">Network</a>"));
  });
});
