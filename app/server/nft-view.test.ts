import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Segment } from "../domain/describe";
import { dropsToNative, formatAmount, shortAddress } from "../domain/format";
import { decodeNftId } from "../domain/nft-id";
import { ARROW, nftHref, type NftQuery } from "../domain/nft-params";
import {
  coverageSample,
  NFT_BROKER,
  NFT_ID,
  NFT_ISSUER,
  NFT_MARKER,
  NFT_OWNER,
  NFT_SELLER,
  NFT_TX_HASH,
  nftAnswerSample,
  nftEventSample,
  nftEventsPageSample,
  nftOfferSample,
  nftOffersPageSample,
  nftSample,
  NODE_NFT_ID,
  nodeNftInfoSample,
  nodeUriTokenSample,
  OTHER_ISSUER,
  uriTokenSample,
  URI_TOKEN_ID,
  URI_TOKEN_ISSUER,
  URI_TOKEN_OWNER,
} from "../../test/support/nft-samples";
import { nftCase } from "../../test/support/nft-cases";
import { encodeNftId } from "../../test/support/nft-case-rules";
import type { Nft, NftAnswer, NftEvent, NftEventsPage, NftOffer, NodeNftInfo, NodeNftOffers, NodeUriToken } from "./api-types";
import { CACHE_CLASSES } from "./cache-class";
import { TooLate } from "./deadline";
import {
  drawnAccounts,
  historyRows,
  needsNode,
  nftMarkerPage,
  nftFacts,
  nftModeOf,
  nftNotFound,
  nftPage,
  NFT_MODE_CLASS,
  offerRows,
  type NftHistoryRow,
  type NftMode,
  type NftNet,
  type NftPageInput,
  type NftPageMode,
} from "./nft-view";
import { searchOnOther } from "./search-view";
import { UpstreamError } from "./upstream";

// ---- The world of the tests -----------------------------------------------------------------------------------------------------------------------

const XRPL: NftNet = { id: "xrpl", name: "XRPL", native: "XRP", longName: "the XRP Ledger", other: "xahau" };
const XRPL_TESTNET: NftNet = { id: "xrpl", name: "XRPL Testnet", native: "XRP", longName: "XRPL Testnet", other: "xahau" };
const XAHAU: NftNet = { id: "xahau", name: "Xahau", native: "XAH", longName: "Xahau", other: "xrpl" };
const XAHAU_TESTNET: NftNet = { id: "xahau", name: "Xahau Testnet", native: "XAH", longName: "Xahau Testnet", other: "xrpl" };

/** The loader's clock: Oct 25, 2026 at 00:00 UTC, in unix seconds. The fixtures' offers expire around it, so every test that reads an expiry pins it. */
const NOW = Date.UTC(2026, 9, 25) / 1000;

const fulfilled = <T>(value: T): PromiseFulfilledResult<T> => ({ status: "fulfilled", value });
const rejected = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });

const NOT_FOUND = new UpstreamError("not_found", "nft not found", { status: 404 });
const FAILURES: Array<[string, unknown]> = [
  ["a 5xx", new UpstreamError("server", "answered 503", { status: 503 })],
  ["a 429", new UpstreamError("rate_limited", "answered 429", { status: 429, retryAfter: 3 })],
  ["a malformed 200", new UpstreamError("server", "answered something unexpected", { status: 200 })],
  ["a Cannot GET", new UpstreamError("server", "Cannot GET /v2/nfts/X", { status: 404 })],
  ["a timeout", new UpstreamError("timeout", "did not answer within 3000 ms")],
  ["a connection failure", new UpstreamError("network", "connection failed")],
  ["a TooLate", new TooLate()],
  ["a bug", new TypeError("x is not a function")],
];

const QUERY: NftQuery = { offers: false, back: [] };
const MARKERS = { M1: "WzEwNzg4NjE2Myw4MywxXQ", M2: "WzEwNzg4MTUzMCwxNjIsMV0" };
const HASH_A = "3D9B20E130D7498E98FB3499BD4C2AC4CCDB3D11FFBFEA8F9B7FB844DDF33426";
const HASH_B = "BADF36AA20CD32067693C83EE5755BEFB8D1A1E82DEE83E1E67FFD6100712E56";
const LABEL = `${shortAddress(NFT_ISSUER)} · taxon 10`;
const WHOLE = coverageSample({ complete: true });

/** What a cell says, as the page would show it: text as it is, an account shortened, an amount grouped with its currency. */
const said = (segments: readonly Segment[]): string =>
  segments
    .map((segment) =>
      segment.t === "text"
        ? segment.v
        : segment.t === "account"
          ? shortAddress(segment.v)
          : segment.t === "amount"
            ? `${formatAmount(segment.value)} ${segment.currency}`
            : segment.t === "nft"
              ? segment.v
              : segment.t === "pool"
                ? segment.pair
                : segment.name,
    )
    .join("");

/** An NFT of the index without an owner and not burned: its history starts after its mint, only offers seen. */
const unowned = (over: Partial<Nft> = {}): Nft => nftSample({ owner: undefined, owner_since: undefined, ...over });
/** An NFT the index has burned, by its owner. */
const burnedNft = (over: Partial<Nft> = {}): Nft =>
  nftSample({ owner: undefined, owner_since: undefined, burned: true, burned_at: { ledger_index: 107880000, tx_hash: HASH_A, executed_time: "2026-10-25T10:00:00Z", by: NFT_OWNER }, ...over });

/** The page's input: an indexed NFT, its offers and its history, in XRPL's words. */
function input(over: Partial<NftPageInput> = {}): NftPageInput {
  return {
    net: XRPL,
    id: NFT_ID,
    query: QUERY,
    mode: "indexed",
    now: NOW,
    index: nftAnswerSample(),
    offers: fulfilled(nftOffersPageSample()),
    history: fulfilled(nftEventsPageSample()),
    ...over,
  };
}

/** The input of a page of a URIToken, from the index. */
function uriInput(over: Partial<NftPageInput> = {}): NftPageInput {
  return input({ net: XAHAU, id: URI_TOKEN_ID, index: nftAnswerSample({ nft: uriTokenSample() }), ...over });
}

/** The node's offers of an XRPL NFT: a sell offer open to anyone, and a buy offer for the broker that expires in an hour. */
const SELL_INDEX = "80C89943155001109F35EFA8E982B4F3DED9095B00075454F2BF1CBEABFF9E92";
const BUY_INDEX = "3FE3402696254328E9E62893C60159B4A9EC4558374370D34DEC68D7AC8F05BE";
const nodeOffers = (over: Partial<NodeNftOffers> = {}): NodeNftOffers => ({
  offers: [
    { nft_offer_index: SELL_INDEX, flags: 1, owner: NFT_SELLER, amount: { currency: "XRP", value: "1600" } },
    { nft_offer_index: BUY_INDEX, flags: 0, owner: NFT_OWNER, amount: { currency: "USD", issuer: OTHER_ISSUER, value: "250" }, destination: NFT_BROKER, expiration: NOW + 3600 },
  ],
  more: false,
  ...over,
});

/** The upper-case hex of a text's UTF-8 bytes, and the text of a hex (the oracle of the URI tests: the page's own decoder is the code under test). */
const hexOf = (value: string): string => Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
const utf8Of = (hex: string): string => new TextDecoder().decode(Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16)));

/** An event of another NFT's history, with the keys overridden. */
const event = (over: Partial<NftEvent> = {}): NftEvent => nftEventSample(over);

// ---- nftModeOf (spec 4.1, Review Focus 2) ------------------------------------------------------------------------------------------------------------

type Settled<T> = PromiseSettledResult<T>;
const indexOf = (nft: Nft): Settled<NftAnswer> => fulfilled(nftAnswerSample({ nft }));
const nodeInfo = (over: Partial<NodeNftInfo> = {}): Settled<NodeNftInfo> => fulfilled(nodeNftInfoSample(over));

describe("nftModeOf", () => {
  const MODE_TABLE: Array<[name: string, index: Settled<NftAnswer>, node: Settled<NodeNftInfo | NodeUriToken> | null, mode: NftMode]> = [
    ["the NFT with an owner, the node not asked: indexed", indexOf(nftSample()), null, "indexed"],
    ["the NFT with an owner: indexed, whatever a node that was asked said", indexOf(nftSample()), rejected(NOT_FOUND), "indexed"],
    ["the burned NFT, the node not asked: burned", indexOf(burnedNft()), null, "burned"],
    ["the burned NFT: burned, whatever the node said", indexOf(burnedNft()), nodeInfo(), "burned"],
    ["the NFT without an owner and the node's NFT: indexed, owner from the network", indexOf(unowned()), nodeInfo(), "indexed-network-owner"],
    ["the NFT without an owner and the node's URIToken: indexed, owner from the network", indexOf(unowned()), fulfilled(nodeUriTokenSample()), "indexed-network-owner"],
    ["the NFT without an owner and the node not found: indexed, owner unknown", indexOf(unowned()), rejected(NOT_FOUND), "indexed-owner-unknown"],
    ["the NFT without an owner and the node failed: indexed, owner unknown", indexOf(unowned()), rejected(new UpstreamError("server", "answered 503", { status: 503 })), "indexed-owner-unknown"],
    ["the NFT without an owner and no answer of the node: indexed, owner unknown", indexOf(unowned()), null, "indexed-owner-unknown"],
    ["the NFT without an owner and a node that says it is burned: indexed, owner unknown (a burned NFT's owner is not its owner)", indexOf(unowned()), nodeInfo({ is_burned: true }), "indexed-owner-unknown"],
    ["not in the index and the node's NFT: from the network", rejected(NOT_FOUND), nodeInfo(), "network"],
    ["not in the index and the node's URIToken: from the network", rejected(NOT_FOUND), fulfilled(nodeUriTokenSample()), "network"],
    ["not in the index and the node says burned: from the network, burned", rejected(NOT_FOUND), nodeInfo({ is_burned: true }), "network-burned"],
    ["not in the index and not on the node (unknownCmd and notImpl are not found too): none", rejected(NOT_FOUND), rejected(NOT_FOUND), "none"],
    ["not in the index and the node not asked: unavailable (never a stored 404)", rejected(NOT_FOUND), null, "unavailable"],
  ];

  it.each(MODE_TABLE)("%s", (_name, index, node, mode) => {
    expect(nftModeOf(index, node)).toBe(mode);
  });

  describe.each(FAILURES)("%s", (_name, reason) => {
    it("of the index is unavailable, whatever the node said", () => {
      expect(nftModeOf(rejected(reason), null)).toBe("unavailable");
      expect(nftModeOf(rejected(reason), nodeInfo())).toBe("unavailable");
      expect(nftModeOf(rejected(reason), fulfilled(nodeUriTokenSample()))).toBe("unavailable");
      expect(nftModeOf(rejected(reason), rejected(NOT_FOUND))).toBe("unavailable");
    });

    it("of the node, with the NFT not in the index, is unavailable and no 404", () => {
      expect(nftModeOf(rejected(NOT_FOUND), rejected(reason))).toBe("unavailable");
    });

    it("of the node, with the NFT in the index without an owner, leaves the owner unknown", () => {
      expect(nftModeOf(indexOf(unowned()), rejected(reason))).toBe("indexed-owner-unknown");
    });
  });
});

