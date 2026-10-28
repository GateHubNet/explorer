import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  coverageSample,
  NFT_ISSUER,
  nftCollectionsPageSample,
  nftSaleSample,
  nftSalesPageSample,
  nftVolumeRowSample,
  nftVolumeSample,
  collectionSample,
  OTHER_ISSUER,
  URI_TOKEN_ID,
  URI_TOKEN_ISSUER,
  uriTokenCollectionSample,
} from "../../../test/support/nft-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import { LAYOUT_XAHAU, LAYOUT_XRPL, mountLoadedPage, mountPage, routedPage } from "../../../test/support/under-network";
import { shortAddress } from "../../domain/format";
import { parseNftsParams } from "../../domain/nft-params";
import { addDays, windowOf } from "../../domain/window";
import type { LastValidated, NftVolume, NftVolumeComponent, NftVolumeRow } from "../../server/api-types";
import { nftsListPage, nftsMarkerPage, type NftsListInput, type NftsNet, type NftsPageData } from "../../server/nfts-view";
import { UpstreamError } from "../../server/upstream";
import { NftsPage } from "./NftsPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---- The world of the tests: T is Oct 17, the live set ends at 17:01 UTC ----------------------------------------------------------------------------

const XRPL: NftsNet = { id: "xrpl", native: "XRP", longName: "the XRP Ledger" };
const XAHAU: NftsNet = { id: "xahau", native: "XAH", longName: "Xahau" };

const fulfilled = <T,>(value: T): PromiseFulfilledResult<T> => ({ status: "fulfilled", value });
const rejected = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });
const outage = () => new UpstreamError("server", "data API GET /v2/x answered 503", { status: 503 });

const LAST: LastValidated = {
  result: "success",
  ledger_index: "107721455",
  ledger_hash: "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092",
  parent_hash: "5FA71FCC25A865DA7569108807E031AFB3E1CD03A8CE078BC1AA534C8E546BE8",
  close_time: "2026-10-17T17:01:12Z",
};
const W = windowOf("2026-10-17", "30d");

const component = (issuer: string, taxon: number | undefined, count: number, amount: string): NftVolumeComponent => ({
  issuer,
  ...(taxon === undefined ? {} : { taxon }),
  count,
  amount,
  rate: "1.0000000",
  converted_amount: amount,
});

const dayRow = (day: string, total: string, count: number): NftVolumeRow => ({
  components: [],
  count,
  exchange: { currency: "XRP" },
  total,
  exchange_rate: "1.0000000",
  start_time: `${day}T00:00:00Z`,
  end_time: `${addDays(day, 1)}T00:00:00Z`,
});

const COMPLETE = coverageSample({ complete: true });
/** Every day of the window but the running one. */
const daily = (rows: NftVolumeRow[] = W.buckets.slice(0, -1).map((day, index) => dayRow(day, `${100 + index}.25`, index + 1)), coverage = COMPLETE): NftVolume => ({
  coverage,
  count: rows.length,
  rows,
});

/** The live row of the tests: 5,000 XRP over 1,290 sales, three collections, the first with 43.9% of it. */
const liveRow = (over: Partial<NftVolumeRow> = {}) =>
  nftVolumeRowSample({
    components: [component(NFT_ISSUER, 10, 412, "2195"), component(OTHER_ISSUER, 0, 600, "1805"), component("rDeizxSRo6JHjKnih9ivpPkyD2EgXQvhSB", 26, 100, "1000")],
    count: 1290,
    total: "5000",
    ...over,
  });

const SALES = [
  nftSaleSample({ amount: "1250", converted_amount: "1250", royalty_est: "62.5" }),
  nftSaleSample({
    event_index: 2,
    tx_hash: "D".repeat(64),
    nft_id: "00090BB8".padEnd(64, "E"),
    serial: 5,
    amount: "420",
    currency: "SOLO",
    amount_issuer: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz",
    converted_amount: "96",
    royalty_est: "4.8",
    mode: "brokered",
  }),
];

/** The list's first page as the loader reads it: every call answered. */
function listInput(over: Partial<NftsListInput> = {}): NftsListInput {
  return {
    net: XRPL,
    query: { period: "day", sort: "volume", order: "desc", back: [] },
    last: fulfilled(LAST),
    live: fulfilled(nftVolumeSample({ rows: [liveRow()], coverage: COMPLETE })),
    daily: fulfilled(daily()),
    sales: fulfilled(nftSalesPageSample({ sales: SALES, coverage: COMPLETE })),
    collections: fulfilled(
      nftCollectionsPageSample({
        total: 38511,
        collections: [
          collectionSample({ supply: 10000, holders: 3812, minted: 10000, burned: 0, sales_count: 41208, volume_native: "18400000", last_mint: { ledger_index: 107000000, tx_hash: "E".repeat(64), executed_time: "2026-10-14T10:00:00Z" } }),
          collectionSample({ issuer: OTHER_ISSUER, taxon: 0, supply: 7777, holders: 2950, minted: 7777, burned: 0, sales_count: 25110, volume_native: "9100000" }),
        ],
        coverage: COMPLETE,
      }),
    ),
    ...over,
  };
}

const build = (over: Partial<NftsListInput> = {}): NftsPageData => nftsListPage(listInput(over));

