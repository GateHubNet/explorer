import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { CHECK_ID, checkAnswerSample, historySample, MPT_ISSUANCE_ID, TOKEN_ISSUER } from "../../../test/support/object-samples";
import { stateOf, XAHAU, XRPL } from "../../../test/support/object-view-world";
import { LAYOUT_XAHAU, LAYOUT_XRPL, mountPage, routedPage } from "../../../test/support/under-network";
import { NO_NAMES, type NameMap } from "../../domain/names";
import type { CheckAnswer, CheckObject } from "../../server/api-types";
import { checkPage, type CheckPageData } from "../../server/check-view";
import type { LedgerObject } from "../../server/node-rpc";
import { NamesProvider } from "../names";
import { CheckPage } from "./CheckPage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The check page (ledger object pages spec 4.1 and 4.3, the Check board) drawn from what the view builder makes of the data API's sample check (test/support/object-samples.ts: up to 1 RLUSD
// from r9CaVb…DWyN to rBi1Qr…1tJ, written Oct 16, 2026, expired the same day, the page as of Oct 29, 2026 03:50:41 UTC), and drawn as the Worker prints it and then hydrated: the page the
// browser takes over is the one it was sent, and only then do the ages appear beside the times.

const PATH = `/xrpl/checks/${CHECK_ID}`;
const SOURCE = "r9CaVb4X1JVQoi6Q8Gw5cznAMRFARJDWyN";
const DESTINATION = "rBi1QrVjwaNofisZAQnovoXdHkS73FG1tJ";
const REMOVED = { ledger_index: 107_974_000, time: "2026-10-29T01:00:00Z", tx_hash: "C".repeat(64), tx_type: "CheckCash" };

/** The page's data from the sample's check (an expired one), with what `over` replaces in the check, as the loader builds it (no names: the route's provider has them). */
function build(over: Partial<CheckObject> = {}, o: { serverState?: ReturnType<typeof stateOf> | null; marker?: string; back?: string[]; events?: CheckAnswer["history"] } = {}): CheckPageData {
  const { serverState = stateOf(), marker, back = [], events = [] } = o;
  const answer = checkAnswerSample();
  answer.check = { ...answer.check, ...over };
  answer.history = [...events, ...answer.history];
  return checkPage({ origin: "index", answer }, { net: XRPL, serverState, names: NO_NAMES, back, ...(marker === undefined ? {} : { marker }) });
}

/** The page as the route draws it, in the names of its data. */
const page = (data: CheckPageData, names: NameMap = {}) => (
  <NamesProvider names={names}>
    <CheckPage data={data} />
  </NamesProvider>
);
const mount = (data: CheckPageData, names: NameMap = {}) => mountPage(page(data, names), "check", { at: PATH, network: LAYOUT_XRPL });

const RLUSD = { currency: "524C555344000000000000000000000000000000", issuer: TOKEN_ISSUER, value: "0.9" };
const removal = (txType: string) => ({ ledger_index: REMOVED.ledger_index, time: REMOVED.time, tx_hash: REMOVED.tx_hash, tx_type: txType, account: DESTINATION, result: "tesSUCCESS" });
const open = () => build({ status: "open", expiration: "2026-11-02T04:00:00Z" });
const cashed = () => build({ status: "cashed", removed: REMOVED, delivered: RLUSD }, { events: [{ event: "cash", ...removal("CheckCash"), delivered: RLUSD }] });
const cancelled = () => build({ status: "cancelled", removed: { ...REMOVED, tx_type: "CheckCancel" } }, { events: [{ event: "cancel", ...removal("CheckCancel") }] });