describe("needsNode", () => {
  it("is true only for not found, or found without an owner and not burned", () => {
    expect(needsNode(rejected(NOT_FOUND))).toBe(true);
    expect(needsNode(indexOf(unowned()))).toBe(true);
    expect(needsNode(indexOf(nftSample()))).toBe(false);
    expect(needsNode(indexOf(burnedNft()))).toBe(false);
    // an index that failed is no reason to ask the node in its place
    for (const [, reason] of FAILURES) expect(needsNode(rejected(reason))).toBe(false);
  });
});

describe("NFT_MODE_CLASS", () => {
  it("is live, slow for burned, and short kept 60 s from the network", () => {
    const minute = CACHE_CLASSES.minute.edgeTtl;
    expect(minute).toBe(60);
    expect(NFT_MODE_CLASS).toEqual({
      indexed: { cls: "live" },
      burned: { cls: "slow" },
      "indexed-network-owner": { cls: "live" },
      "indexed-owner-unknown": { cls: "live" },
      network: { cls: "short", ttl: minute },
      "network-burned": { cls: "short", ttl: minute },
    } satisfies Record<NftPageMode, { cls: string; ttl?: number }>);
  });
});

// ---- The page of an indexed NFT --------------------------------------------------------------------------------------------------------------------

describe("nftPage", () => {
  it("indexed: header, owner since, last sale with ≈, details, the decoded id card, offers, history", () => {
    const sold = nftSample({
      last_sale: { amount: "250", currency: "USD", amount_issuer: OTHER_ISSUER, converted_amount: "96", ledger_index: 107874617, tx_hash: NFT_TX_HASH, executed_time: "2026-10-20T17:01:12Z" },
      sale_count: 7,
    });
    const page = nftPage(input({ index: nftAnswerSample({ nft: sold }), history: fulfilled(nftEventsPageSample({ marker: NFT_MARKER })) }));

    expect(page.mode).toBe("indexed");
    expect(page.marker).toBe(false);
    expect(page.back).toBeNull();
    expect(page.title).toBe(`NFT #95,234,705 of ${LABEL}`);
    expect(page.breadcrumb).toEqual([
      { label: "XRPL", href: "/xrpl" },
      { label: "NFTs", href: "/xrpl/nfts" },
      { label: LABEL, href: `/xrpl/nfts/${NFT_ISSUER}/10` },
      { label: "#95,234,705" },
    ]);
    expect(page.header).toEqual({
      glyph: "05",
      heading: "NFT #95,234,705",
      tags: ["NFToken"],
      line: { text: "Serial 95,234,705 of the collection", collection: { label: LABEL, href: `/xrpl/nfts/${NFT_ISSUER}/10` } },
      id: NFT_ID,
      owner: { label: "Owner", address: NFT_OWNER, since: { text: "Oct 24, 2026, 16:08 UTC", txHash: NFT_TX_HASH } },
      lastSale: { amount: { value: "250", currency: "USD", issuer: OTHER_ISSUER }, converted: "≈ 96 XRP", text: "Oct 20, 2026 · sold 7 times", txHash: NFT_TX_HASH },
    });

    // the details: the index's coverage starts after the mint, so the mint and the URI are not known
    expect(page.details.map((row) => [row.label, said(row.value)])).toEqual([
      ["Issuer", shortAddress(NFT_ISSUER)],
      ["Taxon · serial", "10 · 95,234,705"],
      ["Minted", "Before ledger #107,874,617, not in the index"],
      ["Transfer fee", "5.000% of every sale goes to the issuer"],
      ["URI", "Not in the index"],
      ["Flags", ""],
    ]);
    expect(page.details[0]!.value).toEqual([{ t: "account", v: NFT_ISSUER }]);
    expect(page.details.at(-1)!.flags).toEqual([
      { label: "Burnable by issuer", on: false, mark: "–", state: "no" },
      { label: "Only XRP", on: false, mark: "–", state: "no" },
      { label: "Transferable", on: true, mark: "✓", state: "yes" },
      { label: "Mutable URI", on: false, mark: "–", state: "no" },
    ]);

    // the id, decoded
    expect(page.idTitle).toBe("The id, decoded");
    expect(page.idCard.map((row) => [row.label, row.hex, said(row.value)])).toEqual([
      ["Flags", "0008", "transferable"],
      ["Transfer fee", "1388", "5,000 = 5.000% royalty"],
      ["Issuer, 20 bytes", "EA968E3C54EE59C8FFBAF0944A3B8AD4797AB032", shortAddress(NFT_ISSUER)],
      ["Taxon, scrambled", "EF229526", "taxon 10"],
      ["Sequence", "05AD2A91", "serial 95,234,705 of the issuer"],
    ]);
    expect(page.idNote).toBe("The taxon is stored scrambled with the sequence; the explorer unscrambles it, as rippled does.");

    // the open offers (a buy offer for the broker, expiring after `now`) and the history
    expect(page.offers).toEqual([
      {
        key: "3CD49EC73A6F77B3D365B97FEAC58825EE08F1342C25BBD53A6B34062E242A2E",
        side: "buy",
        amount: { value: "6.29", currency: "XRP" },
        by: "rMTaAGVd77vAbzDv8qhoMgnZR1T5R3w6Wq",
        onlyFor: NFT_BROKER,
        expires: "Oct 25, 2026",
        expired: false,
        created: { ledger: 107886233 },
      },
    ]);
    expect(page.offersMore).toBe(false);
    expect(page.history).toHaveLength(1);
    expect(page.history![0]!.event).toBe("sale");
    expect(page.historyToggle).toEqual({ label: "Show offer events", href: `/xrpl/nft/${NFT_ID}?offers=1` });
    expect(page.paging).toEqual({ newerHref: null, olderHref: nftHref("xrpl", NFT_ID, { marker: NFT_MARKER }) });
    expect(page.failures).toEqual({});
    expect(page.notice).toBeNull();
    expect(page.noindex).toBe(false);
  });

  it("the history toggle says Hide when the offer events are shown, and keeps nothing of the trail", () => {
    const page = nftPage(input({ query: { offers: true, back: [] } }));
    expect(page.historyToggle).toEqual({ label: "Hide offer events", href: `/xrpl/nft/${NFT_ID}` });
  });

  it("a token sale that converts to 0 shows no ≈, and a sale in the native currency none either", () => {
    const zero = nftSample({ last_sale: { amount: "0.000001", currency: "USD", amount_issuer: OTHER_ISSUER, converted_amount: "0", ledger_index: 1, tx_hash: NFT_TX_HASH, executed_time: "2026-10-20T17:01:12Z" } });
    const header = nftPage(input({ index: nftAnswerSample({ nft: zero }) })).header;
    expect(header.lastSale).toEqual({ amount: { value: "0.000001", currency: "USD", issuer: OTHER_ISSUER }, text: "Oct 20, 2026 · sold once", txHash: NFT_TX_HASH });
    expect(nftPage(input()).header.lastSale).not.toHaveProperty("converted");
  });

  it("an NFT never sold says so", () => {
    const never = nftSample({ sale_count: 0, last_sale: undefined });
    expect(nftPage(input({ index: nftAnswerSample({ nft: never }) })).header.lastSale).toEqual({ text: "Never sold" });
  });

  it("minted: the ledger, the day and the minter, and to {account} when the owner is another", () => {
    const minted = { ledger_index: 86201334, tx_hash: HASH_A, executed_time: "2024-03-14T12:00:41Z", by: NFT_ISSUER, to: NFT_ISSUER };
    const own = nftPage(input({ index: nftAnswerSample({ coverage: WHOLE, nft: nftSample({ minted }) }) }));
    const mintedRow = own.details.find((row) => row.label === "Minted")!;
    expect(said(mintedRow.value)).toBe(`#86,201,334 · Mar 14, 2024 · by ${shortAddress(NFT_ISSUER)}`);
    expect(mintedRow.value.map((segment) => segment.t)).toEqual(["text", "account"]);

    const sent = nftPage(input({ index: nftAnswerSample({ coverage: WHOLE, nft: nftSample({ minted: { ...minted, to: NFT_OWNER } }) }) }));
    const sentRow = sent.details.find((row) => row.label === "Minted")!;
    expect(said(sentRow.value)).toBe(`#86,201,334 · Mar 14, 2024 · by ${shortAddress(NFT_ISSUER)}, to ${shortAddress(NFT_OWNER)}`);
  });

  it("minted absent with incomplete coverage: Before ledger #N, not in the index; without a ledger or with complete coverage, no claim of a ledger", () => {
    const row = (coverage: NftAnswer["coverage"]): string => said(nftPage(input({ index: nftAnswerSample({ coverage }) })).details.find((r) => r.label === "Minted")!.value);
    expect(row(coverageSample({ from_ledger_index: 96100001, complete: false }))).toBe("Before ledger #96,100,001, not in the index");
    expect(row({ complete: false })).toBe("Not in the index");
    expect(row(WHOLE)).toBe("—");
  });

  it("burned: the burned tag, Burned {date} by {account} in place of the owner, no open offers", () => {
    const page = nftPage(input({ mode: "burned", index: nftAnswerSample({ nft: burnedNft() }), offers: fulfilled(nftOffersPageSample()) }));
    expect(page.mode).toBe("burned");
    expect(page.header.tags).toEqual(["NFToken", "burned"]);
    expect(page.header.owner).toEqual({ label: "Burned", text: "Oct 25, 2026", by: NFT_OWNER });
    expect(page.title).toBe(`NFT #95,234,705 (burned) of ${LABEL}`);
    // whatever the index said of open offers, a burned NFT has none
    expect(page.offers).toEqual([]);
    expect(page.offersMore).toBe(false);
    expect(page.notes.offers).toBeNull();
    // its history is shown
    expect(page.history).toHaveLength(1);
    expect(page.noindex).toBe(false);
  });

  it("burned without the burn in the index: the owner line says burned and names nobody", () => {
    const page = nftPage(input({ mode: "burned", index: nftAnswerSample({ nft: burnedNft({ burned_at: undefined }) }) }));
    expect(page.header.owner).toEqual({ label: "Owner", text: "Burned" });
  });

  it("indexed with the owner from the network: read from the network at ledger #N; owner unknown: Not in the index yet", () => {
    const index = nftAnswerSample({ nft: unowned() });
    const fromNode = nftPage(input({ mode: "indexed-network-owner", index, node: nodeNftInfoSample({ nft_id: NFT_ID, ledger_index: 107671930, owner: "rfxioGqxazNZt3sbeVSZtziEQBHHJAXXjE" }) }));
    expect(fromNode.header.owner).toEqual({ label: "Owner", address: "rfxioGqxazNZt3sbeVSZtziEQBHHJAXXjE", note: "read from the network at ledger #107,671,930" });
    // the rest is the index's: the details, the offers and the history
    expect(fromNode.details[0]!.value).toEqual([{ t: "account", v: NFT_ISSUER }]);
    expect(fromNode.history).toHaveLength(1);
    expect(fromNode.notice).toBeNull();
    expect(fromNode.noindex).toBe(false);

    const unknown = nftPage(input({ mode: "indexed-owner-unknown", index }));
    expect(unknown.header.owner).toEqual({ label: "Owner", text: "Not in the index yet" });
    expect(unknown.offers).toHaveLength(1);
    expect(unknown.noindex).toBe(false);
  });

  it("from the network: the notice, the header and details from the node, offers from the node, no history; Showing the first 50 when more", () => {
    const page = nftPage({
      net: XRPL,
      id: NODE_NFT_ID,
      query: QUERY,
      mode: "network",
      now: NOW,
      node: nodeNftInfoSample({ ledger_index: 107671930 }),
      offers: fulfilled(nodeOffers({ more: true })),
      history: null,
    });

    expect(page.mode).toBe("network");
    expect(page.notice).toBe("Not in the index yet, shown from the network. Its history appears once the index has it.");
    expect(page.noindex).toBe(true);
    const collection = `${shortAddress("rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu")} · taxon 500`;
    expect(page.title).toBe(`NFT #106,293,080 of ${collection}`);
    expect(page.breadcrumb.map((crumb) => crumb.label)).toEqual(["XRPL", "NFTs", collection, "#106,293,080"]);
    expect(page.header).toMatchObject({
      glyph: "80",
      heading: "NFT #106,293,080",
      tags: ["NFToken"],
      id: NODE_NFT_ID,
      owner: { label: "Owner", address: "rfxioGqxazNZt3sbeVSZtziEQBHHJAXXjE", note: "read from the network at ledger #107,671,930" },
      lastSale: null,
    });

    // the node's own words: the URI is there (decoded), and there is no mint to tell
    const uri = utf8Of(nodeNftInfoSample().uri!);
    expect(uri).toMatch(/^ipfs:\/\/.+\/96\.json$/);
    expect(page.details.map((row) => [row.label, said(row.value)])).toEqual([
      ["Issuer", shortAddress("rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu")],
      ["Taxon · serial", "500 · 106,293,080"],
      ["Transfer fee", "5.000% of every sale goes to the issuer"],
      ["URI", uri],
      ["Flags", ""],
    ]);
    expect(page.idCard).toHaveLength(5);

    // the offers: the sell offer open to anyone, the buy offer for the broker; the first 50 only
    expect(page.offers).toEqual([
      { key: SELL_INDEX, side: "sell", amount: { value: "1600", currency: "XRP" }, by: NFT_SELLER, onlyFor: "anyone", expires: "never", expired: false, created: null },
      { key: BUY_INDEX, side: "buy", amount: { value: "250", currency: "USD", issuer: OTHER_ISSUER }, by: NFT_OWNER, onlyFor: NFT_BROKER, expires: "Oct 25, 2026", expired: false, created: null },
    ]);
    expect(page.offersMore).toBe(true);
    expect(page.history).toBeNull();
    expect(page.notes).toEqual({ offers: null, history: null });
    expect(page.failures).toEqual({});
    expect(page.paging).toEqual({ newerHref: null, olderHref: null });
  });

  it("from the network, burned: the burned tag, the owner line says burned, no offers", () => {
    const page = nftPage({
      net: XRPL,
      id: NODE_NFT_ID,
      query: QUERY,
      mode: "network-burned",
      now: NOW,
      node: nodeNftInfoSample({ is_burned: true, ledger_index: 107671930 }),
      offers: fulfilled(nodeOffers()),
      history: null,
    });
    expect(page.header.tags).toEqual(["NFToken", "burned"]);
    expect(page.header.owner).toEqual({ label: "Owner", text: "Burned", note: "read from the network at ledger #107,671,930" });
    expect(page.offers).toEqual([]);
    expect(page.notice).toBe("Not in the index yet, shown from the network. Its history appears once the index has it.");
    expect(page.noindex).toBe(true);
    expect(page.title).toContain("(burned)");
  });

  it("Xahau: URIToken words, royalty None, the digest and the ledger entry card", () => {
    const page = nftPage(uriInput());
    const collection = shortAddress(URI_TOKEN_ISSUER);
    expect(page.title).toBe(`URIToken 96133366… of ${collection}`);
    expect(page.breadcrumb).toEqual([
      { label: "Xahau", href: "/xahau" },
      { label: "URITokens", href: "/xahau/nfts" },
      { label: collection, href: `/xahau/nfts/${URI_TOKEN_ISSUER}` },
      { label: "96133366…AAE9" },
    ]);
    expect(page.header).toEqual({
      glyph: "96",
      heading: "URIToken 96133366…",
      tags: ["URIToken"],
      line: { text: "Minted by the issuer of", collection: { label: collection, href: `/xahau/nfts/${URI_TOKEN_ISSUER}` } },
      id: URI_TOKEN_ID,
      owner: { label: "Owner", address: URI_TOKEN_OWNER, since: { text: "Oct 24, 2026, 15:36 UTC", txHash: "01772F1C2E379A2213EDDFF939ABB3FE59C2B309244EC442EA1515761605C20C" } },
      lastSale: {
        amount: { value: "4200", currency: "XAH" },
        text: "Oct 24, 2026 · sold once",
        txHash: "01772F1C2E379A2213EDDFF939ABB3FE59C2B309244EC442EA1515761605C20C",
      },
    });
    expect(page.details.map((row) => [row.label, said(row.value)])).toEqual([
      ["Issuer", collection],
      ["Minted", "Before ledger #107,874,617, not in the index"],
      ["Royalty", "None: URITokens carry no transfer fee"],
      ["URI", "Not in the index"],
      ["Flags", ""],
    ]);
    expect(page.details.at(-1)!.flags).toEqual([{ label: "Burnable by issuer", on: false, mark: "–", state: "no" }]);

    expect(page.idTitle).toBe("The id");
    expect(page.idNote).toBe(
      "A URIToken's id is the key of its ledger entry, worked out from the issuer and the URI. It encodes nothing else: the issuer, owner, flags and digest are fields of the entry.",
    );
    expect(page.idCard).toEqual([
      { label: "Digest", value: [{ t: "text", v: "772B3876…8736" }], title: "772B38763E8E603AEE9BBB2026B8E9B97537ECC8867E46D042630C0B326B8736" },
      { label: "Ledger entry", value: [{ t: "text", v: "URIToken" }] },
    ]);
  });

  it("Xahau: no digest is a dash, a burnable URIToken shows its flag, and a URI that is none says None once coverage is complete", () => {
    const page = nftPage(uriInput({ index: nftAnswerSample({ coverage: WHOLE, nft: uriTokenSample({ digest: undefined, flags: 1 }) }) }));
    expect(page.idCard[0]).toEqual({ label: "Digest", value: [{ t: "text", v: "—" }] });
    expect(said(page.details.find((row) => row.label === "URI")!.value)).toBe("None");
    expect(page.details.at(-1)!.flags).toEqual([{ label: "Burnable by issuer", on: true, mark: "✓", state: "yes" }]);
  });

  it("Xahau from the network: the entry's owner, URI and digest, and its one sell offer", () => {
    const token: NodeUriToken = nodeUriTokenSample({ Amount: { currency: "XAH", value: "2200" }, Destination: NFT_BROKER });
    const page = nftPage({ net: XAHAU, id: URI_TOKEN_ID, query: QUERY, mode: "network", now: NOW, node: token, offers: fulfilled(token), history: null });
    expect(page.header).toMatchObject({
      heading: "URIToken 96133366…",
      owner: { label: "Owner", address: "rLEUHuVCd8o9XmKn3nk8oGwYS3QEpUjo3e", note: "read from the network at ledger #26,829,859" },
      lastSale: null,
    });
    expect(page.details.map((row) => [row.label, said(row.value)])).toEqual([
      ["Issuer", shortAddress(URI_TOKEN_ISSUER)],
      ["Royalty", "None: URITokens carry no transfer fee"],
      ["URI", "odinseyes:raven:v2:004b0524"],
      ["Flags", ""],
    ]);
    expect(page.idCard[0]).toMatchObject({ label: "Digest", title: token.Digest });
    expect(page.offers).toEqual([{ key: URI_TOKEN_ID, side: "sell", amount: { value: "2200", currency: "XAH" }, by: "rLEUHuVCd8o9XmKn3nk8oGwYS3QEpUjo3e", onlyFor: NFT_BROKER, expires: "—", expired: false, created: null }]);
    expect(page.offersMore).toBe(false);
    // a URIToken with no sell offer has no offer
    const bare = nodeUriTokenSample();
    expect(nftPage({ net: XAHAU, id: URI_TOKEN_ID, query: QUERY, mode: "network", now: NOW, node: bare, offers: fulfilled(bare), history: null }).offers).toEqual([]);
  });

  it("an NFT the node has without a URI says None", () => {
    const bare = { ...nodeNftInfoSample() };
    delete bare.uri;
    const page = nftPage({ net: XRPL, id: NODE_NFT_ID, query: QUERY, mode: "network", now: NOW, node: bare, offers: fulfilled({ offers: [], more: false }), history: null });
    expect(said(page.details.find((row) => row.label === "URI")!.value)).toBe("None");
    expect(page.offers).toEqual([]);
  });

  it("the transfer fee: None for 0, else the percent with three decimals; one the answer leaves out is the id's", () => {
    const fee = (over: Partial<Nft>, id = NFT_ID): string => said(nftPage(input({ id, index: nftAnswerSample({ nft: nftSample({ nft_id: id, ...over }) }) })).details.find((row) => row.label === "Transfer fee")!.value);
    expect(fee({ transfer_fee: 0 })).toBe("None");
    expect(fee({ transfer_fee: 205 })).toBe("0.205% of every sale goes to the issuer");
    expect(fee({ transfer_fee: 50000 })).toBe("50.000% of every sale goes to the issuer");
    // an XRPL id encodes its fee: the answer's absent one is read from it (5,000 here), and an id of fee 0 is None
    expect(fee({ transfer_fee: undefined })).toBe("5.000% of every sale goes to the issuer");
    expect(fee({ transfer_fee: undefined }, encodeNftId({ flags: 8, transferFee: 0, issuer: NFT_ISSUER, taxon: 10, serial: 1 }))).toBe("None");
  });

  it("flags: each of the four on XRPL is ✓ or – with the word a screen reader reads", () => {
    const flags = nftPage(input({ index: nftAnswerSample({ nft: nftSample({ flags: 0x19 }) }) })).details.at(-1)!.flags!;
    expect(flags.map((flag) => [flag.label, flag.mark, flag.state])).toEqual([
      ["Burnable by issuer", "✓", "yes"],
      ["Only XRP", "–", "no"],
      ["Transferable", "✓", "yes"],
      ["Mutable URI", "✓", "yes"],
    ]);
  });

  it("draws the URI as text, never a link", () => {
    const hex = hexOf;
    const uriRow = (uri: string) => nftPage(input({ index: nftAnswerSample({ nft: nftSample({ uri }) }) })).details.find((row) => row.label === "URI")!;

    // text that looks like a link is a text detail
    const script = uriRow(hex("javascript:alert(1);"));
    expect(script.value).toEqual([{ t: "text", v: "javascript:alert(1);" }]);
    expect(script.note).toBe("Decoded from hex. Not fetched.");
    expect(script.mono).toBe(true);
    expect(JSON.stringify(script)).not.toMatch(/href|link/i);
    expect(uriRow(hex("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/4127.json")).value).toEqual([
      { t: "text", v: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/4127.json" },
    ]);

    // binary is the hex, as given, and says so
    const binary = uriRow("00FF10AB");
    expect(binary.value).toEqual([{ t: "text", v: "00FF10AB" }]);
    expect(binary.note).toBe("Not text, shown as hex. Not fetched.");
    // so is text with a control or a bidi character in it (the decoder refuses it)
    expect(uriRow(hex("a‮b")).value).toEqual([{ t: "text", v: hex("a‮b") }]);
    // a link is text, whatever its scheme; a control character (a newline) makes it hex
    expect(uriRow(hex("https://nft.example/4127.json")).value).toEqual([{ t: "text", v: "https://nft.example/4127.json" }]);
    expect(uriRow(hex("a\nb")).value).toEqual([{ t: "text", v: hex("a\nb") }]);
    // 256 bytes of hex stay whole
    const long = "AB".repeat(256);
    expect(uriRow(long).value).toEqual([{ t: "text", v: long }]);
    // an empty URI is none
    expect(uriRow("").value).toEqual([{ t: "text", v: "Not in the index" }]);
  });

  it("the per-NFT coverage notes", () => {
    const page = nftPage(input({ history: fulfilled(nftEventsPageSample({ coverage: coverageSample({ from_ledger_index: 96100001 }) })), offers: fulfilled(nftOffersPageSample({ coverage: coverageSample({ from_ledger_index: 96100001 }) })) }));
    expect(page.notes.history).toEqual({ before: "This NFT's history in the index starts at ledger ", ledger: 96100001, after: ": earlier events of this NFT are not in the index yet." });
    expect(page.notes.offers).toEqual({ before: "This NFT's history in the index starts at ledger ", ledger: 96100001, after: ": earlier offers of this NFT are not in the index yet." });

    // complete: none; no ledger at all: the index holds nothing yet
    const complete = nftPage(input({ history: fulfilled(nftEventsPageSample({ coverage: WHOLE })), offers: fulfilled(nftOffersPageSample({ coverage: WHOLE })) }));
    expect(complete.notes).toEqual({ offers: null, history: null });
    const empty = nftPage(input({ history: fulfilled(nftEventsPageSample({ coverage: { complete: false } })) }));
    expect(empty.notes.history).toEqual({ before: "The index does not hold this history yet.", ledger: null, after: "" });

    // a URIToken's words
    const xahau = nftPage(uriInput());
    expect(xahau.notes.history).toEqual({ before: "This URIToken's history in the index starts at ledger ", ledger: 107874617, after: ": earlier events of this URIToken are not in the index yet." });
    expect(xahau.notes.offers!.after).toBe(": earlier offers of this URIToken are not in the index yet.");
  });

  it("offers or history failing is told in place and leaves the rest", () => {
    const both = nftPage(input({ offers: rejected(new TooLate()), history: rejected(new UpstreamError("server", "answered 503", { status: 503 })) }));
    expect(both.failures).toEqual({ offers: "the open offers", history: "the history" });
    expect([both.offers, both.history]).toEqual([null, null]);
    expect(both.notes).toEqual({ offers: null, history: null });
    expect(both.paging).toEqual({ newerHref: null, olderHref: null });
    // the header and the details stand
    expect(both.header.owner).toMatchObject({ address: NFT_OWNER });
    expect(both.details.length).toBeGreaterThan(0);

    // from the network, the node's offers failing is told the same way
    const network = nftPage({ net: XRPL, id: NODE_NFT_ID, query: QUERY, mode: "network", now: NOW, node: nodeNftInfoSample(), offers: rejected(new TooLate()), history: null });
    expect(network.failures).toEqual({ offers: "the open offers" });
    expect(network.offers).toBeNull();
  });

  it("the empty cards say what they are", () => {
    const page = nftPage(input({ offers: fulfilled(nftOffersPageSample({ offers: [], count: 0 })), history: fulfilled(nftEventsPageSample({ events: [], count: 0 })) }));
    expect(page.offers).toEqual([]);
    expect(page.history).toEqual([]);
    expect(page.empty).toEqual({ offers: "No open offers.", history: "No mint, sale, transfer or burn of this NFT is in the index." });
    const withOffers = nftPage(input({ query: { offers: true, back: [] }, history: fulfilled(nftEventsPageSample({ events: [], count: 0 })) }));
    expect(withOffers.empty.history).toBe("No event of this NFT is in the index.");
    expect(nftPage(input()).empty).toEqual({ offers: null, history: null });
  });

  it("an index offers page with a marker says there are more", () => {
    expect(nftPage(input({ offers: fulfilled(nftOffersPageSample({ marker: NFT_MARKER })) })).offersMore).toBe(true);
  });

  it("the words of each network's offers and history notes, and the names the layout gives", () => {
    const xrpl = nftPage(input({ net: XRPL_TESTNET }));
    expect(xrpl.breadcrumb[0]).toEqual({ label: "XRPL Testnet", href: "/xrpl" });
    expect(xrpl.offersNote).toBe("Open offers: created and not yet cancelled, removed or accepted. A buy offer's amount is what its owner would pay; an expired offer stays until someone removes it.");
    expect(xrpl.historyNote).toBe("Newest first. A sale's price is the offer it accepted; a transfer moves the token without a price.");
    const xahau = nftPage(uriInput({ net: XAHAU_TESTNET }));
    expect(xahau.breadcrumb[0]).toEqual({ label: "Xahau Testnet", href: "/xahau" });
    expect(xahau.offersNote).toBe("A URIToken carries at most one sell offer, on the entry itself. Xahau Testnet has no buy offers.");
    expect(nftPage(uriInput()).offersNote).toBe("A URIToken carries at most one sell offer, on the entry itself. Xahau has no buy offers.");
  });

  it("refuses an input that does not fit its mode", () => {
    expect(() => nftPage(input({ index: undefined }))).toThrow(/index/);
    expect(() => nftPage(input({ mode: "network", node: undefined }))).toThrow(/node/);
    expect(() => nftPage(input({ mode: "indexed-network-owner", node: undefined }))).toThrow(/node/);
  });
});

// ---- A page behind a marker ------------------------------------------------------------------------------------------------------------------------

describe("nftMarkerPage", () => {
  const query: NftQuery = { offers: false, marker: MARKERS.M2, back: [MARKERS.M1] };
  const history = nftEventsPageSample({ marker: NFT_MARKER }) as NftEventsPage;

  it("is the breadcrumb, the header without owner and last sale, Back to the NFT and the history rows", () => {
    const page = nftMarkerPage({ net: XRPL, id: NFT_ID, query, index: nftAnswerSample(), history });
    expect(page.marker).toBe(true);
    expect(page.title).toBe("Older history of NFT #95,234,705");
    expect(page.breadcrumb.map((crumb) => crumb.label)).toEqual(["XRPL", "NFTs", LABEL, "#95,234,705"]);
    expect(page.header).toMatchObject({ heading: "NFT #95,234,705", tags: ["NFToken"], id: NFT_ID, owner: null, lastSale: null });
    expect(page.back).toEqual({ label: "Back to the NFT", href: `/xrpl/nft/${NFT_ID}` });
    expect(page.history).toHaveLength(1);
    expect(page.notes.history).toEqual({ before: "This NFT's history in the index starts at ledger ", ledger: 107874617, after: ": earlier events of this NFT are not in the index yet." });
    expect(page.paging).toEqual({
      newerHref: nftHref("xrpl", NFT_ID, { marker: MARKERS.M1, back: [] }),
      olderHref: nftHref("xrpl", NFT_ID, { marker: NFT_MARKER, back: [MARKERS.M2, MARKERS.M1] }),
    });
    // nothing else of the NFT's page
    expect(page.details).toEqual([]);
    expect(page.idCard).toEqual([]);
    expect(page.offers).toBeNull();
    expect(page.notice).toBeNull();
    expect(page.noindex).toBe(true);
    expect(page.failures).toEqual({});
  });

  it("keeps the offer events of its view, in Back and in its pager, and says burned and URIToken", () => {
    const shown = nftMarkerPage({ net: XRPL, id: NFT_ID, query: { ...query, offers: true }, index: nftAnswerSample({ nft: burnedNft() }), history });
    expect(shown.mode).toBe("burned");
    expect(shown.header.tags).toEqual(["NFToken", "burned"]);
    expect(shown.back!.href).toBe(`/xrpl/nft/${NFT_ID}?offers=1`);
    expect(shown.paging.olderHref).toBe(nftHref("xrpl", NFT_ID, { offers: true, marker: NFT_MARKER, back: [MARKERS.M2, MARKERS.M1] }));

    const token = nftMarkerPage({ net: XAHAU, id: URI_TOKEN_ID, query, index: nftAnswerSample({ nft: uriTokenSample() }), history });
    expect(token.back).toEqual({ label: "Back to the URIToken", href: `/xahau/nft/${URI_TOKEN_ID}` });
    expect(token.title).toBe("Older history of URIToken 96133366…");
  });
});

// ---- The history rows ------------------------------------------------------------------------------------------------------------------------------

describe("historyRows", () => {
  const rows = (...events: NftEvent[]): NftHistoryRow[] => historyRows(XRPL, events);
  const row = (e: NftEvent): NftHistoryRow => rows(e)[0]!;
  const A = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
  const B = "rLCscV9iDJpvje4ZCKxGjYAMNtBA1Ltauk";
  const C = "rfivr3BK17R28wnVwpQQhSDvo2A2fmnEje";
  const [a, b, c] = [shortAddress(A), shortAddress(B), shortAddress(C)];

  it("a brokered sale: from → to, the broker and its fee, the price", () => {
    const result = row(event());
    expect(result).toEqual({
      key: "0FD0FDC75F37C1B1CCA1DE4517785B35422E3C81D6543ADA094B04A5DBC7E56C:2",
      time: Date.UTC(2026, 9, 24, 21, 30, 41) / 1000,
      txHash: "0FD0FDC75F37C1B1CCA1DE4517785B35422E3C81D6543ADA094B04A5DBC7E56C",
      event: "sale",
      accounts: [
        { t: "account", v: "rfivr3BK17R28wnVwpQQhSDvo2A2fmnEje" },
        { t: "text", v: ARROW },
        { t: "account", v: "rLCscV9iDJpvje4ZCKxGjYAMNtBA1Ltauk" },
        { t: "text", v: " · broker " },
        { t: "account", v: NFT_BROKER },
        { t: "text", v: ", fee " },
        { t: "amount", value: "2.3835", currency: "XRP" },
      ],
      amount: { value: "150", currency: "XRP" },
    });
  });

  it("a direct sale in an issued currency: no broker, the price with its issuer", () => {
    const result = row(event({ from: A, to: B, broker: undefined, broker_fee: undefined, currency: "USD", amount_issuer: OTHER_ISSUER, amount: "250" }));
    expect(said(result.accounts)).toBe(`${a}${ARROW}${b}`);
    expect(result.amount).toEqual({ value: "250", currency: "USD", issuer: OTHER_ISSUER });
  });

  it("a mint: by the account, to the first owner; no price", () => {
    const result = row(event({ event: "mint", tx_type: "NFTokenMint", account: A, from: undefined, to: B, amount: undefined, currency: undefined, broker: undefined, broker_fee: undefined }));
    expect([result.event, said(result.accounts), result.amount]).toEqual(["mint", `by ${a}, to ${b}`, null]);
  });

  it("a transfer: from → to, by Remit on Xahau, an accepted offer of 0 on XRPL, nothing else for another transaction", () => {
    const transfer = (tx_type: string) => event({ event: "transfer", tx_type, from: A, to: B, amount: undefined, currency: undefined, broker: undefined, broker_fee: undefined });
    expect(said(row(transfer("Remit")).accounts)).toBe(`${a}${ARROW}${b} · by Remit`);
    expect(said(row(transfer("NFTokenAcceptOffer")).accounts)).toBe(`${a}${ARROW}${b} · an accepted offer of 0`);
    expect(said(row(transfer("URITokenBuy")).accounts)).toBe(`${a}${ARROW}${b}`);
    expect(row(transfer("Remit")).event).toBe("transfer");
  });

  it("a burn: by the account, owned by another when it differs; a URI change: by the account", () => {
    const burn = (over: Partial<NftEvent>) => event({ event: "burn", tx_type: "NFTokenBurn", account: A, from: A, to: undefined, amount: undefined, currency: undefined, broker: undefined, broker_fee: undefined, ...over });
    expect(said(row(burn({})).accounts)).toBe(`by ${a}`);
    expect(said(row(burn({ from: B })).accounts)).toBe(`by ${a} · owned by ${b}`);
    const modify = row(event({ event: "modify", tx_type: "NFTokenModify", account: A, from: undefined, to: undefined, amount: undefined, currency: undefined, broker: undefined, broker_fee: undefined }));
    expect([modify.event, said(modify.accounts)]).toEqual(["URI change", `by ${a}`]);
  });

  it("offers: created, cancelled and removed name their side, owner and destination", () => {
    const offer = (over: Partial<NftEvent>) => event({ account: A, from: undefined, to: undefined, broker: undefined, broker_fee: undefined, is_sell_offer: true, amount: "1600", currency: "XRP", destination: undefined, ...over });
    const created = row(offer({ event: "offer_create" }));
    expect([created.event, said(created.accounts), created.amount]).toEqual(["offer create", `sell offer by ${a}`, { value: "1600", currency: "XRP" }]);
    expect(said(row(offer({ event: "offer_create", is_sell_offer: false, destination: B })).accounts)).toBe(`buy offer by ${a} · only for ${b}`);
    const cancelled = row(offer({ event: "offer_cancel", is_sell_offer: false }));
    expect([cancelled.event, said(cancelled.accounts)]).toEqual(["offer cancel", `buy offer by ${a} cancelled`]);
    expect(said(row(offer({ event: "offer_create", is_sell_offer: undefined })).accounts)).toBe(`offer by ${a}`);
  });

  it("a removed offer says why: the sale, the burn, the transfer, or only removed (no cause claimed)", () => {
    const removed = (removed_by: string | undefined, over: Partial<NftEvent> = {}) =>
      row(event({ event: "offer_removed", tx_type: "NFTokenAcceptOffer", account: A, from: undefined, to: undefined, broker: undefined, broker_fee: undefined, is_sell_offer: true, amount: "10", currency: "XRP", removed_by, ...over }));
    expect([removed("sale").event, said(removed("sale").accounts), removed("sale").amount]).toEqual(["offer removed", `sell offer by ${a} removed by the sale`, { value: "10", currency: "XRP" }]);
    expect(said(removed("burn").accounts)).toBe(`sell offer by ${a} removed by the burn`);
    expect(said(removed("transfer").accounts)).toBe(`sell offer by ${a} removed by the transfer`);
    // D3's `other`: an AccountDelete, or an accept that failed with tecEXPIRED: no cause is claimed
    expect(said(removed("other").accounts)).toBe(`sell offer by ${a} removed`);
    expect(said(removed(undefined).accounts)).toBe(`sell offer by ${a} removed`);
    expect(said(removed("something-new").accounts)).toBe(`sell offer by ${a} removed`);
  });

  it("removals by a sale inside a transaction whose ownership event is a transfer are removed by the transfer", () => {
    const tx = { tx_hash: HASH_A, tx_type: "NFTokenAcceptOffer", ledger_index: 1, tx_index: 1 };
    const result = rows(
      event({ ...tx, event: "transfer", event_index: 1, from: A, to: B, amount: undefined, currency: undefined, broker: undefined, broker_fee: undefined }),
      event({ ...tx, event: "offer_removed", event_index: 0, account: A, is_sell_offer: true, removed_by: "sale", amount: "0", currency: "XRP", from: undefined, to: undefined, broker: undefined, broker_fee: undefined }),
    );
    expect(result.map((r) => [r.event, said(r.accounts)])).toEqual([
      ["transfer", `${a}${ARROW}${b} · an accepted offer of 0`],
      ["offer removed", `sell offer by ${a} removed by the transfer`],
    ]);
  });

  it("the offers one transaction removed for one cause are one row: 2 offers removed by the sale", () => {
    const tx = { tx_hash: HASH_A, tx_type: "NFTokenAcceptOffer", ledger_index: 1, tx_index: 1 };
    const removal = (event_index: number, over: Partial<NftEvent> = {}) =>
      event({ ...tx, event: "offer_removed", event_index, account: A, is_sell_offer: event_index % 2 === 0, removed_by: "sale", amount: "10", currency: "XRP", from: undefined, to: undefined, broker: undefined, broker_fee: undefined, ...over });
    const sale = event({ ...tx, event_index: 2, from: C, to: B });
    const other = event({ tx_hash: HASH_B, tx_type: "NFTokenBurn", event: "offer_removed", event_index: 0, account: B, is_sell_offer: false, removed_by: "burn", amount: "5", currency: "XRP", from: undefined, to: undefined, broker: undefined, broker_fee: undefined });

    const result = rows(sale, removal(1), removal(0), other);
    expect(result.map((r) => [r.key, r.event, said(r.accounts), r.amount])).toEqual([
      [`${HASH_A}:2`, "sale", `${c}${ARROW}${b} · broker ${shortAddress(NFT_BROKER)}, fee 2.3835 XRP`, { value: "150", currency: "XRP" }],
      [`${HASH_A}:1`, "offer removed", "2 offers removed by the sale", null],
      [`${HASH_B}:0`, "offer removed", `buy offer by ${b} removed by the burn`, { value: "5", currency: "XRP" }],
    ]);
    // the group has the time and the transaction of its offers
    expect(result[1]!.txHash).toBe(HASH_A);
    expect(result[1]!.time).toBe(result[0]!.time);

    // three of one cause are three; another cause in the same transaction is another row; the same cause in another transaction is another row
    const mixed = rows(removal(0), removal(1), removal(2), removal(3, { removed_by: "other" }), removal(0, { tx_hash: HASH_B }));
    expect(mixed.map((r) => said(r.accounts))).toEqual(["3 offers removed by the sale", `buy offer by ${a} removed`, `sell offer by ${a} removed by the sale`]);
    // the group stands where its first offer is
    expect(mixed.map((r) => r.key)).toEqual([`${HASH_A}:0`, `${HASH_A}:3`, `${HASH_B}:0`]);
  });

  it("keeps the order of the events, and gives each row its own key", () => {
    const result = rows(event({ event_index: 3 }), event({ event_index: 2 }), event({ event_index: 1 }));
    expect(result.map((r) => r.key.split(":")[1])).toEqual(["3", "2", "1"]);
    expect(new Set(result.map((r) => r.key)).size).toBe(3);
  });
});

// ---- The offer rows --------------------------------------------------------------------------------------------------------------------------------

describe("offerRows", () => {
  const OWNER = "rMTaAGVd77vAbzDv8qhoMgnZR1T5R3w6Wq";
  const index = (over: Partial<NftOffer> = {}): NftOffer => nftOfferSample({ owner: OWNER, ...over });

  it("anyone for a sell offer with no destination, — for a buy offer with none, the destination otherwise", () => {
    const [sell, buy, bound, sold] = offerRows(
      [index({ is_sell_offer: true, destination: undefined }), index({ is_sell_offer: false, destination: undefined }), index({ is_sell_offer: false, destination: NFT_BROKER }), index({ is_sell_offer: true, destination: NFT_BROKER })],
      NOW,
      "XRP",
    );
    expect([sell!.onlyFor, buy!.onlyFor, bound!.onlyFor, sold!.onlyFor]).toEqual(["anyone", null, NFT_BROKER, NFT_BROKER]);
    expect([sell!.side, buy!.side]).toEqual(["sell", "buy"]);
  });

  it("never when there is no expiration, the day otherwise, and expired when it is before now", () => {
    const at = (expiration: string | undefined) => offerRows([index({ expiration })], NOW, "XRP")[0]!;
    expect(at(undefined)).toMatchObject({ expires: "never", expired: false });
    expect(at("2026-10-25T05:22:08Z")).toMatchObject({ expires: "Oct 25, 2026", expired: false });
    expect(at("2026-10-24T23:59:59Z")).toMatchObject({ expires: "Oct 24, 2026", expired: true });
    // the second of now itself is not before it
    expect(at("2026-10-25T00:00:00Z")).toMatchObject({ expired: false });
    expect(at("2026-10-25T00:00:01Z")).toMatchObject({ expired: false });
    // a clock a day later makes the same offer expired
    expect(offerRows([index({ expiration: "2026-10-25T05:22:08Z" })], NOW + 86400, "XRP")[0]!.expired).toBe(true);
  });

  it("the index's offer: its key, amount with issuer, owner and the ledger it was created in", () => {
    expect(offerRows([index({ amount: "250", currency: "USD", amount_issuer: OTHER_ISSUER, created_ledger: 107701442 })], NOW, "XRP")[0]).toMatchObject({
      key: "3CD49EC73A6F77B3D365B97FEAC58825EE08F1342C25BBD53A6B34062E242A2E",
      amount: { value: "250", currency: "USD", issuer: OTHER_ISSUER },
      by: OWNER,
      created: { ledger: 107701442 },
    });
  });

  it("the node's offers: the side from the flag, the expiration in unix seconds, no created ledger", () => {
    const [sell, buy] = offerRows(nodeOffers(), NOW, "XRP");
    expect([sell!.side, buy!.side]).toEqual(["sell", "buy"]);
    expect(buy).toMatchObject({ expires: "Oct 25, 2026", expired: false, created: null, onlyFor: NFT_BROKER });
    // a node's offer that expired before the clock
    const stale = nodeOffers({ offers: [{ nft_offer_index: BUY_INDEX, flags: 0, owner: OWNER, amount: { currency: "XRP", value: "1" }, expiration: NOW - 1 }] });
    expect(offerRows(stale, NOW, "XRP")[0]).toMatchObject({ expired: true });
    expect(offerRows({ offers: [], more: false }, NOW, "XRP")).toEqual([]);
  });

  it("a URIToken's one sell offer: the entry's Amount and Destination, no expiry on Xahau", () => {
    const token = nodeUriTokenSample({ Amount: { currency: "XAH", value: "560" } });
    expect(offerRows(token, NOW, "XAH")).toEqual([
      { key: URI_TOKEN_ID, side: "sell", amount: { value: "560", currency: "XAH" }, by: token.Owner, onlyFor: "anyone", expires: "—", expired: false, created: null },
    ]);
    expect(offerRows(nodeUriTokenSample(), NOW, "XAH")).toEqual([]);
    // an index offer of a URIToken has no expiry either
    expect(offerRows([index({ is_sell_offer: true, expiration: undefined })], NOW, "XAH")[0]).toMatchObject({ expires: "—", expired: false });
  });
});

// ---- nftNotFound -----------------------------------------------------------------------------------------------------------------------------------

describe("nftNotFound", () => {
  const XAHAU_NAMED = { id: "xahau", name: "Xahau" } as const;
  const XRPL_NAMED = { id: "xrpl", name: "XRPL" } as const;

  it("is the phrase the not-found page writes its sentence round, and the other network's search", () => {
    expect(nftNotFound(XRPL, NFT_ID, XAHAU_NAMED)).toEqual({ notFound: "NFT 00081388…2A91", suggestion: { href: `/xahau/search?q=${NFT_ID}`, label: "Search on Xahau" } });
    expect(nftNotFound(XAHAU, URI_TOKEN_ID, XRPL_NAMED)).toEqual({ notFound: "URIToken 96133366…AAE9", suggestion: { href: `/xrpl/search?q=${URI_TOKEN_ID}`, label: "Search on XRPL" } });
  });

  it("names the other network as the environment does, so the sandbox says Testnet", () => {
    expect(nftNotFound(XRPL_TESTNET, NFT_ID, { id: "xahau", name: "Xahau Testnet" }).suggestion).toEqual({ href: `/xahau/search?q=${NFT_ID}`, label: "Search on Xahau Testnet" });
    expect(nftNotFound(XAHAU_TESTNET, URI_TOKEN_ID, { id: "xrpl", name: "XRPL Testnet" }).suggestion.label).toBe("Search on XRPL Testnet");
  });

  it("is the one search the other pages offer (searchOnOther), and has no sentence of its own to cut", () => {
    expect(nftNotFound(XRPL, NFT_ID, XAHAU_NAMED).suggestion).toEqual(searchOnOther(NFT_ID, XAHAU_NAMED));
    expect(Object.keys(nftNotFound(XRPL, NFT_ID, XAHAU_NAMED)).sort()).toEqual(["notFound", "suggestion"]);
  });
});

// ---- Over the recorded fixtures ----------------------------------------------------------------------------------------------------------------------

describe.each([
  ["xrpl", XRPL],
  ["xahau", XAHAU],
] as const)("over the recorded %s fixtures", (id, net) => {
  const dir = new URL("../../test/fixtures/http/", import.meta.url);
  const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(`${id}/${path}`, dir), "utf8")) as T;

  /** The node's answer for an NFT the way `node-rpc.ts` reads its files: Clio's `nft_info`, or a Xahau `ledger_entry` with its drops as whole units. */
  function nodeAnswer(nftId: string): NodeNftInfo | NodeUriToken {
    if (id === "xrpl") {
      const { result } = json<{ result: NodeNftInfo & { validated: boolean; status: string } }>(`node/nft_info/${nftId}.json`);
      const { validated: _validated, status: _status, ...info } = result;
      return info;
    }
    const { result } = json<{ result: { ledger_index: number; node: { Owner: string; Issuer: string; URI: string; Digest?: string; Flags: number; Amount?: string; Destination?: string } } }>(`node/ledger_entry/${nftId}.json`);
    const { node } = result;
    return {
      index: nftId,
      ledger_index: result.ledger_index,
      Owner: node.Owner,
      Issuer: node.Issuer,
      URI: node.URI,
      ...(node.Digest === undefined ? {} : { Digest: node.Digest }),
      Flags: node.Flags,
      ...(node.Amount === undefined ? {} : { Amount: { currency: "XAH", value: dropsToNative(node.Amount) } }),
      ...(node.Destination === undefined ? {} : { Destination: node.Destination }),
    };
  }

  it("the featured NFT: indexed, with its offers and the first page of its history", async () => {
    const { id: nftId } = await nftCase(id, "featured");
    const index = json<NftAnswer>(`data-api/nfts/${nftId}.json`);
    const history = json<NftEventsPage>(`data-api/nfts/${nftId}/history@descending=true&limit=20.json`);
    const offers = json<{ coverage: NftAnswer["coverage"]; count: number; offers: NftOffer[] }>(`data-api/nfts/${nftId}/offers@limit=50.json`);
    expect(nftModeOf(fulfilled(index), null)).toBe("indexed");

    const page = nftPage({ net, id: nftId, query: { offers: true, back: [] }, mode: "indexed", now: NOW, index, offers: fulfilled(offers), history: fulfilled(history) });
    expect(page.mode).toBe("indexed");
    expect(page.header.owner).toMatchObject({ label: "Owner", address: index.nft.owner });
    expect(page.history).not.toBeNull();
    expect(page.history!.length).toBeGreaterThan(0);
    expect(page.history!.length).toBeLessThanOrEqual(history.events.length);
    expect(page.paging.olderHref).toBe(nftHref(id, nftId, { offers: true, marker: history.marker }));
    expect(page.offers).toHaveLength(offers.offers.length);
    expect(page.notes.history).not.toBeNull();
    expect(page.failures).toEqual({});
    if (id === "xrpl") {
      // a brokered sale removed the sell and the buy offer it accepted: one row
      expect(page.history!.map((row) => said(row.accounts))).toContain("2 offers removed by the sale");
      // the two buy offers the featured NFT has are for the broker; the first expired the day before `now`, the second a year after it
      expect(page.offers!.map((offer) => [offer.side, offer.onlyFor, offer.expires, offer.expired])).toEqual([
        ["buy", "rpx9JThQ2y37FaGeeJP7PXDUVEXY3PHZSC", "Oct 24, 2026", true],
        ["buy", "rpx9JThQ2y37FaGeeJP7PXDUVEXY3PHZSC", "Nov 29, 2027", false],
      ]);
      expect(page.idCard).toHaveLength(5);
    } else {
      expect(page.idTitle).toBe("The id");
    }
  });

  it("the burned NFT: its burn in place of the owner, and no offers", async () => {
    const { id: nftId } = await nftCase(id, "burned");
    const index = json<NftAnswer>(`data-api/nfts/${nftId}.json`);
    const history = json<NftEventsPage>(`data-api/nfts/${nftId}/history@descending=true&limit=20.json`);
    expect(nftModeOf(fulfilled(index), null)).toBe("burned");
    const page = nftPage({ net, id: nftId, query: QUERY, mode: "burned", now: NOW, index, offers: null, history: fulfilled(history) });
    expect(page.header.tags).toContain("burned");
    expect(page.header.owner).toMatchObject({ label: "Burned", by: index.nft.burned_at!.by });
    expect(page.offers).toEqual([]);
    expect(page.history!.map((row) => row.event)).toContain("burn");
  });

  it("the NFT without an owner: the owner read from the network", async () => {
    const { id: nftId } = await nftCase(id, "unowned");
    const index = json<NftAnswer>(`data-api/nfts/${nftId}.json`);
    const node = nodeAnswer(nftId);
    expect(needsNode(fulfilled(index))).toBe(true);
    expect(nftModeOf(fulfilled(index), fulfilled(node))).toBe("indexed-network-owner");
    const page = nftPage({ net, id: nftId, query: QUERY, mode: "indexed-network-owner", now: NOW, index, node, offers: null, history: null });
    expect(page.header.owner).toEqual({ label: "Owner", address: "owner" in node ? node.owner : node.Owner, note: `read from the network at ledger #${formatAmount(String(node.ledger_index))}` });
  });

  it("an NFT only the node has: shown from the network", async () => {
    const { id: nftId } = await nftCase(id, "network");
    const node = nodeAnswer(nftId);
    expect(nftModeOf(rejected(NOT_FOUND), fulfilled(node))).toBe("network");
    const page = nftPage({ net, id: nftId, query: QUERY, mode: "network", now: NOW, node, offers: fulfilled(id === "xrpl" ? { offers: [], more: false } : (node as NodeUriToken)), history: null });
    expect(page.noindex).toBe(true);
    expect(page.notice).not.toBeNull();
    expect(page.header.owner).toMatchObject({ address: "owner" in node ? node.owner : node.Owner });
    expect(page.header.heading).toBe(id === "xrpl" ? `NFT #${formatAmount(String((node as NodeNftInfo).nft_serial))}` : `URIToken ${nftId.slice(0, 8)}…`);
    // Xahau's second entry has a sell offer of 2,200 XAH
    if (id === "xahau") expect(page.offers).toEqual([]);
  });

  it("a URIToken's sell offer on the node, and the burned NFT only the node has", async () => {
    if (id === "xahau") {
      const entry = nodeAnswer("35B8D52858E0463C0F0FCCC73EFBE1D308F0AF71112035C4D45777EB9115E93D") as NodeUriToken;
      expect(offerRows(entry, NOW, "XAH")).toMatchObject([{ side: "sell", amount: { value: "2200", currency: "XAH" }, onlyFor: "anyone" }]);
      return;
    }
    const { id: nftId } = await nftCase(id, "network-burned");
    const node = nodeAnswer(nftId) as NodeNftInfo;
    expect(nftModeOf(rejected(NOT_FOUND), fulfilled(node))).toBe("network-burned");
    const page = nftPage({ net, id: nftId, query: QUERY, mode: "network-burned", now: NOW, node, offers: null, history: null });
    expect(page.header.tags).toEqual(["NFToken", "burned"]);
    expect(page.offers).toEqual([]);
  });

  it("an id neither has: a 404 that offers the other network", async () => {
    const { id: nftId } = await nftCase(id, "missing");
    expect(nftModeOf(rejected(NOT_FOUND), rejected(NOT_FOUND))).toBe("none");
    expect(nftNotFound(net, nftId, { id: net.other, name: net.other }).suggestion.href).toBe(`/${net.other}/search?q=${nftId}`);
  });
});

