import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { CHANNEL_ID, historySample, MPT_ISSUANCE_ID, paymentChannelAnswerSample, TOKEN_ISSUER } from "../../../test/support/object-samples";
import { stateOf, XAHAU, XRPL } from "../../../test/support/object-view-world";
import { LAYOUT_XAHAU, LAYOUT_XRPL, mountPage, routedPage } from "../../../test/support/under-network";
import { NO_NAMES, type NameMap } from "../../domain/names";
import type { ObjectEvent, PaymentChannelAnswer } from "../../server/api-types";
import type { LedgerObject } from "../../server/node-rpc";
import { paymentChannelPage, type PaymentChannelPageData } from "../../server/payment-channel-view";
import { NamesProvider } from "../names";
import { PaymentChannelPage } from "./PaymentChannelPage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The payment channel page (ledger object pages spec 4.1 and 4.4, the PayChannel board) drawn from what the view builder makes of the data API's sample channel (test/support/object-samples.ts:
// 1 XRP from rQQQrU…3ZrM to rLggTE…KrtR, opened Oct 13, 2026, 0.032185 XRP paid out in one claim, the page as of Oct 29, 2026 03:50:41 UTC), and drawn as the Worker prints it and then hydrated:
// the page the browser takes over is the one it was sent, and only then do the ages appear beside the times.

const PATH = `/xrpl/payment-channels/${CHANNEL_ID}`;
const SOURCE = "rQQQrUdN1cLdNmxH4dHfKgmX5P4kf3ZrM";
const DESTINATION = "rLggTEwmTe3eJgyQbCSk4wQazow2TeKrtR";
const REMOVED = { ledger_index: 107_974_000, time: "2026-10-29T01:00:00Z", tx_hash: "C".repeat(64), tx_type: "PaymentChannelClaim" };
const xrp = (value: string) => ({ currency: "XRP", value });

type Channel = PaymentChannelAnswer["payment_channel"];

/** The page's data from the sample's channel (an open one), with what `over` replaces in the channel, as the loader builds it (no names: the route's provider has them). */
function build(
  over: Partial<Channel> = {},
  o: { serverState?: ReturnType<typeof stateOf> | null; marker?: string; back?: string[]; events?: ObjectEvent[] } = {},
): PaymentChannelPageData {
  const { serverState = stateOf(), marker, back = [], events = [] } = o;
  const answer = paymentChannelAnswerSample();
  answer.payment_channel = { ...answer.payment_channel, ...over };
  answer.history = [...events, ...answer.history];
  return paymentChannelPage({ origin: "index", answer }, { net: XRPL, serverState, names: NO_NAMES, back, ...(marker === undefined ? {} : { marker }) });
}

/** The page as the route draws it, in the names of its data. */
const page = (data: PaymentChannelPageData, names: NameMap = {}) => (
  <NamesProvider names={names}>
    <PaymentChannelPage data={data} />
  </NamesProvider>
);
const mount = (data: PaymentChannelPageData, names: NameMap = {}) => mountPage(page(data, names), "payment-channel", { at: PATH, network: LAYOUT_XRPL });

const closeEvent = (): ObjectEvent => ({
  event: "close",
  ledger_index: REMOVED.ledger_index,
  time: REMOVED.time,
  tx_hash: REMOVED.tx_hash,
  tx_type: REMOVED.tx_type,
  account: DESTINATION,
  result: "tesSUCCESS",
  amount: xrp("1"),
  balance: xrp("0.4"),
  balance_change: xrp("0.367815"),
});
const closing = () => build({ status: "closing", expiration: "2026-11-02T04:00:00Z" });
const closed = () => build({ status: "closed", balance: xrp("0.4"), remaining: xrp("0.6"), removed: REMOVED }, { events: [closeEvent()] });
/** A channel another transaction removed (an AccountDelete, say): where its remainder went is not known. */
const removed = () => build({ status: "removed", removed: { ...REMOVED, tx_type: "AccountDelete" } });