/** The page in a data router at its own URL, drawn in the browser. `loader` counts the revalidations a Retry asks for. */
const mount = (data: NftsPageData, at = "/xrpl/nfts", network = LAYOUT_XRPL) => mountPage(<NftsPage data={data} />, "nfts", { at, network });

const routed = (data: NftsPageData, at = "/xrpl/nfts", network = LAYOUT_XRPL) => routedPage(<NftsPage data={data} />, { at, network });

const rowsOf = (name: string) => within(screen.getByRole("table", { name })).getAllByRole("row").slice(1);
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell");
const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);

// ---- The head ---------------------------------------------------------------------------------------------------------------------------------------

describe("NftsPage: the heading, the period and the totals", () => {
  it("has the h1 and the board's intro, on the network's name in a sentence", () => {
    mount(build());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("NFTs");
    expect(screen.getByText("Non-fungible tokens (NFTokens) on the XRP Ledger: sales, collections and their holders. A collection is an issuer and a taxon.").tagName).toBe("P");
  });

  it("says URITokens on Xahau, and the sandbox's names", () => {
    mount(build({ net: XAHAU }), "/xahau/nfts", LAYOUT_XAHAU);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("URITokens");
    expect(screen.getByText("URITokens, the non-fungible tokens of Xahau: sales, collections and their holders. A collection is everything one issuer minted.").tagName).toBe("P");
    cleanup();
    mount(build({ net: { ...XRPL, longName: "XRPL Testnet" } }));
    expect(document.body.textContent).toContain("Non-fungible tokens (NFTokens) on XRPL Testnet:");
    expect(document.body.textContent).not.toContain("XRP Ledger");
  });

  it("has the three periods as links, the current one marked, and says what the period sets", () => {
    mount(build({ query: { period: "7day", sort: "volume", order: "desc", back: [] } }));
    const group = screen.getByRole("group", { name: "Period" });
    const links = within(group).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["24 h", "/xrpl/nfts", null],
      ["7 days", "/xrpl/nfts?period=7day", "true"],
      ["30 days", "/xrpl/nfts?period=30day", null],
    ]);
    expect(screen.getByText("The period sets the totals and the top collections.")).toBeTruthy();
  });

  it("draws the four tiles of the live row, under the labels of the period", () => {
    mount(build());
    const totals = screen.getByRole("region", { name: "Totals" });
    expect([...totals.querySelectorAll(".stat")].map((tile) => [...tile.children].map((part) => part.textContent))).toEqual([
      ["Sales volume, 24 h", "5,000 XRP", "sales in XRP and in tokens with a daily XRP rate"],
      ["Sales, 24 h", "1,290", "direct and brokered"],
      ["Collections traded, 24 h", "3", "of 38,511 collections"],
      ["Average sale, 24 h", "4 XRP", "volume ÷ sales"],
    ]);
    expect(totals.querySelectorAll(".stat--figure")).toHaveLength(4);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the period in the tiles' labels, and Xahau's native currency and note", () => {
    mount(build({ net: XAHAU, query: { period: "30day", sort: "volume", order: "desc", back: [] } }), "/xahau/nfts?period=30day", LAYOUT_XAHAU);
    const totals = screen.getByRole("region", { name: "Totals" });
    const tiles = [...totals.querySelectorAll(".stat")].map((tile) => [...tile.children].map((part) => part.textContent));
    expect(tiles.map((tile) => tile[0])).toEqual(["Sales volume, 30 days", "Sales, 30 days", "Collections traded, 30 days", "Average sale, 30 days"]);
    expect(tiles[0]![1]).toMatch(/ XAH$/);
    expect(tiles[0]![2]).toBe("sales in XAH and in tokens with a daily XAH rate");
    expect(tiles[1]![2]).toBe("URITokenBuy");
  });

  it("draws dashes under the same labels with one SectionError, and the top collections' own, when the live volume failed", () => {
    const { loader } = mount(build({ live: rejected(outage()) }));
    const totals = screen.getByRole("region", { name: "Totals" });
    expect([...totals.querySelectorAll(".stat")].map((tile) => [tile.children[0]!.textContent, tile.children[1]!.textContent])).toEqual([
      ["Sales volume, 24 h", "—"],
      ["Sales, 24 h", "—"],
      ["Collections traded, 24 h", "—"],
      ["Average sale, 24 h", "—"],
    ]);
    const alerts = screen.getAllByRole("alert").map((alert) => alert.textContent);
    expect(alerts).toEqual(["Couldn’t load the totals.Retry", "Couldn’t load the top collections.Retry"]);
    // Retry asks the route for its data again.
    fireEvent.click(within(screen.getAllByRole("alert")[0]!).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
  });
});

// ---- The chart --------------------------------------------------------------------------------------------------------------------------------------

