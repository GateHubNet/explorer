import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectionDaySample,
  collectionSample,
  coverageSample,
  holderSample,
  nftCollectionAnswerSample,
  nftSalesPageSample,
  nftSaleSample,
  nftSample,
  nftsPageSample,
  nftHoldersPageSample,
  NFT_ISSUER,
  NFT_OWNER,
  URI_TOKEN_ID,
  URI_TOKEN_ISSUER,
  uriTokenCollectionSample,
  uriTokenSample,
} from "../../../test/support/nft-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import { LAYOUT_XAHAU, LAYOUT_XRPL, LAYOUT_XRPL_TESTNET, mountLoadedPage, mountPage, routedPage } from "../../../test/support/under-network";
import { NO_NAMES } from "../../domain/names";
import { parseCollectionParams, type CollectionKey, type CollectionQuery } from "../../domain/nft-params";
import type { LastValidated, NftCollectionDay, NftCollectionDays } from "../../server/api-types";
import { collectionMarkerPage, nftCollectionPage, type CollectionList, type CollectionNet, type NftCollectionPageData, type NftCollectionPageInput } from "../../server/nft-collection-view";
import { UpstreamError } from "../../server/upstream";
import { windowOf } from "../../domain/window";
import { NftCollectionPage } from "./NftCollectionPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---- The world of the tests: T is Oct 17, the running day ---------------------------------------------------------------------------------------

const XRPL: CollectionNet = { id: "xrpl", name: "XRPL", native: "XRP", longName: "the XRP Ledger" };
const XAHAU: CollectionNet = { id: "xahau", name: "Xahau", native: "XAH", longName: "Xahau" };

const KEY: CollectionKey = { issuer: NFT_ISSUER, taxon: 10 };
const URI_KEY: CollectionKey = { issuer: URI_TOKEN_ISSUER };
const PATH = `/xrpl/nfts/${NFT_ISSUER}/10`;
const URI_PATH = `/xahau/nfts/${URI_TOKEN_ISSUER}`;

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
const WHOLE = coverageSample({ complete: true });
const HASH_A = "3D9B20E130D7498E98FB3499BD4C2AC4CCDB3D11FFBFEA8F9B7FB844DDF33426";
const HASH_B = "BADF36AA20CD32067693C83EE5755BEFB8D1A1E82DEE83E1E67FFD6100712E56";
const MARKERS = { M1: "WzEwNzg4NjE2Myw4MywxXQ", M2: "WzEwNzg4MTUzMCwxNjIsMV0" };
const OTHER_OWNER = "rhv9jFwfWfH4Cd1uX4b3ACkdgDKASFz7Dz";

const QUERY: CollectionQuery = { measure: "volume", tab: "sales", burned: false, back: [] };

/** A day of the stats, with a sale or two. */
const dayOf = (bucket: string, over: Partial<NftCollectionDay> = {}): NftCollectionDay => collectionDaySample({ date: `${bucket}T00:00:00Z`, ...over });
const daysOf = (days: NftCollectionDay[], coverage = WHOLE): NftCollectionDays => ({ coverage, count: days.length, days });
/** Six days of the window with sales, the running one among them. */
const DAYS = [
  dayOf("2026-10-17", { sales_count: 2, volume_native: "300", avg_price_native: "150", min_price_native: "100", mints: 1 }),
  dayOf("2026-10-14", { sales_count: 3, volume_native: "300", avg_price_native: "100", min_price_native: "60" }),
  dayOf("2026-10-10", { sales_count: 1, volume_native: "60", avg_price_native: "60", min_price_native: "60" }),
];

const COLLECTION = collectionSample({
  supply: 10000,
  holders: 3412,
  minted: 10000,
  burned: 0,
  sales_count: 412,
  volume_native: "181234.5",
  first_mint: { ledger_index: 26689211, tx_hash: HASH_A, executed_time: "2026-03-14T09:00:00Z" },
  last_mint: { ledger_index: 26771798, tx_hash: HASH_B, executed_time: "2026-10-14T18:42:07Z" },
});

