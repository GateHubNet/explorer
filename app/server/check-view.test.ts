import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { objectCase, type ObjectCase } from "../../test/support/object-cases";
import { checkAnswerSample, CHECK_ID, DELEGATE, ESCROW_OWNER, historySample, MPT_ISSUANCE_ID, TOKEN_ISSUER } from "../../test/support/object-samples";
import { said, stateOf, walk, XAHAU, XRPL } from "../../test/support/object-view-world";
import type { Segment } from "../domain/describe";
import { shortAddress } from "../domain/format";
import { NO_NAMES, type NamesPart } from "../domain/names";
import { formatDate } from "../domain/time-words";
import type { CheckAnswer, ObjectEvent, ObjectHistoryPage } from "./api-types";
import { checkPage, drawnAccounts, type CheckPageData } from "./check-view";
import type { DetailRow, ObjectSource } from "./ledger-object-view";
import { collectAddresses } from "./names-collect";
import { RIPPLE_EPOCH_OFFSET, type LedgerObject } from "./node-rpc";
import { unixOf } from "./validator-facts";

// ---- The world of the tests ---------------------------------------------------------------------------------------------------------------------

const FIXTURES = new URL("../../test/fixtures/http/", import.meta.url);
const fixture = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8")) as T;
type NetName = "xrpl" | "xahau";

/** The index's answer for a recorded check of `which`. */
async function answerOf(net: NetName, which: ObjectCase): Promise<CheckAnswer> {
  const { id } = await objectCase(net, which);
  return fixture<CheckAnswer>(`${net}/data-api/checks/${id}.json`);
}

/** The node's entry for the recorded check of `which`, as the source of a page. */
async function entryOf(net: NetName, which: ObjectCase): Promise<{ entry: LedgerObject; ledgerIndex: number }> {
  const { id } = await objectCase(net, which);
  const { result } = fixture<{ result: { node: LedgerObject; ledger_index: number } }>(`${net}/node/ledger_entry/${id}.json`);
  return { entry: result.node, ledgerIndex: result.ledger_index };
}

const indexed = (answer: CheckAnswer, history?: ObjectHistoryPage): ObjectSource => ({
  origin: "index",
  answer,
  ...(history !== undefined && { history }),
});

type Options = Parameters<typeof checkPage>[1];
const page = (source: ObjectSource, over: Partial<Options> = {}, net = XRPL): CheckPageData => checkPage(source, { net, serverState: stateOf(), names: NO_NAMES, back: [], ...over });

/** What the timeline reads, one line for each item. */
const lines = (data: CheckPageData): string[] => data.timeline.map((item) => `${item.kind}:${item.type}:${item.title}`);
const unix = (iso: string): number => unixOf(iso);
const rowOf = (data: CheckPageData, label: string): DetailRow | undefined => data.details.find((row) => row.label === label);
const labels = (data: CheckPageData) => data.details.map((row) => row.label);

/** The sample's check (a token check, expired), turned into one of another status with the events newest first as D5 serves them. */
function answerWith(status: CheckAnswer["check"]["status"], over: Partial<CheckAnswer["check"]> = {}, events: ObjectEvent[] = []): CheckAnswer {
  const answer = checkAnswerSample();
  answer.check = { ...answer.check, status, ...over };
  answer.history = [...events, ...answer.history];
  return answer;
}
const removal = (txType: string) => ({ ledger_index: 107_960_000, time: "2026-10-27T01:00:02Z", tx_hash: "D".repeat(64), tx_type: txType });
const event = (over: Partial<ObjectEvent> & Pick<ObjectEvent, "event" | "tx_type">): ObjectEvent => ({
  ledger_index: 107_960_000,
  time: "2026-10-27T01:00:02Z",
  tx_hash: "D".repeat(64),
  account: "rBi1QrVjwaNofisZAQnovoXdHkS73FG1tJ",
  result: "tesSUCCESS",
  ...over,
});
const RLUSD = "524C555344000000000000000000000000000000";
const SOURCE = "r9CaVb4X1JVQoi6Q8Gw5cznAMRFARJDWyN";
const DESTINATION = "rBi1QrVjwaNofisZAQnovoXdHkS73FG1tJ";

afterEach(() => {
  vi.useRealTimers();
});

// ---- From the index: one check of each status ---------------------------------------------------------------------------------------------------

