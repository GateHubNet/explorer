import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { tokenOf } from "../domain/fnv";
import { compactNumber, formatAmount } from "../domain/format";
import { collectionHref, type CollectionQuery, type CollectionKey, type NftMeasure } from "../domain/nft-params";
import { windowOf } from "../domain/window";
import {
  coverageSample,
  holderSample,
  NFT_ID,
  NFT_ISSUER,
  NFT_MARKER,
  NFT_OWNER,
  NFT_SELLER,
  nftCollectionAnswerSample,
  nftHoldersPageSample,
  nftSaleSample,
  nftSalesPageSample,
  nftSample,
  nftsPageSample,
  collectionSample,
  OTHER_NFT_ID,
  uriTokenCollectionSample,
  uriTokenSample,
  URI_TOKEN_ISSUER,
  URI_TOKEN_OWNER,
} from "../../test/support/nft-samples";
import type { LastValidated, NftCollection, NftCollectionAnswer, NftCollectionDay, NftCollectionDays, NftHoldersPage, NftSalesPage, NftsPage } from "./api-types";
import { TooLate } from "./deadline";
import {
  collectionDaySeries,
  collectionMarkerPage,
  collectionNotFound,
  nftCollectionPage,
  type CollectionMarkerInput,
  type CollectionNet,
  type CollectionNftRow,
  type HolderRow,
  type NftCollectionPageInput,
} from "./nft-collection-view";
import { saleRows } from "./nfts-view";
import { UpstreamError } from "./upstream";

// ---- The world of the tests: T is Oct 17, the running day --------------------------------------------------------------------------------------

const XRPL: CollectionNet = { id: "xrpl", name: "XRPL", native: "XRP", longName: "the XRP Ledger" };
const XRPL_TESTNET: CollectionNet = { id: "xrpl", name: "XRPL Testnet", native: "XRP", longName: "XRPL Testnet" };
const XAHAU: CollectionNet = { id: "xahau", name: "Xahau", native: "XAH", longName: "Xahau" };

const KEY: CollectionKey = { issuer: NFT_ISSUER, taxon: 10 };
const URI_KEY: CollectionKey = { issuer: URI_TOKEN_ISSUER };
const LABEL = "r4PP7g…CzT3 · taxon 10";
const URI_LABEL = "rodinG…zKyb";

const fulfilled = <T>(value: T): PromiseFulfilledResult<T> => ({ status: "fulfilled", value });
const rejected = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });

const LAST: LastValidated = {
  result: "success",
  ledger_index: "107721455",
  ledger_hash: "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092",
  parent_hash: "5FA71FCC25A865DA7569108807E031AFB3E1CD03A8CE078BC1AA534C8E546BE8",
  close_time: "2026-10-17T17:01:12Z",
};
/** E2's window for that T: the 30 days from Sep 18 to Oct 17. */
const W = windowOf("2026-10-17", "30d");

const QUERY: CollectionQuery = { measure: "volume", tab: "sales", burned: false, back: [] };
const WHOLE = coverageSample({ complete: true });
const MARKERS = { M1: "WzEwNzg4NjE2Myw4MywxXQ", M2: "WzEwNzg4MTUzMCwxNjIsMV0" };
const HASH_A = "3D9B20E130D7498E98FB3499BD4C2AC4CCDB3D11FFBFEA8F9B7FB844DDF33426";
const HASH_B = "BADF36AA20CD32067693C83EE5755BEFB8D1A1E82DEE83E1E67FFD6100712E56";

/** A row of the stats: `bucket` is a day of the window; with no sale, no mint and no burn, and so no prices (the API leaves them out of a day that has no sale with a price). */
const day = (bucket: string, over: Partial<NftCollectionDay> = {}): NftCollectionDay => ({ date: `${bucket}T00:00:00Z`, sales_count: 0, volume_native: "0", mints: 0, burns: 0, ...over });
const daysOf = (days: NftCollectionDay[], coverage = WHOLE): NftCollectionDays => ({ coverage, count: days.length, days });
/** A collection's answer. */
const answerOf = (collection: NftCollection = collectionSample(), coverage = WHOLE) => nftCollectionAnswerSample({ collection, coverage });

/** The page as the loader reads it: every call answered, the Sales tab, complete coverage. */
function pageInput(over: Partial<NftCollectionPageInput> = {}): NftCollectionPageInput {
  return {
    net: XRPL,
    key: KEY,
    query: QUERY,
    collection: answerOf(),
    last: fulfilled(LAST),
    stats: fulfilled(daysOf([])),
    list: fulfilled(nftSalesPageSample({ coverage: WHOLE })),
    ...over,
  };
}

/** The page behind a marker: the collection and the list. */
function markerInput(over: Partial<CollectionMarkerInput> = {}): CollectionMarkerInput {
  return {
    net: XRPL,
    key: KEY,
    query: { ...QUERY, marker: MARKERS.M2, back: [MARKERS.M1] },
    collection: answerOf(),
    list: fulfilled(nftSalesPageSample({ coverage: WHOLE })),
    ...over,
  };
}

const rowsOf = <T>(rows: unknown): T[] => {
  if (rows === null) throw new Error("the rows failed");
  return rows as T[];
};

// ---- The header and the six stats -----------------------------------------------------------------------------------------------------------------