// ---- The facts of the tags and of the link-preview image -------------------------------------------------------------------------------------------

describe("nftFacts", () => {
  const sold = (over: Partial<Nft> = {}): NftAnswer => nftAnswerSample({ nft: nftSample({ minted: { ledger_index: 1, tx_hash: HASH_A, executed_time: "2024-03-14T09:00:00Z", by: NFT_ISSUER, to: NFT_OWNER }, ...over }) });

  it("an indexed NFT: its name and headline, its collection, its owner, its last sale as text and the day of its mint", () => {
    expect(nftFacts(XRPL, NFT_ID, "indexed", sold(), undefined)).toEqual({
      kind: "nftoken",
      name: "NFT #95,234,705",
      headline: "#95,234,705",
      burned: false,
      collection: LABEL,
      owner: NFT_OWNER,
      lastSale: "10 XRP",
      minted: Date.UTC(2024, 2, 14, 9) / 1000,
    });
  });

  it("is the page's own, so that the tags and the image say what the page says", () => {
    const page = nftPage(input({ index: sold() }));
    expect(page.facts).toEqual(nftFacts(XRPL, NFT_ID, "indexed", sold(), undefined));
    expect(nftMarkerPage({ net: XRPL, id: NFT_ID, query: { offers: false, marker: MARKERS.M1, back: [] }, index: sold(), history: nftEventsPageSample() }).facts).toEqual(page.facts);
    expect(nftPage(input({ mode: "burned", index: nftAnswerSample({ nft: burnedNft() }) })).facts.name).toBe("NFT #95,234,705");
  });

  it("a token's price in its own currency, grouped and named as an amount is", () => {
    const token = nftSample({ last_sale: { amount: "1250.5", currency: "USD", amount_issuer: OTHER_ISSUER, converted_amount: "96", ledger_index: 1, tx_hash: HASH_A, executed_time: "2026-10-20T17:01:12Z" } });
    expect(nftFacts(XRPL, NFT_ID, "indexed", nftAnswerSample({ nft: token }), undefined).lastSale).toBe("1,250.5 USD");
  });

  it("says how often an NFT without a last sale was sold, and says nothing of it with one", () => {
    const none = nftFacts(XRPL, NFT_ID, "indexed", sold({ sale_count: 0, last_sale: undefined }), undefined);
    expect(none.lastSale).toBeUndefined();
    expect(none.sold).toBe("never sold");
    expect(nftFacts(XRPL, NFT_ID, "indexed", sold({ sale_count: 1, last_sale: undefined }), undefined).sold).toBe("sold once");
    expect(nftFacts(XRPL, NFT_ID, "indexed", sold({ sale_count: 3, last_sale: undefined }), undefined).sold).toBe("sold 3 times");
    expect(nftFacts(XRPL, NFT_ID, "indexed", sold(), undefined).sold).toBeUndefined();
  });

  it("a burned NFT has no owner; one with no owner in the index has the node's, or none", () => {
    const burned = nftFacts(XRPL, NFT_ID, "burned", nftAnswerSample({ nft: burnedNft() }), undefined);
    expect(burned).toMatchObject({ burned: true, name: "NFT #95,234,705" });
    expect(burned.owner).toBeUndefined();
    const node = nodeNftInfoSample();
    expect(nftFacts(XRPL, NFT_ID, "indexed-network-owner", nftAnswerSample({ nft: unowned() }), node).owner).toBe(node.owner);
    expect(nftFacts(XRPL, NFT_ID, "indexed-owner-unknown", nftAnswerSample({ nft: unowned() }), undefined).owner).toBeUndefined();
  });

  it("an NFT without a mint in the index has no day of it", () => {
    expect(nftFacts(XRPL, NFT_ID, "indexed", nftAnswerSample(), undefined).minted).toBeUndefined();
  });

  it("from the network: the node's owner and no sale or mint", () => {
    const node = nodeNftInfoSample();
    const facts = nftFacts(XRPL, NODE_NFT_ID, "network", undefined, node);
    expect(facts).toEqual({ kind: "nftoken", name: "NFT #106,293,080", headline: "#106,293,080", burned: false, collection: `${shortAddress(node.issuer)} · taxon 500`, owner: node.owner });
    expect(nftFacts(XRPL, NODE_NFT_ID, "network-burned", undefined, nodeNftInfoSample({ is_burned: true }))).toMatchObject({ burned: true });
    expect(nftFacts(XRPL, NODE_NFT_ID, "network-burned", undefined, nodeNftInfoSample({ is_burned: true })).owner).toBeUndefined();
  });

  it("a URIToken: its short id for a headline, its issuer's collection, the kind", () => {
    const facts = nftFacts(XAHAU, URI_TOKEN_ID, "indexed", nftAnswerSample({ nft: uriTokenSample() }), undefined);
    expect(facts).toMatchObject({ kind: "uritoken", name: "URIToken 96133366…", headline: "96133366…AAE9", collection: shortAddress(URI_TOKEN_ISSUER), owner: URI_TOKEN_OWNER, lastSale: "4,200 XAH" });
    const entry = nodeUriTokenSample();
    expect(nftFacts(XAHAU, URI_TOKEN_ID, "network", undefined, entry)).toMatchObject({ kind: "uritoken", owner: entry.Owner, collection: shortAddress(entry.Issuer) });
  });
});