const deposit = () => screen.getByRole("group", { name: "Deposit paid out and left" });

describe("PaymentChannelPage", () => {
  it("has one heading, the type, and the breadcrumb of the board with the source as a link", () => {
    mount(build());
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Payment channel"]);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toBe("XRPL/Accounts/rQQQrU…3ZrM/Payment channel");
    expect(within(crumbs).getByRole("link", { name: "rQQQrU…3ZrM" }).getAttribute("href")).toBe(`/xrpl/account/${SOURCE}`);
    expect(within(crumbs).getByRole("link", { name: "rQQQrU…3ZrM" }).getAttribute("title")).toBe(SOURCE);
  });

  it("names the source's crumb by its name, with its mark, where the page's names have one", () => {
    mount(build(), { [SOURCE]: { name: { text: "Streamline Ltd", kind: "verified" }, domain: "streamline.example", labels: [] } });
    const source = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Streamline Ltd verified name" });
    expect(source.querySelector(".acct__name")?.textContent).toBe("Streamline Ltd");
    expect(source.getAttribute("title")).toBe(`Verified by streamline.example · ${SOURCE}`);
  });

  it("says its status with an icon and a word, never colour alone", () => {
    const { container } = mount(build());
    const pill = container.querySelector(".pill")!;
    expect([pill.textContent, pill.className, pill.querySelector("svg") !== null]).toEqual(["Open", "pill pill--info", true]);
    cleanup();
    const again = mount(closing());
    const shown = again.container.querySelector(".pill")!;
    expect([shown.textContent, shown.className, shown.querySelector("svg") !== null]).toEqual(["Closing", "pill pill--warn", true]);
  });

  it("marks the channel's state in the strip, aria-current and in words", () => {
    mount(build());
    const states = within(screen.getByRole("list", { name: "States" })).getAllByRole("listitem");
    expect(states.map((state) => state.getAttribute("aria-current"))).toEqual(["true", null, null]);
    expect(states[0]!.textContent).toBe("Open · this channelClaims can be redeemed; no close requested.");
  });

  it("does not say a close was requested of a channel that is closing only because its CancelAfter passed", () => {
    mount(build({ status: "closing", cancel_after: "2026-10-20T00:00:00Z" }));
    const states = within(screen.getByRole("list", { name: "States" })).getAllByRole("listitem");
    expect(states[1]!.textContent).toBe("Closing · this channelCancelAfter has passed; any transaction on the channel now closes it.");
    cleanup();
    mount(closing());
    expect(within(screen.getByRole("list", { name: "States" })).getAllByRole("listitem")[1]!.textContent).toContain("Close requested; it closes after the settle delay.");
  });

  it("draws the summary and the status lines, the deposit bar and the board's paragraph on claims", () => {
    mount(build());
    const details = screen.getByRole("region", { name: "Details" });
    expect(details.querySelector(".object-page__summary")!.textContent).toBe("rQQQrU…3ZrM opened a payment channel to rLggTE…KrtR on Oct 13, 2026, with 1 XRP deposited in all.");
    expect([...details.querySelectorAll(".object-page__status p")].map((line) => line.textContent)).toEqual([
      "Open: 0.967815 XRP of 1 XRP left to pay out",
      "The destination has redeemed claims for 0.032185 XRP so far. No close has been requested, and no end time is set.",
    ]);
    expect(details.textContent).toContain(
      "Payments in a channel are claims: the source signs them off the ledger, each for a larger running total, and the destination redeems the latest one on the ledger, so many payments settle in a few transactions.",
    );
  });

  it("draws the deposit bar's one row of two parts, the legend, and the amount and share under it", () => {
    const { container } = mount(build());
    const group = deposit();
    // The bar: the row of the deposit, its total with the currency, and a part for each of the two (the slots the view chose).
    const row = group.querySelector(".share__row")!;
    expect(row.querySelector(".share__name")!.textContent).toBe("Deposit1 XRP");
    expect([...group.querySelectorAll(".share__seg")].map((seg) => seg.getAttribute("data-slot"))).toEqual(["1", "neutral"]);
    expect(group.querySelector('[role="img"]')!.getAttribute("aria-label")).toContain("Deposit: largest Left, 97%.");
    // The legend and the two shares, each with its amount and its share of the deposit.
    expect([...within(group).getByRole("list", { name: "Legend" }).querySelectorAll("li")].map((item) => item.textContent)).toEqual(["Paid out", "Left"]);
    expect([...group.querySelectorAll(".object-page__share")].map((share) => share.textContent)).toEqual(["Paid out0.032185 XRP3% of the deposit", "Left0.967815 XRP97% of the deposit"]);
    expect(container.querySelectorAll(".share")).toHaveLength(1);
  });

  it("tells a screen reader that every value is listed under the bar, not that a table has them: this card has none", () => {
    mount(build());
    const summary = deposit().querySelector('[role="img"]')!.getAttribute("aria-label")!;
    expect(summary).toBe("Paid out and left. Deposit: largest Left, 97%. Every value is listed under the bar.");
    expect(summary).not.toContain("Table");
  });

  it("calls the part that is left Returned to the source once the channel is closed, and Left for one another transaction removed", () => {
    const names = () => [...deposit().querySelectorAll(".object-page__share-name")].map((name) => name.textContent);
    mount(closed());
    expect(names()).toEqual(["Paid out", "Returned to the source"]);
    expect([...deposit().querySelectorAll(".object-page__share")].map((share) => share.textContent)).toEqual([
      "Paid out0.4 XRP40% of the deposit",
      "Returned to the source0.6 XRP60% of the deposit",
    ]);
    expect(screen.getByText("Returned to the source", { selector: "dt" }).nextElementSibling!.textContent).toMatch(/^0\.6 XRPWent back to the source when the channel closed\./);
    cleanup();
    mount(removed());
    expect(names()).toEqual(["Paid out", "Left"]);
    expect(screen.queryByText("Returned to the source", { exact: false })).toBeNull();
    // Where its remainder went is not known: the row has no hint.
    expect((screen.getByText("Left", { selector: "dt" }).nextElementSibling as HTMLElement).querySelector(".object-page__hint")).toBeNull();
  });

  it("draws a closed channel's removed banner, with its two links, and the board's fixed line", () => {
    mount(closed());
    const banner = screen.getByText(/^Removed from the ledger in ledger/).closest(".notice") as HTMLElement;
    expect(banner.textContent).toBe(
      "Removed from the ledger in ledger #107,974,000 by PaymentChannelClaim CCCCCC…CCCC" +
        "Closed on Oct 29, 2026, 01:00 UTC; 0.4 XRP was paid out and 0.6 XRP went back to the source. This page shows it from history: its last state before it was removed.",
    );
    expect(within(banner).getByRole("link", { name: "#107,974,000" }).getAttribute("href")).toBe("/xrpl/ledger/107974000");
    expect(within(banner).getByRole("link", { name: "PaymentChannelClaim transaction CCCCCC…CCCC" }).getAttribute("href")).toBe(`/xrpl/tx/${"C".repeat(64)}`);
  });

  it("leaves the deposit section out when the amount or the balance is missing: there is nothing to share out", () => {
    mount(build({ balance: undefined }));
    expect(screen.queryByRole("group", { name: "Deposit paid out and left" })).toBeNull();
    expect(document.querySelector(".share")).toBeNull();
    // The Details rows still say what is missing.
    expect((screen.getByText("Paid out", { selector: "dt" }).nextElementSibling as HTMLElement).textContent).toMatch(/^—/);
    cleanup();
    mount(build({ amount: undefined }));
    expect(screen.queryByRole("group", { name: "Deposit paid out and left" })).toBeNull();
    expect(document.querySelector(".object-page__summary")!.textContent).toBe("rQQQrU…3ZrM opened a payment channel to rLggTE…KrtR on Oct 13, 2026.");
  });

  it("draws the Details rows with the ledger's field names, the board's hints, a copy button for the ID and the key, and the owner reserve", () => {
    mount(build({ cancel_after: "2026-12-01T00:00:00Z" }));
    const details = screen.getByRole("region", { name: "Details" });
    const term = (label: string) => within(details).getByText(label, { selector: "dt" });
    const value = (label: string) => term(label).nextElementSibling!.textContent;
    expect(term("Channel ID").textContent).toBe("Channel IDledger object ID");
    expect(value("Deposited")).toBe("1 XRP1 XRP when it was opened.");
    expect(term("Deposited").textContent).toBe("DepositedAmount");
    expect(value("Paid out")).toBe("0.032185 XRPClaimed so far, in 1 claim redeemed on the ledger.");
    expect(value("Left")).toBe("0.967815 XRPCan still be paid out by claims.");
    expect(value("Settle delay")).toBe("14 days · 1,209,600 sAfter the source asks to close, the destination has this long to redeem its last claim.");
    expect(value("Public key")).toContain("03D63CA73239D94AAF52574A20E3BC26CBDB811CA55A5914FAA28836F079CE0DC3");
    expect(value("Closes after")).toContain("Set when the channel was opened: after this time, the next transaction that touches it closes it.");
    expect(value("Owner reserve")).toBe("0.2 XRPHeld from the source’s balance while the channel exists.");
    expect(within(details).getByRole("button", { name: "Copy channel ID" })).toBeTruthy();
    expect(within(details).getByRole("button", { name: "Copy public key" })).toBeTruthy();
    expect(details.textContent).toContain("As of ledger #107,972,102, Oct 29, 2026, 03:50 UTC.");
  });

  it("has no Owner reserve row when the server state failed", () => {
    mount(build({}, { serverState: null }));
    expect(screen.queryByText("Owner reserve")).toBeNull();
    expect(screen.getByText("Settle delay")).toBeTruthy();
  });

  it("draws the timeline oldest first with the footnote of spec 4.1, the marks and what can still happen", () => {
    mount(build());
    const history = screen.getByRole("region", { name: "History" });
    const items = within(history).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector(".timeline__head")!.textContent)).toEqual(["PaymentChannelCreateOpened", "PaymentChannelClaimClaim redeemed", "PaymentChannelClaimNot closed"]);
    expect(within(items[0]!).getByRole("link", { name: "PaymentChannelCreate transaction E8A846…4127" })).toBeTruthy();
    expect(history.textContent).toContain("Oldest first. Filled dots are transactions; dashed ones are what can still happen.");
  });

  it("draws a page behind a marker with Newer and Older", () => {
    // The second page of older events (reached from the first's M1), which has a third behind it (M3).
    const data = paymentChannelPage(
      { origin: "index", answer: paymentChannelAnswerSample({ history_marker: "M1" }), history: historySample({ marker: "M3" }) },
      { net: XRPL, serverState: stateOf(), names: NO_NAMES, marker: "M2", back: ["M1"] },
    );
    mountPage(page(data), "payment-channel", { at: `${PATH}?marker=M2&back=M1`, network: LAYOUT_XRPL });
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Newer" }).getAttribute("href")).toBe(`${PATH}?marker=M1`);
    expect(within(pager).getByRole("link", { name: "Older" }).getAttribute("href")).toBe(`${PATH}?marker=M3&back=M2.M1`);
  });

  it("draws a channel read from the node: the ledger it last changed in, the node's note and no counts in the hints", () => {
    const entry: LedgerObject = {
      LedgerEntryType: "PayChannel",
      index: CHANNEL_ID,
      Account: SOURCE,
      Destination: DESTINATION,
      Amount: "1000000",
      Balance: "32185",
      SettleDelay: 1_209_600,
      PublicKey: "03D63CA73239D94AAF52574A20E3BC26CBDB811CA55A5914FAA28836F079CE0DC3",
      PreviousTxnID: "D".repeat(64),
      PreviousTxnLgrSeq: 107_000_000,
    };
    const data = paymentChannelPage({ origin: "node", entry, ledgerIndex: 107_972_102, now: 1_792_000_000 }, { net: XRPL, serverState: stateOf(), names: NO_NAMES, back: [] });
    mount(data);
    expect(screen.getByText(/^Last changed in ledger/).textContent).toBe("Last changed in ledger #107,000,000 by transaction DDDDDD…DDDD");
    expect(screen.getByText("Read live from the network at ledger #107,972,102.")).toBeTruthy();
    expect(screen.getByText("The index does not hold this history yet.")).toBeTruthy();
    expect((screen.getByText("Deposited", { selector: "dt" }).nextElementSibling as HTMLElement).textContent).toBe("1 XRP");
    expect([...deposit().querySelectorAll(".object-page__share")].map((share) => share.textContent)).toEqual(["Paid out0.032185 XRP3% of the deposit", "Left0.967815 XRP97% of the deposit"]);
  });

  it("draws a deposit of tokens with the issuer as a link in its rows and in a title under the bar, and an MPT deposit raw", () => {
    const token = (value: string) => ({ currency: "USD", issuer: TOKEN_ISSUER, value });
    mount(build({ amount: token("1000"), balance: token("250"), remaining: token("750"), opened_with: token("1000") }));
    const row = screen.getByText("Deposited", { selector: "dt" }).nextElementSibling as HTMLElement;
    expect(within(row).getByRole("link", { name: "rMxCKb…m5De" }).getAttribute("href")).toBe(`/xrpl/account/${TOKEN_ISSUER}`);
    // Under the bar the issuer is in the amount's title only: no second link to it, and the bar's total names the currency.
    expect(within(deposit()).queryByRole("link")).toBeNull();
    expect(deposit().querySelector(".share__name")!.textContent).toBe("Deposit1,000 USD");
    expect([...deposit().querySelectorAll(".object-page__share .amt")].map((amount) => amount.getAttribute("title"))).toEqual([`USD issued by ${TOKEN_ISSUER}`, `USD issued by ${TOKEN_ISSUER}`]);
    cleanup();
    const mpt = (value: string) => ({ currency: MPT_ISSUANCE_ID, issuer: SOURCE, value, mpt_issuance_id: MPT_ISSUANCE_ID });
    mount(build({ amount: mpt("5000"), balance: mpt("1200"), remaining: mpt("3800"), opened_with: mpt("5000") }));
    expect(deposit().querySelector(".share__name")!.textContent).toBe("Deposit5,000 units");
    expect([...deposit().querySelectorAll(".object-page__share")].map((share) => share.textContent)).toEqual([
      "Paid out1,200 units of MPT 0000012A…24% of the deposit",
      "Left3,800 units of MPT 0000012A…76% of the deposit",
    ]);
  });

  it("is Xahau's in XAH, with Xahau in the breadcrumb", () => {
    const answer = paymentChannelAnswerSample();
    answer.payment_channel = { ...answer.payment_channel, amount: { currency: "XAH", value: "200" }, balance: { currency: "XAH", value: "50" }, remaining: { currency: "XAH", value: "150" } };
    const data = paymentChannelPage({ origin: "index", answer }, { net: XAHAU, serverState: stateOf(), names: NO_NAMES, back: [] });
    mountPage(page(data), "payment-channel", { at: `/xahau/payment-channels/${CHANNEL_ID}`, network: LAYOUT_XAHAU });
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Xahau/Accounts/rQQQrU…3ZrM/Payment channel");
    expect((screen.getByText("Owner reserve", { selector: "dt" }).nextElementSibling as HTMLElement).textContent).toMatch(/^0\.2 XAH/);
    expect(deposit().querySelector(".share__name")!.textContent).toBe("Deposit200 XAH");
  });
});