describe("the header and the six stats", () => {
  it("fills the header and the six stats; — where there is no data", () => {
    const collection = collectionSample({
      supply: 10000,
      holders: 3412,
      minted: 10000,
      burned: 0,
      sales_count: 412,
      volume_native: "181234.5",
      first_mint: { ledger_index: 26689211, tx_hash: HASH_A, executed_time: "2026-03-14T09:00:00Z" },
      last_mint: { ledger_index: 26771798, tx_hash: HASH_B, executed_time: "2026-10-14T18:42:07Z" },
    });
    const days = [
      day("2026-10-14", { sales_count: 3, volume_native: "300", avg_price_native: "100", min_price_native: "60" }),
      day("2026-10-16", { sales_count: 2, volume_native: "90", avg_price_native: "45", min_price_native: "40" }),
    ];
    const page = nftCollectionPage(pageInput({ collection: answerOf(collection), stats: fulfilled(daysOf(days)) }));
    expect(page.breadcrumb).toEqual([{ label: "XRPL", href: "/xrpl" }, { label: "NFTs", href: "/xrpl/nfts" }, { label: LABEL }]);
    expect(page.header).toEqual({
      glyph: "4P",
      heading: `Collection ${LABEL}`,
      tag: "NFToken collection",
      issuer: NFT_ISSUER,
      taxon: 10,
      firstMint: { day: "Mar 14, 2026", href: `/xrpl/tx/${HASH_A}` },
      lastMint: { day: "Oct 14, 2026", href: `/xrpl/tx/${HASH_B}` },
    });
    expect(page.stats).toEqual({
      supply: { figure: "10,000", note: "10,000 minted · 0 burned" },
      holders: { figure: "3,412", note: "accounts holding one or more" },
      sales: { figure: "412", note: "all time" },
      volume: { figure: "181K XRP", note: "all time, at daily rates" },
      // 390 ÷ (3 + 2) rated sales
      average30: { figure: "78 XRP", note: "5 sales" },
      lowest30: { figure: "40 XRP", note: "a sale, not an open offer" },
    });
    expect(page.title).toBe(`Collection ${LABEL}`);
    expect(page.marker).toBe(false);
    expect(page.back).toBeNull();
    expect(page.failures).toEqual({});
  });

  it("leaves a mint's date out of the header when the collection has none, and writes — for the figures with no sale in the 30 days", () => {
    const page = nftCollectionPage(pageInput({ collection: answerOf(collectionSample({ sales_count: 0, volume_native: "0" })) }));
    expect(page.header).not.toHaveProperty("firstMint");
    expect(page.header).not.toHaveProperty("lastMint");
    expect(page.stats.volume).toEqual({ figure: "0 XRP", note: "all time, at daily rates" });
    expect(page.stats.average30).toEqual({ figure: "—", note: "no sale in 30 days" });
    expect(page.stats.lowest30).toEqual({ figure: "—", note: "a sale, not an open offer" });
  });

  it("leaves out the part of the dates that the collection lacks", () => {
    const only = { ledger_index: 26689211, tx_hash: HASH_A, executed_time: "2026-03-14T09:00:00Z" };
    const first = nftCollectionPage(pageInput({ collection: answerOf(collectionSample({ first_mint: only })) }));
    expect(first.header.firstMint).toEqual({ day: "Mar 14, 2026", href: `/xrpl/tx/${HASH_A}` });
    expect(first.header).not.toHaveProperty("lastMint");
    const last = nftCollectionPage(pageInput({ collection: answerOf(collectionSample({ last_mint: only })) }));
    expect(last.header).not.toHaveProperty("firstMint");
    expect(last.header.lastMint).toEqual({ day: "Mar 14, 2026", href: `/xrpl/tx/${HASH_A}` });
  });

  it("groups a large taxon in the label and leaves the taxon of the header as the number it is", () => {
    const page = nftCollectionPage(pageInput({ key: { issuer: NFT_ISSUER, taxon: 1000 }, collection: answerOf(collectionSample({ taxon: 1000 })) }));
    expect(page.header.heading).toBe("Collection r4PP7g…CzT3 · taxon 1,000");
    expect(page.header.taxon).toBe(1000);
    expect(page.breadcrumb.at(-1)).toEqual({ label: "r4PP7g…CzT3 · taxon 1,000" });
    // a taxon of 0 is a taxon
    expect(nftCollectionPage(pageInput({ key: { issuer: NFT_ISSUER, taxon: 0 } })).header.taxon).toBe(0);
  });

  it("writes the exact digits of a large supply and a volume with decimals, no exponent", () => {
    const collection = collectionSample({ supply: 1234567, holders: 1000000000000000000000, minted: 1234568, burned: 1, sales_count: 12, volume_native: "1234.567891" });
    const page = nftCollectionPage(pageInput({ collection: answerOf(collection) }));
    expect(page.stats.supply).toEqual({ figure: "1,234,567", note: "1,234,568 minted · 1 burned" });
    expect(page.stats.holders.figure).toBe("1,000,000,000,000,000,000,000");
    expect(page.stats.volume.figure).toBe(`${compactNumber("1234.567891")} XRP`);
  });

  it("says the testnet's name in the breadcrumb and the network's native currency in the figures", () => {
    const page = nftCollectionPage(pageInput({ net: XRPL_TESTNET }));
    expect(page.breadcrumb[0]).toEqual({ label: "XRPL Testnet", href: "/xrpl" });
    expect(page.stats.volume.figure).toBe("10 XRP");
  });
});

// ---- The 30-day figures -------------------------------------------------------------------------------------------------------------------

describe("the 30-day average and lowest sale", () => {
  const averageOf = (days: NftCollectionDay[], net: CollectionNet = XRPL) => nftCollectionPage(pageInput({ net, stats: fulfilled(daysOf(days)) })).stats;

  it("the 30-day average and lowest come from the days with a rated sale only", () => {
    const days = [
      // before the window: not one of the 30 days
      day("2026-09-17", { sales_count: 100, volume_native: "1", avg_price_native: "0.01", min_price_native: "0.01" }),
      day("2026-09-20", { sales_count: 3, volume_native: "300", avg_price_native: "100", min_price_native: "60" }),
      day("2026-09-25", { sales_count: 2, volume_native: "90", avg_price_native: "45", min_price_native: "40" }),
      // two sales, one with no rate: the average is of the one that has a price, so one rated sale
      day("2026-10-01", { sales_count: 2, volume_native: "10", avg_price_native: "10", min_price_native: "10" }),
      // sales that have no price in the native currency, and a day of mints only: no average, no lowest
      day("2026-10-02", { sales_count: 4, volume_native: "0" }),
      day("2026-10-03", { sales_count: 0, volume_native: "0", mints: 5 }),
    ];
    const stats = averageOf(days);
    // 400 ÷ 6 rated sales; with the day's `sales_count` the sum would be 7 and the average 57
    expect(stats.average30).toEqual({ figure: "67 XRP", note: "6 sales" });
    expect(stats.lowest30).toEqual({ figure: "10 XRP", note: "a sale, not an open offer" });
  });

  it("counts a day's rated sales as its volume over its average, to a whole number: the average has 6 decimals", () => {
    // 10 ÷ 3.333333 = 3.0000003: three sales; the average is 10 ÷ 3
    const stats = averageOf([day("2026-10-10", { sales_count: 3, volume_native: "10", avg_price_native: "3.333333", min_price_native: "3" })]);
    expect(stats.average30).toEqual({ figure: "3 XRP", note: "3 sales" });
    expect(stats.lowest30.figure).toBe("3 XRP");
  });

  it("rounds the average half up, and says one sale for one", () => {
    expect(averageOf([day("2026-10-10", { sales_count: 2, volume_native: "5", avg_price_native: "2.5", min_price_native: "2" })]).average30).toEqual({ figure: "3 XRP", note: "2 sales" });
    expect(averageOf([day("2026-10-10", { sales_count: 2, volume_native: "4.999999", avg_price_native: "4.999999", min_price_native: "4.999999" })]).average30).toEqual({ figure: "5 XRP", note: "1 sale" });
    expect(averageOf([day("2026-10-10", { sales_count: 1, volume_native: "0.4", avg_price_native: "0.4", min_price_native: "0.4" })]).average30.figure).toBe("0 XRP");
  });

  it("counts the whole number of sales that D3's rounded average allows: 20 over three sales at 6.666667 is 3, not 2", () => {
    // 20 ÷ 6.666667 = 2.9999999…: a floor would say two sales; three sales make 6.666666…, which rounds to 6.666667
    const stats = averageOf([day("2026-10-10", { sales_count: 3, volume_native: "20", avg_price_native: "6.666667", min_price_native: "6" })]);
    expect(stats.average30).toEqual({ figure: "7 XRP", note: "3 sales" });
  });

  it("counts the sales of a day of dust prices exactly where the average allows one number", () => {
    // 0.000009 over four sales is 0.00000225, which rounds to 0.000002; 0.000009 ÷ 0.000002 would be four and a half, and only four sales fit the average and the day
    const dust = averageOf([day("2026-10-10", { sales_count: 4, volume_native: "0.000009", avg_price_native: "0.000002", min_price_native: "0.000001" })]);
    expect(dust.average30).toEqual({ figure: "0 XRP", note: "4 sales" });
    // with a sale of 1000 beside it the figure moves by the five sales, and nothing is guessed
    const both = averageOf([
      day("2026-10-10", { sales_count: 4, volume_native: "0.000009", avg_price_native: "0.000002", min_price_native: "0.000001" }),
      day("2026-10-11", { sales_count: 1, volume_native: "1000", avg_price_native: "1000", min_price_native: "1000" }),
    ]);
    expect(both.average30).toEqual({ figure: "200 XRP", note: "5 sales" });
  });

  it("says about when a day's average allows several counts: ten sales of 0.000016 in all, beside one of 1000", () => {
    // 0.000016 at an average of 0.000002 is seven to ten sales (the data API has the count and does not serve it): the rounding says eight, and the note says it is a guess
    const stats = averageOf([
      day("2026-10-10", { sales_count: 10, volume_native: "0.000016", avg_price_native: "0.000002", min_price_native: "0.000001" }),
      day("2026-10-11", { sales_count: 1, volume_native: "1000", avg_price_native: "1000", min_price_native: "1000" }),
    ]);
    expect(stats.average30).toEqual({ figure: "111 XRP", note: "about 9 sales" });
    expect(stats.lowest30.figure).toBe("0.000001 XRP");
    // one day that is not sure makes the sum "about"; a day that is sure alone does not
    expect(averageOf([day("2026-10-10", { sales_count: 10, volume_native: "0.000016", avg_price_native: "0.000002", min_price_native: "0.000001" })]).average30.note).toBe("about 8 sales");
    expect(averageOf([day("2026-10-10", { sales_count: 1, volume_native: "1000", avg_price_native: "1000", min_price_native: "1000" })]).average30.note).toBe("1 sale");
  });

  it("never counts more rated sales than a day has sales, and says about when the day's own figures do not fit", () => {
    // 10 over two sales is 5 each, not 0.000001: no count fits, so the rounding (ten million) is held to the day's two sales
    const stats = averageOf([day("2026-10-10", { sales_count: 2, volume_native: "10", avg_price_native: "0.000001", min_price_native: "0.000001" })]);
    expect(stats.average30).toEqual({ figure: "5 XRP", note: "about 2 sales" });
    expect(stats.lowest30.figure).toBe("0.000001 XRP");
  });

  it("counts a day whose average is 0 with all its sales: a price of 0 is a price", () => {
    // five sales that came to 0 (an average of 0 to six decimals), and one of 100
    const stats = averageOf([
      day("2026-10-10", { sales_count: 5, volume_native: "0", avg_price_native: "0", min_price_native: "0" }),
      day("2026-10-11", { sales_count: 1, volume_native: "100", avg_price_native: "100", min_price_native: "100" }),
    ]);
    expect(stats.average30).toEqual({ figure: "17 XRP", note: "6 sales" });
    expect(stats.lowest30.figure).toBe("0 XRP");
    // a day of one sale of 0 is an average of 0 too
    const alone = averageOf([day("2026-10-10", { sales_count: 1, volume_native: "0", avg_price_native: "0", min_price_native: "0" })]);
    expect(alone.average30).toEqual({ figure: "0 XRP", note: "1 sale" });
    expect(alone.lowest30.figure).toBe("0 XRP");
  });

  it("says why there is no average: no sale, or sales with no rate", () => {
    expect(averageOf([day("2026-10-10", { sales_count: 0, volume_native: "0", mints: 2 })]).average30).toEqual({ figure: "—", note: "no sale in 30 days" });
    expect(averageOf([day("2026-10-10", { sales_count: 2, volume_native: "0" })]).average30).toEqual({ figure: "—", note: "2 sales, none with a daily XRP rate" });
    expect(averageOf([day("2026-10-10", { sales_count: 1, volume_native: "0" })], XAHAU).average30).toEqual({ figure: "—", note: "1 sale, none with a daily XAH rate" });
  });

  it("writes the lowest price with its decimals, grouped, in the native currency", () => {
    const stats = averageOf([day("2026-10-10", { sales_count: 1, volume_native: "12345.5", avg_price_native: "12345.5", min_price_native: "12345.5" })], XAHAU);
    expect(stats.lowest30).toEqual({ figure: "12,345.5 XAH", note: "a sale, not an open offer" });
    expect(stats.average30).toEqual({ figure: "12,346 XAH", note: "1 sale" });
  });

  it("takes the lowest of the days' lowest, whichever the order of the days", () => {
    const stats = averageOf([
      day("2026-10-12", { sales_count: 1, volume_native: "9", avg_price_native: "9", min_price_native: "9" }),
      day("2026-10-10", { sales_count: 1, volume_native: "2.5", avg_price_native: "2.5", min_price_native: "2.5" }),
      day("2026-10-11", { sales_count: 1, volume_native: "30", avg_price_native: "30", min_price_native: "30" }),
    ]);
    expect(stats.lowest30.figure).toBe("2.5 XRP");
  });
});

