import { afterEach, describe, expect, it } from "vitest";

import { pageClient, textOf } from "../support/pages";
import { tokenCase } from "../support/token-cases";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The token pages in the sandbox (the `worker-sandbox` project: `ENVIRONMENT` "sandbox", README "Tokens", E7 §16): every network name is the layout's, so a page says XRPL Testnet and Xahau
// Testnet and never "the XRP Ledger" or "mainnet", and the words follow the network's kind (a DEX and AMM on XRPL, a DEX alone on Xahau). The data is the recorded mainnet data standing in
// for the testnets' (the bindings are the top level's, `TOKENS` on), so only what a page says per network is asserted here. (The card's pill is `tokenCard`'s, pinned in card-data.test.ts.)

const { page } = pageClient("198.51.102");

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

describe("the list in the sandbox", () => {
  it("/xrpl/tokens: the intro names XRPL Testnet, and the title, the description, the breadcrumb and the volume's words follow", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/tokens");
    const text = textOf(html);

    expect(tagsOf(html)).toEqual({
      title: "Tokens · XRPL Testnet · explorer",
      description: "Issued tokens on XRPL Testnet, ranked by holders: supply, price, 24-hour volume and whether each issuer's toml lists it.",
    });
    expect(text).toContain("Tokens on XRPL Testnet, ranked by holders. Names come from each issuer's toml.");
    expect(text).toContain("XRPL Testnet / Tokens");
    expect(text).toContain("DEX and AMM trades of every pair");
    expect(text).not.toContain("XRP Ledger");
    expect(text).not.toContain("mainnet");
  });

  it("/xahau/tokens: Xahau Testnet, and a DEX alone", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/tokens");
    const text = textOf(html);

    expect(tagsOf(html).title).toBe("Tokens · Xahau Testnet · explorer");
    expect(text).toContain("Tokens on Xahau Testnet, ranked by holders. Names come from each issuer's toml.");
    expect(text).toContain("Xahau Testnet / Tokens");
    expect(text).toContain("DEX trades of every pair");
    expect(text).not.toContain("mainnet");
  });
});

describe("a token in the sandbox", () => {
  it("/xrpl/token/{token}: the title and the description name XRPL Testnet, and so does the breadcrumb", async () => {
    const rlusd = await tokenCase("xrpl", "rlusd");
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/token/${rlusd.path}`);

    expect(tagsOf(html)).toEqual({
      title: "Ripple USD (RLUSD) · XRPL Testnet · explorer",
      description: "RLUSD, issued by rMxCKb…m5De on XRPL Testnet: holders, supply, price, markets, the issuer's settings and recent transfers.",
    });
    expect(textOf(html)).toContain("XRPL Testnet / Tokens / RLUSD");
    expect(textOf(html)).not.toContain("XRP Ledger");
    expect(textOf(html)).not.toContain("mainnet");
  });

  it("/xahau/token/{token}: Xahau Testnet has no AMM, and says so in the place of the pools, with its own toml file", async () => {
    const evr = await tokenCase("xahau", "evr");
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/token/${evr.path}`);
    const text = textOf(html);

    expect(tagsOf(html).title).toBe("Evernode (EVR) · Xahau Testnet · explorer");
    expect(text).toContain("Xahau Testnet / Tokens / EVR");
    expect(text).toContain("Xahau Testnet has no AMM, so EVR trades only on the order book here.");
    expect(text).toContain("xahau.toml");
    expect(text).not.toContain("mainnet");
  });

  it("/xahau/token/{token}/holders: the title names Xahau Testnet", async () => {
    const evr = await tokenCase("xahau", "evr");
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/token/${evr.path}/holders`);

    expect(tagsOf(html).title).toBe("Holders of EVR · Xahau Testnet · explorer");
    expect(textOf(html)).toContain("Xahau Testnet / Tokens / EVR / Holders");
  });

  it("/xrpl/token/{token}: a token nobody has is told on XRPL Testnet", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/token/ZZZ.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq", 404);

    expect(textOf(html)).toContain("We couldn’t find ZZZ issued by rhub8V…F3wq on XRPL Testnet.");
  });
});
