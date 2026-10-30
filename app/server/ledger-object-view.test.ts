import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CHECK_ID,
  checkAnswerSample,
  CHANNEL_ID,
  ESCROW_DESTINATION,
  ESCROW_ID,
  ESCROW_OWNER,
  escrowAnswerSample,
  historySample,
  MPT_ISSUANCE_ID,
  mptAmountSample,
  OBJECT_MARKER,
  OBJECT_TX_HASH,
  paymentChannelAnswerSample,
  TOKEN_ISSUER,
} from "../../test/support/object-samples";
import { allSwitches } from "../../test/support/switches";
import type { Segment } from "../domain/describe";
import { NO_NAMES, type NamesPart } from "../domain/names";
import type { TimelineItem } from "../ui/components/Timeline";
import type { ObjectAnswer, ObjectEvent, ObjectHistoryPage } from "./api-types";
import type { Env } from "./env";
import {
  amountSegment,
  amountText,
  answerObject,
  asOfNoteOf,
  commonAccounts,
  commonOf,
  detailAccounts,
  displayAmount,
  fromNodeEntry,
  issuerOf,
  none,
  removedBannerOf,
  reserveOf,
  sentence,
  tagValue,
  theAmount,
  timelineOf,
  type DetailRow,
  type EventWords,
  type ObjectSource,
} from "./ledger-object-view";
import { networkOf } from "./networks";
import { RIPPLE_EPOCH_OFFSET, type LedgerObject, type ServerState } from "./node-rpc";
import { UpstreamError } from "./upstream";
import { unixOf } from "./validator-facts";

// ---- The world of the tests ---------------------------------------------------------------------------------------------------------------------

const env: Env = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("on"),
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};
const XRPL = networkOf("xrpl", env);
const XAHAU = networkOf("xahau", env);

/** A server state whose validated ledger has the reserve of the XRP Ledger today: 0.2 XRP per object, in drops. */
const stateOf = (reserveInc = 200_000): ServerState => ({
  build_version: "2.5.0",
  complete_ledgers: "1-107972102",
  server_state: "full",
  validated_ledger: { base_fee: 10, close_time: 846_000_000, hash: "A".repeat(64), reserve_base: 1_000_000, reserve_inc: reserveInc, seq: 107_972_102 },
});

const FIXTURES = new URL("../../test/fixtures/http/", import.meta.url);
const fixture = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8")) as T;

/** A Ripple-epoch time (`LedgerObject` fields are the ledger's) for a unix time. */
const ripple = (unix: number): number => unix - RIPPLE_EPOCH_OFFSET;
const T = Date.UTC(2026, 9, 29, 3, 50, 41) / 1000;

// ---- fromNodeEntry ------------------------------------------------------------------------------------------------------------------------------

const ACCOUNT = ESCROW_OWNER;
const DESTINATION = ESCROW_DESTINATION;
const KEY = "0D1331F9B60A0BCEC44FA9A0A1C60BEE947936ED5BF17A8DFA7D1BA9DA22273E";

