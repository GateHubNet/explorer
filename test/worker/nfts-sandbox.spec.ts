import { afterEach, describe, expect, it, vi } from "vitest";

import * as render from "../../app/og/render";
import { collectionCase, nftCase } from "../support/nft-cases";
import { anchors, pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The NFT pages in the sandbox (the `worker-sandbox` project: `ENVIRONMENT` "sandbox", README "NFTs", E7 §16): every network name is the layout's, so a page says XRPL Testnet and
// Xahau Testnet and never "the XRP Ledger" or "mainnet", and the words follow the network's kind (NFT on XRPL, URIToken on Xahau). The data is the recorded mainnet data standing in for
// the testnets' (the bindings are the top level's, `NFTS` on), so only what a page says per kind of network is asserted here. (An NFT's page, its title, its breadcrumb and its image's
// pill are also in environment-sandbox.spec.ts, with the other pages that name their network.)

const { page, get } = pageClient("198.51.101");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

/** The `<title>` of a page and the content of its `<meta name="description">`. */
const tagsOf = (html: string) => ({
  title: /<title>([^<]*)<\/title>/.exec(html)?.[1],
  description: /<meta\s[^>]*name="description"[^>]*content="([^"]*)"/.exec(html)?.[1],
});

describe("the list in the sandbox", () => {
  it("/xrpl/nfts: the intro names XRPL Testnet, and the title, the description and the breadcrumb follow", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/nfts");
    const text = textOf(html);

    expect(tagsOf(html).title).toBe("NFTs · XRPL Testnet · explorer");
    expect(tagsOf(html).description).toBe("NFTs on XRPL Testnet: the sales volume, the largest collections and the latest sales.");
    expect(text).toContain("Non-fungible tokens (NFTokens) on XRPL Testnet: sales, collections and their holders. A collection is an issuer and a taxon.");
    expect(text).toContain("XRPL Testnet / NFTs");
    expect(text).not.toContain("XRP Ledger");
    expect(text).not.toContain("mainnet");
  });

  it("/xahau/nfts: URITokens on Xahau Testnet", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/nfts");
    const text = textOf(html);

    expect(tagsOf(html).title).toBe("URITokens · Xahau Testnet · explorer");
    expect(text).toContain("URITokens, the non-fungible tokens of Xahau Testnet: sales, collections and their holders. A collection is everything one issuer minted.");
    expect(text).toContain("Xahau Testnet / URITokens");
    expect(text).not.toContain("mainnet");
  });

  it.each([
    ["xrpl", "NFT sales · XRPL Testnet · explorer", "The latest NFT sales on XRPL Testnet, newest first."],
    ["xahau", "URIToken sales · Xahau Testnet · explorer", "The latest URIToken sales on Xahau Testnet, newest first."],
  ] as const)("/%s/nfts/sales: the title and the description say %s", async (net, title, description) => {
    mock = mockUpstream(net);
    const { html } = await page(`/${net}/nfts/sales?marker=${net === "xrpl" ? "WzEwNzg4MTUzMCwxNjIsMV0" : "WzI2NzYzNjI5LDE1LDFd"}`);

    expect(tagsOf(html)).toEqual({ title, description });
  });
});

describe("a collection in the sandbox", () => {
  it("/xrpl/nfts/{issuer}/{taxon}: the title names XRPL Testnet, and a collection nobody has is told on XRPL Testnet", async () => {
    const featured = await collectionCase("xrpl", "featured");
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/nfts/${featured.issuer}/${featured.taxon}`);

    expect(tagsOf(html).title).toBe("Collection rLxc1b…rwMy · taxon 0 · XRPL Testnet · explorer");
    expect(textOf(html)).toContain("XRPL Testnet / NFTs / rLxc1b…rwMy · taxon 0");
    expect(textOf(html)).not.toContain("XRP Ledger");

    const missing = await page(`/xrpl/nfts/${featured.issuer}/4294967295`, 404);
    expect(textOf(missing.html)).toMatch(/We couldn’t find .* on XRPL Testnet\./);
  });

  it("/xahau/nfts/{issuer}: the title names Xahau Testnet", async () => {
    const featured = await collectionCase("xahau", "featured");
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/nfts/${featured.issuer}`);

    expect(tagsOf(html).title).toBe("URITokens of rodinG…zKyb · Xahau Testnet · explorer");
    expect(textOf(html)).toContain("Xahau Testnet / URITokens / rodinG…zKyb");
  });
});

describe("an NFT in the sandbox", () => {
  it("/xrpl/nft/{id}: an NFT nobody has is told 'on XRPL Testnet', and offers the same search on Xahau Testnet", async () => {
    const { id } = await nftCase("xrpl", "missing");
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/nft/${id}`, 404);

    expect(textOf(html)).toContain(`We couldn’t find NFT ${id.slice(0, 8)}…${id.slice(-4)} on XRPL Testnet.`);
    expect(anchors(html).find((a) => a.text === "Search on Xahau Testnet")?.attrs).toContain(`href="/xahau/search?q=${id}"`);
  });

  it.each([
    ["xrpl", "XRPL Testnet", "NFT"],
    ["xahau", "Xahau Testnet", "URIToken"],
  ] as const)("/og/%s/nft/{id}.png: the pill of the card is %s", async (net, label, token) => {
    const { id } = await nftCase(net, "featured");
    mock = mockUpstream(net);
    const drawing = vi.spyOn(render, "renderCard");
    try {
      const response = await get(`/og/${net}/nft/${id}.png`);
      await response.arrayBuffer();

      expect(response.status).toBe(200);
      expect(drawing.mock.calls[0]![0]).toMatchObject({ network: net, networkLabel: label, footer: [{ text: `${token} on ${label}` }] });
    } finally {
      drawing.mockRestore();
    }
  });
});

describe("the search in the sandbox", () => {
  it("a hash nothing has says what was looked for on XRPL Testnet, NFT and objects included", async () => {
    mock = mockUpstream("xrpl");
    const hash = "7D".repeat(32);
    const { html } = await page(`/xrpl/search?q=${hash}`, 404);

    expect(textOf(html)).toContain("We couldn’t find transaction, ledger, NFT, escrow, check or payment channel 7D7D7D…7D7D on XRPL Testnet.");
    expect(anchors(html).find((a) => a.text === "Search on Xahau Testnet")?.attrs).toContain(`href="/xahau/search?q=${hash}"`);
  });
});
