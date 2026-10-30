import { describe, expect, it } from "vitest";

import {
  CHANNEL_ID,
  CHECK_ID,
  checkAnswerSample,
  DELEGATE,
  DELEGATION_ID,
  delegationsSample,
  DELEGATOR,
  ESCROW_ID,
  ESCROW_OWNER,
  escrowAnswerSample,
  historySample,
  ledgerObjectSample,
  MPT_ISSUANCE_ID,
  mptAmountSample,
  OBJECT_TX_HASH,
  paymentChannelAnswerSample,
  TOKEN_ISSUER,
} from "../../test/support/object-samples";
import type { ObjectApiKind } from "./api-types";
import { checkDelegations, checkLedgerObject, checkObjectAnswer, checkObjectHistory, OBJECT_EVENTS, OBJECT_STATUSES } from "./object-shape";
import { UpstreamError } from "./upstream";

// The examples are the ones of data-api-new/docs/api-reference.md ("Ledger objects", feat/explorer-data-2 at 0c2e58c), with addresses that exist (test/support/object-samples.ts). A
// defect is one change to an example.

/** A body to be broken in some way: a test reaches into it as it likes. */
type Body = any;
/** What is wrong, the field the message must name, and the change that makes it so. */
type Defect = [what: string, field: string, change: (body: Body) => void];

const clone = <T>(value: T): T => structuredClone(value);

/** An X-address (`ESCROW_OWNER` with a tag flag): it holds a tag, and a page links accounts. */
const X_ADDRESS = "XVNrKpKNWdzFVWZ5Vo2s8SsALv9gxNAt4Q7FCL34NVn2LWW";
const ISSUED = { currency: "USD", issuer: TOKEN_ISSUER };

/** The request each kind is told it answers, which its message names, and its sample. */
const OBJECTS = {
  escrow: { path: `/v2/escrows/${ESCROW_ID}`, key: "escrow", id: "escrow_id", sample: () => escrowAnswerSample() },
  check: { path: `/v2/checks/${CHECK_ID}`, key: "check", id: "check_id", sample: () => checkAnswerSample() },
  payment_channel: { path: `/v2/payment_channels/${CHANNEL_ID}`, key: "payment_channel", id: "channel_id", sample: () => paymentChannelAnswerSample() },
} as const;
const KINDS = Object.keys(OBJECTS) as ObjectApiKind[];
const historyPath = (kind: ObjectApiKind) => `${OBJECTS[kind].path}/history?descending=true&limit=50`;

/** What every message says between the request and the reason. */
const WHY = "answered something unexpected: ";

/** The check refuses `body` as an `UpstreamError` of kind `server` that marks an answer of the upstream (status 200), and its message names the request, and `field` in its reason. */
function refuses(check: (body: unknown) => unknown, path: string, body: unknown, field: string): void {
  let error: unknown;
  try {
    check(body);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UpstreamError);
  expect((error as UpstreamError).kind).toBe("server");
  expect((error as UpstreamError).status).toBe(200);
  const { message } = error as UpstreamError;
  expect(message).toContain(`data API GET ${path}`);
  // The field is looked for in the reason alone: every message holds the path, and a field named "escrow", "check", "history" or "account" is in that.
  expect(message).toContain(WHY);
  expect(message.slice(message.indexOf(WHY) + WHY.length)).toContain(field);
}

describe("the helper that looks for a field", () => {
  it("looks for it in the reason, not in the request every message holds: a close_time that is wrong is not a failure of \"escrow\"", () => {
    const path = OBJECTS.escrow.path;
    const body = escrowAnswerSample();
    body.close_time = "2026-10-29";
    const check = (b: unknown) => checkObjectAnswer("escrow", b, path);

    refuses(check, path, body, "close_time");
    expect(() => refuses(check, path, body, "escrow")).toThrow();
    expect(() => refuses(check, path, body, "v2")).toThrow();
  });
});

/** The example is taken and returned as it is; every change in `defects` makes it a refused answer that names its field. */
function pins(check: (body: unknown) => unknown, path: string, good: unknown, defects: Defect[]): void {
  it("takes the reference's example, and returns it as it is", () => {
    expect(check(good)).toBe(good);
  });
  it.each(defects)("refuses %s", (_what, field, defect) => {
    const body = clone(good);
    defect(body);
    refuses(check, path, body, field);
  });
}

/** Each defect of an object, as a defect of the body that holds it (`at` is where, `holds` a function that reaches it). */
const within = (at: string, holds: (body: Body) => Body, defects: Defect[]): Defect[] =>
  defects.map(([what, field, change]): Defect => [`${what}, in ${at}`, field, (body) => change(holds(body))]);

/** What every answer has: `result`, a coverage that is one, and the ledger it is as of. */
const answerDefects: Defect[] = [
  ["no result", "result", (b) => delete b.result],
  ["a result that is not success", "result", (b) => (b.result = "error")],
  ["no coverage", "coverage", (b) => delete b.coverage],
  ["a coverage that is text", "coverage", (b) => (b.coverage = "complete")],
  ["a coverage without complete", "coverage.complete", (b) => (b.coverage = { from_ledger_index: 102145584 })],
  ["a coverage whose complete is text", "coverage.complete", (b) => (b.coverage = { from_ledger_index: 102145584, complete: "true" })],
  ["a coverage whose ledger is fractional", "coverage.from_ledger_index", (b) => (b.coverage = { from_ledger_index: 1.5, complete: true })],
  ["a ledger_index that is text", "ledger_index", (b) => (b.ledger_index = "107972102")],
  ["no ledger_index", "ledger_index", (b) => delete b.ledger_index],
  ["a close_time that is no time", "close_time", (b) => (b.close_time = "2026-10-29")],
  ["no close_time", "close_time", (b) => delete b.close_time],
];