const SALES = [
  nftSaleSample({ amount: "1250", converted_amount: "1250", royalty_est: "62.5" }),
  nftSaleSample({ event_index: 2, tx_hash: "D".repeat(64), serial: 7, amount: "420", currency: "SOLO", amount_issuer: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz", converted_amount: "96", royalty_est: "4.8", mode: "brokered" }),
];

const NFT_ID_2 = "00080BB84F44098667FBB6C8E7F589183B68708A94C05FC90E5F0FC605E9EB2B";
const NFTS = [
  nftSample({ sale_count: 3, last_sale: { amount: "1250", currency: "XRP", converted_amount: "1250", ledger_index: 1, tx_hash: HASH_A, executed_time: "2026-10-14T09:00:00Z" }, minted: { ledger_index: 1, tx_hash: HASH_A, executed_time: "2026-03-14T09:00:00Z", by: NFT_ISSUER, to: NFT_OWNER } }),
  nftSample({ nft_id: NFT_ID_2, serial: 12, owner: undefined, burned: true, flags: 9, transfer_fee: 0, sale_count: 0, last_sale: undefined }),
  nftSample({ nft_id: "0008138800000000000000000000000000000000000000000000000000000003", serial: 3, owner: OTHER_OWNER, flags: 0, transfer_fee: undefined, sale_count: 1, last_sale: undefined }),
];

/** The page as the loader reads it: every call answered, the Sales tab, complete coverage. */
function pageInput(over: Partial<NftCollectionPageInput> = {}): NftCollectionPageInput {
  return {
    net: XRPL,
    key: KEY,
    query: QUERY,
    collection: nftCollectionAnswerSample({ collection: COLLECTION, coverage: WHOLE }),
    last: fulfilled(LAST),
    stats: fulfilled(daysOf(DAYS)),
    list: fulfilled(nftSalesPageSample({ sales: SALES, coverage: WHOLE })),
    ...over,
  };
}

const build = (over: Partial<NftCollectionPageInput> = {}): NftCollectionPageData => ({ ...nftCollectionPage(pageInput(over)), names: NO_NAMES });
const nftsTab = (query: Partial<CollectionQuery> = {}, over: Partial<NftCollectionPageInput> = {}) =>
  build({ query: { ...QUERY, tab: "nfts", ...query }, list: fulfilled(nftsPageSample({ nfts: NFTS, coverage: WHOLE })), ...over });
const holdersTab = (over: Partial<NftCollectionPageInput> = {}) =>
  build({ query: { ...QUERY, tab: "holders" }, list: fulfilled(nftHoldersPageSample({ holders: [holderSample({ owner: NFT_OWNER, held: 4380 }), holderSample({ owner: OTHER_OWNER, held: 3 })], coverage: WHOLE })), ...over });
const uriBuild = (over: Partial<NftCollectionPageInput> = {}): NftCollectionPageData => ({
  ...nftCollectionPage({
    ...pageInput(),
    net: XAHAU,
    key: URI_KEY,
    collection: nftCollectionAnswerSample({ collection: uriTokenCollectionSample(), coverage: coverageSample({ complete: false, from_ledger_index: 26533927 }) }),
    list: fulfilled(nftSalesPageSample({ sales: [], count: 0, coverage: coverageSample({ complete: false, from_ledger_index: 26533927 }) })),
    ...over,
  }),
  names: NO_NAMES,
});
const marker = (over: Partial<Parameters<typeof collectionMarkerPage>[0]> = {}): NftCollectionPageData => ({
  ...collectionMarkerPage({
    net: XRPL,
    key: KEY,
    query: { ...QUERY, marker: MARKERS.M2, back: [MARKERS.M1] },
    collection: nftCollectionAnswerSample({ collection: COLLECTION, coverage: WHOLE }),
    list: fulfilled(nftSalesPageSample({ sales: SALES, coverage: WHOLE }) satisfies CollectionList),
    ...over,
  }),
  names: NO_NAMES,
});

/** The page in a data router at its own URL, drawn in the browser. `loader` counts the revalidations a Retry asks for. */
const mount = (data: NftCollectionPageData, at = PATH, network = LAYOUT_XRPL) => mountPage(<NftCollectionPage data={data} />, "collection", { at, network });
const routed = (data: NftCollectionPageData, at = PATH, network = LAYOUT_XRPL) => routedPage(<NftCollectionPage data={data} />, { at, network });

const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);
const headersOf = (name: string) => texts(within(screen.getByRole("table", { name })).getAllByRole("columnheader"));
const rowsOf = (name: string) => within(screen.getByRole("table", { name })).getAllByRole("row").slice(1);
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell");
const tiles = () => [...screen.getByRole("region", { name: "Figures" }).querySelectorAll(".stat")].map((tile) => [...tile.children].map((part) => part.textContent));

// ---- The header ------------------------------------------------------------------------------------------------------------------------------------------

describe("NftCollectionPage: the breadcrumb and the header card", () => {
  it("has the breadcrumb of the network, the NFTs and the collection, the h1, the kind's tag and the facts", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getAllByRole("listitem").map((item) => item.textContent?.replace("/", ""))).toEqual(["XRPL", "NFTs", "r4PP7g…CzT3 · taxon 10"]);
    expect(crumbs.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["XRPL", "/xrpl"],
      ["NFTs", "/xrpl/nfts"],
    ]);
    expect(crumbs.getByText("r4PP7g…CzT3 · taxon 10").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Collection r4PP7g…CzT3 · taxon 10");
    const card = screen.getByRole("region", { name: "Collection" });
    expect(within(card).getByText("NFToken collection").className).toContain("tag");
    // the glyph is a picture
    expect(card.querySelector(".nft-glyph")!.getAttribute("aria-hidden")).toBe("true");
    expect(card.querySelector(".nft-glyph")!.textContent).toBe("4P");
    expect(card.querySelector(".nft-glyph--large")).not.toBeNull();
  });

  it("gives the issuer in full as a link with a copy button, the taxon, and the dates of the first and last mint as links to their transactions", () => {
    mount(build());
    const card = screen.getByRole("region", { name: "Collection" });
    const issuer = within(card).getByRole("link", { name: NFT_ISSUER });
    expect(issuer.getAttribute("href")).toBe(`/xrpl/account/${NFT_ISSUER}`);
    expect(within(card).getByRole("button", { name: "Copy issuer" })).toBeTruthy();
    expect(card.textContent).toContain("Taxon 10");
    expect(within(card).getByRole("link", { name: "Mar 14, 2026" }).getAttribute("href")).toBe(`/xrpl/tx/${HASH_A}`);
    expect(within(card).getByRole("link", { name: "Oct 14, 2026" }).getAttribute("href")).toBe(`/xrpl/tx/${HASH_B}`);
    expect(card.textContent).toContain("First mint Mar 14, 2026 · last mint Oct 14, 2026");
  });

  it("leaves out the part of the mint line that the collection lacks", () => {
    const only = { ledger_index: 1, tx_hash: HASH_A, executed_time: "2026-03-14T09:00:00Z" };
    mount(build({ collection: nftCollectionAnswerSample({ collection: collectionSample({ last_mint: only }), coverage: WHOLE }) }));
    expect(screen.getByRole("region", { name: "Collection" }).textContent).toContain("Last mint Mar 14, 2026");
    expect(screen.getByRole("region", { name: "Collection" }).textContent).not.toContain("First mint");
    cleanup();
    mount(build({ collection: nftCollectionAnswerSample({ collection: collectionSample({ first_mint: only }), coverage: WHOLE }) }));
    expect(screen.getByRole("region", { name: "Collection" }).textContent).toContain("First mint Mar 14, 2026");
    expect(screen.getByRole("region", { name: "Collection" }).textContent).not.toMatch(/last mint/i);
    cleanup();
    mount(build({ collection: nftCollectionAnswerSample({ collection: collectionSample(), coverage: WHOLE }) }));
    expect(screen.getByRole("region", { name: "Collection" }).textContent).not.toMatch(/mint/i);
  });

  it("is Xahau's: URITokens of the issuer, no taxon, the URIToken tag", () => {
    mount(uriBuild(), URI_PATH, LAYOUT_XAHAU);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("URITokens of rodinG…zKyb");
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByRole("listitem").map((item) => item.textContent?.replace("/", ""))).toEqual(["Xahau", "URITokens", "rodinG…zKyb"]);
    const card = screen.getByRole("region", { name: "Collection" });
    expect(within(card).getByText("URIToken collection")).toBeTruthy();
    expect(card.textContent).not.toContain("Taxon");
    expect(within(card).getByRole("link", { name: URI_TOKEN_ISSUER }).getAttribute("href")).toBe(`/xahau/account/${URI_TOKEN_ISSUER}`);
  });

  it("names the network of the sandbox in its breadcrumb", () => {
    mount(build({ net: { ...XRPL, name: "XRPL Testnet", longName: "XRPL Testnet" } }), PATH, LAYOUT_XRPL_TESTNET);
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "XRPL Testnet" }).getAttribute("href")).toBe("/xrpl");
  });
});