// ---- The chart ----------------------------------------------------------------------------------------------------------------------------

describe("collectionDaySeries", () => {
  const days = [
    day("2026-09-18", { sales_count: 2, volume_native: "30", avg_price_native: "15", min_price_native: "10", mints: 1 }),
    // one sale that has no rate: a sale, no volume, no price
    day("2026-10-01", { sales_count: 1, volume_native: "0", burns: 1 }),
    // the running day
    day("2026-10-17", { sales_count: 1, volume_native: "7.5", avg_price_native: "7.5", min_price_native: "7.5" }),
    // a day outside the window is no bucket
    day("2026-09-10", { sales_count: 9, volume_native: "999", avg_price_native: "111", min_price_native: "111" }),
  ];
  const at = { first: 0, quiet: 1, unrated: W.buckets.indexOf("2026-10-01"), running: 29 };

  it("collectionDaySeries: 30 buckets, quiet days 0 sales and null prices, the running day forming, each measure", () => {
    const data = collectionDaySeries(days, W, "volume", "XRP");
    expect(data.axis).toEqual({ unit: "day", buckets: W.buckets });
    expect(data.axis.buckets).toHaveLength(30);
    expect(data.forming).toBe(true);
    expect(data.pending).toBeUndefined();
    expect(data.series).toHaveLength(1);

    const values = (measure: NftMeasure) => collectionDaySeries(days, W, measure, "XRP").series[0]!.values;
    const picked = (list: (string | null)[]) => [at.first, at.quiet, at.unrated, at.running].map((index) => list[index]);
    expect(values("volume")).toHaveLength(30);
    expect(picked(values("volume"))).toEqual(["30", "0", "0", "7.5"]);
    expect(picked(values("sales"))).toEqual(["2", "0", "1", "1"]);
    expect(picked(values("avg"))).toEqual(["15", null, null, "7.5"]);
    expect(picked(values("low"))).toEqual(["10", null, null, "7.5"]);
    // every other day is quiet
    expect(values("volume").filter((value) => value === "0")).toHaveLength(28);
    expect(values("sales").filter((value) => value === "0")).toHaveLength(27);
    expect(values("avg").filter((value) => value === null)).toHaveLength(28);
  });

  it("names the series and formats it by the measure: an amount, a count, a price", () => {
    const series = (measure: NftMeasure) => collectionDaySeries(days, W, measure, "XRP");
    expect(series("volume")).toMatchObject({ series: [{ id: "volume", label: "Volume", slot: 1 }], format: { kind: "amount", unit: "XRP" } });
    expect(series("sales")).toMatchObject({ series: [{ id: "sales", label: "Sales", slot: 1 }], format: { kind: "count" } });
    expect(series("avg")).toMatchObject({ series: [{ id: "avg", label: "Average", slot: 1 }], format: { kind: "price", unit: "XRP" } });
    expect(series("low")).toMatchObject({ series: [{ id: "low", label: "Lowest", slot: 1 }], format: { kind: "price", unit: "XRP" } });
    expect(collectionDaySeries(days, W, "volume", "XAH").format).toEqual({ kind: "amount", unit: "XAH" });
  });

  it("carries the other figures of each day as extras: Sales, Volume, Average, Lowest, Minted (the measure's own is the series)", () => {
    const extrasOf = (measure: NftMeasure) => collectionDaySeries(days, W, measure, "XRP").extras!;
    expect(extrasOf("volume").map((extra) => extra.label)).toEqual(["Sales", "Average", "Lowest", "Minted"]);
    expect(extrasOf("sales").map((extra) => extra.label)).toEqual(["Volume", "Average", "Lowest", "Minted"]);
    expect(extrasOf("avg").map((extra) => extra.label)).toEqual(["Sales", "Volume", "Lowest", "Minted"]);
    expect(extrasOf("low").map((extra) => extra.label)).toEqual(["Sales", "Volume", "Average", "Minted"]);

    const all = Object.fromEntries(extrasOf("volume").concat(extrasOf("sales").filter((extra) => extra.id === "volume")).map((extra) => [extra.id, extra]));
    const picked = (id: string) => [at.first, at.quiet, at.unrated, at.running].map((index) => all[id]!.values[index]);
    expect(picked("sales")).toEqual(["2", "0", "1", "1"]);
    expect(picked("volume")).toEqual(["30", "0", "0", "7.5"]);
    expect(picked("avg")).toEqual(["15", null, null, "7.5"]);
    expect(picked("low")).toEqual(["10", null, null, "7.5"]);
    expect(picked("mints")).toEqual(["1", "0", "0", "0"]);
    expect(all.sales).toMatchObject({ format: { kind: "count" } });
    expect(all.volume).toMatchObject({ format: { kind: "amount", unit: "XRP" } });
    expect(all.avg).toMatchObject({ format: { kind: "price", unit: "XRP" } });
    expect(all.low).toMatchObject({ format: { kind: "price", unit: "XRP" } });
    expect(all.mints).toMatchObject({ format: { kind: "count" } });
    for (const extra of Object.values(all)) expect(extra.values).toHaveLength(30);
  });

  it("holds its token over everything it draws", () => {
    const { token, ...rest } = collectionDaySeries(days, W, "volume", "XRP");
    expect(token).toBe(tokenOf(rest));
    expect(collectionDaySeries(days, W, "sales", "XRP").token).not.toBe(token);
    expect(collectionDaySeries(days.slice(0, 1), W, "volume", "XRP").token).not.toBe(token);
  });

  it("draws 30 quiet days for no row: 0 sales and no prices, all the same", () => {
    const data = collectionDaySeries([], W, "avg", "XRP");
    expect(data.series[0]!.values).toEqual(Array.from({ length: 30 }, () => null));
    expect(collectionDaySeries([], W, "sales", "XRP").series[0]!.values).toEqual(Array.from({ length: 30 }, () => "0"));
  });
});