/** What every list has: its rows are a list of objects, with a count and, when there is a next page, a marker. */
const listDefects = (key: string): Defect[] => [
  [`${key} that are not a list`, key, (b) => (b[key] = { 0: b[key][0] })],
  [`no ${key}`, key, (b) => delete b[key]],
  [`a row that is text in ${key}`, `${key}[0]`, (b) => (b[key][0] = "row")],
  ["a count that is text", "count", (b) => (b.count = "1")],
  ["no count", "count", (b) => delete b.count],
  ["a marker that is none", "marker", (b) => (b.marker = "not a marker!")],
  ...answerDefects,
];

/** What makes an amount not one. */
const amountDefects: Defect[] = [
  ["no currency", "currency", (a) => delete a.currency],
  ["an empty currency", "currency", (a) => (a.currency = "")],
  ["an issuer that is an X-address", "issuer", (a) => (a.issuer = X_ADDRESS)],
  ["an issuer that is no address", "issuer", (a) => (a.issuer = "rNope")],
  ["a value that is a number", "value", (a) => (a.value = 1)],
  ["no value", "value", (a) => delete a.value],
  ["a value that is empty", "value", (a) => (a.value = "")],
  ["a value that is not a number", "value", (a) => (a.value = "one")],
  ["a value that is NaN", "value", (a) => (a.value = "NaN")],
  ["a native value in exponent form", "value", (a) => (delete a.issuer, (a.value = "5e+2"))],
  ["an MPT whose currency differs from mpt_issuance_id", "mpt_issuance_id", (a) => (a.mpt_issuance_id = MPT_ISSUANCE_ID)],
  ["an MPT issuance ID in lower case", "mpt_issuance_id", (a) => ((a.currency = MPT_ISSUANCE_ID.toLowerCase()), (a.mpt_issuance_id = MPT_ISSUANCE_ID.toLowerCase()))],
  ["an MPT issuance ID of 47 digits", "mpt_issuance_id", (a) => ((a.currency = MPT_ISSUANCE_ID.slice(1)), (a.mpt_issuance_id = MPT_ISSUANCE_ID.slice(1)))],
];

/** The place of a fact in the ledger history. */
const refDefects = (name: string): Defect[] => [
  [`a ${name}.ledger_index that is text`, "ledger_index", (o) => (o[name].ledger_index = "107897249")],
  [`no ${name}.ledger_index`, "ledger_index", (o) => delete o[name].ledger_index],
  [`a ${name}.time that is no time`, "time", (o) => (o[name].time = "2026-10-25")],
  [`a ${name}.tx_hash in lower case`, "tx_hash", (o) => (o[name].tx_hash = OBJECT_TX_HASH.toLowerCase())],
  [`a ${name}.tx_hash of 63 digits`, "tx_hash", (o) => (o[name].tx_hash = OBJECT_TX_HASH.slice(1))],
  [`no ${name}.tx_hash`, "tx_hash", (o) => delete o[name].tx_hash],
];

/** The place of a creation, for a defect of an object that has none. */
const ESCROW_REF = { ledger_index: 107897249, time: "2026-10-25T16:49:20Z", tx_hash: OBJECT_TX_HASH };

/** What makes an escrow, a check or a channel not one, whatever the kind: the ID asked for, the accounts, the numbers, the status, where it was created and removed. */
const headDefects = (kind: ObjectApiKind): Defect[] => {
  const { id } = OBJECTS[kind];
  const noun = kind === "payment_channel" ? "channel" : kind;
  return [
    [`a lower-case ${id}`, id, (o) => (o[id] = o[id].toLowerCase())],
    [`an ${id} of 63 digits`, id, (o) => (o[id] = o[id].slice(1))],
    [`an ${id} of 65 digits`, id, (o) => (o[id] = `${o[id]}0`)],
    [`an ${id} with a letter that is no digit`, id, (o) => (o[id] = `G${o[id].slice(1)}`)],
    [`an ${id} that is a number`, id, (o) => (o[id] = 8)],
    [`no ${id}`, id, (o) => delete o[id]],
    [`an ${id} of another ${noun} than the one asked for`, id, (o) => (o[id] = "A".repeat(64))],
    ["an account that is an X-address", "account", (o) => (o.account = X_ADDRESS)],
    ["an account that is no address", "account", (o) => (o.account = "rNope")],
    ["no account", "account", (o) => delete o.account],
    ["a destination that is an X-address", "destination", (o) => (o.destination = X_ADDRESS)],
    ["a destination whose checksum is wrong", "destination", (o) => (o.destination = `${o.destination.slice(0, -1)}${o.destination.endsWith("a") ? "b" : "a"}`)],
    ["no destination", "destination", (o) => delete o.destination],
    ["a sequence that is text", "sequence", (o) => (o.sequence = "107896555")],
    ["a sequence with a fraction", "sequence", (o) => (o.sequence = 1.5)],
    ["a negative sequence", "sequence", (o) => (o.sequence = -1)],
    ["a sequence that is null", "sequence", (o) => (o.sequence = null)],
    ["a destination_tag that is text", "destination_tag", (o) => (o.destination_tag = "7")],
    ["a source_tag that is negative", "source_tag", (o) => (o.source_tag = -2)],
    ["an unknown status", "status", (o) => (o.status = "unknown")],
    ["a status of another object", "status", (o) => (o.status = kind === "escrow" ? "open" : "pending")],
    ["no status", "status", (o) => delete o.status],
    ["a created that is text", "created", (o) => (o.created = "now")],
    ...refDefects("created").map(([what, field, change]): Defect => [what, field, (o) => ((o.created = clone(o.created ?? ESCROW_REF)), change(o))]),
    ["a removed without tx_type", "tx_type", (o) => (o.removed = { ...ESCROW_REF, tx_type: undefined })],
    ["a removed whose tx_type is a number", "tx_type", (o) => (o.removed = { ...ESCROW_REF, tx_type: 7 })],
    ["a removed that is text", "removed", (o) => (o.removed = "EscrowFinish")],
  ];
};
/** What makes an event of the history of an object of `kind` not one. */
const eventDefects = (kind: ObjectApiKind): Defect[] => [
  ["an event that is none", "event", (e) => (e.event = "teleport")],
  ["an event of another object", "event", (e) => (e.event = kind === "payment_channel" ? "finish" : "fund")],
  ["no event", "event", (e) => delete e.event],
  ["a ledger_index that is text", "ledger_index", (e) => (e.ledger_index = "107897249")],
  ["a time that is no time", "time", (e) => (e.time = "2026-10-25")],
  ["a tx_hash in lower case", "tx_hash", (e) => (e.tx_hash = e.tx_hash.toLowerCase())],
  ["no tx_hash", "tx_hash", (e) => delete e.tx_hash],
  ["no tx_type", "tx_type", (e) => delete e.tx_type],
  ["no result", "result", (e) => delete e.result],
  ["an account that is an X-address", "account", (e) => (e.account = X_ADDRESS)],
  ["no account", "account", (e) => delete e.account],
  ["a delegate that is an X-address", "delegate", (e) => (e.delegate = X_ADDRESS)],
  ["a delegate that is no address", "delegate", (e) => (e.delegate = "rNope")],
  ["a delegate that is null", "delegate", (e) => (e.delegate = null)],
];