// ---- The six stats ---------------------------------------------------------------------------------------------------------------------------------------

describe("NftCollectionPage: the six stats", () => {
  it("draws the six figures under their labels, each with its note", () => {
    mount(build());
    expect(tiles()).toEqual([
      ["Supply", "10,000", "10,000 minted · 0 burned"],
      ["Holders", "3,412", "accounts holding one or more"],
      ["Sales", "412", "all time"],
      ["Volume", "181K XRP", "all time, at daily rates"],
      ["Average sale, 30 days", "110 XRP", "6 sales"],
      ["Lowest sale, 30 days", "60 XRP", "a sale, not an open offer"],
    ]);
    expect(screen.getByRole("region", { name: "Figures" }).querySelectorAll(".stat--figure")).toHaveLength(6);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says where the collection's own history starts under the six stats, when the index does not hold it all, and nothing when it does", () => {
    mount(build({ collection: nftCollectionAnswerSample({ collection: COLLECTION, coverage: coverageSample({ complete: false, from_ledger_index: 32570 }) }) }));
    const figures = screen.getByRole("region", { name: "Figures" });
    const notes = screen.getAllByRole("note");
    expect(notes.map((note) => note.textContent)).toEqual(["Covers ledger #32,570 onwards: earlier NFT sales are not in the index yet."]);
    // Under the stats, before the measures and the chart.
    expect(figures.parentElement!.contains(notes[0]!)).toBe(true);
    expect(figures.compareDocumentPosition(notes[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notes[0]!.compareDocumentPosition(screen.getByRole("group", { name: "Measure" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(notes[0]!).getByRole("link", { name: "#32,570" }).getAttribute("href")).toBe("/xrpl/ledger/32570");
    cleanup();
    mount(build());
    expect(screen.queryAllByRole("note")).toHaveLength(0);
    cleanup();
    // Xahau's words: the stats, the chart and the list each say theirs.
    mount(uriBuild(), URI_PATH, LAYOUT_XAHAU);
    const xahau = screen.getAllByRole("note");
    expect(xahau.map((note) => note.textContent)).toEqual(Array(2).fill("Covers ledger #26,533,927 onwards: earlier URIToken sales are not in the index yet."));
    expect(screen.getByRole("region", { name: "Figures" }).parentElement!.contains(xahau[0]!)).toBe(true);
  });

  it("says 'about' when the day's count of rated sales is a rounding", () => {
    const dust = [
      dayOf("2026-10-14", { sales_count: 10, volume_native: "0.000016", avg_price_native: "0.000002", min_price_native: "0.000001" }),
      dayOf("2026-10-15", { sales_count: 1, volume_native: "1000", avg_price_native: "1000", min_price_native: "1000" }),
    ];
    mount(build({ stats: fulfilled(daysOf(dust)) }));
    expect(tiles()[4]![2]).toBe("about 9 sales");
  });

  it("writes dashes for a collection that had no sale in 30 days, and Xahau's currency", () => {
    mount(uriBuild({ stats: fulfilled(daysOf([])) }), URI_PATH, LAYOUT_XAHAU);
    expect(tiles().slice(4)).toEqual([
      ["Average sale, 30 days", "—", "no sale in 30 days"],
      ["Lowest sale, 30 days", "—", "a sale, not an open offer"],
    ]);
    expect(tiles()[3]![1]).toMatch(/ XAH$/);
  });

  it("draws dashes in the 30-day tiles, with the chart's one SectionError, when the daily figures failed; the other four stay", () => {
    const { loader } = mount(build({ stats: rejected(outage()) }));
    expect(tiles().map((tile) => tile[1])).toEqual(["10,000", "3,412", "412", "181K XRP", "—", "—"]);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual(["Couldn’t load the daily figures.Retry"]);
    expect(within(screen.getByRole("region", { name: "Sales volume per day, in XRP, last 30 days" })).getByRole("alert")).toBe(alerts[0]);
    fireEvent.click(within(alerts[0]!).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
  });
});

// ---- The chart -------------------------------------------------------------------------------------------------------------------------------------------

describe("NftCollectionPage: the chart of the 30 days", () => {
  it("is a card titled with the unit, with its source, a column for each of the 30 days, the table view in the page and the note", () => {
    mount(build());
    const card = screen.getByRole("region", { name: "Sales volume per day, in XRP, last 30 days" });
    expect(within(card).getByText(`/v2/nft_collections/${NFT_ISSUER}/10/stats`)).toBeTruthy();
    expect(card.querySelectorAll(".col")).toHaveLength(30);
    const table = within(card).getByRole("table", { name: "Sales volume per day, in XRP, last 30 days" });
    expect(within(table).getAllByRole("row")).toHaveLength(31);
    expect(within(card).getByRole("radio", { name: "Table" })).toBeTruthy();
    // the extras of the tooltip and the table: the measure's own left out
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Day (UTC)", "Volume", "Sales", "Average", "Lowest", "Minted"]);
    // the running day is marked so far
    expect(texts(within(table).getAllByRole("row")[1]!.children)[0]).toBe("Oct 17, 2026, so far");
    expect(within(card).getByText("One bar a UTC day. A day with no sale has no average or lowest price.")).toBeTruthy();
  });

  it("has the four measures as links that keep the tab and its filters, the current one marked", () => {
    mount(build({ query: { ...QUERY, measure: "avg", tab: "nfts", owner: NFT_OWNER, burned: true } , list: fulfilled(nftsPageSample({ nfts: NFTS, coverage: WHOLE })) }), `${PATH}?measure=avg&tab=nfts`);
    const group = screen.getByRole("group", { name: "Measure" });
    expect(within(group).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["Volume", `${PATH}?tab=nfts&owner=${NFT_OWNER}&burned=1`, null],
      ["Sales", `${PATH}?measure=sales&tab=nfts&owner=${NFT_OWNER}&burned=1`, null],
      ["Average price", `${PATH}?measure=avg&tab=nfts&owner=${NFT_OWNER}&burned=1`, "true"],
      ["Lowest price", `${PATH}?measure=low&tab=nfts&owner=${NFT_OWNER}&burned=1`, null],
    ]);
  });

  it.each([
    ["volume", "Sales volume per day, in XRP, last 30 days"],
    ["sales", "Sales per day, last 30 days"],
    ["avg", "Average sale price per day, in XRP, last 30 days"],
    ["low", "Lowest sale price per day, in XRP, last 30 days"],
  ] as const)("is titled for the %s measure, and the failed card is titled the same", (measure, title) => {
    mount(build({ query: { ...QUERY, measure } }));
    expect(screen.getByRole("region", { name: title })).toBeTruthy();
    expect(screen.getByRole("region", { name: title }).querySelectorAll(".col")).toHaveLength(30);
    cleanup();
    mount(build({ query: { ...QUERY, measure }, stats: rejected(outage()) }));
    const card = screen.getByRole("region", { name: title });
    expect(within(card).getByText(`/v2/nft_collections/${NFT_ISSUER}/10/stats`)).toBeTruthy();
    expect(within(card).getByRole("alert").textContent).toBe("Couldn’t load the daily figures.Retry");
    expect(card.querySelectorAll(".col")).toHaveLength(0);
  });

  it("is told as failed, titled for the measure, when the newest ledger failed, with the measure links in place", () => {
    mount(build({ last: rejected(outage()), stats: null, query: { ...QUERY, measure: "low" } }));
    const card = screen.getByRole("region", { name: "Lowest sale price per day, in XRP, last 30 days" });
    expect(within(card).getByRole("alert").textContent).toBe("Couldn’t load the daily figures.Retry");
    expect(within(screen.getByRole("group", { name: "Measure" })).getAllByRole("link")).toHaveLength(4);
  });

  it("says Xahau's unit and source in the card", () => {
    mount(uriBuild(), URI_PATH, LAYOUT_XAHAU);
    const card = screen.getByRole("region", { name: "Sales volume per day, in XAH, last 30 days" });
    expect(within(card).getByText(`/v2/nft_collections/${URI_TOKEN_ISSUER}/stats`)).toBeTruthy();
  });

  it("says where the history of the sales starts under the card, when the index does not hold it all", () => {
    mount(build({ stats: fulfilled(daysOf(DAYS, coverageSample({ complete: false, from_ledger_index: 32570 }))) }));
    const note = screen.getAllByRole("note").find((candidate) => candidate.textContent?.includes("NFT sales"))!;
    expect(note.textContent).toBe("Covers ledger #32,570 onwards: earlier NFT sales are not in the index yet.");
    expect(within(note).getByRole("link").getAttribute("href")).toBe("/xrpl/ledger/32570");
  });
});

// ---- The tabs --------------------------------------------------------------------------------------------------------------------------------------------

describe("NftCollectionPage: the tabs", () => {
  it("has three links, each the tab's first page keeping the measure, the current one aria-current", () => {
    mount(build({ query: { ...QUERY, measure: "sales", tab: "holders" }, list: fulfilled(nftHoldersPageSample({ coverage: WHOLE })) }), `${PATH}?measure=sales&tab=holders`);
    const tabs = within(screen.getByRole("navigation", { name: "Collection lists" }));
    expect(tabs.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["Sales", `${PATH}?measure=sales`, null],
      ["NFTs", `${PATH}?measure=sales&tab=nfts`, null],
      ["Holders", `${PATH}?measure=sales&tab=holders`, "page"],
    ]);
  });

  it("says URITokens on Xahau", () => {
    mount(uriBuild(), URI_PATH, LAYOUT_XAHAU);
    expect(within(screen.getByRole("navigation", { name: "Collection lists" })).getAllByRole("link").map((link) => link.textContent)).toEqual(["Sales", "URITokens", "Holders"]);
  });

  it("keeps the tabs as links, and tells the failure in place of the list, when the tab's call failed", () => {
    const { loader } = mount(build({ list: rejected(outage()) }));
    expect(within(screen.getByRole("navigation", { name: "Collection lists" })).getAllByRole("link")).toHaveLength(3);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual(["Couldn’t load the sales.Retry"]);
    expect(screen.queryByRole("table", { name: "Sales" })).toBeNull();
    fireEvent.click(within(alerts[0]!).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
    // the rest of the page is drawn
    expect(screen.getByRole("region", { name: "Sales volume per day, in XRP, last 30 days" }).querySelectorAll(".col")).toHaveLength(30);
  });

  it.each([
    ["sales", "the sales"],
    ["nfts", "the NFTs"],
    ["holders", "the holders"],
  ] as const)("tells the %s tab given another tab's page as failed, not as an empty list", (tab, what) => {
    const wrong = tab === "sales" ? nftsPageSample({ coverage: WHOLE }) : nftSalesPageSample({ coverage: WHOLE });
    mount(build({ query: { ...QUERY, tab }, list: fulfilled(wrong) }));
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([`Couldn’t load ${what}.Retry`]);
    expect(screen.queryByText(/is in the index/)).toBeNull();
  });

  it("says the board's note of the network under the tabs, with the list's coverage", () => {
    mount(build({ list: fulfilled(nftSalesPageSample({ sales: SALES, coverage: coverageSample({ complete: false, from_ledger_index: 32570 }) })) }));
    const card = screen.getByRole("region", { name: "Collection lists" });
    expect(within(card).getByText("A collection is every NFT of one issuer and one taxon. Names and images live in each NFT’s metadata, which the explorer does not fetch, so tokens are shown by serial and id.")).toBeTruthy();
    expect(within(card).getByRole("note").textContent).toBe("Covers ledger #32,570 onwards: earlier NFT sales are not in the index yet.");
  });

  it("says Xahau's note, in URIToken words", () => {
    mount(uriBuild(), URI_PATH, LAYOUT_XAHAU);
    const card = screen.getByRole("region", { name: "Collection lists" });
    expect(within(card).getByText("A collection is every URIToken of one issuer. Names and images live in each URIToken’s metadata, which the explorer does not fetch, so tokens are shown by id.")).toBeTruthy();
    expect(within(card).getByRole("note").textContent).toBe("Covers ledger #26,533,927 onwards: earlier URIToken sales are not in the index yet.");
  });
});

// ---- The Sales tab ---------------------------------------------------------------------------------------------------------------------------------------

describe("NftCollectionPage: the Sales tab", () => {
  it("is the sales table without the collection's own column, the rows as the list draws them", () => {
    mount(build());
    expect(headersOf("Sales")).toEqual(["Time", "NFT", "Price", "Seller →to buyer", "Sale", "Royalty, est."]);
    const [first, second] = rowsOf("Sales");
    const cells = cellsOf(first!);
    expect(within(cells[0]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/tx/${SALES[0]!.tx_hash}`);
    expect(within(cells[1]!).getByRole("link").textContent).toBe("#95,234,705");
    expect(cells[2]!.textContent).toBe("1,250 XRP");
    expect(cells[3]!.querySelector(".sr")!.textContent).toBe("to");
    expect(cells[4]!.textContent).toBe("direct");
    expect(cells[5]!.textContent).toBe("62.5 XRP");
    expect(cellsOf(second!)[2]!.textContent).toContain("≈ 96 XRP");
    // the source line of the list is the tab's call
    expect(within(screen.getByRole("region", { name: "Collection lists" })).getByText(`/v2/nft_collections/${NFT_ISSUER}/10/sales`)).toBeTruthy();
  });

  it("says that the collection has no sale in the index", () => {
    mount(build({ list: fulfilled(nftSalesPageSample({ sales: [], count: 0, marker: undefined, coverage: WHOLE })) }));
    expect(within(screen.getByRole("region", { name: "Collection lists" })).getByText("No sale of this collection is in the index.")).toBeTruthy();
  });

  it("is Xahau's: the URIToken column and a royalty that is a dash", () => {
    const uri = nftSaleSample({ nft_id: URI_TOKEN_ID, kind: "uritoken", issuer: URI_TOKEN_ISSUER, serial: undefined, taxon: undefined, currency: "XAH", amount: "520", converted_amount: "520", royalty_est: undefined });
    mount(uriBuild({ list: fulfilled(nftSalesPageSample({ sales: [uri], coverage: WHOLE })) }), URI_PATH, LAYOUT_XAHAU);
    expect(headersOf("Sales")).toEqual(["Time", "URIToken", "Price", "Seller →to buyer", "Sale", "Royalty"]);
    expect(cellsOf(rowsOf("Sales")[0]!)[5]!.textContent).toBe("—");
  });
});

// ---- The NFTs tab ----------------------------------------------------------------------------------------------------------------------------------------

describe("NftCollectionPage: the NFTs tab", () => {
  it("is the table of the NFTs: the serial and the short id, the owner or a burned tag, the sales, the last sale, the flags and the day of the mint", () => {
    mount(nftsTab(), `${PATH}?tab=nfts`);
    expect(headersOf("NFTs")).toEqual(["NFT", "Owner", "Sales", "Last sale", "Flags", "Minted"]);
    const [live, burned, plain] = rowsOf("NFTs");
    const first = cellsOf(live!);
    expect(within(first[0]!).getByRole("link").textContent).toBe("#95,234,705");
    expect(first[0]!.textContent).toContain("00081388…2A91");
    expect(within(first[1]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${NFT_OWNER}`);
    expect(first[2]!.textContent).toBe("3");
    expect(first[3]!.textContent).toBe("1,250 XRP");
    expect(texts(first[4]!.querySelectorAll(".tag"))).toEqual(["transferable", "5% fee"]);
    expect(first[5]!.textContent).toBe("Mar 14, 2026");
    // burned: a tag in place of the owner, and no last sale
    const second = cellsOf(burned!);
    expect(second[1]!.textContent).toBe("burned");
    expect(second[1]!.querySelector(".tag")).not.toBeNull();
    expect(second[3]!.textContent).toBe("—");
    expect(texts(second[4]!.querySelectorAll(".tag"))).toEqual(["burnable", "transferable"]);
    expect(second[5]!.textContent).toBe("—");
    // an NFT with no flag has none, and a dash for what the index does not hold
    const third = cellsOf(plain!);
    expect(within(third[0]!).getByRole("link").textContent).toBe("#3");
    expect(third[4]!.querySelectorAll(".tag")).toHaveLength(0);
    expect(within(screen.getByRole("region", { name: "Collection lists" })).getByText(`/v2/nft_collections/${NFT_ISSUER}/10/nfts`)).toBeTruthy();
  });

  it("is Xahau's: the URIToken's short id, no serial, no fee", () => {
    const token = uriTokenSample({ minted: undefined });
    mount(uriBuild({ query: { ...QUERY, tab: "nfts" }, list: fulfilled(nftsPageSample({ nfts: [token], coverage: WHOLE })) }), `${URI_PATH}?tab=nfts`, LAYOUT_XAHAU);
    expect(headersOf("URITokens")).toEqual(["URIToken", "Owner", "Sales", "Last sale", "Flags", "Minted"]);
    const cells = cellsOf(rowsOf("URITokens")[0]!);
    expect(within(cells[0]!).getByRole("link").textContent).toBe("96133366…AAE9");
    expect(cells[3]!.textContent).toBe("4,200 XAH");
    expect(cells[4]!.querySelectorAll(".tag")).toHaveLength(0);
  });

  it("has the GET form: the owner field with its label, 'Include burned' and Show, to the collection's path", () => {
    const { container } = mount(nftsTab(), `${PATH}?tab=nfts`);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe(PATH);
    const field = within(form).getByRole("searchbox", { name: "Held by an account" });
    expect(field.getAttribute("name")).toBe("owner");
    expect((field as HTMLInputElement).value).toBe("");
    expect(field.getAttribute("aria-invalid")).toBeNull();
    const burned = within(form).getByRole("checkbox", { name: "Include burned" }) as HTMLInputElement;
    expect([burned.name, burned.value, burned.checked]).toEqual(["burned", "1", false]);
    expect(within(form).getByRole("button", { name: "Show" })).toBeTruthy();
    expect(within(form).queryByRole("alert")).toBeNull();
  });

  it("writes the view's own fields as hidden fields before the owner and the burned fields, in the canonical order", () => {
    const { container } = mount(nftsTab({ measure: "low", owner: NFT_OWNER, burned: true }), `${PATH}?measure=low&tab=nfts&owner=${NFT_OWNER}&burned=1`);
    const form = container.querySelector("form")!;
    expect([...form.querySelectorAll("input")].map((input) => [input.type, input.name, input.value])).toEqual([
      ["hidden", "measure", "low"],
      ["hidden", "tab", "nfts"],
      ["search", "owner", NFT_OWNER],
      ["checkbox", "burned", "1"],
    ]);
    expect((form.querySelector('input[name="burned"]') as HTMLInputElement).checked).toBe(true);
    // with the default measure the form carries the tab alone
    cleanup();
    const plain = mount(nftsTab(), `${PATH}?tab=nfts`).container.querySelector("form")!;
    expect([...plain.querySelectorAll('input[type="hidden"]')].map((input) => [(input as HTMLInputElement).name, (input as HTMLInputElement).value])).toEqual([["tab", "nfts"]]);
  });

  it("tells an owner that is no address under the field, tied to it, and draws no table", () => {
    const { container } = mount(
      nftsTab({ owner: "rNope" }, { ownerError: "Write a classic address (r…).", list: null }),
      `${PATH}?tab=nfts&owner=rNope`,
    );
    const field = within(container.querySelector("form")!).getByRole("searchbox", { name: "Held by an account" }) as HTMLInputElement;
    expect(field.value).toBe("rNope");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const message = screen.getByText("Write a classic address (r…).");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
    expect(screen.queryByRole("table", { name: "NFTs" })).toBeNull();
    // The message is the one alert: nothing claims to have failed, no list was asked for.
    expect(screen.getAllByRole("alert")).toEqual([message]);
    // the tabs and the board's note stay
    expect(within(screen.getByRole("navigation", { name: "Collection lists" })).getAllByRole("link")).toHaveLength(3);
    expect(screen.getByText(/A collection is every NFT of one issuer/)).toBeTruthy();
  });

  it("says that the owner holds no NFT of the collection", () => {
    mount(nftsTab({ owner: NFT_OWNER }, { list: fulfilled(nftsPageSample({ nfts: [], count: 0, marker: undefined, coverage: WHOLE })) }), `${PATH}?tab=nfts&owner=${NFT_OWNER}`);
    expect(screen.getByText(`No NFT of this collection is held by ${NFT_OWNER}.`)).toBeTruthy();
  });

  it("says that the collection has no NFT in the index", () => {
    mount(nftsTab({}, { list: fulfilled(nftsPageSample({ nfts: [], count: 0, marker: undefined, coverage: WHOLE })) }), `${PATH}?tab=nfts`);
    expect(screen.getByText("No NFT of this collection is in the index.")).toBeTruthy();
  });

  it("has no form on the other tabs", () => {
    const { container } = mount(build());
    expect(container.querySelector("form")).toBeNull();
    cleanup();
    expect(mount(holdersTab()).container.querySelector("form")).toBeNull();
  });
});

describe("NftCollectionPage: the owner form across client-side navigations", () => {
  const MESSAGE = "Write a classic address (r…).";
  /** What the collection's loader makes of a URL, as far as the form goes: an owner that is no address is the form's message, and no list is asked for. */
  const load = (url: URL): NftCollectionPageData => {
    const query = parseCollectionParams(url.searchParams);
    const bad = query.owner !== undefined && query.owner !== NFT_OWNER && query.owner !== OTHER_OWNER;
    return query.tab === "nfts" ? nftsTab(query, bad ? { ownerError: MESSAGE, list: null } : {}) : build({ query });
  };
  const mountLoaded = (at: string) => mountLoadedPage((data: NftCollectionPageData) => <NftCollectionPage data={data} />, load, { at });
  const ownerField = () => screen.getByRole("searchbox", { name: "Held by an account" }) as HTMLInputElement;
  const burnedBox = () => screen.getByRole("checkbox", { name: "Include burned" }) as HTMLInputElement;
  const at = (router: ReturnType<typeof mountLoaded>["router"]) => router.state.location.pathname + router.state.location.search;

  it("keeps the focus in the field after Show with an owner that is no address, and says why in an alert tied to the field", async () => {
    const { router } = mountLoaded(`${PATH}?tab=nfts`);
    const field = ownerField();
    field.focus();
    fireEvent.change(field, { target: { value: "nope" } });
    // Enter in the field: the form's submit.
    await act(async () => void fireEvent.submit(field.form!));
    await waitFor(() => expect(at(router)).toBe(`${PATH}?tab=nfts&owner=nope`));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(MESSAGE);
    // The same field, still focused, with what was typed: the form was not drawn anew.
    expect(ownerField()).toBe(field);
    expect(document.activeElement).toBe(field);
    expect([field.value, field.getAttribute("aria-invalid"), field.getAttribute("aria-describedby")]).toEqual(["nope", "true", alert.id]);
  });

  it("keeps the focus on Show when it was pressed, with 'Include burned' as it was checked, and tells a second owner that is no address in a new alert", async () => {
    const { router } = mountLoaded(`${PATH}?tab=nfts`);
    const show = screen.getByRole("button", { name: "Show" });
    fireEvent.click(burnedBox());
    fireEvent.change(ownerField(), { target: { value: "nope" } });
    show.focus();
    await act(async () => void fireEvent.click(show));
    await waitFor(() => expect(at(router)).toBe(`${PATH}?tab=nfts&owner=nope&burned=1`));
    const first = await screen.findByRole("alert");
    expect(first.textContent).toBe(MESSAGE);
    expect(screen.getByRole("button", { name: "Show" })).toBe(show);
    expect(document.activeElement).toBe(show);
    expect(burnedBox().checked).toBe(true);

    fireEvent.change(ownerField(), { target: { value: "rNope" } });
    await act(async () => void fireEvent.click(show));
    await waitFor(() => expect(at(router)).toBe(`${PATH}?tab=nfts&owner=rNope&burned=1`));
    // The same words, in an alert of its own, which a screen reader reads again.
    const second = screen.getByRole("alert");
    expect([second.textContent, second === first, ownerField().getAttribute("aria-describedby") === second.id]).toEqual([MESSAGE, false, true]);
    expect(document.activeElement).toBe(show);
  });

  it("puts the previous page's owner back on Back after Enter, though the field kept the focus", async () => {
    const { router } = mountLoaded(`${PATH}?tab=nfts`);
    const field = ownerField();
    field.focus();
    fireEvent.change(field, { target: { value: NFT_OWNER } });
    await act(async () => void fireEvent.submit(field.form!));
    await waitFor(() => expect(at(router)).toBe(`${PATH}?tab=nfts&owner=${NFT_OWNER}`));
    expect(document.activeElement).toBe(field);

    await act(async () => void (await router.navigate(-1)));
    await waitFor(() => expect(at(router)).toBe(`${PATH}?tab=nfts`));
    expect([field.value, document.activeElement === field]).toEqual(["", true]);

    // Typed and not shown, in the field the visitor is in, then a measure's link: the text stays.
    fireEvent.change(field, { target: { value: "rTyp" } });
    await act(async () => void fireEvent.click(within(screen.getByRole("group", { name: "Measure" })).getByRole("link", { name: "Sales" })));
    await waitFor(() => expect(at(router)).toBe(`${PATH}?measure=sales&tab=nfts`));
    expect([field.value, document.activeElement === field]).toEqual(["rTyp", true]);
  });

  it("puts the previous page's 'Include burned' back on Back after Enter on it, though the box kept the focus", async () => {
    const { router } = mountLoaded(`${PATH}?tab=nfts`);
    const box = burnedBox();
    box.focus();
    fireEvent.click(box);
    await act(async () => void fireEvent.submit(box.form!));
    // The empty owner field is sent too: the loader's 302 takes it out.
    await waitFor(() => expect(at(router)).toBe(`${PATH}?tab=nfts&owner=&burned=1`));
    expect([box.checked, document.activeElement === box]).toEqual([true, true]);

    await act(async () => void (await router.navigate(-1)));
    await waitFor(() => expect(at(router)).toBe(`${PATH}?tab=nfts`));
    expect([box.checked, document.activeElement === box]).toEqual([false, true]);
    await act(async () => void (await router.navigate(1)));
    await waitFor(() => expect(at(router)).toBe(`${PATH}?tab=nfts&owner=&burned=1`));
    expect(box.checked).toBe(true);
  });

  it("puts the page's owner and 'Include burned' back when a link changes them, but not into the field the visitor is in", async () => {
    const { router } = mountLoaded(`${PATH}?tab=nfts&owner=nope&burned=1`);
    const field = ownerField();
    expect([field.value, burnedBox().checked]).toEqual(["nope", true]);

    // A measure's link leaves out an owner that is no address and keeps "Include burned": the field is emptied, the message goes.
    await act(async () => void fireEvent.click(within(screen.getByRole("group", { name: "Measure" })).getByRole("link", { name: "Sales" })));
    await waitFor(() => expect(at(router)).toBe(`${PATH}?measure=sales&tab=nfts&burned=1`));
    expect(ownerField()).toBe(field);
    expect([field.value, burnedBox().checked]).toEqual(["", true]);
    expect(screen.queryByRole("alert")).toBeNull();

    // The tab's own link is its first page without the filters: "Include burned" is unchecked.
    await act(async () => void fireEvent.click(within(screen.getByRole("navigation", { name: "Collection lists" })).getByRole("link", { name: "NFTs" })));
    await waitFor(() => expect(at(router)).toBe(`${PATH}?measure=sales&tab=nfts`));
    expect(burnedBox().checked).toBe(false);

    // Back to an owner's NFTs (Back, a link): the owner is in the field.
    await act(async () => void (await router.navigate(`${PATH}?tab=nfts&owner=${NFT_OWNER}`)));
    expect(field.value).toBe(NFT_OWNER);

    // While the visitor types in it, a new view leaves the field alone.
    field.focus();
    fireEvent.change(field, { target: { value: "rTyp" } });
    await act(async () => void (await router.navigate(`${PATH}?measure=low&tab=nfts&owner=${NFT_OWNER}`)));
    expect([field.value, document.activeElement === field]).toEqual(["rTyp", true]);
  });
});

// ---- The Holders tab -------------------------------------------------------------------------------------------------------------------------------------

describe("NftCollectionPage: the Holders tab", () => {
  it("is the table of the holders: the account, the NFTs it holds and its share of the supply", () => {
    mount(holdersTab(), `${PATH}?tab=holders`);
    expect(headersOf("Holders")).toEqual(["Holder", "NFTs held", "Share of supply"]);
    const [first, second] = rowsOf("Holders");
    expect(within(cellsOf(first!)[0]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${NFT_OWNER}`);
    expect(texts(cellsOf(first!))).toEqual([expect.stringContaining("…"), "4,380", "43.8%"]);
    expect(cellsOf(second!)[2]!.textContent).toBe("<0.1%");
    expect(within(screen.getByRole("region", { name: "Collection lists" })).getByText(`/v2/nft_collections/${NFT_ISSUER}/10/holders`)).toBeTruthy();
  });

  it("says Xahau's column in URIToken words", () => {
    mount(uriBuild({ query: { ...QUERY, tab: "holders" }, list: fulfilled(nftHoldersPageSample({ coverage: WHOLE })) }), `${URI_PATH}?tab=holders`, LAYOUT_XAHAU);
    expect(headersOf("Holders")).toEqual(["Holder", "URITokens held", "Share of supply"]);
  });

  it("says that the collection has no holder in the index", () => {
    mount(holdersTab({ list: fulfilled(nftHoldersPageSample({ holders: [], count: 0, coverage: WHOLE })) }));
    expect(screen.getByText("No collection holder is in the index.")).toBeTruthy();
  });
});

// ---- Paging ----------------------------------------------------------------------------------------------------------------------------------------------

describe("NftCollectionPage: Newer and Older", () => {
  it("is the first page: Older is the API's marker, Newer is not a link", () => {
    mount(build());
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Older" }).getAttribute("href")).toBe(`${PATH}?marker=WzEwNzg3ODc3NSwxMDQsMV0`);
    expect(within(pager).queryByRole("link", { name: "Newer" })).toBeNull();
  });

  it("keeps the tab and the filters in the links of a page of the NFTs", () => {
    mount(nftsTab({ owner: NFT_OWNER, burned: true, marker: MARKERS.M2, back: [MARKERS.M1] }), `${PATH}?tab=nfts&owner=${NFT_OWNER}&burned=1&marker=${MARKERS.M2}&back=${MARKERS.M1}`);
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Newer" }).getAttribute("href")).toBe(`${PATH}?tab=nfts&owner=${NFT_OWNER}&burned=1&marker=${MARKERS.M1}`);
    expect(within(pager).getByRole("link", { name: "Older" }).getAttribute("href")).toBe(
      `${PATH}?tab=nfts&owner=${NFT_OWNER}&burned=1&marker=WzEwNzg3ODc3NSwxMDQsMV0&back=${MARKERS.M2}.${MARKERS.M1}`,
    );
  });
});

// ---- A page behind a marker ------------------------------------------------------------------------------------------------------------------------------

describe("NftCollectionPage: a page behind a marker", () => {
  const at = `${PATH}?marker=${MARKERS.M2}&back=${MARKERS.M1}`;

  it("is the breadcrumb, the header card without its dates, Back to the collection and the tab's rows: no stats, no chart, no tabs", () => {
    mount(marker(), at);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Older sales of r4PP7g…CzT3 · taxon 10");
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByRole("listitem")).toHaveLength(3);
    const card = screen.getByRole("region", { name: "Collection" });
    expect(card.textContent).not.toMatch(/mint/i);
    expect(within(card).getByRole("link", { name: NFT_ISSUER })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the collection" }).getAttribute("href")).toBe(PATH);
    expect(screen.queryByRole("region", { name: "Figures" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Measure" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Collection lists" })).toBeNull();
    expect(document.querySelector(".chart")).toBeNull();
    expect(headersOf("Sales")).toEqual(["Time", "NFT", "Price", "Seller →to buyer", "Sale", "Royalty, est."]);
    expect(rowsOf("Sales")).toHaveLength(2);
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Newer" }).getAttribute("href")).toBe(`${PATH}?marker=${MARKERS.M1}`);
    expect(screen.getByText(/A collection is every NFT of one issuer/)).toBeTruthy();
  });

  it("goes back to the tab's first page with its filter, and names the tab's rows", () => {
    mount(
      marker({
        query: { ...QUERY, tab: "nfts", owner: NFT_OWNER, burned: true, marker: MARKERS.M2, back: [] },
        list: fulfilled(nftsPageSample({ nfts: NFTS, coverage: WHOLE })),
      }),
      `${PATH}?tab=nfts&owner=${NFT_OWNER}&burned=1&marker=${MARKERS.M2}`,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Older NFTs of r4PP7g…CzT3 · taxon 10");
    expect(screen.getByRole("link", { name: "Back to the collection" }).getAttribute("href")).toBe(`${PATH}?tab=nfts&owner=${NFT_OWNER}&burned=1`);
    expect(screen.getByRole("table", { name: "NFTs" })).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
  });

  it("is Xahau's", () => {
    mount(
      marker({
        net: XAHAU,
        key: URI_KEY,
        collection: nftCollectionAnswerSample({ collection: uriTokenCollectionSample(), coverage: WHOLE }),
        query: { ...QUERY, tab: "holders", marker: MARKERS.M2, back: [] },
        list: fulfilled(nftHoldersPageSample({ coverage: WHOLE })),
      }),
      `${URI_PATH}?tab=holders&marker=${MARKERS.M2}`,
      LAYOUT_XAHAU,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Older holders of rodinG…zKyb");
    expect(screen.getByRole("link", { name: "Back to the collection" }).getAttribute("href")).toBe(`${URI_PATH}?tab=holders`);
  });
});

// ---- On the server and in the browser --------------------------------------------------------------------------------------------------------------------

describe("NftCollectionPage: the same on the server as in the browser", () => {
  it("prints each tab, and hydrates without a mismatch", async () => {
    const views: Array<[string, NftCollectionPageData, string, typeof LAYOUT_XRPL]> = [
      ["sales", build(), PATH, LAYOUT_XRPL],
      ["nfts", nftsTab({ owner: NFT_OWNER, burned: true }), `${PATH}?tab=nfts&owner=${NFT_OWNER}&burned=1`, LAYOUT_XRPL],
      ["the owner's error", nftsTab({ owner: "rNope" }, { ownerError: "Write a classic address (r…).", list: null }), `${PATH}?tab=nfts&owner=rNope`, LAYOUT_XRPL],
      ["holders", holdersTab(), `${PATH}?tab=holders`, LAYOUT_XRPL],
      ["failed", build({ stats: rejected(outage()), list: rejected(outage()) }), PATH, LAYOUT_XRPL],
      ["a marker", marker(), `${PATH}?marker=${MARKERS.M2}`, LAYOUT_XRPL],
      ["xahau", uriBuild(), URI_PATH, LAYOUT_XAHAU],
    ];
    for (const [name, data, at, network] of views) {
      const { html, errors } = await serverThenHydrated(routed(data, at, network));
      expect(html, name).toContain(data.title);
      expect(errors, name).toEqual([]);
      cleanup();
    }
  });

  it("prints the chart's 30 columns, which the stored page keeps", () => {
    const html = renderToString(routed(build()));
    expect((html.match(/class="col"/g) ?? []).length).toBe(30);
    expect(html).toContain("Sales volume per day, in XRP, last 30 days");
  });

  it("has every day of the window in the table, whatever the number of days the API gave", () => {
    mount(build({ stats: fulfilled(daysOf([])) }));
    expect(within(screen.getByRole("region", { name: "Sales volume per day, in XRP, last 30 days" })).getAllByRole("row")).toHaveLength(31);
    expect(W.buckets).toHaveLength(30);
  });
});