describe("fromNodeEntry", () => {
  const escrowEntry = (over: Record<string, unknown> = {}): LedgerObject => ({
    LedgerEntryType: "Escrow",
    index: KEY,
    Account: ACCOUNT,
    Destination: DESTINATION,
    Amount: "25000000",
    Sequence: 94_461_042,
    FinishAfter: ripple(T + 100),
    CancelAfter: ripple(T + 200),
    ...over,
  });

  it("gives an escrow as D5's object: drops as whole units, Ripple-epoch seconds as ISO text, the status at `now`, and none of what the ledger does not hold", () => {
    const entry = escrowEntry({ Condition: "A0258020AB", DestinationTag: 30_418, SourceTag: 2207, TransferRate: 1_005_000_000 });
    const object = fromNodeEntry("escrow", entry, "XRP", T);
    expect(object).toEqual({
      escrow_id: KEY,
      account: ACCOUNT,
      sequence: 94_461_042,
      destination: DESTINATION,
      amount: { currency: "XRP", value: "25" },
      finish_after: new Date((T + 100) * 1000).toISOString().replace(".000Z", "Z"),
      cancel_after: new Date((T + 200) * 1000).toISOString().replace(".000Z", "Z"),
      condition: "A0258020AB",
      destination_tag: 30_418,
      source_tag: 2207,
      transfer_rate: 1_005_000_000,
      status: "pending",
    });
    for (const key of ["created", "removed", "fulfillment"]) expect(object).not.toHaveProperty(key);
  });

  it("starts the Ripple epoch at 2000-01-01 and writes the native currency of the network it is given", () => {
    const object = fromNodeEntry("escrow", escrowEntry({ FinishAfter: 0, CancelAfter: 86_399, Amount: "1500000" }), "XAH", T);
    expect(object.finish_after).toBe("2000-01-01T00:00:00Z");
    expect(object.cancel_after).toBe("2000-01-01T23:59:59Z");
    expect(object.amount).toEqual({ currency: "XAH", value: "1.5" });
  });

  it("works the status out at `now`: pending up to FinishAfter, then can be finished, then can be cancelled after CancelAfter", () => {
    const at = (now: number) => fromNodeEntry("escrow", escrowEntry(), "XRP", now).status;
    expect([at(T), at(T + 100), at(T + 101), at(T + 200), at(T + 201)]).toEqual(["pending", "pending", "can_be_finished", "can_be_finished", "can_be_cancelled"]);
    // a conditional escrow with no FinishAfter can be finished from its creation
    expect(fromNodeEntry("escrow", escrowEntry({ FinishAfter: undefined, CancelAfter: undefined }), "XRP", T).status).toBe("can_be_finished");
  });

  it("leaves out an amount it cannot read, as D5 does, and keeps an issued token as it is", () => {
    expect(fromNodeEntry("escrow", escrowEntry({ Amount: "12.5" }), "XRP", T)).not.toHaveProperty("amount");
    expect(fromNodeEntry("escrow", escrowEntry({ Amount: { currency: "USD", value: "5" } }), "XRP", T)).not.toHaveProperty("amount");
    expect(fromNodeEntry("escrow", escrowEntry({ Amount: { currency: "5852504C00000000000000000000000000000000", issuer: TOKEN_ISSUER, value: "3.5e3" } }), "XRP", T).amount).toEqual({
      currency: "5852504C00000000000000000000000000000000",
      issuer: TOKEN_ISSUER,
      value: "3.5e3",
    });
  });

  it("reads the issuer of an MPT from its issuance ID, as D5 does", () => {
    const amount = fromNodeEntry("escrow", escrowEntry({ Amount: { mpt_issuance_id: MPT_ISSUANCE_ID.toLowerCase(), value: "500" } }), "XRP", T).amount;
    expect(amount).toEqual(mptAmountSample());
    expect(fromNodeEntry("escrow", escrowEntry({ Amount: { mpt_issuance_id: "00", value: "500" } }), "XRP", T)).not.toHaveProperty("amount");
  });

  it("gives a check, expired from its Expiration, with its SendMax and no `delivered`", () => {
    const entry: LedgerObject = {
      LedgerEntryType: "Check",
      index: CHECK_ID,
      Account: ACCOUNT,
      Destination: DESTINATION,
      SendMax: { currency: "524C555344000000000000000000000000000000", issuer: TOKEN_ISSUER, value: "1" },
      Expiration: ripple(T),
      InvoiceID: "AB9E9A32",
      Sequence: 106_635_339,
    };
    const open = fromNodeEntry("check", entry, "XRP", T - 1);
    expect(open).toEqual({
      check_id: CHECK_ID,
      account: ACCOUNT,
      sequence: 106_635_339,
      destination: DESTINATION,
      send_max: { currency: "524C555344000000000000000000000000000000", issuer: TOKEN_ISSUER, value: "1" },
      expiration: new Date(T * 1000).toISOString().replace(".000Z", "Z"),
      invoice_id: "AB9E9A32",
      status: "open",
    });
    expect(fromNodeEntry("check", entry, "XRP", T).status).toBe("expired");
    expect(fromNodeEntry("check", { ...entry, Expiration: undefined, SendMax: "1000000" }, "XRP", T + 10 ** 9)).toMatchObject({ status: "open", send_max: { currency: "XRP", value: "1" } });
  });

  it("gives a payment channel with what is left to pay out, no `funds`, `claims` or `opened_with`, and closing from its Expiration or its CancelAfter", () => {
    const entry: LedgerObject = {
      LedgerEntryType: "PayChannel",
      index: CHANNEL_ID,
      Account: ACCOUNT,
      Destination: DESTINATION,
      Amount: "2100000000",
      Balance: "328000000",
      PublicKey: "0343668D",
      SettleDelay: 86_400,
      Sequence: 97_768_380,
    };
    const open = fromNodeEntry("payment-channel", entry, "XRP", T);
    expect(open).toEqual({
      channel_id: CHANNEL_ID,
      account: ACCOUNT,
      sequence: 97_768_380,
      destination: DESTINATION,
      amount: { currency: "XRP", value: "2100" },
      balance: { currency: "XRP", value: "328" },
      remaining: { currency: "XRP", value: "1772" },
      settle_delay: 86_400,
      public_key: "0343668D",
      status: "open",
    });
    for (const key of ["funds", "claims", "opened_with", "created", "removed"]) expect(open).not.toHaveProperty(key);
    expect(fromNodeEntry("payment-channel", { ...entry, Expiration: ripple(T + 10 ** 6) }, "XRP", T).status).toBe("closing");
    expect(fromNodeEntry("payment-channel", { ...entry, CancelAfter: ripple(T) }, "XRP", T - 1).status).toBe("open");
    expect(fromNodeEntry("payment-channel", { ...entry, CancelAfter: ripple(T) }, "XRP", T).status).toBe("closing");
  });

  it("gives a channel that never paid out (the ledger omits a zero Balance) a balance of nothing in its currency, and a token channel's remainder exactly", () => {
    const channel = (over: Record<string, unknown>): LedgerObject => ({ LedgerEntryType: "PayChannel", index: CHANNEL_ID, Account: ACCOUNT, Destination: DESTINATION, ...over });
    const fresh = fromNodeEntry("payment-channel", channel({ Amount: "1000000" }), "XRP", T);
    expect(fresh).toMatchObject({ balance: { currency: "XRP", value: "0" }, remaining: { currency: "XRP", value: "1" } });
    const token = { currency: "CLV", issuer: TOKEN_ISSUER };
    const paid = fromNodeEntry("payment-channel", channel({ Amount: { ...token, value: "0.3" }, Balance: { ...token, value: "0.1" } }), "XAH", T);
    expect(paid.remaining).toEqual({ ...token, value: "0.2" });
    // no Amount, no balance and no remainder
    expect(fromNodeEntry("payment-channel", channel({}), "XRP", T)).not.toHaveProperty("remaining");
  });

  it("refuses an entry without its key, owner or destination as an answer of the node that is not what it should be", () => {
    for (const field of ["index", "Account", "Destination"]) {
      for (const kind of ["escrow", "check", "payment-channel"] as const) {
        let error: unknown;
        try {
          fromNodeEntry(kind, escrowEntry({ [field]: undefined }), "XRP", T);
        } catch (caught) {
          error = caught;
        }
        expect(error, `${kind} without ${field}`).toBeInstanceOf(UpstreamError);
        expect((error as UpstreamError).kind).toBe("server");
        expect((error as UpstreamError).message).toContain(field);
      }
    }
  });
});

