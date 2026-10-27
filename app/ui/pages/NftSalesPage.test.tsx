import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { coverageSample, nftSaleSample, nftSalesPageSample, NFT_ISSUER, URI_TOKEN_ID, URI_TOKEN_ISSUER } from "../../../test/support/nft-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import { shortAddress } from "../../domain/format";
import type { NftSale } from "../../server/api-types";
import type { PublicNetwork } from "../../server/network-route";
import { nftSalesPage, type NftSalesPageData, type NftsNet } from "../../server/nfts-view";
import { NO_FEATURES } from "../features";
import { NETWORK_ROUTE_ID } from "../use-network";
import { NftSalesPage } from "./NftSalesPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const XRPL: NftsNet = { id: "xrpl", native: "XRP", longName: "the XRP Ledger" };
const XAHAU: NftsNet = { id: "xahau", native: "XAH", longName: "Xahau" };

const LAYOUT_XRPL: PublicNetwork = {
  id: "xrpl",
  kind: "mainnet",
  name: "XRPL",
  label: "XRPL mainnet",
  longName: "the XRP Ledger",
  dexName: "the XRP Ledger DEX",
  native: "XRP",
  ctidNetworkId: 0,
  other: "xahau",
  hasAmm: true,
  software: "rippled",
  displays: ["native", "usd"],
  features: { ...NO_FEATURES, nfts: true },
};
const LAYOUT_XAHAU: PublicNetwork = {
  ...LAYOUT_XRPL,
  id: "xahau",
  name: "Xahau",
  label: "Xahau mainnet",
  longName: "Xahau",
  dexName: "the Xahau DEX",
  native: "XAH",
  ctidNetworkId: 21337,
  other: "xrpl",
  hasAmm: false,
  software: "xahaud",
  displays: ["native"],
};
const LAYOUT_XRPL_TESTNET: PublicNetwork = { ...LAYOUT_XRPL, kind: "testnet", name: "XRPL Testnet", label: "XRPL Testnet", longName: "XRPL Testnet", dexName: "the XRPL Testnet DEX", ctidNetworkId: 1, displays: ["native"] };

const SALES: NftSale[] = [
  nftSaleSample({ amount: "1250", converted_amount: "1250", royalty_est: "62.5" }),
  nftSaleSample({ event_index: 2, tx_hash: "D".repeat(64), serial: 7, amount: "310", converted_amount: "310", royalty_est: "15.5", mode: "brokered" }),
];

const build = (net: NftsNet = XRPL, query: { marker?: string; back: readonly string[] } = { back: [] }, over = {}): NftSalesPageData =>
  nftSalesPage(net, query, nftSalesPageSample({ sales: SALES, coverage: coverageSample({ complete: true }), ...over }));

const underLayout = (children: RouteObject[], network: PublicNetwork): RouteObject[] => [
  { id: NETWORK_ROUTE_ID, path: "/:net", loader: () => ({ network }), element: <Outlet />, children },
];
const layoutData = (network: PublicNetwork) => ({ [NETWORK_ROUTE_ID]: { network } });

