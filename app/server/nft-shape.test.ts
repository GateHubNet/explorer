import { describe, expect, it } from "vitest";

import {
  collectionDaySample,
  collectionSample,
  holderSample,
  nftAnswerSample,
  nftCollectionAnswerSample,
  nftCollectionDaysSample,
  nftCollectionsPageSample,
  nftEventSample,
  nftEventsPageSample,
  nftHoldersPageSample,
  nftOfferSample,
  nftOffersPageSample,
  nftSaleSample,
  nftSalesPageSample,
  nftSample,
  nftsPageSample,
  nftVolumeRowSample,
  nftVolumeSample,
  NFT_ID,
  NFT_ISSUER,
  NFT_OWNER,
  NFT_TX_HASH,
  OTHER_ISSUER,
  uriTokenCollectionSample,
  uriTokenSample,
  URI_TOKEN_ID,
  URI_TOKEN_ISSUER,
} from "../../test/support/nft-samples";
import {
  checkCollection,
  checkCollectionDays,
  checkCollectionsPage,
  checkHoldersPage,
  checkNft,
  checkNftEventsPage,
  checkNftOffersPage,
  checkNftSalesPage,
  checkNftsPage,
  checkNftVolume,
} from "./nft-shape";
import { UpstreamError } from "./upstream";

// The examples are the ones of data-api-new/docs/api-reference.md ("NFTs", feat/explorer-data-2 da5ce14), with addresses that exist (test/support/nft-samples.ts).
// A defect is one change to an example.

/** A body to be broken in some way: a test reaches into it as it likes. */
type Body = any;
/** What is wrong, the field the message must name, and the change that makes it so. */
type Defect = [what: string, field: string, change: (body: Body) => void];

const clone = <T>(value: T): T => structuredClone(value);

/** The request every check is told it answers, which its message names. */
const PATH = "/v2/nfts/test?limit=20";

/** The check refuses `body` as an `UpstreamError` of kind `server` that marks an answer of the upstream (status 200), and its message names the request and `field`. */
function refuses(check: (body: unknown) => unknown, body: unknown, field: string): void {
  let error: unknown;
  try {
    check(body);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UpstreamError);
  expect((error as UpstreamError).kind).toBe("server");
  expect((error as UpstreamError).status).toBe(200);
  expect((error as UpstreamError).message).toContain(`data API GET ${PATH}`);
  expect((error as UpstreamError).message).toContain(field);
}

/** The example is taken and returned as it is; every change in `defects` makes it a refused answer that names its field. */
function pins(check: (body: unknown) => unknown, good: unknown, defects: Defect[]): void {
  it("takes the reference's example, and returns it as it is", () => {
    expect(check(good)).toBe(good);
  });
  it.each(defects)("refuses %s", (_what, field, defect) => {
    const body = clone(good);
    defect(body);
    refuses(check, body, field);
  });
}

/** Each defect of an object, as a defect of the body that holds it (`at` is where, `holds` a function that reaches it). */
const within = (at: string, holds: (body: Body) => Body, defects: Defect[]): Defect[] =>
  defects.map(([what, field, change]): Defect => [`${what}, in ${at}`, field, (body) => change(holds(body))]);

/** What every answer has: a coverage that is one. */
const coverageDefects: Defect[] = [
  ["no coverage", "coverage", (b) => delete b.coverage],
  ["a coverage that is text", "coverage", (b) => (b.coverage = "complete")],
  ["a coverage whose complete is text", "coverage.complete", (b) => (b.coverage = { from_ledger_index: 107874617, complete: "false" })],
  ["a coverage whose ledger is fractional", "coverage.from_ledger_index", (b) => (b.coverage = { from_ledger_index: 1.5, complete: false })],
];

/** What every list has: its rows are a list of objects, with a count and, when there is a next page, a marker. */
const listDefects = (key: string): Defect[] => [
  [`${key} that are not a list`, key, (b) => (b[key] = { 0: b[key][0] })],
  [`no ${key}`, key, (b) => delete b[key]],
  [`a row that is text in ${key}`, `${key}[0]`, (b) => (b[key][0] = "row")],
  ["a count that is text", "count", (b) => (b.count = "1")],
  ["no count", "count", (b) => delete b.count],
  ["a marker that is none", "marker", (b) => (b.marker = "not a marker!")],
  ...coverageDefects,
];

// ---- The objects --------------------------------------------------------------------------------------------------------------------------------

