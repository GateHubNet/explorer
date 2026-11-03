import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MPT_SAMPLE_HOLDER, MPT_SAMPLE_ID, MPT_SAMPLE_ISSUER, mptCoverageSample, mptHoldersSample, mptIssuanceSample, mptSample } from "../../../test/support/mpt-samples";
import { LAYOUT_XRPL, mountPage } from "../../../test/support/under-network";
import { NO_NAMES, type NameMap } from "../../domain/names";
import type { Loaded } from "../../server/account-view";
import type { MptIssuance, NodeMptIssuance } from "../../server/api-types";
import { mptHoldersPage, type MptHoldersPageData, type MptSource } from "../../server/mpt-view";
import { NO_FEATURES } from "../features";
import { NamesProvider } from "../names";
import { MptHoldersPage } from "./MptHoldersPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The holders page's data as the view builder writes it (`mptHoldersPage`), drawn under the `/:net` layout: the head with its line back to the issuance's page, the table of the holders with the MPT
// page's columns, the coverage note and the pager, a list the index has no rows for, and a list that failed.

const FEATURES = { ...NO_FEATURES, tokens: true, mpt: true };
const MPT_PATH = `/xrpl/mpt/${MPT_SAMPLE_ID}`;
const PATH = `${MPT_PATH}/holders`;
const ok = <T,>(value: T): Loaded<T> => ({ state: "ok", value });
const indexed = (over: Partial<MptIssuance> = {}): MptSource => ({ origin: "index", answer: mptSample({ issuance: mptIssuanceSample(over) }) });
const fromNode = (over: Partial<NodeMptIssuance> = {}): MptSource => ({
  origin: "node",
  node: { LedgerEntryType: "MPTokenIssuance", Issuer: MPT_SAMPLE_ISSUER, Sequence: 298, Flags: 0x22, AssetScale: 2, OutstandingAmount: "1820451120", ...over },
  ledgerIndex: 107_795_512,
  id: MPT_SAMPLE_ID,
});

function build(over: Partial<Parameters<typeof mptHoldersPage>[0]> = {}): MptHoldersPageData {
  return mptHoldersPage({ net: LAYOUT_XRPL, source: indexed(), page: ok(mptHoldersSample()), view: { back: [] }, names: NO_NAMES, ...over });
}

function mount(data: MptHoldersPageData, { at = PATH, network = LAYOUT_XRPL, names = {} }: { at?: string; network?: typeof LAYOUT_XRPL; names?: NameMap } = {}) {
  return mountPage(
    <NamesProvider names={names}>
      <MptHoldersPage data={data} />
    </NamesProvider>,
    "routes/net.mpt.$id.holders",
    { at, network, features: FEATURES },
  );
}

const card = (name: string) => screen.getByRole("region", { name });
const rowsOf = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell");
const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);

describe("MptHoldersPage: the head", () => {
  it("has the breadcrumb, with the issuance as a link and Holders as the current page", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "XRPL" }).getAttribute("href")).toBe("/xrpl");
    expect(crumbs.getByRole("link", { name: "Tokens" }).getAttribute("href")).toBe("/xrpl/tokens");
    expect(crumbs.getByRole("link", { name: "HTF" }).getAttribute("href")).toBe(MPT_PATH);
    expect(crumbs.getByText("Holders").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("XRPL/Tokens/HTF/Holders");
  });

  it("is a line that leads back to the issuance (the coin, the name as the link, the tags), the h1 Holders of HTF, what is held, the issuer in full, and the button back", () => {
    const { container } = mount(build());
    const line = container.querySelector(".mpt__headline")!;
    expect(line.querySelector("a")!.getAttribute("href")).toBe(MPT_PATH);
    expect(line.querySelector("a")!.textContent).toBe("Harborline Treasury Fund");
    expect(texts(line.querySelectorAll(".tag"))).toEqual(["HTF", "MPT"]);
    expect(container.querySelector(".amm__coin")!.textContent).toBe("H");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Holders of HTF");
    expect(screen.getByText("3,412 accounts hold 18,204,511.20 HTF")).toBeTruthy();
    expect(screen.getByText("Issued by")).toBeTruthy();
    expect(screen.getByRole("link", { name: MPT_SAMPLE_ISSUER }).getAttribute("href")).toBe(`/xrpl/account/${MPT_SAMPLE_ISSUER}`);
    expect(screen.getByRole("link", { name: "Back to HTF" }).getAttribute("href")).toBe(MPT_PATH);
  });

  it("says an issuance read from the network is not in the index yet, and its heading is the ID's start and end", () => {
    mount(build({ source: fromNode(), page: { state: "missing" } }));
    expect(screen.getByText("Not in the index yet, shown from the network").closest(".notice")!.classList.contains("notice--info")).toBe(true);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(`Holders of MPT ${MPT_SAMPLE_ID.slice(0, 8)}…${MPT_SAMPLE_ID.slice(-4)}`);
  });
});