describe("fromNodeEntry over the recorded objects", () => {
  // Every escrow, check and channel the fixtures hold both an index answer and a node entry of: the node's object is the index's (D5 reads the same ledger fields), but for what only a
  // history gives. The status is the index's own at its `close_time`, which is what the agreement test of object-status.test.ts holds the rules to.
  const KINDS = [
    { dir: "escrows", kind: "escrow", drop: ["created", "removed", "fulfillment"] },
    { dir: "checks", kind: "check", drop: ["created", "removed", "delivered"] },
    { dir: "payment_channels", kind: "payment-channel", drop: ["created", "removed", "opened_with", "funds", "claims"] },
  ] as const;

  for (const net of ["xrpl", "xahau"] as const) {
    for (const { dir, kind, drop } of KINDS) {
      const ids = readdirSync(new URL(`${net}/data-api/${dir}/`, FIXTURES))
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.slice(0, -".json".length))
        .filter((id) => {
          try {
            readFileSync(new URL(`${net}/node/ledger_entry/${id}.json`, FIXTURES));
            return true;
          } catch {
            return false;
          }
        });

      it.each(ids)(`${net} ${kind} %s: the node's object is the index's but for what only a history gives`, (id) => {
        const answer = fixture<ObjectAnswer>(`${net}/data-api/${dir}/${id}.json`);
        const { node } = fixture<{ result: { node: LedgerObject } }>(`${net}/node/ledger_entry/${id}.json`).result;
        const fromNode = fromNodeEntry(kind, node, net === "xrpl" ? "XRP" : "XAH", unixOf(answer.close_time));
        const fromIndex = { ...answerObject(answer) } as Record<string, unknown>;
        for (const key of drop) delete fromIndex[key];
        // Xahau's entries hold no `Sequence`: the index has it from the creation, which the node does not have
        if (node.Sequence === undefined) delete fromIndex.sequence;
        expect(fromNode).toEqual(fromIndex);
      });

      it(`${net} ${kind}: the fixtures hold some to compare`, () => {
        // a hole in the generator (no recorded object of the kind with a node entry) would make the comparison above vacuous
        if (net === "xrpl" || kind === "escrow") expect(ids.length).toBeGreaterThan(0);
      });
    }
  }
});

// ---- Amounts -----------------------------------------------------------------------------------------------------------------------------------

describe("displayAmount, amountSegment and amountText", () => {
  it("keeps a native amount, a token with its issuer, and an MPT as its issuance ID and raw units", () => {
    expect(displayAmount({ currency: "XRP", value: "0.5" })).toEqual({ value: "0.5", currency: "XRP" });
    expect(displayAmount({ currency: "USD", issuer: TOKEN_ISSUER, value: "1.5e3" })).toEqual({ value: "1.5e3", currency: "USD", issuer: TOKEN_ISSUER });
    expect(displayAmount(mptAmountSample())).toEqual({ mpt: { id: MPT_ISSUANCE_ID, units: "500" } });
  });

  it("writes an amount into a sentence as an amount segment, with the issuer for its title, and an MPT as words (a segment cannot hold one)", () => {
    expect(amountSegment({ value: "0.5", currency: "XRP" })).toEqual({ t: "amount", value: "0.5", currency: "XRP" });
    expect(amountSegment({ value: "9", currency: "USD", issuer: TOKEN_ISSUER })).toEqual({ t: "amount", value: "9", currency: "USD", issuer: TOKEN_ISSUER });
    expect(amountSegment({ mpt: { id: MPT_ISSUANCE_ID, units: "2500000" } })).toEqual({ t: "text", v: "2,500,000 units of MPT 0000012A…" });
  });

  it("writes an amount as plain text for a title or a description", () => {
    expect(amountText({ value: "1000", currency: "XRP" })).toBe("1,000 XRP");
    expect(amountText({ value: "75000", currency: "XRB", issuer: TOKEN_ISSUER })).toBe("75,000 XRB");
    expect(amountText({ value: "5", currency: "5852504C00000000000000000000000000000000" })).toBe("5 XRPL");
    expect(amountText({ mpt: { id: MPT_ISSUANCE_ID, units: "250" } })).toBe("250 units of MPT 0000012A…");
  });
});

// ---- The banner, the as-of note and the reserve ------------------------------------------------------------------------------------------------------