// The tests above write the id card by hand (its hex and its words); the sample NFT's fields are the ones its id decodes to.
describe("the sample NFT", () => {
  it("stands on an id that decodes to its issuer, taxon, serial, flags and fee", () => {
    expect(decodeNftId(NFT_ID)).toMatchObject({ issuer: NFT_ISSUER, taxon: 10, serial: 95234705, flags: 8, transferFee: 5000 });
    expect(decodeNftId(NODE_NFT_ID)).toMatchObject({ issuer: "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu", taxon: 500, serial: 106293080 });
  });
});

// ---- The accounts the page draws (display names spec 1 and 5) -----------------------------------------------------------------------------------

describe("drawnAccounts: the accounts an NFT's page draws", () => {
  const MINTER = "rBg5JN5ShW8ZRV1TJhxVJRYcXVbPGC3ARi";
  const MINTED_TO = "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh";
  const BIDDER = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
  const FROM = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
  const TO = "rLUEXYuLiQptky37CqLcm9USQpPiz5rkpD";
  const FEE_ISSUER = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";

  it("is the owner, the issuer, the minter and the account it went to, the offers' accounts and the history's, each once, in the order the page draws them", () => {
    const nft = nftSample({ minted: { ledger_index: 26689211, tx_hash: HASH_A, executed_time: "2026-03-14T09:00:00Z", by: MINTER, to: MINTED_TO } });
    const page = nftPage(
      input({
        index: nftAnswerSample({ nft, coverage: WHOLE }),
        offers: fulfilled(nftOffersPageSample({ offers: [nftOfferSample({ owner: BIDDER, destination: NFT_BROKER })] })),
        history: fulfilled(nftEventsPageSample({ events: [nftEventSample({ from: FROM, to: TO, broker: NFT_BROKER })] })),
      }),
    );
    // The owner line; the details (issuer, then the mint); the id's card repeats the issuer; the offers; the sale's two accounts and its broker.
    expect(drawnAccounts(page)).toEqual([NFT_OWNER, NFT_ISSUER, MINTER, MINTED_TO, BIDDER, NFT_BROKER, FROM, TO]);
  });

  it("leaves out every other address the page holds: an amount's issuer, the offer's price issuer, the last sale's, the tags' owner", () => {
    const nft = nftSample({ last_sale: { amount: "250", currency: "USD", amount_issuer: FEE_ISSUER, converted_amount: "96", ledger_index: 1, tx_hash: HASH_A, executed_time: "2026-10-20T17:01:12Z" } });
    const sale = nftEventSample({ from: FROM, to: TO, broker: undefined, broker_fee: "3", amount: "250", currency: "USD", amount_issuer: FEE_ISSUER });
    const brokered = nftEventSample({ event_index: 3, from: FROM, to: TO, broker: NFT_BROKER, broker_fee: "3", currency: "USD", amount_issuer: FEE_ISSUER });
    const page = nftPage(
      input({
        index: nftAnswerSample({ nft }),
        offers: fulfilled(nftOffersPageSample({ offers: [nftOfferSample({ owner: BIDDER, destination: undefined, currency: "USD", amount_issuer: FEE_ISSUER })] })),
        history: fulfilled(nftEventsPageSample({ events: [sale, brokered] })),
      }),
    );
    const drawn = drawnAccounts(page);
    expect(drawn).not.toContain(FEE_ISSUER);
    expect(drawn).toEqual([NFT_OWNER, NFT_ISSUER, BIDDER, FROM, TO, NFT_BROKER]);
  });

  it("is a sell offer's destination only when it names one: anyone and a buy offer's dash are no account", () => {
    const sell = nftOfferSample({ is_sell_offer: true, owner: BIDDER, destination: undefined });
    const targeted = nftOfferSample({ offer_id: "AB".repeat(32), is_sell_offer: true, owner: MINTER, destination: TO });
    const buy = nftOfferSample({ offer_id: "CD".repeat(32), is_sell_offer: false, owner: MINTED_TO, destination: undefined });
    const page = nftPage(input({ offers: fulfilled(nftOffersPageSample({ offers: [sell, targeted, buy] })), history: fulfilled(nftEventsPageSample({ events: [] })) }));
    expect(page.offers!.map((row) => row.onlyFor)).toEqual(["anyone", TO, null]);
    expect(drawnAccounts(page)).toEqual([NFT_OWNER, NFT_ISSUER, BIDDER, MINTER, TO, MINTED_TO]);
  });

  it("is the account that burned a burned NFT, who is in place of the owner, and no open offer's", () => {
    const page = nftPage(input({ mode: "burned", index: nftAnswerSample({ nft: burnedNft({ burned_at: { ledger_index: 1, tx_hash: HASH_A, executed_time: "2026-10-25T10:00:00Z", by: MINTER } }) }), history: fulfilled(nftEventsPageSample({ events: [] })) }));
    expect(page.header.owner).toMatchObject({ label: "Burned", by: MINTER });
    expect(drawnAccounts(page)).toEqual([MINTER, NFT_ISSUER]);
  });

  it("is a burn's account and the owner it was owned by, in the history", () => {
    const burn = nftEventSample({ event: "burn", account: MINTER, from: BIDDER, to: undefined, broker: undefined, broker_fee: undefined, amount: undefined, currency: undefined });
    const page = nftPage(input({ offers: fulfilled(nftOffersPageSample({ offers: [] })), history: fulfilled(nftEventsPageSample({ events: [burn] })) }));
    expect(drawnAccounts(page)).toEqual([NFT_OWNER, NFT_ISSUER, MINTER, BIDDER]);
  });

  it("is, from the network, the owner the node says, the issuer and the node's offers, and no history", () => {
    const page = nftPage({
      net: XRPL,
      id: NODE_NFT_ID,
      query: QUERY,
      mode: "network",
      now: NOW,
      node: nodeNftInfoSample(),
      offers: fulfilled(nodeOffers()),
      history: null,
    });
    // The node's owner and issuer; the sell offer's owner, the buy offer's owner and its destination.
    expect(drawnAccounts(page)).toEqual(["rfxioGqxazNZt3sbeVSZtziEQBHHJAXXjE", "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu", NFT_SELLER, NFT_OWNER, NFT_BROKER]);
  });

  it("is nothing from a card that failed or was not asked for, and, behind a marker, the history's accounts alone: that page has no owner, details or id card", () => {
    const failed = nftPage(input({ offers: rejected(new TooLate()), history: rejected(new TooLate()) }));
    expect(drawnAccounts(failed)).toEqual([NFT_OWNER, NFT_ISSUER]);

    const history = nftEventsPageSample({ events: [nftEventSample({ from: FROM, to: TO, broker: undefined })] }) as NftEventsPage;
    const marker = nftMarkerPage({ net: XRPL, id: NFT_ID, query: { offers: false, marker: MARKERS.M2, back: [MARKERS.M1] }, index: nftAnswerSample(), history });
    expect(drawnAccounts(marker)).toEqual([FROM, TO]);
  });
});