describe("the chart of the page", () => {
  const days = [day("2026-10-14", { sales_count: 3, volume_native: "300", avg_price_native: "100", min_price_native: "60" })];

  it("is titled by the measure, in the native currency", () => {
    const titleOf = (measure: NftMeasure, net = XRPL) => nftCollectionPage(pageInput({ net, query: { ...QUERY, measure }, stats: fulfilled(daysOf(days)) })).chart!.title;
    expect(titleOf("volume")).toBe("Sales volume per day, in XRP, last 30 days");
    expect(titleOf("sales")).toBe("Sales per day, last 30 days");
    expect(titleOf("avg")).toBe("Average sale price per day, in XRP, last 30 days");
    expect(titleOf("low")).toBe("Lowest sale price per day, in XRP, last 30 days");
    expect(titleOf("avg", XAHAU)).toBe("Average sale price per day, in XAH, last 30 days");
  });

  it("holds the series of the measure over the window", () => {
    const page = nftCollectionPage(pageInput({ query: { ...QUERY, measure: "avg" }, stats: fulfilled(daysOf(days)) }));
    expect(page.chart!.data).toEqual(collectionDaySeries(days, W, "avg", "XRP"));
    expect(page.chart!.data.series[0]!.values[W.buckets.indexOf("2026-10-14")]).toBe("100");
  });

  it("links the four measures, keeping the tab and what it filters, and marks the current one", () => {
    const page = nftCollectionPage(pageInput({ query: { ...QUERY, measure: "sales" } }));
    expect(page.measures).toEqual([
      { label: "Volume", href: collectionHref("xrpl", KEY), current: false },
      { label: "Sales", href: collectionHref("xrpl", KEY, { measure: "sales" }), current: true },
      { label: "Average price", href: collectionHref("xrpl", KEY, { measure: "avg" }), current: false },
      { label: "Lowest price", href: collectionHref("xrpl", KEY, { measure: "low" }), current: false },
    ]);
    expect(page.measures.map((link) => link.href)).toEqual([`/xrpl/nfts/${NFT_ISSUER}/10`, `/xrpl/nfts/${NFT_ISSUER}/10?measure=sales`, `/xrpl/nfts/${NFT_ISSUER}/10?measure=avg`, `/xrpl/nfts/${NFT_ISSUER}/10?measure=low`]);
    const filtered = nftCollectionPage(pageInput({ query: { ...QUERY, tab: "nfts", owner: NFT_OWNER, burned: true }, list: fulfilled(nftsPageSample({ coverage: WHOLE })) }));
    expect(filtered.measures[2]!.href).toBe(`/xrpl/nfts/${NFT_ISSUER}/10?measure=avg&tab=nfts&owner=${NFT_OWNER}&burned=1`);
  });

  it("leaves a bad owner out of the measure links, as it is no filter", () => {
    const page = nftCollectionPage(pageInput({ query: { ...QUERY, tab: "nfts", owner: "nope" }, ownerError: "Write a classic address (r…).", list: null }));
    expect(page.measures[2]!.href).toBe(`/xrpl/nfts/${NFT_ISSUER}/10?measure=avg&tab=nfts`);
  });

  it("says the coverage of the collection's own answer, which the six stats are of, in sales words; nothing when it is whole", () => {
    const page = nftCollectionPage(pageInput({ collection: answerOf(collectionSample(), coverageSample()) }));
    expect(page.notes.stats).toEqual({ before: "Covers ledger ", ledger: 107874617, after: " onwards: earlier NFT sales are not in the index yet." });
    // Its own: not the days', not the list's.
    expect(page.notes.chart).toBeNull();
    expect(page.notes.tab).toBeNull();
    expect(nftCollectionPage(pageInput()).notes.stats).toBeNull();
    expect(nftCollectionPage(pageInput({ stats: fulfilled(daysOf(days, coverageSample())) })).notes.stats).toBeNull();
    expect(nftCollectionPage(pageInput({ net: XAHAU, key: URI_KEY, collection: answerOf(uriTokenCollectionSample(), coverageSample()) })).notes.stats?.after).toBe(
      " onwards: earlier URIToken sales are not in the index yet.",
    );
    // The daily figures failing take the chart's note, not the stats'.
    expect(nftCollectionPage(pageInput({ collection: answerOf(collectionSample(), coverageSample()), stats: rejected(new UpstreamError("server", "unexpected")) })).notes.stats).not.toBeNull();
  });

  it("says the coverage of the days, in sales words", () => {
    const page = nftCollectionPage(pageInput({ stats: fulfilled(daysOf(days, coverageSample())) }));
    expect(page.notes.chart).toEqual({ before: "Covers ledger ", ledger: 107874617, after: " onwards: earlier NFT sales are not in the index yet." });
    expect(nftCollectionPage(pageInput()).notes.chart).toBeNull();
    expect(nftCollectionPage(pageInput({ net: XAHAU, key: URI_KEY, stats: fulfilled(daysOf(days, coverageSample())) })).notes.chart?.after).toBe(" onwards: earlier URIToken sales are not in the index yet.");
  });
});

// ---- The tabs ------------------------------------------------------------------------------------------------------------------------------