describe("NftsPage: the sales volume chart", () => {
  it("is a card titled with the unit, with a column for each of the 30 days and the table view in the page", () => {
    mount(build());
    const card = screen.getByRole("region", { name: "Sales volume per day, in XRP, last 30 days" });
    expect(within(card).getByText("/v2/network/nft_volume?interval=day")).toBeTruthy();
    expect(card.querySelectorAll(".col")).toHaveLength(30);
    const table = within(card).getByRole("table", { name: "Sales volume per day, in XRP, last 30 days" });
    expect(within(table).getAllByRole("row")).toHaveLength(31);
    expect(within(card).getByRole("radio", { name: "Table" })).toBeTruthy();
    // The running day is marked so far, and has no figure yet.
    expect(texts(within(table).getAllByRole("row")[1]!.children)[0]).toBe("Oct 17, 2026, so far");
  });

  it("says Xahau's unit in the title", () => {
    mount(build({ net: XAHAU }), "/xahau/nfts", LAYOUT_XAHAU);
    expect(screen.getByRole("region", { name: "Sales volume per day, in XAH, last 30 days" })).toBeTruthy();
  });

  it("says which days are not computed yet", () => {
    mount(build({ daily: fulfilled(daily(W.buckets.slice(0, -2).map((day, index) => dayRow(day, `${100 + index}.25`, index + 1)))) }));
    const card = screen.getByRole("region", { name: "Sales volume per day, in XRP, last 30 days" });
    expect(within(card).getByText(/not computed yet/)).toBeTruthy();
  });

  it("draws the failed card in its place, with the title and the source, when the 30 days failed, or the newest ledger did", () => {
    mount(build({ daily: rejected(outage()) }));
    const card = screen.getByRole("region", { name: "Sales volume per day, in XRP, last 30 days" });
    expect(within(card).getByText("/v2/network/nft_volume?interval=day")).toBeTruthy();
    expect(within(card).getByRole("alert").textContent).toBe("Couldn’t load the sales volume.Retry");
    expect(card.querySelectorAll(".col")).toHaveLength(0);
    cleanup();
    mount(build({ last: rejected(outage()), daily: null }));
    expect(within(screen.getByRole("region", { name: "Sales volume per day, in XRP, last 30 days" })).getByRole("alert").textContent).toBe("Couldn’t load the sales volume.Retry");
  });
});

// ---- The top collections ----------------------------------------------------------------------------------------------------------------------------

describe("NftsPage: the top collections", () => {
  it("is a list of the collections of the period, each a link, with its sales under it and its share at the tip", () => {
    mount(build());
    const card = screen.getByRole("region", { name: "Top collections, 24 h" });
    expect(within(card).getByText("/v2/network/nft_volume?live=day")).toBeTruthy();
    const items = within(card).getAllByRole("listitem");
    expect(items.map((item) => [item.querySelector(".barlist__label")!.textContent, item.querySelector(".barlist__sub")!.textContent, item.querySelector(".barlist__tip")!.textContent])).toEqual([
      ["r4PP7g…CzT3 · taxon 10", "412 sales", "2,195 XRP · 43.9%"],
      ["rLxc1b…rwMy · taxon 0", "600 sales", "1,805 XRP · 36.1%"],
      ["rDeizx…vhSB · taxon 26", "100 sales", "1,000 XRP · 20.0%"],
    ]);
    expect(within(card).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      `/xrpl/nfts/${NFT_ISSUER}/10`,
      `/xrpl/nfts/${OTHER_ISSUER}/0`,
      "/xrpl/nfts/rDeizxSRo6JHjKnih9ivpPkyD2EgXQvhSB/26",
    ]);
    // Its table view is in the page, too.
    expect(within(card).getByRole("table", { name: "Top collections, 24 h" })).toBeTruthy();
  });

  it("names the period in its title and its source", () => {
    mount(build({ query: { period: "7day", sort: "volume", order: "desc", back: [] } }));
    const card = screen.getByRole("region", { name: "Top collections, 7 days" });
    expect(within(card).getByText("/v2/network/nft_volume?live=7day")).toBeTruthy();
  });

  it.each([
    ["day", "24 hours", "24 h"],
    ["7day", "7 days", "7 days"],
    ["30day", "30 days", "30 days"],
  ] as const)("says that the %s had no sale, in the period's words", (period, words, label) => {
    mount(build({ query: { period, sort: "volume", order: "desc", back: [] }, live: fulfilled(nftVolumeSample({ rows: [], count: 0, coverage: COMPLETE })) }));
    const card = screen.getByRole("region", { name: `Top collections, ${label}` });
    expect(within(card).getByText(`No sales in the last ${words}.`)).toBeTruthy();
    expect(within(card).queryByRole("list")).toBeNull();
    expect(within(card).queryByRole("alert")).toBeNull();
  });

  it("says that sales had no price in the native currency, with the count the tile gives, and not that there was none", () => {
    const unrated = nftVolumeSample({ rows: [nftVolumeRowSample({ components: [], count: 3, total: "0" })], coverage: COMPLETE });
    mount(build({ live: fulfilled(unrated) }));
    const card = screen.getByRole("region", { name: "Top collections, 24 h" });
    expect(within(card).getByText("None of the 3 sales in the last 24 hours was priced in XRP or in a token with a daily XRP rate.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Totals" })).getByText("3")).toBeTruthy();
    expect(screen.queryByText(/No sales in the last/)).toBeNull();
  });

  it("says it for one sale in the singular, in the period's words and Xahau's currency", () => {
    const unrated = nftVolumeSample({ rows: [nftVolumeRowSample({ components: [], count: 1, total: "0" })], coverage: COMPLETE });
    mount(build({ net: XAHAU, query: { period: "30day", sort: "volume", order: "desc", back: [] }, live: fulfilled(unrated) }), "/xahau/nfts?period=30day", LAYOUT_XAHAU);
    expect(screen.getByText("The 1 sale in the last 30 days was not priced in XAH or in a token with a daily XAH rate.")).toBeTruthy();
  });
});