/** The history of an answer: its rows (the first is the event the defects change), and the marker of the page behind it. */
const historyDefects = (kind: ObjectApiKind): Defect[] => [
  ["a history that is not a list", "history", (b) => (b.history = { 0: b.history[0] })],
  ["no history", "history", (b) => delete b.history],
  ["a row that is text in history", "history[0]", (b) => (b.history[0] = "row")],
  ["a history_marker that is none", "history_marker", (b) => (b.history_marker = "not a marker!")],
  ...within("an event", (b) => b.history[0], eventDefects(kind)),
];

describe("OBJECT_STATUSES and OBJECT_EVENTS", () => {
  it("are the reference's: the statuses of its table, and the events of each object with update (and removed, which each has)", () => {
    expect(OBJECT_STATUSES).toEqual({
      escrow: ["pending", "can_be_finished", "can_be_cancelled", "finished", "cancelled", "removed"],
      check: ["open", "expired", "cashed", "cancelled", "removed"],
      payment_channel: ["open", "closing", "closed", "removed"],
    });
    expect(OBJECT_EVENTS.escrow).toEqual(["create", "finish", "cancel", "removed", "update"]);
    expect(OBJECT_EVENTS.check).toEqual(["create", "cash", "cancel", "removed", "update"]);
    expect(OBJECT_EVENTS.payment_channel).toEqual(["create", "fund", "claim", "close_request", "renew", "close", "removed", "update"]);
  });
});