describe("the tabs", () => {
  it("links the three tabs, marks the current one, and keeps the chart's measure", () => {
    const page = nftCollectionPage(pageInput({ query: { ...QUERY, measure: "avg", tab: "nfts", owner: NFT_OWNER }, list: fulfilled(nftsPageSample()) }));
    expect(page.tabs).toEqual([
      { id: "sales", label: "Sales", href: `/xrpl/nfts/${NFT_ISSUER}/10?measure=avg` },
      { id: "nfts", label: "NFTs", href: `/xrpl/nfts/${NFT_ISSUER}/10?measure=avg&tab=nfts` },
      { id: "holders", label: "Holders", href: `/xrpl/nfts/${NFT_ISSUER}/10?measure=avg&tab=holders` },
    ]);
    expect(page.tab).toBe("nfts");
  });

  it("sales tab: the shared sale rows", () => {
    const sales = [nftSaleSample(), nftSaleSample({ tx_hash: HASH_A, event_index: 2, amount: "40", currency: "USD", amount_issuer: NFT_OWNER, converted_amount: "20", royalty_est: "2" })];
    const page = nftCollectionPage(pageInput({ list: fulfilled(nftSalesPageSample({ sales, coverage: WHOLE })) }));
    expect(page.tab).toBe("sales");
    expect(page.rows).toEqual(saleRows(XRPL, sales));
    expect(rowsOf<ReturnType<typeof saleRows>[number]>(page.rows)[1]).toMatchObject({ converted: "≈ 20 XRP", royalty: "1 XRP" });
    expect(page.form).toBeNull();
    expect(page.empty).toBeNull();
    expect(page.notes.tab).toBeNull();
    expect(page.failures).toEqual({});
    expect(page.paging).toEqual({ newerHref: null, olderHref: `/xrpl/nfts/${NFT_ISSUER}/10?marker=${NFT_MARKER}` });
  });

  it("says the sales' coverage in the network's words", () => {
    const page = nftCollectionPage(pageInput({ list: fulfilled(nftSalesPageSample({ coverage: coverageSample() })) }));
    expect(page.notes.tab).toEqual({ before: "Covers ledger ", ledger: 107874617, after: " onwards: earlier NFT sales are not in the index yet." });
    const xahau = nftCollectionPage(pageInput({ net: XAHAU, key: URI_KEY, list: fulfilled(nftSalesPageSample({ coverage: coverageSample() })) }));
    expect(xahau.notes.tab?.after).toBe(" onwards: earlier URIToken sales are not in the index yet.");
  });

  it("says that a collection with no sale has none, with the rows empty", () => {
    const page = nftCollectionPage(pageInput({ list: fulfilled(nftSalesPageSample({ sales: [], count: 0, marker: undefined })) }));
    expect(page.rows).toEqual([]);
    expect(page.empty).toBe("No sale of this collection is in the index.");
    expect(page.paging).toEqual({ newerHref: null, olderHref: null });
  });

  it("pages by the marker, keeping the tab and the trail", () => {
    const page = nftCollectionPage(
      pageInput({
        query: { ...QUERY, tab: "holders", marker: MARKERS.M2, back: [MARKERS.M1] },
        list: fulfilled(nftHoldersPageSample({ marker: NFT_MARKER })),
      }),
    );
    expect(page.paging).toEqual({
      newerHref: `/xrpl/nfts/${NFT_ISSUER}/10?tab=holders&marker=${MARKERS.M1}`,
      olderHref: `/xrpl/nfts/${NFT_ISSUER}/10?tab=holders&marker=${NFT_MARKER}&back=${MARKERS.M2}.${MARKERS.M1}`,
    });
    // the first page again, from the page after it: no marker
    const second = nftCollectionPage(pageInput({ query: { ...QUERY, tab: "holders", marker: MARKERS.M1, back: [] }, list: fulfilled(nftHoldersPageSample({ marker: undefined })) }));
    expect(second.paging).toEqual({ newerHref: `/xrpl/nfts/${NFT_ISSUER}/10?tab=holders`, olderHref: null });
  });

  it("keeps the owner and the burned filter in the paging of the NFTs tab", () => {
    const page = nftCollectionPage(pageInput({ query: { ...QUERY, tab: "nfts", owner: NFT_OWNER, burned: true }, list: fulfilled(nftsPageSample({ marker: NFT_MARKER })) }));
    expect(page.paging.olderHref).toBe(`/xrpl/nfts/${NFT_ISSUER}/10?tab=nfts&owner=${NFT_OWNER}&burned=1&marker=${NFT_MARKER}`);
  });
});

describe("the NFTs tab", () => {
  const nfts = [
    // held: bought for 10 XRP, burnable no, transferable, a 5% fee; minted in the index
    nftSample({
      minted: { ledger_index: 26689211, tx_hash: HASH_A, executed_time: "2026-03-14T09:00:00Z", by: NFT_ISSUER, to: NFT_OWNER },
    }),
    // burned: no owner, no price from the index; every flag, a fee of 2.5%
    nftSample({
      nft_id: OTHER_NFT_ID,
      serial: 5,
      flags: 0x1 | 0x2 | 0x8 | 0x10,
      transfer_fee: 2500,
      owner: undefined,
      burned: true,
      sale_count: 2,
      last_sale: { amount: "40", currency: "USD", amount_issuer: NFT_OWNER, ledger_index: 107874617, tx_hash: HASH_B, executed_time: "2026-10-24T16:08:12Z" },
    }),
    // no owner in the index and not burned; never sold; no flag, no fee
    nftSample({ nft_id: "AA".repeat(32), serial: 123, flags: 0, transfer_fee: 0, owner: undefined, sale_count: 0, last_sale: undefined }),
  ];
  const nftsQuery: CollectionQuery = { ...QUERY, tab: "nfts" };
  const nftsPage = (over: Partial<NftCollectionPageInput> = {}) => nftCollectionPage(pageInput({ query: nftsQuery, list: fulfilled(nftsPageSample({ nfts, coverage: WHOLE })), ...over }));

  it("nfts tab: serial, owner or burned, sales, last sale, flags with the fee, minted day; the form and its error", () => {
    const page = nftsPage();
    expect(page.tab).toBe("nfts");
    expect(rowsOf<CollectionNftRow>(page.rows)).toEqual([
      {
        key: NFT_ID,
        nft: { id: NFT_ID, serial: 95234705, glyph: "05" },
        owner: NFT_OWNER,
        burned: false,
        sales: "1",
        lastSale: { value: "10", currency: "XRP" },
        flags: ["transferable", "5% fee"],
        minted: "Mar 14, 2026",
      },
      {
        key: OTHER_NFT_ID,
        nft: { id: OTHER_NFT_ID, serial: 5, glyph: "05" },
        owner: null,
        burned: true,
        sales: "2",
        lastSale: { value: "40", currency: "USD", issuer: NFT_OWNER },
        flags: ["burnable", "only XRP", "transferable", "mutable", "2.5% fee"],
        minted: "—",
      },
      {
        key: "AA".repeat(32),
        nft: { id: "AA".repeat(32), serial: 123, glyph: "23" },
        owner: null,
        burned: false,
        sales: "0",
        lastSale: null,
        flags: [],
        minted: "—",
      },
    ]);
    expect(page.form).toEqual({ owner: "", burned: false, hidden: [["tab", "nfts"]] });
    expect(page.empty).toBeNull();
    expect(page.notes.tab).toBeNull();
  });

  it("draws no ≈ under a last sale: the list has no converted amount", () => {
    const [row] = rowsOf<CollectionNftRow>(nftsPage().rows);
    expect(row!.lastSale).toEqual({ value: "10", currency: "XRP" });
    expect(Object.keys(row!.lastSale!)).not.toContain("converted");
    expect(JSON.stringify(row)).not.toContain("≈");
  });

  it("writes a fee as a percent of 1/100000, exactly, and none for a fee of 0", () => {
    const fees = [0, 1, 500, 5000, 25000, 50000].map((fee) => nftSample({ nft_id: `0${fee}`, transfer_fee: fee, flags: 0 }));
    const page = nftsPage({ list: fulfilled(nftsPageSample({ nfts: fees })) });
    expect(rowsOf<CollectionNftRow>(page.rows).map((row) => row.flags)).toEqual([[], ["0.001% fee"], ["0.5% fee"], ["5% fee"], ["25% fee"], ["50% fee"]]);
  });

  it("keeps the form's filter and the owner's error, and asks no list for a bad owner", () => {
    const filtered = nftsPage({ query: { ...nftsQuery, owner: NFT_OWNER, burned: true } });
    expect(filtered.form).toEqual({ owner: NFT_OWNER, burned: true, hidden: [["tab", "nfts"]] });
    // the chart's measure is part of the view the form keeps
    expect(nftsPage({ query: { ...nftsQuery, measure: "avg" } }).form!.hidden).toEqual([
      ["measure", "avg"],
      ["tab", "nfts"],
    ]);
    const bad = nftsPage({ query: { ...nftsQuery, owner: "nope" }, ownerError: "Write a classic address (r…).", list: null });
    expect(bad.form).toEqual({ owner: "nope", burned: false, hidden: [["tab", "nfts"]], error: "Write a classic address (r…)." });
    expect(bad.rows).toBeNull();
    expect(bad.empty).toBeNull();
    expect(bad.failures).toEqual({});
    expect(bad.notes.tab).toBeNull();
    expect(bad.paging).toEqual({ newerHref: null, olderHref: null });
  });

  it("says that no NFT is held by the owner when the filtered list is empty", () => {
    const page = nftsPage({ query: { ...nftsQuery, owner: NFT_OWNER }, list: fulfilled(nftsPageSample({ nfts: [], count: 0, marker: undefined })) });
    expect(page.rows).toEqual([]);
    expect(page.empty).toBe(`No NFT of this collection is held by ${NFT_OWNER}.`);
    const xahau = nftCollectionPage(
      pageInput({ net: XAHAU, key: URI_KEY, query: { ...nftsQuery, owner: URI_TOKEN_OWNER }, list: fulfilled(nftsPageSample({ nfts: [], count: 0, marker: undefined })) }),
    );
    expect(xahau.empty).toBe(`No URIToken of this collection is held by ${URI_TOKEN_OWNER}.`);
  });

  it("says that an unfiltered list with no NFT has none", () => {
    const page = nftsPage({ list: fulfilled(nftsPageSample({ nfts: [], count: 0, marker: undefined })) });
    expect(page.empty).toBe("No NFT of this collection is in the index.");
  });

  it("says the NFTs' coverage in the network's words", () => {
    expect(nftsPage({ list: fulfilled(nftsPageSample({ nfts, coverage: coverageSample() })) }).notes.tab?.after).toBe(" onwards: earlier NFTs are not in the index yet.");
  });
});

