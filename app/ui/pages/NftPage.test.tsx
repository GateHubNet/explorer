import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
} from "../../../test/support/nft-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import { LAYOUT_XAHAU, LAYOUT_XRPL, LAYOUT_XRPL_TESTNET, mountPage, routedPage } from "../../../test/support/under-network";
import { NO_NAMES } from "../../domain/names";
import { ARROW, type NftQuery } from "../../domain/nft-params";
import type { NftEvent, NftOffer, NodeNftOffers, NodeUriToken } from "../../server/api-types";
import { nftMarkerPage, nftPage, type NftHistoryRow, type NftNet, type NftPageData, type NftPageInput } from "../../server/nft-view";
import { UpstreamError } from "../../server/upstream";
import { NftPage } from "./NftPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---- The world of the tests ------------------------------------------------------------------------------------------------------------------------------

const XRPL: NftNet = { id: "xrpl", name: "XRPL", native: "XRP", longName: "the XRP Ledger", other: "xahau" };
const XAHAU: NftNet = { id: "xahau", name: "Xahau", native: "XAH", longName: "Xahau", other: "xrpl" };

/** The loader's clock: Oct 25, 2026 at 00:00 UTC, in unix seconds. The fixtures' offers expire around it, so every test that reads an expiry pins it. */
const NOW = Date.UTC(2026, 9, 25) / 1000;

const fulfilled = <T,>(value: T): PromiseFulfilledResult<T> => ({ status: "fulfilled", value });
const rejected = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });
const outage = () => new UpstreamError("server", "data API GET /v2/x answered 503", { status: 503 });

const PATH = `/xrpl/nft/${NFT_ID}`;
const URI_PATH = `/xahau/nft/${URI_TOKEN_ID}`;
const QUERY: NftQuery = { offers: false, back: [] };
const WHOLE = coverageSample({ complete: true });
const HASH_A = "3D9B20E130D7498E98FB3499BD4C2AC4CCDB3D11FFBFEA8F9B7FB844DDF33426";
const HASH_B = "BADF36AA20CD32067693C83EE5755BEFB8D1A1E82DEE83E1E67FFD6100712E56";
const MARKERS = { M1: "WzEwNzg4NjE2Myw4MywxXQ", M2: "WzEwNzg4MTUzMCwxNjIsMV0" };
const SELLER = "rfivr3BK17R28wnVwpQQhSDvo2A2fmnEje";
const BUYER = "rLCscV9iDJpvje4ZCKxGjYAMNtBA1Ltauk";

/** An NFT of the index that was sold for 250 USD (≈ 96 XRP) seven times, its mint in the index. */
const SOLD = nftSample({
  last_sale: { amount: "250", currency: "USD", amount_issuer: OTHER_ISSUER, converted_amount: "96", ledger_index: 107874617, tx_hash: NFT_TX_HASH, executed_time: "2026-10-20T17:01:12Z" },
  sale_count: 7,
  minted: { ledger_index: 86201334, tx_hash: HASH_A, executed_time: "2024-03-14T09:00:00Z", by: NFT_ISSUER, to: NFT_ISSUER },
});

/** The offers of the index: a bid that expires on Oct 25, 2026 (an hour after `NOW`), and an ask that expired the day before and one that never does. */
const OFFERS: NftOffer[] = [
  nftOfferSample(),
  nftOfferSample({ offer_id: "A".repeat(64), is_sell_offer: true, owner: NFT_SELLER, amount: "1600", destination: undefined, expiration: "2026-10-24T00:00:00Z", created_ledger: 107870000 }),
  nftOfferSample({ offer_id: "B".repeat(64), is_sell_offer: true, owner: NFT_SELLER, amount: "1800", currency: "USD", amount_issuer: OTHER_ISSUER, destination: undefined, expiration: undefined }),
];

/** The history: a brokered sale, a mint and a sale between two accounts, newest first. */
const HISTORY: NftEvent[] = [
  nftEventSample({ from: SELLER, to: BUYER }),
  nftEventSample({ event_index: 1, event: "mint", tx_hash: HASH_A, executed_time: "2024-03-14T09:00:00Z", account: NFT_ISSUER, from: undefined, to: NFT_ISSUER, amount: undefined, currency: undefined, converted_amount: undefined, broker: undefined, broker_fee: undefined, royalty_est: undefined, offer_id: undefined, is_sell_offer: undefined, tx_type: "NFTokenMint" }),
];

/** The page as the loader reads it: an indexed NFT with its offers and history, in XRPL's words. */
function input(over: Partial<NftPageInput> = {}): NftPageInput {
  return {
    net: XRPL,
    id: NFT_ID,
    query: QUERY,
    mode: "indexed",
    now: NOW,
    index: nftAnswerSample({ nft: SOLD }),
    offers: fulfilled(nftOffersPageSample({ offers: OFFERS, coverage: WHOLE })),
    history: fulfilled(nftEventsPageSample({ events: HISTORY, coverage: WHOLE })),
    ...over,
  };
}