describe("checkObjectAnswer", () => {
  it.each(KINDS.map((kind) => [kind, OBJECTS[kind].sample()] as const))("accepts a well-formed %s answer, and returns it as it is", (kind, body) => {
    expect(checkObjectAnswer(kind, body, OBJECTS[kind].path)).toBe(body);
  });

  it("accepts an exponent-form token value and an MPT amount", () => {
    const token = escrowAnswerSample();
    token.escrow.amount = { ...ISSUED, value: "1000000000000000e-4" };
    token.history[0]!.amount = { ...ISSUED, value: "1000000000000000e-4" };
    expect(checkObjectAnswer("escrow", token, OBJECTS.escrow.path)).toBe(token);

    const mpt = escrowAnswerSample();
    mpt.escrow.amount = mptAmountSample();
    mpt.history[0]!.amount = mptAmountSample();
    expect(checkObjectAnswer("escrow", mpt, OBJECTS.escrow.path)).toBe(mpt);
  });

  it("takes the ID asked for in any case, and with a query after it: the routes take any case, the answers have upper", () => {
    const body = escrowAnswerSample();
    expect(checkObjectAnswer("escrow", body, `/v2/escrows/${ESCROW_ID.toLowerCase()}`)).toBe(body);
    expect(checkObjectAnswer("escrow", body, `/v2/escrows/${ESCROW_ID}?x=1`)).toBe(body);
  });

  it("refuses a path that names no ID to compare the answer's with", () => {
    refuses((b) => checkObjectAnswer("escrow", b, "/v2/checks/x"), "/v2/checks/x", escrowAnswerSample(), "/v2/escrows");
  });

  it("refuses an answer that is not an object, or has none of the object", () => {
    refuses((b) => checkObjectAnswer("escrow", b, OBJECTS.escrow.path), OBJECTS.escrow.path, "escrow", "the answer is not an object");
    refuses((b) => checkObjectAnswer("escrow", b, OBJECTS.escrow.path), OBJECTS.escrow.path, null, "the answer is not an object");
  });

  describe("an escrow", () => {
    const { path } = OBJECTS.escrow;
    pins((b) => checkObjectAnswer("escrow", b, path), path, escrowAnswerSample(), [
      ...answerDefects,
      ["an escrow that is text", "escrow", (b) => (b.escrow = ESCROW_ID)],
      ["no escrow", "escrow", (b) => delete b.escrow],
      ...within("the escrow", (b) => b.escrow, headDefects("escrow")),
      ...within("the escrow", (b) => b.escrow, [
        ["an owner that is no address", "account", (o) => (o.account = ESCROW_OWNER.slice(1))],
        ["an amount that is text", "amount", (o) => (o.amount = "0.5")],
        ["a finish_after that is no time", "finish_after", (o) => (o.finish_after = "2026-10-25")],
        ["a cancel_after that is a number", "cancel_after", (o) => (o.cancel_after = 1792152000)],
        ["a condition that is not hex", "condition", (o) => (o.condition = "A02580G0")],
        ["a fulfillment that is not hex", "fulfillment", (o) => (o.fulfillment = "XYZ")],
        ["a transfer_rate that is text", "transfer_rate", (o) => (o.transfer_rate = "1000000000")],
      ]),
      ...within("the amount", (b) => b.escrow.amount, amountDefects),
      ...historyDefects("escrow"),
      ...within("a create event's amount", (b) => b.history[0].amount, amountDefects),
      ["a fulfillment that is not hex, in an event", "fulfillment", (b) => (b.history[0].fulfillment = "XYZ")],
    ]);

    it("takes a finished escrow: its condition, the fulfillment of the finish, removed with its transaction's type, and the history without an amount on the finish", () => {
      const body = escrowAnswerSample();
      Object.assign(body.escrow, {
        status: "finished",
        condition: "A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100",
        fulfillment: "A0228020AB",
        removed: { ledger_index: 107967068, time: "2026-10-28T22:14:51Z", tx_hash: OBJECT_TX_HASH, tx_type: "EscrowFinish" },
      });
      body.history.unshift({ event: "finish", ledger_index: 107967068, time: "2026-10-28T22:14:51Z", tx_hash: OBJECT_TX_HASH, tx_type: "EscrowFinish", account: ESCROW_OWNER, result: "tesSUCCESS", fulfillment: "A0228020AB" });
      body.history_marker = "WzEwNzk0NTQzOCw5OF0";
      expect(checkObjectAnswer("escrow", body, path)).toBe(body);
    });

    it("takes an escrow whose creation is not indexed: an incomplete coverage, no created and no sequence", () => {
      const body = escrowAnswerSample({ coverage: { from_ledger_index: 102145584, complete: false } });
      delete body.escrow.created;
      delete body.escrow.sequence;
      expect(checkObjectAnswer("escrow", body, path)).toBe(body);
    });

    it("takes a coverage that has no from_ledger_index (no ledger is stored at all), and every status and event of an escrow", () => {
      const body = escrowAnswerSample({ coverage: { complete: false } });
      expect(checkObjectAnswer("escrow", body, path)).toBe(body);
      for (const status of OBJECT_STATUSES.escrow) {
        const other = escrowAnswerSample();
        other.escrow.status = status as never;
        expect(checkObjectAnswer("escrow", other, path)).toBe(other);
      }
      for (const event of OBJECT_EVENTS.escrow) {
        const other = escrowAnswerSample();
        other.history[0]!.event = event;
        expect(checkObjectAnswer("escrow", other, path)).toBe(other);
      }
    });

    it("refuses the answer for another escrow than the one asked for", () => {
      refuses((b) => checkObjectAnswer("escrow", b, `/v2/escrows/${"A".repeat(64)}`), `/v2/escrows/${"A".repeat(64)}`, escrowAnswerSample(), "escrow_id");
    });
  });

  describe("a check", () => {
    const { path } = OBJECTS.check;
    pins((b) => checkObjectAnswer("check", b, path), path, checkAnswerSample(), [
      ...answerDefects,
      ["a check that is text", "check", (b) => (b.check = CHECK_ID)],
      ["no check", "check", (b) => delete b.check],
      ...within("the check", (b) => b.check, headDefects("check")),
      ...within("the check", (b) => b.check, [
        ["an expiration that is no time", "expiration", (o) => (o.expiration = "2026-10-16")],
        ["an invoice_id of 63 digits", "invoice_id", (o) => (o.invoice_id = o.invoice_id.slice(1))],
        ["an invoice_id that is a number", "invoice_id", (o) => (o.invoice_id = 1)],
        ["a delivered that is text", "delivered", (o) => (o.delivered = "1")],
      ]),
      ...within("the send_max", (b) => b.check.send_max, amountDefects),
      ...historyDefects("check"),
      ...within("a create event's send_max", (b) => b.history[0].send_max, amountDefects),
      ["an expiration that is no time, in an event", "expiration", (b) => (b.history[0].expiration = "2026-10-16")],
    ]);

    it("takes a cashed check: delivered (a token amount in exponent form included), removed with its transaction's type, and a cash event", () => {
      const body = checkAnswerSample({ coverage: { from_ledger_index: 102145584, complete: false } });
      delete body.check.created;
      Object.assign(body.check, {
        status: "cashed",
        delivered: { ...body.check.send_max!, value: "4.38027e-1" },
        removed: { ledger_index: 107703707, time: "2026-10-16T21:57:22Z", tx_hash: OBJECT_TX_HASH, tx_type: "CheckCash" },
      });
      body.history = [{ event: "cash", ledger_index: 107703707, time: "2026-10-16T21:57:22Z", tx_hash: OBJECT_TX_HASH, tx_type: "CheckCash", account: DELEGATOR, delegate: DELEGATE, result: "tesSUCCESS", delivered: { ...body.check.send_max!, value: "0.438027" } }];
      expect(checkObjectAnswer("check", body, path)).toBe(body);
    });

    it("takes every status and event of a check, and a native send_max", () => {
      for (const status of OBJECT_STATUSES.check) {
        const body = checkAnswerSample();
        body.check.status = status as never;
        expect(checkObjectAnswer("check", body, path)).toBe(body);
      }
      for (const event of OBJECT_EVENTS.check) {
        const body = checkAnswerSample();
        body.history[0]!.event = event;
        expect(checkObjectAnswer("check", body, path)).toBe(body);
      }
      const native = checkAnswerSample();
      native.check.send_max = { currency: "XAH", value: "12.5" };
      expect(checkObjectAnswer("check", native, path)).toBe(native);
    });
  });

  describe("a payment channel", () => {
    const { path } = OBJECTS.payment_channel;
    pins((b) => checkObjectAnswer("payment_channel", b, path), path, paymentChannelAnswerSample(), [
      ...answerDefects,
      ["a payment_channel that is text", "payment_channel", (b) => (b.payment_channel = CHANNEL_ID)],
      ["no payment_channel", "payment_channel", (b) => delete b.payment_channel],
      ...within("the channel", (b) => b.payment_channel, headDefects("payment_channel")),
      ...within("the channel", (b) => b.payment_channel, [
        ["a settle_delay that is text", "settle_delay", (o) => (o.settle_delay = "1209600")],
        ["a public_key that is not hex", "public_key", (o) => (o.public_key = "03D63CA7XYZ")],
        ["an expiration that is no time", "expiration", (o) => (o.expiration = "2026-10-09")],
        ["a cancel_after that is a number", "cancel_after", (o) => (o.cancel_after = 1792152000)],
        ["an opened_with that is text", "opened_with", (o) => (o.opened_with = "1")],
        ["funds that are text", "funds", (o) => (o.funds = "0")],
        ["no funds", "funds", (o) => delete o.funds],
        ["claims that are negative", "claims", (o) => (o.claims = -1)],
        ["no claims", "claims", (o) => delete o.claims],
      ]),
      ...within("the amount", (b) => b.payment_channel.amount, amountDefects),
      ...within("the balance", (b) => b.payment_channel.balance, amountDefects),
      ...within("the remaining", (b) => b.payment_channel.remaining, amountDefects),
      ...within("opened_with", (b) => b.payment_channel.opened_with, amountDefects),
      ...historyDefects("payment_channel"),
      ...within("an event's amount", (b) => b.history[0].amount, amountDefects),
      ...within("an event's balance", (b) => b.history[0].balance, amountDefects),
      ...within("an event's balance_change", (b) => b.history[0].balance_change, amountDefects),
      ["a settle_delay that is text, in an event", "settle_delay", (b) => (b.history[1].settle_delay = "1209600")],
      ["an expiration that is no time, in an event", "expiration", (b) => (b.history[0].expiration = "2026-10-09")],
    ]);

    it("takes a channel the index does not start at: an incomplete coverage, no created, opened_with or sequence, and a closing one with an expiration", () => {
      const body = paymentChannelAnswerSample({ coverage: { from_ledger_index: 102145584, complete: false } });
      for (const name of ["created", "opened_with", "sequence"] as const) delete body.payment_channel[name];
      Object.assign(body.payment_channel, { status: "closing", expiration: "2026-10-09T06:04:58Z", funds: 1, claims: 0 });
      body.history = [
        { event: "fund", ledger_index: 107220098, time: "2026-09-25T06:03:01Z", tx_hash: OBJECT_TX_HASH, tx_type: "PaymentChannelFund", account: ESCROW_OWNER, result: "tesSUCCESS", amount: { currency: "XRP", value: "5.000002" }, balance: { currency: "XRP", value: "5" }, amount_change: { currency: "XRP", value: "0.000001" }, expiration: "2026-10-09T06:04:58Z" },
      ];
      expect(checkObjectAnswer("payment_channel", body, path)).toBe(body);
    });

    it("takes every status and event of a channel", () => {
      for (const status of OBJECT_STATUSES.payment_channel) {
        const body = paymentChannelAnswerSample();
        body.payment_channel.status = status as never;
        expect(checkObjectAnswer("payment_channel", body, path)).toBe(body);
      }
      for (const event of OBJECT_EVENTS.payment_channel) {
        const body = paymentChannelAnswerSample();
        body.history[0]!.event = event;
        expect(checkObjectAnswer("payment_channel", body, path)).toBe(body);
      }
    });
  });

  describe("the keys D5 leaves out when it cannot read them", () => {
    // D5 drops a field it cannot read (object-views.ts: `compact`), so these are optional: an answer without one is taken (the page draws "—"), and one that has it malformed is not.
    type Dropped = [name: string, kind: ObjectApiKind, holder: (body: Body) => Body, key: string, malformed: unknown];
    const DROPPED: Dropped[] = [
      ["the escrow's amount", "escrow", (b) => b.escrow, "amount", "0.5"],
      ["an escrow event's amount", "escrow", (b) => b.history[0], "amount", "0.5"],
      ["the check's send_max", "check", (b) => b.check, "send_max", "1"],
      ["the channel's amount", "payment_channel", (b) => b.payment_channel, "amount", "1"],
      ["the channel's balance", "payment_channel", (b) => b.payment_channel, "balance", "0.032185"],
      ["the channel's remaining", "payment_channel", (b) => b.payment_channel, "remaining", "0.967815"],
      ["the channel's settle_delay", "payment_channel", (b) => b.payment_channel, "settle_delay", "1209600"],
      ["the channel's public_key", "payment_channel", (b) => b.payment_channel, "public_key", "03D63CA7XYZ"],
      ["a channel event's amount", "payment_channel", (b) => b.history[0], "amount", "1"],
      ["a channel event's balance", "payment_channel", (b) => b.history[0], "balance", "0.032185"],
      ["a channel's create event's balance", "payment_channel", (b) => b.history[1], "balance", "0"],
    ];

    it.each(DROPPED)("%s: an answer without it is taken, and one with it malformed is refused", (_name, kind, holder, key, wrong) => {
      const { path } = OBJECTS[kind];
      const check = (b: unknown) => checkObjectAnswer(kind, b, path);

      const whole = OBJECTS[kind].sample();
      expect(holder(whole)[key]).toBeDefined();
      expect(check(whole)).toBe(whole);

      const without = OBJECTS[kind].sample();
      delete holder(without)[key];
      expect(check(without)).toBe(without);

      const malformed = OBJECTS[kind].sample();
      holder(malformed)[key] = wrong;
      refuses(check, path, malformed, key);
    });

    it("takes a channel with none of its amounts, and an event with none", () => {
      const body = paymentChannelAnswerSample();
      for (const key of ["amount", "balance", "remaining", "settle_delay", "public_key"]) delete (body.payment_channel as Body)[key];
      for (const event of body.history) {
        delete event.amount;
        delete event.balance;
      }
      expect(checkObjectAnswer("payment_channel", body, OBJECTS.payment_channel.path)).toBe(body);
    });
  });

  describe("the text of an amount's value", () => {
    // E10Δ2 (C29): D5 writes the ledger's own text for what it only reads of an issued token (`amount`, `balance`, `send_max`, `delivered`, `opened_with`), which the ledger writes in
    // exponent form for large and tiny values, and a plain decimal for everything it converts (a native value, an MPT's raw units) or computes with `toFixed()` (`remaining`,
    // `amount_change`, `balance_change`, in every currency).
    type Place = [name: string, kind: ObjectApiKind, set: (body: Body, amount: Body) => void, text: "ledger" | "plain"];
    const PLACES: Place[] = [
      ["the escrow's amount", "escrow", (b, a) => (b.escrow.amount = a), "ledger"],
      ["an escrow event's amount", "escrow", (b, a) => (b.history[0].amount = a), "ledger"],
      ["the check's send_max", "check", (b, a) => (b.check.send_max = a), "ledger"],
      ["the check's delivered", "check", (b, a) => (b.check.delivered = a), "ledger"],
      ["a check event's send_max", "check", (b, a) => (b.history[0].send_max = a), "ledger"],
      ["a check event's delivered", "check", (b, a) => (b.history[0].delivered = a), "ledger"],
      ["the channel's amount", "payment_channel", (b, a) => (b.payment_channel.amount = a), "ledger"],
      ["the channel's balance", "payment_channel", (b, a) => (b.payment_channel.balance = a), "ledger"],
      ["the channel's opened_with", "payment_channel", (b, a) => (b.payment_channel.opened_with = a), "ledger"],
      ["the channel's remaining", "payment_channel", (b, a) => (b.payment_channel.remaining = a), "plain"],
      ["a channel event's amount", "payment_channel", (b, a) => (b.history[0].amount = a), "ledger"],
      ["a channel event's balance", "payment_channel", (b, a) => (b.history[0].balance = a), "ledger"],
      ["a channel event's amount_change", "payment_channel", (b, a) => (b.history[0].amount_change = a), "plain"],
      ["a channel event's balance_change", "payment_channel", (b, a) => (b.history[0].balance_change = a), "plain"],
    ];
    const EXPONENTS = ["1000000000000000e-4", "1.5e+2", "1E-81", "-2.5e3"];
    const check = (kind: ObjectApiKind, body: unknown) => checkObjectAnswer(kind, body, OBJECTS[kind].path);

    it.each(PLACES)("%s: an issued token's value may be in exponent form only where D5 writes the ledger's text", (_name, kind, set, text) => {
      for (const value of EXPONENTS) {
        const body = OBJECTS[kind].sample();
        set(body, { ...ISSUED, value });
        if (text === "ledger") expect(check(kind, body)).toBe(body);
        else refuses((b) => check(kind, b), OBJECTS[kind].path, body, "value");
      }
    });

    it.each(PLACES)("%s: a native value or an MPT's is a plain decimal wherever it is", (_name, kind, set) => {
      for (const amount of [{ currency: "XRP" }, mptAmountSample()]) {
        for (const value of EXPONENTS) {
          const body = OBJECTS[kind].sample();
          set(body, { ...amount, value });
          refuses((b) => check(kind, b), OBJECTS[kind].path, body, "value");
        }
        const plain = OBJECTS[kind].sample();
        set(plain, { ...amount, value: "12.5" });
        expect(check(kind, plain)).toBe(plain);
      }
    });

    it.each(PLACES)("%s: an issued token's plain decimal is taken wherever it is, and a value that is not a number nowhere", (_name, kind, set) => {
      const plain = OBJECTS[kind].sample();
      set(plain, { ...ISSUED, value: "0.438027" });
      expect(check(kind, plain)).toBe(plain);
      for (const value of ["1e", "e5", "1e+", "1e1000", "0x10", " 1", "1,5", "Infinity"]) {
        const body = OBJECTS[kind].sample();
        set(body, { ...ISSUED, value });
        refuses((b) => check(kind, b), OBJECTS[kind].path, body, "value");
      }
    });

    it("takes the ledger's text in exponent form on an issued-token channel (Xahau), its computed remaining as a plain decimal", () => {
      const body = paymentChannelAnswerSample();
      const channel = body.payment_channel;
      channel.amount = { ...ISSUED, value: "1e+3" };
      channel.balance = { ...ISSUED, value: "2.5e-2" };
      channel.remaining = { ...ISSUED, value: "999.975" };
      channel.opened_with = { ...ISSUED, value: "1e+3" };
      body.history[0]!.amount = { ...ISSUED, value: "1e+3" };
      body.history[0]!.balance = { ...ISSUED, value: "2.5e-2" };
      body.history[0]!.balance_change = { ...ISSUED, value: "0.025" };
      expect(check("payment_channel", body)).toBe(body);
    });
  });
});