describe("removedBannerOf", () => {
  const removed = { ledger_index: 107_967_068, time: "2026-10-28T22:14:51Z", tx_hash: OBJECT_TX_HASH, tx_type: "EscrowFinish" };
  it("is the ledger, the type and the hash of the removing transaction, with the type's sentence", () => {
    const sentence: Segment[] = [{ t: "text", v: "Finished." }];
    expect(removedBannerOf("escrow", removed, sentence)).toEqual({ ledger: 107_967_068, txType: "EscrowFinish", hash: OBJECT_TX_HASH, sentence });
  });
  it("names a removing transaction of no known type just a transaction", () => {
    const { tx_type: _type, ...untyped } = removed;
    expect(removedBannerOf("check", untyped, []).txType).toBe("transaction");
  });
});

describe("asOfNoteOf", () => {
  const index = (answer: ObjectAnswer): ObjectSource => ({ origin: "index", answer });

  it("says what the index serves: As of ledger #N, {time}.", () => {
    expect(asOfNoteOf(index(escrowAnswerSample()), "escrow")).toBe("As of ledger #107,972,102, Oct 29, 2026, 03:50 UTC.");
  });

  it("says what the node gave: Read live from the network at ledger #N.", () => {
    const source: ObjectSource = { origin: "node", entry: { LedgerEntryType: "Escrow" }, ledgerIndex: 107_972_103, now: T };
    expect(asOfNoteOf(source, "escrow")).toBe("Read live from the network at ledger #107,972,103.");
  });

  it("says, of an object that was removed, that this is its last state before the ledger that removed it", () => {
    const removed = { ledger_index: 107_967_068, time: "2026-10-28T22:14:51Z", tx_hash: OBJECT_TX_HASH, tx_type: "EscrowFinish" };
    const answer = escrowAnswerSample();
    answer.escrow = { ...answer.escrow, status: "finished", removed };
    expect(asOfNoteOf(index(answer), "escrow")).toBe("From history: the escrow’s last state, before ledger #107,967,068 removed it.");
    const check = checkAnswerSample();
    check.check = { ...check.check, status: "cashed", removed: { ...removed, tx_type: "CheckCash" } };
    expect(asOfNoteOf(index(check), "check")).toBe("From history: the check’s last state, before ledger #107,967,068 removed it.");
    const channel = paymentChannelAnswerSample();
    channel.payment_channel = { ...channel.payment_channel, status: "closed", removed: { ...removed, tx_type: "PaymentChannelClaim" } };
    expect(asOfNoteOf(index(channel), "payment-channel")).toBe("From history: the channel’s last state, before ledger #107,967,068 removed it.");
  });
});

describe("reserveOf", () => {
  it("is the reserve of an object in the native currency, with the words for an object that is held", () => {
    expect(reserveOf(stateOf(), "XRP", "escrow", false)).toEqual({
      amount: "0.2",
      currency: "XRP",
      hint: "Held from the owner’s balance while the escrow exists; released when it is finished or cancelled.",
    });
    expect(reserveOf(stateOf(2_000_000), "XAH", "escrow", false)).toMatchObject({ amount: "2", currency: "XAH" });
  });

  it("says Released once the object was removed, for each kind, with the words of its holder", () => {
    expect(reserveOf(stateOf(), "XRP", "escrow", true)!.hint).toBe("Released to the owner when the escrow was removed.");
    expect(reserveOf(stateOf(), "XRP", "check", true)!.hint).toBe("Released to the source when the check was removed.");
    expect(reserveOf(stateOf(), "XRP", "payment-channel", true)!.hint).toBe("Released to the source when the channel was removed.");
  });

  it("holds a check's and a channel's reserve from the source's balance", () => {
    expect(reserveOf(stateOf(), "XRP", "check", false)!.hint).toBe("Held from the source’s balance while the check exists.");
    expect(reserveOf(stateOf(), "XRP", "payment-channel", false)!.hint).toBe("Held from the source’s balance while the channel exists.");
  });

  it("is none when server_state failed or has no validated ledger", () => {
    expect(reserveOf(null, "XRP", "escrow", false)).toBeNull();
    const { validated_ledger: _validated, ...unvalidated } = stateOf();
    expect(reserveOf(unvalidated, "XRP", "escrow", false)).toBeNull();
  });
});

// ---- The timeline ------------------------------------------------------------------------------------------------------------------------------

const event = (over: Partial<ObjectEvent> & Pick<ObjectEvent, "event" | "time">): ObjectEvent => ({
  ledger_index: 107_900_000,
  tx_hash: OBJECT_TX_HASH,
  tx_type: "EscrowCreate",
  account: ESCROW_OWNER,
  result: "tesSUCCESS",
  ...over,
});
const say = (e: ObjectEvent): EventWords => ({ title: `said ${e.event}`, what: [{ t: "text", v: `did ${e.event}` }] });
const mark = (type: string, at: number): TimelineItem => ({ kind: "mark", type, title: "Passed", at, whenText: `at ${at}`, what: [] });
const next = (type: string, at?: number): TimelineItem => ({ kind: "next", type, title: "Not yet", ...(at !== undefined && { at }), whenText: "later", what: [] });

