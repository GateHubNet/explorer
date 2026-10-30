import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { objectCase, type ObjectCase } from "../../test/support/object-cases";
import { CHANNEL_ID, DELEGATE, historySample, MPT_ISSUANCE_ID, paymentChannelAnswerSample, TOKEN_ISSUER } from "../../test/support/object-samples";
import { said, stateOf, walk, XAHAU, XRPL } from "../../test/support/object-view-world";
import type { Segment } from "../domain/describe";
import { shortAddress } from "../domain/format";
import { NO_NAMES, type NamesPart } from "../domain/names";
import { formatDate } from "../domain/time-words";
import type { ObjectEvent, ObjectHistoryPage, PaymentChannelAnswer } from "./api-types";
import type { DetailRow, ObjectSource } from "./ledger-object-view";
import { collectAddresses } from "./names-collect";
import { RIPPLE_EPOCH_OFFSET, type LedgerObject } from "./node-rpc";
import { drawnAccounts, paymentChannelPage, type PaymentChannelPageData } from "./payment-channel-view";
import { unixOf } from "./validator-facts";

// ---- The world of the tests ---------------------------------------------------------------------------------------------------------------------

const FIXTURES = new URL("../../test/fixtures/http/", import.meta.url);
const fixture = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8")) as T;
type NetName = "xrpl" | "xahau";

/** The index's answer for a recorded channel of `which`. */
async function answerOf(net: NetName, which: ObjectCase): Promise<PaymentChannelAnswer> {
  const { id } = await objectCase(net, which);
  return fixture<PaymentChannelAnswer>(`${net}/data-api/payment_channels/${id}.json`);
}

/** The node's entry for the recorded channel of `which`, as the source of a page. */
async function entryOf(net: NetName, which: ObjectCase): Promise<{ entry: LedgerObject; ledgerIndex: number }> {
  const { id } = await objectCase(net, which);
  const { result } = fixture<{ result: { node: LedgerObject; ledger_index: number } }>(`${net}/node/ledger_entry/${id}.json`);
  return { entry: result.node, ledgerIndex: result.ledger_index };
}

const indexed = (answer: PaymentChannelAnswer, history?: ObjectHistoryPage): ObjectSource => ({
  origin: "index",
  answer,
  ...(history !== undefined && { history }),
});
const fromNode = (entry: LedgerObject, ledgerIndex: number, now: number): ObjectSource => ({ origin: "node", entry, ledgerIndex, now });

type Options = Parameters<typeof paymentChannelPage>[1];
const page = (source: ObjectSource, over: Partial<Options> = {}, net = XRPL): PaymentChannelPageData =>
  paymentChannelPage(source, { net, serverState: stateOf(), names: NO_NAMES, back: [], ...over });

/** What the timeline reads, one line for each item. */
const lines = (data: PaymentChannelPageData): string[] => data.timeline.map((item) => `${item.kind}:${item.type}:${item.title}`);
const unix = (iso: string): number => unixOf(iso);
const rowOf = (data: PaymentChannelPageData, label: string): DetailRow | undefined => data.details.find((row) => row.label === label);
const labels = (data: PaymentChannelPageData) => data.details.map((row) => row.label);

const SOURCE = "rQQQrUdN1cLdNmxH4dHfKgmX5P4kf3ZrM";
const DESTINATION = "rLggTEwmTe3eJgyQbCSk4wQazow2TeKrtR";
const removal = (txType: string) => ({ ledger_index: 107_960_000, time: "2026-10-27T01:00:02Z", tx_hash: "D".repeat(64), tx_type: txType });
const event = (over: Partial<ObjectEvent> & Pick<ObjectEvent, "event" | "tx_type">): ObjectEvent => ({
  ledger_index: 107_960_000,
  time: "2026-10-27T01:00:02Z",
  tx_hash: "D".repeat(64),
  account: DESTINATION,
  result: "tesSUCCESS",
  ...over,
});
const xrp = (value: string) => ({ currency: "XRP", value });

/** The sample's channel (1 XRP, 0.032185 paid out), turned into one of another status, with events newest first as D5 serves them. */
function answerWith(status: PaymentChannelAnswer["payment_channel"]["status"], over: Partial<PaymentChannelAnswer["payment_channel"]> = {}, events: ObjectEvent[] = []): PaymentChannelAnswer {
  const answer = paymentChannelAnswerSample();
  answer.payment_channel = { ...answer.payment_channel, status, ...over };
  answer.history = [...events, ...answer.history];
  return answer;
}

afterEach(() => {
  vi.useRealTimers();
});

// ---- From the index: one channel of each status -------------------------------------------------------------------------------------------------