describe("checkObjectHistory", () => {
  const pagesOf = {
    escrow: () => historySample(),
    check: () => {
      const { history, ...rest } = checkAnswerSample();
      return historySample({ history: history.map((event) => ({ ...event, event: "cash" })), count: history.length, ...(rest.coverage && { coverage: rest.coverage }) });
    },
    payment_channel: () => historySample({ history: paymentChannelAnswerSample().history, count: 2 }),
  } as const;

  describe.each(KINDS)("of a %s", (kind) => {
    const path = historyPath(kind);
    pins((b) => checkObjectHistory(kind, b, path), path, pagesOf[kind](), [
      ...listDefects("history"),
      ...within("an event", (b) => b.history[0], eventDefects(kind)),
    ]);

    it("takes the last page: no marker, and a page past the end of an object that has events: none", () => {
      const last = pagesOf[kind]();
      delete last.marker;
      expect(checkObjectHistory(kind, last, path)).toBe(last);
      const none = pagesOf[kind]();
      none.history = [];
      none.count = 0;
      delete none.marker;
      expect(checkObjectHistory(kind, none, path)).toBe(none);
    });

    it("takes an incomplete coverage: the object's creation is not indexed", () => {
      const body = pagesOf[kind]();
      body.coverage = { from_ledger_index: 102145584, complete: false };
      expect(checkObjectHistory(kind, body, path)).toBe(body);
    });
  });

  it("refuses the events of another object than the kind asked for: a finish in a channel's history, a fund in an escrow's", () => {
    const channel = pagesOf.payment_channel();
    channel.history[0]!.event = "finish";
    refuses((b) => checkObjectHistory("payment_channel", b, historyPath("payment_channel")), historyPath("payment_channel"), channel, "event");
    const escrow = historySample();
    escrow.history[0]!.event = "fund";
    refuses((b) => checkObjectHistory("escrow", b, historyPath("escrow")), historyPath("escrow"), escrow, "event");
  });

  it("takes an amount in exponent form on a token escrow's event, as the object", () => {
    const body = historySample();
    body.history[0]!.amount = { currency: "XRB", issuer: TOKEN_ISSUER, value: "75e+3" };
    expect(checkObjectHistory("escrow", body, historyPath("escrow"))).toBe(body);
  });
});

