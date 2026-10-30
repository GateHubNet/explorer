import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { ESCROW_DESTINATION, ESCROW_ID, ESCROW_OWNER, escrowAnswerSample, historySample } from "../../../test/support/object-samples";
import { stateOf, XAHAU, XRPL } from "../../../test/support/object-view-world";
import { LAYOUT_XAHAU, LAYOUT_XRPL, mountPage, routedPage } from "../../../test/support/under-network";
import { NO_NAMES, type NameMap } from "../../domain/names";
import type { EscrowAnswer } from "../../server/api-types";
import { escrowPage, type EscrowPageData } from "../../server/escrow-view";
import type { LedgerObject } from "../../server/node-rpc";
import { NamesProvider } from "../names";
import { EscrowPage } from "./EscrowPage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The escrow page (ledger object pages spec 4.1 and 4.2, the Escrow board) drawn from what the view builder makes of the data API's sample escrow (test/support/object-samples.ts: 0.5 XRP
// from rNeJW7…Ks6V, created Oct 25, 2026 16:49:20 UTC, FinishAfter a minute later, CancelAfter an hour later, the page as of Oct 29, 2026 03:50:41 UTC: it can be cancelled), and drawn as
// the Worker prints it and then hydrated: the page the browser takes over is the one it was sent, and only then do the ages appear beside the times.

const PATH = `/xrpl/escrows/${ESCROW_ID}`;

/** The page's data from the sample's answer, with what `over` replaces, as the loader builds it (no names: the route's provider has them). */
function build(over: Partial<EscrowAnswer> = {}, o: { serverState?: ReturnType<typeof stateOf> | null; marker?: string; back?: string[] } = {}): EscrowPageData {
  const { serverState = stateOf(), marker, back = [] } = o;
  return escrowPage({ origin: "index", answer: escrowAnswerSample(over) }, { net: XRPL, serverState, names: NO_NAMES, back, ...(marker === undefined ? {} : { marker }) });
}

/** The page as the route draws it, in the names of its data. */
const page = (data: EscrowPageData, names: NameMap = {}) => (
  <NamesProvider names={names}>
    <EscrowPage data={data} />
  </NamesProvider>
);
const mount = (data: EscrowPageData, names: NameMap = {}) => mountPage(page(data, names), "escrow", { at: PATH, network: LAYOUT_XRPL });

const pending = () =>
  build({
    escrow: { ...escrowAnswerSample().escrow, status: "pending", finish_after: "2026-11-01T00:00:00Z", cancel_after: "2027-01-01T00:00:00Z" },
  });