describe("the holders tab", () => {
  it("holders tab: held and share of supply, <0.1% for a tiny share", () => {
    const holders = [holderSample({ owner: NFT_OWNER, held: 4000 }), holderSample({ owner: URI_TOKEN_OWNER, held: 25 }), holderSample({ owner: NFT_SELLER, held: 1 })];
    const page = nftCollectionPage(
      pageInput({
        query: { ...QUERY, tab: "holders" },
        collection: answerOf(collectionSample({ supply: 10000, holders: 3 })),
        list: fulfilled(nftHoldersPageSample({ holders, coverage: coverageSample() })),
      }),
    );
    expect(page.tab).toBe("holders");
    expect(rowsOf<HolderRow>(page.rows)).toEqual([
      { key: NFT_OWNER, owner: NFT_OWNER, held: "4,000", share: "40.0%" },
      // 0.25% is 0.3% half up
      { key: URI_TOKEN_OWNER, owner: URI_TOKEN_OWNER, held: "25", share: "0.3%" },
      // 0.01% is more than nothing and rounds to 0.0
      { key: NFT_SELLER, owner: NFT_SELLER, held: "1", share: "<0.1%" },
    ]);
    expect(page.form).toBeNull();
    expect(page.notes.tab?.after).toBe(" onwards: earlier holders are not in the index yet.");
  });

  it("says — for the share of a collection with no supply, and 100.0% for all of it", () => {
    const share = (supply: number, held: number) =>
      rowsOf<HolderRow>(
        nftCollectionPage(pageInput({ query: { ...QUERY, tab: "holders" }, collection: answerOf(collectionSample({ supply })), list: fulfilled(nftHoldersPageSample({ holders: [holderSample({ held })] })) })).rows,
      )[0]!.share;
    expect(share(0, 1)).toBe("—");
    expect(share(3, 3)).toBe("100.0%");
    expect(share(3, 1)).toBe("33.3%");
  });

  it("says that a collection with no holder has none", () => {
    const page = nftCollectionPage(pageInput({ query: { ...QUERY, tab: "holders" }, list: fulfilled(nftHoldersPageSample({ holders: [], count: 0 })) }));
    expect(page.rows).toEqual([]);
    expect(page.empty).toBe("No collection holder is in the index.");
  });
});

// ---- Xahau ------------------------------------------------------------------------------------------------------------------------------

describe("Xahau", () => {
  const xahau = (over: Partial<NftCollectionPageInput> = {}) =>
    nftCollectionPage(pageInput({ net: XAHAU, key: URI_KEY, collection: answerOf(uriTokenCollectionSample()), list: fulfilled(nftSalesPageSample({ sales: [], count: 0, coverage: WHOLE })), ...over }));

  it("Xahau: URIToken words, no taxon, burnable as the one flag", () => {
    const page = xahau();
    expect(page.breadcrumb).toEqual([{ label: "Xahau", href: "/xahau" }, { label: "URITokens", href: "/xahau/nfts" }, { label: URI_LABEL }]);
    expect(page.header).toMatchObject({ glyph: "od", heading: `URITokens of ${URI_LABEL}`, tag: "URIToken collection", issuer: URI_TOKEN_ISSUER });
    expect(page.header).not.toHaveProperty("taxon");
    expect(page.title).toBe(`URITokens of ${URI_LABEL}`);
    expect(page.stats.supply).toEqual({ figure: "5", note: "1 minted · 0 burned" });
    expect(page.stats.volume).toEqual({ figure: "4,200 XAH", note: "all time, at daily rates" });
    expect(page.tabs.map((tab) => [tab.id, tab.label, tab.href])).toEqual([
      ["sales", "Sales", `/xahau/nfts/${URI_TOKEN_ISSUER}`],
      ["nfts", "URITokens", `/xahau/nfts/${URI_TOKEN_ISSUER}?tab=nfts`],
      ["holders", "Holders", `/xahau/nfts/${URI_TOKEN_ISSUER}?tab=holders`],
    ]);
    expect(page.chart!.title).toBe("Sales volume per day, in XAH, last 30 days");

    const burnable = uriTokenSample({ flags: 1 });
    const other = uriTokenSample({ nft_id: "BB".repeat(32), flags: 0 });
    const tab = xahau({ query: { ...QUERY, tab: "nfts" }, list: fulfilled(nftsPageSample({ nfts: [burnable, other], coverage: WHOLE })) });
    const [first, second] = rowsOf<CollectionNftRow>(tab.rows);
    expect(first).toEqual({
      key: burnable.nft_id,
      nft: { id: burnable.nft_id, glyph: "96" },
      owner: URI_TOKEN_OWNER,
      burned: false,
      sales: "1",
      lastSale: { value: "4200", currency: "XAH" },
      flags: ["burnable"],
      minted: "—",
    });
    expect(first!.nft).not.toHaveProperty("serial");
    expect(second!.flags).toEqual([]);
    expect(tab.form).toEqual({ owner: "", burned: false, hidden: [["tab", "nfts"]] });
  });

  it("gives a URIToken no fee tag, whatever the number says", () => {
    const tab = xahau({ query: { ...QUERY, tab: "nfts" }, list: fulfilled(nftsPageSample({ nfts: [uriTokenSample({ flags: 1, transfer_fee: 5000 })] })) });
    expect(rowsOf<CollectionNftRow>(tab.rows)[0]!.flags).toEqual(["burnable"]);
  });

  it("writes the royalty of a sale as a dash", () => {
    const page = xahau({ list: fulfilled(nftSalesPageSample({ sales: [nftSaleSample({ royalty_est: "0.5" })], coverage: WHOLE })) });
    expect(rowsOf<{ royalty: string | null }>(page.rows)[0]!.royalty).toBeNull();
  });
});

// ---- A page behind a marker ----------------------------------------------------------------------------------------------------------------------

