import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MPT_SAMPLE_HASH, MPT_SAMPLE_HOLDER, MPT_SAMPLE_ID, MPT_SAMPLE_ISSUER, MPT_SAMPLE_OTHER_HOLDER, mptCoverageSample, mptIssuanceSample, mptSample, mptTransfersSample } from "../../../test/support/mpt-samples";
import { LAYOUT_XRPL, mountPage } from "../../../test/support/under-network";
import { NO_NAMES, type NameMap, type NamesPart } from "../../domain/names";
import type { Loaded } from "../../server/account-view";
import type { MptIssuance } from "../../server/api-types";
import { mptTransfersPage, type MptSource, type MptTransfersPageData } from "../../server/mpt-view";
import { NO_FEATURES } from "../features";
import { NamesProvider } from "../names";
import { MptTransfersPage } from "./MptTransfersPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The transfers page's data as the view builder writes it (`mptTransfersPage`), drawn under the `/:net` layout: the head with its line back to the issuance's page, the table of the transfers with
// the MPT page's columns, the footnote, the coverage note and the pager, a list the index has no rows for, and a list that failed.

const FEATURES = { ...NO_FEATURES, tokens: true, mpt: true };
const MPT_PATH = `/xrpl/mpt/${MPT_SAMPLE_ID}`;
const PATH = `${MPT_PATH}/transfers`;
const ok = <T,>(value: T): Loaded<T> => ({ state: "ok", value });
const indexed = (over: Partial<MptIssuance> = {}): MptSource => ({ origin: "index", answer: mptSample({ issuance: mptIssuanceSample(over) }) });

function build(over: Partial<Parameters<typeof mptTransfersPage>[0]> = {}): MptTransfersPageData {
  return mptTransfersPage({ net: LAYOUT_XRPL, source: indexed(), page: ok(mptTransfersSample()), view: { back: [] }, names: NO_NAMES, ...over });
}

function mount(data: MptTransfersPageData, { at = PATH, names = {} }: { at?: string; names?: NameMap } = {}) {
  return mountPage(
    <NamesProvider names={names}>
      <MptTransfersPage data={data} />
    </NamesProvider>,
    "routes/net.mpt.$id.transfers",
    { at, network: LAYOUT_XRPL, features: FEATURES },
  );
}

const card = (name: string) => screen.getByRole("region", { name });
const rowsOf = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell");
const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);

describe("MptTransfersPage: the head", () => {
  it("has the breadcrumb, with the issuance as a link and Transfers as the current page", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "HTF" }).getAttribute("href")).toBe(MPT_PATH);
    expect(crumbs.getByText("Transfers").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("XRPL/Tokens/HTF/Transfers");
  });

  it("is the line back to the issuance, the h1 Transfers of HTF, what is held, the issuer in full, and the button back", () => {
    const { container } = mount(build());
    expect(container.querySelector(".mpt__headline a")!.getAttribute("href")).toBe(MPT_PATH);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Transfers of HTF");
    expect(screen.getByText("3,412 accounts hold 18,204,511.20 HTF")).toBeTruthy();
    expect(screen.getByRole("link", { name: MPT_SAMPLE_ISSUER }).getAttribute("href")).toBe(`/xrpl/account/${MPT_SAMPLE_ISSUER}`);
    expect(screen.getByRole("link", { name: "Back to HTF" }).getAttribute("href")).toBe(MPT_PATH);
  });
});

describe("MptTransfersPage: the transfers", () => {
  it("is a named table with the MPT page's columns, the rows with their kinds, parties, amounts and transactions", () => {
    mount(build());
    const transfers = card("Transfers");
    const table = within(transfers).getByRole("table", { name: "Transfers" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Time (UTC)", "Kind", "From", "To", "Amount (HTF)", "Transaction"]);
    const [payment, lock] = rowsOf(table);
    expect(cells(payment!)[1]!.textContent).toBe("Transfer");
    expect(within(cells(payment!)[2]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${MPT_SAMPLE_HOLDER}`);
    expect(within(cells(payment!)[3]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${MPT_SAMPLE_OTHER_HOLDER}`);
    expect(cells(payment!)[4]!.textContent).toBe("25,000.00");
    expect(within(cells(payment!)[5]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/tx/${MPT_SAMPLE_HASH}`);
    expect(cells(lock!)[1]!.textContent).toBe("Lock");
    expect(cells(lock!)[3]!.textContent).toBe("every holder");
    expect(cells(lock!)[4]!.querySelector(".muted")).not.toBeNull();
    expect(within(transfers).getByText(`/v2/mpt/${MPT_SAMPLE_ID}/transfers`)).toBeTruthy();
  });

  it("has the board's footnote with the issuer by its name", () => {
    const names: NamesPart = { state: "ok", map: { [MPT_SAMPLE_ISSUER]: { name: { text: "Harborline", kind: "verified" }, domain: "harborline.example", labels: [] } } };
    mount(build({ names }), { names: names.map });
    expect(within(card("Transfers")).getByText(/^Newest first\./).textContent).toBe(
      "Newest first. A transfer from Harborline issues new HTF. A clawback takes HTF back. A lock stops a balance from moving; its amount is the balance locked.",
    );
  });

  it("has Newer and Older by the trail and the coverage note of the transfers while the index is incomplete", () => {
    mount(build({ page: ok(mptTransfersSample({ coverage: mptCoverageSample({ complete: false }), marker: "M3" })), view: { marker: "M2", back: ["M1"] } }), { at: `${PATH}?marker=M2&back=M1` });
    const transfers = card("Transfers");
    const pager = within(transfers).getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: /Newer/ }).getAttribute("href")).toBe(`${PATH}?marker=M1`);
    expect(within(pager).getByRole("link", { name: /Older/ }).getAttribute("href")).toBe(`${PATH}?marker=M3&back=M2.M1`);
    expect(within(transfers).getByRole("note").textContent).toBe("Covers ledger #99,226,369 onwards: earlier transfers are not in the index yet.");
  });

  it("says there is no transfer in the index", () => {
    mount(build({ page: ok(mptTransfersSample({ transfers: [], count: 0, marker: undefined })) }));
    expect(within(card("Transfers")).getByText("No transfers of HTF in the index.")).toBeTruthy();
  });

  it("says the index has no rows for the issuance yet", () => {
    mount(build({ page: { state: "missing" } }));
    expect(within(card("Transfers")).getByText("Not in the index yet.")).toBeTruthy();
    expect(within(card("Transfers")).queryByRole("table")).toBeNull();
  });

  it("is told in its place, with a Retry that asks the route again, and the head stands", () => {
    const { loader } = mount(build({ page: { state: "failed" } }));
    const alert = within(card("Transfers")).getByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load the transfers.Retry");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Transfers of HTF");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("never fetches", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    mount(build());
    expect(fetch).not.toHaveBeenCalled();
  });
});