describe("checkDelegations", () => {
  const path = `/v2/accounts/${DELEGATOR}/delegations?direction=given&limit=200`;
  const check = (body: unknown) => checkDelegations(body, path);
  pins(check, path, delegationsSample(), [
    ...listDefects("delegations"),
    ...within("a delegation", (b) => b.delegations[0], [
      ["a lower-case delegation_id", "delegation_id", (d) => (d.delegation_id = DELEGATION_ID.toLowerCase())],
      ["a delegation_id of 63 digits", "delegation_id", (d) => (d.delegation_id = DELEGATION_ID.slice(1))],
      ["no delegation_id", "delegation_id", (d) => delete d.delegation_id],
      ["an account that is an X-address", "account", (d) => (d.account = X_ADDRESS)],
      ["no account", "account", (d) => delete d.account],
      ["an authorize that is no address", "authorize", (d) => (d.authorize = "rNope")],
      ["no authorize", "authorize", (d) => delete d.authorize],
      ["permissions that are not a list", "permissions", (d) => (d.permissions = { 0: d.permissions[0] })],
      ["no permissions", "permissions", (d) => delete d.permissions],
      ["a permission that is text", "permissions[0]", (d) => (d.permissions[0] = "OfferCreate")],
      ["a permission without a name", "permission", (d) => delete d.permissions[0].permission],
      ["a permission whose kind is none of the three", "kind", (d) => (d.permissions[0].kind = "number")],
      ["a permission without a kind", "kind", (d) => delete d.permissions[0].kind],
      ["a transaction_type that is a number", "transaction_type", (d) => (d.permissions[0].transaction_type = 3)],
      ["no updated", "updated", (d) => delete d.updated],
      ["an updated that is text", "updated", (d) => (d.updated = "now")],
      ["an updated.ledger_index that is text", "ledger_index", (d) => (d.updated.ledger_index = "107558036")],
      ["an updated.time that is no time", "time", (d) => (d.updated.time = "2026-10-10")],
      ["an updated.tx_hash in lower case", "tx_hash", (d) => (d.updated.tx_hash = d.updated.tx_hash.toLowerCase())],
      ["a created.tx_hash of 63 digits", "tx_hash", (d) => (d.created.tx_hash = d.created.tx_hash.slice(1))],
      ["a created that is text", "created", (d) => (d.created = "now")],
    ]),
  ]);

  it("checks the permission kinds: a transaction's name, a granular permission with the transaction it narrows, and one that is a number", () => {
    const body = delegationsSample();
    body.delegations[0]!.permissions = [
      { permission: "Payment", kind: "transaction" },
      { permission: "TrustlineAuthorize", kind: "granular", transaction_type: "TrustSet" },
      { permission: "65538", kind: "unknown" },
    ];
    expect(check(body)).toBe(body);
    for (const kind of ["transaction", "granular", "unknown"]) {
      const other = delegationsSample();
      other.delegations[0]!.permissions[0]!.kind = kind as never;
      expect(check(other)).toBe(other);
    }
  });

  describe("the account and the direction asked for", () => {
    const pathOf = (address: string, query: string) => `/v2/accounts/${address}/delegations${query}`;
    const held = () => delegationsSample();

    it("given: every delegation is the account's own (its account is the one asked for), whoever the delegate", () => {
      const body = delegationsSample();
      expect(checkDelegations(body, pathOf(DELEGATOR, "?direction=given&limit=200"))).toBe(body);
      refuses((b) => checkDelegations(b, pathOf(DELEGATE, "?direction=given&limit=200")), pathOf(DELEGATE, "?direction=given&limit=200"), body, "account");
    });

    it("held: every delegation is one the account holds (its authorize is the one asked for), whoever gave it", () => {
      const body = held();
      expect(checkDelegations(body, pathOf(DELEGATE, "?direction=held&limit=200"))).toBe(body);
      refuses((b) => checkDelegations(b, pathOf(DELEGATOR, "?direction=held&limit=200")), pathOf(DELEGATOR, "?direction=held&limit=200"), body, "authorize");
    });

    it("refuses one row among several that is not the account's, and says which", () => {
      const body = delegationsSample({ count: 2 });
      body.delegations.push({ ...body.delegations[0]!, delegation_id: ESCROW_ID, account: DELEGATE, authorize: DELEGATOR });
      const path = pathOf(DELEGATOR, "?direction=given&limit=200");
      refuses((b) => checkDelegations(b, path), path, body, "delegations[1].account");
    });

    it("takes no direction, or an empty one, as given, which is D5's default", () => {
      const body = delegationsSample();
      for (const query of ["", "?limit=200", "?direction=&limit=200"]) {
        expect(checkDelegations(body, pathOf(DELEGATOR, query)), query).toBe(body);
        refuses((b) => checkDelegations(b, pathOf(DELEGATE, query)), pathOf(DELEGATE, query), body, "account");
      }
    });

    it("takes an empty page whichever account and direction", () => {
      const none = delegationsSample({ count: 0, delegations: [] });
      expect(checkDelegations(none, pathOf(DELEGATE, "?direction=given&limit=200"))).toBe(none);
      expect(checkDelegations(none, pathOf(DELEGATOR, "?direction=held&limit=200"))).toBe(none);
    });

    it("refuses a path that names no account, and a direction that is neither", () => {
      const body = delegationsSample();
      refuses((b) => checkDelegations(b, "/v2/accounts"), "/v2/accounts", body, "delegations");
      const odd = pathOf(DELEGATOR, "?direction=both&limit=200");
      refuses((b) => checkDelegations(b, odd), odd, body, "direction");
    });
  });

  it("takes a delegation without created (its transaction is not indexed), an empty list with a marker-less page, and the delegate's view (held)", () => {
    const body = delegationsSample();
    delete body.delegations[0]!.created;
    expect(check(body)).toBe(body);
    const none = delegationsSample({ count: 0, delegations: [], coverage: { from_ledger_index: 8852809, complete: true } });
    expect(check(none)).toBe(none);
    const more = delegationsSample({ marker: "WzEwNzU1ODAzNiwwLCJFNjMyIl0" });
    expect(checkDelegations(more, `/v2/accounts/${DELEGATE}/delegations?direction=held&limit=200`)).toBe(more);
  });
});