describe("paymentChannelPage from the index", () => {
  it("always lists the three states of the board in its order, with their meanings, and marks the channel's", async () => {
    const data = page(indexed(await answerOf("xrpl", "channel-open")));
    expect(data.states.map((state) => [state.id, state.label, state.meaning])).toEqual([
      ["open", "Open", "Claims can be redeemed; no close requested."],
      ["closing", "Closing", "Close requested; it closes after the settle delay."],
      ["closed", "Closed", "What was left went back to the source; removed."],
    ]);
    expect(data.states.filter((state) => state.current).map((state) => state.id)).toEqual(["open"]);
  });

  it("gives the closing state the meaning of the reason the channel is closing: a close request (an Expiration), or only a CancelAfter that has passed (decision 12)", async () => {
    const closingMeaning = (data: PaymentChannelPageData) => data.states.find((state) => state.id === "closing")!.meaning;
    const BOARD = "Close requested; it closes after the settle delay.";
    const CANCEL_AFTER = "CancelAfter has passed; any transaction on the channel now closes it.";
    // an Expiration is set: the board's words, before and after it has passed
    const requested = await answerOf("xrpl", "channel-closing");
    expect(closingMeaning(page(indexed(requested)))).toBe(BOARD);
    requested.payment_channel.expiration = "2026-10-20T00:00:00Z";
    expect(closingMeaning(page(indexed(requested)))).toBe(BOARD);
    // an Expiration and a CancelAfter that has passed: the close was requested, so the board's words
    expect(closingMeaning(page(indexed(answerWith("closing", { expiration: "2026-11-01T00:00:00Z", cancel_after: "2026-10-20T00:00:00Z" }))))).toBe(BOARD);
    // only a CancelAfter that has passed: nobody asked to close it
    const onlyCancelAfter = page(indexed(answerWith("closing", { cancel_after: "2026-10-20T00:00:00Z" })));
    expect(closingMeaning(onlyCancelAfter)).toBe(CANCEL_AFTER);
    expect(onlyCancelAfter.states.filter((state) => state.current).map((state) => state.id)).toEqual(["closing"]);
    // the other states, and the other two meanings, do not move with it
    expect(onlyCancelAfter.states.map((state) => state.meaning).filter((meaning) => meaning !== CANCEL_AFTER)).toEqual([
      "Claims can be redeemed; no close requested.",
      "What was left went back to the source; removed.",
    ]);
    // a channel that is open (CancelAfter ahead) or closed keeps the board's words for the state it is not in
    expect(closingMeaning(page(indexed(answerWith("open", { cancel_after: "2031-01-01T00:00:00Z" }))))).toBe(BOARD);
    expect(closingMeaning(page(indexed(await answerOf("xrpl", "channel-closed"))))).toBe(BOARD);
  });

  describe("open (channel-open: 1 XRP, 0.032185 paid out, no end time)", () => {
    it("has the info pill, the summary, the status lines and the claims paragraph", async () => {
      const answer = await answerOf("xrpl", "channel-open");
      const data = page(indexed(answer));
      expect(data).toMatchObject({ kind: "payment-channel", origin: "index", net: "xrpl", id: answer.payment_channel.channel_id, removed: false, banner: null, pill: { tone: "info", text: "Open" } });
      expect(data.summary).toEqual([
        { t: "account", v: answer.payment_channel.account },
        { t: "text", v: " opened a payment channel to " },
        { t: "account", v: answer.payment_channel.destination },
        { t: "text", v: " on Oct 13, 2026, with " },
        { t: "amount", value: "1", currency: "XRP" },
        { t: "text", v: " deposited in all." },
      ]);
      expect(data.statusLines.map(said)).toEqual([
        "Open: 0.967815 XRP of 1 XRP left to pay out",
        "The destination has redeemed claims for 0.032185 XRP so far. No close has been requested, and no end time is set.",
      ]);
      expect(said(data.claimsNote)).toBe(
        "Payments in a channel are claims: the source signs them off the ledger, each for a larger running total, and the destination redeems the latest one on the ledger, so many payments settle in a few transactions.",
      );
      expect(data.titleLine).toEqual({ kind: "created", at: unix("2026-10-13T08:05:31Z") });
      expect(data.amount).toEqual({ value: "1", currency: "XRP" });
    });

    it("says the channel closes by CancelAfter at the latest when it has one", () => {
      const data = page(indexed(answerWith("open", { cancel_after: "2031-01-01T00:00:00Z" })));
      expect(data.statusLines.map(said)[1]).toBe("The destination has redeemed claims for 0.032185 XRP so far. No close has been requested; the channel closes by Jan 1, 2031, 00:00 UTC at the latest.");
      expect(data.timeline.at(-1)).toMatchObject({ kind: "next", type: "PaymentChannelClaim", title: "Not closed", at: unix("2031-01-01T00:00:00Z"), whenText: "By Jan 1, 2031, 00:00 UTC at the latest" });
      expect(rowOf(data, "Closes by")).toEqual({
        label: "Closes by",
        field: "CancelAfter",
        value: { kind: "time", at: unix("2031-01-01T00:00:00Z") },
        hint: "Set when the channel was opened: it closes at this time at the latest.",
      });
    });

    it("says no claim has been redeemed for a channel nothing was paid out of", () => {
      const data = page(indexed(answerWith("open", { balance: xrp("0"), remaining: xrp("1"), claims: 0 })));
      expect(data.statusLines.map(said)).toEqual(["Open: 1 XRP of 1 XRP left to pay out", "No claim has been redeemed yet. No close has been requested, and no end time is set."]);
    });

    it("has what can still happen: not closed, with no end time set", async () => {
      const data = page(indexed(await answerOf("xrpl", "channel-open")));
      expect(lines(data)).toEqual(["tx:PaymentChannelCreate:Opened", "tx:PaymentChannelClaim:Claim redeemed", "next:PaymentChannelClaim:Not closed"]);
      const next = data.timeline.at(-1)!;
      expect(next).toMatchObject({ whenText: "No end time set" });
      expect(next).not.toHaveProperty("at");
      expect(said(next.what)).toBe("The destination can close it at any time; the source can ask to, and it then closes after the settle delay.");
    });
  });

  describe("closing (channel-closing: 50 XRP, 12 paid out, close requested)", () => {
    it("has the warn pill and says claims can be redeemed until the expiration", async () => {
      const answer = await answerOf("xrpl", "channel-closing");
      const data = page(indexed(answer));
      expect(data.pill).toEqual({ tone: "warn", text: "Closing" });
      expect(data.states.filter((state) => state.current).map((state) => state.id)).toEqual(["closing"]);
      expect(data.statusLines.map(said)).toEqual([
        "Closing: claims can still be redeemed until Nov 13, 2026, 02:25 UTC",
        "The source asked to close the channel. From Nov 13, 2026, 02:25 UTC, any transaction on the channel closes it, and the 38 XRP left go back to the source.",
      ]);
      expect(rowOf(data, "Expires")).toEqual({
        label: "Expires",
        field: "Expiration",
        value: { kind: "time", at: unix("2026-11-13T02:25:30Z") },
        hint: "Set when the source asked to close: the time of the request plus the settle delay.",
      });
    });

    it("has the close request on the timeline and the closing still to come, counting down to the expiration", async () => {
      const data = page(indexed(await answerOf("xrpl", "channel-closing")));
      expect(lines(data)).toEqual(["tx:PaymentChannelCreate:Opened", "tx:PaymentChannelClaim:Claim redeemed", "tx:PaymentChannelClaim:Close requested", "next:PaymentChannelClaim:Not closed yet"]);
      expect(said(data.timeline[2]!.what)).toBe("Asked to close the channel, which set its expiration to Nov 13, 2026, 02:25 UTC.");
      expect(data.timeline[3]).toMatchObject({ at: unix("2026-11-13T02:25:30Z"), whenText: "From Nov 13, 2026, 02:25 UTC" });
      expect(said(data.timeline[3]!.what)).toBe("Until then the destination can redeem its last claim; after that, any transaction on the channel closes it.");
    });

    it("says any transaction on the channel now closes it once the expiration has passed, and has no countdown to a time that has come", async () => {
      const answer = await answerOf("xrpl", "channel-closing");
      answer.payment_channel.expiration = "2026-10-20T00:00:00Z";
      const data = page(indexed(answer));
      expect(data.pill).toEqual({ tone: "warn", text: "Closing" });
      expect(data.statusLines.map(said)).toEqual([
        "Closing: any transaction on the channel now closes it",
        "Expiration passed on Oct 20, 2026, 00:00 UTC. When it closes, the 38 XRP left go back to the source.",
      ]);
      const next = data.timeline.at(-1)!;
      expect(next).toMatchObject({ kind: "next", title: "Not closed yet", whenText: "Since Oct 20, 2026, 00:00 UTC" });
      expect(next).not.toHaveProperty("at");
      expect(said(next.what)).toBe("Any transaction on the channel closes it now.");
    });

    it("counts a CancelAfter that has passed too, and takes the earlier of it and the expiration (D5 decision 12, no expiration at all)", () => {
      const onlyCancelAfter = page(indexed(answerWith("closing", { cancel_after: "2026-10-20T00:00:00Z" })));
      expect(onlyCancelAfter.pill).toEqual({ tone: "warn", text: "Closing" });
      expect(onlyCancelAfter.statusLines.map(said)).toEqual([
        "Closing: any transaction on the channel now closes it",
        "CancelAfter passed on Oct 20, 2026, 00:00 UTC. When it closes, the 0.967815 XRP left go back to the source.",
      ]);
      expect(onlyCancelAfter.timeline.at(-1)).toMatchObject({ kind: "next", title: "Not closed yet", whenText: "Since Oct 20, 2026, 00:00 UTC" });
      // the earlier of the two is the one named: an expiration after the CancelAfter, and one before it
      const both = (expiration: string) => page(indexed(answerWith("closing", { cancel_after: "2026-10-20T00:00:00Z", expiration })));
      expect(both("2026-10-22T00:00:00Z").statusLines.map(said)[1]).toMatch(/^CancelAfter passed on Oct 20, 2026, 00:00 UTC\./);
      expect(both("2026-10-18T00:00:00Z").statusLines.map(said)[1]).toMatch(/^Expiration passed on Oct 18, 2026, 00:00 UTC\./);
      // the same instant: the expiration
      expect(both("2026-10-20T00:00:00Z").statusLines.map(said)[1]).toMatch(/^Expiration passed on Oct 20, 2026/);
      // ahead of the page, the earlier of the two is the time claims can be redeemed until
      const ahead = page(indexed(answerWith("closing", { cancel_after: "2031-01-01T00:00:00Z", expiration: "2032-01-01T00:00:00Z" })));
      expect(ahead.statusLines.map(said)[0]).toBe("Closing: claims can still be redeemed until Jan 1, 2031, 00:00 UTC");
      expect(ahead.timeline.at(-1)).toMatchObject({ at: unix("2031-01-01T00:00:00Z"), whenText: "From Jan 1, 2031, 00:00 UTC" });
    });
  });

  describe("closed (channel-closed: 5 XRP, nothing paid out, closed by a PaymentChannelClaim; the creation not indexed)", () => {
    it("has the neutral pill, what was paid out and what went back, and the removed banner", async () => {
      const answer = await answerOf("xrpl", "channel-closed");
      const data = page(indexed(answer));
      expect(data).toMatchObject({ pill: { tone: "neutral", text: "Closed" }, removed: true });
      expect(data.states.filter((state) => state.current).map((state) => state.id)).toEqual(["closed"]);
      expect(data.statusLines.map(said)).toEqual(["Closed: 0 XRP paid out, 5 XRP returned to the source", "Closed on Feb 10, 2026, 05:01 UTC, by a PaymentChannelClaim."]);
      expect(data.banner).toMatchObject({ ledger: 102_145_584, txType: "PaymentChannelClaim" });
      expect(said(data.banner!.sentence)).toBe("Closed on Feb 10, 2026, 05:01 UTC; 0 XRP was paid out and 5 XRP went back to the source.");
      expect(data.asOf).toMatch(/^From history: the channel’s last state, before ledger #102,145,584 removed it\.$/);
      expect(said(data.summary)).toBe(`${shortAddress(answer.payment_channel.account)} opened a payment channel to ${shortAddress(answer.payment_channel.destination)}, with 5 XRP deposited in all.`);
      expect(lines(data)).toEqual(["tx:PaymentChannelClaim:Closed"]);
      expect(said(data.timeline[0]!.what)).toBe("Closed the channel; 5 XRP went back to the source.");
    });

    it("says the destination redeemed its last claim when it did", async () => {
      const answer = await answerOf("xrpl", "channel-closed");
      answer.history = [{ ...answer.history[0]!, account: answer.payment_channel.destination, balance: xrp("0.154393"), balance_change: xrp("0.00002") }];
      answer.payment_channel = { ...answer.payment_channel, balance: xrp("0.154393"), remaining: xrp("4.845607") };
      const data = page(indexed(answer));
      expect(data.statusLines.map(said)).toEqual([
        "Closed: 0.154393 XRP paid out, 4.845607 XRP returned to the source",
        "Closed on Feb 10, 2026, 05:01 UTC, when the destination redeemed its last claim and closed the channel.",
      ]);
      expect(said(data.timeline[0]!.what)).toBe("Redeemed the last claim, 0.154393 XRP paid out in all, and closed the channel; 4.845607 XRP went back to the source.");
      expect(data.timeline[0]).toMatchObject({ title: "Closed", by: answer.payment_channel.destination });
      // a last claim sent by anyone else (the source closing its own channel) is a transaction that closed it, not the destination's claim
      answer.history = [{ ...answer.history[0]!, account: answer.payment_channel.account }];
      expect(page(indexed(answer)).statusLines.map(said)[1]).toBe("Closed on Feb 10, 2026, 05:01 UTC, by a PaymentChannelClaim.");
    });

    it("has nothing that can still happen, and names the rest Returned to the source", async () => {
      const data = page(indexed(await answerOf("xrpl", "channel-closed")));
      expect(data.timeline.every((item) => item.kind === "tx")).toBe(true);
      expect(labels(data)).toContain("Returned to the source");
      expect(labels(data)).not.toContain("Left");
      expect(rowOf(data, "Returned to the source")).toEqual({ label: "Returned to the source", value: { kind: "amount", amount: { value: "5", currency: "XRP" } }, hint: "Went back to the source when the channel closed." });
      expect(rowOf(data, "Owner reserve")!.hint).toBe("Released to the source when the channel was removed.");
    });
  });

  describe("removed by another transaction (built from the sample)", () => {
    it("has the removed pill, no state marked, no marks, and a banner that says only when", () => {
      const data = page(indexed(answerWith("removed", { removed: removal("AccountDelete") })));
      expect(data.pill).toEqual({ tone: "off", text: "Removed" });
      expect(data.states.filter((state) => state.current)).toEqual([]);
      expect(data.states).toHaveLength(3);
      expect(data.statusLines.map(said)).toEqual(["Removed from the ledger by AccountDelete"]);
      expect(data.banner).toMatchObject({ ledger: 107_960_000, txType: "AccountDelete", hash: "D".repeat(64) });
      expect(said(data.banner!.sentence)).toBe("Removed on Oct 27, 2026, 01:00 UTC.");
      expect(lines(data)).toEqual(["tx:PaymentChannelCreate:Opened", "tx:PaymentChannelClaim:Claim redeemed"]);
      // where what was left went is not known for a channel another transaction removed: it is Left, not Returned to the source
      expect(data.deposit.rows[0]!.segments[1]!.label).toBe("Left");
      expect(data.shares[1]).toMatchObject({ name: "Left", share: "97% of the deposit" });
      expect(labels(data)).toContain("Left");
      expect(labels(data)).not.toContain("Returned to the source");
      expect(rowOf(data, "Left")).toEqual({ label: "Left", value: { kind: "amount", amount: { value: "0.967815", currency: "XRP" } } });
      expect(rowOf(data, "Paid out")!.hint).toBe("Claimed in all, in 1 claim redeemed on the ledger.");
      expect(rowOf(data, "Owner reserve")!.hint).toBe("Released to the source when the channel was removed.");
    });

    it("says Removed in the timeline, with the banner's sentence (C25), and Changed by {tx_type} for a change no one expects", () => {
      const removed = event({ event: "removed", tx_type: "AccountDelete", account: SOURCE });
      const changed = event({ event: "update", tx_type: "AccountSet", account: SOURCE, time: "2026-10-20T00:00:00Z" });
      const data = page(indexed(answerWith("removed", { removed: removal("AccountDelete") }, [removed, changed])));
      const item = data.timeline.find((each) => each.title === "Removed")!;
      expect(item).toMatchObject({ kind: "tx", type: "AccountDelete", by: SOURCE, hash: "D".repeat(64) });
      expect(item.what).toEqual(data.banner!.sentence);
      expect(data.timeline.find((each) => each.type === "AccountSet")).toMatchObject({ title: "Changed by AccountSet", what: [], by: SOURCE });
    });
  });

  it("reads the history from the oldest event to the newest and keeps the markers in D5's direction", () => {
    const answer = paymentChannelAnswerSample({ history_marker: "M1" });
    const data = page(indexed(answer));
    expect(data.timeline.filter((item) => item.kind === "tx").map((item) => item.ledger)).toEqual([107_624_182, 107_641_123]);
    expect(data.paging).toEqual({ newerHref: null, olderHref: `/xrpl/payment-channels/${CHANNEL_ID}?marker=M1` });
    expect(answer.history.map((each) => each.ledger_index)).toEqual([107_641_123, 107_624_182]);
    const older = historySample({ marker: "M2", history: [event({ event: "fund", tx_type: "PaymentChannelFund", time: "2026-10-12T00:00:00Z", ledger_index: 107_600_002 })] });
    const behind = page(indexed(answer, older), { marker: "M1", back: [] });
    expect(behind.timeline.map((item) => item.ledger)).toEqual([107_600_002]);
    expect(behind.paging).toEqual({ newerHref: `/xrpl/payment-channels/${CHANNEL_ID}`, olderHref: `/xrpl/payment-channels/${CHANNEL_ID}?marker=M2&back=M1` });
  });

  it("pages a long channel: the first 50 events oldest first, and the Older link", async () => {
    const answer = await answerOf("xrpl", "channel-long");
    const data = page(indexed(answer));
    const txs = data.timeline.filter((item) => item.kind === "tx");
    expect(txs).toHaveLength(50);
    expect(answer.history).toHaveLength(50);
    const times = txs.map((item) => item.at!);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(data.paging).toEqual({ newerHref: null, olderHref: `/xrpl/payment-channels/${answer.payment_channel.channel_id}?marker=${answer.history_marker}` });
    expect(new Set(txs.map((item) => item.title))).toEqual(new Set(["Claim redeemed", "Funded"]));
  });

  it("sets `by` on every transaction, and `delegate` only beside it", () => {
    const answer = paymentChannelAnswerSample();
    answer.history = [event({ event: "update", tx_type: "AccountSet", account: SOURCE, delegate: DELEGATE }), ...answer.history];
    const items = page(indexed(answer)).timeline.filter((item) => item.kind === "tx");
    expect(items.every((item) => item.by !== undefined)).toBe(true);
    expect(items.find((item) => item.delegate !== undefined)).toMatchObject({ by: SOURCE, delegate: DELEGATE });
  });
});

// ---- The words of the events -----------------------------------------------------------------------------------------------------------------------

describe("paymentChannelPage: the events", () => {
  /** The timeline item of an event added to the sample's two (the sample's own are the Opened and the first Claim redeemed). */
  const only = (e: ObjectEvent) => page(indexed(answerWith("open", {}, [e]))).timeline.find((item) => item.hash === e.tx_hash)!;

  it("opens the channel with what it was opened with and the settle delay, at the time of the opening", async () => {
    const created = page(indexed(await answerOf("xrpl", "channel-open"))).timeline[0]!;
    expect(created).toMatchObject({ kind: "tx", type: "PaymentChannelCreate", title: "Opened", by: SOURCE });
    expect(said(created.what)).toBe("Opened the channel with 1 XRP and a settle delay of 14 days.");
  });

  it("funds it: what was added and what is deposited in all, from the event's own amounts", () => {
    const funded = only(event({ event: "fund", tx_type: "PaymentChannelFund", amount: xrp("3000"), amount_change: xrp("2000"), balance: xrp("0") }));
    expect(funded).toMatchObject({ title: "Funded", type: "PaymentChannelFund" });
    expect(said(funded.what)).toBe("Added 2,000 XRP; 3,000 XRP deposited in all.");
    // an event D5 could not read the amounts of still reads
    expect(said(only(event({ event: "fund", tx_type: "PaymentChannelFund", amount_change: xrp("2000") })).what)).toBe("Added 2,000 XRP.");
    expect(said(only(event({ event: "fund", tx_type: "PaymentChannelFund", amount: xrp("3000") })).what)).toBe("Added funds; 3,000 XRP deposited in all.");
    expect(said(only(event({ event: "fund", tx_type: "PaymentChannelFund" })).what)).toBe("Added funds.");
  });

  it("redeems a claim: the first claim, then what more was paid out and the total so far", () => {
    const first = only(event({ event: "claim", tx_type: "PaymentChannelClaim", amount: xrp("3000"), balance: xrp("720"), balance_change: xrp("720") }));
    expect(first).toMatchObject({ title: "Claim redeemed", by: DESTINATION });
    expect(said(first.what)).toBe("Paid out 720 XRP with the first claim.");
    const more = only(event({ event: "claim", tx_type: "PaymentChannelClaim", amount: xrp("3000"), balance: xrp("2562.6"), balance_change: xrp("1842.6") }));
    expect(said(more.what)).toBe("Paid out 1,842.6 XRP more; 2,562.6 XRP in all so far.");
    expect(said(only(event({ event: "claim", tx_type: "PaymentChannelClaim", balance_change: xrp("5") })).what)).toBe("Paid out 5 XRP more.");
    expect(said(only(event({ event: "claim", tx_type: "PaymentChannelClaim", balance: xrp("9") })).what)).toBe("Redeemed a claim; 9 XRP in all so far.");
    expect(said(only(event({ event: "claim", tx_type: "PaymentChannelClaim" })).what)).toBe("Redeemed a claim.");
  });

  it("requests a close, with the expiration it set when the event has one", () => {
    const request = only(event({ event: "close_request", tx_type: "PaymentChannelClaim", account: SOURCE, expiration: "2026-10-25T09:00:00Z" }));
    expect(request).toMatchObject({ title: "Close requested", by: SOURCE });
    expect(said(request.what)).toBe("Asked to close the channel, which set its expiration to Oct 25, 2026, 09:00 UTC.");
    expect(said(only(event({ event: "close_request", tx_type: "PaymentChannelClaim" })).what)).toBe("Asked to close the channel.");
  });

  it("renews it", () => {
    const renewed = only(event({ event: "renew", tx_type: "PaymentChannelClaim", account: SOURCE }));
    expect(renewed).toMatchObject({ title: "Renewed", type: "PaymentChannelClaim" });
    expect(said(renewed.what)).toBe("Cleared the channel’s expiration: the close request no longer applies.");
  });

  it("closes it, from the event's own amounts, falling back to the channel's final state", () => {
    const answer = answerWith("closed", { balance: xrp("2310"), remaining: xrp("690"), amount: xrp("3000"), removed: removal("PaymentChannelClaim") });
    const close = (over: Partial<ObjectEvent>) => page(indexed({ ...answer, history: [event({ event: "close", tx_type: "PaymentChannelClaim", ...over })] })).timeline[0]!;
    expect(said(close({ amount: xrp("3000"), balance: xrp("2310"), balance_change: xrp("20") }).what)).toBe("Redeemed the last claim, 2,310 XRP paid out in all, and closed the channel; 690 XRP went back to the source.");
    expect(said(close({ amount: xrp("3000"), balance: xrp("2310") }).what)).toBe("Closed the channel; 690 XRP went back to the source.");
    // an event without its amounts reads from the channel
    expect(said(close({ balance_change: xrp("20") }).what)).toBe("Redeemed the last claim, 2,310 XRP paid out in all, and closed the channel; 690 XRP went back to the source.");
    expect(close({}).title).toBe("Closed");
  });

  it("keeps the amounts of a past event as that event had them, not the channel's now", async () => {
    const data = page(indexed(await answerOf("xrpl", "channel-long")));
    const funded = data.timeline.find((item) => item.title === "Funded")!;
    expect(said(funded.what)).toMatch(/^Added 100 XRP; [\d,]+ XRP deposited in all\.$/);
    expect(said(funded.what)).not.toContain("2,100 XRP");
  });
});

// ---- The deposit -------------------------------------------------------------------------------------------------------------------------------

describe("paymentChannelPage: the deposit", () => {
  it("is one row of two parts, Paid out and Left, with exact values and slots that reach 3:1 in light", async () => {
    const data = page(indexed(await answerOf("xrpl", "channel-open")));
    expect(data.deposit.rows).toEqual([
      {
        id: "deposit",
        label: "Deposit",
        total: "1",
        segments: [
          { id: "paid", label: "Paid out", slot: 1, value: "0.032185" },
          { id: "left", label: "Left", slot: "neutral", value: "0.967815" },
        ],
      },
    ]);
    expect(data.deposit.token).toMatch(/^[0-9a-z]+$/);
    for (const row of data.deposit.rows) for (const segment of row.segments) expect([1, 2, "other", "neutral", "up", "down"]).toContain(segment.slot);
    expect(data.shares).toEqual([
      { id: "paid", name: "Paid out", amount: { value: "0.032185", currency: "XRP" }, share: "3% of the deposit" },
      { id: "left", name: "Left", amount: { value: "0.967815", currency: "XRP" }, share: "97% of the deposit" },
    ]);
  });

  it("calls the second part Returned to the source once the channel is closed", async () => {
    const data = page(indexed(await answerOf("xrpl", "channel-closed")));
    expect(data.deposit.rows[0]).toMatchObject({ total: "5", segments: [{ id: "paid", label: "Paid out", value: "0" }, { id: "left", label: "Returned to the source", value: "5" }] });
    expect(data.shares).toEqual([
      { id: "paid", name: "Paid out", amount: { value: "0", currency: "XRP" }, share: "0% of the deposit" },
      { id: "left", name: "Returned to the source", amount: { value: "5", currency: "XRP" }, share: "100% of the deposit" },
    ]);
  });

  it("keeps the token and the issuer of a deposit of tokens, and writes exponent-form values as plain decimals for the bar", () => {
    const token = (value: string) => ({ currency: "USD", issuer: TOKEN_ISSUER, value });
    const data = page(indexed(answerWith("open", { amount: token("1e3"), balance: token("2.5e2"), remaining: token("750") })));
    expect(data.deposit.rows[0]).toMatchObject({ total: "1000", segments: [{ value: "250" }, { value: "750" }] });
    expect(data.shares.map((share) => share.amount)).toEqual([token("250"), token("750")]);
    expect(data.shares.map((share) => share.share)).toEqual(["25% of the deposit", "75% of the deposit"]);
    expect(data.amount).toEqual(token("1e3"));
  });

  it("has the same token for the same deposit (a beat that brings the same token renders nothing), and another for another", async () => {
    const answer = await answerOf("xrpl", "channel-open");
    expect(page(indexed(answer)).deposit.token).toBe(page(indexed(answer)).deposit.token);
    const more = await answerOf("xrpl", "channel-open");
    more.payment_channel.balance = xrp("0.5");
    more.payment_channel.remaining = xrp("0.5");
    expect(page(indexed(more)).deposit.token).not.toBe(page(indexed(answer)).deposit.token);
  });

  it("has no row when the amount or the balance is missing or they do not add up: the bar says No data", () => {
    const empty = (over: Partial<PaymentChannelAnswer["payment_channel"]>) => {
      const data = page(indexed(answerWith("open", over)));
      expect(data.deposit.rows, JSON.stringify(over)).toEqual([]);
      expect(data.shares, JSON.stringify(over)).toEqual([]);
      expect(typeof data.deposit.token).toBe("string");
    };
    empty({ amount: undefined });
    empty({ balance: undefined });
    empty({ amount: xrp("0"), balance: xrp("0") });
    empty({ amount: xrp("1"), balance: xrp("2") });
    empty({ amount: xrp("1"), balance: xrp("-1") });
  });
});

// ---- The details -------------------------------------------------------------------------------------------------------------------------------

describe("paymentChannelPage: the details", () => {
  it("lists the board's rows in its order, with its hints (an open channel, the whole history)", async () => {
    const answer = await answerOf("xrpl", "channel-open");
    const data = page(indexed(answer));
    const { payment_channel: channel } = answer;
    expect(data.details).toEqual([
      { label: "Channel ID", field: "ledger object ID", value: { kind: "code", text: channel.channel_id, copy: "Copy channel ID" } },
      { label: "Source", value: { kind: "account", address: channel.account } },
      { label: "Destination", value: { kind: "account", address: channel.destination } },
      { label: "Deposited", field: "Amount", value: { kind: "amount", amount: { value: "1", currency: "XRP" } }, hint: "1 XRP when it was opened." },
      { label: "Paid out", field: "Balance", value: { kind: "amount", amount: { value: "0.032185", currency: "XRP" } }, hint: "Claimed so far, in 1 claim redeemed on the ledger." },
      { label: "Left", value: { kind: "amount", amount: { value: "0.967815", currency: "XRP" } }, hint: "Can still be paid out by claims." },
      {
        label: "Settle delay",
        field: "SettleDelay",
        value: { kind: "text", text: "14 days · 1,209,600 s" },
        hint: "After the source asks to close, the destination has this long to redeem its last claim.",
      },
      {
        label: "Public key",
        field: "PublicKey",
        value: { kind: "code", text: channel.public_key, copy: "Copy public key" },
        hint: "Claims must be signed with this key; the ledger checks the signature when a claim is redeemed.",
      },
      { label: "Destination tag", value: { kind: "text", text: "None", faint: true } },
      { label: "Owner reserve", value: { kind: "amount", amount: { value: "0.2", currency: "XRP" } }, hint: "Held from the source’s balance while the channel exists." },
    ]);
  });

  it("says what it was opened with and how many fundings came later (channel-long: 1,000 XRP, 11 fundings, 108 claims)", async () => {
    const data = page(indexed(await answerOf("xrpl", "channel-long")));
    expect(rowOf(data, "Deposited")!.hint).toBe("1,000 XRP when it was opened, 11 fundings added later.");
    expect(rowOf(data, "Paid out")!.hint).toBe("Claimed so far, in 108 claims redeemed on the ledger.");
    // one funding, none, and the claims of a channel that is gone
    const one = answerWith("open", { funds: 1, claims: 0 });
    expect(rowOf(page(indexed(one)), "Deposited")!.hint).toBe("1 XRP when it was opened, 1 funding added later.");
    const closed = page(indexed(answerWith("closed", { removed: removal("PaymentChannelClaim"), claims: 3 })));
    expect(rowOf(closed, "Paid out")!.hint).toBe("Claimed in all, in 3 claims redeemed on the ledger.");
  });

  it("leaves the hints out when the index does not hold the whole history: the counts would be of part of it", async () => {
    const answer = await answerOf("xrpl", "channel-closed");
    expect(answer.coverage.complete).toBe(false);
    const data = page(indexed({ ...answer, payment_channel: { ...answer.payment_channel, claims: 4, funds: 2, opened_with: xrp("5") } }));
    expect(rowOf(data, "Deposited")).not.toHaveProperty("hint");
    expect(rowOf(data, "Paid out")).not.toHaveProperty("hint");
    // and without opened_with the first alone
    const incomplete = paymentChannelAnswerSample();
    delete incomplete.payment_channel.opened_with;
    expect(rowOf(page(indexed(incomplete)), "Deposited")).not.toHaveProperty("hint");
    expect(rowOf(page(indexed(incomplete)), "Paid out")).toHaveProperty("hint");
  });

  it("says where what is left goes in each state", async () => {
    expect(rowOf(page(indexed(await answerOf("xrpl", "channel-closing"))), "Left")!.hint).toBe("Goes back to the source when the channel closes, unless the destination claims it first.");
    expect(rowOf(page(indexed(await answerOf("xrpl", "channel-open"))), "Left")!.hint).toBe("Can still be paid out by claims.");
  });

  it("shows the settle delay in words and seconds, in the largest unit that holds it exactly", () => {
    const settle = (seconds: number) => (rowOf(page(indexed(answerWith("open", { settle_delay: seconds }))), "Settle delay")!.value as { text: string }).text;
    expect(settle(86_400)).toBe("1 day · 86,400 s");
    expect(settle(43_200)).toBe("12 hours · 43,200 s");
    expect(settle(2_592_000)).toBe("30 days · 2,592,000 s");
    expect(settle(5400)).toBe("90 minutes · 5,400 s");
    expect(settle(3600)).toBe("1 hour · 3,600 s");
    expect(settle(129_600)).toBe("36 hours · 129,600 s");
    expect(settle(100)).toBe("100 seconds");
    expect(settle(45)).toBe("45 seconds");
    expect(settle(1)).toBe("1 second");
    expect(settle(0)).toBe("0 seconds");
  });

  it("shows the destination tag as a number, and has Expires only with an expiration and Closes by only with a CancelAfter", async () => {
    const tagged = page(indexed(answerWith("open", { destination_tag: 7741 })));
    expect(rowOf(tagged, "Destination tag")!.value).toEqual({ kind: "number", text: "7741" });
    expect(labels(tagged)).not.toContain("Expires");
    expect(labels(tagged)).not.toContain("Closes by");
    const both = page(indexed(answerWith("closing", { expiration: "2026-11-01T00:00:00Z", cancel_after: "2027-07-01T00:00:00Z" })));
    expect(labels(both).slice(-4)).toEqual(["Expires", "Closes by", "Destination tag", "Owner reserve"]);
    // the source tag is not a row of the channel
    expect(labels(page(indexed(answerWith("open", { source_tag: 5 }))))).not.toContain("Source tag");
  });

  it("drops the Owner reserve row when server_state failed", async () => {
    const data = page(indexed(await answerOf("xrpl", "channel-open")), { serverState: null });
    expect(data.reserve).toBeNull();
    expect(labels(data)).not.toContain("Owner reserve");
  });

  it("carries the notes: as of the ledger's close, and the names it is given", async () => {
    const names = { state: "ok", map: {} } as const;
    const data = page(indexed(await answerOf("xrpl", "channel-open")), { names });
    expect(data.asOf).toBe("As of ledger #107,972,102, Oct 29, 2026, 03:50 UTC.");
    expect(data.names).toBe(names);
  });

  it("leaves out `on {day}` when the creation is not in the index, says Created before ledger #N, and shows the coverage note (channel-closed)", async () => {
    const answer = await answerOf("xrpl", "channel-closed");
    const data = page(indexed(answer));
    expect(data.titleLine).toEqual({ kind: "before", ledger: answer.coverage.from_ledger_index });
    expect(data.coverage).toEqual({ before: "Covers ledger ", ledger: answer.coverage.from_ledger_index, after: " onwards: earlier events of this payment channel are not in the index yet." });
    expect(page(indexed(await answerOf("xrpl", "channel-open"))).coverage).toBeNull();
  });

  it("describes the channel for the meta tags with short addresses: no name goes in (C14)", async () => {
    const answer = await answerOf("xrpl", "channel-open");
    const names: NamesPart = { state: "ok", map: { [answer.payment_channel.account]: { name: { text: "Glimmerfield Games", kind: "verified" }, domain: "glimmerfield.example", labels: [] } } };
    const data = page(indexed(answer), { names });
    expect(data.meta).toEqual({
      id: answer.payment_channel.channel_id,
      amount: "1 XRP",
      owner: shortAddress(answer.payment_channel.account),
      destination: shortAddress(answer.payment_channel.destination),
      status: "open",
      marker: false,
    });
    expect(JSON.stringify(data.meta)).not.toContain("Glimmerfield");
    expect(page(indexed(await answerOf("xrpl", "channel-closing"))).meta.status).toBe("closing");
    expect(page(indexed(paymentChannelAnswerSample(), historySample()), { marker: "M1" }).meta.marker).toBe(true);
  });
});

// ---- A channel of tokens ------------------------------------------------------------------------------------------------------------------------

describe("paymentChannelPage: Xahau's channel of tokens (xahau-token-channel)", () => {
  it("shows the token with its issuer in the rows and the amounts, and the issuer only in a title in the sentences", async () => {
    const answer = await answerOf("xahau", "xahau-token-channel");
    const issuer = answer.payment_channel.amount!.issuer!;
    const data = page(indexed(answer), {}, XAHAU);
    expect(data.net).toBe("xahau");
    expect(rowOf(data, "Deposited")).toMatchObject({ value: { kind: "amount", amount: { value: "1", currency: "DHA", issuer } }, hint: "1 DHA when it was opened." });
    expect(rowOf(data, "Paid out")!.value).toEqual({ kind: "amount", amount: { value: "0.023506", currency: "DHA", issuer } });
    expect(rowOf(data, "Left")!.value).toEqual({ kind: "amount", amount: { value: "0.976494", currency: "DHA", issuer } });
    expect(data.summary).toContainEqual({ t: "amount", value: "1", currency: "DHA", issuer });
    expect(data.statusLines.map(said)[0]).toBe("Open: 0.976494 DHA of 1 DHA left to pay out");
    expect(data.shares.map((share) => share.amount)).toEqual([
      { value: "0.023506", currency: "DHA", issuer },
      { value: "0.976494", currency: "DHA", issuer },
    ]);
    expect(data.reserve).toMatchObject({ currency: "XAH" });
    expect(data.meta.amount).toBe("1 DHA");
    expect(drawnAccounts(data).filter((address) => address === issuer)).toHaveLength(1);
  });

  it("shows an MPT deposit raw, and as words in the sentences", () => {
    const mpt = (value: string) => ({ currency: MPT_ISSUANCE_ID, issuer: SOURCE, value, mpt_issuance_id: MPT_ISSUANCE_ID });
    const data = page(indexed(answerWith("open", { amount: mpt("5000"), balance: mpt("1200"), remaining: mpt("3800"), opened_with: mpt("5000") })));
    expect(rowOf(data, "Deposited")!.value).toEqual({ kind: "amount", amount: { mpt: { id: MPT_ISSUANCE_ID, units: "5000" } } });
    expect(said(data.summary)).toContain("with 5,000 units of MPT 0000012A… deposited in all.");
    expect(data.statusLines.map(said)[0]).toBe("Open: 3,800 units of MPT 0000012A… of 5,000 units of MPT 0000012A… left to pay out");
    expect(data.deposit.rows[0]).toMatchObject({ total: "5000", segments: [{ value: "1200" }, { value: "3800" }] });
    expect(data.meta.amount).toBe("5,000 units of MPT 0000012A…");
  });
});

// ---- Absent fields ------------------------------------------------------------------------------------------------------------------------------

describe("paymentChannelPage: fields D5 could not read (T1)", () => {
  it("draws a dash for an amount, a balance or a remaining D5 could not read, and for a missing settle delay or public key", async () => {
    const answer = await answerOf("xrpl", "channel-open");
    for (const key of ["amount", "balance", "remaining", "settle_delay", "public_key"] as const) delete answer.payment_channel[key];
    for (const each of answer.history) {
      delete each.amount;
      delete each.balance;
      delete each.settle_delay;
    }
    const data = page(indexed(answer));
    expect(rowOf(data, "Deposited")!.value).toEqual({ kind: "amount", amount: null });
    expect(rowOf(data, "Paid out")!.value).toEqual({ kind: "amount", amount: null });
    expect(rowOf(data, "Left")!.value).toEqual({ kind: "amount", amount: null });
    expect(rowOf(data, "Settle delay")).toEqual({ label: "Settle delay", field: "SettleDelay", value: { kind: "text", text: "—", faint: true } });
    expect(rowOf(data, "Public key")).toEqual({ label: "Public key", field: "PublicKey", value: { kind: "text", text: "—", faint: true } });
    // the sentences still read, and the bar has nothing to draw
    expect(said(data.summary)).toBe(`${shortAddress(answer.payment_channel.account)} opened a payment channel to ${shortAddress(answer.payment_channel.destination)} on Oct 13, 2026.`);
    expect(data.statusLines.map(said)).toEqual(["Open: claims can be redeemed", "No close has been requested, and no end time is set."]);
    expect(said(data.timeline[0]!.what)).toBe("Opened the channel with funds.");
    expect(said(data.timeline[1]!.what)).toBe("Paid out 0.032185 XRP more.");
    expect(data.deposit.rows).toEqual([]);
    expect(data.shares).toEqual([]);
    expect(data.amount).toBeNull();
    expect(data.meta.amount).toBe("");
    expect(JSON.stringify([data.summary, data.statusLines, data.timeline.map((item) => item.what)])).not.toMatch(/undefined|NaN|null/);
  });

  it("still reads when only some of them are missing, in each status", async () => {
    for (const which of ["channel-open", "channel-closing", "channel-closed"] as const) {
      const answer = await answerOf("xrpl", which);
      delete answer.payment_channel.remaining;
      delete answer.payment_channel.balance;
      const data = page(indexed(answer));
      const everything = [...data.summary, ...data.statusLines.flat(), ...(data.banner?.sentence ?? []), ...data.timeline.flatMap((item) => item.what)];
      expect(JSON.stringify(everything), which).not.toMatch(/undefined|NaN|null/);
      expect(data.deposit.rows, which).toEqual([]);
      if (which === "channel-closing") expect(data.statusLines.map(said)[1], which).toContain("and the funds left go back to the source.");
      if (which === "channel-closed") {
        expect(data.statusLines.map(said)[0]).toBe("Closed");
        expect(said(data.banner!.sentence)).toBe("Closed on Feb 10, 2026, 05:01 UTC.");
      }
    }
  });
});

// ---- From the node ------------------------------------------------------------------------------------------------------------------------------

describe("paymentChannelPage from the node", () => {
  it("channel-open: an open channel with no history, no counts and Last changed in ledger #N", async () => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "channel-open");
    const data = page(fromNode(entry, ledgerIndex, Date.UTC(2026, 9, 29) / 1000));
    expect(data).toMatchObject({ kind: "payment-channel", origin: "node", removed: false, banner: null, paging: null, pill: { tone: "info", text: "Open" }, id: entry.index });
    expect(data.titleLine).toEqual({ kind: "changed", ledger: entry.PreviousTxnLgrSeq, tx: entry.PreviousTxnID });
    expect(lines(data)).toEqual(["next:PaymentChannelClaim:Not closed"]);
    expect(data.asOf).toMatch(/^Read live from the network at ledger #[\d,]+\.$/);
    expect(data.coverage).toEqual({ before: "The index does not hold this history yet.", ledger: null, after: "" });
    // the node's drops in whole units, and a remaining worked out
    expect(rowOf(data, "Deposited")!.value).toEqual({ kind: "amount", amount: { value: "1", currency: "XRP" } });
    expect(rowOf(data, "Paid out")!.value).toEqual({ kind: "amount", amount: { value: "0.032185", currency: "XRP" } });
    expect(rowOf(data, "Left")!.value).toEqual({ kind: "amount", amount: { value: "0.967815", currency: "XRP" } });
    expect(data.deposit.rows[0]).toMatchObject({ total: "1" });
    expect(said(data.summary)).toMatch(/^\w+…\w+ opened a payment channel to \w+…\w+, with 1 XRP deposited in all\.$/);
  });

  it("leaves out the hints that are made of opened_with, funds and claims", async () => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "channel-open");
    const data = page(fromNode(entry, ledgerIndex, Date.UTC(2026, 9, 29) / 1000));
    expect(rowOf(data, "Deposited")).not.toHaveProperty("hint");
    expect(rowOf(data, "Paid out")).not.toHaveProperty("hint");
    // the other hints stay
    expect(rowOf(data, "Left")!.hint).toBe("Can still be paid out by claims.");
    expect(rowOf(data, "Settle delay")).toHaveProperty("hint");
  });

  it("works the status out from the node's times at the request time", async () => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "channel-closing");
    const expiration = (entry.Expiration as number) + RIPPLE_EPOCH_OFFSET;
    const before = page(fromNode(entry, ledgerIndex, expiration - 100));
    expect(before.pill).toEqual({ tone: "warn", text: "Closing" });
    expect(before.statusLines.map(said)[0]).toBe("Closing: claims can still be redeemed until Nov 13, 2026, 02:25 UTC");
    expect(lines(before)).toEqual(["next:PaymentChannelClaim:Not closed yet"]);
    expect(before.timeline[0]).toMatchObject({ at: expiration, whenText: "From Nov 13, 2026, 02:25 UTC" });
    const after = page(fromNode(entry, ledgerIndex, expiration + 100));
    expect(after.statusLines.map(said)[0]).toBe("Closing: any transaction on the channel now closes it");
    expect(rowOf(after, "Expires")!.value).toEqual({ kind: "time", at: expiration });
  });

  it("is closing from its CancelAfter, with no expiration, once that has come", async () => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "channel-open");
    const cancelAfter = 846_000_000;
    const channel = { ...entry, CancelAfter: cancelAfter };
    const at = (now: number) => page(fromNode(channel, ledgerIndex, now));
    const open = at(cancelAfter + RIPPLE_EPOCH_OFFSET - 1);
    expect(open.pill.text).toBe("Open");
    expect(open.timeline[0]).toMatchObject({ title: "Not closed", at: cancelAfter + RIPPLE_EPOCH_OFFSET });
    const closing = at(cancelAfter + RIPPLE_EPOCH_OFFSET);
    expect(closing.pill.text).toBe("Closing");
    expect(closing.statusLines.map(said)[0]).toBe("Closing: any transaction on the channel now closes it");
    expect(closing.states.find((state) => state.id === "closing")!.meaning).toBe("CancelAfter has passed; any transaction on the channel now closes it.");
    expect(open.states.find((state) => state.id === "closing")!.meaning).toBe("Close requested; it closes after the settle delay.");
  });

  it("reads a channel that has never paid out (no Balance in the entry), and a token channel of Xahau", async () => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "channel-open");
    const { Balance: _balance, ...fresh } = entry;
    const data = page(fromNode(fresh, ledgerIndex, 1_790_000_000));
    expect(rowOf(data, "Paid out")!.value).toEqual({ kind: "amount", amount: { value: "0", currency: "XRP" } });
    expect(data.statusLines.map(said)[1]).toBe("No claim has been redeemed yet. No close has been requested, and no end time is set.");
    const token = await entryOf("xahau", "xahau-token-channel");
    const xahau = page(fromNode(token.entry, token.ledgerIndex, 1_790_000_000), {}, XAHAU);
    expect(xahau.net).toBe("xahau");
    expect(xahau.amount).toMatchObject({ currency: "DHA" });
    expect(xahau.reserve).toMatchObject({ currency: "XAH" });
    expect(xahau.shares[0]!.amount).toMatchObject({ currency: "DHA", value: "0.023506" });
  });

  it("refuses an entry without its Account or Destination (an UpstreamError the loader turns into a 503)", async () => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "channel-open");
    const { Account: _account, ...broken } = entry;
    expect(() => page(fromNode(broken, ledgerIndex, 1))).toThrow(/Account/);
  });
});

