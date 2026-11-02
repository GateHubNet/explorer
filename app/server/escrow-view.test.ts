import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { objectCase, type ObjectCase } from "../../test/support/object-cases";
import {
  ESCROW_DESTINATION,
  ESCROW_ID,
  ESCROW_OWNER,
  escrowAnswerSample,
  historySample,
  MPT_ISSUANCE_ID,
  OBJECT_TX_HASH,
  TOKEN_ISSUER,
  DELEGATE,
} from "../../test/support/object-samples";
import { said, stateOf, walk, XAHAU, XRPL } from "../../test/support/object-view-world";
import type { Segment } from "../domain/describe";
import { shortAddress } from "../domain/format";
import { NO_NAMES, type NamesPart } from "../domain/names";
import type { EscrowAnswer, ObjectEvent, ObjectHistoryPage } from "./api-types";
import { drawnAccounts, escrowPage, windowBarOf, type EscrowPageData } from "./escrow-view";
import type { DetailRow, ObjectSource } from "./ledger-object-view";
import { collectAddresses } from "./names-collect";
import { RIPPLE_EPOCH_OFFSET, type LedgerObject } from "./node-rpc";
import { unixOf } from "./validator-facts";

// ---- The world of the tests ---------------------------------------------------------------------------------------------------------------------

const FIXTURES = new URL("../../test/fixtures/http/", import.meta.url);
const fixture = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8")) as T;
type NetName = "xrpl" | "xahau";

/** The index's answer for a recorded escrow of `which`. */
async function answerOf(net: NetName, which: ObjectCase): Promise<EscrowAnswer> {
  const { id } = await objectCase(net, which);
  return fixture<EscrowAnswer>(`${net}/data-api/escrows/${id}.json`);
}

/** The node's entry for the recorded escrow of `which`, as the source of a page. */
async function entryOf(net: NetName, which: ObjectCase): Promise<{ entry: LedgerObject; ledgerIndex: number }> {
  const { id } = await objectCase(net, which);
  const { result } = fixture<{ result: { node: LedgerObject; ledger_index: number } }>(`${net}/node/ledger_entry/${id}.json`);
  return { entry: result.node, ledgerIndex: result.ledger_index };
}

const indexed = (answer: EscrowAnswer, history?: ObjectHistoryPage): ObjectSource => ({
  origin: "index",
  answer,
  ...(history !== undefined && { history }),
});

type Options = Parameters<typeof escrowPage>[1];
const page = (source: ObjectSource, over: Partial<Options> = {}, net = XRPL): EscrowPageData => escrowPage(source, { net, serverState: stateOf(), names: NO_NAMES, back: [], ...over });

/** What the timeline reads, one line for each item. */
const lines = (data: EscrowPageData): string[] => data.timeline.map((item) => `${item.kind}:${item.type}:${item.title}`);
const unix = (iso: string): number => unixOf(iso);
const rowOf = (data: EscrowPageData, label: string): DetailRow | undefined => data.details.find((row) => row.label === label);

