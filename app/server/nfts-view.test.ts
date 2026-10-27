import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { tokenOf } from "../domain/fnv";
import { compactNumber, formatAmount, shortAddress } from "../domain/format";
import { nftsHref, nftSalesHref, type NftsQuery } from "../domain/nft-params";
import { addDays, windowOf } from "../domain/window";
import { valueText } from "../ui/charts/labels";
import {
  coverageSample,
  NFT_BROKER,
  NFT_ID,
  NFT_ISSUER,
  NFT_MARKER,
  NFT_OWNER,
  NFT_SELLER,
  nftCollectionsPageSample,
  nftSaleSample,
  nftSalesPageSample,
  nftVolumeRowSample,
  nftVolumeSample,
  OTHER_ISSUER,
  OTHER_NFT_ID,
  collectionSample,
  uriTokenCollectionSample,
  URI_TOKEN_ID,
  URI_TOKEN_ISSUER,
} from "../../test/support/nft-samples";
import type { LastValidated, NftCollectionsPage, NftSalesPage, NftVolume, NftVolumeComponent, NftVolumeRow } from "./api-types";
import { TooLate } from "./deadline";
import { nftsListPage, nftsMarkerPage, nftSalesPage, saleRows, type NftsListInput, type NftsNet } from "./nfts-view";
import { UpstreamError } from "./upstream";

// ---- The world of the tests: T is Oct 17, the live set ends at 17:01 UTC ------------------------------------------------------------------------

const XRPL: NftsNet = { id: "xrpl", native: "XRP", longName: "the XRP Ledger" };
const XRPL_TESTNET: NftsNet = { id: "xrpl", native: "XRP", longName: "XRPL Testnet" };
const XAHAU: NftsNet = { id: "xahau", native: "XAH", longName: "Xahau" };
const XAHAU_TESTNET: NftsNet = { id: "xahau", native: "XAH", longName: "Xahau Testnet" };

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

const QUERY: NftsQuery = { period: "day", sort: "volume", order: "desc", back: [] };
const ISSUER_FILTER = "rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy";

const SALES_WORDS = { xrpl: "NFT sales", xahau: "URIToken sales" } as const;
const MARKERS = { M1: "WzEwNzg4NjE2Myw4MywxXQ", M2: "WzEwNzg4MTUzMCwxNjIsMV0", M3: "WzEwNzg3ODc3NSwxMDQsMV0" };

/** A component of a live or daily row: the sale count and the amount in the native currency. */
const component = (issuer: string, taxon: number | undefined, count: number, amount: string): NftVolumeComponent => ({
  issuer,
  ...(taxon === undefined ? {} : { taxon }),
  count,
  amount,
  rate: "1.0000000",
  converted_amount: amount,
});

/** A row of the daily volume: no components (the chart reads `total` and `count`). */
const dayRow = (day: string, total: string, count: number): NftVolumeRow => ({
  components: [],
  count,
  exchange: { currency: "XRP" },
  total,
  exchange_rate: "1.0000000",
  start_time: `${day}T00:00:00Z`,
  end_time: `${addDays(day, 1)}T00:00:00Z`,
});

const liveOf = (row?: NftVolumeRow, coverage = coverageSample({ complete: true })): NftVolume => ({ coverage, count: row === undefined ? 0 : 1, rows: row === undefined ? [] : [row] });
/** The 30 days up to Oct 16: every day of W but the running one, each with a row. */
const fullDays = (): NftVolumeRow[] => W.buckets.slice(0, -1).map((day, index) => dayRow(day, `${100 + index}.25`, index + 1));
/** An answer of the daily volume with these rows: its `count` is theirs. */
const dailyOf = (rows: NftVolumeRow[], coverage = coverageSample({ complete: true })): NftVolume => ({ coverage, count: rows.length, rows });

/** The list page as the loader reads it: every call answered, the sample answers, complete coverage. */
function listInput(over: Partial<NftsListInput> = {}): NftsListInput {
  const whole = coverageSample({ complete: true });
  return {
    net: XRPL,
    query: QUERY,
    last: fulfilled(LAST),
    live: fulfilled(nftVolumeSample({ coverage: whole })),
    daily: fulfilled(dailyOf(fullDays(), whole)),
    sales: fulfilled(nftSalesPageSample({ coverage: whole })),
    collections: fulfilled(nftCollectionsPageSample({ coverage: whole })),
    ...over,
  };
}

const withNotes = (page: { notes: Record<string, unknown> }) => Object.values(page.notes).filter((note) => note !== null).length;

// ---- The tiles ----------------------------------------------------------------------------------------------------------------------------------