describe("MptHoldersPage: the holders", () => {
  it("is a named table with the MPT page's columns, ranked on the first page", () => {
    mount(build());
    const holders = card("Holders");
    const table = within(holders).getByRole("table", { name: "Holders" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["#", "Holder", "Balance (HTF)", "Share of outstanding", "Balance state"]);
    const [first, second] = rowsOf(table);
    expect(cells(first!)[0]!.textContent).toBe("1");
    expect(within(cells(first!)[1]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${MPT_SAMPLE_HOLDER}`);
    expect(cells(first!)[2]!.textContent).toBe("6,120,400.00");
    expect(cells(first!)[3]!.textContent).toBe("33.62%");
    expect(cells(second!)[2]!.textContent).toBe("2,500,010.00incl. 10.00 in escrow");
    expect(cells(second!)[4]!.textContent).toBe("Locked");
    expect(within(holders).getByText(`/v2/mpt/${MPT_SAMPLE_ID}/holders`)).toBeTruthy();
  });

  // The whole-branch review's M1: above asset scale 19 the balances are the ledger's integers, so the column and the line under the heading say "units", while the heading keeps the ticker.
  it("writes 'units' in the balance column and under the heading above asset scale 19", () => {
    mount(build({ source: indexed({ asset_scale: 25 }) }));
    const table = within(card("Holders")).getByRole("table", { name: "Holders" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["#", "Holder", "Balance (units)", "Share of outstanding", "Balance state"]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Holders of HTF");
    expect(screen.getByText("3,412 accounts hold 1,820,451,120 units")).toBeTruthy();
  });

  it("has no rank column behind a marker, and the rest of the columns", () => {
    mount(build({ view: { marker: "M2", back: [] } }), { at: `${PATH}?marker=M2` });
    const table = within(card("Holders")).getByRole("table", { name: "Holders" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Holder", "Balance (HTF)", "Share of outstanding", "Balance state"]);
  });

  it("draws the share as a decorative meter beside the percent that says it", () => {
    const { container } = mount(build());
    const meter = card("Holders").querySelector(".meter")!;
    expect(meter.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll(".meter")).toHaveLength(2);
  });

  it("has Newer and Older by the trail, Older disabled on the last page, and the coverage note with the line after it while the index is incomplete", () => {
    mount(build({ page: ok(mptHoldersSample({ coverage: mptCoverageSample({ complete: false }), marker: "M3" })), view: { marker: "M2", back: ["M1"] } }), { at: `${PATH}?marker=M2&back=M1` });
    const holders = card("Holders");
    const pager = within(holders).getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: /Newer/ }).getAttribute("href")).toBe(`${PATH}?marker=M1`);
    expect(within(pager).getByRole("link", { name: /Older/ }).getAttribute("href")).toBe(`${PATH}?marker=M3&back=M2.M1`);
    expect(within(holders).getByRole("note").textContent).toBe("Covers ledger #99,226,369 onwards: earlier holders are not in the index yet.");
    expect(within(holders).getByText("A holder whose balance has not changed since is not listed yet.")).toBeTruthy();
  });

  it("has Newer disabled on the first page and no Older where there is no more", () => {
    mount(build({ page: ok(mptHoldersSample({ marker: undefined })) }));
    const pager = within(card("Holders")).getByRole("navigation", { name: "Pagination" });
    expect(within(pager).queryByRole("link")).toBeNull();
    expect(texts(pager.querySelectorAll("[aria-disabled=true]"))).toEqual(["Newer", "Older"]);
  });

  it("says nobody holds the token", () => {
    mount(build({ page: ok(mptHoldersSample({ holders: [], count: 0, marker: undefined })) }));
    expect(within(card("Holders")).getByText("Nobody holds HTF.")).toBeTruthy();
  });

  it("says the index has no rows for the issuance yet", () => {
    mount(build({ page: { state: "missing" } }));
    expect(within(card("Holders")).getByText("Not in the index yet.")).toBeTruthy();
    expect(within(card("Holders")).queryByRole("table")).toBeNull();
    expect(within(card("Holders")).queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("is told in its place, with a Retry that asks the route again, and the head stands", () => {
    const { loader } = mount(build({ page: { state: "failed" } }));
    const alert = within(card("Holders")).getByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load the holders.Retry");
    expect(within(card("Holders")).queryByRole("table")).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Holders of HTF");
    expect(screen.getByRole("link", { name: "Back to HTF" })).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

describe("MptHoldersPage: as a page", () => {
  it("never fetches", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    mount(build());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("holds the issuer's text as text: markup in the name is not markup, and the only link out of the head is the page's own", () => {
    const hostile = `"><img src=x onerror=alert(1)>`;
    const { container } = mount(build({ source: indexed({ name: hostile, metadata: undefined }) }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".mpt__headline a")!.textContent).toBe(hostile);
  });
});