const POINT = (name: string): Defect[] => [
  [`a ${name}.ledger_index that is text`, "ledger_index", (o) => (o[name].ledger_index = "107874617")],
  [`a ${name}.tx_hash in lower case`, "tx_hash", (o) => (o[name].tx_hash = NFT_TX_HASH.toLowerCase())],
  [`a ${name}.tx_hash of 63 digits`, "tx_hash", (o) => (o[name].tx_hash = NFT_TX_HASH.slice(1))],
  [`a ${name}.executed_time that is not a time`, "executed_time", (o) => (o[name].executed_time = "2026-10-24")],
];

/** What makes an NFT not one: the single NFT's object, and each of a page's. */
const nftDefects: Defect[] = [
  ["a lower-case nft_id", "nft_id", (n) => (n.nft_id = NFT_ID.toLowerCase())],
  ["an nft_id of 63 digits", "nft_id", (n) => (n.nft_id = NFT_ID.slice(1))],
  ["an nft_id of 65 digits", "nft_id", (n) => (n.nft_id = `${NFT_ID}0`)],
  ["an nft_id with a letter that is no digit", "nft_id", (n) => (n.nft_id = `G${NFT_ID.slice(1)}`)],
  ["an nft_id that is a number", "nft_id", (n) => (n.nft_id = 8)],
  ["no nft_id", "nft_id", (n) => delete n.nft_id],
  ["a kind that is none", "kind", (n) => (n.kind = "nft")],
  ["no kind", "kind", (n) => delete n.kind],
  ["a burned that is text", "burned", (n) => (n.burned = "false")],
  ["a burned that is a number", "burned", (n) => (n.burned = 0)],
  ["no burned", "burned", (n) => delete n.burned],
  ["an issuer that is no address", "issuer", (n) => (n.issuer = "rNope")],
  ["no issuer", "issuer", (n) => delete n.issuer],
  ["a taxon that is text", "taxon", (n) => (n.taxon = "10")],
  ["a taxon with a fraction", "taxon", (n) => (n.taxon = 10.5)],
  ["a negative taxon", "taxon", (n) => (n.taxon = -1)],
  ["a taxon beyond 4294967295", "taxon", (n) => (n.taxon = 4294967296)],
  ["a taxon that is null", "taxon", (n) => (n.taxon = null)],
  ["a serial that is text", "serial", (n) => (n.serial = "95234705")],
  ["a serial beyond 4294967295", "serial", (n) => (n.serial = 4294967296)],
  ["a flags that is text", "flags", (n) => (n.flags = "8")],
  ["a negative flags", "flags", (n) => (n.flags = -8)],
  ["no flags", "flags", (n) => delete n.flags],
  ["a transfer_fee that is text", "transfer_fee", (n) => (n.transfer_fee = "5000")],
  ["a transfer_fee with a fraction", "transfer_fee", (n) => (n.transfer_fee = 0.5)],
  ["an owner that is no address", "owner", (n) => (n.owner = "rNope")],
  ["an owner that is null", "owner", (n) => (n.owner = null)],
  ["an owner_since that is text", "owner_since", (n) => (n.owner_since = "since")],
  ...POINT("owner_since"),
  ["a uri that is not hex", "uri", (n) => (n.uri = "ipfs://x")],
  ["a uri of an odd length", "uri", (n) => (n.uri = "697")],
  ["a uri that is empty", "uri", (n) => (n.uri = "")],
  ["a uri that is a number", "uri", (n) => (n.uri = 6970)],
  ["a digest of 63 digits", "digest", (n) => (n.digest = "772B38763E8E603AEE9BBB2026B8E9B97537ECC8867E46D042630C0B326B873")],
  ["a minted that is text", "minted", (n) => (n.minted = "minted")],
  ["a minted without by", "by", (n) => (n.minted = { ledger_index: 1, tx_hash: NFT_TX_HASH, executed_time: "2026-10-24T16:08:12Z", to: NFT_OWNER })],
  ["a minted whose by is no address", "by", (n) => (n.minted = { ledger_index: 1, tx_hash: NFT_TX_HASH, executed_time: "2026-10-24T16:08:12Z", by: "rNope", to: NFT_OWNER })],
  ["a minted whose to is no address", "to", (n) => (n.minted = { ledger_index: 1, tx_hash: NFT_TX_HASH, executed_time: "2026-10-24T16:08:12Z", by: NFT_ISSUER, to: 7 })],
  ["a burned_at that is a list", "burned_at", (n) => (n.burned_at = [])],
  ["a burned_at whose by is no address", "by", (n) => (n.burned_at = { ledger_index: 1, tx_hash: NFT_TX_HASH, executed_time: "2026-10-24T16:08:12Z", by: "rNope" })],
  ["a sale_count that is text", "sale_count", (n) => (n.sale_count = "1")],
  ["a negative sale_count", "sale_count", (n) => (n.sale_count = -1)],
  ["no sale_count", "sale_count", (n) => delete n.sale_count],
  ["a last_sale that is text", "last_sale", (n) => (n.last_sale = "10 XRP")],
  ["a last_sale whose amount is a number", "amount", (n) => (n.last_sale.amount = 10)],
  ["a last_sale whose amount is in exponent form", "amount", (n) => (n.last_sale.amount = "1e-7")],
  ["a last_sale whose amount is empty", "amount", (n) => (n.last_sale.amount = "")],
  ["a last_sale without amount", "amount", (n) => delete n.last_sale.amount],
  ["a last_sale without currency", "currency", (n) => delete n.last_sale.currency],
  ["a last_sale whose amount_issuer is a number", "amount_issuer", (n) => (n.last_sale.amount_issuer = 5)],
  ["a last_sale whose converted_amount is a number", "converted_amount", (n) => (n.last_sale.converted_amount = 10)],
  ["a last_sale whose converted_amount is null", "converted_amount", (n) => (n.last_sale.converted_amount = null)],
  ["a last_sale whose ledger_index is text", "ledger_index", (n) => (n.last_sale.ledger_index = "107874617")],
  ["a last_sale whose tx_hash is in lower case", "tx_hash", (n) => (n.last_sale.tx_hash = NFT_TX_HASH.toLowerCase())],
  ["a last_sale whose executed_time is no time", "executed_time", (n) => (n.last_sale.executed_time = 1729785600)],
];