// ---- The recent sales -------------------------------------------------------------------------------------------------------------------------------

describe("NftsPage: the recent sales", () => {
  it("is a table of the columns of the board, XRPL's royalty header with its estimate", () => {
    mount(build());
    const card = screen.getByRole("region", { name: "Recent sales" });
    expect(within(card).getByText("/v2/nft_sales?descending=true")).toBeTruthy();
    const table = within(card).getByRole("table", { name: "Recent sales" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Time", "NFT", "Collection", "Price", "Seller →to buyer", "Sale", "Royalty, est."]);
    expect(rowsOf("Recent sales")).toHaveLength(2);
  });

  it("draws a sale: the time linking the transaction, the NFT and its short id, the collection, the price, the two accounts and the mode", () => {
    mount(build());
    const [first, second] = rowsOf("Recent sales");
    const cells = cellsOf(first!);
    // The UTC time links the transaction; the age is the browser's.
    expect(within(cells[0]!).getByRole("link").getAttribute("href")).toMatch(/^\/xrpl\/tx\/[0-9A-F]{64}$/);
    expect(cells[0]!.textContent).toContain("2026-10-24");
    expect(cells[0]!.textContent).toContain("16:08:12");
    // "#95,234,705" with the short id under it, the glyph hidden from assistive technology.
    expect(within(cells[1]!).getByRole("link").textContent).toBe("#95,234,705");
    expect(cells[1]!.textContent).toContain("00081388…2A91");
    expect(cells[1]!.querySelector(".nft-glyph")!.getAttribute("aria-hidden")).toBe("true");
    expect(within(cells[2]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/nfts/${NFT_ISSUER}/10`);
    expect(cells[3]!.textContent).toBe("1,250 XRP");
    expect(cells[5]!.textContent).toBe("direct");
    expect(cells[6]!.textContent).toBe("62.5 XRP");
    // The second is brokered, paid in a token, with its conversion under the price and its royalty in XRP.
    const other = cellsOf(second!);
    expect(other[3]!.textContent).toBe("420 SOLO≈ 96 XRP");
    expect(other[5]!.textContent).toBe("brokered");
    expect(other[6]!.textContent).toBe("1.097143 XRP");
  });

  it("puts the 'to' of seller → buyer in a visually hidden span between the two accounts, and the arrow out of the reading", () => {
    mount(build());
    const who = cellsOf(rowsOf("Recent sales")[0]!)[4]!;
    expect(within(who).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([`/xrpl/account/${SALES[0]!.seller}`, `/xrpl/account/${SALES[0]!.buyer}`]);
    expect(who.querySelector(".sr")!.textContent).toBe("to");
    expect(who.querySelector('[aria-hidden="true"]')!.textContent).toBe("→");
    expect(who.textContent).toBe(`${shortAddress(SALES[0]!.seller)}→to${shortAddress(SALES[0]!.buyer)}`);
    // The header reads the same way: "Seller to buyer", the arrow a picture.
    const header = within(screen.getByRole("table", { name: "Recent sales" })).getAllByRole("columnheader")[4]!;
    expect(header.querySelector(".sr")!.textContent).toBe("to");
    expect(header.querySelector('[aria-hidden="true"]')!.textContent).toBe("→");
  });

  it("is Xahau's: the URIToken column with the short id alone, a royalty that is always a dash, and the header's own word", () => {
    const uri = nftSaleSample({ nft_id: URI_TOKEN_ID, kind: "uritoken", issuer: URI_TOKEN_ISSUER, serial: undefined, taxon: undefined, currency: "XAH", amount: "520", converted_amount: "520", royalty_est: undefined });
    mount(build({ net: XAHAU, sales: fulfilled(nftSalesPageSample({ sales: [uri], coverage: COMPLETE })) }), "/xahau/nfts", LAYOUT_XAHAU);
    const table = screen.getByRole("table", { name: "Recent sales" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Time", "URIToken", "Collection", "Price", "Seller →to buyer", "Sale", "Royalty"]);
    const cells = cellsOf(rowsOf("Recent sales")[0]!);
    expect(within(cells[1]!).getByRole("link").textContent).toBe("96133366…AAE9");
    expect(within(cells[1]!).getByRole("link").getAttribute("href")).toBe(`/xahau/nft/${URI_TOKEN_ID}`);
    expect(within(cells[2]!).getByRole("link").getAttribute("href")).toBe(`/xahau/nfts/${URI_TOKEN_ISSUER}`);
    expect(cells[3]!.textContent).toBe("520 XAH");
    expect(cells[6]!.textContent).toBe("—");
  });

  it("says the board's note of the network under the table, with the way to the older sales", () => {
    mount(build());
    const card = screen.getByRole("region", { name: "Recent sales" });
    expect(within(card).getByText("A brokered sale matches a sell and a buy offer; the broker keeps the difference. Royalty is the issuer’s transfer fee on the price, when the issuer is neither side.")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Older sales" }).getAttribute("href")).toBe("/xrpl/nfts/sales?marker=WzEwNzg3ODc3NSwxMDQsMV0");
    cleanup();
    mount(build({ net: XAHAU }), "/xahau/nfts", LAYOUT_XAHAU);
    expect(within(screen.getByRole("region", { name: "Recent sales" })).getByText("A sale is a URITokenBuy of a token offered for sale. URITokens carry no transfer fee, so there is no royalty.")).toBeTruthy();
  });

  it("has no way to older sales without a marker, and says so in a table that is empty", () => {
    mount(build({ sales: fulfilled(nftSalesPageSample({ sales: [], count: 0, marker: undefined, coverage: COMPLETE })) }));
    const card = screen.getByRole("region", { name: "Recent sales" });
    expect(within(card).queryByRole("link", { name: "Older sales" })).toBeNull();
    expect(within(card).getByText("No sales in the index yet.")).toBeTruthy();
  });

  it("draws the failed card in its place, with the rest of the page standing", () => {
    mount(build({ sales: rejected(outage()) }));
    const card = screen.getByRole("region", { name: "Recent sales" });
    expect(within(card).getByRole("alert").textContent).toBe("Couldn’t load the recent sales.Retry");
    expect(within(card).queryByRole("table")).toBeNull();
    expect(screen.getByRole("table", { name: "Collections" })).toBeTruthy();
  });
});

// ---- The collections --------------------------------------------------------------------------------------------------------------------------------

describe("NftsPage: the collections", () => {
  it("is a table of the board's columns, with the collection linked by its issuer and the taxon under it", () => {
    mount(build());
    const card = screen.getByRole("region", { name: "Collections" });
    expect(within(card).getByText("/v2/nft_collections?sort=volume")).toBeTruthy();
    const table = within(card).getByRole("table", { name: "Collections" });
    expect(texts(within(table).getAllByRole("columnheader")).map((text) => text!.replace(/[↑↓]/, ""))).toEqual(["Collection", "Supply", "Holders", "Minted / burned", "Sales", "Volume (XRP)", "Last mint"]);
    const [first, second] = rowsOf("Collections");
    const cells = cellsOf(first!);
    expect(within(cells[0]!).getByRole("link").textContent).toBe("r4PP7g…CzT3");
    expect(within(cells[0]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/nfts/${NFT_ISSUER}/10`);
    expect(cells[0]!.textContent).toContain("taxon 10");
    expect(cells[0]!.querySelector(".nft-glyph")!.getAttribute("aria-hidden")).toBe("true");
    expect(texts(cells.slice(1))).toEqual(["10,000", "3,812", "10,000 / 0", "41,208", "18.4M XRP", "Oct 14, 2026"]);
    expect(cellsOf(second!)[6]!.textContent).toBe("—");
  });

  it("is Xahau's: every URIToken of the issuer under the link, and the native currency in the header", () => {
    mount(
      build({ net: XAHAU, collections: fulfilled(nftCollectionsPageSample({ total: 22, collections: [uriTokenCollectionSample()], coverage: COMPLETE })) }),
      "/xahau/nfts",
      LAYOUT_XAHAU,
    );
    const table = screen.getByRole("table", { name: "Collections" });
    expect(texts(within(table).getAllByRole("columnheader")).map((text) => text!.replace(/[↑↓]/, ""))[5]).toBe("Volume (XAH)");
    const cells = cellsOf(rowsOf("Collections")[0]!);
    expect(cells[0]!.textContent).toContain("every URIToken of this issuer");
    expect(within(cells[0]!).getByRole("link").getAttribute("href")).toBe(`/xahau/nfts/${URI_TOKEN_ISSUER}`);
  });

  it("marks the sort in aria-sort and an arrow, and makes each header a link that keeps the view: the current one flips the order", () => {
    mount(build());
    const headers = within(screen.getByRole("table", { name: "Collections" })).getAllByRole("columnheader");
    expect(headers.map((header) => header.getAttribute("aria-sort"))).toEqual([null, "none", "none", null, null, "descending", null]);
    const links = headers.flatMap((header) => within(header).queryAllByRole("link"));
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Supply", "/xrpl/nfts?sort=supply"],
      ["Holders", "/xrpl/nfts?sort=holders"],
      ["Volume (XRP)↓", "/xrpl/nfts?order=asc"],
    ]);
    cleanup();
    mount(build({ query: { period: "7day", issuer: NFT_ISSUER, sort: "supply", order: "asc", back: [] } }));
    const sorted = within(screen.getByRole("table", { name: "Collections" })).getAllByRole("columnheader");
    expect(sorted.map((header) => header.getAttribute("aria-sort"))).toEqual([null, "ascending", "none", null, null, "none", null]);
    expect(sorted.flatMap((header) => within(header).queryAllByRole("link")).map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Supply↑", `/xrpl/nfts?period=7day&issuer=${NFT_ISSUER}&sort=supply`],
      ["Holders", `/xrpl/nfts?period=7day&issuer=${NFT_ISSUER}&sort=holders`],
      ["Volume (XRP)", `/xrpl/nfts?period=7day&issuer=${NFT_ISSUER}`],
    ]);
  });

  it("is the board's note, in the network's words, with the way to more collections", () => {
    mount(build());
    const card = screen.getByRole("region", { name: "Collections" });
    expect(within(card).getByText("Collections are named by issuer and taxon: names and images live in each token’s metadata, which the explorer does not fetch. Volume and sales are all time; supply counts tokens not burned.")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "More collections" }).getAttribute("href")).toBe("/xrpl/nfts?marker=WzEwLCJyNFBQN2d3dVZmeHpMUFdGaUpYakxVdHZ6QTdGOTdDelQzIiwxMF0");
    expect(within(card).queryByRole("link", { name: "Newer" })).toBeNull();
    cleanup();
    mount(build({ net: XAHAU }), "/xahau/nfts", LAYOUT_XAHAU);
    expect(within(screen.getByRole("region", { name: "Collections" })).getByText(/^Collections are named by issuer: names and images live/)).toBeTruthy();
  });

  it("draws the failed card in its place, with the form standing", () => {
    mount(build({ collections: rejected(outage()) }));
    const card = screen.getByRole("region", { name: "Collections" });
    expect(within(card).getByRole("alert").textContent).toBe("Couldn’t load the collections.Retry");
    expect(within(card).queryByRole("table")).toBeNull();
    expect(within(card).getByLabelText("Collections of an issuer")).toBeTruthy();
  });

  it("says that an issuer has no collection in the index", () => {
    mount(build({ query: { period: "day", issuer: NFT_ISSUER, sort: "volume", order: "desc", back: [] }, collections: fulfilled(nftCollectionsPageSample({ collections: [], total: 0, count: 0, marker: undefined, coverage: COMPLETE })) }));
    expect(within(screen.getByRole("region", { name: "Collections" })).getByText(`No collection of ${NFT_ISSUER} in the index.`)).toBeTruthy();
  });
});