describe("checkPage from the index", () => {
  it("always lists the four states of the board in its order, with their meanings, and marks the check's", async () => {
    const data = page(indexed(await answerOf("xrpl", "check-open")));
    expect(data.states.map((state) => [state.id, state.label, state.meaning])).toEqual([
      ["open", "Open", "The destination can cash it."],
      ["cashed", "Cashed", "Paid to the destination, then removed."],
      ["cancelled", "Cancelled", "Cancelled before it was cashed, then removed."],
      ["expired", "Expired", "Can no longer be cashed; stays until someone cancels it."],
    ]);
    expect(data.states.filter((state) => state.current).map((state) => state.id)).toEqual(["open"]);
  });

  describe("open (check-open: 1,000 XRP, no expiration)", () => {
    it("has the info pill, the summary, the status lines and the three boxes of the flow", async () => {
      const answer = await answerOf("xrpl", "check-open");
      const data = page(indexed(answer));
      expect(data).toMatchObject({ kind: "check", origin: "index", net: "xrpl", id: answer.check.check_id, removed: false, banner: null, expiredBanner: null, pill: { tone: "info", text: "Open" } });
      expect(data.summary).toEqual([
        { t: "account", v: answer.check.account },
        { t: "text", v: " wrote a check for up to " },
        { t: "amount", value: "1000", currency: "XRP" },
        { t: "text", v: " to " },
        { t: "account", v: answer.check.destination },
        { t: "text", v: " on Oct 29, 2026." },
      ]);
      expect(data.statusLines.map(said)).toEqual([
        "The destination can cash up to 1,000 XRP, with no expiration",
        "Nothing is set aside: the XRP comes from the source’s balance when the check is cashed, so the source must still hold it then. The source can cancel the check at any time.",
      ]);
      expect(data.flow).toEqual({
        source: { account: answer.check.account, line: "Pays when the check is cashed" },
        check: { title: "Check", line: "up to 1,000 XRP" },
        destination: { account: answer.check.destination, line: "Can cash up to 1,000 XRP" },
      });
      expect(data.titleLine).toEqual({ kind: "created", at: unix("2026-10-29T03:50:41Z") });
    });

    it("can be cashed until its expiration, and by the source or anyone cancelled: the marks say so", async () => {
      const data = page(indexed(await answerOf("xrpl", "check-open")));
      expect(lines(data)).toEqual(["tx:CheckCreate:Created", "next:CheckCash:Not cashed yet", "next:CheckCancel:Not cancelled"]);
      const [cash, cancel] = data.timeline.slice(1);
      expect(cash).not.toHaveProperty("at");
      expect(said(cash!.what)).toBe("The destination can cash it for up to 1,000 XRP.");
      expect(cancel).toMatchObject({ whenText: "The source: any time" });
      expect(said(cancel!.what)).toBe("Cancelling removes the check; nothing is paid.");

      const answer = answerWith("open", { expiration: "2031-01-01T00:00:00Z" });
      const timed = page(indexed(answer));
      expect(timed.statusLines.map(said)[0]).toBe("The destination can cash up to 1 RLUSD until Jan 1, 2031, 00:00 UTC");
      expect(timed.timeline.slice(-2)).toMatchObject([
        { kind: "next", type: "CheckCash", title: "Not cashed yet", at: unix("2031-01-01T00:00:00Z"), whenText: "Until Jan 1, 2031, 00:00 UTC" },
        { kind: "next", type: "CheckCancel", title: "Not cancelled", whenText: "The source: any time · anyone: after Jan 1, 2031, 00:00 UTC" },
      ]);
      expect(timed.flow.check.title).toBe("Check · expires Jan 1, 2031");
    });
  });

  describe("expired (check-expired: 100 XRP, expiration Oct 15)", () => {
    it("has the warn pill, the banner, and the lines of a check that can no longer be cashed", async () => {
      const answer = await answerOf("xrpl", "check-expired");
      const data = page(indexed(answer));
      expect(data.pill).toEqual({ tone: "warn", text: "Expired" });
      expect(data.states.filter((state) => state.current).map((state) => state.id)).toEqual(["expired"]);
      expect(said(data.expiredBanner!)).toBe(
        "An expired check is not removed on its own. It stays until someone sends a CheckCancel, which anyone can do now; until then it holds 0.2 XRP of the source’s reserve.",
      );
      expect(data.expiredBanner).toContainEqual({ t: "amount", value: "0.2", currency: "XRP" });
      expect(data.statusLines.map(said)).toEqual(["Expired: it can no longer be cashed", "Its expiration passed on Oct 15, 2026, 02:25 UTC. Nothing was paid, and nothing will be."]);
      expect(data.flow).toMatchObject({
        source: { line: "Has paid nothing" },
        check: { title: "Check · expired Oct 15, 2026", line: "up to 100 XRP" },
        destination: { line: "Can no longer cash it" },
      });
      expect(data.removed).toBe(false);
      expect(data.banner).toBeNull();
    });

    it("has the passed expiration and the CheckCancel anyone can send, with no countdown to the time that has come", async () => {
      const data = page(indexed(await answerOf("xrpl", "check-expired")));
      expect(lines(data)).toEqual(["tx:CheckCreate:Created", "mark:Expiration:Passed", "next:CheckCancel:Not cancelled yet"]);
      expect(data.timeline[1]).toMatchObject({ at: unix("2026-10-15T02:25:30Z"), whenText: "Oct 15, 2026, 02:25 UTC" });
      expect(said(data.timeline[1]!.what)).toBe("From here it can no longer be cashed.");
      expect(data.timeline[2]).toMatchObject({ whenText: "Since Oct 15, 2026, 02:25 UTC" });
      expect(data.timeline[2]).not.toHaveProperty("at");
      expect(said(data.timeline[2]!.what)).toBe("Anyone can send it now to remove the check and release the source’s reserve.");
    });

    it("words the banner without a reserve when server_state failed", async () => {
      const data = page(indexed(await answerOf("xrpl", "check-expired")), { serverState: null });
      expect(said(data.expiredBanner!)).toBe("An expired check is not removed on its own. It stays until someone sends a CheckCancel, which anyone can do now; until then it keeps part of the source’s balance reserved.");
      expect(data.reserve).toBeNull();
    });

    it("has no banner for any other status", async () => {
      for (const which of ["check-open", "check-cashed", "check-cancelled"] as const) expect(page(indexed(await answerOf("xrpl", which))).expiredBanner, which).toBeNull();
    });
  });

  describe("cashed (check-cashed: 50 XRP of 51, the creation not indexed)", () => {
    it("has the ok pill, what was delivered, and the board's lines for the source and the destination", async () => {
      const answer = await answerOf("xrpl", "check-cashed");
      const data = page(indexed(answer));
      expect(data).toMatchObject({ pill: { tone: "ok", text: "Cashed" }, removed: true, expiredBanner: null });
      expect(data.states.filter((state) => state.current).map((state) => state.id)).toEqual(["cashed"]);
      expect(data.statusLines.map(said)).toEqual(["Cashed: 50 XRP delivered to the destination", "Cashed on Oct 15, 2026, 11:17 UTC, for 50 XRP of the 51 XRP it allowed."]);
      expect(data.flow).toEqual({
        source: { account: answer.check.account, line: "\u221250 XRP" },
        check: { title: "Check · cashed Oct 15, 2026", line: "up to 51 XRP" },
        destination: { account: answer.check.destination, line: "+50 XRP" },
      });
      expect(said(data.summary)).toBe(`${shortAddress(answer.check.account)} wrote a check for up to 51 XRP to ${shortAddress(answer.check.destination)}.`);
    });

    it("says all it allowed when it was cashed for the whole of SendMax", async () => {
      const answer = await answerOf("xrpl", "check-cashed");
      answer.check.delivered = { ...answer.check.send_max! };
      expect(page(indexed(answer)).statusLines.map(said)[1]).toBe("Cashed on Oct 15, 2026, 11:17 UTC, for 51 XRP, all it allowed.");
    });

    it("has the removed banner with the delivered amount, the Delivered row and the CheckCash on the timeline", async () => {
      const data = page(indexed(await answerOf("xrpl", "check-cashed")));
      expect(data.banner).toMatchObject({ ledger: 107_671_568, txType: "CheckCash" });
      expect(said(data.banner!.sentence)).toBe("Cashed on Oct 15, 2026, 11:17 UTC; 50 XRP went to the destination.");
      expect(data.asOf).toMatch(/^From history: the check’s last state, before ledger #107,671,568 removed it\.$/);
      expect(rowOf(data, "Delivered")).toEqual({ label: "Delivered", value: { kind: "amount", amount: { value: "50", currency: "XRP" } }, hint: "What the CheckCash delivered to the destination." });
      expect(lines(data)).toEqual(["tx:CheckCash:Cashed"]);
      expect(said(data.timeline[0]!.what)).toBe("Delivered 50 XRP to the destination and removed the check.");
      expect(data.timeline[0]).toMatchObject({ by: data.flow.destination.account });
    });

    it("cashes a token check for part of SendMax, with the issuer on the check's box and in both rows", () => {
      const answer = answerWith("cashed", { delivered: { currency: RLUSD, issuer: TOKEN_ISSUER, value: "0.438027" }, removed: removal("CheckCash") }, [
        event({ event: "cash", tx_type: "CheckCash", delivered: { currency: RLUSD, issuer: TOKEN_ISSUER, value: "0.438027" } }),
      ]);
      const data = page(indexed(answer));
      expect(data.flow).toMatchObject({
        source: { line: "\u22120.438027 RLUSD" },
        check: { title: "Check · cashed Oct 27, 2026", line: "up to 1 RLUSD", issuer: TOKEN_ISSUER },
        destination: { line: "+0.438027 RLUSD" },
      });
      expect(rowOf(data, "Delivered")!.value).toEqual({ kind: "amount", amount: { value: "0.438027", currency: RLUSD, issuer: TOKEN_ISSUER } });
      expect(data.statusLines.map(said)[1]).toBe("Cashed on Oct 27, 2026, 01:00 UTC, for 0.438027 RLUSD of the 1 RLUSD it allowed.");
    });
  });

  describe("cancelled (check-cancelled: a token check, the creation not indexed)", () => {
    it("has the neutral pill, nothing paid, and the issuer of the token in the check's box", async () => {
      const answer = await answerOf("xrpl", "check-cancelled");
      const data = page(indexed(answer));
      expect(data.pill).toEqual({ tone: "neutral", text: "Cancelled" });
      expect(data.statusLines.map(said)).toEqual(["Cancelled before it was cashed", "The source cancelled it on Oct 28, 2026, 23:45 UTC. Nothing was paid."]);
      expect(data.flow).toEqual({
        source: { account: answer.check.account, line: "Paid nothing" },
        check: { title: "Check · cancelled Oct 28, 2026", line: "up to 135,584,318.6204475 FRIZZY", issuer: answer.check.send_max!.issuer },
        destination: { account: answer.check.destination, line: "Received nothing" },
      });
      expect(said(data.banner!.sentence)).toBe("Cancelled by the source on Oct 28, 2026, 23:45 UTC; nothing was paid.");
      expect(lines(data)).toEqual(["tx:CheckCancel:Cancelled"]);
      expect(said(data.timeline[0]!.what)).toBe("Removed the check. Nothing was paid.");
      expect(data.timeline[0]).toMatchObject({ by: answer.check.account });
    });

    it("does not say the source cancelled it when another account did", async () => {
      const answer = await answerOf("xrpl", "check-cancelled");
      answer.history = answer.history.map((each) => ({ ...each, account: answer.check.destination }));
      const data = page(indexed(answer));
      expect(data.statusLines.map(said)[1]).toBe("It was cancelled on Oct 28, 2026, 23:45 UTC. Nothing was paid.");
      expect(said(data.banner!.sentence)).toBe("Cancelled on Oct 28, 2026, 23:45 UTC; nothing was paid.");
    });
  });

  describe("removed by another transaction (built from the sample)", () => {
    it("has the removed pill, no state marked, no marks, and a banner that says only when", () => {
      const data = page(indexed(answerWith("removed", { removed: removal("AccountDelete") })));
      expect(data.pill).toEqual({ tone: "off", text: "Removed" });
      expect(data.states.filter((state) => state.current)).toEqual([]);
      expect(data.states).toHaveLength(4);
      expect(data.statusLines.map(said)).toEqual(["Removed from the ledger by AccountDelete"]);
      expect(data.banner).toMatchObject({ ledger: 107_960_000, txType: "AccountDelete", hash: "D".repeat(64) });
      expect(said(data.banner!.sentence)).toBe("Removed on Oct 27, 2026, 01:00 UTC.");
      expect(data.flow).toMatchObject({ source: { line: "Paid nothing" }, check: { title: "Check · removed Oct 27, 2026" }, destination: { line: "Received nothing" } });
      expect(lines(data)).toEqual(["tx:CheckCreate:Created"]);
      expect(data.expiredBanner).toBeNull();
      expect(rowOf(data, "Owner reserve")!.hint).toBe("Released to the source when the check was removed.");
    });

    it("says Removed in the timeline, with the banner's sentence (C25), and Changed by {tx_type} for a change no one expects", () => {
      const removed = event({ event: "removed", tx_type: "AccountDelete" });
      const changed = event({ event: "update", tx_type: "AccountSet", account: SOURCE, time: "2026-10-20T00:00:00Z" });
      const data = page(indexed(answerWith("removed", { removed: removal("AccountDelete") }, [removed, changed])));
      const item = data.timeline.find((each) => each.title === "Removed")!;
      expect(item).toMatchObject({ kind: "tx", type: "AccountDelete", by: DESTINATION, hash: "D".repeat(64) });
      expect(item.what).toEqual(data.banner!.sentence);
      expect(data.timeline.find((each) => each.type === "AccountSet")).toMatchObject({ title: "Changed by AccountSet", what: [], by: SOURCE });
    });
  });

  it("puts the transaction that removed a check last, after the marks", async () => {
    for (const which of ["check-cashed", "check-cancelled"] as const) expect(page(indexed(await answerOf("xrpl", which))).timeline.at(-1)!.kind, which).toBe("tx");
  });

  it("reads the history from the oldest event to the newest and keeps the markers in D5's direction", () => {
    const answer = checkAnswerSample({ history_marker: "M1" });
    answer.history = [event({ event: "update", tx_type: "AccountSet", time: "2026-10-17T00:00:00Z", ledger_index: 107_900_002 }), ...checkAnswerSample().history];
    const data = page(indexed(answer));
    expect(data.timeline.filter((item) => item.kind === "tx").map((item) => item.ledger)).toEqual([107_698_980, 107_900_002]);
    expect(data.paging).toEqual({ newerHref: null, olderHref: `/xrpl/checks/${CHECK_ID}?marker=M1` });
    const older = historySample({ marker: "M2", history: [event({ event: "update", tx_type: "Payment", time: "2026-10-11T00:00:00Z", ledger_index: 107_600_002 })] });
    const behind = page(indexed(answer, older), { marker: "M1", back: [] });
    expect(behind.timeline.map((item) => item.ledger)).toEqual([107_600_002]);
    expect(behind.paging).toEqual({ newerHref: `/xrpl/checks/${CHECK_ID}`, olderHref: `/xrpl/checks/${CHECK_ID}?marker=M2&back=M1` });
  });

  it("says what the CheckCreate did, with the check's SendMax and expiration, and keeps the sender, the delegate and the hash", () => {
    const answer = checkAnswerSample();
    answer.history = [{ ...answer.history[0]!, delegate: DELEGATE }];
    const created = page(indexed(answer)).timeline[0]!;
    expect(created).toMatchObject({ kind: "tx", type: "CheckCreate", title: "Created", by: SOURCE, delegate: DELEGATE, ledger: 107_698_980 });
    expect(said(created.what)).toBe("Wrote a check for up to 1 RLUSD, expiring Oct 16, 2026, 17:49 UTC.");
    // without an expiration the sentence has none
    const open = page(indexed(answerWith("open", { expiration: undefined }, [])));
    expect(open.statusLines.map(said)[0]).toBe("The destination can cash up to 1 RLUSD, with no expiration");
  });
});

// ---- The summary, the title line and the notes --------------------------------------------------------------------------------------------------------

describe("checkPage: the head", () => {
  it("leaves out `on {day}` when the creation is not in the index, says Created before ledger #N, and shows the coverage note (check-cashed)", async () => {
    const answer = await answerOf("xrpl", "check-cashed");
    expect(answer.check.created).toBeUndefined();
    const data = page(indexed(answer));
    expect(data.titleLine).toEqual({ kind: "before", ledger: answer.coverage.from_ledger_index });
    expect(data.coverage).toEqual({ before: "Covers ledger ", ledger: answer.coverage.from_ledger_index, after: " onwards: earlier events of this check are not in the index yet." });
    expect(page(indexed(await answerOf("xrpl", "check-open"))).coverage).toBeNull();
  });

  it("carries the notes: as of the ledger's close, the reserve with the board's hint, and the names it is given", async () => {
    const names = { state: "ok", map: {} } as const;
    const data = page(indexed(await answerOf("xrpl", "check-open")), { names });
    expect(data.asOf).toBe("As of ledger #107,972,102, Oct 29, 2026, 03:50 UTC.");
    expect(data.names).toBe(names);
    expect(rowOf(data, "Owner reserve")).toEqual({
      label: "Owner reserve",
      value: { kind: "amount", amount: { value: "0.2", currency: "XRP" } },
      hint: "Held from the source’s balance while the check exists.",
    });
    const without = page(indexed(await answerOf("xrpl", "check-open")), { serverState: null });
    expect(labels(without)).not.toContain("Owner reserve");
  });

  it("describes the check for the meta tags with short addresses: no name goes in (C14)", async () => {
    const answer = await answerOf("xrpl", "check-open");
    const names: NamesPart = { state: "ok", map: { [answer.check.account]: { name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example", labels: [] } } };
    const data = page(indexed(answer), { names });
    expect(data.meta).toEqual({
      id: answer.check.check_id,
      amount: "1,000 XRP",
      owner: shortAddress(answer.check.account),
      destination: shortAddress(answer.check.destination),
      status: "open",
      marker: false,
    });
    expect(JSON.stringify(data.meta)).not.toContain("Northpeak");
    expect(page(indexed(await answerOf("xrpl", "check-expired"))).meta.status).toBe("expired");
    expect(data.meta.marker).toBe(false);
    expect(page(indexed(checkAnswerSample(), historySample()), { marker: "M1" }).meta.marker).toBe(true);
  });
});

// ---- The details -------------------------------------------------------------------------------------------------------------------------------

describe("checkPage: the details", () => {
  it("lists the board's rows in its order, with its hints (an open check with nothing optional)", async () => {
    const answer = await answerOf("xrpl", "check-open");
    const data = page(indexed(answer));
    const none = { kind: "text", text: "None", faint: true };
    expect(data.details).toEqual([
      { label: "Check ID", field: "ledger object ID", value: { kind: "code", text: answer.check.check_id, copy: "Copy check ID" } },
      { label: "Source", value: { kind: "account", address: answer.check.account } },
      { label: "Destination", value: { kind: "account", address: answer.check.destination } },
      {
        label: "Can be cashed for",
        field: "SendMax",
        value: { kind: "amount", amount: { value: "1000", currency: "XRP" } },
        hint: "The most the destination can cash. Nothing is set aside: the source must hold the XRP when the check is cashed.",
      },
      { label: "Expires", field: "Expiration", value: none },
      { label: "Invoice ID", field: "InvoiceID", value: none },
      { label: "Destination tag", value: none },
      { label: "Source tag", value: none },
      { label: "Owner reserve", value: { kind: "amount", amount: { value: "0.2", currency: "XRP" } }, hint: "Held from the source’s balance while the check exists." },
    ]);
  });

  it("shows the expiration, the invoice ID with a copy button, and the tags, with the hints", () => {
    const answer = checkAnswerSample();
    answer.check = { ...answer.check, status: "open", destination_tag: 88231 };
    const data = page(indexed(answer));
    expect(labels(data)).toEqual(["Check ID", "Source", "Destination", "Can be cashed for", "Expires", "Invoice ID", "Destination tag", "Source tag", "Owner reserve"]);
    expect(rowOf(data, "Expires")).toEqual({
      label: "Expires",
      field: "Expiration",
      value: { kind: "time", at: unix("2026-10-16T17:49:51Z") },
      hint: "After this time the check can no longer be cashed.",
    });
    expect(rowOf(data, "Invoice ID")).toEqual({
      label: "Invoice ID",
      field: "InvoiceID",
      value: { kind: "code", text: answer.check.invoice_id, copy: "Copy invoice ID" },
      hint: "Set by the source, for example the hash of an invoice, so the destination can match the payment.",
    });
    expect(rowOf(data, "Destination tag")!.value).toEqual({ kind: "number", text: "88231" });
    expect(rowOf(data, "Source tag")!.value).toEqual({ kind: "number", text: "804681468" });
    expect(data.flow.destination.tag).toBe(88231);
    expect(page(indexed(answerWith("open", { destination_tag: undefined }))).flow.destination).not.toHaveProperty("tag");
  });

  it("says the expiration has passed in the hint of an expired check", async () => {
    const data = page(indexed(await answerOf("xrpl", "check-expired")));
    expect(rowOf(data, "Expires")!.hint).toBe("Passed: the check can no longer be cashed, and anyone can cancel it.");
  });

  it("shows a token SendMax with its issuer in the row and the hint naming the currency", () => {
    const data = page(indexed(checkAnswerSample()));
    expect(rowOf(data, "Can be cashed for")).toEqual({
      label: "Can be cashed for",
      field: "SendMax",
      value: { kind: "amount", amount: { value: "1", currency: RLUSD, issuer: TOKEN_ISSUER } },
      hint: "The most the destination can cash. Nothing is set aside: the source must hold the RLUSD when the check is cashed.",
    });
    expect(data.flow.check).toEqual({ title: "Check · expired Oct 16, 2026", line: "up to 1 RLUSD", issuer: TOKEN_ISSUER });
    // an amount in a sentence keeps its issuer for the title only
    expect(data.summary).toContainEqual({ t: "amount", value: "1", currency: RLUSD, issuer: TOKEN_ISSUER });
  });

  it("shows an MPT SendMax raw, in the rows and as words in the sentences, and no issuer on the flow", () => {
    const mpt = { currency: MPT_ISSUANCE_ID, issuer: ESCROW_OWNER, value: "2500000", mpt_issuance_id: MPT_ISSUANCE_ID };
    const answer = answerWith("open", { send_max: mpt, expiration: undefined });
    const data = page(indexed(answer));
    expect(rowOf(data, "Can be cashed for")!.value).toEqual({ kind: "amount", amount: { mpt: { id: MPT_ISSUANCE_ID, units: "2500000" } } });
    expect(rowOf(data, "Can be cashed for")!.hint).toContain("the source must hold the funds when the check is cashed.");
    expect(said(data.summary)).toContain("up to 2,500,000 units of MPT 0000012A… to");
    expect(data.statusLines.map(said)[1]).toMatch(/^Nothing is set aside: the funds come from the source’s balance/);
    expect(data.flow.check).toEqual({ title: "Check", line: "up to 2,500,000 units of MPT 0000012A…" });
    expect(data.meta.amount).toBe("2,500,000 units of MPT 0000012A…");
    expect(drawnAccounts(data)).not.toContain(ESCROW_OWNER);
  });

  it("draws a dash for an amount D5 could not read, and leaves it out of the sentences with wording that still reads (T1)", async () => {
    for (const which of ["check-open", "check-expired", "check-cashed", "check-cancelled"] as const) {
      const answer = await answerOf("xrpl", which);
      delete answer.check.send_max;
      delete answer.check.delivered;
      for (const each of answer.history) {
        delete each.send_max;
        delete each.delivered;
      }
      const data = page(indexed(answer));
      expect(rowOf(data, "Can be cashed for")).toEqual({
        label: "Can be cashed for",
        field: "SendMax",
        value: { kind: "amount", amount: null },
        hint: "The most the destination can cash. Nothing is set aside: the source must hold the funds when the check is cashed.",
      });
      const everything = [...data.summary, ...data.statusLines.flat(), ...(data.banner?.sentence ?? []), ...(data.expiredBanner ?? []), ...data.timeline.flatMap((item) => item.what)];
      expect(everything.some((segment) => segment.t === "amount" && segment.currency !== "XRP"), which).toBe(false);
      expect(JSON.stringify([everything, data.flow]), which).not.toMatch(/undefined|NaN|null/);
      expect(said(data.summary), which).toBe(`${shortAddress(answer.check.account)} wrote a check to ${shortAddress(answer.check.destination)}${answer.check.created === undefined ? "" : " on " + formatDate(unix(answer.check.created.time))}.`);
      expect(data.flow.check.line, which).toBe("—");
      expect(data.flow.check).not.toHaveProperty("issuer");
      expect(data.meta.amount).toBe("");
      if (which === "check-open") {
        expect(data.statusLines.map(said)[0]).toBe("The destination can cash the check, with no expiration");
        expect(data.flow.destination.line).toBe("Can cash the check");
        expect(said(data.timeline.at(-2)!.what)).toBe("The destination can cash it.");
        expect(said(data.timeline[0]!.what)).toBe("Wrote a check.");
      }
      if (which === "check-cashed") {
        expect(rowOf(data, "Delivered")).toEqual({ label: "Delivered", value: { kind: "amount", amount: null }, hint: "What the CheckCash delivered to the destination." });
        expect(data.statusLines.map(said)).toEqual(["Cashed: funds delivered to the destination", "Cashed on Oct 15, 2026, 11:17 UTC."]);
        expect(data.flow).toMatchObject({ source: { line: "Paid the funds" }, destination: { line: "Received the funds" } });
        expect(said(data.banner!.sentence)).toBe("Cashed on Oct 15, 2026, 11:17 UTC; the funds went to the destination.");
        expect(said(data.timeline[0]!.what)).toBe("Delivered the funds to the destination and removed the check.");
      }
    }
  });
});

// ---- From the node ------------------------------------------------------------------------------------------------------------------------------

describe("checkPage from the node", () => {
  const nodeSource = (entry: LedgerObject, ledgerIndex: number, now: number): ObjectSource => ({ origin: "node", entry, ledgerIndex, now });

  it("check-node-only: an open check with no history, Last changed in ledger #N, and the node's notes", async () => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "check-node-only");
    const data = page(nodeSource(entry, ledgerIndex, Date.UTC(2026, 9, 29) / 1000));
    expect(data).toMatchObject({ kind: "check", origin: "node", removed: false, banner: null, expiredBanner: null, paging: null, pill: { tone: "info", text: "Open" }, id: entry.index });
    expect(data.titleLine).toEqual({ kind: "changed", ledger: entry.PreviousTxnLgrSeq, tx: entry.PreviousTxnID });
    expect(lines(data)).toEqual(["next:CheckCash:Not cashed yet", "next:CheckCancel:Not cancelled"]);
    expect(data.asOf).toMatch(/^Read live from the network at ledger #[\d,]+\.$/);
    expect(data.coverage).toEqual({ before: "The index does not hold this history yet.", ledger: null, after: "" });
    // no creation, so no day in the sentence; the amounts are the node's drops in whole units
    expect(said(data.summary)).toMatch(/^\w+…\w+ wrote a check for up to 2,000 XRP to \w+…\w+\.$/);
    expect(data.flow.check.line).toBe("up to 2,000 XRP");
    expect(data.states.filter((state) => state.current).map((state) => state.id)).toEqual(["open"]);
  });

  it("works the status out from the node's expiration at the request time, not from any answer of the index", async () => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "check-expired");
    const expiration = (entry.Expiration as number) + RIPPLE_EPOCH_OFFSET;
    const at = (now: number) => page(nodeSource(entry, ledgerIndex, now)).pill.text;
    expect([at(expiration - 1), at(expiration), at(expiration + 100)]).toEqual(["Open", "Expired", "Expired"]);
    const open = page(nodeSource(entry, ledgerIndex, expiration - 100));
    expect(lines(open)).toEqual(["next:CheckCash:Not cashed yet", "next:CheckCancel:Not cancelled"]);
    expect(open.timeline[0]).toMatchObject({ at: expiration, whenText: "Until Oct 15, 2026, 02:25 UTC" });
    const expired = page(nodeSource(entry, ledgerIndex, expiration + 100));
    expect(lines(expired)).toEqual(["mark:Expiration:Passed", "next:CheckCancel:Not cancelled yet"]);
    expect(expired.expiredBanner).not.toBeNull();
    expect(rowOf(expired, "Expires")!.value).toEqual({ kind: "time", at: expiration });
  });

  it("reads a token check from the node with its issuer on the flow and in the row, and a check of Xahau in XAH", async () => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "check-expired");
    const token = { ...entry, SendMax: { currency: "USD", issuer: TOKEN_ISSUER, value: "100" }, Expiration: undefined };
    const data = page(nodeSource(token as LedgerObject, ledgerIndex, Date.UTC(2026, 9, 29) / 1000));
    expect(data.flow.check).toEqual({ title: "Check", line: "up to 100 USD", issuer: TOKEN_ISSUER });
    expect(rowOf(data, "Can be cashed for")!.value).toEqual({ kind: "amount", amount: { value: "100", currency: "USD", issuer: TOKEN_ISSUER } });
    const xahau = page(nodeSource(entry, ledgerIndex, Date.UTC(2026, 9, 29) / 1000), {}, XAHAU);
    expect(xahau.net).toBe("xahau");
    expect(xahau.flow.check.line).toBe("up to 100 XAH");
    expect(xahau.reserve).toMatchObject({ currency: "XAH" });
  });

  it("refuses an entry without its Account or Destination (an UpstreamError the loader turns into a 503)", async () => {
    const { entry, ledgerIndex } = await entryOf("xrpl", "check-node-only");
    const { Destination: _destination, ...broken } = entry;
    expect(() => page(nodeSource(broken, ledgerIndex, 1))).toThrow(/Destination/);
  });
});