describe("checkNft", () => {
  const check = (body: unknown) => checkNft(body, PATH);
  pins(check, nftAnswerSample(), [
    ...within("the nft", (b) => b.nft, nftDefects),
    ["an nft that is text", "nft", (b) => (b.nft = NFT_ID)],
    ["no nft", "nft", (b) => delete b.nft],
    ...coverageDefects,
  ]);

  it("takes a URIToken (no taxon, serial or transfer fee, a digest), a burned NFT (no owner) and one with its mint, its URI and its burn", () => {
    for (const nft of [
      uriTokenSample(),
      nftSample({ burned: true, owner: undefined, owner_since: undefined, burned_at: { ledger_index: 107879497, tx_hash: NFT_TX_HASH, executed_time: "2026-10-24T21:30:41Z", by: NFT_OWNER } }),
      nftSample({
        uri: "697066733A2F2F6261667962656963696A356672347537666F79756235376E7A6764736D66646B766B796D336F6C793363746D32736C6335636671793337716F6F792F39362E6A736F6E",
        minted: { ledger_index: 107600000, tx_hash: NFT_TX_HASH, executed_time: "2026-10-20T10:00:00Z", by: NFT_ISSUER, to: NFT_OWNER },
        last_sale: undefined,
        sale_count: 0,
      }),
      // The serial and the taxon at their ends, a fee of nothing, and a sale priced in an issued currency that has no rate (no converted amount).
      nftSample({ taxon: 0, serial: 4294967295, transfer_fee: 0, last_sale: { amount: "0.000001", currency: "USD", amount_issuer: OTHER_ISSUER, ledger_index: 1, tx_hash: NFT_TX_HASH, executed_time: "2026-10-24T16:08:12Z" } }),
    ]) {
      const body = { result: "success", coverage: { complete: true }, nft };
      expect(check(body)).toBe(body);
    }
  });

  it("names the request in the message, and says what was wrong", () => {
    const body = nftAnswerSample({ nft: nftSample({ nft_id: NFT_ID.toLowerCase() }) });
    expect(() => checkNft(body, "/v2/nfts/00081388")).toThrow(
      "data API GET /v2/nfts/00081388 answered something unexpected: nft.nft_id is not an NFT id (64 upper-case hexadecimal digits)",
    );
  });
});