// ---- Plain data -----------------------------------------------------------------------------------------------------------------------------------

describe("paymentChannelPage holds unix seconds and strings only: no ages", () => {
  const CASES = ["channel-open", "channel-closing", "channel-closed", "channel-long"] as const;

  it.each(CASES)("%s: only strings, whole numbers, booleans, arrays and plain objects", async (which) => {
    const data = page(indexed(await answerOf("xrpl", which)));
    expect(structuredClone(data)).toEqual(data);
    for (const [path, value] of walk(data)) {
      if (typeof value === "number") expect(Number.isSafeInteger(value), path).toBe(true);
      if (typeof value === "string") expect(value, path).not.toMatch(/\bago\b|\bin (under a minute|~?\d+ (min|h|hours|days))|\bfor \d+ (min|h|days)|^in /);
    }
  });

  it.each(CASES)("%s: the same page at any time of day (no clock)", async (which) => {
    const answer = await answerOf("xrpl", which);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T04:00:00Z"));
    const early = page(indexed(answer));
    vi.setSystemTime(new Date("2031-03-01T12:34:56Z"));
    expect(page(indexed(answer))).toEqual(early);
  });

  it("writes every time of the page as a number the page can put an age beside, or as words with an absolute date", async () => {
    const data = page(indexed(await answerOf("xrpl", "channel-closing")));
    for (const item of data.timeline) {
      if (item.kind !== "tx") expect(item.whenText, item.type).toMatch(/\b20\d\d, \d\d:\d\d UTC$/);
      if (item.at !== undefined) expect(Number.isSafeInteger(item.at)).toBe(true);
    }
  });
});

