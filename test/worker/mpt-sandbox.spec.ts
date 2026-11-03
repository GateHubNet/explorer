import { afterEach, describe, expect, it } from "vitest";

import { MPT_FIXTURE_IDS } from "../support/mpt-case-rules";
import { pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The MPT pages in the sandbox (the `worker-sandbox` project: `ENVIRONMENT` "sandbox", README "MPT pages", E7 §16): every network name is the layout's, so a page says XRPL Testnet and Xahau Testnet and
// never "the XRP Ledger" or "mainnet". The data is the recorded mainnet data standing in for the testnets' (the bindings are the top level's, `MPT` on), so only what a page says per network is asserted
// here. The page that says MPT is not on Xahau leads to the same path on XRPL Testnet (E14 spec 3.6).

const { get, page } = pageClient("198.51.105");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

const ID = MPT_FIXTURE_IDS.htf;

/** The `<title>` of a page and the content of its `<meta name="description">` (the HTML escapes an apostrophe). */
const tagsOf = (html: string) => ({
  title: /<title>([^<]*)<\/title>/.exec(html)?.[1]?.replaceAll("&#x27;", "'"),
  description: /<meta\s[^>]*name="description"[^>]*content="([^"]*)"/.exec(html)?.[1]?.replaceAll("&#x27;", "'"),
});

describe("an MPT issuance in the sandbox", () => {
  it("/xrpl/mpt/{ID}: the title and the description name XRPL Testnet, and so does the breadcrumb", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/mpt/${ID}`);
    const text = textOf(html);

    const { title, description } = tagsOf(html);
    expect(title).toBe("XAU · Tokenized Gold (XAU) · MPT · XRPL Testnet · explorer");
    expect(description).toMatch(/^MPT issued by r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}: 61,234,499\.9968 XAU outstanding, 63 holders · XRPL Testnet$/);
    expect(text).toContain("XRPL Testnet / Tokens / XAU");
    expect(text).not.toContain("XRP Ledger");
    expect(text).not.toContain("mainnet");
  });

  it("/xahau/mpt/{ID}: Xahau Testnet has no MPT, and says so, with a link to the same path on XRPL Testnet", async () => {
    mock = mockUpstream("xahau");
    const response = await get(`/xahau/mpt/${ID}`);
    const html = await response.text();
    const text = textOf(html);

    expect(response.status).toBe(404);
    expect(tagsOf(html).title).toBe("MPT isn't enabled on Xahau Testnet · Xahau Testnet · explorer");
    expect(text).toContain("MPT isn't enabled on Xahau Testnet");
    expect(text).toContain("MPTs exist only on XRPL Testnet, so there is nothing at this issuance ID on Xahau Testnet.");
    expect(text).toContain("Xahau Testnet / Tokens / MPT");
    expect(html).toContain(`href="/xrpl/mpt/${ID}"`);
    expect(text).toContain("Open it on XRPL Testnet");
    expect(text).not.toContain("mainnet");
    expect(mock.requests).toEqual([]);
  });
});

// E14 spec 4 and ruling C26: the MPT tab of the token list says XRPL Testnet in the sandbox, in the intro, the first tile, the tags and the breadcrumb; Xahau Testnet has no such tab, and its `?kind=mpt` is a
// redirect to the issued list.
describe("the MPT tab in the sandbox", () => {
  it("/xrpl/tokens?kind=mpt: the intro, the tile, the title, the description and the breadcrumb name XRPL Testnet", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/tokens?kind=mpt");
    const text = textOf(html);

    expect(tagsOf(html)).toEqual({ title: "MPTs · XRPL Testnet · explorer", description: "MPT issuances on XRPL Testnet, ranked by holders." });
    expect(text).toContain("Tokens on XRPL Testnet, ranked by holders. Tickers and names come from each issuance's metadata.");
    expect(text).toContain("on XRPL Testnet, with any number of holders");
    expect(text).toContain("XRPL Testnet / Tokens");
    expect(text).not.toContain("XRP Ledger");
    expect(text).not.toContain("mainnet");
  });

  it("/xahau/tokens?kind=mpt: Xahau Testnet has no MPT, so the address is a redirect to its issued list, with no call", async () => {
    mock = mockUpstream("xahau");
    const response = await get("/xahau/tokens?kind=mpt");
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xahau/tokens");
    expect(mock.requests).toEqual([]);
  });
});