describe("timelineOf", () => {
  const BANNER: Segment[] = [{ t: "text", v: "Finished on Oct 28, 2026, 22:14 UTC." }];
  const words = { removed: BANNER, say };

  it("draws each event as a transaction: its type tag, its time in unix seconds, who sent it, its hash and ledger", () => {
    const [item] = timelineOf([event({ event: "create", time: "2026-10-25T16:49:20Z", ledger_index: 107_897_249 })], [], words);
    expect(item).toEqual({
      kind: "tx",
      type: "EscrowCreate",
      title: "said create",
      at: Date.UTC(2026, 9, 25, 16, 49, 20) / 1000,
      what: [{ t: "text", v: "did create" }],
      by: ESCROW_OWNER,
      hash: OBJECT_TX_HASH,
      ledger: 107_897_249,
    });
  });

  it("titles an update `Changed by {tx_type}` with no sentence, whatever the kind says of its events", () => {
    const [item] = timelineOf([event({ event: "update", time: "2026-10-26T00:00:00Z", tx_type: "AccountSet" })], [], words);
    expect(item).toMatchObject({ kind: "tx", type: "AccountSet", title: "Changed by AccountSet", what: [] });
  });

  it("titles a removed event `Removed` and gives it the sentence of the removed banner", () => {
    const [item] = timelineOf([event({ event: "removed", time: "2026-10-26T00:00:00Z", tx_type: "AccountDelete" })], [], words);
    expect(item).toMatchObject({ title: "Removed", what: BANNER, type: "AccountDelete" });
  });

  it("keeps the order it is given, and sets `delegate` only beside `by`", () => {
    const events = [
      event({ event: "create", time: "2026-10-25T16:49:20Z" }),
      event({ event: "finish", time: "2026-10-26T00:00:00Z", tx_type: "EscrowFinish", account: ESCROW_DESTINATION, delegate: TOKEN_ISSUER }),
    ];
    const items = timelineOf(events, [], words);
    expect(items.map((item) => item.title)).toEqual(["said create", "said finish"]);
    expect(items[0]).not.toHaveProperty("delegate");
    expect(items[1]).toMatchObject({ by: ESCROW_DESTINATION, delegate: TOKEN_ISSUER });
    for (const item of items) if (item.delegate !== undefined) expect(item.by).toBeDefined();
  });

  it("places a mark by its time among the transactions and what can still happen after all of them", () => {
    const created = Date.UTC(2026, 9, 25, 16, 49, 20) / 1000;
    const finished = created + 3 * 86_400;
    const events = [event({ event: "create", time: "2026-10-25T16:49:20Z" }), event({ event: "finish", time: new Date(finished * 1000).toISOString().replace(".000Z", "Z"), tx_type: "EscrowFinish" })];
    const after = [next("EscrowCancel", finished + 10), mark("FinishAfter", created + 86_400), mark("CancelAfter", finished + 1)];
    expect(timelineOf(events, after, words).map((item) => `${item.kind}:${item.type}`)).toEqual([
      "tx:EscrowCreate",
      "mark:FinishAfter",
      "tx:EscrowFinish",
      "mark:CancelAfter",
      "next:EscrowCancel",
    ]);
  });

  it("puts the marks after the newest event when it is older than they are, and a mark with no time last of the marks", () => {
    const created = Date.UTC(2026, 9, 25, 16, 49, 20) / 1000;
    const events = [event({ event: "create", time: "2026-10-25T16:49:20Z" })];
    const timeless: TimelineItem = { kind: "mark", type: "Expiration", title: "Passed", whenText: "sometime", what: [] };
    expect(timelineOf(events, [timeless, mark("FinishAfter", created + 5), next("EscrowFinish")], words).map((item) => item.type)).toEqual(["EscrowCreate", "FinishAfter", "Expiration", "EscrowFinish"]);
  });

  it("has only the marks and what can happen when there are no events (an object read from the node)", () => {
    expect(timelineOf([], [mark("FinishAfter", 5), next("EscrowCancel", 9)], words).map((item) => item.type)).toEqual(["FinishAfter", "EscrowCancel"]);
    expect(timelineOf([], [], words)).toEqual([]);
  });
});

// ---- The common part ---------------------------------------------------------------------------------------------------------------------------