function mount(data: NftSalesPageData, at = "/xrpl/nfts/sales", network = LAYOUT_XRPL) {
  const router = createMemoryRouter(underLayout([{ id: "sales", path: "*", element: <NftSalesPage data={data} />, loader: () => null }], network), {
    initialEntries: [at],
    hydrationData: { loaderData: { ...layoutData(network), sales: null } },
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

const routed = (data: NftSalesPageData, at = "/xrpl/nfts/sales", network = LAYOUT_XRPL) => (
  <RouterProvider router={createMemoryRouter(underLayout([{ path: "*", element: <NftSalesPage data={data} /> }], network), { initialEntries: [at], hydrationData: { loaderData: layoutData(network) } })} />
);

const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);

describe("NftSalesPage", () => {
  it("has the breadcrumb of the network, the NFTs and the sales, the h1 and the table of the sales", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getAllByRole("listitem").map((item) => item.textContent?.replace("/", ""))).toEqual(["XRPL", "NFTs", "Sales"]);
    expect(crumbs.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["XRPL", "/xrpl"],
      ["NFTs", "/xrpl/nfts"],
    ]);
    expect(crumbs.getByText("Sales").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("NFT sales");
    const table = screen.getByRole("table", { name: "Sales" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Time", "NFT", "Collection", "Price", "Seller → buyer", "Sale", "Royalty, est."]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(screen.getByRole("region", { name: "Sales" })).getByText("/v2/nft_sales?descending=true")).toBeTruthy();
  });

  it("draws the rows as the list does, with the 'to' of seller → buyer for screen readers", () => {
    mount(build());
    const [first, second] = within(screen.getByRole("table", { name: "Sales" })).getAllByRole("row").slice(1);
    const cells = within(first!).getAllByRole("cell");
    expect(within(cells[0]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/tx/${SALES[0]!.tx_hash}`);
    expect(within(cells[1]!).getByRole("link").textContent).toBe("#95,234,705");
    expect(within(cells[2]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/nfts/${NFT_ISSUER}/10`);
    expect(cells[3]!.textContent).toBe("1,250 XRP");
    expect(cells[4]!.querySelector(".sr")!.textContent).toBe("to");
    expect(cells[4]!.textContent).toBe(`${shortAddress(SALES[0]!.seller)}→to${shortAddress(SALES[0]!.buyer)}`);
    expect(cells[5]!.textContent).toBe("direct");
    expect(cells[6]!.textContent).toBe("62.5 XRP");
    expect(within(within(second!).getAllByRole("cell")[5]!).getByText("brokered")).toBeTruthy();
  });

  it("is the first page: Older is the API's marker, Newer is not a link", () => {
    mount(build());
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Older" }).getAttribute("href")).toBe("/xrpl/nfts/sales?marker=WzEwNzg3ODc3NSwxMDQsMV0");
    expect(within(pager).queryByRole("link", { name: "Newer" })).toBeNull();
    expect(pager.querySelector('[aria-disabled="true"]')!.textContent).toBe("Newer");
  });

  it("is a page behind a marker: Newer goes back the trail, Older on", () => {
    mount(build(XRPL, { marker: "M2", back: ["M1"] }), "/xrpl/nfts/sales?marker=M2&back=M1");
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Newer" }).getAttribute("href")).toBe("/xrpl/nfts/sales?marker=M1");
    expect(within(pager).getByRole("link", { name: "Older" }).getAttribute("href")).toBe("/xrpl/nfts/sales?marker=WzEwNzg3ODc3NSwxMDQsMV0&back=M2.M1");
  });

  it("has no Older link on the last page", () => {
    mount(build(XRPL, { marker: "M2", back: [] }, { marker: undefined }), "/xrpl/nfts/sales?marker=M2");
    expect(within(screen.getByRole("navigation", { name: "Pagination" })).queryByRole("link", { name: "Older" })).toBeNull();
  });

  it("says the board's note of the network and the coverage under the table", () => {
    mount(build(XRPL, { back: [] }, { coverage: coverageSample({ complete: false, from_ledger_index: 32570 }) }));
    const card = screen.getByRole("region", { name: "Sales" });
    expect(within(card).getByText("A brokered sale matches a sell and a buy offer; the broker keeps the difference. Royalty is the issuer’s transfer fee on the price, when the issuer is neither side.")).toBeTruthy();
    expect(within(card).getByRole("note").textContent).toBe("Covers ledger #32,570 onwards: earlier NFT sales are not in the index yet.");
    expect(within(within(card).getByRole("note")).getByRole("link").getAttribute("href")).toBe("/xrpl/ledger/32570");
  });

  it("says an empty page in the table", () => {
    mount(build(XRPL, { back: [] }, { sales: [], count: 0, marker: undefined }));
    expect(within(screen.getByRole("region", { name: "Sales" })).getByText("No sales in the index yet.")).toBeTruthy();
  });

  it("is Xahau's: URITokens sales, the URIToken column, a royalty that is a dash, the URIToken's note", () => {
    const uri = nftSaleSample({ nft_id: URI_TOKEN_ID, kind: "uritoken", issuer: URI_TOKEN_ISSUER, serial: undefined, taxon: undefined, currency: "XAH", amount: "520", converted_amount: "520", royalty_est: undefined });
    mount(nftSalesPage(XAHAU, { back: [] }, nftSalesPageSample({ sales: [uri], coverage: coverageSample({ complete: false, from_ledger_index: 26533927 }) })), "/xahau/nfts/sales", LAYOUT_XAHAU);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("URITokens sales");
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByRole("listitem").map((item) => item.textContent?.replace("/", ""))).toEqual(["Xahau", "URITokens", "Sales"]);
    const table = screen.getByRole("table", { name: "Sales" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Time", "URIToken", "Collection", "Price", "Seller → buyer", "Sale", "Royalty"]);
    const cells = within(within(table).getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells[6]!.textContent).toBe("—");
    expect(screen.getByText("A sale is a URITokenBuy of a token offered for sale. URITokens carry no transfer fee, so there is no royalty.")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe("Covers ledger #26,533,927 onwards: earlier URITokens sales are not in the index yet.");
  });

  it("names the network of the sandbox in its breadcrumb", () => {
    mount(build({ ...XRPL, longName: "XRPL Testnet" }), "/xrpl/nfts/sales", LAYOUT_XRPL_TESTNET);
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "XRPL Testnet" }).getAttribute("href")).toBe("/xrpl");
  });

  it("is the same on the server as in the browser", async () => {
    const { html, errors } = await serverThenHydrated(routed(build(XRPL, { marker: "M2", back: ["M1"] }, { coverage: coverageSample({ complete: false }) })));
    expect(html).toContain("NFT sales");
    expect(errors).toEqual([]);
    expect((await serverThenHydrated(routed(build(XAHAU), "/xahau/nfts/sales", LAYOUT_XAHAU))).errors).toEqual([]);
  });
});