// ---- Plain data -----------------------------------------------------------------------------------------------------------------------------------

describe("checkPage holds unix seconds and strings only: no ages", () => {
  const CASES = ["check-open", "check-expired", "check-cashed", "check-cancelled"] as const;

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
    const data = page(indexed(await answerOf("xrpl", "check-expired")));
    for (const item of data.timeline) {
      if (item.kind !== "tx") expect(item.whenText, item.type).toMatch(/\b20\d\d, \d\d:\d\d UTC$/);
      if (item.at !== undefined) expect(Number.isSafeInteger(item.at)).toBe(true);
    }
  });
});

// ---- The accounts the page draws --------------------------------------------------------------------------------------------------------------

describe("drawnAccounts", () => {
  /** The recorded checks the test reads, each asked for by name: one the fixtures lack fails the test (`objectCase` throws), none is skipped. */
  const RECORDED: ReadonlyArray<ObjectCase> = ["check-open", "check-expired", "check-cashed", "check-cancelled"];
  const A = (n: number) => `r${String(n).repeat(25)}`.slice(0, 26);
  const account = (v: string): Segment => ({ t: "account", v });

  /** A cashed token check, delegated: the source, the destination and the issuer, and a delegate on the cash. */
  function delegated(): CheckPageData {
    const token = { currency: RLUSD, issuer: TOKEN_ISSUER, value: "1" };
    const answer = answerWith("cashed", { delivered: token, removed: removal("CheckCash") }, [event({ event: "cash", tx_type: "CheckCash", account: DESTINATION, delegate: DELEGATE, delivered: token })]);
    return page(indexed(answer));
  }

  it("lists the source, the destination, the issuer of a token and a delegate, each once, in the order the page draws them", () => {
    expect(drawnAccounts(delegated())).toEqual([SOURCE, DESTINATION, TOKEN_ISSUER, DELEGATE]);
  });

  it("lists the three boxes of the flow in their order, the issuer in the middle, before the rows of the Details card and the timeline", () => {
    const base = delegated();
    const flowOnly = { ...base, summary: [], statusLines: [], details: [], banner: null, expiredBanner: null };
    expect(drawnAccounts(flowOnly)).toEqual([SOURCE, TOKEN_ISSUER, DESTINATION, DELEGATE]);
    // a check with no token has no issuer box line
    expect(drawnAccounts({ ...flowOnly, flow: { ...base.flow, check: { title: "Check", line: "up to 1 XRP" } } })).toEqual([SOURCE, DESTINATION, DELEGATE]);
    // the rows of the card come after the flow: an issuer that only a row has
    const rows: DetailRow[] = [{ label: "Amount", value: { kind: "amount", amount: { value: "1", currency: "USD", issuer: A(5) } } }];
    expect(drawnAccounts({ ...flowOnly, details: rows })).toEqual([SOURCE, TOKEN_ISSUER, DESTINATION, A(5), DELEGATE]);
  });

  it("lists exactly the accounts that the page holds, on every recorded check and on one read from the node: collectAddresses over the page finds no other", async () => {
    const seen = new Set<string>();
    const { entry, ledgerIndex } = await entryOf("xrpl", "check-node-only");
    const pages = [...(await Promise.all(RECORDED.map(async (which) => page(indexed(await answerOf("xrpl", which)))))), page({ origin: "node", entry, ledgerIndex, now: 1_790_000_000 }), delegated()];
    for (const data of pages) {
      const drawn = drawnAccounts(data);
      expect(new Set(drawn).size, data.id).toBe(drawn.length);
      expect([...collectAddresses({ ...data, names: undefined, meta: undefined })].sort(), data.id).toEqual([...drawn].sort());
      // the source and the destination come first
      expect(drawn.slice(0, 2), data.id).toEqual([data.flow.source.account, data.flow.destination.account]);
      drawn.forEach((address) => seen.add(address));
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it("lists the accounts of each place a sentence stands: the summary, the status lines, the banners and what a timeline item did", () => {
    const base = delegated();
    const one = (extra: Partial<CheckPageData>) => drawnAccounts({ ...base, ...extra });
    expect(one({ summary: [account(A(1))] })).toContain(A(1));
    expect(one({ statusLines: [[account(A(2))], [{ t: "text", v: "x" }, account(A(3))]] })).toEqual(expect.arrayContaining([A(2), A(3)]));
    expect(one({ banner: { ledger: 1, txType: "CheckCash", hash: "H", sentence: [account(A(4))] } })).toContain(A(4));
    expect(one({ expiredBanner: [account(A(8))] })).toContain(A(8));
    expect(one({ timeline: [{ kind: "next", type: "CheckCancel", title: "t", what: [account(A(5))] }] })).toContain(A(5));
    expect(one({ timeline: [{ kind: "tx", type: "CheckCash", title: "t", what: [], by: A(6), delegate: A(7) }] })).toEqual(expect.arrayContaining([A(6), A(7)]));
    // the first listed is the removed banner's, then the expired banner's, then the summary's
    expect(
      one({ banner: { ledger: 1, txType: "CheckCash", hash: "H", sentence: [account(A(4))] }, expiredBanner: [account(A(8))], summary: [account(A(1))] }).slice(0, 3),
    ).toEqual([A(4), A(8), A(1)]);
    // a timeline item's sentence is drawn before the account that sent it
    expect(one({ summary: [], statusLines: [], banner: null, details: [], flow: { ...base.flow, source: { account: A(1), line: "" }, check: { title: "", line: "" }, destination: { account: A(2), line: "" } }, timeline: [{ kind: "tx", type: "CheckCash", title: "t", what: [account(A(5))], by: A(6) }] })).toEqual([A(1), A(2), A(5), A(6)]);
  });

  it("never lists the issuer of an amount that appears only in a title", () => {
    const base = page(indexed(answerWith("open", { send_max: { currency: "XRP", value: "1" } })));
    const issued = (issuer: string): Segment => ({ t: "amount", value: "1", currency: "USD", issuer });
    const drawn = drawnAccounts({
      ...base,
      summary: [issued(A(1))],
      statusLines: [[issued(A(2))]],
      banner: { ledger: 1, txType: "CheckCash", hash: "H", sentence: [issued(A(3))] },
      expiredBanner: [issued(A(9))],
      timeline: [{ kind: "tx", type: "CheckCreate", title: "t", what: [issued(A(4))], by: SOURCE }],
    });
    expect(drawn).toEqual([SOURCE, DESTINATION]);
    for (const n of [1, 2, 3, 4, 9]) expect(drawn).not.toContain(A(n));
  });

  it("lists the issuer of a token once, though the sentences, the flow and two rows carry it", () => {
    const data = delegated();
    expect(JSON.stringify(data.summary)).toContain(TOKEN_ISSUER);
    expect(data.flow.check.issuer).toBe(TOKEN_ISSUER);
    expect(drawnAccounts(data).filter((address) => address === TOKEN_ISSUER)).toHaveLength(1);
  });

  it("does not list the names it is given, nor a short address of the meta", async () => {
    const answer = await answerOf("xrpl", "check-open");
    const other = A(9);
    const names: NamesPart = { state: "ok", map: { [other]: { name: { text: "Elsewhere", kind: "account" }, labels: [] } } };
    const data = page(indexed(answer), { names });
    expect(drawnAccounts(data)).toEqual([answer.check.account, answer.check.destination]);
    expect(drawnAccounts(data)).not.toContain(other);
  });
});

// ---- A few things the fixtures do not have ------------------------------------------------------------------------------------------------------------

describe("checkPage: other cases", () => {
  it("refuses an answer of another kind", () => {
    const escrow = { origin: "index", answer: { result: "success", coverage: { complete: true }, ledger_index: 1, close_time: "2026-10-29T03:50:41Z", escrow: {}, history: [] } } as unknown as ObjectSource;
    expect(() => page(escrow)).toThrow();
  });

  it("keeps the transaction hash of the sample's create event on its timeline item", () => {
    expect(page(indexed(checkAnswerSample())).timeline[0]).toMatchObject({ hash: "CCDBCADF2DE0EF5E85A3332C4CADE9A0C28F3B5E7220C4890E27D196415D0326", ledger: 107_698_980, by: SOURCE });
  });
});