describe("EscrowPage", () => {
  it("has one heading, the type, and the breadcrumb of the board with the owner as a link", () => {
    mount(build());
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Escrow"]);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toBe("XRPL/Accounts/rNeJW7…Ks6V/Escrow");
    expect(within(crumbs).getByRole("link", { name: "rNeJW7…Ks6V" }).getAttribute("href")).toBe(`/xrpl/account/${ESCROW_OWNER}`);
    expect(within(crumbs).getByRole("link", { name: "rNeJW7…Ks6V" }).getAttribute("title")).toBe(ESCROW_OWNER);
  });

  it("names the owner's crumb by its name, with its mark, where the page's names have one", () => {
    mount(build(), { [ESCROW_OWNER]: { name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example", labels: [] } });
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    const owner = within(crumbs).getByRole("link", { name: "Northpeak Treasury verified name" });
    expect(owner.querySelector(".acct__name")?.textContent).toBe("Northpeak Treasury");
    expect(owner.getAttribute("title")).toBe(`Verified by northpeak.example · ${ESCROW_OWNER}`);
  });

  it("says its status with an icon and a word, never colour alone", () => {
    const { container } = mount(build());
    const pill = container.querySelector(".pill")!;
    expect(pill.textContent).toBe("Can be cancelled");
    expect(pill.className).toBe("pill pill--warn");
    expect(pill.querySelector("svg")).not.toBeNull();
    cleanup();
    const again = mount(pending());
    const shown = again.container.querySelector(".pill")!;
    expect([shown.textContent, shown.className, shown.querySelector("svg") !== null]).toEqual(["Pending", "pill pill--info", true]);
  });

  it("marks the escrow's state in the strip, aria-current and in words", () => {
    mount(build());
    const states = within(screen.getByRole("list", { name: "States" })).getAllByRole("listitem");
    expect(states.map((state) => state.getAttribute("aria-current"))).toEqual([null, null, "true", null, null]);
    expect(states[2]!.textContent).toBe("Can be cancelled · this escrowCancelAfter has passed: anyone can cancel it.");
  });

  it("draws the window bar's windows as buttons named by their ranges", () => {
    mount(build());
    const bar = screen.getByRole("group", { name: "When the escrow can be finished or cancelled" });
    expect(within(bar).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Pending: Oct 25, 2026, 16:49 UTC to Oct 25, 2026, 16:50 UTC",
      "Can be finished: Oct 25, 2026, 16:50 UTC to Oct 25, 2026, 17:49 UTC",
      "Can be cancelled: From Oct 25, 2026, 17:49 UTC, with no end",
    ]);
  });

  it("draws the timeline oldest first, its footnote, and the marks and what can still happen", () => {
    mount(build());
    const history = screen.getByRole("region", { name: "History" });
    const items = within(history).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector(".timeline__head")!.textContent)).toEqual([
      "EscrowCreateCreated",
      "FinishAfterPassed",
      "CancelAfterPassed",
      "EscrowCancelNot cancelled yet",
    ]);
    expect(within(items[0]!).getByRole("link", { name: "EscrowCreate transaction BF93E9…AE53" })).toBeTruthy();
    expect(history.textContent).toContain("Oldest first. Filled dots are transactions; dashed ones are what can still happen.");
  });

  it("draws the Details rows with the ledger's field names and the board's hints, and the owner reserve from the server state", () => {
    mount(build());
    const details = screen.getByRole("region", { name: "Details" });
    const term = (label: string) => within(details).getByText(label, { selector: "dt" });
    expect(term("Escrow ID").textContent).toBe("Escrow IDledger object ID");
    expect(term("Owner").textContent).toBe("Ownersource");
    expect(term("Can be finished after").textContent).toBe("Can be finished afterFinishAfter");
    expect(term("Owner reserve").nextElementSibling!.textContent).toBe(
      "0.2 XRPHeld from the owner’s balance while the escrow exists; released when it is finished or cancelled.",
    );
    expect(within(details).getByRole("button", { name: "Copy escrow ID" })).toBeTruthy();
    expect(within(term("Destination").nextElementSibling as HTMLElement).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${ESCROW_DESTINATION}`);
    expect(details.textContent).toContain("As of ledger #107,972,102, Oct 29, 2026, 03:50 UTC.");
  });

  it("has no Owner reserve row when the server state failed", () => {
    mount(build({}, { serverState: null }));
    expect(screen.queryByText("Owner reserve")).toBeNull();
    expect(screen.getByText("Source tag")).toBeTruthy();
  });

  it("draws the removed banner of a finished escrow, with its two links, and the board's fixed line", () => {
    const answer = escrowAnswerSample();
    const removed = { ledger_index: 107_974_000, time: "2026-10-29T05:00:00Z", tx_hash: "C".repeat(64), tx_type: "EscrowFinish" };
    mount(build({ escrow: { ...answer.escrow, status: "finished", removed } }));
    const banner = screen.getByText(/^Removed from the ledger in ledger/).closest(".notice")!;
    expect(banner.textContent).toBe(
      "Removed from the ledger in ledger #107,974,000 by EscrowFinish CCCCCC…CCCC" +
        "Finished on Oct 29, 2026, 05:00 UTC; the 0.5 XRP went to the destination. This page shows it from history: its last state before it was removed.",
    );
    expect(within(banner as HTMLElement).getByRole("link", { name: "#107,974,000" }).getAttribute("href")).toBe("/xrpl/ledger/107974000");
    expect(within(banner as HTMLElement).getByRole("link", { name: "EscrowFinish transaction CCCCCC…CCCC" }).getAttribute("href")).toBe(`/xrpl/tx/${"C".repeat(64)}`);
  });

  it("draws an MPT amount as its raw units and an issuer's token with the issuer as a link", () => {
    const answer = escrowAnswerSample();
    mount(build({ escrow: { ...answer.escrow, amount: { currency: "USD", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", value: "12.5" } } }));
    const amount = screen.getByText("Amount", { selector: "dt" }).nextElementSibling as HTMLElement;
    expect(amount.textContent).toBe("12.5 USDissued by rMxCKb…m5De");
    expect(within(amount).getByRole("link").getAttribute("href")).toBe("/xrpl/account/rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De");
    cleanup();
    mount(build({ escrow: { ...answer.escrow, amount: { currency: "0000012A95A7A415885FFF5E78A9B0A51C3EAF118ACD071A", issuer: ESCROW_OWNER, value: "500", mpt_issuance_id: "0000012A95A7A415885FFF5E78A9B0A51C3EAF118ACD071A" } } }));
    expect((screen.getByText("Amount", { selector: "dt" }).nextElementSibling as HTMLElement).textContent).toBe("500 units of MPT 0000012A…");
    cleanup();
    mount(build({ escrow: { ...answer.escrow, amount: undefined } }));
    expect((screen.getByText("Amount", { selector: "dt" }).nextElementSibling as HTMLElement).textContent).toBe("—");
  });

  it("draws a page behind a marker with Newer and Older", () => {
    // The second page of older events (reached from the first's M1), which has a third behind it (M3).
    const data = escrowPage(
      { origin: "index", answer: escrowAnswerSample({ history_marker: "M1" }), history: historySample({ marker: "M3" }) },
      { net: XRPL, serverState: stateOf(), names: NO_NAMES, marker: "M2", back: ["M1"] },
    );
    mountPage(page(data), "escrow", { at: `${PATH}?marker=M2&back=M1`, network: LAYOUT_XRPL });
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Newer" }).getAttribute("href")).toBe(`${PATH}?marker=M1`);
    expect(within(pager).getByRole("link", { name: "Older" }).getAttribute("href")).toBe(`${PATH}?marker=M3&back=M2.M1`);
  });

  it("draws an escrow read from the node: the ledger it last changed in and the node's note", () => {
    const entry: LedgerObject = {
      LedgerEntryType: "Escrow",
      index: ESCROW_ID,
      Account: ESCROW_OWNER,
      Destination: ESCROW_DESTINATION,
      Amount: "500000",
      FinishAfter: 815_000_000,
      PreviousTxnID: "D".repeat(64),
      PreviousTxnLgrSeq: 107_000_000,
    };
    const data = escrowPage({ origin: "node", entry, ledgerIndex: 107_972_102, now: 1_792_000_000 }, { net: XRPL, serverState: stateOf(), names: NO_NAMES, back: [] });
    mount(data);
    expect(screen.getByText(/^Last changed in ledger/).textContent).toBe("Last changed in ledger #107,000,000 by transaction DDDDDD…DDDD");
    expect(screen.getByText("Read live from the network at ledger #107,972,102.")).toBeTruthy();
    expect(screen.getByText("The index does not hold this history yet.")).toBeTruthy();
  });

  it("is Xahau's in XAH, with Xahau in the breadcrumb", () => {
    const answer = escrowAnswerSample();
    const data = escrowPage(
      { origin: "index", answer: { ...answer, escrow: { ...answer.escrow, amount: { currency: "XAH", value: "200" } } } },
      { net: XAHAU, serverState: stateOf(), names: NO_NAMES, back: [] },
    );
    mountPage(page(data), "escrow", { at: `/xahau/escrows/${ESCROW_ID}`, network: LAYOUT_XAHAU });
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Xahau/Accounts/rNeJW7…Ks6V/Escrow");
    expect((screen.getByText("Owner reserve", { selector: "dt" }).nextElementSibling as HTMLElement).textContent).toMatch(/^0\.2 XAH/);
  });
});

describe("EscrowPage: the page the Worker prints is the page the browser takes over", () => {
  it.each([
    ["an escrow that can be cancelled", () => build()],
    ["a pending escrow", pending],
    ["a finished escrow", () => build({ escrow: { ...escrowAnswerSample().escrow, status: "finished", removed: { ledger_index: 107_974_000, time: "2026-10-29T05:00:00Z", tx_hash: "C".repeat(64), tx_type: "EscrowFinish" } } })],
    ["one without its reserve", () => build({}, { serverState: null })],
  ])("hydrates %s without a mismatch, with no age in the HTML and the ages beside the times once it is the browser's", async (_name, make) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T04:00:00Z"));
    const { html, container, errors } = await serverThenHydrated(routedPage(page(make()), { at: PATH }));
    expect(errors).toEqual([]);
    expect(html).toContain("<h1");
    expect(html).not.toMatch(/\b\d+ (?:s|min|h|d) ago|\bin (?:under a minute|\d+ (?:min|h|days))/);
    await act(async () => {});
    // (No `\b` after the words: in `textContent` the next element's text follows them at once.)
    expect(container.textContent).toMatch(/\b\d+ (?:s|min|h|d) ago/);
    // What the browser took over: the pill's icon and word, the state marked in the strip, the bar's buttons, the timeline.
    expect(container.querySelector(".pill svg")).not.toBeNull();
    expect(container.querySelector(".pill")!.textContent).not.toBe("");
    expect(container.querySelectorAll('.states__list [aria-current="true"]')).toHaveLength(1);
    expect(container.querySelectorAll(".wbar__seg").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".timeline__item").length).toBeGreaterThan(1);
  });

  it("tells a removed escrow's ages against the moment the page is as of, as a check's and a channel's are, not against the removal", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T04:00:00Z"));
    const removed = { ledger_index: 107_000_000, time: "2026-10-20T00:00:00Z", tx_hash: "A".repeat(64), tx_type: "EscrowFinish" };
    const data = build({
      close_time: "2026-10-29T03:50:41Z",
      escrow: { ...escrowAnswerSample().escrow, status: "finished", finish_after: "2026-10-01T00:00:00Z", cancel_after: "2026-10-25T04:00:00Z", removed },
    });
    const { container } = await serverThenHydrated(routedPage(page(data), { at: PATH }));
    await act(async () => {});
    const row = [...container.querySelectorAll("dd")].find((each) => each.textContent!.startsWith("2026-10-25 04:00:00 UTC"))!;
    expect(row.textContent).toContain("· 4 d ago");
    expect(row.textContent).not.toContain("passed");
  });

  it("puts the age of a date in a status line beside it, the countdown of one to come and the age of one that passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T04:00:00Z"));
    const data = escrowPage(
      {
        origin: "index",
        answer: escrowAnswerSample({
          close_time: "2026-10-29T03:50:41Z",
          escrow: { ...escrowAnswerSample().escrow, status: "pending", finish_after: "2026-11-02T04:00:00Z", cancel_after: "2026-12-01T00:00:00Z" },
        }),
      },
      { net: XRPL, serverState: stateOf(), names: NO_NAMES, back: [] },
    );
    const { container } = await serverThenHydrated(routedPage(page(data), { at: PATH }));
    await act(async () => {});
    const lines = [...container.querySelectorAll(".object-page__status p")].map((line) => line.textContent);
    expect(lines).toEqual([
      "Can be finished by anyone after Nov 2, 2026, 04:00 UTCin 4 days",
      "Until then the 0.5 XRP stay locked. From Dec 1, 2026, 00:00 UTCin 33 days it can no longer be finished, only cancelled.",
    ]);
  });
});