describe("commonOf", () => {
  const PILL = { tone: "info", text: "Pending" } as const;
  const parts = (over: Partial<Parameters<typeof commonOf>[2]> = {}): Parameters<typeof commonOf>[2] => ({ pill: PILL, states: [], marks: [], bannerSentence: null, say, ...over });
  const options = (over: Partial<Parameters<typeof commonOf>[1]> = {}): Parameters<typeof commonOf>[1] => ({
    net: XRPL,
    kind: "escrow",
    serverState: stateOf(),
    names: NO_NAMES,
    back: [],
    ...over,
  });
  const index = (answer: ObjectAnswer, history?: ObjectHistoryPage): ObjectSource => ({ origin: "index", answer, ...(history !== undefined && { history }) });

  const withEvents = (...events: ObjectEvent[]) => escrowAnswerSample({ history: events });
  const CREATE = event({ event: "create", time: "2026-10-25T16:49:20Z", ledger_index: 107_897_249 });
  const UPDATE = event({ event: "update", time: "2026-10-26T01:00:00Z", tx_type: "AccountSet", ledger_index: 107_900_001 });
  const FINISH = event({ event: "finish", time: "2026-10-27T01:00:00Z", tx_type: "EscrowFinish", ledger_index: 107_900_002 });

  it("describes an escrow the index has: its id, origin, pill, states, names, the reserve and the notes", () => {
    const names = { state: "ok", map: {} } as const;
    const states = [{ id: "pending", label: "Pending", meaning: "Locked.", current: true }];
    const common = commonOf(index(escrowAnswerSample()), options({ names }), parts({ states }));
    expect(common).toMatchObject({
      net: "xrpl",
      kind: "escrow",
      id: ESCROW_ID,
      origin: "index",
      removed: false,
      pill: PILL,
      states,
      banner: null,
      names,
      asOf: "As of ledger #107,972,102, Oct 29, 2026, 03:50 UTC.",
      coverage: null,
      reserve: { amount: "0.2", currency: "XRP" },
    });
    expect(common.names).toBe(names);
  });

  it("reads the check's and the channel's id from their own key", () => {
    expect(commonOf(index(checkAnswerSample()), options({ kind: "check" }), parts()).id).toBe(CHECK_ID);
    expect(commonOf(index(paymentChannelAnswerSample()), options({ kind: "payment-channel" }), parts()).id).toBe(CHANNEL_ID);
  });

  describe("the title line", () => {
    it("is the creation's time when the index has it", () => {
      expect(commonOf(index(escrowAnswerSample()), options(), parts()).titleLine).toEqual({ kind: "created", at: Date.UTC(2026, 9, 25, 16, 49, 20) / 1000 });
    });

    it("is `before` the ledger the index's history of the object starts at when the creation is not in it", () => {
      const answer = escrowAnswerSample({ coverage: { complete: false, from_ledger_index: 107_874_617 } });
      delete answer.escrow.created;
      const common = commonOf(index(answer), options(), parts());
      expect(common.titleLine).toEqual({ kind: "before", ledger: 107_874_617 });
      expect(common.coverage).toEqual({ before: "Covers ledger ", ledger: 107_874_617, after: " onwards: earlier events of this escrow are not in the index yet." });
    });

    it("says that it was created before the answer's own ledger when no ledger is stored at all (D3: no `from_ledger_index`)", () => {
      const answer = escrowAnswerSample({ coverage: { complete: false } });
      delete answer.escrow.created;
      expect(commonOf(index(answer), options(), parts()).titleLine).toEqual({ kind: "before", ledger: 107_972_102 });
    });

    it("is the ledger and the transaction that last changed the object when it is read from the node", () => {
      const entry: LedgerObject = { LedgerEntryType: "Escrow", index: KEY, PreviousTxnLgrSeq: 107_641_123, PreviousTxnID: OBJECT_TX_HASH };
      const common = commonOf({ origin: "node", entry, ledgerIndex: 107_972_102, now: T }, options(), parts());
      expect(common.titleLine).toEqual({ kind: "changed", ledger: 107_641_123, tx: OBJECT_TX_HASH });
      expect(common.id).toBe(KEY);
      expect(commonOf({ origin: "node", entry: { ...entry, PreviousTxnID: undefined }, ledgerIndex: 1, now: T }, options(), parts()).titleLine).toEqual({ kind: "changed", ledger: 107_641_123, tx: null });
    });

    it("refuses a node entry that does not say when it last changed", () => {
      const entry: LedgerObject = { LedgerEntryType: "Escrow", index: KEY };
      expect(() => commonOf({ origin: "node", entry, ledgerIndex: 1, now: T }, options(), parts())).toThrow(UpstreamError);
    });
  });

  describe("an object read from the node", () => {
    const entry: LedgerObject = { LedgerEntryType: "Escrow", index: KEY, PreviousTxnLgrSeq: 107_641_123, PreviousTxnID: OBJECT_TX_HASH };
    const source: ObjectSource = { origin: "node", entry, ledgerIndex: 107_972_102, now: T };

    it("has no history: no paging, a timeline of the marks alone, E8's text for no coverage, and the node's note", () => {
      const marks = [mark("FinishAfter", T - 5), next("EscrowCancel", T + 5)];
      const common = commonOf(source, options(), parts({ marks }));
      expect(common).toMatchObject({ origin: "node", removed: false, banner: null, paging: null, asOf: "Read live from the network at ledger #107,972,102." });
      expect(common.timeline).toEqual(marks);
      expect(common.coverage).toEqual({ before: "The index does not hold this history yet.", ledger: null, after: "" });
      expect(common.reserve).toMatchObject({ amount: "0.2" });
    });
  });

  describe("the removed banner", () => {
    const REMOVED = { ledger_index: 107_967_068, time: "2026-10-28T22:14:51Z", tx_hash: OBJECT_TX_HASH, tx_type: "EscrowFinish" };
    const finished = (): ObjectAnswer => {
      const answer = withEvents(FINISH, CREATE);
      answer.escrow = { ...answer.escrow, status: "finished", removed: REMOVED };
      return answer;
    };
    const SENTENCE: Segment[] = [{ t: "text", v: "Finished on Oct 28, 2026, 22:14 UTC." }];

    it("is there for an object that was removed, with the type's sentence, and the reserve is released", () => {
      const common = commonOf(index(finished()), options(), parts({ bannerSentence: SENTENCE }));
      expect(common.removed).toBe(true);
      expect(common.banner).toEqual({ ledger: 107_967_068, txType: "EscrowFinish", hash: OBJECT_TX_HASH, sentence: SENTENCE });
      expect(common.reserve!.hint).toBe("Released to the owner when the escrow was removed.");
      expect(common.asOf).toBe("From history: the escrow’s last state, before ledger #107,967,068 removed it.");
    });

    it("is none for an object in the ledger", () => {
      expect(commonOf(index(escrowAnswerSample()), options(), parts({ bannerSentence: null })).banner).toBeNull();
    });
  });

  describe("the history of an object the index has", () => {
    it("reads oldest to newest: D5 serves newest first and the page turns each page round once", () => {
      const answer = withEvents(FINISH, UPDATE, CREATE);
      const common = commonOf(index(answer), options(), parts());
      expect(common.timeline.map((item) => item.title)).toEqual(["said create", "Changed by AccountSet", "said finish"]);
      expect(common.timeline.map((item) => item.ledger)).toEqual([107_897_249, 107_900_001, 107_900_002]);
      // the answer's own history is not turned round in place
      expect(answer.history.map((e) => e.event)).toEqual(["finish", "update", "create"]);
    });

    it("reads a page of older events oldest to newest too, in place of the answer's own newest events, and leaves the marks to the first page", () => {
      const page = historySample({ marker: OBJECT_MARKER, history: [event({ ...UPDATE }), event({ ...CREATE })] });
      const marks = [mark("FinishAfter", T), next("EscrowCancel", T + 1)];
      const common = commonOf(index(withEvents(FINISH), page), options({ marker: "M1", back: [] }), parts({ marks }));
      expect(common.timeline.map((item) => item.title)).toEqual(["said create", "Changed by AccountSet"]);
      // the same answer on its first page has its own events and the marks
      expect(commonOf(index(withEvents(FINISH)), options(), parts({ marks })).timeline.map((item) => item.type)).toEqual(["EscrowFinish", "FinishAfter", "EscrowCancel"]);
    });

    it("pages in D5's direction: Older is the answer's `history_marker`, and none while there is no more", () => {
      const path = `/xrpl/escrows/${ESCROW_ID}`;
      expect(commonOf(index(escrowAnswerSample({ history_marker: "M1" })), options(), parts()).paging).toEqual({ newerHref: null, olderHref: `${path}?marker=M1` });
      expect(commonOf(index(escrowAnswerSample()), options(), parts()).paging).toEqual({ newerHref: null, olderHref: null });
    });

    it("pages from a page of older events: Older is that page's `marker`, Newer goes back along the trail", () => {
      const path = `/xrpl/escrows/${ESCROW_ID}`;
      const page = historySample({ marker: "M3" });
      expect(commonOf(index(escrowAnswerSample({ history_marker: "M1" }), page), options({ marker: "M1", back: [] }), parts()).paging).toEqual({
        newerHref: path,
        olderHref: `${path}?marker=M3&back=M1`,
      });
      expect(commonOf(index(escrowAnswerSample({ history_marker: "M1" }), page), options({ marker: "M2", back: ["M1"] }), parts()).paging).toEqual({
        newerHref: `${path}?marker=M1`,
        olderHref: `${path}?marker=M3&back=M2.M1`,
      });
      const last = historySample();
      delete last.marker;
      expect(commonOf(index(escrowAnswerSample({ history_marker: "M1" }), last), options({ marker: "M3", back: ["M2", "M1"] }), parts()).paging).toEqual({
        newerHref: `${path}?marker=M2&back=M1`,
        olderHref: null,
      });
    });

    it("pages a check and a channel under their own routes", () => {
      expect(commonOf(index(checkAnswerSample({ history_marker: "M1" })), options({ kind: "check" }), parts()).paging!.olderHref).toBe(`/xrpl/checks/${CHECK_ID}?marker=M1`);
      expect(commonOf(index(paymentChannelAnswerSample({ history_marker: "M1" })), options({ kind: "payment-channel", net: XAHAU }), parts()).paging!.olderHref).toBe(`/xahau/payment-channels/${CHANNEL_ID}?marker=M1`);
    });

    it("says what the index does not hold in the words of the kind", () => {
      const note = (kind: "escrow" | "check" | "payment-channel", answer: ObjectAnswer) => commonOf(index(answer), options({ kind }), parts()).coverage!.after;
      const incomplete = { complete: false, from_ledger_index: 107_874_617 };
      expect(note("escrow", escrowAnswerSample({ coverage: incomplete }))).toBe(" onwards: earlier events of this escrow are not in the index yet.");
      expect(note("check", checkAnswerSample({ coverage: incomplete }))).toBe(" onwards: earlier events of this check are not in the index yet.");
      expect(note("payment-channel", paymentChannelAnswerSample({ coverage: incomplete }))).toBe(" onwards: earlier events of this payment channel are not in the index yet.");
    });
  });
});