const build = (over: Partial<NftPageInput> = {}): NftPageData => ({ ...nftPage(input(over)), names: NO_NAMES });
const uriBuild = (over: Partial<NftPageInput> = {}): NftPageData => ({
  ...nftPage(input({ net: XAHAU, id: URI_TOKEN_ID, index: nftAnswerSample({ nft: uriTokenSample(), coverage: WHOLE }), offers: fulfilled(nftOffersPageSample({ offers: [], count: 0, coverage: WHOLE })), history: fulfilled(nftEventsPageSample({ events: [], count: 0, coverage: WHOLE })), ...over })),
  names: NO_NAMES,
});
/** An XRPL NFT only the node has, with the node's two sides of offers joined. */
const networkBuild = (over: Partial<NftPageInput> = {}): NftPageData => ({
  ...nftPage({ net: XRPL, id: NODE_NFT_ID, query: QUERY, mode: "network", now: NOW, node: nodeNftInfoSample(), offers: fulfilled({ offers: [], more: false }), history: null, ...over }),
  names: NO_NAMES,
});
const markerBuild = (over: Partial<Parameters<typeof nftMarkerPage>[0]> = {}): NftPageData => ({
  ...nftMarkerPage({ net: XRPL, id: NFT_ID, query: { offers: false, marker: MARKERS.M2, back: [MARKERS.M1] }, index: nftAnswerSample({ nft: SOLD }), history: nftEventsPageSample({ events: HISTORY, marker: NFT_MARKER, coverage: WHOLE }), ...over }),
  names: NO_NAMES,
});

/** The page in a data router at its own URL, drawn in the browser. `loader` counts the revalidations a Retry asks for. */
const mount = (data: NftPageData, at = PATH, network = LAYOUT_XRPL) => mountPage(<NftPage data={data} />, "nft", { at, network });
const routed = (data: NftPageData, at = PATH, network = LAYOUT_XRPL) => routedPage(<NftPage data={data} />, { at, network });

const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);
const headersOf = (name: string) => texts(within(screen.getByRole("table", { name })).getAllByRole("columnheader"));
const rowsOf = (name: string) => within(screen.getByRole("table", { name })).getAllByRole("row").slice(1);
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell");
const card = (name: string) => screen.getByRole("region", { name });
/** The label and value of each row of a card's list. */
const listOf = (name: string) => [...card(name).querySelectorAll(".kv")].map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd")!]) as Array<[string, HTMLElement]>;
const valueOf = (name: string, label: string) => listOf(name).find(([term]) => term === label)![1];
const hrefOf = (element: Element | null) => element?.getAttribute("href");

// ---- The header ------------------------------------------------------------------------------------------------------------------------------------------