/** What makes an event not one. */
const eventDefects: Defect[] = [
  ["a lower-case nft_id", "nft_id", (e) => (e.nft_id = e.nft_id.toLowerCase())],
  ["an event that is none", "event", (e) => (e.event = "list")],
  ["no event", "event", (e) => delete e.event],
  ["a kind that is none", "kind", (e) => (e.kind = "nft")],
  ["an issuer that is no address", "issuer", (e) => (e.issuer = "rNope")],
  ["a ledger_index that is text", "ledger_index", (e) => (e.ledger_index = "107879497")],
  ["a tx_index that is negative", "tx_index", (e) => (e.tx_index = -1)],
  ["an event_index that is a fraction", "event_index", (e) => (e.event_index = 1.5)],
  ["no event_index", "event_index", (e) => delete e.event_index],
  ["a tx_hash in lower case", "tx_hash", (e) => (e.tx_hash = e.tx_hash.toLowerCase())],
  ["no tx_type", "tx_type", (e) => delete e.tx_type],
  ["an executed_time that is no time", "executed_time", (e) => (e.executed_time = "yesterday")],
  ["an account that is no address", "account", (e) => (e.account = "rNope")],
  ["a from that is no address", "from", (e) => (e.from = "")],
  ["a to that is no address", "to", (e) => (e.to = 5)],
  ["an offer_id in lower case", "offer_id", (e) => (e.offer_id = e.offer_id.toLowerCase())],
  ["an is_sell_offer that is text", "is_sell_offer", (e) => (e.is_sell_offer = "true")],
  ["an amount that is a number", "amount", (e) => (e.amount = 150)],
  ["a converted_amount that is a number", "converted_amount", (e) => (e.converted_amount = 150)],
  ["a converted_amount in exponent form", "converted_amount", (e) => (e.converted_amount = "1.5e+2")],
  ["a currency that is a number", "currency", (e) => (e.currency = 0)],
  ["an amount_issuer that is a number", "amount_issuer", (e) => (e.amount_issuer = 0)],
  ["a destination that is no address", "destination", (e) => (e.destination = "rNope")],
  ["an expiration that is no time", "expiration", (e) => (e.expiration = 1729785600)],
  ["a broker that is no address", "broker", (e) => (e.broker = "rNope")],
  ["a broker_fee that is a number", "broker_fee", (e) => (e.broker_fee = 2.3835)],
  ["a royalty_est that is a number", "royalty_est", (e) => (e.royalty_est = 4.428495)],
  ["a removed_by that is a number", "removed_by", (e) => (e.removed_by = 1)],
  ["a uri that is not hex", "uri", (e) => (e.uri = "ipfs://x")],
];

describe("checkNftEventsPage", () => {
  const check = (body: unknown) => checkNftEventsPage(body, PATH);
  pins(check, nftEventsPageSample(), [...listDefects("events"), ...within("an event", (b) => b.events[0], eventDefects)]);

  it("takes every event kind, the offers' keys and a page with a next page, and an empty one", () => {
    const events = [
      nftEventSample({ event: "mint", account: NFT_ISSUER, from: undefined, to: NFT_OWNER, uri: "697066733A2F2F78", offer_id: undefined, is_sell_offer: undefined, amount: undefined, currency: undefined, converted_amount: undefined, broker: undefined, broker_fee: undefined, royalty_est: undefined }),
      nftEventSample({ event: "offer_create", destination: NFT_OWNER, expiration: "2026-10-25T05:22:08Z", converted_amount: undefined, broker: undefined, broker_fee: undefined, royalty_est: undefined }),
      nftEventSample({ event: "offer_removed", removed_by: "sale" }),
      nftEventSample({ event: "offer_removed", removed_by: "something a later D3 says" }),
      nftEventSample({ event: "transfer", royalty_est: "0" }),
      ...(["burn", "modify", "offer_cancel", "sale"] as const).map((event) => nftEventSample({ event })),
      nftEventSample({ nft_id: URI_TOKEN_ID, kind: "uritoken", issuer: URI_TOKEN_ISSUER, taxon: undefined, serial: undefined, currency: "XAH", amount: "4200", converted_amount: "4200" }),
    ];
    const page = nftEventsPageSample({ count: events.length, events, marker: "WzEwNzg3ODc3NSwxMDQsMV0" });
    expect(check(page)).toBe(page);
    const empty = nftEventsPageSample({ count: 0, events: [] });
    expect(check(empty)).toBe(empty);
  });
});