describe("CheckPage", () => {
  it("has one heading, the type, and the breadcrumb of the board with the source as a link", () => {
    mount(build());
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Check"]);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toBe("XRPL/Accounts/r9CaVb…DWyN/Check");
    expect(within(crumbs).getByRole("link", { name: "r9CaVb…DWyN" }).getAttribute("href")).toBe(`/xrpl/account/${SOURCE}`);
    expect(within(crumbs).getByRole("link", { name: "r9CaVb…DWyN" }).getAttribute("title")).toBe(SOURCE);
  });

  it("names the source's crumb by its name, with its mark, where the page's names have one", () => {
    mount(build(), { [SOURCE]: { name: { text: "Copperfield Payments", kind: "verified" }, domain: "copperfield.example", labels: [] } });
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    const source = within(crumbs).getByRole("link", { name: "Copperfield Payments verified name" });
    expect(source.querySelector(".acct__name")?.textContent).toBe("Copperfield Payments");
    expect(source.getAttribute("title")).toBe(`Verified by copperfield.example · ${SOURCE}`);
  });

  it("says its status with an icon and a word, never colour alone", () => {
    const { container } = mount(build());
    const pill = container.querySelector(".pill")!;
    expect([pill.textContent, pill.className, pill.querySelector("svg") !== null]).toEqual(["Expired", "pill pill--warn", true]);
    cleanup();
    const again = mount(open());
    const shown = again.container.querySelector(".pill")!;
    expect([shown.textContent, shown.className, shown.querySelector("svg") !== null]).toEqual(["Open", "pill pill--info", true]);
  });

  it("marks the check's state in the strip, aria-current and in words", () => {
    mount(build());
    const states = within(screen.getByRole("list", { name: "States" })).getAllByRole("listitem");
    expect(states.map((state) => state.getAttribute("aria-current"))).toEqual([null, null, null, "true"]);
    expect(states[3]!.textContent).toBe("Expired · this checkCan no longer be cashed; stays until someone cancels it.");
  });

  it("draws the banner of an expired check that is still in the ledger, with the board's heading and the reserve it holds", () => {
    const { container } = mount(build());
    const banner = screen.getByText("Expired, but still in the ledger").closest(".notice") as HTMLElement;
    expect(banner.textContent).toBe(
      "Expired, but still in the ledger" +
        "An expired check is not removed on its own. It stays until someone sends a CheckCancel, which anyone can do now; until then it holds 0.2 XRP of the source’s reserve.",
    );
    // It stands above the strip, with the head and the other banners, and is not the removed one.
    expect(container.textContent).not.toContain("Removed from the ledger");
    expect(banner.compareDocumentPosition(screen.getByRole("list", { name: "States" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says that part of the source's balance is reserved when the reserve is not known", () => {
    mount(build({}, { serverState: null }));
    const banner = screen.getByText("Expired, but still in the ledger").closest(".notice") as HTMLElement;
    expect(banner.textContent).toContain("until then it keeps part of the source’s balance reserved.");
  });

  it("has no such banner for an open, a cashed or a cancelled check", () => {
    for (const make of [open, cashed, cancelled]) {
      mount(make());
      expect(screen.queryByText("Expired, but still in the ledger")).toBeNull();
      cleanup();
    }
  });

  it("draws the flow's three nodes: the source, the check with its issuer as a link, and the destination", () => {
    mount(build());
    const flow = screen.getByRole("group", { name: "Flow of the check" });
    const nodes = [...flow.querySelectorAll(".flow__node")].map((node) => node.textContent);
    expect(nodes).toEqual([
      "Sourcer9CaVb…DWyNHas paid nothing",
      "Check · expired Oct 16, 2026up to 1 RLUSDissued by rMxCKb…m5De",
      "DestinationrBi1Qr…G1tJCan no longer cash it",
    ]);
    expect(within(flow).getByRole("link", { name: "rMxCKb…m5De" }).getAttribute("href")).toBe(`/xrpl/account/${TOKEN_ISSUER}`);
    expect(within(flow).getByRole("link", { name: "r9CaVb…DWyN" }).getAttribute("href")).toBe(`/xrpl/account/${SOURCE}`);
  });

  it("draws the flow of an open check with its expiry, of a cashed one with what moved, and the destination tag", () => {
    mount(open());
    const nodes = () => [...screen.getByRole("group", { name: "Flow of the check" }).querySelectorAll(".flow__node")].map((node) => node.textContent);
    expect(nodes()).toEqual([
      "Sourcer9CaVb…DWyNPays when the check is cashed",
      "Check · expires Nov 2, 2026up to 1 RLUSDissued by rMxCKb…m5De",
      "DestinationrBi1Qr…G1tJCan cash up to 1 RLUSD",
    ]);
    cleanup();
    mount(cashed());
    expect(nodes()).toEqual([
      "Sourcer9CaVb…DWyN−0.9 RLUSD",
      "Check · cashed Oct 29, 2026up to 1 RLUSDissued by rMxCKb…m5De",
      "DestinationrBi1Qr…G1tJ+0.9 RLUSD",
    ]);
    cleanup();
    mount(build({ destination_tag: 7 }));
    expect(screen.getByText("Destination · tag 7")).toBeTruthy();
  });

  it("draws the summary, the status lines and the Details rows with the ledger's field names, the hints and a copy button for the ID", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T04:00:00Z"));
    mount(build());
    const details = screen.getByRole("region", { name: "Details" });
    expect(details.querySelector(".object-page__summary")!.textContent).toBe("r9CaVb…DWyN wrote a check for up to 1 RLUSD to rBi1Qr…G1tJ on Oct 16, 2026.");
    expect([...details.querySelectorAll(".object-page__status p")].map((line) => line.textContent)).toEqual([
      "Expired: it can no longer be cashed",
      "Its expiration passed on Oct 16, 2026, 17:49 UTC12 d ago. Nothing was paid, and nothing will be.",
    ]);
    const term = (label: string) => within(details).getByText(label, { selector: "dt" });
    expect(term("Check ID").textContent).toBe("Check IDledger object ID");
    expect(term("Can be cashed for").textContent).toBe("Can be cashed forSendMax");
    expect(term("Can be cashed for").nextElementSibling!.textContent).toBe(
      "1 RLUSDissued by rMxCKb…m5DeThe most the destination can cash. Nothing is set aside: the source must hold the RLUSD when the check is cashed.",
    );
    expect(term("Invoice ID").nextElementSibling!.textContent).toContain("Set by the source, for example the hash of an invoice");
    expect(term("Owner reserve").nextElementSibling!.textContent).toBe("0.2 XRPHeld from the source’s balance while the check exists.");
    expect(within(details).getByRole("button", { name: "Copy check ID" })).toBeTruthy();
    expect(within(details).getByRole("button", { name: "Copy invoice ID" })).toBeTruthy();
    expect(details.textContent).toContain("As of ledger #107,972,102, Oct 29, 2026, 03:50 UTC.");
  });

  it("has no Owner reserve row when the server state failed", () => {
    mount(build({}, { serverState: null }));
    expect(screen.queryByText("Owner reserve")).toBeNull();
    expect(screen.getByText("Source tag")).toBeTruthy();
  });

  it("draws the Source and Destination rows with their whole addresses beside the name", () => {
    mount(build(), { [DESTINATION]: { name: { text: "lowtide.example", kind: "domain" }, labels: [] } });
    const row = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
    expect(row("Source").textContent).toContain(SOURCE);
    expect(row("Destination").textContent).toContain("lowtide.example");
    expect(row("Destination").textContent).toContain(DESTINATION);
  });

  it("draws an MPT SendMax raw, a token's issuer as a link, and a dash for an amount D5 could not read", () => {
    const amountRow = () => screen.getByText("Can be cashed for", { selector: "dt" }).nextElementSibling as HTMLElement;
    mount(build({ send_max: { currency: MPT_ISSUANCE_ID, issuer: SOURCE, value: "500", mpt_issuance_id: MPT_ISSUANCE_ID } }));
    expect(amountRow().textContent).toMatch(/^500 units of MPT 0000012A…/);
    expect(within(amountRow()).queryByRole("link")).toBeNull();
    // The flow has no issuer for an MPT either.
    expect(screen.getByRole("group", { name: "Flow of the check" }).textContent).not.toContain("issued by");
    cleanup();
    mount(build());
    expect(within(amountRow()).getByRole("link", { name: "rMxCKb…m5De" })).toBeTruthy();
    cleanup();
    mount(build({ send_max: undefined }));
    expect(amountRow().textContent).toMatch(/^—/);
    expect(document.querySelector(".object-page__summary")!.textContent).toBe("r9CaVb…DWyN wrote a check to rBi1Qr…G1tJ on Oct 16, 2026.");
    expect(screen.getByRole("group", { name: "Flow of the check" }).querySelector(".flow__amount")!.textContent).toBe("—");
  });

  it("draws the timeline oldest first with its footnote, the marks and what can still happen", () => {
    mount(build());
    const history = screen.getByRole("region", { name: "History" });
    const items = within(history).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector(".timeline__head")!.textContent)).toEqual(["CheckCreateCreated", "ExpirationPassed", "CheckCancelNot cancelled yet"]);
    expect(within(items[0]!).getByRole("link", { name: "CheckCreate transaction CCDBCA…0326" })).toBeTruthy();
    expect(history.textContent).toContain("Oldest first. Filled dots are transactions; dashed ones are what can still happen.");
  });

  it("draws the removed banner of a cashed check, with its two links, and the board's fixed line", () => {
    mount(cashed());
    const banner = screen.getByText(/^Removed from the ledger in ledger/).closest(".notice") as HTMLElement;
    expect(banner.textContent).toBe(
      "Removed from the ledger in ledger #107,974,000 by CheckCash CCCCCC…CCCC" +
        "Cashed on Oct 29, 2026, 01:00 UTC; 0.9 RLUSD went to the destination. This page shows it from history: its last state before it was removed.",
    );
    expect(within(banner).getByRole("link", { name: "#107,974,000" }).getAttribute("href")).toBe("/xrpl/ledger/107974000");
    expect(within(banner).getByRole("link", { name: "CheckCash transaction CCCCCC…CCCC" }).getAttribute("href")).toBe(`/xrpl/tx/${"C".repeat(64)}`);
    expect(screen.getByText("Delivered", { selector: "dt" }).nextElementSibling!.textContent).toMatch(/^0\.9 RLUSD/);
  });

  it("draws a page behind a marker with Newer and Older", () => {
    // The second page of older events (reached from the first's M1), which has a third behind it (M3).
    const data = checkPage(
      { origin: "index", answer: checkAnswerSample({ history_marker: "M1" }), history: historySample({ marker: "M3" }) },
      { net: XRPL, serverState: stateOf(), names: NO_NAMES, marker: "M2", back: ["M1"] },
    );
    mountPage(page(data), "check", { at: `${PATH}?marker=M2&back=M1`, network: LAYOUT_XRPL });
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Newer" }).getAttribute("href")).toBe(`${PATH}?marker=M1`);
    expect(within(pager).getByRole("link", { name: "Older" }).getAttribute("href")).toBe(`${PATH}?marker=M3&back=M2.M1`);
  });

  it("draws a check read from the node: the ledger it last changed in and the node's note", () => {
    const entry: LedgerObject = {
      LedgerEntryType: "Check",
      index: CHECK_ID,
      Account: SOURCE,
      Destination: DESTINATION,
      SendMax: "2000000000",
      PreviousTxnID: "D".repeat(64),
      PreviousTxnLgrSeq: 107_000_000,
    };
    const data = checkPage({ origin: "node", entry, ledgerIndex: 107_972_102, now: 1_792_000_000 }, { net: XRPL, serverState: stateOf(), names: NO_NAMES, back: [] });
    mount(data);
    expect(screen.getByText(/^Last changed in ledger/).textContent).toBe("Last changed in ledger #107,000,000 by transaction DDDDDD…DDDD");
    expect(screen.getByText("Read live from the network at ledger #107,972,102.")).toBeTruthy();
    expect(screen.getByText("The index does not hold this history yet.")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Flow of the check" }).textContent).toContain("up to 2,000 XRP");
  });

  it("is Xahau's in XAH, with Xahau in the breadcrumb", () => {
    const answer = checkAnswerSample();
    answer.check = { ...answer.check, status: "open", send_max: { currency: "XAH", value: "200" } };
    const data = checkPage({ origin: "index", answer }, { net: XAHAU, serverState: stateOf(), names: NO_NAMES, back: [] });
    mountPage(page(data), "check", { at: `/xahau/checks/${CHECK_ID}`, network: LAYOUT_XAHAU });
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Xahau/Accounts/r9CaVb…DWyN/Check");
    expect((screen.getByText("Owner reserve", { selector: "dt" }).nextElementSibling as HTMLElement).textContent).toMatch(/^0\.2 XAH/);
    expect(screen.getByRole("group", { name: "Flow of the check" }).textContent).toContain("up to 200 XAH");
  });
});

describe("CheckPage: the page the Worker prints is the page the browser takes over", () => {
  it.each([
    ["an expired check", () => build()],
    ["an open check", open],
    ["a cashed check", cashed],
    ["a cancelled check", cancelled],
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
    // What the browser took over: the pill's icon and word, the state marked in the strip, the flow's three boxes, the timeline.
    expect(container.querySelector(".pill svg")).not.toBeNull();
    expect(container.querySelector(".pill")!.textContent).not.toBe("");
    expect(container.querySelectorAll('.states__list [aria-current="true"]')).toHaveLength(1);
    expect(container.querySelectorAll(".flow__node")).toHaveLength(3);
    expect(container.querySelectorAll(".timeline__item").length).toBeGreaterThan(1);
  });

  it("puts the age of a date in a status line beside it: the countdown of one to come, the age of one that passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T04:00:00Z"));
    const lines = async (data: CheckPageData) => {
      const { container } = await serverThenHydrated(routedPage(page(data), { at: PATH }));
      await act(async () => {});
      return [...container.querySelectorAll(".object-page__status p")].map((line) => line.textContent);
    };
    expect(await lines(open())).toEqual([
      "The destination can cash up to 1 RLUSD until Nov 2, 2026, 04:00 UTCin 4 days",
      "Nothing is set aside: the RLUSD comes from the source’s balance when the check is cashed, so the source must still hold it then. The source can cancel the check at any time.",
    ]);
    cleanup();
    expect(await lines(build())).toEqual(["Expired: it can no longer be cashed", "Its expiration passed on Oct 16, 2026, 17:49 UTC12 d ago. Nothing was paid, and nothing will be."]);
    cleanup();
    expect((await lines(cashed()))[1]).toBe("Cashed on Oct 29, 2026, 01:00 UTC3 h ago, for 0.9 RLUSD of the 1 RLUSD it allowed.");
  });
});