// ---- The accounts the page draws --------------------------------------------------------------------------------------------------------------

describe("drawnAccounts", () => {
  /** The recorded channels the test reads, each asked for by name: one the fixtures lack fails the test (`objectCase` throws), none is skipped. */
  const RECORDED: ReadonlyArray<readonly [NetName, ObjectCase]> = [
    ["xrpl", "channel-open"],
    ["xrpl", "channel-closing"],
    ["xrpl", "channel-closed"],
    ["xrpl", "channel-long"],
    ["xahau", "channel-open"],
    ["xahau", "xahau-token-channel"],
  ];
  const A = (n: number) => `r${String(n).repeat(25)}`.slice(0, 26);
  const account = (v: string): Segment => ({ t: "account", v });

  it("lists the source, the destination, the issuer of a token in the amount rows and a delegate, each once, in the order the page draws them", () => {
    const token = (value: string) => ({ currency: "USD", issuer: TOKEN_ISSUER, value });
    const answer = answerWith("open", { amount: token("100"), balance: token("10"), remaining: token("90"), opened_with: token("100") }, [
      event({ event: "update", tx_type: "AccountSet", account: SOURCE, delegate: DELEGATE }),
    ]);
    expect(drawnAccounts(page(indexed(answer)))).toEqual([SOURCE, DESTINATION, TOKEN_ISSUER, DELEGATE]);
  });

  it("lists exactly the accounts that the page holds, on every recorded channel and on one read from the node: collectAddresses over the page finds no other", async () => {
    const seen = new Set<string>();
    const node = await entryOf("xahau", "xahau-token-channel");
    const pages = [
      ...(await Promise.all(RECORDED.map(async ([net, which]) => page(indexed(await answerOf(net, which)), {}, net === "xrpl" ? XRPL : XAHAU)))),
      page(fromNode(node.entry, node.ledgerIndex, 1_790_000_000), {}, XAHAU),
    ];
    for (const data of pages) {
      const drawn = drawnAccounts(data);
      expect(new Set(drawn).size, data.id).toBe(drawn.length);
      expect([...collectAddresses({ ...data, names: undefined, meta: undefined })].sort(), data.id).toEqual([...drawn].sort());
      // the source and the destination come first
      expect(drawn.slice(0, 2), data.id).toEqual([data.details[1]!.value, data.details[2]!.value].map((value) => (value as { address: string }).address));
      drawn.forEach((address) => seen.add(address));
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it("lists the accounts of each place a sentence stands: the summary, the status lines, the claims paragraph, the banner and what a timeline item did", async () => {
    const base = page(indexed(await answerOf("xrpl", "channel-open")));
    const one = (extra: Partial<PaymentChannelPageData>) => drawnAccounts({ ...base, ...extra });
    expect(one({ summary: [account(A(1))] })).toContain(A(1));
    expect(one({ statusLines: [[account(A(2))], [{ t: "text", v: "x" }, account(A(3))]] })).toEqual(expect.arrayContaining([A(2), A(3)]));
    expect(one({ claimsNote: [account(A(8))] })).toContain(A(8));
    expect(one({ banner: { ledger: 1, txType: "PaymentChannelClaim", hash: "H", sentence: [account(A(4))] } })).toContain(A(4));
    expect(one({ timeline: [{ kind: "next", type: "PaymentChannelClaim", title: "t", what: [account(A(5))] }] })).toContain(A(5));
    expect(one({ timeline: [{ kind: "tx", type: "PaymentChannelClaim", title: "t", what: [account(A(9))], by: A(6), delegate: A(7) }] })).toEqual(expect.arrayContaining([A(9), A(6), A(7)]));
    // the first listed is the banner's, then the summary's
    expect(one({ banner: { ledger: 1, txType: "PaymentChannelClaim", hash: "H", sentence: [account(A(4))] }, summary: [account(A(1))] }).slice(0, 2)).toEqual([A(4), A(1)]);
    // a timeline item's sentence is drawn before the account that sent it
    expect(one({ summary: [], statusLines: [], details: [], timeline: [{ kind: "tx", type: "PaymentChannelClaim", title: "t", what: [account(A(5))], by: A(6) }] })).toEqual([A(5), A(6)]);
  });

  it("never lists the issuer of an amount that appears only in a title, nor one under the deposit bar", async () => {
    const base = page(indexed(await answerOf("xrpl", "channel-open")));
    const issued = (issuer: string): Segment => ({ t: "amount", value: "1", currency: "USD", issuer });
    const drawn = drawnAccounts({
      ...base,
      summary: [issued(A(1))],
      statusLines: [[issued(A(2))]],
      banner: { ledger: 1, txType: "PaymentChannelClaim", hash: "H", sentence: [issued(A(3))] },
      claimsNote: [issued(A(9))],
      shares: [{ id: "paid", name: "Paid out", amount: { value: "1", currency: "USD", issuer: A(5) }, share: "1% of the deposit" }],
      timeline: [{ kind: "tx", type: "PaymentChannelCreate", title: "t", what: [issued(A(4))], by: SOURCE }],
    });
    expect(drawn).toEqual([SOURCE, DESTINATION]);
    for (const n of [1, 2, 3, 4, 5, 9]) expect(drawn).not.toContain(A(n));
  });

  it("does not list the names it is given, nor a short address of the meta", async () => {
    const answer = await answerOf("xrpl", "channel-open");
    const other = A(9);
    const names: NamesPart = { state: "ok", map: { [other]: { name: { text: "Elsewhere", kind: "account" }, labels: [] } } };
    const data = page(indexed(answer), { names });
    expect(drawnAccounts(data)).toEqual([answer.payment_channel.account, answer.payment_channel.destination]);
    expect(drawnAccounts(data)).not.toContain(other);
  });
});

// ---- A few things the fixtures do not have ------------------------------------------------------------------------------------------------------------

describe("paymentChannelPage: other cases", () => {
  it("refuses an answer of another kind", () => {
    const check = { origin: "index", answer: { result: "success", coverage: { complete: true }, ledger_index: 1, close_time: "2026-10-29T03:50:41Z", check: {}, history: [] } } as unknown as ObjectSource;
    expect(() => page(check)).toThrow();
  });

  it("keeps the transaction hash of the sample's claim event on its timeline item", () => {
    expect(page(indexed(paymentChannelAnswerSample())).timeline[1]).toMatchObject({ hash: "886A9054CD78D4C2F1250999F8D65DB3048F8FC9AFB24523AD755B29797AC790", ledger: 107_641_123, by: DESTINATION });
  });

  it("writes the day of the creation with the app's date order", () => {
    const answer = paymentChannelAnswerSample();
    expect(said(page(indexed(answer)).summary)).toContain(` on ${formatDate(unix("2026-10-13T08:05:31Z"))}, with 1 XRP deposited in all.`);
  });
});