describe("checkNftOffersPage", () => {
  const check = (body: unknown) => checkNftOffersPage(body, PATH);
  pins(check, nftOffersPageSample(), [
    ...listDefects("offers"),
    ...within("an offer", (b) => b.offers[0], [
      ["an offer_id of 63 digits", "offer_id", (o) => (o.offer_id = o.offer_id.slice(1))],
      ["no offer_id", "offer_id", (o) => delete o.offer_id],
      ["an is_sell_offer that is text", "is_sell_offer", (o) => (o.is_sell_offer = "false")],
      ["no is_sell_offer", "is_sell_offer", (o) => delete o.is_sell_offer],
      ["an owner that is no address", "owner", (o) => (o.owner = "rNope")],
      ["an amount that is a number", "amount", (o) => (o.amount = 6.29)],
      ["no amount", "amount", (o) => delete o.amount],
      ["no currency", "currency", (o) => delete o.currency],
      ["an amount_issuer that is a number", "amount_issuer", (o) => (o.amount_issuer = 1)],
      ["a destination that is no address", "destination", (o) => (o.destination = "rNope")],
      ["an expiration that is no time", "expiration", (o) => (o.expiration = "never")],
      ["a created_ledger that is text", "created_ledger", (o) => (o.created_ledger = "107886233")],
      ["a created_tx_hash in lower case", "created_tx_hash", (o) => (o.created_tx_hash = o.created_tx_hash.toLowerCase())],
      ["a created_time that is no time", "created_time", (o) => (o.created_time = 0)],
    ]),
  ]);

  it("takes a sell offer with no destination or expiration, and an offer in an issued currency", () => {
    const page = nftOffersPageSample({
      count: 2,
      offers: [
        nftOfferSample({ is_sell_offer: true, destination: undefined, expiration: undefined }),
        nftOfferSample({ amount: "0.5", currency: "USD", amount_issuer: OTHER_ISSUER }),
      ],
    });
    expect(check(page)).toBe(page);
  });
});

describe("checkNftSalesPage", () => {
  const check = (body: unknown) => checkNftSalesPage(body, PATH);
  pins(check, nftSalesPageSample(), [
    ...listDefects("sales"),
    ...within("a sale", (b) => b.sales[0], [
      ["a lower-case nft_id", "nft_id", (s) => (s.nft_id = s.nft_id.toLowerCase())],
      ["a kind that is none", "kind", (s) => (s.kind = "token")],
      ["an issuer that is no address", "issuer", (s) => (s.issuer = "rNope")],
      ["a taxon that is text", "taxon", (s) => (s.taxon = "10")],
      ["a tx_index that is text", "tx_index", (s) => (s.tx_index = "299")],
      ["no event_index", "event_index", (s) => delete s.event_index],
      ["a tx_hash in lower case", "tx_hash", (s) => (s.tx_hash = s.tx_hash.toLowerCase())],
      ["an executed_time that is no time", "executed_time", (s) => (s.executed_time = "2026-10-24 16:08:12")],
      ["a seller that is no address", "seller", (s) => (s.seller = "rNope")],
      ["no buyer", "buyer", (s) => delete s.buyer],
      ["a mode that is none", "mode", (s) => (s.mode = "auction")],
      ["no mode", "mode", (s) => delete s.mode],
      ["an amount that is a number", "amount", (s) => (s.amount = 10)],
      ["no amount", "amount", (s) => delete s.amount],
      ["no currency", "currency", (s) => delete s.currency],
      ["a converted_amount that is a number", "converted_amount", (s) => (s.converted_amount = 10)],
      ["a broker that is no address", "broker", (s) => (s.broker = "rNope")],
      ["a broker_fee that is a number", "broker_fee", (s) => (s.broker_fee = 2)],
      ["a royalty_est that is a number", "royalty_est", (s) => (s.royalty_est = 0.5)],
    ]),
  ]);

  it("takes a brokered sale, a sale priced in an issued currency with no rate, a royalty of nothing, and a URIToken's", () => {
    const sales = [
      nftSaleSample({ mode: "brokered", broker: "rpx9JThQ2y37FaGeeJP7PXDUVEXY3PHZSC", broker_fee: "2.3835", royalty_est: "0" }),
      nftSaleSample({ amount: "3", currency: "USD", amount_issuer: OTHER_ISSUER, converted_amount: undefined, royalty_est: undefined }),
      nftSaleSample({ nft_id: uriTokenSample().nft_id, kind: "uritoken", issuer: URI_TOKEN_ISSUER, taxon: undefined, serial: undefined, currency: "XAH", amount: "4200" }),
    ];
    const page = nftSalesPageSample({ count: 3, sales, marker: undefined });
    expect(check(page)).toBe(page);
  });
});