describe("NftPage: the breadcrumb and the header card", () => {
  it("has the breadcrumb of the network, the NFTs, the collection and the NFT, the h1, the kind's tag and the collection link", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getAllByRole("listitem").map((item) => item.textContent?.replace("/", ""))).toEqual(["XRPL", "NFTs", "r4PP7g…CzT3 · taxon 10", "#95,234,705"]);
    expect(crumbs.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["XRPL", "/xrpl"],
      ["NFTs", "/xrpl/nfts"],
      ["r4PP7g…CzT3 · taxon 10", `/xrpl/nfts/${NFT_ISSUER}/10`],
    ]);
    expect(crumbs.getByText("#95,234,705").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("NFT #95,234,705");
    const header = card("NFT");
    expect(within(header).getByText("NFToken").className).toContain("tag");
    expect(header.textContent).toContain("Serial 95,234,705 of the collection");
    expect(hrefOf(within(header).getByRole("link", { name: "r4PP7g…CzT3 · taxon 10" }))).toBe(`/xrpl/nfts/${NFT_ISSUER}/10`);
  });

  it("has the glyph as a picture and the 'No preview' box that says the URI is shown, not fetched; and no image anywhere", () => {
    const { container } = mount(build());
    const header = card("NFT");
    expect(header.querySelector(".nft-glyph")!.getAttribute("aria-hidden")).toBe("true");
    expect(header.querySelector(".nft-glyph")!.textContent).toBe("05");
    expect(within(header).getByText("No preview")).toBeTruthy();
    expect(within(header).getByText("The explorer shows the URI but does not fetch what it points to.")).toBeTruthy();
    expect(container.querySelectorAll("img, picture, video, iframe, object, embed")).toHaveLength(0);
  });

  it("gives the id in full with a copy button", () => {
    mount(build());
    const header = card("NFT");
    expect(header.textContent).toContain(NFT_ID);
    expect(within(header).getByRole("button", { name: "Copy NFT id" })).toBeTruthy();
  });

  it("gives the owner in full, with the time since and the link to the transaction that made it so", () => {
    mount(build());
    const header = card("NFT");
    expect(within(header).getByRole("link", { name: NFT_OWNER }).getAttribute("href")).toBe(`/xrpl/account/${NFT_OWNER}`);
    const since = within(header).getByRole("link", { name: "Oct 24, 2026, 16:08 UTC" });
    expect(hrefOf(since)).toBe(`/xrpl/tx/${NFT_TX_HASH}`);
    expect(since.parentElement!.textContent).toContain("since Oct 24, 2026, 16:08 UTC");
  });

  it("gives the last sale: the price, what it is worth in the native currency, the day and how often it was sold, linked to its transaction", () => {
    mount(build());
    const fact = [...card("NFT").querySelectorAll("dl > div")].find((row) => row.querySelector("dt")!.textContent === "Last sale")!;
    expect(fact.querySelector("dd")!.textContent).toBe("250 USD≈ 96 XRPOct 20, 2026 · sold 7 times");
    expect(fact.querySelector(".amt")!.getAttribute("title")).toBe(`USD issued by ${OTHER_ISSUER}`);
    expect(hrefOf(within(fact as HTMLElement).getByRole("link", { name: "Oct 20, 2026 · sold 7 times" }))).toBe(`/xrpl/tx/${NFT_TX_HASH}`);
  });

  it("says Never sold, and how often a token with no price was sold", () => {
    mount(build({ index: nftAnswerSample({ nft: nftSample({ sale_count: 0, last_sale: undefined }) }) }));
    expect(card("NFT").textContent).toContain("Never sold");
    cleanup();
    mount(build({ index: nftAnswerSample({ nft: nftSample({ sale_count: 3, last_sale: undefined }) }) }));
    expect(card("NFT").textContent).toContain("Sold 3 times");
  });

  it("is Xahau's: URIToken words, the minter's collection, the short id's crumb and the URIToken tag", () => {
    mount(uriBuild(), URI_PATH, LAYOUT_XAHAU);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("URIToken 96133366…");
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByRole("listitem").map((item) => item.textContent?.replace("/", ""))).toEqual(["Xahau", "URITokens", "rodinG…zKyb", "96133366…AAE9"]);
    const header = card("URIToken");
    expect(within(header).getByText("URIToken", { selector: ".tag" })).toBeTruthy();
    expect(header.textContent).toContain("Minted by the issuer of");
    expect(hrefOf(within(header).getByRole("link", { name: "rodinG…zKyb" }))).toBe(`/xahau/nfts/${URI_TOKEN_ISSUER}`);
    expect(within(header).getByRole("link", { name: URI_TOKEN_OWNER }).getAttribute("href")).toBe(`/xahau/account/${URI_TOKEN_OWNER}`);
    expect(within(header).getByRole("button", { name: "Copy URIToken id" })).toBeTruthy();
    expect(header.textContent).toContain(URI_TOKEN_ID);
  });

  it("is burned: the tag, 'Burned {day} by {account}' in place of the owner, and no open offers", () => {
    const burned = nftSample({ owner: undefined, owner_since: undefined, burned: true, burned_at: { ledger_index: 107880000, tx_hash: HASH_A, executed_time: "2026-10-25T10:00:00Z", by: NFT_OWNER } });
    mount(build({ mode: "burned", index: nftAnswerSample({ nft: burned }) }));
    const header = card("NFT");
    expect(within(header).getByText("burned", { selector: ".tag" })).toBeTruthy();
    const fact = [...header.querySelectorAll("dl > div")].find((row) => row.querySelector("dt")!.textContent === "Burned")!;
    expect(fact.querySelector("dd")!.textContent).toBe(`Oct 25, 2026 by ${NFT_OWNER}`);
    expect(hrefOf(within(fact as HTMLElement).getByRole("link"))).toBe(`/xrpl/account/${NFT_OWNER}`);
    expect(header.textContent).not.toContain("Owner");
    expect(screen.getByText("No open offers.")).toBeTruthy();
  });

  it("says where an owner the index does not have was read from, or that it is not known", () => {
    const unowned = nftSample({ owner: undefined, owner_since: undefined });
    const node = nodeNftInfoSample();
    mount(build({ mode: "indexed-network-owner", index: nftAnswerSample({ nft: unowned }), node }));
    let owner = [...card("NFT").querySelectorAll("dl > div")].find((row) => row.querySelector("dt")!.textContent === "Owner")!;
    expect(owner.querySelector("dd")!.textContent).toBe(`${node.owner}read from the network at ledger #107,671,930`);
    expect(hrefOf(owner.querySelector("a"))).toBe(`/xrpl/account/${node.owner}`);
    cleanup();
    mount(build({ mode: "indexed-owner-unknown", index: nftAnswerSample({ nft: unowned }) }));
    owner = [...card("NFT").querySelectorAll("dl > div")].find((row) => row.querySelector("dt")!.textContent === "Owner")!;
    expect(owner.querySelector("dd")!.textContent).toBe("Not in the index yet");
    expect(owner.querySelector("a")).toBeNull();
  });

  it("names the network of the sandbox in its breadcrumb", () => {
    mount(build({ net: { ...XRPL, name: "XRPL Testnet", longName: "XRPL Testnet" } }), PATH, LAYOUT_XRPL_TESTNET);
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "XRPL Testnet" }).getAttribute("href")).toBe("/xrpl");
  });
});

// ---- From the network ------------------------------------------------------------------------------------------------------------------------------------