describe("the tiles", () => {
  it("fills the four tiles from the live row and the collections' total", () => {
    // 1,290 sales of the window, 1,200 of them rated: the average is the volume over the rated ones, to whole units (413,000 ÷ 1,200 = 344.17).
    const row = nftVolumeRowSample({
      components: [component(NFT_ISSUER, 10, 700, "250000.5"), component(OTHER_ISSUER, 0, 500, "162999.5")],
      count: 1290,
      total: "413000",
    });
    const page = nftsListPage(listInput({ live: fulfilled(nftVolumeSample({ rows: [row] })), collections: fulfilled(nftCollectionsPageSample({ total: 38511 })) }));
    expect(page.tiles).toEqual({
      volume: { figure: "413K XRP", note: "sales in XRP and in tokens with a daily XRP rate" },
      sales: { figure: "1,290", note: "direct and brokered" },
      traded: { figure: "2", note: "of 38,511 collections" },
      average: { figure: "344 XRP", note: "volume ÷ sales" },
    });
    expect(page.failures).toEqual({});
  });

  it("says Xahau's words: XAH, URITokenBuy, collections", () => {
    const row = nftVolumeRowSample({ components: [component(URI_TOKEN_ISSUER, undefined, 61, "8400")], count: 61, total: "8400" });
    const page = nftsListPage(listInput({ net: XAHAU, live: fulfilled(nftVolumeSample({ rows: [row] })), collections: fulfilled(nftCollectionsPageSample({ total: 1962 })) }));
    expect(page.tiles).toEqual({
      volume: { figure: "8,400 XAH", note: "sales in XAH and in tokens with a daily XAH rate" },
      sales: { figure: "61", note: "URITokenBuy" },
      traded: { figure: "1", note: "of 1,962 collections" },
      average: { figure: "138 XAH", note: "volume ÷ sales" },
    });
  });

  it("rounds the average half up, to whole units", () => {
    const average = (total: string, count: number) =>
      nftsListPage(listInput({ live: fulfilled(nftVolumeSample({ rows: [nftVolumeRowSample({ components: [component(NFT_ISSUER, 1, count, total)], count, total })] })) })).tiles.average.figure;
    expect(average("5", 2)).toBe("3 XRP");
    expect(average("4.999999", 2)).toBe("2 XRP");
    expect(average("1250000.5", 1)).toBe("1,250,001 XRP");
    expect(average("0.000001", 1)).toBe("0 XRP");
  });

  it("says — for the average without a rated sale, and leaves out the of-N note when the collections failed", () => {
    // Three sales, none of them in a currency that has a rate: no component, a count of the row.
    const unrated = nftVolumeSample({ rows: [nftVolumeRowSample({ components: [], count: 3, total: "0" })] });
    const page = nftsListPage(listInput({ live: fulfilled(unrated) }));
    expect(page.tiles.average).toEqual({ figure: "—", note: "volume ÷ sales" });
    expect(page.tiles.sales.figure).toBe("3");
    expect(page.tiles.volume.figure).toBe("0 XRP");
    expect(page.tiles.traded).toEqual({ figure: "0", note: "of 25 collections" });

    const failed = nftsListPage(listInput({ collections: rejected(new UpstreamError("server", "data API GET /v2/nft_collections answered 503", { status: 503 })) }));
    expect(failed.tiles.traded).toEqual({ figure: "3", note: "" });
    expect(failed.failures).toEqual({ collections: "the collections" });
  });

  it("says one collection in the singular", () => {
    expect(nftsListPage(listInput({ collections: fulfilled(nftCollectionsPageSample({ total: 1 })) })).tiles.traded.note).toBe("of 1 collection");
    expect(nftsListPage(listInput({ net: XAHAU, collections: fulfilled(nftCollectionsPageSample({ total: 1 })) })).tiles.traded.note).toBe("of 1 collection");
    expect(nftsListPage(listInput({ collections: fulfilled(nftCollectionsPageSample({ total: 0 })) })).tiles.traded.note).toBe("of 0 collections");
  });

  it("leaves out the of-N note under an issuer filter or an issuer that is no address, where the total is not the network's", () => {
    // D3's `total` counts what the filter matches (ruling C17).
    const filtered = nftsListPage(listInput({ query: { ...QUERY, issuer: ISSUER_FILTER }, collections: fulfilled(nftCollectionsPageSample({ total: 3 })) }));
    expect(filtered.tiles.traded).toEqual({ figure: "3", note: "" });
    const bad = nftsListPage(listInput({ query: { ...QUERY, issuer: "rNotAnAddress" }, issuerError: "Write a classic address (r…).", collections: null }));
    expect(bad.tiles.traded.note).toBe("");
  });

  it("shows the empty state for an answer with no row, not a failure", () => {
    // D3 answers { count: 0, rows: [] } until the live set is written.
    const page = nftsListPage(listInput({ live: fulfilled(liveOf()) }));
    expect(page.tiles).toEqual({
      volume: { figure: "0 XRP", note: "sales in XRP and in tokens with a daily XRP rate" },
      sales: { figure: "0", note: "direct and brokered" },
      traded: { figure: "0", note: "of 25 collections" },
      average: { figure: "—", note: "volume ÷ sales" },
    });
    expect(page.top).toBe("none");
    expect(page.failures).toEqual({});
  });
});

// ---- The chart ----------------------------------------------------------------------------------------------------------------------------------

describe("the chart", () => {
  it("draws 30 days, the running day forming, a not-computed day null with its note, a quiet day 0", () => {
    // Sep 20 had no sale (no row: 0); Oct 17, the running day, has no row yet (not computed: null).
    const rows = fullDays().filter((row) => !row.start_time.startsWith("2026-09-20"));
    const page = nftsListPage(listInput({ daily: fulfilled({ coverage: coverageSample({ complete: true }), count: rows.length, rows }) }));
    const chart = page.chart!;
    expect(chart.data.axis).toEqual({ unit: "day", buckets: W.buckets });
    expect(chart.data.axis.buckets).toHaveLength(30);
    expect(chart.data.axis.buckets[0]).toBe("2026-09-18");
    expect(chart.data.axis.buckets[29]).toBe("2026-10-17");
    expect(chart.data.format).toEqual({ kind: "amount", unit: "XRP" });
    expect(chart.data.forming).toBe(true);
    expect(chart.data.pending).toBe(1);
    expect(chart.pending).toBe("Oct 17 is not computed yet.");

    const [series] = chart.data.series;
    expect(chart.data.series).toHaveLength(1);
    expect(series).toMatchObject({ label: "Sales volume", slot: 1 });
    expect(series!.values[0]).toBe("100.25");
    expect(series!.values[2]).toBe("0");
    expect(series!.values[3]).toBe("103.25");
    expect(series!.values[28]).toBe("128.25");
    expect(series!.values[29]).toBeNull();

    // The extra "Sales": each row's count, the same days quiet and not computed.
    expect(chart.data.extras).toHaveLength(1);
    const [sales] = chart.data.extras!;
    expect(sales).toMatchObject({ id: "sales", label: "Sales", format: { kind: "count" } });
    expect(sales!.values.slice(0, 4)).toEqual(["1", "2", "0", "4"]);
    expect(sales!.values[28]).toBe("29");
    expect(sales!.values[29]).toBeNull();
  });

  it("holds its token over everything it draws", () => {
    const { token, ...rest } = nftsListPage(listInput()).chart!.data;
    expect(token).toBe(tokenOf(rest));
    const other = nftsListPage(listInput({ daily: fulfilled({ coverage: coverageSample({ complete: true }), count: 1, rows: [dayRow("2026-10-16", "1", 1)] }) })).chart!.data;
    expect(other.token).not.toBe(token);
  });

  it("marks only the newest two days not computed: an older gap is a quiet day", () => {
    // No rows for Oct 15, 16 and 17: pendingCount counts two (the API computes a day an hour after it has closed), and Oct 15 is a quiet day.
    const rows = fullDays().filter((row) => row.start_time < "2026-10-15");
    const chart = nftsListPage(listInput({ daily: fulfilled({ coverage: coverageSample({ complete: true }), count: rows.length, rows }) })).chart!;
    expect(chart.data.pending).toBe(2);
    expect(chart.pending).toBe("Oct 16 and Oct 17 are not computed yet.");
    expect(chart.data.series[0]!.values.slice(-3)).toEqual(["0", null, null]);
    expect(chart.data.extras![0]!.values.slice(-3)).toEqual(["0", null, null]);
  });

  it("has no pending day and no note when the running day has its row", () => {
    const rows = [...fullDays(), dayRow("2026-10-17", "9.5", 2)];
    const chart = nftsListPage(listInput({ daily: fulfilled({ coverage: coverageSample({ complete: true }), count: rows.length, rows }) })).chart!;
    expect(chart.data.pending).toBe(0);
    expect(chart.pending).toBeNull();
    expect(chart.data.series[0]!.values[29]).toBe("9.5");
  });

  it("draws every day as 0 for an answer with no row but the two newest not computed", () => {
    const chart = nftsListPage(listInput({ daily: fulfilled({ coverage: coverageSample({ complete: true }), count: 0, rows: [] }) })).chart!;
    expect(chart.data.series[0]!.values.filter((value) => value === "0")).toHaveLength(28);
    expect(chart.data.series[0]!.values.slice(-2)).toEqual([null, null]);
  });

  it("writes the volume in the day's native currency on Xahau", () => {
    const chart = nftsListPage(listInput({ net: XAHAU })).chart!;
    expect(chart.data.format).toEqual({ kind: "amount", unit: "XAH" });
  });
});