describe("checkHoldersPage", () => {
  const check = (body: unknown) => checkHoldersPage(body, PATH);
  pins(check, nftHoldersPageSample(), [
    ...listDefects("holders"),
    ...within("a holder", (b) => b.holders[0], [
      ["an owner that is no address", "owner", (h) => (h.owner = "rNope")],
      ["no owner", "owner", (h) => delete h.owner],
      ["a held that is text", "held", (h) => (h.held = "1")],
      ["a negative held", "held", (h) => (h.held = -1)],
      ["no held", "held", (h) => delete h.held],
    ]),
  ]);

  it("takes more than one holder", () => {
    const page = nftHoldersPageSample({ count: 2, holders: [holderSample({ held: 7 }), holderSample({ owner: OTHER_ISSUER, held: 2 })] });
    expect(check(page)).toBe(page);
  });
});

describe("checkNftsPage", () => {
  const check = (body: unknown) => checkNftsPage(body, PATH);
  pins(check, nftsPageSample(), [...listDefects("nfts"), ...within("an NFT", (b) => b.nfts[0], nftDefects)]);

  describe("asked for the NFTs of a collection", () => {
    const xrpl = { issuer: NFT_ISSUER, taxon: 10 };

    it("takes a page whose every NFT is of the issuer and the taxon asked for, and an empty one", () => {
      const page = nftsPageSample({ count: 2, nfts: [nftSample(), nftSample({ serial: 95234706 })] });
      expect(checkNftsPage(page, PATH, xrpl)).toBe(page);
      const empty = nftsPageSample({ count: 0, nfts: [] });
      expect(checkNftsPage(empty, PATH, xrpl)).toBe(empty);
    });

    it("refuses an NFT of another issuer", () => {
      const page = nftsPageSample({ count: 2, nfts: [nftSample(), nftSample({ issuer: OTHER_ISSUER })] });
      refuses((body) => checkNftsPage(body, PATH, xrpl), page, "nfts[1].issuer");
    });

    it("refuses an NFT of another taxon", () => {
      const page = nftsPageSample({ nfts: [nftSample({ taxon: 11 })] });
      refuses((body) => checkNftsPage(body, PATH, xrpl), page, "nfts[0].taxon");
    });

    it("refuses an NFT with no taxon where one is asked for", () => {
      const page = nftsPageSample({ nfts: [nftSample({ taxon: undefined })] });
      refuses((body) => checkNftsPage(body, PATH, xrpl), page, "nfts[0].taxon");
    });

    it("asks of a collection of Xahau (an issuer alone) only that the issuer is the one asked for", () => {
      const key = { issuer: URI_TOKEN_ISSUER };
      const page = nftsPageSample({ nfts: [uriTokenSample()], count: 1 });
      expect(checkNftsPage(page, PATH, key)).toBe(page);
      refuses((body) => checkNftsPage(body, PATH, key), nftsPageSample({ nfts: [uriTokenSample({ issuer: OTHER_ISSUER })] }), "nfts[0].issuer");
    });

    it("asks nothing of the issuer without a key (an account's NFTs are of any collection)", () => {
      const page = nftsPageSample({ count: 2, nfts: [nftSample(), nftSample({ issuer: OTHER_ISSUER, taxon: 0 })] });
      expect(checkNftsPage(page, PATH)).toBe(page);
    });
  });
});

describe("checkCollectionsPage", () => {
  const check = (body: unknown) => checkCollectionsPage(body, PATH);
  pins(check, nftCollectionsPageSample(), [
    ...listDefects("collections"),
    ["a total that is text", "total", (b) => (b.total = "25")],
    ["a negative total", "total", (b) => (b.total = -1)],
    ["a total with a fraction", "total", (b) => (b.total = 2.5)],
    ["a collection page without total", "total", (b) => delete b.total],
    ...within("a collection", (b) => b.collections[0], collectionDefects()),
  ]);

  it("takes a page of both forms of collection, whose total is more than the page, or none", () => {
    const page = nftCollectionsPageSample({ total: 400000, count: 2, collections: [collectionSample(), uriTokenCollectionSample()] });
    expect(check(page)).toBe(page);
    const none = nftCollectionsPageSample({ total: 0, count: 0, collections: [], marker: undefined });
    expect(check(none)).toBe(none);
  });
});