describe("PaymentChannelPage: the page the Worker prints is the page the browser takes over", () => {
  it.each([
    ["an open channel", () => build({ cancel_after: "2026-12-01T00:00:00Z" }), 1],
    ["a closing channel", closing, 1],
    ["a closed channel", closed, 1],
    ["a channel another transaction removed", removed, 0],
    ["one without a deposit to share out", () => build({ balance: undefined }), 1],
    ["one without its reserve", () => build({}, { serverState: null }), 1],
  ])("hydrates %s without a mismatch, with no age in the HTML and the ages beside the times once it is the browser's", async (_name, make, current) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T04:00:00Z"));
    const { html, container, errors } = await serverThenHydrated(routedPage(page(make()), { at: PATH }));
    expect(errors).toEqual([]);
    expect(html).toContain("<h1");
    expect(html).not.toMatch(/\b\d+ (?:s|min|h|d) ago|\bin (?:under a minute|\d+ (?:min|h|days))/);
    await act(async () => {});
    // (No `\b` after the words: in `textContent` the next element's text follows them at once.)
    expect(container.textContent).toMatch(/\b\d+ (?:s|min|h|d) ago/);
    // What the browser took over: the pill's icon and word, the state marked in the strip (none for a removed one), the timeline.
    expect(container.querySelector(".pill svg")).not.toBeNull();
    expect(container.querySelector(".pill")!.textContent).not.toBe("");
    expect(container.querySelectorAll('.states__list [aria-current="true"]')).toHaveLength(current);
    expect(container.querySelectorAll(".timeline__item").length).toBeGreaterThan(1);
  });

  it("hydrates the deposit bar: the cursor is the browser's, the bar and the two shares are the page's", async () => {
    const { html, container, errors } = await serverThenHydrated(routedPage(page(build()), { at: PATH }));
    expect(errors).toEqual([]);
    // Printed by the Worker: the row, its two parts and the shares; not the slider, which only a browser has.
    expect(html).toContain('class="share__bar"');
    expect(html).not.toContain('role="slider"');
    await act(async () => {});
    expect(container.querySelectorAll(".share__seg")).toHaveLength(2);
    expect(container.querySelector('[role="slider"]')).not.toBeNull();
    expect(container.querySelectorAll(".object-page__share")).toHaveLength(2);
  });

  it("puts the age of a date in a status line beside it: the countdown of one to come, the age of one that passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T04:00:00Z"));
    const lines = async (data: PaymentChannelPageData) => {
      const { container } = await serverThenHydrated(routedPage(page(data), { at: PATH }));
      await act(async () => {});
      return [...container.querySelectorAll(".object-page__status p")].map((line) => line.textContent);
    };
    expect(await lines(build({ cancel_after: "2026-11-02T04:00:00Z" }))).toEqual([
      "Open: 0.967815 XRP of 1 XRP left to pay out",
      "The destination has redeemed claims for 0.032185 XRP so far. No close has been requested; from Nov 2, 2026, 04:00 UTCin 4 days the next transaction that touches it closes it.",
    ]);
    cleanup();
    expect(await lines(closing())).toEqual([
      "Closing: claims can still be redeemed until Nov 2, 2026, 04:00 UTCin 4 days",
      "The source asked to close the channel. From Nov 2, 2026, 04:00 UTCin 4 days, any transaction on the channel closes it, and the 0.967815 XRP left go back to the source.",
    ]);
    cleanup();
    // Closing only because its CancelAfter passed (nobody asked to close): "now closes it", with the CancelAfter's age beside it, and no "close requested" anywhere.
    expect(await lines(build({ status: "closing", cancel_after: "2026-10-20T00:00:00Z" }))).toEqual([
      "Closing: any transaction on the channel now closes it",
      "CancelAfter passed on Oct 20, 2026, 00:00 UTC9 d ago. When it closes, the 0.967815 XRP left go back to the source.",
    ]);
    cleanup();
    expect((await lines(closed()))[1]).toBe("Closed on Oct 29, 2026, 01:00 UTC3 h ago, when the destination redeemed its last claim and closed the channel.");
  });
});