// ---- The top collections ------------------------------------------------------------------------------------------------------------------------

describe("the top collections", () => {
  /** Seven components, in no order: the five largest are listed, largest first. */
  const seven = (): NftVolumeComponent[] => [
    component("rDeizxSRo6JHjKnih9ivpPkyD2EgXQvhSB", 26, 3, "6700"),
    component(NFT_OWNER, 4, 8, "25000"),
    component(NFT_ISSUER, 10, 412, "181300"),
    component(NFT_BROKER, 0, 1, "10000"),
    component(OTHER_ISSUER, 0, 55, "90000"),
    component("rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh", 2, 20, "60000"),
    component(NFT_SELLER, 9, 14, "40000"),
  ];

  it("lists the five largest collections with label, href, sublabel and tip", () => {
    const row = nftVolumeRowSample({ components: seven(), count: 513, total: "413000" });
    const { top } = nftsListPage(listInput({ live: fulfilled(nftVolumeSample({ rows: [row] })) }));
    if (top === null || typeof top === "string") throw new Error("a list");
    expect(top.items).toHaveLength(5);
    expect(top.format).toEqual({ kind: "amount", unit: "XRP" });
    expect(top.items.map((item) => item.value)).toEqual(["181300", "90000", "60000", "40000", "25000"]);
    expect(top.items.map((item) => item.share)).toEqual(["43.9%", "21.8%", "14.5%", "9.7%", "6.1%"]);
    expect(top.items[0]).toEqual({
      id: `${NFT_ISSUER}/10`,
      label: "r4PP7g…CzT3 · taxon 10",
      sublabel: "412 sales",
      value: "181300",
      share: "43.9%",
      count: "412",
      href: `/xrpl/nfts/${NFT_ISSUER}/10`,
    });
    // The tip the list draws is the value and the share: "181K XRP · 43.9%".
    expect(`${valueText(top.items[0]!.value, top.format, "compact")} · ${top.items[0]!.share}`).toBe("181K XRP · 43.9%");
    expect(top.items[1]!.label).toBe("rLxc1b…rwMy · taxon 0");
    expect(top.items[1]!.href).toBe(`/xrpl/nfts/${OTHER_ISSUER}/0`);
  });

  it("holds its token over the items and the format", () => {
    const { top } = nftsListPage(listInput());
    if (top === null || typeof top === "string") throw new Error("a list");
    const { token, ...rest } = top;
    expect(token).toBe(tokenOf(rest));
  });

  it("says a sale in the singular, and a share of a thousandth of a percent as under a tenth", () => {
    // The reference's live row: 150 and 10 XRP of 160.000001, and one collection of a millionth of an XRP.
    const { top } = nftsListPage(listInput());
    if (top === null || typeof top === "string") throw new Error("a list");
    expect(top.items.map((item) => item.sublabel)).toEqual(["1 sale", "1 sale", "1 sale"]);
    expect(top.items.map((item) => item.share)).toEqual(["93.7%", "6.2%", "<0.1%"]);
  });

  it("links a Xahau collection by its issuer alone", () => {
    const row = nftVolumeRowSample({ components: [component(URI_TOKEN_ISSUER, undefined, 61, "8400")], count: 61, total: "8400" });
    const { top } = nftsListPage(listInput({ net: XAHAU, live: fulfilled(nftVolumeSample({ rows: [row] })) }));
    if (top === null || typeof top === "string") throw new Error("a list");
    expect(top.format).toEqual({ kind: "amount", unit: "XAH" });
    expect(top.items[0]).toMatchObject({ id: URI_TOKEN_ISSUER, label: "rodinG…zKyb", sublabel: "61 sales", share: "100.0%", href: `/xahau/nfts/${URI_TOKEN_ISSUER}` });
  });

  it("says there were no sales in the last 24 hours", () => {
    // No row at all (D3 has written no set yet), and a row of a window with no sale.
    expect(nftsListPage(listInput({ live: fulfilled(liveOf()) })).top).toBe("none");
    expect(nftsListPage(listInput({ live: fulfilled(liveOf(nftVolumeRowSample({ components: [], count: 0, total: "0" }))) })).top).toBe("none");
  });

  it("says the sales had no price in XRP when every sale of the window is unrated, and not that there were none", () => {
    // Three sales, none in a currency with a rate: no component to list, but the tile says 3 sales, so the card must not say there were none.
    const page = nftsListPage(listInput({ live: fulfilled(liveOf(nftVolumeRowSample({ components: [], count: 3, total: "0" }))) }));
    expect(page.top).toBe("unrated");
    expect(page.tiles.sales.figure).toBe("3");
    expect(page.failures).toEqual({});
  });
});

// ---- The sales ----------------------------------------------------------------------------------------------------------------------------------