describe("a page behind a marker", () => {
  it("a marker page keeps the header without its dates and the tab's rows", () => {
    const sales = [nftSaleSample()];
    const collection = collectionSample({
      first_mint: { ledger_index: 26689211, tx_hash: HASH_A, executed_time: "2026-03-14T09:00:00Z" },
      last_mint: { ledger_index: 26771798, tx_hash: HASH_B, executed_time: "2026-10-14T18:42:07Z" },
    });
    const page = collectionMarkerPage(markerInput({ collection: answerOf(collection), list: fulfilled(nftSalesPageSample({ sales, marker: NFT_MARKER, coverage: coverageSample() })) }));
    expect(page.marker).toBe(true);
    expect(page.breadcrumb).toEqual([{ label: "XRPL", href: "/xrpl" }, { label: "NFTs", href: "/xrpl/nfts" }, { label: LABEL }]);
    expect(page.header).toEqual({ glyph: "4P", heading: `Collection ${LABEL}`, tag: "NFToken collection", issuer: NFT_ISSUER, taxon: 10 });
    expect(page.title).toBe(`Older sales of ${LABEL}`);
    expect(page.back).toEqual({ label: "Back to the collection", href: `/xrpl/nfts/${NFT_ISSUER}/10` });
    expect(page.rows).toEqual(saleRows(XRPL, sales));
    expect(page.tab).toBe("sales");
    expect(page.paging).toEqual({
      newerHref: `/xrpl/nfts/${NFT_ISSUER}/10?marker=${MARKERS.M1}`,
      olderHref: `/xrpl/nfts/${NFT_ISSUER}/10?marker=${NFT_MARKER}&back=${MARKERS.M2}.${MARKERS.M1}`,
    });
    expect(page.notes).toEqual({ stats: null, chart: null, tab: { before: "Covers ledger ", ledger: 107874617, after: " onwards: earlier NFT sales are not in the index yet." } });
    // no stats, chart, measures, tabs or form: the page is the list
    expect(page.chart).toBeNull();
    expect(page.measures).toEqual([]);
    expect(page.tabs).toEqual([]);
    expect(page.form).toBeNull();
    expect(Object.values(page.stats).every((stat) => stat.figure === null && stat.note === "")).toBe(true);
    expect(page.failures).toEqual({});
  });

  it("goes back to the collection's tab, with its filter, and is titled by the tab", () => {
    const nfts = collectionMarkerPage(
      markerInput({ query: { ...QUERY, tab: "nfts", owner: NFT_OWNER, burned: true, marker: MARKERS.M2, back: [] }, list: fulfilled(nftsPageSample({ coverage: WHOLE })) }),
    );
    expect(nfts.back!.href).toBe(`/xrpl/nfts/${NFT_ISSUER}/10?tab=nfts&owner=${NFT_OWNER}&burned=1`);
    expect(nfts.title).toBe(`Older NFTs of ${LABEL}`);
    expect(nfts.paging.olderHref).toBe(`/xrpl/nfts/${NFT_ISSUER}/10?tab=nfts&owner=${NFT_OWNER}&burned=1&marker=${NFT_MARKER}&back=${MARKERS.M2}`);
    expect(rowsOf<CollectionNftRow>(nfts.rows)[0]).toMatchObject({ key: NFT_ID, flags: ["transferable", "5% fee"] });
    const holders = collectionMarkerPage(markerInput({ query: { ...QUERY, tab: "holders", marker: MARKERS.M2, back: [] }, list: fulfilled(nftHoldersPageSample({ coverage: WHOLE })) }));
    expect(holders.back!.href).toBe(`/xrpl/nfts/${NFT_ISSUER}/10?tab=holders`);
    expect(holders.title).toBe(`Older holders of ${LABEL}`);
    expect(rowsOf<HolderRow>(holders.rows)[0]).toEqual({ key: NFT_OWNER, owner: NFT_OWNER, held: "1", share: "100.0%" });
  });

  it("says Xahau's words behind a marker", () => {
    const page = collectionMarkerPage(
      markerInput({ net: XAHAU, key: URI_KEY, collection: answerOf(uriTokenCollectionSample()), query: { ...QUERY, tab: "nfts", marker: MARKERS.M2, back: [] }, list: fulfilled(nftsPageSample({ nfts: [uriTokenSample()] })) }),
    );
    expect(page.title).toBe(`Older URITokens of ${URI_LABEL}`);
    expect(page.header.heading).toBe(`URITokens of ${URI_LABEL}`);
    expect(page.header).not.toHaveProperty("taxon");
    expect(page.back).toEqual({ label: "Back to the collection", href: `/xahau/nfts/${URI_TOKEN_ISSUER}?tab=nfts` });
  });

  it("tells a list that failed in its place", () => {
    const page = collectionMarkerPage(markerInput({ list: rejected(new TooLate()) }));
    expect(page.rows).toBeNull();
    expect(page.failures).toEqual({ tab: "the sales" });
    expect(page.notes.tab).toBeNull();
  });
});

// ---- The failures -------------------------------------------------------------------------------------------------------------------------

describe("the failures", () => {
  it("fails the chart and the 30-day figures together when the daily figures could not be loaded, and leaves the rest", () => {
    for (const stats of [rejected(new TooLate()), rejected(new UpstreamError("server", "unexpected")), null]) {
      const page = nftCollectionPage(pageInput({ stats }));
      expect(page.failures).toEqual({ daily: "the daily figures" });
      expect(page.chart).toBeNull();
      expect(page.notes.chart).toBeNull();
      expect(page.stats.average30).toEqual({ figure: null, note: "" });
      expect(page.stats.lowest30).toEqual({ figure: null, note: "a sale, not an open offer" });
      // what the collection says is still there
      expect(page.stats.supply.figure).toBe("1");
      expect(page.stats.sales.figure).toBe("1");
      expect(page.rows).toHaveLength(1);
      // the measures and the tabs are links: they stay
      expect(page.measures).toHaveLength(4);
      expect(page.tabs).toHaveLength(3);
    }
  });

  it("fails them when the newest ledger could not be had, or has no time to take the window from", () => {
    for (const last of [rejected(new TooLate()), fulfilled({ ...LAST, close_time: "never" }), fulfilled({ ...LAST, ledger_index: "soon" })]) {
      const page = nftCollectionPage(pageInput({ last, stats: fulfilled(daysOf([day("2026-10-14")])) }));
      expect(page.failures).toEqual({ daily: "the daily figures" });
      expect(page.chart).toBeNull();
      expect(page.stats.average30.figure).toBeNull();
    }
  });

  it("tells each tab's list in its words, with the rows left out and the rest of the page standing", () => {
    const failed = (tab: "sales" | "nfts" | "holders", net: CollectionNet = XRPL, key: CollectionKey = KEY) =>
      nftCollectionPage(pageInput({ net, key, query: { ...QUERY, tab }, list: rejected(new TooLate()) }));
    expect(failed("sales").failures).toEqual({ tab: "the sales" });
    expect(failed("nfts").failures).toEqual({ tab: "the NFTs" });
    expect(failed("nfts", XAHAU, URI_KEY).failures).toEqual({ tab: "the URITokens" });
    expect(failed("holders").failures).toEqual({ tab: "the holders" });
    const page = failed("sales");
    expect(page.rows).toBeNull();
    expect(page.empty).toBeNull();
    expect(page.notes.tab).toBeNull();
    expect(page.paging).toEqual({ newerHref: null, olderHref: null });
    expect(page.tabs).toHaveLength(3);
    expect(page.stats.supply.figure).toBe("1");
  });

  it("fails the tab's card, and does not throw, when the list is another tab's page", () => {
    const sales = nftSalesPageSample({ coverage: WHOLE });
    const nfts = nftsPageSample({ coverage: WHOLE });
    const holders = nftHoldersPageSample({ coverage: WHOLE });
    const wrong = (tab: "sales" | "nfts" | "holders", list: NftSalesPage | NftsPage | NftHoldersPage) => nftCollectionPage(pageInput({ query: { ...QUERY, tab }, list: fulfilled(list) }));
    for (const [tab, list, what] of [
      ["sales", nfts, "the sales"],
      ["sales", holders, "the sales"],
      ["nfts", sales, "the NFTs"],
      ["nfts", holders, "the NFTs"],
      ["holders", sales, "the holders"],
      ["holders", nfts, "the holders"],
    ] as const) {
      const page = wrong(tab, list);
      expect(page.failures, `${tab}`).toEqual({ tab: what });
      expect(page.rows).toBeNull();
      expect(page.empty).toBeNull();
      expect(page.notes.tab).toBeNull();
      expect(page.paging).toEqual({ newerHref: null, olderHref: null });
      // the rest of the page stands
      expect(page.stats.supply.figure).toBe("1");
    }
    const marker = collectionMarkerPage(markerInput({ list: fulfilled(nfts) }));
    expect(marker.rows).toBeNull();
    expect(marker.failures).toEqual({ tab: "the sales" });
  });

  it("tells both when both failed", () => {
    const page = nftCollectionPage(pageInput({ stats: null, list: rejected(new TooLate()) }));
    expect(page.failures).toEqual({ daily: "the daily figures", tab: "the sales" });
  });

  it("keeps the form of the NFTs tab when its list failed", () => {
    const page = nftCollectionPage(pageInput({ query: { ...QUERY, tab: "nfts", owner: NFT_OWNER }, list: rejected(new TooLate()) }));
    expect(page.form).toEqual({ owner: NFT_OWNER, burned: false, hidden: [["tab", "nfts"]] });
  });
});