// ---- The issuer form ------------------------------------------------------------------------------------------------------------------------------

describe("NftsPage: the issuer form", () => {
  it("is a GET form to the list, with a labelled field, its placeholder and the button", () => {
    const { container } = mount(build());
    const form = container.querySelector("form")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["get", "/xrpl/nfts"]);
    const field = within(form).getByLabelText("Collections of an issuer") as HTMLInputElement;
    expect([field.name, field.placeholder, field.value]).toEqual(["issuer", "Issuer address (r…)", ""]);
    expect(field.hasAttribute("aria-invalid")).toBe(false);
    expect(field.hasAttribute("aria-describedby")).toBe(false);
    expect(within(form).getByRole("button", { name: "Show" }).getAttribute("type")).toBe("submit");
    expect(form.querySelectorAll('input[type="hidden"]')).toHaveLength(0);
  });

  it("keeps the period, the sort and the order in hidden fields, in the canonical order around the issuer, so that Show keeps the view", () => {
    const { container } = mount(build({ query: { period: "7day", issuer: NFT_ISSUER, sort: "supply", order: "asc", back: [] } }));
    const form = container.querySelector("form")!;
    expect([...form.querySelectorAll("input")].map((input) => [input.getAttribute("type"), input.name, input.getAttribute("value") ?? (input as HTMLInputElement).value])).toEqual([
      ["hidden", "period", "7day"],
      ["search", "issuer", NFT_ISSUER],
      ["hidden", "sort", "supply"],
      ["hidden", "order", "asc"],
    ]);
  });

  it("submits the issuer with the view as a client-side navigation to the canonical URL", async () => {
    const { router } = mount(build({ query: { period: "7day", sort: "holders", order: "desc", back: [] } }), "/xrpl/nfts?period=7day&sort=holders");
    fireEvent.change(screen.getByLabelText("Collections of an issuer"), { target: { value: NFT_ISSUER } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Show" })));
    expect(router.state.location.pathname + router.state.location.search).toBe(`/xrpl/nfts?period=7day&issuer=${NFT_ISSUER}&sort=holders`);
  });

  it("ties the error to the field, which is invalid, keeps what was typed, and draws no collections table", () => {
    mount(build({ query: { period: "day", issuer: "rNope", sort: "volume", order: "desc", back: [] }, issuerError: "Write a classic address (r…).", collections: null }));
    const field = screen.getByLabelText("Collections of an issuer") as HTMLInputElement;
    expect(field.value).toBe("rNope");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(field.getAttribute("aria-describedby")!)!.textContent).toBe("Write a classic address (r…).");
    expect(screen.queryByRole("table", { name: "Collections" })).toBeNull();
    // Nothing claims to have failed: no list was asked for.
    expect(screen.queryByText(/load the collections/)).toBeNull();
  });

  it("works without JavaScript: the Worker's HTML is a plain GET form with the named fields", () => {
    const html = renderToString(routed(build({ query: { period: "30day", issuer: NFT_ISSUER, sort: "volume", order: "asc", back: [] } })));
    const printed = document.createElement("div");
    printed.innerHTML = html;
    const form = printed.querySelector("form")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["get", "/xrpl/nfts"]);
    expect([...form.querySelectorAll("input")].map((input) => `${input.getAttribute("name")}=${input.getAttribute("value")}`)).toEqual(["period=30day", `issuer=${NFT_ISSUER}`, "order=asc"]);
    expect(form.querySelector('button[type="submit"]')!.textContent).toBe("Show");
  });
});