describe("the sale rows", () => {
  it("writes a sale row: the serial on XRPL, the short id on Xahau, ≈ for a converted token price, the royalty in XRP when converted", () => {
    const [direct] = saleRows(XRPL, [nftSaleSample()]);
    expect(direct).toEqual({
      key: `${nftSaleSample().tx_hash}:1`,
      time: Date.parse("2026-10-24T16:08:12Z") / 1000,
      txHash: nftSaleSample().tx_hash,
      nft: { id: NFT_ID, serial: 95234705, glyph: "05" },
      collection: { label: "r4PP7g…CzT3 · taxon 10", href: `/xrpl/nfts/${NFT_ISSUER}/10` },
      price: { value: "10", currency: "XRP" },
      seller: nftSaleSample().seller,
      buyer: NFT_OWNER,
      mode: "direct",
      royalty: "0.5 XRP",
    });
    expect(direct).not.toHaveProperty("converted");

    // 420 USD bought for 96 XRP at the day's rate: the price stays in USD, "≈ 96 XRP" under it, and the royalty (4.2 USD of the sale) in XRP: 4.2 × 96 ÷ 420.
    const [token] = saleRows(XRPL, [nftSaleSample({ amount: "420", currency: "USD", amount_issuer: OTHER_ISSUER, converted_amount: "96", royalty_est: "4.2", mode: "brokered" })]);
    expect(token).toMatchObject({
      price: { value: "420", currency: "USD", issuer: OTHER_ISSUER },
      converted: "≈ 96 XRP",
      mode: "brokered",
      royalty: "0.96 XRP",
    });

    // Xahau: no serial, so the page shows the short id; the glyph is the id's first two characters; the collection is the issuer alone; no royalty.
    const [uri] = saleRows(XAHAU, [
      nftSaleSample({ kind: "uritoken", nft_id: URI_TOKEN_ID, issuer: URI_TOKEN_ISSUER, taxon: undefined, serial: undefined, amount: "4200", currency: "XAH", converted_amount: "4200", royalty_est: undefined }),
    ]);
    expect(uri!.nft).toEqual({ id: URI_TOKEN_ID, glyph: "96" });
    expect(uri!.collection).toEqual({ label: "rodinG…zKyb", href: `/xahau/nfts/${URI_TOKEN_ISSUER}` });
    expect(uri!.royalty).toBeNull();
    expect(uri).not.toHaveProperty("converted");
  });

  it("writes the royalty of a converted sale to six decimals, half up, and of an unconverted token sale in the token", () => {
    const royalty = (over: Parameters<typeof nftSaleSample>[0]) => saleRows(XRPL, [nftSaleSample(over)])[0]!.royalty;
    // 1 × 1 ÷ 3 = 0.333333…; 2 × 1 ÷ 3 = 0.666666…7.
    expect(royalty({ amount: "3", currency: "USD", amount_issuer: OTHER_ISSUER, converted_amount: "1", royalty_est: "1" })).toBe("0.333333 XRP");
    expect(royalty({ amount: "3", currency: "USD", amount_issuer: OTHER_ISSUER, converted_amount: "1", royalty_est: "2" })).toBe("0.666667 XRP");
    // The day has no rate for the token: no "≈", and the royalty stays in USD.
    const [unrated] = saleRows(XRPL, [nftSaleSample({ amount: "420", currency: "USD", amount_issuer: OTHER_ISSUER, converted_amount: undefined, royalty_est: "4.2" })]);
    expect(unrated).not.toHaveProperty("converted");
    expect(unrated!.royalty).toBe("4.2 USD");
    // A royalty over a thousand is grouped; a 40-hex currency code is the text it decodes to.
    expect(royalty({ amount: "25000", royalty_est: "1250", converted_amount: "25000" })).toBe("1,250 XRP");
    expect(royalty({ amount: "25", currency: "524C555344000000000000000000000000000000", amount_issuer: OTHER_ISSUER, converted_amount: undefined, royalty_est: "1.25" })).toBe("1.25 RLUSD");
  });

  it("falls back to the price's currency for a token sale whose conversion is 0", () => {
    // A price so small that the day's rate makes it 0 XRP: "≈ 0 XRP" would be a statement the API did not make, and a royalty of 0 XRP would hide the royalty.
    const [zero] = saleRows(XRPL, [nftSaleSample({ amount: "0.000001", currency: "USD", amount_issuer: OTHER_ISSUER, converted_amount: "0", royalty_est: "0.00000005" })]);
    expect(zero).not.toHaveProperty("converted");
    expect(zero!.royalty).toBe("0.00000005 USD");
  });

  it("says — for a royalty that is not there (ruling C24), and never gives one on Xahau", () => {
    expect(saleRows(XRPL, [nftSaleSample({ royalty_est: undefined })])[0]!.royalty).toBeNull();
    expect(saleRows(XAHAU, [nftSaleSample({ kind: "uritoken", royalty_est: "5", currency: "XAH", taxon: undefined, serial: undefined })])[0]!.royalty).toBeNull();
  });

  it("has no ≈ for a price in the native currency, and one for a token named like it that has an issuer", () => {
    // `converted_amount` of a native price equals its amount: nothing to say under it.
    expect(saleRows(XRPL, [nftSaleSample({ converted_amount: "10" })])[0]).not.toHaveProperty("converted");
    // A token that is called XRP but is issued is not the native currency.
    const [fake] = saleRows(XRPL, [nftSaleSample({ amount: "10", currency: "XRP", amount_issuer: OTHER_ISSUER, converted_amount: "0.5" })]);
    expect(fake).toMatchObject({ price: { value: "10", currency: "XRP", issuer: OTHER_ISSUER }, converted: "≈ 0.5 XRP" });
  });

  it("gives each sale of a transaction its own key", () => {
    const rows = saleRows(XRPL, [nftSaleSample({ event_index: 1 }), nftSaleSample({ event_index: 2, nft_id: OTHER_NFT_ID })]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  it("gives Older only with the sales' marker", () => {
    const withMarker = nftsListPage(listInput({ sales: fulfilled(nftSalesPageSample({ marker: NFT_MARKER })) }));
    expect(withMarker.sales).toHaveLength(1);
    expect(withMarker.olderSalesHref).toBe(nftSalesHref("xrpl", { marker: NFT_MARKER }));
    expect(withMarker.olderSalesHref).toBe(`/xrpl/nfts/sales?marker=${NFT_MARKER}`);

    const last = nftSalesPageSample();
    delete last.marker;
    const withoutMarker = nftsListPage(listInput({ sales: fulfilled(last) }));
    expect(withoutMarker.sales).toHaveLength(1);
    expect(withoutMarker.olderSalesHref).toBeNull();
  });

  it("says there are no sales when the list is empty", () => {
    const page = nftsListPage(listInput({ sales: fulfilled(nftSalesPageSample({ count: 0, sales: [] })) }));
    expect(page.sales).toEqual([]);
    expect(page.failures.sales).toBeUndefined();
  });
});

// ---- The collections ----------------------------------------------------------------------------------------------------------------------------

describe("the collection rows", () => {
  it("writes collection rows and the sort links with aria-sort and the flipped order", () => {
    const page = nftsListPage(
      listInput({
        collections: fulfilled(
          nftCollectionsPageSample({
            count: 3,
            collections: [
              collectionSample({
                supply: 10000,
                holders: 3812,
                minted: 10000,
                burned: 0,
                sales_count: 41208,
                volume_native: "18400000",
                last_mint: { ledger_index: 107874617, tx_hash: "3D9B20E130D7498E98FB3499BD4C2AC4CCDB3D11FFBFEA8F9B7FB844DDF33426", executed_time: "2026-10-14T09:00:00Z" },
              }),
              collectionSample({ issuer: OTHER_ISSUER, taxon: 0, supply: 1, holders: 1, minted: 0, burned: 0, sales_count: 1, volume_native: "10" }),
              collectionSample({ issuer: URI_TOKEN_ISSUER, taxon: 4294967295 }),
            ],
          }),
        ),
      }),
    );
    expect(page.collections).toEqual([
      {
        key: `${NFT_ISSUER}/10`,
        glyph: "4P",
        issuer: "r4PP7g…CzT3",
        href: `/xrpl/nfts/${NFT_ISSUER}/10`,
        under: "taxon 10",
        supply: "10,000",
        holders: "3,812",
        mintedBurned: "10,000 / 0",
        sales: "41,208",
        volume: "18.4M XRP",
        lastMint: "Oct 14, 2026",
      },
      {
        key: `${OTHER_ISSUER}/0`,
        glyph: "Lx",
        issuer: "rLxc1b…rwMy",
        href: `/xrpl/nfts/${OTHER_ISSUER}/0`,
        under: "taxon 0",
        supply: "1",
        holders: "1",
        mintedBurned: "0 / 0",
        sales: "1",
        volume: "10 XRP",
        lastMint: "—",
      },
      expect.objectContaining({ key: `${URI_TOKEN_ISSUER}/4294967295`, under: "taxon 4,294,967,295", href: `/xrpl/nfts/${URI_TOKEN_ISSUER}/4294967295` }),
    ]);
    // The headers of Supply, Holders and Volume: volume, largest first, is the default, so its link flips to ascending and the others sort largest first.
    expect(page.sortLinks).toEqual([
      { sort: "volume", href: "/xrpl/nfts?order=asc", ariaSort: "descending" },
      { sort: "supply", href: "/xrpl/nfts?sort=supply", ariaSort: "none" },
      { sort: "holders", href: "/xrpl/nfts?sort=holders", ariaSort: "none" },
    ]);
  });

  it("writes a Xahau collection: the issuer alone, and every URIToken of it", () => {
    const page = nftsListPage(listInput({ net: XAHAU, collections: fulfilled(nftCollectionsPageSample({ collections: [uriTokenCollectionSample()] })) }));
    expect(page.collections).toEqual([
      {
        key: URI_TOKEN_ISSUER,
        glyph: "od",
        issuer: "rodinG…zKyb",
        href: `/xahau/nfts/${URI_TOKEN_ISSUER}`,
        under: "every URIToken of this issuer",
        supply: "5",
        holders: "3",
        mintedBurned: "1 / 0",
        sales: "1",
        volume: "4,200 XAH",
        lastMint: "Oct 21, 2026",
      },
    ]);
  });

  it("has no collection to show for an issuer with none: an empty list, not a failure", () => {
    const none = nftCollectionsPageSample({ total: 0, count: 0, collections: [] });
    delete none.marker;
    const page = nftsListPage(listInput({ query: { ...QUERY, issuer: ISSUER_FILTER }, collections: fulfilled(none) }));
    expect(page.collections).toEqual([]);
    expect(page.paging).toEqual({ newerHref: null, olderHref: null });
    expect(page.failures).toEqual({});
  });

  it("flips the order of the current sort in both directions, and starts another sort largest first", () => {
    const hrefs = (query: Partial<NftsQuery>) => nftsListPage(listInput({ query: { ...QUERY, ...query } })).sortLinks;
    expect(hrefs({ sort: "supply", order: "asc" })).toEqual([
      { sort: "volume", href: "/xrpl/nfts", ariaSort: "none" },
      { sort: "supply", href: "/xrpl/nfts?sort=supply", ariaSort: "ascending" },
      { sort: "holders", href: "/xrpl/nfts?sort=holders", ariaSort: "none" },
    ]);
    expect(hrefs({ sort: "holders" })[2]).toEqual({ sort: "holders", href: "/xrpl/nfts?sort=holders&order=asc", ariaSort: "descending" });
  });

  it("keeps the period and the issuer in the sort links, and drops the page the visitor was on", () => {
    const links = nftsListPage(listInput({ query: { ...QUERY, period: "7day", issuer: ISSUER_FILTER, sort: "supply" } })).sortLinks;
    expect(links.map((link) => link.href)).toEqual([
      `/xrpl/nfts?period=7day&issuer=${ISSUER_FILTER}`,
      `/xrpl/nfts?period=7day&issuer=${ISSUER_FILTER}&sort=supply&order=asc`,
      `/xrpl/nfts?period=7day&issuer=${ISSUER_FILTER}&sort=holders`,
    ]);
  });

  it("leaves the period out of Older: the pages behind a marker are of the first period", () => {
    // A page behind a marker has no tiles or chart, so its link has no `period`, whatever period the first page was of.
    const page = nftsListPage(listInput({ query: { ...QUERY, period: "7day", sort: "supply" }, collections: fulfilled(nftCollectionsPageSample({ marker: MARKERS.M3 })) }));
    expect(page.periods.map((link) => link.current)).toEqual([false, true, false]);
    expect(page.paging.olderHref).toBe(`/xrpl/nfts?sort=supply&marker=${MARKERS.M3}`);
  });

  it("pages the table with More collections, and Newer and Older behind a marker", () => {
    const first = nftsListPage(listInput({ query: { ...QUERY, sort: "supply", order: "asc" }, collections: fulfilled(nftCollectionsPageSample({ marker: MARKERS.M3 })) }));
    expect(first.paging).toEqual({ newerHref: null, olderHref: `/xrpl/nfts?sort=supply&order=asc&marker=${MARKERS.M3}` });
    const last = nftCollectionsPageSample();
    delete last.marker;
    expect(nftsListPage(listInput({ collections: fulfilled(last) })).paging).toEqual({ newerHref: null, olderHref: null });
  });
});

// ---- The periods and the heading ----------------------------------------------------------------------------------------------------------------

describe("the heading, the intro and the periods", () => {
  it("the intro names the network by its longName", () => {
    const intro = (net: NftsNet) => nftsListPage(listInput({ net })).intro;
    expect(intro(XRPL)).toBe("Non-fungible tokens (NFTokens) on the XRP Ledger: sales, collections and their holders. A collection is an issuer and a taxon.");
    // A testnet network gives "XRPL Testnet" (E7 §16: never a literal XRPL in copy).
    expect(intro(XRPL_TESTNET)).toBe("Non-fungible tokens (NFTokens) on XRPL Testnet: sales, collections and their holders. A collection is an issuer and a taxon.");
    expect(intro(XAHAU)).toBe("URITokens, the non-fungible tokens of Xahau: sales, collections and their holders. A collection is everything one issuer minted.");
    expect(intro(XAHAU_TESTNET)).toBe("URITokens, the non-fungible tokens of Xahau Testnet: sales, collections and their holders. A collection is everything one issuer minted.");
  });

  it("heads the page with the network's word for its tokens", () => {
    expect(nftsListPage(listInput()).heading).toBe("NFTs");
    expect(nftsListPage(listInput({ net: XAHAU })).heading).toBe("URITokens");
  });

  it("links the three periods, the current one marked", () => {
    expect(nftsListPage(listInput()).periods).toEqual([
      { label: "24 h", href: "/xrpl/nfts", current: true },
      { label: "7 days", href: "/xrpl/nfts?period=7day", current: false },
      { label: "30 days", href: "/xrpl/nfts?period=30day", current: false },
    ]);
    const seven = nftsListPage(listInput({ net: XAHAU, query: { ...QUERY, period: "7day" } })).periods;
    expect(seven.map((link) => [link.href, link.current])).toEqual([
      ["/xahau/nfts", false],
      ["/xahau/nfts?period=7day", true],
      ["/xahau/nfts?period=30day", false],
    ]);
  });

  it("keeps the issuer and the sort in the period links", () => {
    const links = nftsListPage(listInput({ query: { ...QUERY, issuer: ISSUER_FILTER, sort: "holders", order: "asc" } })).periods;
    expect(links.map((link) => link.href)).toEqual([
      nftsHref("xrpl", { issuer: ISSUER_FILTER, sort: "holders", order: "asc" }),
      nftsHref("xrpl", { period: "7day", issuer: ISSUER_FILTER, sort: "holders", order: "asc" }),
      nftsHref("xrpl", { period: "30day", issuer: ISSUER_FILTER, sort: "holders", order: "asc" }),
    ]);
  });
});

// ---- The coverage notes -------------------------------------------------------------------------------------------------------------------------

describe("the coverage notes", () => {
  const partial = coverageSample({ from_ledger_index: 107874617, complete: false });
  const everything: Partial<NftsListInput> = {
    live: fulfilled(nftVolumeSample({ coverage: partial })),
    daily: fulfilled({ coverage: partial, count: 0, rows: [] }),
    sales: fulfilled(nftSalesPageSample({ coverage: partial })),
    collections: fulfilled(nftCollectionsPageSample({ coverage: partial })),
  };

  it("puts a coverage note under each card whose coverage is incomplete, and none when complete", () => {
    const page = nftsListPage(listInput(everything));
    const note = (words: string) => ({ before: "Covers ledger ", ledger: 107874617, after: ` onwards: earlier ${words} are not in the index yet.` });
    expect(page.notes).toEqual({ chart: note("NFT sales"), top: note("NFT sales"), sales: note("NFT sales"), collections: note("collections") });

    expect(withNotes(nftsListPage(listInput()))).toBe(0);
    expect(nftsListPage(listInput()).notes).toEqual({ chart: null, top: null, sales: null, collections: null });
  });

  it("notes each card from its own call: one incomplete answer is one note", () => {
    const page = nftsListPage(listInput({ sales: everything.sales! }));
    expect(page.notes).toMatchObject({ chart: null, top: null, collections: null });
    expect(page.notes.sales).not.toBeNull();
  });

  it("says a coverage that holds no ledger", () => {
    const none = { complete: false } as const;
    const page = nftsListPage(listInput({ collections: fulfilled(nftCollectionsPageSample({ coverage: none })) }));
    expect(page.notes.collections).toEqual({ before: "The index does not hold this history yet.", ledger: null, after: "" });
  });

  it("names Xahau's sales in its own words", () => {
    const page = nftsListPage(listInput({ net: XAHAU, ...everything }));
    expect(page.notes.sales).toEqual({ before: "Covers ledger ", ledger: 107874617, after: ` onwards: earlier ${SALES_WORDS.xahau} are not in the index yet.` });
    expect(page.notes.collections?.after).toBe(" onwards: earlier collections are not in the index yet.");
  });

  it("has no note under a card that failed", () => {
    const page = nftsListPage(listInput({ ...everything, sales: rejected(new Error("down")), daily: null }));
    expect(page.notes.sales).toBeNull();
    expect(page.notes.chart).toBeNull();
  });
});

// ---- The issuer form ----------------------------------------------------------------------------------------------------------------------------

describe("the issuer form", () => {
  it("keeps the issuer form's text and error", () => {
    expect(nftsListPage(listInput()).issuerForm).toEqual({ value: "", hidden: [] });
    expect(nftsListPage(listInput({ query: { ...QUERY, issuer: ISSUER_FILTER } })).issuerForm).toEqual({ value: ISSUER_FILTER, hidden: [] });
    const wrong = nftsListPage(listInput({ query: { ...QUERY, issuer: "rNotAnAddress" }, issuerError: "Write a classic address (r…).", collections: null }));
    expect(wrong.issuerForm).toEqual({ value: "rNotAnAddress", hidden: [], error: "Write a classic address (r…)." });
    // No list was asked for: no rows, no pager, and no failure to tell.
    expect(wrong.collections).toBeNull();
    expect(wrong.paging).toEqual({ newerHref: null, olderHref: null });
    expect(wrong.failures).toEqual({});
    expect(wrong.sortLinks).toHaveLength(3);
  });
});

describe("the issuer form's hidden fields", () => {
  const hidden = (query: Partial<NftsQuery>, net: NftsNet = XRPL) => nftsListPage(listInput({ net, query: { ...QUERY, ...query } })).issuerForm.hidden;

  it("carries the view's period, sort and order, defaults dropped, in the canonical order", () => {
    // Nothing of the default view is a field of the form: submitting it asks for `?issuer=…` alone.
    expect(hidden({})).toEqual([]);
    expect(hidden({ period: "7day" })).toEqual([["period", "7day"]]);
    expect(hidden({ period: "30day", sort: "holders", order: "asc" })).toEqual([
      ["period", "30day"],
      ["sort", "holders"],
      ["order", "asc"],
    ]);
    expect(hidden({ sort: "supply" })).toEqual([["sort", "supply"]]);
    expect(hidden({ order: "asc" })).toEqual([["order", "asc"]]);
    // The default sort with another order, and another sort with the default order.
    expect(hidden({ sort: "volume", order: "asc" })).toEqual([["order", "asc"]]);
    expect(hidden({ sort: "supply", order: "desc" })).toEqual([["sort", "supply"]]);
  });

  it("is the query of the canonical link to that view, less the issuer", () => {
    for (const query of [{}, { period: "7day" }, { sort: "holders", order: "asc" }, { period: "30day", sort: "supply" }] as const) {
      const fields = hidden(query)!;
      const link = nftsHref("xrpl", { ...QUERY, ...query });
      expect(link).toBe(fields.length === 0 ? "/xrpl/nfts" : `/xrpl/nfts?${fields.map(([name, value]) => `${name}=${value}`).join("&")}`);
    }
  });

  it("is the same on the other network, where the path is the form's own", () => {
    expect(hidden({ period: "7day", sort: "supply" }, XAHAU)).toEqual([
      ["period", "7day"],
      ["sort", "supply"],
    ]);
  });

  it("keeps them while the issuer is no address, and on a page behind a marker", () => {
    const wrong = nftsListPage(listInput({ query: { ...QUERY, issuer: "rBad", sort: "supply" }, issuerError: "Write a classic address (r…).", collections: null }));
    expect(wrong.issuerForm.hidden).toEqual([["sort", "supply"]]);
    // A marker page is of the first period: only the sort and the order are the view's.
    const marker = nftsMarkerPage(XRPL, { ...QUERY, sort: "holders", order: "asc", marker: MARKERS.M2, back: [] }, nftCollectionsPageSample());
    expect(marker.issuerForm.hidden).toEqual([
      ["sort", "holders"],
      ["order", "asc"],
    ]);
  });
});

// ---- The failures -------------------------------------------------------------------------------------------------------------------------------

describe("the failures", () => {
  const down = (path: string) => rejected(new UpstreamError("server", `data API GET ${path} answered 503`, { status: 503 }));

  it("says each card's failure in its words", () => {
    // #2: the totals and the top collections come from one call; the tiles keep their words under dashes.
    const totals = nftsListPage(listInput({ live: down("/v2/network/nft_volume") }));
    expect(totals.failures).toEqual({ totals: "the totals", top: "the top collections" });
    expect(totals.tiles.volume.figure).toBeNull();
    expect(totals.tiles.sales.figure).toBeNull();
    expect(totals.tiles.traded).toEqual({ figure: null, note: "" });
    expect(totals.tiles.average.figure).toBeNull();
    expect(totals.tiles.volume.note).toBe("sales in XRP and in tokens with a daily XRP rate");
    expect(totals.top).toBeNull();
    expect(totals.notes.top).toBeNull();
    // The rest stands.
    expect(totals.chart).not.toBeNull();
    expect(totals.sales).not.toBeNull();
    expect(totals.collections).not.toBeNull();

    const chart = nftsListPage(listInput({ daily: down("/v2/network/nft_volume") }));
    expect(chart.failures).toEqual({ chart: "the sales volume" });
    expect(chart.chart).toBeNull();
    expect(chart.tiles.volume.figure).not.toBeNull();

    const sales = nftsListPage(listInput({ sales: down("/v2/nft_sales") }));
    expect(sales.failures).toEqual({ sales: "the recent sales" });
    expect(sales.sales).toBeNull();
    expect(sales.olderSalesHref).toBeNull();

    const collections = nftsListPage(listInput({ collections: down("/v2/nft_collections") }));
    expect(collections.failures).toEqual({ collections: "the collections" });
    expect(collections.collections).toBeNull();
    expect(collections.paging).toEqual({ newerHref: null, olderHref: null });
    expect(collections.sortLinks).toHaveLength(3);
  });

  it("fails the chart alone when last_validated failed, or took too long, or holds no time", () => {
    for (const last of [down("/v2/last_validated"), rejected(new TooLate()), fulfilled({ ...LAST, close_time: "yesterday" }), fulfilled({ ...LAST, ledger_index: "latest" })]) {
      const page = nftsListPage(listInput({ last }));
      expect(page.failures).toEqual({ chart: "the sales volume" });
      expect(page.chart).toBeNull();
      expect(page.tiles.volume.figure).not.toBeNull();
    }
  });

  it("fails the chart when the daily call was not made", () => {
    expect(nftsListPage(listInput({ daily: null })).failures).toEqual({ chart: "the sales volume" });
  });

  it("tells every card's failure at once, and still gives the page", () => {
    const page = nftsListPage(
      listInput({ last: down("/v2/last_validated"), live: down("/v2/network/nft_volume"), daily: null, sales: down("/v2/nft_sales"), collections: down("/v2/nft_collections") }),
    );
    expect(page.failures).toEqual({ totals: "the totals", chart: "the sales volume", top: "the top collections", sales: "the recent sales", collections: "the collections" });
    expect(page.heading).toBe("NFTs");
    expect(page.periods).toHaveLength(3);
    expect(page.sortLinks).toHaveLength(3);
    expect(page.marker).toBe(false);
  });
});

// ---- A page behind a marker ---------------------------------------------------------------------------------------------------------------------

describe("a page behind a marker", () => {
  const query: NftsQuery = { period: "day", issuer: ISSUER_FILTER, sort: "supply", order: "asc", marker: MARKERS.M2, back: [MARKERS.M1] };

  it("a marker page is the collections table alone, with Newer and Older", () => {
    const page = nftsMarkerPage(XRPL, query, nftCollectionsPageSample({ marker: MARKERS.M3, coverage: coverageSample({ complete: true }) }));
    expect(page.marker).toBe(true);
    expect(page.heading).toBe("More NFT collections");
    expect(page.collections).toHaveLength(1);
    expect(page.paging).toEqual({
      newerHref: nftsHref("xrpl", { issuer: ISSUER_FILTER, sort: "supply", order: "asc", marker: MARKERS.M1 }),
      olderHref: nftsHref("xrpl", { issuer: ISSUER_FILTER, sort: "supply", order: "asc", marker: MARKERS.M3, back: [MARKERS.M2, MARKERS.M1] }),
    });
    expect(page.paging.newerHref).toBe(`/xrpl/nfts?issuer=${ISSUER_FILTER}&sort=supply&order=asc&marker=${MARKERS.M1}`);
    expect(page.paging.olderHref).toBe(`/xrpl/nfts?issuer=${ISSUER_FILTER}&sort=supply&order=asc&marker=${MARKERS.M3}&back=${MARKERS.M2}.${MARKERS.M1}`);

    // No tile, chart, top list, sales or period: they are the first page's.
    expect(page.intro).toBe("");
    expect(page.periods).toEqual([]);
    expect(page.tiles).toEqual({
      volume: { figure: null, note: "" },
      sales: { figure: null, note: "" },
      traded: { figure: null, note: "" },
      average: { figure: null, note: "" },
    });
    expect(page.chart).toBeNull();
    expect(page.top).toBeNull();
    expect(page.sales).toBeNull();
    expect(page.olderSalesHref).toBeNull();
    expect(page.failures).toEqual({});
    expect(page.notes).toEqual({ chart: null, top: null, sales: null, collections: null });
    // The form and the sort headers are the table's.
    expect(page.issuerForm).toEqual({ value: ISSUER_FILTER, hidden: [["sort", "supply"], ["order", "asc"]] });
    expect(page.sortLinks.map((link) => link.href)).toEqual([
      `/xrpl/nfts?issuer=${ISSUER_FILTER}`,
      `/xrpl/nfts?issuer=${ISSUER_FILTER}&sort=supply`,
      `/xrpl/nfts?issuer=${ISSUER_FILTER}&sort=holders`,
    ]);
    expect(page.sortLinks.map((link) => link.ariaSort)).toEqual(["none", "ascending", "none"]);
  });

  it("goes back to the first page with no trail, and ends with no next marker", () => {
    const last = nftCollectionsPageSample({ coverage: coverageSample({ complete: false }) });
    delete last.marker;
    const page = nftsMarkerPage(XRPL, { ...QUERY, marker: MARKERS.M1, back: [] }, last);
    expect(page.paging).toEqual({ newerHref: "/xrpl/nfts", olderHref: null });
    expect(page.notes.collections).toEqual({ before: "Covers ledger ", ledger: 107874617, after: " onwards: earlier collections are not in the index yet." });
  });

  it("is titled in the network's words", () => {
    expect(nftsMarkerPage(XAHAU, { ...QUERY, marker: MARKERS.M1, back: [] }, nftCollectionsPageSample({ collections: [uriTokenCollectionSample()] })).heading).toBe("More URIToken collections");
  });
});

// ---- The older sales ----------------------------------------------------------------------------------------------------------------------------

describe("the older sales", () => {
  it("lists the sales with Newer and Older and the coverage note", () => {
    const page: NftSalesPage = nftSalesPageSample({ marker: MARKERS.M3, count: 2, sales: [nftSaleSample(), nftSaleSample({ event_index: 2 })] });
    const data = nftSalesPage(XRPL, { marker: MARKERS.M2, back: [MARKERS.M1] }, page);
    expect(data.heading).toBe("NFT sales");
    expect(data.rows).toEqual(saleRows(XRPL, page.sales));
    expect(data.rows).toHaveLength(2);
    expect(data.paging).toEqual({
      newerHref: nftSalesHref("xrpl", { marker: MARKERS.M1 }),
      olderHref: nftSalesHref("xrpl", { marker: MARKERS.M3, back: [MARKERS.M2, MARKERS.M1] }),
    });
    expect(data.paging.olderHref).toBe(`/xrpl/nfts/sales?marker=${MARKERS.M3}&back=${MARKERS.M2}.${MARKERS.M1}`);
    expect(data.note).toEqual({ before: "Covers ledger ", ledger: 107874617, after: " onwards: earlier NFT sales are not in the index yet." });
  });

  it("goes back to the first page of the sales, and has no note when the coverage is complete", () => {
    const page = nftSalesPageSample({ coverage: coverageSample({ complete: true }) });
    delete page.marker;
    const data = nftSalesPage(XRPL, { marker: MARKERS.M1, back: [] }, page);
    expect(data.paging).toEqual({ newerHref: "/xrpl/nfts/sales", olderHref: null });
    expect(data.note).toBeNull();
    expect(nftSalesPage(XRPL, { back: [] }, page).paging).toEqual({ newerHref: null, olderHref: null });
  });

  it("has no row, no Older and a way back for a page with no sale", () => {
    // The last page of the sales, as far as the API goes: nothing on it, and no marker.
    const empty = nftSalesPageSample({ count: 0, sales: [], coverage: coverageSample({ complete: true }) });
    delete empty.marker;
    const data = nftSalesPage(XRPL, { marker: MARKERS.M2, back: [MARKERS.M1] }, empty);
    expect(data.rows).toEqual([]);
    expect(data.paging).toEqual({ newerHref: `/xrpl/nfts/sales?marker=${MARKERS.M1}`, olderHref: null });
    expect(data.note).toBeNull();
  });

  it("is headed in the network's words", () => {
    const data = nftSalesPage(XAHAU, { back: [] }, nftSalesPageSample());
    expect(data.heading).toBe("URIToken sales");
    expect(data.note?.after).toBe(` onwards: earlier ${SALES_WORDS.xahau} are not in the index yet.`);
  });
});

// ---- The builders over the fixtures' answers ----------------------------------------------------------------------------------------------------

describe("over the recorded fixtures", () => {
  const dir = new URL("../../test/fixtures/http/", import.meta.url);
  const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, dir), "utf8")) as T;
  const answers = (net: "xrpl" | "xahau") => {
    const api = `${net}/data-api/`;
    return {
      last: json<LastValidated>(`${api}last_validated.json`),
      live: json<NftVolume>(`${api}network/nft_volume@live=day.json`),
      daily: json<NftVolume>(`${api}network/nft_volume@end=2026-10-17&interval=day&limit=1000&start=2026-09-18.json`),
      sales: json<NftSalesPage>(`${api}nft_sales@descending=true&limit=10.json`),
      collections: json<NftCollectionsPage>(`${api}nft_collections@limit=20&sort=volume.json`),
    };
  };

  it.each([
    ["xrpl", XRPL, "NFTs"],
    ["xahau", XAHAU, "URITokens"],
  ] as const)("%s: builds the whole first page", (id, net, heading) => {
    const a = answers(id);
    const page = nftsListPage({ net, query: QUERY, last: fulfilled(a.last), live: fulfilled(a.live), daily: fulfilled(a.daily), sales: fulfilled(a.sales), collections: fulfilled(a.collections) });
    expect(page.heading).toBe(heading);
    expect(page.failures).toEqual({});
    // The tiles are the live row's, exactly.
    const row = a.live.rows[0]!;
    expect(page.tiles.volume.figure).toBe(`${compactNumber(row.total)} ${net.native}`);
    expect(page.tiles.traded.figure).toBe(String(row.components.length));
    expect(page.tiles.traded.note).toBe(`of ${formatAmount(String(a.collections.total))} collections`);
    // 30 days up to Oct 17: the days of the file, and the running one not computed yet.
    expect(page.chart!.data.axis.buckets).toEqual(W.buckets);
    expect(page.chart!.data.series[0]!.values.filter((value) => value !== null)).toHaveLength(W.buckets.length - 1);
    expect(page.chart!.data.pending).toBe(1);
    // The lists are the files' rows, in their order.
    if (page.top === null || typeof page.top === "string") throw new Error("a list");
    expect(page.top.items.length).toBe(Math.min(5, row.components.length));
    expect(page.sales).toHaveLength(a.sales.sales.length);
    expect(page.sales!.map((sale) => sale.nft.id)).toEqual(a.sales.sales.map((sale) => sale.nft_id));
    expect(page.collections).toHaveLength(20);
    expect(page.collections!.map((c) => c.issuer)).toEqual(a.collections.collections.map((c) => shortAddress(c.issuer)));
    expect(page.collections!.every((c) => c.href.startsWith(`/${id}/nfts/`))).toBe(true);
    // Older leads to the next page of each list, by the markers the files carry.
    expect(page.olderSalesHref).toBe(nftSalesHref(id, { marker: a.sales.marker }));
    expect(page.paging.olderHref).toBe(nftsHref(id, { marker: a.collections.marker }));
    // XRPL's coverage is complete and Xahau's is not: both states are drawn.
    expect(withNotes(page)).toBe(id === "xrpl" ? 0 : 4);
  });
});