/** What makes a collection not one. */
function collectionDefects(): Defect[] {
  return [
    ["an issuer that is no address", "issuer", (c) => (c.issuer = "rNope")],
    ["no issuer", "issuer", (c) => delete c.issuer],
    ["a taxon that is text", "taxon", (c) => (c.taxon = "10")],
    ["a taxon beyond 4294967295", "taxon", (c) => (c.taxon = 4294967296)],
    ["a kind that is none", "kind", (c) => (c.kind = "collection")],
    ["a supply that is text", "supply", (c) => (c.supply = "1")],
    ["no supply", "supply", (c) => delete c.supply],
    ["a negative holders", "holders", (c) => (c.holders = -1)],
    ["a minted with a fraction", "minted", (c) => (c.minted = 0.5)],
    ["no burned", "burned", (c) => delete c.burned],
    ["a sales_count that is text", "sales_count", (c) => (c.sales_count = "1")],
    ["a volume_native that is a number", "volume_native", (c) => (c.volume_native = 10)],
    ["a volume_native in exponent form", "volume_native", (c) => (c.volume_native = "1e+1")],
    ["no volume_native", "volume_native", (c) => delete c.volume_native],
    ["a first_mint that is text", "first_mint", (c) => (c.first_mint = "now")],
    ["a first_mint whose tx_hash is in lower case", "tx_hash", (c) => (c.first_mint = { ledger_index: 1, tx_hash: NFT_TX_HASH.toLowerCase(), executed_time: "2026-10-21T13:29:11Z" })],
    ["a last_mint whose executed_time is no time", "executed_time", (c) => (c.last_mint = { ledger_index: 1, tx_hash: NFT_TX_HASH, executed_time: "2026-10-21" })],
    ["a last_ledger that is text", "last_ledger", (c) => (c.last_ledger = "107874617")],
    ["no last_ledger", "last_ledger", (c) => delete c.last_ledger],
  ];
}

describe("checkCollection", () => {
  const check = (body: unknown) => checkCollection(body, PATH);
  pins(check, nftCollectionAnswerSample(), [
    ...within("the collection", (b) => b.collection, collectionDefects()),
    ["a collection that is text", "collection", (b) => (b.collection = NFT_ISSUER)],
    ["no collection", "collection", (b) => delete b.collection],
    ...coverageDefects,
  ]);

  it("takes a collection of Xahau, with its first and last mint", () => {
    const body = nftCollectionAnswerSample({ collection: uriTokenCollectionSample() });
    expect(check(body)).toBe(body);
  });
});

describe("checkCollectionDays", () => {
  const check = (body: unknown) => checkCollectionDays(body, PATH);
  pins(check, nftCollectionDaysSample(), [
    ...listDefects("days"),
    ...within("a day", (b) => b.days[0], [
      ["a date that is no time", "date", (d) => (d.date = "2026-10-24")],
      ["no date", "date", (d) => delete d.date],
      ["a sales_count that is text", "sales_count", (d) => (d.sales_count = "1")],
      ["a volume_native that is a number", "volume_native", (d) => (d.volume_native = 10)],
      ["an avg_price_native that is a number", "avg_price_native", (d) => (d.avg_price_native = 10)],
      ["a min_price_native that is null", "min_price_native", (d) => (d.min_price_native = null)],
      ["a mints that is text", "mints", (d) => (d.mints = "0")],
      ["a negative burns", "burns", (d) => (d.burns = -1)],
      ["no burns", "burns", (d) => delete d.burns],
    ]),
  ]);

  it("takes a day with no sale that has a price (no average or minimum), and a day with only mints", () => {
    const days = [collectionDaySample({ avg_price_native: undefined, min_price_native: undefined }), collectionDaySample({ sales_count: 0, volume_native: "0", mints: 12, avg_price_native: undefined, min_price_native: undefined })];
    const body = nftCollectionDaysSample({ count: 2, days });
    expect(check(body)).toBe(body);
  });
});