// ---- The words and the accounts of a sentence --------------------------------------------------------------------------------------------------------

describe("sentence and theAmount", () => {
  it("makes a sentence of strings, segments and lists of segments, with the text next to text made one segment", () => {
    const account: Segment = { t: "account", v: ESCROW_OWNER };
    expect(sentence("a ", "b", account, " c", [{ t: "text", v: " d" }, { t: "amount", value: "1", currency: "XRP" }], "!")).toEqual([
      { t: "text", v: "a b" },
      account,
      { t: "text", v: " c d" },
      { t: "amount", value: "1", currency: "XRP" },
      { t: "text", v: "!" },
    ]);
    // a part left out as "" leaves nothing behind
    expect(sentence("", "", [{ t: "text", v: "" }])).toEqual([]);
    expect(sentence("a", "", account)).toEqual([{ t: "text", v: "a" }, account]);
  });

  it("names the amount as a noun phrase, or the funds where D5 could not read it", () => {
    expect(theAmount({ value: "5", currency: "XRP" })).toEqual([{ t: "text", v: "the " }, { t: "amount", value: "5", currency: "XRP" }]);
    expect(theAmount(null)).toEqual([{ t: "text", v: "the funds" }]);
    expect(sentence("Until then ", theAmount(null), " stay locked.")).toEqual([{ t: "text", v: "Until then the funds stay locked." }]);
  });
});