// ---- Not found -----------------------------------------------------------------------------------------------------------------------------------

describe("collectionNotFound", () => {
  it("collectionNotFound names the collection and the network", () => {
    expect(collectionNotFound(XRPL, KEY)).toBe("We couldn't find NFT collection r4PP7g…CzT3 · taxon 10 on XRPL");
    expect(collectionNotFound(XRPL_TESTNET, { issuer: NFT_ISSUER, taxon: 0 })).toBe("We couldn't find NFT collection r4PP7g…CzT3 · taxon 0 on XRPL Testnet");
    expect(collectionNotFound(XAHAU, URI_KEY)).toBe("We couldn't find URIToken collection rodinG…zKyb on Xahau");
  });
});

// ---- The builders over the fixtures' answers ---------------------------------------------------------------------------------------------------

describe("over the recorded fixtures", () => {
  const dir = new URL("../../test/fixtures/http/", import.meta.url);
  const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, dir), "utf8")) as T;
  const FEATURED = {
    xrpl: { net: XRPL, key: { issuer: "rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy", taxon: 0 } as CollectionKey, path: "xrpl/data-api/nft_collections/rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy/0" },
    xahau: { net: XAHAU, key: { issuer: "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb" } as CollectionKey, path: "xahau/data-api/nft_collections/rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb" },
  } as const;
  const answers = (id: "xrpl" | "xahau") => {
    const { path } = FEATURED[id];
    const first = json<NftSalesPage>(`${path}/sales@descending=true&limit=20.json`);
    return {
      last: json<LastValidated>(`${id}/data-api/last_validated.json`),
      collection: json<NftCollectionAnswer>(`${path}.json`),
      stats: json<NftCollectionDays>(`${path}/stats@end=2026-10-17&start=2026-09-18.json`),
      sales: first,
      older: json<NftSalesPage>(`${path}/sales@descending=true&limit=20&marker=${first.marker}.json`),
      nfts: json<NftsPage>(`${path}/nfts@limit=20.json`),
      burned: json<NftsPage>(`${path}/nfts@include_burned=true&limit=20.json`),
      holders: json<NftHoldersPage>(`${path}/holders@limit=20.json`),
    };
  };

  it.each(["xrpl", "xahau"] as const)("%s: builds the featured collection's page from the files, the 30-day figures as an independent computation has them", (id) => {
    const { net, key } = FEATURED[id];
    const a = answers(id);
    const page = nftCollectionPage({ net, key, query: QUERY, collection: a.collection, last: fulfilled(a.last), stats: fulfilled(a.stats), list: fulfilled(a.sales) });
    expect(page.failures).toEqual({});
    expect(page.header.issuer).toBe(key.issuer);
    expect(page.stats.sales.figure).toBe(formatAmount(String(a.collection.collection.sales_count)));
    expect(page.stats.volume.figure).toBe(`${compactNumber(a.collection.collection.volume_native)} ${net.native}`);

    // Every sale of the collection is in the days (they add up to its totals), and the days' average rule must give what the sales say: the volume of the sales that have a price
    // over how many they are, in whole units, half up. Worked out here from the sales alone, in hundredths of a coin (every price of the files has two decimals at most).
    const sales = [...a.sales.sales, ...a.older.sales];
    expect(sales).toHaveLength(a.collection.collection.sales_count);
    const hundredths = sales.filter((sale) => sale.converted_amount !== undefined).map((sale) => Math.round(Number(sale.converted_amount) * 100));
    expect(hundredths.length).toBeGreaterThan(0);
    expect(hundredths.length).toBeLessThan(sales.length);
    const volume = hundredths.reduce((sum, price) => sum + price, 0);
    const average = Math.floor((volume + 50 * hundredths.length) / (100 * hundredths.length));
    expect(page.stats.average30).toEqual({ figure: `${formatAmount(String(average))} ${net.native}`, note: `${hundredths.length} sales` });
    const lowest = Math.min(...hundredths) / 100;
    expect(page.stats.lowest30.figure).toBe(`${formatAmount(String(lowest))} ${net.native}`);

    // The chart: 30 days; what its series and extras say adds up to the collection's own figures.
    const series = (measure: NftMeasure) => collectionDaySeries(a.stats.days, W, measure, net.native);
    expect(series("sales").series[0]!.values).toHaveLength(30);
    expect(series("sales").series[0]!.values.reduce((sum, value) => sum + Number(value), 0)).toBe(a.collection.collection.sales_count);
    expect(series("volume").series[0]!.values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0)).toBe(volume);
    expect(series("avg").series[0]!.values.filter((value) => value !== null)).toHaveLength(a.stats.days.filter((d) => d.avg_price_native !== undefined).length);
    expect(series("volume").extras!.find((extra) => extra.id === "mints")!.values.reduce((sum, value) => sum + Number(value), 0)).toBe(a.collection.collection.minted);

    // The rows are the file's, in its order, and Xahau's coverage is the only one that is not whole.
    expect(rowsOf<{ nft: { id: string } }>(page.rows).map((row) => row.nft.id)).toEqual(a.sales.sales.map((sale) => sale.nft_id));
    expect(page.paging.olderHref).toBe(collectionHref(id, key, { marker: a.sales.marker }));
    expect([page.notes.chart, page.notes.tab].filter((note) => note !== null)).toHaveLength(id === "xrpl" ? 0 : 2);
  });

  it.each(["xrpl", "xahau"] as const)("%s: builds the NFTs and the holders of the featured collection", (id) => {
    const { net, key } = FEATURED[id];
    const a = answers(id);
    const base = { net, key, collection: a.collection, last: fulfilled(a.last), stats: fulfilled(a.stats) };
    const nfts = nftCollectionPage({ ...base, query: { ...QUERY, tab: "nfts" }, list: fulfilled(a.nfts) });
    const rows = rowsOf<CollectionNftRow>(nfts.rows);
    expect(rows.map((row) => row.key)).toEqual(a.nfts.nfts.map((nft) => nft.nft_id));
    expect(rows.every((row) => !row.burned)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("≈");
    const withBurned = rowsOf<CollectionNftRow>(nftCollectionPage({ ...base, query: { ...QUERY, tab: "nfts", burned: true }, list: fulfilled(a.burned) }).rows);
    expect(withBurned.filter((row) => row.burned)).toHaveLength(a.collection.collection.burned);
    expect(withBurned.filter((row) => row.burned).every((row) => row.owner === null)).toBe(true);

    const holders = rowsOf<HolderRow>(nftCollectionPage({ ...base, query: { ...QUERY, tab: "holders" }, list: fulfilled(a.holders) }).rows);
    expect(holders.map((row) => row.owner)).toEqual(a.holders.holders.map((holder) => holder.owner));
    expect(holders).toHaveLength(a.collection.collection.holders);
    // the holders hold what the index knows an owner of: no more than the supply
    const held = a.holders.holders.reduce((sum, holder) => sum + holder.held, 0);
    expect(held).toBeLessThanOrEqual(a.collection.collection.supply);
    expect(holders.every((row) => /^\d+\.\d%$|^<0\.1%$/.test(row.share))).toBe(true);
  });
});