describe("checkNftVolume", () => {
  const live = (body: unknown) => checkNftVolume(body, PATH, "live");
  const daily = (body: unknown) => checkNftVolume(body, PATH, "daily");
  const component = (b: Body) => b.rows[0].components[0];

  const rowDefects: Defect[] = [
    ...listDefects("rows"),
    ...within("a row", (b) => b.rows[0], [
      ["a row without count", "count", (r) => delete r.count],
      ["a count that is text", "count", (r) => (r.count = "4")],
      ["a negative count", "count", (r) => (r.count = -4)],
      ["a total that is a number", "total", (r) => (r.total = 160.000001)],
      ["no total", "total", (r) => delete r.total],
      ["an exchange_rate that is a number", "exchange_rate", (r) => (r.exchange_rate = 1)],
      ["a start_time that is no time", "start_time", (r) => (r.start_time = "2026-10-24")],
      ["no end_time", "end_time", (r) => delete r.end_time],
      ["an exchange that is text", "exchange", (r) => (r.exchange = "XRP")],
      ["an exchange without currency", "exchange", (r) => (r.exchange = {})],
      ["components that are not a list", "components", (r) => (r.components = {})],
      ["no components", "components", (r) => delete r.components],
      ["a component that is text", "components[0]", (r) => (r.components[0] = "rLxc")],
    ]),
    ...within("a component", component, [
      ["an issuer that is no address", "issuer", (c) => (c.issuer = "rNope")],
      ["no issuer", "issuer", (c) => delete c.issuer],
      ["a taxon that is text", "taxon", (c) => (c.taxon = "0")],
      ["a count that is text", "count", (c) => (c.count = "1")],
      ["no count", "count", (c) => delete c.count],
      ["an amount that is a number", "amount", (c) => (c.amount = 150)],
      ["an amount in exponent form", "amount", (c) => (c.amount = "1.5e+2")],
      ["a rate that is a number", "rate", (c) => (c.rate = 1)],
      ["a converted_amount that is a number", "converted_amount", (c) => (c.converted_amount = 150)],
      ["no converted_amount", "converted_amount", (c) => delete c.converted_amount],
    ]),
  ];

  describe("the live row of a rolling period", () => {
    pins(live, nftVolumeSample(), rowDefects);

    it.each([
      ["two rows", [nftVolumeRowSample(), nftVolumeRowSample()]],
      ["no row", []],
    ])("refuses an answer with %s: a rolling period is one row", (_what, rows) => {
      refuses(live, nftVolumeSample({ count: rows.length, rows }), "rows");
    });
  });

  describe("the rows of days", () => {
    pins(daily, nftVolumeSample({ count: 2, rows: [nftVolumeRowSample(), nftVolumeRowSample({ components: [], count: 0, total: "0" })] }), rowDefects);

    it("takes any number of rows, none included", () => {
      const none = nftVolumeSample({ count: 0, rows: [] });
      expect(daily(none)).toBe(none);
      const many = nftVolumeSample({ count: 3, rows: [nftVolumeRowSample(), nftVolumeRowSample(), nftVolumeRowSample()], marker: "WzEwNzg3ODc3NSwxMDQsMV0" });
      expect(daily(many)).toBe(many);
    });
  });

  it("takes the amounts of a row shown in another currency, which follow the other volumes' text (an exponent below 1e-6, a rate to 8 digits), and a component with no taxon (Xahau)", () => {
    const row = nftVolumeRowSample({
      components: [{ issuer: URI_TOKEN_ISSUER, count: 2, amount: "4200", rate: "1.2345679e+8", converted_amount: "5.185e+11" }],
      exchange: { currency: "USD", issuer: OTHER_ISSUER },
      total: "5.185e+11",
      exchange_rate: "1.0000000e-7",
    });
    const body = nftVolumeSample({ rows: [row] });
    expect(live(body)).toBe(body);
    expect(daily(body)).toBe(body);
  });

  it("takes a row of a network with no sales: no components", () => {
    const body = nftVolumeSample({ rows: [nftVolumeRowSample({ components: [], count: 0, total: "0" })] });
    expect(live(body)).toBe(body);
  });
});

describe("every check", () => {
  const checks: Array<[string, (body: unknown) => unknown]> = [
    ["checkNft", (body) => checkNft(body, PATH)],
    ["checkNftEventsPage", (body) => checkNftEventsPage(body, PATH)],
    ["checkNftOffersPage", (body) => checkNftOffersPage(body, PATH)],
    ["checkNftSalesPage", (body) => checkNftSalesPage(body, PATH)],
    ["checkHoldersPage", (body) => checkHoldersPage(body, PATH)],
    ["checkNftsPage", (body) => checkNftsPage(body, PATH)],
    ["checkCollectionsPage", (body) => checkCollectionsPage(body, PATH)],
    ["checkCollection", (body) => checkCollection(body, PATH)],
    ["checkCollectionDays", (body) => checkCollectionDays(body, PATH)],
    ["checkNftVolume, live", (body) => checkNftVolume(body, PATH, "live")],
    ["checkNftVolume, daily", (body) => checkNftVolume(body, PATH, "daily")],
  ];

  it.each(checks)("%s refuses what is no object, as the answer", (_name, check) => {
    for (const body of [null, undefined, "success", 7, [], [{ coverage: { complete: true } }]]) {
      refuses(check, body, "the answer is not an object");
    }
  });
});