describe("NftsPage: the issuer form across client-side navigations", () => {
  const MESSAGE = "Write a classic address (r…).";
  /** What the list's loader makes of a URL, as far as the form goes: an issuer that is no address is the form's message, and no list is asked for. */
  const load = (url: URL): NftsPageData => {
    const query = parseNftsParams(url.searchParams);
    const bad = query.issuer !== undefined && query.issuer !== NFT_ISSUER && query.issuer !== OTHER_ISSUER;
    return build({ query, ...(bad ? { issuerError: MESSAGE, collections: null } : {}) });
  };
  const mountLoaded = (at: string) => mountLoadedPage((data: NftsPageData) => <NftsPage data={data} />, load, { at });
  const issuerField = () => screen.getByLabelText("Collections of an issuer") as HTMLInputElement;
  const at = (router: ReturnType<typeof mountLoaded>["router"]) => router.state.location.pathname + router.state.location.search;

  it("keeps the focus in the field after Show with an issuer that is no address, and says why in an alert tied to the field", async () => {
    const { router } = mountLoaded("/xrpl/nfts?period=7day");
    const field = issuerField();
    field.focus();
    fireEvent.change(field, { target: { value: "nope" } });
    // Enter in the field: the form's submit.
    await act(async () => void fireEvent.submit(field.form!));
    await waitFor(() => expect(at(router)).toBe("/xrpl/nfts?period=7day&issuer=nope"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(MESSAGE);
    // The same field, still focused, with what was typed: the form was not drawn anew.
    expect(issuerField()).toBe(field);
    expect(document.activeElement).toBe(field);
    expect([field.value, field.getAttribute("aria-invalid"), field.getAttribute("aria-describedby")]).toEqual(["nope", "true", alert.id]);
  });

  it("keeps the focus on Show when it was pressed, and tells a second address that is no address in a new alert", async () => {
    const { router } = mountLoaded("/xrpl/nfts");
    const show = screen.getByRole("button", { name: "Show" });
    fireEvent.change(issuerField(), { target: { value: "nope" } });
    show.focus();
    await act(async () => void fireEvent.click(show));
    await waitFor(() => expect(at(router)).toBe("/xrpl/nfts?issuer=nope"));
    const first = await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Show" })).toBe(show);
    expect(document.activeElement).toBe(show);

    fireEvent.change(issuerField(), { target: { value: "rNope" } });
    await act(async () => void fireEvent.click(show));
    await waitFor(() => expect(at(router)).toBe("/xrpl/nfts?issuer=rNope"));
    // The same words, in an alert of its own, which a screen reader reads again.
    const second = screen.getByRole("alert");
    expect(second.textContent).toBe(MESSAGE);
    expect(second).not.toBe(first);
    expect(issuerField().getAttribute("aria-describedby")).toBe(second.id);
    expect(document.activeElement).toBe(show);
  });

  it("puts the page's issuer back in the field when a link changes the view, but not into the field the visitor is in", async () => {
    const { router } = mountLoaded(`/xrpl/nfts?issuer=${NFT_ISSUER}`);
    const field = issuerField();
    expect(field.value).toBe(NFT_ISSUER);

    // Typed and not shown, then a sort header: the field says what the list is of.
    fireEvent.change(field, { target: { value: "rTyped" } });
    await act(async () => void fireEvent.click(within(screen.getByRole("columnheader", { name: /^Supply/ })).getByRole("link")));
    await waitFor(() => expect(at(router)).toBe(`/xrpl/nfts?issuer=${NFT_ISSUER}&sort=supply`));
    expect(issuerField()).toBe(field);
    expect(field.value).toBe(NFT_ISSUER);

    // A link to the list of every collection (the header's NFTs, Back): the field is emptied.
    await act(async () => void (await router.navigate("/xrpl/nfts")));
    expect(field.value).toBe("");

    // While the visitor types in it, a new view leaves the field alone.
    field.focus();
    fireEvent.change(field, { target: { value: "rTyp" } });
    await act(async () => void (await router.navigate("/xrpl/nfts?period=30day")));
    expect([field.value, document.activeElement === field]).toEqual(["rTyp", true]);
  });
});

// ---- Coverage notes -------------------------------------------------------------------------------------------------------------------------------

describe("NftsPage: the coverage notes", () => {
  it("has none when every call's coverage is complete", () => {
    mount(build());
    expect(screen.queryAllByRole("note")).toHaveLength(0);
  });

  it("puts a note under the chart, the top collections, the recent sales and the collections, each from its own call", () => {
    const partial = (from: number) => coverageSample({ complete: false, from_ledger_index: from });
    mount(
      build({
        live: fulfilled(nftVolumeSample({ rows: [liveRow()], coverage: partial(1001) })),
        daily: fulfilled(daily(undefined, partial(1002))),
        sales: fulfilled(nftSalesPageSample({ sales: SALES, coverage: partial(1003) })),
        collections: fulfilled(nftCollectionsPageSample({ collections: [collectionSample()], coverage: partial(1004) })),
      }),
    );
    const notes = screen.getAllByRole("note");
    expect(notes.map((note) => note.textContent)).toEqual([
      "Covers ledger #1,002 onwards: earlier NFT sales are not in the index yet.",
      "Covers ledger #1,001 onwards: earlier NFT sales are not in the index yet.",
      "Covers ledger #1,003 onwards: earlier NFT sales are not in the index yet.",
      "Covers ledger #1,004 onwards: earlier collections are not in the index yet.",
    ]);
    // Each is directly under its own card: the chart's, the top list's, the sales' and the collections'.
    expect(screen.getByRole("region", { name: "Sales volume per day, in XRP, last 30 days" }).parentElement!.contains(notes[0]!)).toBe(true);
    expect(screen.getByRole("region", { name: "Top collections, 24 h" }).parentElement!.contains(notes[1]!)).toBe(true);
    expect(screen.getByRole("region", { name: "Recent sales" }).contains(notes[2]!)).toBe(true);
    expect(screen.getByRole("region", { name: "Collections" }).contains(notes[3]!)).toBe(true);
    // The ledger is a link to its page.
    expect(within(notes[3]!).getByRole("link", { name: "#1,004" }).getAttribute("href")).toBe("/xrpl/ledger/1004");
  });

  it("says URITokens on Xahau", () => {
    mount(build({ net: XAHAU, sales: fulfilled(nftSalesPageSample({ sales: SALES, coverage: coverageSample({ complete: false, from_ledger_index: 26533927 }) })) }), "/xahau/nfts", LAYOUT_XAHAU);
    expect(screen.getAllByRole("note").map((note) => note.textContent)).toEqual(["Covers ledger #26,533,927 onwards: earlier URIToken sales are not in the index yet."]);
  });
});

// ---- A page behind a marker -----------------------------------------------------------------------------------------------------------------------

describe("NftsPage: a page behind a marker", () => {
  const marker = (query = { period: "day" as const, sort: "volume" as const, order: "desc" as const, marker: "M1", back: ["M0"] }) =>
    nftsMarkerPage(XRPL, query, nftCollectionsPageSample({ total: 38511, collections: [collectionSample(), collectionSample({ issuer: OTHER_ISSUER, taxon: 0 })], coverage: coverageSample({ complete: false, from_ledger_index: 777 }) }));

  it("is the collections table alone, titled More NFT collections, with Newer and More collections", () => {
    mount(marker(), "/xrpl/nfts?marker=M1&back=M0");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("More NFT collections");
    expect(screen.queryByRole("group", { name: "Period" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Totals" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Recent sales" })).toBeNull();
    expect(screen.queryByRole("region", { name: /Sales volume per day/ })).toBeNull();
    expect(screen.queryByRole("region", { name: /Top collections/ })).toBeNull();
    expect(rowsOf("Collections")).toHaveLength(2);
    const card = screen.getByRole("region", { name: "Collections" });
    expect(within(card).getByRole("link", { name: "Newer" }).getAttribute("href")).toBe("/xrpl/nfts?marker=M0");
    expect(within(card).getByRole("link", { name: "More collections" }).getAttribute("href")).toContain("/xrpl/nfts?marker=");
    expect(within(card).getByRole("note").textContent).toBe("Covers ledger #777 onwards: earlier collections are not in the index yet.");
    expect(within(card).getByLabelText("Collections of an issuer")).toBeTruthy();
  });

  it("says URITokens on Xahau", () => {
    mount(nftsMarkerPage(XAHAU, { period: "day", sort: "volume", order: "desc", marker: "M1", back: [] }, nftCollectionsPageSample({ collections: [uriTokenCollectionSample()] })), "/xahau/nfts?marker=M1", LAYOUT_XAHAU);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("More URIToken collections");
  });
});

// ---- The server and the browser ----------------------------------------------------------------------------------------------------------------------

describe("NftsPage: hydration", () => {
  it("is the same on the server as in the browser: the first page", async () => {
    const { html, errors } = await serverThenHydrated(routed(build({ sales: fulfilled(nftSalesPageSample({ sales: SALES, coverage: coverageSample({ complete: false }) })) })));
    expect(html).toContain("NFTs");
    expect(errors).toEqual([]);
  });

  it("is the same on the server as in the browser: failures, the unrated top, Xahau, and a page behind a marker", async () => {
    for (const data of [
      build({ live: rejected(outage()), daily: rejected(outage()), sales: rejected(outage()), collections: rejected(outage()) }),
      build({ live: fulfilled(nftVolumeSample({ rows: [nftVolumeRowSample({ components: [], count: 3, total: "0" })], coverage: COMPLETE })) }),
      build({ net: XAHAU }),
      nftsMarkerPage(XRPL, { period: "day", sort: "volume", order: "desc", marker: "M1", back: [] }, nftCollectionsPageSample()),
      build({ query: { period: "day", issuer: "rNope", sort: "volume", order: "desc", back: [] }, issuerError: "Write a classic address (r…).", collections: null }),
    ]) {
      const { errors } = await serverThenHydrated(routed(data, "/xrpl/nfts", data.heading === "URITokens" ? LAYOUT_XAHAU : LAYOUT_XRPL));
      expect(errors).toEqual([]);
    }
  });
});