/** The escrow of the sample, removed by `tx_type` at the time given, with its events newest first as D5 serves them. */
function removedAnswer(removedBy: string, status: EscrowAnswer["escrow"]["status"], events: ObjectEvent[] = []): EscrowAnswer {
  const answer = escrowAnswerSample();
  answer.escrow = { ...answer.escrow, status, removed: { ledger_index: 107_960_000, time: "2026-10-27T01:00:02Z", tx_hash: "D".repeat(64), tx_type: removedBy } };
  answer.history = [...events, ...answer.history];
  return answer;
}
const event = (over: Partial<ObjectEvent> & Pick<ObjectEvent, "event" | "tx_type">): ObjectEvent => ({
  ledger_index: 107_960_000,
  time: "2026-10-27T01:00:02Z",
  tx_hash: "D".repeat(64),
  account: ESCROW_DESTINATION,
  result: "tesSUCCESS",
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

// ---- From the index: one escrow of each status ----------------------------------------------------------------------------------------------------

describe("escrowPage from the index", () => {
  const STATES = ["pending", "can_be_finished", "can_be_cancelled", "finished", "cancelled"];

  it("always lists the five states of the board in its order, with their meanings, and marks the escrow's", async () => {
    const data = page(indexed(await answerOf("xrpl", "escrow-pending")));
    expect(data.states.map((state) => state.id)).toEqual(STATES);
    expect(data.states.map((state) => state.label)).toEqual(["Pending", "Can be finished", "Can be cancelled", "Finished", "Cancelled"]);
    expect(data.states.map((state) => state.meaning)).toEqual([
      "Locked: FinishAfter has not passed yet.",
      "FinishAfter has passed: anyone can finish it.",
      "CancelAfter has passed: anyone can cancel it.",
      "Paid to the destination, then removed.",
      "Returned to the owner, then removed.",
    ]);
    expect(data.states.filter((state) => state.current).map((state) => state.id)).toEqual(["pending"]);
  });

  it("says that a conditional escrow can be finished by anyone with the fulfillment", async () => {
    const data = page(indexed(await answerOf("xrpl", "escrow-token")));
    expect(data.states[1]!.meaning).toBe("FinishAfter has passed: anyone with the fulfillment can finish it.");
  });

  it("names no FinishAfter that passed for a conditional escrow that has none: its condition alone holds it", () => {
    const sample = escrowAnswerSample();
    const { finish_after: _none, ...escrow } = sample.escrow;
    const data = page(indexed({ ...sample, escrow: { ...escrow, status: "can_be_finished", condition: "A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100" } }));
    expect(data.states[1]).toMatchObject({ id: "can_be_finished", meaning: "Anyone with the fulfillment can finish it.", current: true });
  });

  describe.each([
    {
      status: "pending" as const,
      which: "escrow-pending" as const,
      pill: { tone: "info", text: "Pending" },
      lines: ["Can be finished by anyone after Jan 1, 2030, 00:00 UTC", "Until then the 100 XRP stay locked."],
      timeline: ["tx:EscrowCreate:Created", "next:EscrowFinish:Not finished yet"],
      windows: [
        ["pending", "other", "2026-10-28T22:14:51Z", "2030-01-01T00:00:00Z"],
        ["finishable", "up", "2030-01-01T00:00:00Z", null],
      ],
      bounds: ["created", "finish_after"],
      mark: "Now · Oct 29 03:50",
    },
    {
      status: "can_be_finished" as const,
      which: "escrow-finishable" as const,
      pill: { tone: "ok", text: "Can be finished" },
      lines: ["Can be finished by anyone, with no end", "FinishAfter passed on Oct 26, 2026, 16:49 UTC. An EscrowFinish sends the 10 XRP to the destination."],
      timeline: ["tx:EscrowCreate:Created", "mark:FinishAfter:Passed", "next:EscrowFinish:Not finished yet"],
      windows: [
        ["pending", "other", "2026-10-25T16:49:20Z", "2026-10-26T16:49:20Z"],
        ["finishable", "up", "2026-10-26T16:49:20Z", null],
      ],
      bounds: ["created", "finish_after"],
      mark: "Now · Oct 29 03:50",
    },
    {
      status: "can_be_cancelled" as const,
      which: "escrow-cancellable" as const,
      pill: { tone: "warn", text: "Can be cancelled" },
      lines: [
        "Can be cancelled: CancelAfter has passed",
        "CancelAfter passed on Oct 15, 2026, 02:25 UTC, so it can no longer be finished. Anyone can send an EscrowCancel to return the 25 XRP to the owner.",
      ],
      timeline: ["tx:EscrowCreate:Created", "mark:FinishAfter:Passed", "mark:CancelAfter:Passed", "next:EscrowCancel:Not cancelled yet"],
      windows: [
        ["pending", "other", "2026-10-14T02:25:30Z", "2026-10-14T03:25:30Z"],
        ["finishable", "up", "2026-10-14T03:25:30Z", "2026-10-15T02:25:30Z"],
        ["cancellable", 2, "2026-10-15T02:25:30Z", null],
      ],
      bounds: ["created", "finish_after", "cancel_after"],
      mark: "Now · Oct 29 03:50",
    },
    {
      status: "finished" as const,
      which: "escrow-finished" as const,
      pill: { tone: "ok", text: "Finished" },
      lines: ["Finished: 75,000 XRB delivered to the destination", "Finished on Oct 28, 2026, 22:14 UTC, by an EscrowFinish."],
      timeline: ["tx:EscrowCreate:Created", "mark:FinishAfter:Passed", "tx:EscrowFinish:Finished"],
      windows: [
        ["pending", "other", "2026-10-27T22:14:51Z", "2026-10-28T22:14:47Z"],
        ["finishable", "up", "2026-10-28T22:14:47Z", null],
      ],
      bounds: ["created", "finish_after"],
      mark: "Finished · Oct 28 22:14",
    },
    {
      status: "cancelled" as const,
      which: "escrow-cancelled" as const,
      pill: { tone: "neutral", text: "Cancelled" },
      lines: ["Cancelled: 40 XRP returned to the owner", "Cancelled on Oct 13, 2026, 08:05 UTC, after CancelAfter had passed. It was never finished."],
      timeline: ["tx:EscrowCreate:Created", "mark:FinishAfter:Passed", "mark:CancelAfter:Passed", "tx:EscrowCancel:Cancelled"],
      windows: [
        ["pending", "other", "2026-10-10T09:03:20Z", "2026-10-10T10:03:20Z"],
        ["finishable", "up", "2026-10-10T10:03:20Z", "2026-10-11T09:03:20Z"],
        ["cancellable", 2, "2026-10-11T09:03:20Z", null],
      ],
      bounds: ["created", "finish_after", "cancel_after"],
      mark: "Cancelled · Oct 13 08:05",
    },
  ])("$status", ({ status, which, pill, lines: statusLines, timeline, windows, bounds, mark }) => {
    it("has its pill, its place in the strip, its status lines, and its marks", async () => {
      const answer = await answerOf("xrpl", which);
      expect(answer.escrow.status).toBe(status);
      const data = page(indexed(answer));
      expect(data).toMatchObject({ kind: "escrow", origin: "index", net: "xrpl", id: answer.escrow.escrow_id, pill });
      expect(data.states.filter((state) => state.current).map((state) => state.id)).toEqual([status]);
      expect(data.statusLines.map(said)).toEqual(statusLines);
      expect(lines(data)).toEqual(timeline);
      expect(data.removed).toBe(status === "finished" || status === "cancelled");
    });

    it("draws the window bar of the escrow: the windows it has, the bounds it has and the mark of the moment", async () => {
      const data = page(indexed(await answerOf("xrpl", which)));
      expect(data.windowBar.segments.map((segment) => [segment.id, segment.slot, segment.from, segment.to])).toEqual(
        windows.map(([id, slot, from, to]) => [id, slot, String(unix(from as string)), to === null ? null : String(unix(to as string))]),
      );
      expect(data.windowBar.bounds.map((bound) => bound.id)).toEqual(bounds);
      expect(data.windowBar.mark.label).toBe(mark);
    });
  });

  it("puts the marks of a finished or cancelled escrow before the transaction that removed it, and the transaction last", async () => {
    for (const which of ["escrow-finished", "escrow-cancelled"] as const) {
      const types = page(indexed(await answerOf("xrpl", which))).timeline.map((item) => item.kind);
      expect(types.at(-1), which).toBe("tx");
      expect(types.indexOf("mark"), which).toBeLessThan(types.lastIndexOf("tx"));
    }
  });

  it("has a removed banner for a finished escrow and for a cancelled one, with the sentence of its type", async () => {
    const finished = page(indexed(await answerOf("xrpl", "escrow-finished")));
    expect(finished.banner).toMatchObject({ ledger: 107_967_068, txType: "EscrowFinish", hash: "375202E930018352EA63F82A1DCAF7795916DC5117C74D013119E67955C157DA" });
    expect(said(finished.banner!.sentence)).toBe("Finished on Oct 28, 2026, 22:14 UTC; the 75,000 XRB went to the destination.");
    const cancelled = page(indexed(await answerOf("xrpl", "escrow-cancelled")));
    expect(said(cancelled.banner!.sentence)).toBe("Cancelled on Oct 13, 2026, 08:05 UTC; the 40 XRP went back to the owner.");
    for (const each of [finished, cancelled]) expect(each.asOf).toMatch(/^From history: the escrow’s last state, before ledger #[\d,]+ removed it\.$/);
    expect(page(indexed(await answerOf("xrpl", "escrow-pending"))).banner).toBeNull();
  });

  it("has the removed pill and no state marked for an escrow another transaction removed (C28: built from the sample)", () => {
    const data = page(indexed(removedAnswer("AccountDelete", "removed")));
    expect(data.pill).toEqual({ tone: "off", text: "Removed" });
    expect(data.states.filter((state) => state.current)).toEqual([]);
    expect(data.states).toHaveLength(5);
    expect(data.statusLines.map(said)).toEqual(["Removed from the ledger by AccountDelete"]);
    expect(data.removed).toBe(true);
    expect(data.banner).toMatchObject({ ledger: 107_960_000, txType: "AccountDelete", hash: "D".repeat(64) });
    expect(said(data.banner!.sentence)).toBe("Removed on Oct 27, 2026, 01:00 UTC.");
    // no marks and nothing that can still happen: the create alone
    expect(lines(data)).toEqual(["tx:EscrowCreate:Created"]);
    expect(data.windowBar.mark.label).toBe("Removed · Oct 27 01:00");
    expect(rowOf(data, "Owner reserve")!.hint).toBe("Released to the owner when the escrow was removed.");
  });

  it("says Removed in the timeline, with the banner's sentence, for an event that removed the escrow (C25)", () => {
    const removedEvent = event({ event: "removed", tx_type: "AccountDelete" });
    const data = page(indexed(removedAnswer("AccountDelete", "removed", [removedEvent])));
    const item = data.timeline.find((each) => each.title === "Removed")!;
    expect(item).toMatchObject({ kind: "tx", type: "AccountDelete", by: ESCROW_DESTINATION, hash: "D".repeat(64), ledger: 107_960_000 });
    expect(item.what).toEqual(data.banner!.sentence);
    expect(said(item.what)).toBe("Removed on Oct 27, 2026, 01:00 UTC.");
  });

  it("titles a change by a transaction no one expects `Changed by {tx_type}`, with no sentence (C25)", () => {
    const answer = escrowAnswerSample();
    answer.history = [event({ event: "update", tx_type: "AccountSet", account: ESCROW_OWNER }), ...answer.history];
    const item = page(indexed(answer)).timeline.find((each) => each.type === "AccountSet")!;
    expect(item).toMatchObject({ kind: "tx", title: "Changed by AccountSet", what: [], by: ESCROW_OWNER });
  });

  it("reads the history from the oldest event to the newest, and keeps the markers in D5's direction (E10Δ4)", () => {
    const answer = escrowAnswerSample({ history_marker: "M1" });
    answer.history = [
      event({ event: "update", tx_type: "AccountSet", time: "2026-10-27T01:00:00Z", ledger_index: 107_900_003 }),
      event({ event: "update", tx_type: "Payment", time: "2026-10-26T01:00:00Z", ledger_index: 107_900_002 }),
      ...escrowAnswerSample().history,
    ];
    const data = page(indexed(answer));
    expect(data.timeline.filter((item) => item.kind === "tx").map((item) => item.ledger)).toEqual([107_897_249, 107_900_002, 107_900_003]);
    const times = data.timeline.flatMap((item) => (item.kind === "tx" ? [item.at!] : []));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(data.paging).toEqual({ newerHref: null, olderHref: `/xrpl/escrows/${ESCROW_ID}?marker=M1` });
    // the answer is left as D5 gave it
    expect(answer.history.map((each) => each.ledger_index)).toEqual([107_900_003, 107_900_002, 107_897_249]);

    // a page of older events, which is newest first as well
    const older = historySample({
      marker: "M2",
      history: [
        event({ event: "update", tx_type: "Payment", time: "2026-10-11T00:00:00Z", ledger_index: 107_600_002 }),
        event({ event: "update", tx_type: "AccountSet", time: "2026-10-10T00:00:00Z", ledger_index: 107_600_001 }),
      ],
    });
    const behind = page(indexed(answer, older), { marker: "M1", back: [] });
    expect(behind.timeline.map((item) => item.ledger)).toEqual([107_600_001, 107_600_002]);
    expect(behind.paging).toEqual({ newerHref: `/xrpl/escrows/${ESCROW_ID}`, olderHref: `/xrpl/escrows/${ESCROW_ID}?marker=M2&back=M1` });
  });

  it("sets `by` on every transaction, and `delegate` only beside it", () => {
    const answer = escrowAnswerSample();
    answer.history = [event({ event: "update", tx_type: "AccountSet", account: ESCROW_DESTINATION, delegate: DELEGATE }), ...answer.history];
    const items = page(indexed(answer)).timeline.filter((item) => item.kind === "tx");
    expect(items.every((item) => item.by !== undefined)).toBe(true);
    expect(items.find((item) => item.delegate !== undefined)).toMatchObject({ by: ESCROW_DESTINATION, delegate: DELEGATE });
    for (const item of items) if (item.delegate !== undefined) expect(item.by).toBeDefined();
  });

  it("says what each event did, with the amount of the escrow, and what a conditional one carried", async () => {
    const created = page(indexed(await answerOf("xrpl", "escrow-pending"))).timeline[0]!;
    expect(created).toMatchObject({ kind: "tx", type: "EscrowCreate", title: "Created" });
    expect(said(created.what)).toBe("Locked 100 XRP for the destination.");
    const finished = page(indexed(await answerOf("xrpl", "escrow-finished"))).timeline.at(-1)!;
    expect(finished).toMatchObject({ type: "EscrowFinish", title: "Finished" });
    expect(said(finished.what)).toBe("Sent 75,000 XRB to the destination, and removed the escrow.");
    const cancelled = page(indexed(await answerOf("xrpl", "escrow-cancelled"))).timeline.at(-1)!;
    expect(said(cancelled.what)).toBe("Returned 40 XRP to the owner and removed the escrow.");
    // behind a condition
    const conditional = page(indexed(await answerOf("xrpl", "escrow-token"))).timeline[0]!;
    expect(said(conditional.what)).toBe("Locked 3,285 XRPL behind a condition for the destination.");
    const answer = removedAnswer("EscrowFinish", "finished", [event({ event: "finish", tx_type: "EscrowFinish", fulfillment: "A0228020" })]);
    answer.escrow.condition = "A0258020";
    expect(said(page(indexed(answer)).timeline.find((item) => item.title === "Finished")!.what)).toBe("Sent 0.5 XRP to the destination with the fulfillment, and removed the escrow.");
  });

  it("says the dates of the marks and the next steps in the page's words", async () => {
    const data = page(indexed(await answerOf("xrpl", "escrow-pending")));
    const next = data.timeline.at(-1)!;
    expect(next).toMatchObject({ kind: "next", type: "EscrowFinish", title: "Not finished yet", at: unix("2030-01-01T00:00:00Z"), whenText: "From Jan 1, 2030, 00:00 UTC" });
    expect(said(next.what)).toBe("Anyone can send it then.");
    const cancellable = page(indexed(await answerOf("xrpl", "escrow-cancellable"))).timeline;
    expect(cancellable[1]).toMatchObject({ kind: "mark", type: "FinishAfter", title: "Passed", at: unix("2026-10-14T03:25:30Z"), whenText: "Oct 14, 2026, 03:25 UTC" });
    expect(said(cancellable[1]!.what)).toBe("From here it could be finished, but no one did.");
    expect(said(cancellable[2]!.what)).toBe("From here it can no longer be finished.");
    // a time that has come has no countdown to draw
    expect(cancellable.at(-1)).toMatchObject({ kind: "next", type: "EscrowCancel", title: "Not cancelled yet", whenText: "Since Oct 15, 2026, 02:25 UTC" });
    expect(cancellable.at(-1)).not.toHaveProperty("at");
    expect(said(cancellable.at(-1)!.what)).toBe("Anyone can send it now; the 25 XRP go back to the owner.");
  });

  it("offers a cancel step only when the escrow has a CancelAfter, and the finish step until it", async () => {
    const withCancel = page(indexed(await answerOf("xrpl", "escrow-pending")));
    expect(lines(withCancel).filter((line) => line.startsWith("next:"))).toEqual(["next:EscrowFinish:Not finished yet"]);
    const answer = escrowAnswerSample({ ...(await answerOf("xrpl", "escrow-pending")) });
    answer.escrow = { ...answer.escrow, cancel_after: "2031-01-01T00:00:00Z" };
    const timed = page(indexed(answer));
    expect(timed.timeline.filter((item) => item.kind === "next").map((item) => [item.type, item.whenText])).toEqual([
      ["EscrowFinish", "From Jan 1, 2030, 00:00 UTC"],
      ["EscrowCancel", "From Jan 1, 2031, 00:00 UTC"],
    ]);
    expect(timed.statusLines.map(said)[1]).toBe("Until then the 100 XRP stay locked. From Jan 1, 2031, 00:00 UTC it can no longer be finished, only cancelled.");
    // finishable until CancelAfter
    const finishable = escrowAnswerSample({ ...(await answerOf("xrpl", "escrow-finishable")) });
    finishable.escrow = { ...finishable.escrow, cancel_after: "2031-01-01T00:00:00Z" };
    const open = page(indexed(finishable));
    expect(open.statusLines.map(said)).toEqual([
      "Can be finished by anyone until Jan 1, 2031, 00:00 UTC",
      "FinishAfter passed on Oct 26, 2026, 16:49 UTC. An EscrowFinish sends the 10 XRP to the destination. From Jan 1, 2031, 00:00 UTC it can only be cancelled.",
    ]);
    expect(open.timeline.at(-2)).toMatchObject({ type: "EscrowFinish", whenText: "Until Jan 1, 2031, 00:00 UTC", at: unix("2031-01-01T00:00:00Z") });
  });
});

// ---- The summary, the title line and the notes --------------------------------------------------------------------------------------------------------

describe("escrowPage: the head", () => {
  it("says who locked what for whom and on which day, with the owner and the destination as account segments", async () => {
    const answer = await answerOf("xrpl", "escrow-pending");
    const data = page(indexed(answer));
    expect(data.summary).toEqual([
      { t: "account", v: answer.escrow.account },
      { t: "text", v: " locked " },
      { t: "amount", value: "100", currency: "XRP" },
      { t: "text", v: " for " },
      { t: "account", v: answer.escrow.destination },
      { t: "text", v: " on Oct 28, 2026." },
    ]);
    expect(data.titleLine).toEqual({ kind: "created", at: unix("2026-10-28T22:14:51Z") });
  });

  it("leaves out `on {day}` when the creation is not in the index, says Created before ledger #N, and shows the coverage note (escrow-incomplete)", async () => {
    const answer = await answerOf("xrpl", "escrow-incomplete");
    expect(answer.escrow.created).toBeUndefined();
    const data = page(indexed(answer));
    expect(said(data.summary)).toBe(`${shortAddress(answer.escrow.account)} locked 50 XRP for ${shortAddress(answer.escrow.destination)}.`);
    expect(data.titleLine).toEqual({ kind: "before", ledger: answer.coverage.from_ledger_index });
    expect(data.coverage).toEqual({ before: "Covers ledger ", ledger: answer.coverage.from_ledger_index, after: " onwards: earlier events of this escrow are not in the index yet." });
    // and a complete one shows none
    expect(page(indexed(await answerOf("xrpl", "escrow-pending"))).coverage).toBeNull();
    // the same escrow has only the transaction that finished it, and the marks
    expect(lines(data)).toEqual(["mark:FinishAfter:Passed", "tx:EscrowFinish:Finished"]);
  });

  it("starts the bar at FinishAfter, with no Created bound and no Pending window, when it was finished after FinishAfter and the creation is unknown", async () => {
    const data = page(indexed(await answerOf("xrpl", "escrow-incomplete")));
    expect(data.windowBar.segments.map((segment) => segment.id)).toEqual(["finishable"]);
    expect(data.windowBar.bounds.map((bound) => bound.id)).toEqual(["finish_after"]);
  });

  it("carries the notes: as of the ledger's close, the reserve, and the names it is given", async () => {
    const names = { state: "ok", map: {} } as const;
    const data = page(indexed(await answerOf("xrpl", "escrow-pending")), { names });
    expect(data.asOf).toBe("As of ledger #107,972,102, Oct 29, 2026, 03:50 UTC.");
    expect(data.names).toBe(names);
    expect(rowOf(data, "Owner reserve")).toEqual({
      label: "Owner reserve",
      value: { kind: "amount", amount: { value: "0.2", currency: "XRP" } },
      hint: "Held from the owner’s balance while the escrow exists; released when it is finished or cancelled.",
    });
  });

  it("drops the Owner reserve row when server_state failed, and says Released for a removed escrow", async () => {
    const without = page(indexed(await answerOf("xrpl", "escrow-pending")), { serverState: null });
    expect(without.reserve).toBeNull();
    expect(rowOf(without, "Owner reserve")).toBeUndefined();
    expect(without.details.map((row) => row.label)).not.toContain("Owner reserve");
    const finished = page(indexed(await answerOf("xrpl", "escrow-finished")));
    expect(rowOf(finished, "Owner reserve")!.hint).toBe("Released to the owner when the escrow was removed.");
    expect(finished.reserve!.hint).toBe("Released to the owner when the escrow was removed.");
  });

  it("describes the escrow for the meta tags with short addresses: no name goes in (C14)", async () => {
    const answer = await answerOf("xrpl", "escrow-pending");
    const names: NamesPart = { state: "ok", map: { [answer.escrow.account]: { name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example", labels: [] } } };
    const data = page(indexed(answer), { names });
    expect(data.meta).toEqual({
      id: answer.escrow.escrow_id,
      amount: "100 XRP",
      owner: shortAddress(answer.escrow.account),
      destination: shortAddress(answer.escrow.destination),
      status: "pending",
      marker: false,
    });
    expect(JSON.stringify(data.meta)).not.toContain("Northpeak");
    expect(page(indexed(removedAnswer("EscrowFinish", "finished"))).meta).toMatchObject({ status: "finished" });
    expect(page(indexed(await answerOf("xrpl", "escrow-cancellable"))).meta.status).toBe("can be cancelled");
  });

  it("marks a page reached with a marker in its meta", () => {
    expect(page(indexed(escrowAnswerSample(), historySample()), { marker: "M1" }).meta.marker).toBe(true);
    expect(page(indexed(escrowAnswerSample())).meta.marker).toBe(false);
  });
});

// ---- The details -------------------------------------------------------------------------------------------------------------------------------

describe("escrowPage: the details", () => {
  const labels = (data: EscrowPageData) => data.details.map((row) => row.label);

  it("lists the board's rows in its order, with its hints", async () => {
    const answer = await answerOf("xrpl", "escrow-cancellable");
    const data = page(indexed(answer));
    expect(data.details).toEqual([
      { label: "Escrow ID", field: "ledger object ID", value: { kind: "code", text: answer.escrow.escrow_id, copy: "escrow ID" } },
      { label: "Owner", field: "source", value: { kind: "account", address: answer.escrow.account } },
      { label: "Destination", value: { kind: "account", address: answer.escrow.destination } },
      { label: "Amount", value: { kind: "amount", amount: { value: "25", currency: "XRP" } } },
      { label: "Can be finished after", field: "FinishAfter", value: { kind: "time", at: unix("2026-10-14T03:25:30Z") }, hint: "The earliest time anyone can send an EscrowFinish." },
      { label: "Can be cancelled after", field: "CancelAfter", value: { kind: "time", at: unix("2026-10-15T02:25:30Z") }, hint: "From this time it can no longer be finished, only cancelled." },
      { label: "Condition", value: { kind: "text", text: "None: time-based only", faint: true }, hint: "No secret is needed to finish it." },
      { label: "Destination tag", value: { kind: "text", text: "None", faint: true } },
      { label: "Source tag", value: { kind: "text", text: "None", faint: true } },
      {
        label: "Owner reserve",
        value: { kind: "amount", amount: { value: "0.2", currency: "XRP" } },
        hint: "Held from the owner’s balance while the escrow exists; released when it is finished or cancelled.",
      },
    ]);
    expect(labels(data)).not.toContain("Fulfillment");
    expect(labels(data)).not.toContain("Transfer rate");
  });

  it("shows the tags as numbers, and None for a time the escrow does not have", async () => {
    const answer = escrowAnswerSample({ ...(await answerOf("xrpl", "escrow-finishable")) });
    answer.escrow = { ...answer.escrow, destination_tag: 30_418, source_tag: 2207 };
    const data = page(indexed(answer));
    expect(rowOf(data, "Destination tag")!.value).toEqual({ kind: "number", text: "30418" });
    expect(rowOf(data, "Source tag")!.value).toEqual({ kind: "number", text: "2207" });
    expect(rowOf(data, "Can be cancelled after")).toEqual({ label: "Can be cancelled after", field: "CancelAfter", value: { kind: "text", text: "None", faint: true } });
  });

  it("shows a condition with a copy button and the board's explanation, and the fulfillment of a finished conditional escrow", () => {
    const answer = removedAnswer("EscrowFinish", "finished", [event({ event: "finish", tx_type: "EscrowFinish", fulfillment: "A0228020BB" })]);
    answer.escrow = { ...answer.escrow, condition: "A0258020AA", fulfillment: "A0228020BB" };
    const data = page(indexed(answer));
    expect(rowOf(data, "Condition")).toEqual({
      label: "Condition",
      value: { kind: "code", text: "A0258020AA", copy: "condition" },
      hint: "A PREIMAGE-SHA-256 crypto-condition: only the fulfillment, the secret whose SHA-256 hash it holds, can finish the escrow. The EscrowFinish revealed it, below.",
    });
    expect(rowOf(data, "Fulfillment")).toEqual({
      label: "Fulfillment",
      value: { kind: "code", text: "A0228020BB", copy: "fulfillment" },
      hint: "The secret that matches the condition, revealed by the EscrowFinish.",
    });
    expect(labels(data).indexOf("Fulfillment")).toBe(labels(data).indexOf("Condition") + 1);
  });

  it("says what a condition means for a cancelled escrow and for one still in the ledger", async () => {
    const hintOf = (answer: EscrowAnswer) => rowOf(page(indexed(answer)), "Condition")!.hint!;
    const cancelled = removedAnswer("EscrowCancel", "cancelled");
    cancelled.escrow.condition = "A0258020AA";
    expect(hintOf(cancelled)).toMatch(/It was cancelled, so the fulfillment was never revealed\.$/);
    const token = await answerOf("xrpl", "escrow-token");
    expect(token.escrow.condition).toBeDefined();
    expect(hintOf(token)).toMatch(/The fulfillment shows here once the escrow is finished\.$/);
    expect(labels(page(indexed(token)))).not.toContain("Fulfillment");
  });

  it("shows a token escrow with its issuer and the transfer rate as a percent, and keeps the issuer in the sentences' amount for its title", async () => {
    const sample = escrowAnswerSample();
    sample.escrow = { ...sample.escrow, amount: { currency: "USD", issuer: TOKEN_ISSUER, value: "1.5e3" }, transfer_rate: 1_005_000_000 };
    const data = page(indexed(sample));
    expect(data.amount).toEqual({ value: "1.5e3", currency: "USD", issuer: TOKEN_ISSUER });
    expect(rowOf(data, "Amount")!.value).toEqual({ kind: "amount", amount: { value: "1.5e3", currency: "USD", issuer: TOKEN_ISSUER } });
    expect(rowOf(data, "Transfer rate")!.value).toEqual({ kind: "text", text: "0.5%" });
    expect(data.summary[2]).toEqual({ t: "amount", value: "1.5e3", currency: "USD", issuer: TOKEN_ISSUER });
    sample.escrow = { ...sample.escrow, transfer_rate: 1_000_000_000 };
    expect(rowOf(page(indexed(sample)), "Transfer rate")!.value).toEqual({ kind: "text", text: "0%" });
  });

  it("shows 0% for a token escrow whose entry has no transfer rate: rippled omits the field when there is no fee", async () => {
    const answer = await answerOf("xrpl", "escrow-token");
    expect(answer.escrow.transfer_rate).toBeUndefined();
    const data = page(indexed(answer));
    expect(data.details.map((row) => row.label)).toEqual(expect.arrayContaining(["Transfer rate"]));
    expect(rowOf(data, "Transfer rate")).toEqual({ label: "Transfer rate", value: { kind: "text", text: "0%" } });
    // after Source tag and before Owner reserve
    const labels = data.details.map((row) => row.label);
    expect(labels.slice(labels.indexOf("Source tag"))).toEqual(["Source tag", "Transfer rate", "Owner reserve"]);
    // from the node, which has no field either
    const { entry, ledgerIndex } = await entryOf("xrpl", "escrow-node-only");
    expect(entry.TransferRate).toBeUndefined();
    expect(rowOf(page({ origin: "node", entry, ledgerIndex, now: Date.UTC(2026, 9, 29) / 1000 }), "Transfer rate")!.value).toEqual({ kind: "text", text: "0%" });
  });

  it("shows no transfer rate row for a native escrow, with the field or without, nor for an MPT whose answer does not carry it", async () => {
    const native = escrowAnswerSample();
    expect(native.escrow.transfer_rate).toBeUndefined();
    expect(rowOf(page(indexed(native)), "Transfer rate")).toBeUndefined();
    native.escrow = { ...native.escrow, transfer_rate: 1_005_000_000 };
    expect(rowOf(page(indexed(native)), "Transfer rate")).toBeUndefined();
    const mpt = await answerOf("xrpl", "escrow-mpt");
    expect(mpt.escrow.transfer_rate).toBeUndefined();
    expect(rowOf(page(indexed(mpt)), "Transfer rate")).toBeUndefined();
  });

  it("shows the transfer rate of an MPT whose answer carries it (D5's key is on any escrow), and of an MPT the node's entry has it on", async () => {
    const mpt = await answerOf("xrpl", "escrow-mpt");
    expect(rowOf(page(indexed({ ...mpt, escrow: { ...mpt.escrow, transfer_rate: 1_005_000_000 } })), "Transfer rate")).toEqual({ label: "Transfer rate", value: { kind: "text", text: "0.5%" } });
    const { entry, ledgerIndex } = await entryOf("xrpl", "escrow-node-only");
    const held = { ...entry, Amount: { mpt_issuance_id: MPT_ISSUANCE_ID, value: "500" }, TransferRate: 1_002_000_000 };
    expect(rowOf(page({ origin: "node", entry: held, ledgerIndex, now: Date.UTC(2026, 9, 29) / 1000 }), "Transfer rate")!.value).toEqual({ kind: "text", text: "0.2%" });
  });

  it("shows no transfer rate for a native escrow, whatever the ledger holds (Xahau's hold the default)", async () => {
    const answer = await answerOf("xahau", "xahau-escrow");
    expect(answer.escrow.transfer_rate).toBe(1_000_000_000);
    expect(labels(page(indexed(answer), {}, XAHAU))).not.toContain("Transfer rate");
  });

  it("shows a token escrow from the recordings with its issuer in the Amount row (escrow-token)", async () => {
    const answer = await answerOf("xrpl", "escrow-token");
    const data = page(indexed(answer));
    expect(data.amount).toEqual({ value: "3285", currency: "5852504C00000000000000000000000000000000", issuer: answer.escrow.amount!.issuer });
    expect(rowOf(data, "Amount")!.value).toMatchObject({ kind: "amount", amount: { issuer: answer.escrow.amount!.issuer } });
  });

  it("shows an MPT escrow raw: the issuance ID and the units, and in the sentences as words (escrow-mpt)", async () => {
    const answer = await answerOf("xrpl", "escrow-mpt");
    const data = page(indexed(answer));
    expect(data.amount).toEqual({ mpt: { id: answer.escrow.amount!.mpt_issuance_id, units: "250" } });
    expect(rowOf(data, "Amount")!.value).toEqual({ kind: "amount", amount: { mpt: { id: answer.escrow.amount!.mpt_issuance_id, units: "250" } } });
    expect(said(data.summary)).toContain("locked 250 units of MPT 0000012A… for");
    expect(data.meta.amount).toBe("250 units of MPT 0000012A…");
    // its issuer is no account the page draws
    expect(drawnAccounts(data)).not.toContain(answer.escrow.amount!.issuer);
  });

  it("draws a dash for an amount D5 could not read, and leaves it out of the sentences with wording that still reads (T1)", async () => {
    const answer = await answerOf("xrpl", "escrow-cancellable");
    delete answer.escrow.amount;
    for (const each of answer.history) delete each.amount;
    const data = page(indexed(answer));
    expect(data.amount).toBeNull();
    expect(rowOf(data, "Amount")).toEqual({ label: "Amount", value: { kind: "amount", amount: null } });
    expect(said(data.summary)).toBe(`${shortAddress(answer.escrow.account)} locked funds for ${shortAddress(answer.escrow.destination)} on Oct 14, 2026.`);
    expect(data.statusLines.map(said)).toEqual([
      "Can be cancelled: CancelAfter has passed",
      "CancelAfter passed on Oct 15, 2026, 02:25 UTC, so it can no longer be finished. Anyone can send an EscrowCancel to return the funds to the owner.",
    ]);
    expect(said(data.timeline[0]!.what)).toBe("Locked funds for the destination.");
    expect(said(data.timeline.at(-1)!.what)).toBe("Anyone can send it now; the funds go back to the owner.");
    expect(data.meta.amount).toBe("");
    // and for each of the other statuses
    for (const which of ["escrow-pending", "escrow-finishable", "escrow-finished", "escrow-cancelled"] as const) {
      const unreadable = await answerOf("xrpl", which);
      delete unreadable.escrow.amount;
      for (const event of unreadable.history) delete event.amount;
      const each = page(indexed(unreadable));
      const everything = [...each.summary, ...each.statusLines.flat(), ...(each.banner?.sentence ?? []), ...each.timeline.flatMap((item) => item.what)];
      expect(everything.some((segment) => segment.t === "amount"), which).toBe(false);
      expect(said(each.summary), which).toContain("locked funds for");
      expect(JSON.stringify(everything), which).not.toMatch(/undefined|NaN|null/);
      if (which === "escrow-finished") expect(each.statusLines.map(said)[0]).toBe("Finished: funds delivered to the destination");
      if (which === "escrow-cancelled") expect(each.statusLines.map(said)[0]).toBe("Cancelled: funds returned to the owner");
    }
  });
});

// ---- The window bar --------------------------------------------------------------------------------------------------------------------------

describe("windowBarOf", () => {
  const D = 86_400;
  const C = Date.UTC(2026, 9, 24, 9, 30) / 1000;
  const NOW = C + 5 * D;
  const now = { at: NOW, word: "Now" } as const;
  const ids = (bar: ReturnType<typeof windowBarOf>) => bar.segments.map((segment) => segment.id);

  it("has the three windows and the three bounds of an escrow with both times, and a mark at the moment the page shows", () => {
    const bar = windowBarOf({ created: C, finishAfter: C + 10 * D, cancelAfter: C + 40 * D }, now);
    expect(bar.segments).toEqual([
      { id: "pending", label: "Pending", slot: "other", from: String(C), to: String(C + 10 * D), range: "Oct 24, 2026, 09:30 UTC to Nov 3, 2026, 09:30 UTC", length: "10 days" },
      { id: "finishable", label: "Can be finished", slot: "up", from: String(C + 10 * D), to: String(C + 40 * D), range: "Nov 3, 2026, 09:30 UTC to Dec 3, 2026, 09:30 UTC", length: "30 days" },
      { id: "cancellable", label: "Can be cancelled", slot: 2, from: String(C + 40 * D), to: null, range: "From Dec 3, 2026, 09:30 UTC, with no end", length: "Until someone cancels it" },
    ]);
    expect(bar.bounds).toEqual([
      { id: "created", label: "Created Oct 24 09:30", at: String(C) },
      { id: "finish_after", label: "FinishAfter Nov 3 09:30", at: String(C + 10 * D) },
      { id: "cancel_after", label: "CancelAfter Dec 3 09:30", at: String(C + 40 * D) },
    ]);
    expect(bar.mark).toEqual({ label: "Now · Oct 29 09:30", at: String(NOW) });
  });

  it("uses only the slots that reach 3:1 on the card in light (1, 2, other, neutral, up, down)", () => {
    const slots = windowBarOf({ created: C, finishAfter: C + D, cancelAfter: C + 2 * D }, now).segments.map((segment) => segment.slot);
    for (const slot of slots) expect([1, 2, "other", "neutral", "up", "down"]).toContain(slot);
  });

  it("leaves out Pending without FinishAfter and Can be cancelled without CancelAfter", () => {
    expect(ids(windowBarOf({ created: C, cancelAfter: C + 40 * D }, now))).toEqual(["finishable", "cancellable"]);
    expect(ids(windowBarOf({ created: C, finishAfter: C + 10 * D }, now))).toEqual(["pending", "finishable"]);
    expect(windowBarOf({ created: C, cancelAfter: C + 40 * D }, now).segments[0]).toMatchObject({ from: String(C), to: String(C + 40 * D) });
    expect(windowBarOf({ created: C, finishAfter: C + 10 * D }, now).segments[1]).toMatchObject({ from: String(C + 10 * D), to: null, length: "Until someone finishes it" });
  });

  it("leaves out an empty window: a Pending of no span, and a Can be finished that ends where it begins", () => {
    expect(ids(windowBarOf({ created: C, finishAfter: C, cancelAfter: C + 40 * D }, now))).toEqual(["finishable", "cancellable"]);
    expect(ids(windowBarOf({ created: C, finishAfter: C + 10 * D, cancelAfter: C + 10 * D }, now))).toEqual(["pending", "cancellable"]);
  });

  it("starts at the earlier of FinishAfter and the as-of time, with no Created bound, when the creation is unknown", () => {
    // FinishAfter ahead of the page: Pending runs from the start of the bar, which is the as-of time
    const ahead = windowBarOf({ finishAfter: NOW + 10 * D, cancelAfter: NOW + 40 * D }, now);
    expect(ids(ahead)).toEqual(["pending", "finishable", "cancellable"]);
    expect(ahead.segments[0]).toMatchObject({ from: null, to: String(NOW + 10 * D), range: "Until Nov 8, 2026, 09:30 UTC", length: "" });
    expect(ahead.bounds.map((bound) => bound.id)).toEqual(["finish_after", "cancel_after"]);
    // FinishAfter behind the page: the bar starts at FinishAfter and there is no Pending to draw
    const behind = windowBarOf({ finishAfter: NOW - 3 * D, cancelAfter: NOW + 40 * D }, now);
    expect(ids(behind)).toEqual(["finishable", "cancellable"]);
    expect(behind.bounds.map((bound) => bound.id)).toEqual(["finish_after", "cancel_after"]);
  });

  it("gives a window whose start is unknown no length: its range, Until {end}, is all its tooltip says", () => {
    const [pending] = windowBarOf({ finishAfter: NOW + 10 * D }, now).segments;
    expect(pending).toMatchObject({ id: "pending", from: null, range: "Until Nov 8, 2026, 09:30 UTC", length: "" });
    // a window with no start whose end is CancelAfter is the same
    const [finishable] = windowBarOf({ cancelAfter: NOW + 10 * D }, now).segments;
    expect(finishable).toMatchObject({ id: "finishable", from: null, range: "Until Nov 8, 2026, 09:30 UTC", length: "" });
    // one with a start, or with neither end, still has its length
    expect(windowBarOf({ created: NOW - D, finishAfter: NOW + 10 * D }, now).segments[0]!.length).toBe("11 days");
    expect(windowBarOf({}, now).segments[0]!.length).toBe("Until someone finishes it");
  });

  it("writes a window with neither end known plainly, and leaves out one with no start whose end has passed", () => {
    expect(windowBarOf({}, now).segments).toEqual([{ id: "finishable", label: "Can be finished", slot: "up", from: null, to: null, range: "With no start or end", length: "Until someone finishes it" }]);
    expect(ids(windowBarOf({ cancelAfter: NOW - D }, now))).toEqual(["cancellable"]);
  });

  it("marks the removal and leaves out the windows that begin after it", () => {
    const finished = { at: C + 20 * D, word: "Finished" } as const;
    const bar = windowBarOf({ created: C, finishAfter: C + 10 * D, cancelAfter: C + 40 * D }, finished);
    expect(ids(bar)).toEqual(["pending", "finishable"]);
    expect(bar.mark).toEqual({ label: "Finished · Nov 13 09:30", at: String(C + 20 * D) });
    // the three bounds stay: they are where the escrow's times were
    expect(bar.bounds.map((bound) => bound.id)).toEqual(["created", "finish_after", "cancel_after"]);
    expect(windowBarOf({ created: C, finishAfter: C + 10 * D, cancelAfter: C + 40 * D }, { at: C + 41 * D, word: "Cancelled" }).mark.label).toBe("Cancelled · Dec 4 09:30");
    expect(ids(windowBarOf({ created: C, finishAfter: C + 10 * D, cancelAfter: C + 40 * D }, { at: C + 41 * D, word: "Cancelled" }))).toEqual(["pending", "finishable", "cancellable"]);
  });

  it("writes the lengths in the board's words", () => {
    const length = (seconds: number) => windowBarOf({ created: C, finishAfter: C + seconds }, now).segments[0]!.length;
    expect([length(30 * 60), length(3600), length(5 * 3600), length(D), length(3 * D), length(59 * D), length(61 * D), length(400 * D)]).toEqual([
      "30 min",
      "1 hour",
      "5 hours",
      "1 day",
      "3 days",
      "59 days",
      "2 months",
      "13 months",
    ]);
  });

  it("keeps a token that follows its content", () => {
    const one = windowBarOf({ created: C, finishAfter: C + D }, now);
    expect(one.token).toBe(windowBarOf({ created: C, finishAfter: C + D }, now).token);
    expect(one.token).not.toBe(windowBarOf({ created: C, finishAfter: C + 2 * D }, now).token);
    expect(one.token).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ---- From the node -----------------------------------------------------------------------------------------------------------------------------

describe("escrowPage from the node", () => {
  // escrow-node-only: a conditional token escrow, FinishAfter and CancelAfter 15 s apart.
  const entryAt = async (offset: number) => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "escrow-node-only");
    const finishAfter = (entry.FinishAfter as number) + RIPPLE_EPOCH_OFFSET;
    return { source: { origin: "node", entry, ledgerIndex, now: finishAfter + offset } as ObjectSource, entry };
  };

  it.each([
    { status: "pending", offset: -100, pill: { tone: "info", text: "Pending" }, marks: ["next:EscrowFinish:Not finished yet", "next:EscrowCancel:Not cancelled"] },
    { status: "can_be_finished", offset: 5, pill: { tone: "ok", text: "Can be finished" }, marks: ["mark:FinishAfter:Passed", "next:EscrowFinish:Not finished yet", "next:EscrowCancel:Not cancelled"] },
    { status: "can_be_cancelled", offset: 60, pill: { tone: "warn", text: "Can be cancelled" }, marks: ["mark:FinishAfter:Passed", "mark:CancelAfter:Passed", "next:EscrowCancel:Not cancelled yet"] },
  ])("$status: the status at the request time, no history, and Last changed in ledger #N", async ({ status, offset, pill, marks }) => {
    const { source, entry } = await entryAt(offset);
    const data = page(source);
    expect(data).toMatchObject({ kind: "escrow", origin: "node", removed: false, banner: null, paging: null, pill, id: entry.index });
    expect(data.states.filter((state) => state.current).map((state) => state.id)).toEqual([status]);
    expect(data.titleLine).toEqual({ kind: "changed", ledger: entry.PreviousTxnLgrSeq, tx: entry.PreviousTxnID });
    expect(lines(data)).toEqual(marks);
    expect(data.asOf).toMatch(/^Read live from the network at ledger #[\d,]+\.$/);
    expect(data.coverage).toEqual({ before: "The index does not hold this history yet.", ledger: null, after: "" });
    expect(data.windowBar.mark.label).toMatch(/^Now · /);
    expect(data.windowBar.mark.at).toBe(String((source as { now: number }).now));
    expect(data.windowBar.bounds.map((bound) => bound.id)).not.toContain("created");
    // no creation, so no day in the sentence
    expect(said(data.summary)).toMatch(/ for \w+…\w+\.$/);
  });

  it("reads the node's amounts, times and condition into the same rows as the index's", async () => {
    const { source, entry } = await entryAt(5);
    const data = page(source);
    expect(data.amount).toEqual({ value: "3888", currency: "5852504C00000000000000000000000000000000", issuer: "rUNuVgEcbL5Po5RKGnq8DP1KukY6RkTSyz" });
    expect(rowOf(data, "Condition")!.value).toEqual({ kind: "code", text: entry.Condition, copy: "condition" });
    expect(rowOf(data, "Can be finished after")!.value).toEqual({ kind: "time", at: (entry.FinishAfter as number) + RIPPLE_EPOCH_OFFSET });
    // the node's CancelAfter is 839949407 Ripple-epoch seconds, which is 2026-08-13T15:16:47Z
    expect(data.statusLines.map(said)[0]).toBe("Can be finished by anyone with the fulfillment until Aug 13, 2026, 15:16 UTC");
  });

  it("works the status out from the node's times at the request time, not from any answer of the index", async () => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "escrow-node-only");
    const finishAfter = (entry.FinishAfter as number) + RIPPLE_EPOCH_OFFSET;
    const at = (now: number) => page({ origin: "node", entry, ledgerIndex, now }).pill.text;
    expect([at(finishAfter - 1), at(finishAfter), at(finishAfter + 1), at(finishAfter + 100)]).toEqual(["Pending", "Pending", "Can be finished", "Can be cancelled"]);
  });

  it("reads an escrow of Xahau in XAH", async () => {
    const { entry, ledgerIndex } = await entryOf("xahau", "xahau-escrow");
    const data = page({ origin: "node", entry, ledgerIndex, now: Date.UTC(2026, 9, 29) / 1000 }, {}, XAHAU);
    expect(data.net).toBe("xahau");
    expect(data.amount).toMatchObject({ currency: "XAH" });
    expect(data.reserve).toMatchObject({ currency: "XAH" });
  });
});

// ---- Plain data -----------------------------------------------------------------------------------------------------------------------------------

describe("escrowPage holds unix seconds and strings only: no ages", () => {
  const CASES = ["escrow-pending", "escrow-finishable", "escrow-cancellable", "escrow-finished", "escrow-cancelled", "escrow-token", "escrow-mpt", "escrow-incomplete"] as const;

  it.each(CASES)("%s: only strings, whole numbers, booleans, arrays and plain objects", async (which) => {
    const data = page(indexed(await answerOf("xrpl", which)));
    expect(structuredClone(data)).toEqual(data);
    for (const [path, value] of walk(data)) {
      if (typeof value === "number") expect(Number.isSafeInteger(value), path).toBe(true);
      if (typeof value === "string") expect(value, path).not.toMatch(/\bago\b|\bin (under|\d|~)|\bfor \d+ (min|h|days)|^in /);
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
    const data = page(indexed(await answerOf("xrpl", "escrow-cancellable")));
    for (const item of data.timeline) {
      if (item.kind !== "tx") expect(item.whenText, item.type).toMatch(/\b20\d\d, \d\d:\d\d UTC$/);
      if (item.at !== undefined) expect(Number.isSafeInteger(item.at)).toBe(true);
    }
    expect(data.titleLine).toMatchObject({ kind: "created" });
    expect(typeof (data.titleLine as { at: number }).at).toBe("number");
  });
});

// ---- The accounts the page draws --------------------------------------------------------------------------------------------------------------

describe("drawnAccounts", () => {
  /** The recorded escrows the test reads, each asked for by name: one the fixtures lack fails the test (`objectCase` throws), none is skipped. */
  const RECORDED: ReadonlyArray<readonly [NetName, ObjectCase]> = [
    ["xrpl", "escrow-pending"],
    ["xrpl", "escrow-finishable"],
    ["xrpl", "escrow-cancellable"],
    ["xrpl", "escrow-finished"],
    ["xrpl", "escrow-cancelled"],
    ["xrpl", "escrow-token"],
    ["xrpl", "escrow-mpt"],
    ["xrpl", "escrow-incomplete"],
    ["xahau", "escrow-pending"],
    ["xahau", "escrow-token"],
    ["xahau", "escrow-incomplete"],
    ["xahau", "xahau-escrow"],
  ];
  const A = (n: number) => `r${String(n).repeat(25)}`.slice(0, 26);

  it("lists the owner, the destination, the issuer of a token in the Amount row, a delegate and every account of a sentence, each once, in the order the page draws them", () => {
    const answer = removedAnswer("EscrowFinish", "finished", [event({ event: "finish", tx_type: "EscrowFinish", account: ESCROW_DESTINATION, delegate: DELEGATE })]);
    answer.escrow = { ...answer.escrow, amount: { currency: "USD", issuer: TOKEN_ISSUER, value: "100" } };
    answer.history = answer.history.map((each) => (each.event === "create" ? { ...each, amount: { currency: "USD", issuer: TOKEN_ISSUER, value: "100" } } : each));
    const data = page(indexed(answer));
    expect(drawnAccounts(data)).toEqual([ESCROW_OWNER, ESCROW_DESTINATION, TOKEN_ISSUER, DELEGATE]);
  });

  it("lists exactly the accounts that the page holds, on every recorded escrow: collectAddresses over the page finds no other", async () => {
    const seen = new Set<string>();
    for (const [net, which] of RECORDED) {
      const data = page(indexed(await answerOf(net, which)), {}, net === "xrpl" ? XRPL : XAHAU);
      const drawn = drawnAccounts(data);
      expect(new Set(drawn).size, `${net} ${which}`).toBe(drawn.length);
      expect([...collectAddresses({ ...data, names: undefined, meta: undefined })].sort(), `${net} ${which}`).toEqual([...drawn].sort());
      // the owner and the destination come first (they are one account where an escrow is to its own owner)
      const parties = [...new Set([data.details[1]!.value, data.details[2]!.value].map((value) => (value as { address: string }).address))];
      expect(drawn.slice(0, parties.length), `${net} ${which}`).toEqual(parties);
      drawn.forEach((address) => seen.add(address));
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it("lists the accounts of each place a sentence stands: the summary, the status lines, the banner and what a timeline item did", () => {
    const base = page(indexed(escrowAnswerSample()));
    const one = (extra: Partial<EscrowPageData>) => drawnAccounts({ ...base, ...extra });
    const account = (v: string): Segment => ({ t: "account", v });
    expect(one({ summary: [account(A(1))] })).toContain(A(1));
    expect(one({ statusLines: [[account(A(2))], [{ t: "text", v: "x" }, account(A(3))]] })).toEqual(expect.arrayContaining([A(2), A(3)]));
    expect(one({ banner: { ledger: 1, txType: "EscrowFinish", hash: "H", sentence: [account(A(4))] } })).toContain(A(4));
    expect(one({ timeline: [{ kind: "next", type: "EscrowCancel", title: "t", what: [account(A(5))] }] })).toContain(A(5));
    expect(one({ timeline: [{ kind: "tx", type: "EscrowCancel", title: "t", what: [], by: A(6), delegate: A(7) }] })).toEqual(expect.arrayContaining([A(6), A(7)]));
    // the first listed is the banner's, then the summary's
    expect(one({ banner: { ledger: 1, txType: "EscrowFinish", hash: "H", sentence: [account(A(4))] }, summary: [account(A(1))] }).slice(0, 2)).toEqual([A(4), A(1)]);
  });

  it("never lists the issuer of an amount that appears only in a title", () => {
    const base = page(indexed(escrowAnswerSample()));
    const issued = (issuer: string): Segment => ({ t: "amount", value: "1", currency: "USD", issuer });
    const drawn = drawnAccounts({
      ...base,
      summary: [issued(A(1))],
      statusLines: [[issued(A(2))]],
      banner: { ledger: 1, txType: "EscrowFinish", hash: "H", sentence: [issued(A(3))] },
      timeline: [{ kind: "tx", type: "EscrowCreate", title: "t", what: [issued(A(4))], by: ESCROW_OWNER }],
    });
    expect(drawn).toEqual([ESCROW_OWNER, ESCROW_DESTINATION]);
    // not an amount in a row that draws no issuer as a link either: the reserve's, and a native one
    expect(drawn).not.toContain(A(1));
  });

  it("lists the issuer of a token in the Amount row once, though the sentences carry it in a title too", async () => {
    const data = page(indexed(await answerOf("xrpl", "escrow-token")));
    const issuer = data.amount && "issuer" in data.amount ? data.amount.issuer! : "";
    expect(issuer).not.toBe("");
    expect(JSON.stringify(data.summary)).toContain(issuer);
    expect(drawnAccounts(data).filter((address) => address === issuer)).toHaveLength(1);
  });

  it("does not list the names it is given, nor a short address of the meta", async () => {
    const answer = await answerOf("xrpl", "escrow-pending");
    const other = A(9);
    const names: NamesPart = { state: "ok", map: { [other]: { name: { text: "Elsewhere", kind: "account" }, labels: [] } } };
    const data = page(indexed(answer), { names });
    expect(drawnAccounts(data)).toEqual([answer.escrow.account, answer.escrow.destination]);
    expect(drawnAccounts(data)).not.toContain(other);
  });
});

// ---- A few things the fixtures do not have ------------------------------------------------------------------------------------------------------------

describe("escrowPage: other cases", () => {
  it("refuses an answer of another kind", () => {
    const check = { origin: "index", answer: { result: "success", coverage: { complete: true }, ledger_index: 1, close_time: "2026-10-29T03:50:41Z", check: {}, history: [] } } as unknown as ObjectSource;
    expect(() => page(check)).toThrow();
  });

  it("keeps the transaction hash of the sample's create event on its timeline item", () => {
    expect(page(indexed(escrowAnswerSample())).timeline[0]).toMatchObject({ hash: OBJECT_TX_HASH, ledger: 107_897_249, by: ESCROW_OWNER });
  });

  it("names the MPT of the sample by its issuance ID", () => {
    const answer = escrowAnswerSample();
    answer.escrow = { ...answer.escrow, amount: { currency: MPT_ISSUANCE_ID, issuer: ESCROW_OWNER, value: "500", mpt_issuance_id: MPT_ISSUANCE_ID } };
    expect(page(indexed(answer)).amount).toEqual({ mpt: { id: MPT_ISSUANCE_ID, units: "500" } });
  });
});