describe("NftPage: an NFT shown from the network", () => {
  it("says it is not in the index yet in a notice, shows the header, details and offers from the node, and has no history card", () => {
    mount(networkBuild({ offers: fulfilled({ offers: [{ nft_offer_index: "C".repeat(64), flags: 1, owner: NFT_SELLER, amount: { currency: "XRP", value: "1600" } }], more: false } satisfies NodeNftOffers) }), `/xrpl/nft/${NODE_NFT_ID}`);
    expect(screen.getByText("Not in the index yet, shown from the network. Its history appears once the index has it.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("NFT #106,293,080");
    const owner = [...card("NFT").querySelectorAll("dl > div")].find((row) => row.querySelector("dt")!.textContent === "Owner")!;
    expect(owner.textContent).toContain("read from the network at ledger #107,671,930");
    // the offers come from the network: no ledger to link
    expect(within(card("Open offers")).getByText("the network")).toBeTruthy();
    expect(cellsOf(rowsOf("Open offers")[0]!).map((cell) => cell.textContent)).toEqual(["sell", "1,600 XRP", expect.stringMatching(/^rhv9jF/), "anyone", "never", "—"]);
    expect(card("Details").textContent).toContain("the network");
    expect(screen.queryByRole("region", { name: "History" })).toBeNull();
    expect(screen.queryByText("Show offer events")).toBeNull();
  });

  it("is burned from the network: the tag, the owner line says burned, no offers", () => {
    mount(networkBuild({ mode: "network-burned", node: nodeNftInfoSample({ is_burned: true }), offers: null }));
    expect(within(card("NFT")).getByText("burned", { selector: ".tag" })).toBeTruthy();
    expect(card("NFT").textContent).toContain("Burned");
    expect(screen.getByText("No open offers.")).toBeTruthy();
  });

  it("is Xahau's URIToken entry, its own sell offer in the offers table", () => {
    const entry: NodeUriToken = nodeUriTokenSample({ Amount: { currency: "XAH", value: "2200" } });
    mount({ ...nftPage({ net: XAHAU, id: URI_TOKEN_ID, query: QUERY, mode: "network", now: NOW, node: entry, offers: fulfilled(entry), history: null }), names: NO_NAMES }, URI_PATH, LAYOUT_XAHAU);
    expect(cellsOf(rowsOf("Open offers")[0]!).map((cell) => cell.textContent)).toEqual(["sell", "2,200 XAH", expect.stringMatching(/^rLEUHu/), "anyone", "—", "—"]);
    expect(screen.queryByRole("region", { name: "History" })).toBeNull();
  });

  it("tells that the offers could not be loaded from the network, and the rest stands", () => {
    mount(networkBuild({ offers: rejected(outage()) }));
    expect(within(card("Open offers")).getByRole("alert").textContent).toBe("Couldn’t load the open offers.Retry");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("NFT #106,293,080");
  });
});

// ---- The details and the id's card -------------------------------------------------------------------------------------------------------------------------

describe("NftPage: the details", () => {
  it("lists the issuer, taxon and serial, the mint, the transfer fee, the URI and the flags, with their source", () => {
    mount(build());
    const details = card("Details");
    expect(within(details).getByText(`/v2/nfts/${NFT_ID}`)).toBeTruthy();
    expect(listOf("Details").map(([label]) => label)).toEqual(["Issuer", "Taxon · serial", "Minted", "Transfer fee", "URI", "Flags"]);
    expect(hrefOf(within(valueOf("Details", "Issuer")).getByRole("link"))).toBe(`/xrpl/account/${NFT_ISSUER}`);
    expect(valueOf("Details", "Taxon · serial").textContent).toBe("10 · 95,234,705");
    expect(valueOf("Details", "Minted").textContent).toBe(`#86,201,334 · Mar 14, 2024 · by ${NFT_ISSUER.slice(0, 6)}…${NFT_ISSUER.slice(-4)}`);
    expect(valueOf("Details", "Transfer fee").textContent).toBe("5.000% of every sale goes to the issuer");
    // the index's history starts after the mint, so it cannot say there is no URI
    expect(valueOf("Details", "URI").textContent).toBe("Not in the index");
  });

  it("says None for an NFT whose whole history the index holds and which has no URI", () => {
    mount(build({ index: nftAnswerSample({ nft: SOLD, coverage: WHOLE }) }));
    expect(valueOf("Details", "URI").textContent).toBe("None");
  });

  it("gives each flag a mark that is a picture and the word yes or no for a screen reader", () => {
    mount(build());
    const flags = [...valueOf("Details", "Flags").querySelectorAll("li")];
    // sample flags 8: transferable only
    expect(flags.map((flag) => [flag.querySelector("[aria-hidden]")!.textContent, flag.textContent?.replace(/[✓–]/, "").trim()])).toEqual([
      ["–", "Burnable by issuer: no"],
      ["–", "Only XRP: no"],
      ["✓", "Transferable: yes"],
      ["–", "Mutable URI: no"],
    ]);
    expect(flags.map((flag) => flag.querySelector(".sr")!.textContent)).toEqual([": no", ": no", ": yes", ": no"]);
    expect(flags.every((flag) => flag.querySelector("[aria-hidden]")!.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("is Xahau's: royalty none, the one flag", () => {
    mount(uriBuild(), URI_PATH, LAYOUT_XAHAU);
    expect(listOf("Details").map(([label]) => label)).toEqual(["Issuer", "Minted", "Royalty", "URI", "Flags"]);
    expect(valueOf("Details", "Royalty").textContent).toBe("None: URITokens carry no transfer fee");
    expect([...valueOf("Details", "Flags").querySelectorAll("li")].map((flag) => flag.textContent)).toEqual(["–Burnable by issuer: no"]);
  });

  it("says where the history of the mint starts when the index lacks it, with the note of the page's coverage", () => {
    mount(build({ index: nftAnswerSample({ nft: nftSample() }), history: fulfilled(nftEventsPageSample({ events: HISTORY })) }));
    expect(valueOf("Details", "Minted").textContent).toBe("Before ledger #107,874,617, not in the index");
  });
});

describe("NftPage: the layout of the cards", () => {
  it("has the details and the id's card side by side in one row that folds, in the board's order, and the offers and the history under them", () => {
    mount(build());
    const details = card("Details");
    const id = card("The id, decoded");
    expect(details.parentElement).toBe(id.parentElement);
    expect(details.parentElement!.className).toBe("nft-page__pair");
    expect([...details.parentElement!.children]).toEqual([details, id]);
    expect(details.className).toContain("nft-page__details");
    expect(id.className).toContain("nft-page__idcard");
    // The two lists of offers and events follow the pair, not inside it.
    expect(details.parentElement!.nextElementSibling).toBe(card("Open offers"));
    expect(card("Open offers").nextElementSibling).toBe(card("History"));
  });

  it("has the pair on a URIToken's page too, with the id's card titled for Xahau", () => {
    mount(uriBuild(), URI_PATH, LAYOUT_XAHAU);
    expect(card("Details").parentElement).toBe(card("The id").parentElement);
    expect(card("Details").parentElement!.className).toBe("nft-page__pair");
  });

  it("has no pair behind a marker, which has neither card", () => {
    const { container } = mount(markerBuild(), `${PATH}?marker=${MARKERS.M2}`);
    expect(container.querySelector(".nft-page__pair")).toBeNull();
  });

  it("sets the amounts of the offers and of the history at the end of their columns, with their headers", () => {
    mount(build());
    for (const [table, column] of [["Open offers", 1], ["History", 3]] as const) {
      const header = within(screen.getByRole("table", { name: table })).getAllByRole("columnheader")[column]!;
      expect(header.className, table).toContain("is-end");
      for (const row of rowsOf(table)) expect(cellsOf(row)[column]!.className, `${table} ${row.textContent}`).toContain("is-end");
    }
  });
});

describe("NftPage: the URI", () => {
  const hexOf = (value: string): string => Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  const withUri = (uri: string) => build({ index: nftAnswerSample({ nft: nftSample({ uri: hexOf(uri) }), coverage: WHOLE }) });

  it.each([
    ["a javascript: URL", "javascript:alert(1)"],
    ["an https:// URL", "https://example.com/token/1.json"],
    ["an ipfs:// URL", "ipfs://bafybeihxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/1.json"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["markup", "<a href=\"https://evil.example\">click</a>"],
    ["a mailto: URL", "mailto:someone@example.com"],
  ])("draws the URI as text, never a link: %s", (_name, uri) => {
    const { container } = mount(withUri(uri));
    const row = valueOf("Details", "URI");
    // the URI is text in a code span; nothing in its row, and no element of the page, is a link to it
    expect(row.querySelectorAll("a")).toHaveLength(0);
    expect(row.querySelector(".mono")!.textContent).toBe(uri);
    expect(row.textContent).toContain("Decoded from hex. Not fetched.");
    expect([...container.querySelectorAll("a")].filter((link) => (link.getAttribute("href") ?? "").includes(uri.split(":")[0]! + ":") && !link.getAttribute("href")!.startsWith("/"))).toEqual([]);
    expect(container.querySelectorAll("img, iframe, object, embed, script, [src], [srcset]")).toHaveLength(0);
    expect(container.querySelector("[onclick], [onerror]")).toBeNull();
    // markup is text too: no element made of it
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(row.querySelectorAll("*")).toHaveLength(row.querySelectorAll(".mono, .nft-page__note").length);
  });

  it("shows what is not text as hex, with the words that say so, and never as a link", () => {
    const bytes = "FF00AABBCC";
    mount(build({ index: nftAnswerSample({ nft: nftSample({ uri: bytes }), coverage: WHOLE }) }));
    const row = valueOf("Details", "URI");
    expect(row.querySelector(".mono")!.textContent).toBe(bytes);
    expect(row.textContent).toContain("Not text, shown as hex. Not fetched.");
    expect(row.querySelectorAll("a")).toHaveLength(0);
  });

  it("shows a URI with a control character or an override as hex, whatever the text would have read", () => {
    const bidi = `https://example.com/‮txt.exe`;
    mount(withUri(bidi));
    const row = valueOf("Details", "URI");
    expect(row.querySelector(".mono")!.textContent).toBe(hexOf(bidi));
    expect(row.textContent).toContain("Not text, shown as hex. Not fetched.");
  });
});

describe("NftPage: the id's card", () => {
  it("is XRPL's 'The id, decoded': each field with the bytes it is read from, and the note on the scrambled taxon", () => {
    mount(build());
    const title = screen.getByRole("heading", { level: 2, name: "The id, decoded" });
    expect(title).toBeTruthy();
    const rows = listOf("The id, decoded");
    expect(rows.map(([label]) => label)).toEqual(["Flags", "Transfer fee", "Issuer, 20 bytes", "Taxon, scrambled", "Sequence"]);
    const hexes = rows.map(([, value]) => value.querySelector(".nft-page__hex")?.textContent);
    expect(hexes).toEqual([NFT_ID.slice(0, 4), NFT_ID.slice(4, 8), NFT_ID.slice(8, 48), NFT_ID.slice(48, 56), NFT_ID.slice(56, 64)]);
    expect(rows[1]![1].textContent).toContain("5,000 = 5.000% royalty");
    expect(rows[2]![1].querySelector("a")!.getAttribute("href")).toBe(`/xrpl/account/${NFT_ISSUER}`);
    expect(rows[3]![1].textContent).toContain("taxon 10");
    expect(rows[4]![1].textContent).toContain("serial 95,234,705 of the issuer");
    expect(card("The id, decoded").textContent).toContain("The taxon is stored scrambled with the sequence; the explorer unscrambles it, as rippled does.");
  });

  it("is Xahau's 'The id': the digest, short with the whole of it on hover, and the ledger entry", () => {
    mount(uriBuild(), URI_PATH, LAYOUT_XAHAU);
    expect(screen.getByRole("heading", { level: 2, name: "The id" })).toBeTruthy();
    const rows = listOf("The id");
    expect(rows.map(([label, value]) => [label, value.textContent])).toEqual([
      ["Digest", "772B3876…8736"],
      ["Ledger entry", "URIToken"],
    ]);
    expect(rows[0]![1].querySelector("[title]")!.getAttribute("title")).toBe(uriTokenSample().digest);
    expect(card("The id").textContent).toContain("A URIToken's id is the key of its ledger entry");
  });
});

// ---- The open offers -------------------------------------------------------------------------------------------------------------------------------------

describe("NftPage: the open offers", () => {
  it("has a card with its source and a table with the board's columns and a row for each offer", () => {
    mount(build());
    const offers = card("Open offers");
    expect(within(offers).getByText(`/v2/nfts/${NFT_ID}/offers`)).toBeTruthy();
    expect(headersOf("Open offers")).toEqual(["Side", "Amount", "By", "Only for", "Expires", "Created"]);
    const rows = rowsOf("Open offers").map((row) => cellsOf(row).map((cell) => cell.textContent));
    const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
    expect(rows).toEqual([
      ["buy", "6.29 XRP", short("rMTaAGVd77vAbzDv8qhoMgnZR1T5R3w6Wq"), short(NFT_BROKER), "Oct 25, 2026", "#107,886,233"],
      ["sell", "1,600 XRP", short(NFT_SELLER), "anyone", "Oct 24, 2026expired", "#107,870,000"],
      ["sell", "1,800 USD", short(NFT_SELLER), "anyone", "never", "#107,886,233"],
    ]);
  });

  it("tags the side, tags an offer that has expired before the loader's time, and links the ledger an offer was made in", () => {
    mount(build());
    const rows = rowsOf("Open offers");
    expect(cellsOf(rows[0]!)[0]!.querySelector(".tag")!.textContent).toBe("buy");
    expect(cellsOf(rows[1]!)[0]!.querySelector(".tag")!.textContent).toBe("sell");
    // only the second has expired (its expiry is the day before NOW); the bid's is an hour after, and the third never expires
    expect(rows.map((row) => cellsOf(row)[4]!.querySelector(".tag")?.textContent ?? null)).toEqual([null, "expired", null]);
    expect(hrefOf(cellsOf(rows[0]!)[5]!.querySelector("a"))).toBe("/xrpl/ledger/107886233");
    expect(hrefOf(cellsOf(rows[1]!)[2]!.querySelector("a"))).toBe(`/xrpl/account/${NFT_SELLER}`);
    expect(hrefOf(cellsOf(rows[0]!)[3]!.querySelector("a"))).toBe(`/xrpl/account/${NFT_BROKER}`);
  });

  it("says in the offers' own words what an offer is, and where the history of offers starts when the index lacks it", () => {
    mount(build({ offers: fulfilled(nftOffersPageSample({ offers: OFFERS })) }));
    expect(card("Open offers").textContent).toContain("Open offers: created and not yet cancelled, removed or accepted.");
    const note = within(card("Open offers")).getAllByRole("note")[0]!;
    expect(note.textContent).toBe("This NFT's history in the index starts at ledger #107,874,617: earlier offers of this NFT are not in the index yet.");
    expect(hrefOf(within(note).getByRole("link"))).toBe("/xrpl/ledger/107874617");
  });

  it("says there are more than the first 50, and when there are none", () => {
    mount(build({ offers: fulfilled(nftOffersPageSample({ offers: OFFERS, marker: NFT_MARKER, coverage: WHOLE })) }));
    expect(within(card("Open offers")).getByText("Showing the first 50.")).toBeTruthy();
    cleanup();
    mount(build({ offers: fulfilled(nftOffersPageSample({ offers: [], count: 0, coverage: WHOLE })) }));
    expect(within(card("Open offers")).queryByText("Showing the first 50.")).toBeNull();
    expect(within(card("Open offers")).getByText("No open offers.")).toBeTruthy();
  });

  it("is told as failed in its place, with a Retry that asks the route for its data again, and the rest of the page stands", () => {
    const { loader } = mount(build({ offers: rejected(outage()) }));
    const alert = within(card("Open offers")).getByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load the open offers.Retry");
    expect(screen.queryByRole("table", { name: "Open offers" })).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
    expect(screen.getByRole("table", { name: "History" })).toBeTruthy();
  });

  it("has a dash for a buy offer's destination and for a Xahau offer's expiry, which has none", () => {
    mount(build({ offers: fulfilled(nftOffersPageSample({ offers: [nftOfferSample({ destination: undefined, expiration: undefined })], coverage: WHOLE })) }));
    expect(cellsOf(rowsOf("Open offers")[0]!).map((cell) => cell.textContent).slice(3, 5)).toEqual(["—", "never"]);
  });
});

// ---- The history -----------------------------------------------------------------------------------------------------------------------------------------

describe("NftPage: the history", () => {
  it("has a card with its source, a table with the board's columns, a row for each event with its time, tag, accounts, amount and transaction", () => {
    mount(build());
    const history = card("History");
    expect(within(history).getByText(`/v2/nfts/${NFT_ID}/history?descending=true`)).toBeTruthy();
    expect(headersOf("History")).toEqual(["Time", "Event", "Accounts", "Amount", "Transaction"]);
    const rows = rowsOf("History");
    expect(rows).toHaveLength(2);
    const sale = cellsOf(rows[0]!);
    expect(sale[0]!.textContent).toBe("2026-10-24" + "21:30:41");
    expect(sale[1]!.querySelector(".tag")!.textContent).toBe("sale");
    expect(sale[3]!.textContent).toBe("150 XRP");
    expect(hrefOf(sale[4]!.querySelector("a"))).toBe(`/xrpl/tx/${HISTORY[0]!.tx_hash}`);
    expect(sale[4]!.textContent).toBe(`${HISTORY[0]!.tx_hash.slice(0, 6)}…${HISTORY[0]!.tx_hash.slice(-4)}`);
    const mint = cellsOf(rows[1]!);
    expect(mint[1]!.querySelector(".tag")!.textContent).toBe("mint");
    expect(mint[2]!.textContent).toBe("by r4PP7g…CzT3, to r4PP7g…CzT3");
    expect(mint[3]!.textContent).toBe("—");
  });

  it("draws the seller → buyer arrow as a picture and says 'to' to a screen reader, and the accounts as links", () => {
    mount(build());
    const accounts = cellsOf(rowsOf("History")[0]!)[2]!;
    const arrow = accounts.querySelector("[aria-hidden='true']")!;
    expect(arrow.textContent).toBe("→");
    expect(arrow.nextElementSibling!.className).toBe("sr");
    expect(arrow.nextElementSibling!.textContent).toBe("to");
    // the text of the arrow's segment is not drawn as text: only the picture and the hidden word
    expect(accounts.textContent).not.toContain(ARROW);
    expect(accounts.textContent).toBe(`${SELLER.slice(0, 6)}…${SELLER.slice(-4)} →to ${BUYER.slice(0, 6)}…${BUYER.slice(-4)} · broker ${NFT_BROKER.slice(0, 6)}…${NFT_BROKER.slice(-4)}, fee 2.3835 XRP`);
    expect([...accounts.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([`/xrpl/account/${SELLER}`, `/xrpl/account/${BUYER}`, `/xrpl/account/${NFT_BROKER}`]);
  });

  it("draws the arrow of a transfer the same way", () => {
    const transfer = nftEventSample({ event: "transfer", tx_type: "NFTokenAcceptOffer", from: SELLER, to: BUYER, amount: undefined, currency: undefined, converted_amount: undefined, broker: undefined, broker_fee: undefined, royalty_est: undefined });
    mount(build({ history: fulfilled(nftEventsPageSample({ events: [transfer], coverage: WHOLE })) }));
    const accounts = cellsOf(rowsOf("History")[0]!)[2]!;
    expect(accounts.querySelectorAll("[aria-hidden='true']")).toHaveLength(1);
    expect(accounts.querySelector(".sr")!.textContent).toBe("to");
    expect(accounts.textContent).toContain("an accepted offer of 0");
  });

  it("draws a text segment that merely contains an arrow as the text it is: no picture and no hidden 'to', only a segment that is exactly the arrow is one", () => {
    const row = (accounts: NftHistoryRow["accounts"]): NftHistoryRow => ({ key: `${HASH_A}:1`, time: NOW, txHash: HASH_A, event: "sale", accounts, amount: null });
    const data = build();
    mount({ ...data, history: [row([{ t: "text", v: `a${ARROW}b` }]), row([{ t: "text", v: "a →" }, { t: "text", v: "→ b" }]), row([{ t: "text", v: "a" }, { t: "text", v: ARROW }, { t: "text", v: "b" }])] });
    const [contained, split, exact] = rowsOf("History").map((each) => cellsOf(each)[2]!);
    // The text of an event that contains an arrow is as it was written.
    expect(contained!.textContent).toBe("a → b");
    expect(contained!.querySelector("[aria-hidden]")).toBeNull();
    expect(contained!.querySelector(".sr")).toBeNull();
    expect(split!.textContent).toBe("a →→ b");
    expect(split!.querySelector("[aria-hidden]")).toBeNull();
    expect(split!.querySelector(".sr")).toBeNull();
    // The segment that is exactly the arrow is the picture and the hidden word.
    expect(exact!.querySelector("[aria-hidden='true']")!.textContent).toBe("→");
    expect(exact!.querySelector(".sr")!.textContent).toBe("to");
  });

  it("is a toggle link whose words say what it does and which has no aria-current, to the first page of the other view", () => {
    mount(build());
    const show = screen.getByRole("link", { name: "Show offer events" });
    expect(show.getAttribute("href")).toBe(`${PATH}?offers=1`);
    expect(show.hasAttribute("aria-current")).toBe(false);
    cleanup();
    mount(build({ query: { offers: true, back: [] } }), `${PATH}?offers=1`);
    const hide = screen.getByRole("link", { name: "Hide offer events" });
    expect(hide.getAttribute("href")).toBe(PATH);
    expect(hide.hasAttribute("aria-current")).toBe(false);
    expect(screen.queryByRole("link", { name: "Show offer events" })).toBeNull();
  });

  it("has the newer and older links of a page, and the notes: newest first, and where the history of the index starts", () => {
    mount(
      build({
        query: { offers: false, marker: MARKERS.M2, back: [MARKERS.M1] },
        history: fulfilled(nftEventsPageSample({ events: HISTORY, marker: NFT_MARKER, coverage: coverageSample({ complete: false, from_ledger_index: 32570 }) })),
      }),
    );
    const history = card("History");
    const pager = within(history).getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Newer", `${PATH}?marker=${MARKERS.M1}`],
      ["Older", `${PATH}?marker=${NFT_MARKER}&back=${MARKERS.M2}.${MARKERS.M1}`],
    ]);
    expect(history.textContent).toContain("Newest first. A sale's price is the offer it accepted; a transfer moves the token without a price.");
    const note = within(history).getAllByRole("note")[0]!;
    expect(note.textContent).toBe("This NFT's history in the index starts at ledger #32,570: earlier events of this NFT are not in the index yet.");
  });

  it("says what the view leaves out when there is no row", () => {
    mount(build({ history: fulfilled(nftEventsPageSample({ events: [], count: 0, coverage: WHOLE })) }));
    expect(within(card("History")).getByText("No mint, sale, transfer or burn of this NFT is in the index.")).toBeTruthy();
  });

  it("is told as failed in its place, with a Retry, and the rest of the page stands", () => {
    const { loader } = mount(build({ history: rejected(outage()) }));
    const alert = within(card("History")).getByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load the history.Retry");
    expect(screen.queryByRole("table", { name: "History" })).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
    expect(screen.getByRole("table", { name: "Open offers" })).toBeTruthy();
    // the toggle is still there, to change the view
    expect(screen.getByRole("link", { name: "Show offer events" })).toBeTruthy();
  });

  it("has one alert for each card that failed, and none for a page that did not", () => {
    mount(build({ offers: rejected(outage()), history: rejected(outage()) }));
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    cleanup();
    mount(build());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// ---- A page behind a marker ------------------------------------------------------------------------------------------------------------------------------

describe("NftPage: a page behind a marker", () => {
  it("is the breadcrumb, the header without an owner or a last sale, 'Back to the NFT' and the history rows", () => {
    mount(markerBuild(), `${PATH}?marker=${MARKERS.M2}&back=${MARKERS.M1}`);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Older history of NFT #95,234,705");
    const header = card("NFT");
    expect(header.textContent).not.toContain("Owner");
    expect(header.textContent).not.toContain("Last sale");
    expect(header.textContent).toContain(NFT_ID);
    expect(hrefOf(screen.getByRole("link", { name: "Back to the NFT" }))).toBe(PATH);
    expect(rowsOf("History")).toHaveLength(2);
    // nothing else of the NFT's page
    expect(screen.queryByRole("region", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("region", { name: "The id, decoded" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Open offers" })).toBeNull();
    expect(within(card("History")).getByRole("navigation", { name: "Pagination" })).toBeTruthy();
  });

  it("keeps the view with offer events in Back and in the toggle, and is Xahau's words on Xahau", () => {
    mount(markerBuild({ query: { offers: true, marker: MARKERS.M2, back: [] } }), `${PATH}?offers=1&marker=${MARKERS.M2}`);
    expect(hrefOf(screen.getByRole("link", { name: "Back to the NFT" }))).toBe(`${PATH}?offers=1`);
    expect(screen.getByRole("link", { name: "Hide offer events" })).toBeTruthy();
    cleanup();
    mount(markerBuild({ net: XAHAU, id: URI_TOKEN_ID, index: nftAnswerSample({ nft: uriTokenSample() }) }), `${URI_PATH}?marker=${MARKERS.M2}`, LAYOUT_XAHAU);
    expect(screen.getByRole("link", { name: "Back to the URIToken" })).toBeTruthy();
  });
});

// ---- Server and browser ------------------------------------------------------------------------------------------------------------------------------------

describe("NftPage: the page the Worker prints is the page the browser takes over", () => {
  it.each([
    ["an indexed NFT", () => routed(build())],
    ["an NFT from the network", () => routed(networkBuild(), `/xrpl/nft/${NODE_NFT_ID}`)],
    ["a URIToken", () => routed(uriBuild(), URI_PATH, LAYOUT_XAHAU)],
    ["a page behind a marker", () => routed(markerBuild(), `${PATH}?marker=${MARKERS.M2}`)],
    ["cards that failed", () => routed(build({ offers: rejected(outage()), history: rejected(outage()) }))],
  ])("hydrates %s without a mismatch", async (_name, make) => {
    const { html, errors } = await serverThenHydrated(make());
    expect(errors).toEqual([]);
    expect(html).toContain("No preview");
  });

  it("names its heading, tables and cards in the HTML that has no script", async () => {
    const { html } = await serverThenHydrated(routed(build()));
    expect(html).toContain("<h1");
    expect(html).toContain('aria-label="History"');
    expect(html).toContain('aria-label="Open offers"');
    expect(html).toContain("Show offer events");
  });
});