describe("commonAccounts", () => {
  const A = (n: number) => `r${String(n).repeat(25)}`.slice(0, 26);
  const account = (v: string): Segment => ({ t: "account", v });
  const issued = (issuer: string): Segment => ({ t: "amount", value: "1", currency: "USD", issuer });
  const base = commonOf(
    { origin: "index", answer: escrowAnswerSample() },
    { net: XRPL, kind: "escrow", serverState: stateOf(), names: NO_NAMES, back: [] },
    { pill: { tone: "info", text: "Pending" }, states: [], marks: [], bannerSentence: null, say: () => ({ title: "t", what: [] }) },
  );
  const tx = (over: Partial<TimelineItem>): TimelineItem => ({ kind: "tx", type: "EscrowCreate", title: "t", what: [], by: A(1), ...over });

  it("lists the accounts of the banner's sentence, and the sentence, the by and the delegate of each timeline item (the order Timeline draws them), each once", () => {
    const page = {
      ...base,
      banner: { ledger: 1, txType: "EscrowFinish", hash: "H", sentence: [account(A(2))] },
      timeline: [tx({ by: A(1), delegate: A(3), what: [account(A(4))] }), tx({ by: A(1), what: [account(A(2)), account(A(5))] }), { kind: "next", type: "EscrowCancel", title: "t", what: [account(A(6))] } as TimelineItem],
    };
    expect(commonAccounts(page)).toEqual([A(2), A(4), A(1), A(3), A(5), A(6)]);
  });

  it("is empty for a page with no banner and no timeline account", () => {
    expect(commonAccounts({ ...base, banner: null, timeline: [] })).toEqual([]);
    expect(commonAccounts({ ...base, banner: null, timeline: [tx({ what: [{ t: "text", v: "x" }], by: undefined })] })).toEqual([]);
  });

  it("puts the accounts of the type's own parts between the banner's and the timeline's, and lists each once", () => {
    const page = { ...base, banner: { ledger: 1, txType: "EscrowFinish", hash: "H", sentence: [account(A(2))] }, timeline: [tx({ by: A(1), delegate: A(3) })] };
    expect(commonAccounts(page, [A(7), A(1), A(2), A(8)])).toEqual([A(2), A(7), A(1), A(8), A(3)]);
    expect(commonAccounts(page, [])).toEqual(commonAccounts(page));
  });

  it("never lists the issuer of an amount in a sentence, nor the names it is given, nor an address anywhere else in the page", () => {
    const names: NamesPart = { state: "ok", map: { [A(9)]: { name: { text: "Elsewhere", kind: "account" }, labels: [] } } };
    const page = {
      ...base,
      names,
      banner: { ledger: 1, txType: "EscrowFinish", hash: "H", sentence: [issued(A(2))] },
      timeline: [tx({ by: A(1), what: [issued(A(3))] })],
    };
    expect(commonAccounts(page)).toEqual([A(1)]);
  });
});

describe("the rows of the Details card the three views share", () => {
  const A = (n: number) => `r${String(n).repeat(25)}`.slice(0, 26);

  it("gives the issuer of a token amount, and none for a native amount, an MPT or an amount D5 could not read", () => {
    expect(issuerOf({ value: "1", currency: "USD", issuer: TOKEN_ISSUER })).toBe(TOKEN_ISSUER);
    expect(issuerOf({ value: "1", currency: "XRP" })).toBeUndefined();
    expect(issuerOf({ mpt: { id: MPT_ISSUANCE_ID, units: "5" } })).toBeUndefined();
    expect(issuerOf(null)).toBeUndefined();
  });

  it("lists the accounts the rows draw as links, in their order: an account row's address and the issuer of a token in an amount row", () => {
    const rows: DetailRow[] = [
      { label: "ID", value: { kind: "code", text: A(9), copy: "Copy" } },
      { label: "Source", value: { kind: "account", address: A(1) } },
      { label: "Destination", value: { kind: "account", address: A(2) } },
      { label: "Amount", value: { kind: "amount", amount: { value: "1", currency: "USD", issuer: A(3) } } },
      { label: "Native", value: { kind: "amount", amount: { value: "1", currency: "XRP" } } },
      { label: "Unread", value: { kind: "amount", amount: null } },
      { label: "MPT", value: { kind: "amount", amount: { mpt: { id: MPT_ISSUANCE_ID, units: "5" } } } },
      { label: "Tag", value: { kind: "number", text: "7" } },
    ];
    // a code row holding an address-shaped text is not a link, and a sentence's issuer is not a row
    expect(detailAccounts(rows)).toEqual([A(1), A(2), A(3)]);
    expect(detailAccounts([])).toEqual([]);
  });

  it("makes a row's value of nothing to say fresh each time, and a tag a number or nothing", () => {
    expect(none()).toEqual({ kind: "text", text: "None", faint: true });
    expect(none("—")).toEqual({ kind: "text", text: "—", faint: true });
    expect(none()).not.toBe(none());
    expect(tagValue(88231)).toEqual({ kind: "number", text: "88231" });
    expect(tagValue(0)).toEqual({ kind: "number", text: "0" });
    expect(tagValue(undefined)).toEqual({ kind: "text", text: "None", faint: true });
  });
});
