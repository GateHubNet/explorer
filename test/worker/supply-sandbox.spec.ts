import { afterEach, describe, expect, it } from "vitest";

import { pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The supply page in the sandbox (the `worker-sandbox` project: `ENVIRONMENT` "sandbox", README "The supply page", E7 §16): the network names are the layout's, so the page says XRPL Testnet and Xahau
// Testnet and never "the XRP Ledger" or "mainnet". XRPL Testnet's genesis also created 100 billion XRP, so the XRPL texts hold; Xahau Testnet has no AMM and says so by its name. The data is the recorded
// mainnet data standing in for the testnets' (the bindings are the top level's, `SUPPLY` on), so only what the page says per network is asserted here. (The figures are supply-view.test.ts's.)

const { page } = pageClient("198.51.103");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

/** The `<title>` of a page and the content of its `<meta name="description">` (the HTML escapes an apostrophe). */
const tagsOf = (html: string) => ({
  title: /<title>([^<]*)<\/title>/.exec(html)?.[1],
  description: /<meta\s[^>]*name="description"[^>]*content="([^"]*)"/.exec(html)?.[1]?.replaceAll("&#x27;", "'"),
});

describe("the supply page in the sandbox", () => {
  it("/xrpl/supply: the title, the breadcrumb and the bar name XRPL Testnet, and the 100 billion XRP stand", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/supply");
    const text = textOf(html);

    expect(tagsOf(html).title).toBe("Supply · XRPL Testnet · explorer");
    expect(tagsOf(html).description).toMatch(/^XRP supply at ledger #107,720,688: /);
    expect(text).toContain("XRPL Testnet / Network / Supply");
    expect(text).toContain("Where the 100 billion XRP are");
    expect(text).toContain("100,000,000,000 XRP were created in the first ledger and no more can be made.");
    expect(text).toContain("In AMM pools");
    expect(text).not.toContain("XRP Ledger");
    expect(text).not.toContain("mainnet");
  });

  it("/xahau/supply: Xahau Testnet, XAH, the Minted tile and no AMM, said by its name", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/supply");
    const text = textOf(html);

    expect(tagsOf(html).title).toBe("Supply · Xahau Testnet · explorer");
    expect(text).toContain("Xahau Testnet / Network / Supply");
    expect(text).toContain("How much XAH exists, how much is minted, burned and escrowed, and how much circulates.");
    expect(text).toContain("Where the XAH are");
    expect(text).toContain("Xahau Testnet has no 100 billion cap: its supply grows by minting");
    expect(text).toContain("Minted, last 90 days");
    expect(text).toContain("no AMM on Xahau Testnet");
    expect(text).not.toContain("In AMM pools");
    expect(text).not.toContain("mainnet");
  });
});