describe("checkLedgerObject", () => {
  const path = `/v2/ledger_objects/${DELEGATION_ID}`;
  const check = (body: unknown) => checkLedgerObject(body, path);
  pins(check, path, ledgerObjectSample(), [
    ["a lower-case object_id", "object_id", (o) => (o.object_id = DELEGATION_ID.toLowerCase())],
    ["an object_id of 63 digits", "object_id", (o) => (o.object_id = DELEGATION_ID.slice(1))],
    ["an object_id of another object than the one asked for", "object_id", (o) => (o.object_id = ESCROW_ID)],
    ["no object_id", "object_id", (o) => delete o.object_id],
    ["an object_type that is none of the four", "object_type", (o) => (o.object_type = "Offer")],
    ["an object_type in lower case", "object_type", (o) => (o.object_type = "escrow")],
    ["no object_type", "object_type", (o) => delete o.object_type],
    ["an account that is an X-address", "account", (o) => (o.account = X_ADDRESS)],
    ["no account", "account", (o) => delete o.account],
    ["a deleted that is text", "deleted", (o) => (o.deleted = "false")],
    ["no deleted", "deleted", (o) => delete o.deleted],
    ["a ledger_index that is text", "ledger_index", (o) => (o.ledger_index = "107558036")],
    ["no ledger_index", "ledger_index", (o) => delete o.ledger_index],
  ]);

  it("refuses what is no object", () => {
    refuses(check, path, "Delegate", "ledger_object");
    refuses(check, path, null, "ledger_object");
  });

  it.each(["Escrow", "Check", "PayChannel", "Delegate"] as const)("takes an %s, deleted or not, each of the ID that was asked for", (objectType) => {
    for (const deleted of [false, true]) {
      const body = ledgerObjectSample({ object_type: objectType, deleted, object_id: ESCROW_ID });
      expect(checkLedgerObject(body, `/v2/ledger_objects/${ESCROW_ID}`)).toBe(body);
      // The routes take any case.
      expect(checkLedgerObject(body, `/v2/ledger_objects/${ESCROW_ID.toLowerCase()}`)).toBe(body);
    }
  });
});
