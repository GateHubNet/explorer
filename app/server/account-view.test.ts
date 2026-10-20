import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Segment } from "../domain/describe";
import type { AccountData, AccountExchange, BalancesResponse, OrdersResponse, Payment, TxObject } from "./api-types";
import {
  ACCOUNT_TABS,
  accountFlags,
  accountHeader,
  accountHref,
  decodeDomain,
  existenceOf,
  failedList,
  isAccountTab,
  loaded,
  objectRows,
  objectsList,
  offerRows,
  offersList,
  ownedCounts,
  paymentRows,
  paymentsList,
  pagingOf,
  parseTag,
  parseTrail,
  reserveOf,
  TAB_WHAT,
  tokensOf,
  tradeRows,
  tradesList,
  transactionRows,
  transactionsList,
  type Loaded,
} from "./account-view";
import type { AccountInfo, AccountObjects, LedgerObject, ServerState } from "./node-rpc";
import { UpstreamError } from "./upstream";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../test/fixtures/http/${path}`, import.meta.url), "utf8"));

const XRPL = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const XAHAU = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";

const ok = <T>(value: T): Loaded<T> => ({ state: "ok", value });
const MISSING: Loaded<never> = { state: "missing" };
const FAILED: Loaded<never> = { state: "failed" };

const created = (net: "xrpl" | "xahau", address: string): AccountData => read(`${net}/data-api/accounts/${address}.json`).account_data;
const balancesOf = (net: "xrpl" | "xahau", address: string): BalancesResponse => read(`${net}/data-api/accounts/${address}/balances.json`);
const infoOf = (net: "xrpl" | "xahau", address: string): AccountInfo => read(`${net}/node/account_info/${address}.json`).result;
const objectsOf = (net: "xrpl" | "xahau", address: string): AccountObjects => read(`${net}/node/account_objects/${address}.json`).result;
const stateOf = (net: "xrpl" | "xahau"): ServerState => read(`${net}/node/server_state.json`).result.state;
const list = <K extends string>(net: "xrpl" | "xahau", address: string, kind: string, key: K, marker?: string) =>
  read(`${net}/data-api/accounts/${address}/${kind}@descending=true&limit=20${marker ? `&marker=${marker}` : ""}.json`)[key];

const text = (segments: readonly Segment[]) => segments.map((s) => (s.t === "text" ? s.v : s.t === "account" ? `<${s.v}>` : s.t === "amount" ? `{${s.value} ${s.currency}}` : `[${s.pair}]`)).join("");

describe("the tabs and the URL", () => {
  it("lists the six tabs of the page, the first being the default and the last the analytics", () => {
    expect(ACCOUNT_TABS).toEqual(["transactions", "payments", "trades", "offers", "objects", "analytics"]);
    for (const tab of ACCOUNT_TABS) expect(isAccountTab(tab)).toBe(true);
    for (const other of ["Analytics", "", "Transactions", "tx", "constructor", "__proto__", null, undefined, 1]) expect(isAccountTab(other), String(other)).toBe(false);
  });

  it.each([
    ["104882", 104882],
    ["0", 0],
    ["1", 1],
    ["4294967295", 4294967295],
  ])("takes %s for a destination tag", (input, tag) => expect(parseTag(input)).toBe(tag));

  it.each([null, "", " 5", "5 ", "-1", "+5", "1.5", "1e3", "0x10", "007", "00", "4294967296", "99999999999999999999", "abc", "５", "1,000", "<b>1</b>"])(
    "takes %j for no tag at all",
    (input) => expect(parseTag(input)).toBeNull(),
  );

  it("reads a trail of markers: dot-separated, each one a marker, at most ten", () => {
    expect(parseTrail("A.B_c.D-e")).toEqual(["A", "B_c", "D-e"]);
    expect(parseTrail("WzEwNzYxMjU3MywyNV0")).toEqual(["WzEwNzYxMjU3MywyNV0"]);
    expect(parseTrail(null)).toEqual([]);
    expect(parseTrail("")).toEqual([]);
    expect(parseTrail("A..B")).toEqual([]);
    expect(parseTrail("A.<b>")).toEqual([]);
    expect(parseTrail("A.B.C.D.E.F.G.H.I.J")).toHaveLength(10);
    expect(parseTrail("A.B.C.D.E.F.G.H.I.J.K")).toEqual([]);
  });

  it("builds the URL of a tab and a page: the default tab and the first page have none of it", () => {
    expect(accountHref("xrpl", XRPL, {})).toBe(`/xrpl/account/${XRPL}`);
    expect(accountHref("xahau", XAHAU, { tab: "transactions" })).toBe(`/xahau/account/${XAHAU}`);
    expect(accountHref("xrpl", XRPL, { tab: "payments" })).toBe(`/xrpl/account/${XRPL}?tab=payments`);
    expect(accountHref("xrpl", XRPL, { tab: "trades", marker: "M1" })).toBe(`/xrpl/account/${XRPL}?tab=trades&marker=M1`);
    expect(accountHref("xrpl", XRPL, { marker: "M2", back: ["M1"] })).toBe(`/xrpl/account/${XRPL}?marker=M2&back=M1`);
    expect(accountHref("xrpl", XRPL, { marker: "M3", back: ["M2", "M1"] })).toBe(`/xrpl/account/${XRPL}?marker=M3&back=M2.M1`);
  });

  describe("paging: Newer and Older by marker", () => {
    const page = (tab: "transactions" | "payments", marker: string | undefined, back: string[], next?: string) => pagingOf("xrpl", XRPL, { tab, marker, back, next });

    it("has nothing newer on the first page, and an Older when the API gave a marker", () => {
      expect(page("transactions", undefined, [], "M1")).toEqual({ newerHref: null, olderHref: `/xrpl/account/${XRPL}?marker=M1` });
      expect(page("payments", undefined, [])).toEqual({ newerHref: null, olderHref: null });
    });

    it("goes back to the first page from the second, and to the page before from every other", () => {
      // Page 2 was reached with marker M1 (the first page's), page 3 with M2 from page 2, page 4 with M3 from page 3.
      expect(page("transactions", "M1", [], "M2")).toEqual({
        newerHref: `/xrpl/account/${XRPL}`,
        olderHref: `/xrpl/account/${XRPL}?marker=M2&back=M1`,
      });
      expect(page("transactions", "M2", ["M1"], "M3")).toEqual({
        newerHref: `/xrpl/account/${XRPL}?marker=M1`,
        olderHref: `/xrpl/account/${XRPL}?marker=M3&back=M2.M1`,
      });
      expect(page("transactions", "M3", ["M2", "M1"])).toEqual({
        newerHref: `/xrpl/account/${XRPL}?marker=M2&back=M1`,
        olderHref: null,
      });
    });

    it("keeps the tab in both links", () => {
      expect(page("payments", "M1", [], "M2")).toEqual({
        newerHref: `/xrpl/account/${XRPL}?tab=payments`,
        olderHref: `/xrpl/account/${XRPL}?tab=payments&marker=M2&back=M1`,
      });
    });

    it("remembers the ten pages before at most, and then goes back to the nearest it still knows", () => {
      const back = ["M10", "M9", "M8", "M7", "M6", "M5", "M4", "M3", "M2", "M1"];
      const older = page("transactions", "M11", back, "M12").olderHref!;
      expect(new URL(older, "https://x.test").searchParams.get("back")).toBe("M11.M10.M9.M8.M7.M6.M5.M4.M3.M2");
    });
  });
});

describe("loaded", () => {
  it("says what a settled call came to: its value, that the thing is not there, or that the call failed", () => {
    expect(loaded({ status: "fulfilled", value: 5 })).toEqual({ state: "ok", value: 5 });
    expect(loaded({ status: "rejected", reason: new UpstreamError("not_found", "no") })).toEqual({ state: "missing" });
    for (const kind of ["server", "timeout", "network", "rate_limited", "bad_request"] as const) {
      expect(loaded({ status: "rejected", reason: new UpstreamError(kind, "x") }), kind).toEqual({ state: "failed" });
    }
  });

  it("does not hide a bug: an error that is not an upstream's is thrown again", () => {
    expect(() => loaded({ status: "rejected", reason: new TypeError("bug") })).toThrow(TypeError);
  });
});

describe("existenceOf: what the index, the node and the history say between them", () => {
  const created_ = ok(created("xrpl", XRPL));
  const info = ok(infoOf("xrpl", XRPL));
  it.each([
    ["the index knows it and the node has it", created_, info, undefined, "active"],
    ["the index knows it and the node says it is gone", created_, MISSING, undefined, "deleted"],
    ["the index knows it and the node did not answer", created_, FAILED, undefined, "unverified"],
    ["the index has no creation and the node has it (before the backfill)", MISSING, info, undefined, "active"],
    ["neither has it, and nobody has asked the history yet", MISSING, MISSING, undefined, "undetermined"],
    ["neither has it and the index has no history of it: never activated", MISSING, MISSING, ok(false), "never-activated"],
    ["neither has it, but the index has a history of it: deleted, before the index's creation records", MISSING, MISSING, ok(true), "deleted"],
    ["neither has it and the history could not be asked: it cannot be told", MISSING, MISSING, FAILED, "outage"],
    ["the index has no creation and the node did not answer: it cannot be told", MISSING, FAILED, undefined, "outage"],
    ["the same, whatever the history says", MISSING, FAILED, ok(false), "outage"],
    ["the index failed", FAILED, info, undefined, "outage"],
    ["the index failed and the node says it is gone", FAILED, MISSING, ok(true), "outage"],
    ["the history is of no account when the index has the creation", created_, MISSING, ok(false), "deleted"],
  ] as const)("%s: %s", (_what, c, n, history, expected) => {
    expect(existenceOf(c as Loaded<AccountData>, n as Loaded<AccountInfo>, history as Loaded<boolean> | undefined)).toBe(expected);
  });
});

describe("reserveOf", () => {
  it("is the base reserve plus the increment for each object, and what is left of the balance is available", () => {
    expect(reserveOf("10001625", 1, 1_000_000, 200_000)).toEqual({
      reserve: { total: "1.2", base: "1", increment: "0.2", objects: 1 },
      available: "8.801625",
    });
    expect(reserveOf("9351039221", 2, 1_000_000, 200_000)).toMatchObject({ reserve: { total: "1.4" }, available: "9349.639221" });
  });

  it("is never below zero: a balance under its reserve has nothing available", () => {
    expect(reserveOf("500000", 3, 1_000_000, 200_000).available).toBe("0");
    expect(reserveOf("1200000", 1, 1_000_000, 200_000).available).toBe("0");
    expect(reserveOf("0", 0, 1_000_000, 200_000).available).toBe("0");
  });

  it("is exact for amounts doubles cannot hold, and takes the increments the network has voted", () => {
    expect(reserveOf("99999999999999999", 0, 1_000_000, 200_000).available).toBe("99999999998.999999");
    expect(reserveOf("99999999999999999", 5, 10_000_000, 2_000_000)).toMatchObject({ reserve: { total: "20", base: "10", increment: "2" }, available: "99999999979.999999" });
  });
});

describe("accountFlags", () => {
  it("names the flags of an account, in the order of their bits", () => {
    expect(accountFlags(0, "xrpl")).toEqual([]);
    expect(accountFlags(0x00020000, "xrpl")).toEqual([{ id: "requireDestTag", label: "Requires destination tag" }]);
    expect(accountFlags(1048576, "xahau")).toEqual([{ id: "disableMaster", label: "Master key disabled" }]);
    expect(accountFlags(0x00020000 | 0x00800000 | 0x01000000, "xrpl").map((f) => f.id)).toEqual(["requireDestTag", "defaultRipple", "depositAuth"]);
  });

  it("names the flag that asks not to receive the native currency with the network's own", () => {
    // lsfDisallowXRP asks senders not to pay in the native currency; the ledger does not stop them.
    expect(accountFlags(0x00080000, "xrpl")[0]!.label).toBe("Asks not to receive XRP");
    expect(accountFlags(0x00080000, "xahau")[0]!.label).toBe("Asks not to receive XAH");
  });

  it("knows the flags only one network has by that network, and says nothing about a bit it does not know", () => {
    expect(accountFlags(0x02000000, "xrpl").map((f) => f.id)).toEqual(["amm"]);
    expect(accountFlags(0x02000000, "xahau")).toEqual([]);
    expect(accountFlags(0x80000000, "xrpl").map((f) => f.id)).toEqual(["allowClawback"]);
    expect(accountFlags(0x00010000, "xrpl")).toEqual([]);
    expect(accountFlags(0x4000ffff, "xrpl")).toEqual([]);
  });
});

describe("decodeDomain", () => {
  it("reads the hex of an ASCII domain", () => {
    expect(decodeDomain("6578616D706C652E636F6D")).toBe("example.com");
    expect(decodeDomain("6578616d706c652e636f6d")).toBe("example.com");
    expect(decodeDomain("626974686F6D702E636F6D")).toBe("bithomp.com");
  });

  it.each([undefined, "", "6578616D706C652E636F6", "zz", "6578 616D", "00", "0A6578616D", "E282AC", "68656C6C6F20776F726C64", "FF".repeat(10), "41".repeat(256)])(
    "shows no domain for %j: not hex, not whole bytes, not printable ASCII without spaces, or too long",
    (input) => expect(decodeDomain(input)).toBeNull(),
  );
});

describe("ownedCounts", () => {
  const object = (LedgerEntryType: string): LedgerObject => ({ LedgerEntryType });
  it("counts the objects by type, with the names the page shows, trust lines and offers first", () => {
    const counts = ownedCounts([
      object("Escrow"),
      object("RippleState"),
      object("RippleState"),
      object("Offer"),
      object("Check"),
      object("Escrow"),
      object("NFTokenPage"),
      object("Ticket"),
      object("PayChannel"),
      object("SignerList"),
      object("Hook"),
    ]);
    expect(counts).toEqual([
      { type: "RippleState", label: "trust lines", count: 2 },
      { type: "Offer", label: "offer", count: 1 },
      { type: "Escrow", label: "escrows", count: 2 },
      { type: "Check", label: "check", count: 1 },
      { type: "PayChannel", label: "payment channel", count: 1 },
      { type: "NFTokenPage", label: "NFT page", count: 1 },
      { type: "Ticket", label: "ticket", count: 1 },
      { type: "SignerList", label: "signer list", count: 1 },
      { type: "Hook", label: "Hook", count: 1 },
    ]);
  });

  it("is empty for an account that owns nothing, and puts a type it has no name for in plain words", () => {
    expect(ownedCounts([])).toEqual([]);
    expect(ownedCounts([object("SomethingNew")])).toEqual([{ type: "SomethingNew", label: "SomethingNew", count: 1 }]);
  });

  it("counts the one trust line of the recorded XRPL account", () => {
    expect(ownedCounts(objectsOf("xrpl", XRPL).account_objects)).toEqual([{ type: "RippleState", label: "trust line", count: 1 }]);
  });
});

describe("tokensOf", () => {
  it("lists the trust lines of the balances, without the native balance, as currency, issuer and value", () => {
    const { items, truncated } = tokensOf(balancesOf("xrpl", XRPL));
    expect(items).toEqual([{ currency: "4C494F4E53000000000000000000000000000000", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS", value: "48329.908117603", lp: false }]);
    expect(truncated).toBe(false);
  });

  it("marks an LP token (a 40-hex code that starts with 03), whose issuer is the AMM pool", () => {
    const lp = "03" + "AB".repeat(19);
    const { items } = tokensOf({ result: "success", balances: [{ currency: "XRP", value: "5" }, { currency: lp, counterparty: "rAMM", value: "12.5" }] });
    expect(items).toEqual([{ currency: lp, issuer: "rAMM", value: "12.5", lp: true }]);
  });

  it("says the list may be longer when the API filled the limit it was asked for", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ currency: "USD", counterparty: `rIssuer${i}`, value: "1" }));
    const full = tokensOf({ result: "success", limit: 200, balances: [{ currency: "XRP", value: "5" }, ...rows.slice(0, 199)] });
    expect(full.items).toHaveLength(199);
    expect(full.truncated).toBe(true);
    const part = tokensOf({ result: "success", limit: 200, balances: [{ currency: "XRP", value: "5" }, ...rows.slice(0, 50)] });
    expect(part.truncated).toBe(false);
  });
});

describe("accountHeader", () => {
  const input = (over: Partial<Parameters<typeof accountHeader>[0]> = {}): Parameters<typeof accountHeader>[0] => ({
    native: "XRP",
    created: ok(created("xrpl", XRPL)),
    info: ok(infoOf("xrpl", XRPL)),
    objects: ok(objectsOf("xrpl", XRPL)),
    state: ok(stateOf("xrpl")),
    balances: ok(balancesOf("xrpl", XRPL)),
    lastLedgerTime: 1792253462,
    ...over,
  });

  it("shows an active account: activation, live state, balance with reserve and available, tokens and owned objects", () => {
    const { header, problems } = accountHeader(input());
    expect(problems).toEqual([]);
    expect(header.status).toBe("active");
    expect(header.activation).toEqual({
      time: Date.parse("2025-07-15T18:30:43Z") / 1000,
      parent: "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ",
      initialBalance: "25",
      txHash: "9B107B80D5606BB743A58ED7EA6DCA1BDC1E8619FBFA531CD881523C1DCC76F1",
    });
    expect(header.live).toEqual({
      state: "ok",
      ledgerIndex: 107721455,
      sequence: 98986800,
      flags: [],
      regularKey: false,
      domain: null,
      lastActive: { ledgerIndex: 107720688, hash: "C7FE6468BA25CE904C41722C0892316954133B000339C644073A88CACD8A9143", time: 1792253462 },
    });
    expect(header.balance).toEqual({
      native: "10.001625",
      available: "8.801625",
      reserve: { total: "1.2", base: "1", increment: "0.2", objects: 1 },
    });
    expect(header.tokens.state).toBe("ok");
    expect(header.owned).toEqual({ counts: [{ type: "RippleState", label: "trust line", count: 1 }], truncated: false });
  });

  it("decodes the domain, sees the regular key and the flags of the Xahau account", () => {
    const base = infoOf("xahau", XAHAU);
    const info = ok({ ...base, account_data: { ...base.account_data, Domain: "6578616D706C652E636F6D" } });
    const { header } = accountHeader(input({ native: "XAH", created: ok(created("xahau", XAHAU)), info, objects: ok(objectsOf("xahau", XAHAU)), state: ok(stateOf("xahau")), balances: ok(balancesOf("xahau", XAHAU)) }));
    expect(header.live).toMatchObject({ state: "ok", sequence: 755783996, regularKey: true, domain: "example.com", flags: [{ id: "disableMaster", label: "Master key disabled" }] });
    expect(header.balance).toEqual({ native: "9351.039221", available: "9349.639221", reserve: { total: "1.4", base: "1", increment: "0.2", objects: 2 } });
  });

  it("leaves the last activity without a time when the ledger it names could not be read", () => {
    const { header, problems } = accountHeader(input({ lastLedgerTime: null }));
    expect(problems).toEqual([]);
    expect(header.live).toMatchObject({ state: "ok", lastActive: { ledgerIndex: 107720688, time: null } });
  });

  it("uses the reserves the node reports, and says nothing of a reserve it does not have", () => {
    const state = stateOf("xrpl");
    const voted = ok({ ...state, validated_ledger: { ...state.validated_ledger!, reserve_base: 10_000_000, reserve_inc: 2_000_000 } });
    expect(accountHeader(input({ state: voted })).header.balance).toEqual({
      native: "10.001625",
      available: "0",
      reserve: { total: "12", base: "10", increment: "2", objects: 1 },
    });

    const unsynced = accountHeader(input({ state: ok({ ...state, validated_ledger: undefined }) }));
    expect(unsynced.header.balance).toEqual({ native: "10.001625", available: null, reserve: null });
    expect(unsynced.problems).toEqual(["the node has no validated ledger to read the reserves from"]);
  });

  it("is a deleted account when the node has no such account: the history stays, the live state does not", () => {
    const { header, problems } = accountHeader(
      input({ created: ok(created("xrpl", "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC")), info: MISSING, objects: MISSING, balances: MISSING }),
    );
    expect(problems).toEqual([]);
    expect(header.status).toBe("deleted");
    expect(header.live).toEqual({ state: "none" });
    expect(header.balance).toBeNull();
    expect(header.tokens).toEqual({ state: "none" });
    expect(header.owned).toBeNull();
    expect(header.activation).not.toBeNull();
  });

  it("says the live state is unavailable when the node does not answer, keeps the balance the index read, and names the problem", () => {
    const { header, problems } = accountHeader(input({ info: FAILED, objects: FAILED, state: FAILED }));
    expect(header.status).toBe("active");
    expect(header.live).toEqual({ state: "unavailable" });
    expect(header.balance).toEqual({ native: "10.001625", available: null, reserve: null });
    expect(header.owned).toBeNull();
    expect(header.tokens.state).toBe("ok");
    expect(problems).toEqual(["node account_info failed", "node account_objects failed", "node server_state failed"]);
  });

  it("has no balance when neither the node nor the index gave one", () => {
    expect(accountHeader(input({ info: FAILED, balances: MISSING })).header.balance).toBeNull();
  });

  it("says the tokens could not be loaded when the index failed on them, and names the problem", () => {
    const { header, problems } = accountHeader(input({ balances: FAILED }));
    expect(header.tokens).toEqual({ state: "failed" });
    expect(problems).toEqual(["balances failed"]);
    expect(header.balance?.native).toBe("10.001625");
  });

  it("counts the objects of the first page only, and says so when the node has more", () => {
    const objects = objectsOf("xrpl", XRPL);
    const { header } = accountHeader(input({ objects: ok({ ...objects, marker: "NEXT" }) }));
    expect(header.owned).toMatchObject({ truncated: true });
  });

  it("is the account the index has no creation for when the node has it: no activation line", () => {
    expect(accountHeader(input({ created: MISSING })).header.activation).toBeNull();
  });

  it("is a deleted account with its activation unknown when neither has it and the index has a history of it", () => {
    const { header, problems } = accountHeader(input({ created: MISSING, info: MISSING, objects: MISSING, balances: MISSING, history: ok(true) }));
    expect(problems).toEqual([]);
    expect(header.status).toBe("deleted");
    expect(header.activation).toBeNull();
    expect(header.live).toEqual({ state: "none" });
  });

  it("is not for an account that was never activated, or one that cannot be told", () => {
    const none = { created: MISSING, info: MISSING, objects: MISSING, balances: MISSING } as const;
    expect(() => accountHeader(input({ ...none, history: ok(false) }))).toThrow(/never-activated/);
    expect(() => accountHeader(input({ ...none }))).toThrow(/undetermined/);
    expect(() => accountHeader(input({ ...none, history: FAILED }))).toThrow(/outage/);
  });

  it("does not put the node's raw objects in the header", () => {
    const json = JSON.stringify(accountHeader(input()).header);
    for (const word of ["LedgerEntryType", "PreviousTxnID", "HighLimit", "AccountRoot"]) expect(json).not.toContain(word);
  });
});

describe("transactionRows", () => {
  const rows = transactionRows(list("xrpl", XRPL, "transactions", "transactions") as TxObject[], XRPL, "XRP");

  it("makes a row of each transaction, newest first as the API gave them", () => {
    expect(rows.map((r) => r.hash.slice(0, 8))).toEqual(["C7FE6468", "76018ADC", "52FC2BE1", "1CB29CFC"]);
    expect(rows.map((r) => r.type)).toEqual(["OfferCreate", "OfferCreate", "Payment", "OfferCreate"]);
    expect(rows[0]).toMatchObject({ time: Date.parse("2026-10-17T16:11:02+00:00") / 1000, ledgerIndex: 107720688, ok: true, code: "tesSUCCESS" });
  });

  it("tells what happened from the account's side: without itself as the sender, with someone else as the sender", () => {
    expect(text(rows[1]!.what)).toMatch(/^Offered to buy \{14822\.07 [0-9A-F]+\} for \{2\.34\d+ XRP\}$/);
    expect(rows[0]!.what[0]).toMatchObject({ t: "account", v: expect.stringMatching(/^rDFDjd/) });
    expect(text(rows[0]!.what)).toMatch(/^<rDFDjd[A-Za-z0-9]+> offered to buy \{/);
  });

  it("shows the change of the account's balance: the native one first, and how many others there are", () => {
    expect(rows[0]!.change).toEqual({ value: "2.411362", currency: "XRP", more: 1 });
    expect(rows[1]!.change).toEqual({ value: "-2.346005", currency: "XRP", more: 1 });
    expect(rows[2]!.change).toEqual({ value: "0.00001", currency: "XRP", more: 0 });
    expect(rows[3]!.change).toEqual({ value: "-0.000012", currency: "XRP", more: 0 });
  });

  it("prefers a change that is more than the fee: an issued one when the native one is only the fee", () => {
    const xahau = transactionRows(list("xahau", XAHAU, "transactions", "transactions") as TxObject[], XAHAU, "XAH");
    expect(xahau.map((r) => r.change)).toEqual([
      { value: "0.000001", currency: "XAH", more: 0 },
      { value: "0.000001", currency: "XAH", more: 0 },
      { value: "-1.43245085", currency: "EVR", more: 0 },
      { value: "0.000001", currency: "XAH", more: 0 },
      { value: "0.000001", currency: "XAH", more: 0 },
    ]);
  });

  it("shows a failed transaction by its result code and the sentence without the reason", () => {
    const failed = list("xrpl", XRPL, "transactions", "transactions")[1] as TxObject;
    const row = transactionRows([{ ...failed, meta: { ...failed.meta, TransactionResult: "tecKILLED" } }], XRPL, "XRP")[0]!;
    expect(row).toMatchObject({ ok: false, code: "tecKILLED" });
    expect(text(row.what)).not.toMatch(/\.$/);
    expect(row.what.length).toBeGreaterThan(0);
  });

  it("is empty for no transactions, and carries nothing of the transaction's JSON", () => {
    expect(transactionRows([], XRPL, "XRP")).toEqual([]);
    const json = JSON.stringify(rows);
    for (const word of ["AffectedNodes", "TransactionType", "SigningPubKey", "FinalFields", "PreviousFields"]) expect(json).not.toContain(word);
  });
});

describe("paymentRows", () => {
  it("makes sent and received payments, with the counterparty, the delivered amount signed and the destination tag", () => {
    const sent = paymentRows(list("xrpl", XRPL, "payments", "payments", "WzEwNzYzNjY3Myw3OF0") as Payment[], XRPL);
    expect(sent).toEqual([
      {
        hash: expect.stringMatching(/^[0-9A-F]{64}$/),
        time: Date.parse("2026-02-12T01:07:50Z") / 1000,
        direction: "sent",
        counterparty: expect.stringMatching(/^rDFDjd/),
        amount: { value: "-2.306481", currency: "XRP" },
        tag: null,
      },
    ]);
    const received = paymentRows(list("xrpl", XRPL, "payments", "payments") as Payment[], XRPL);
    expect(received[0]).toMatchObject({ direction: "received", counterparty: expect.stringMatching(/^rDQSFB/), amount: { value: "0.00001", currency: "XRP" } });
  });

  it("keeps an issued currency's issuer, a tag of 0, and the exact digits of the amount", () => {
    const rows = paymentRows(list("xahau", XAHAU, "payments", "payments") as Payment[], XAHAU);
    const evr = rows.find((r) => r.amount.currency === "EVR")!;
    expect(evr).toMatchObject({ direction: "sent", amount: { value: "-1.432450858916131", currency: "EVR", issuer: expect.stringMatching(/^rEvern/) }, tag: 0 });
  });

  it("shows no sign on a payment of nothing", () => {
    const [row] = paymentRows([{ ...(list("xrpl", XRPL, "payments", "payments", "WzEwNzYzNjY3Myw3OF0")[0] as Payment), delivered_amount: "0" }], XRPL);
    expect(row!.amount.value).toBe("0");
  });
});

describe("tradeRows", () => {
  const exchanges = list("xrpl", XRPL, "exchanges", "exchanges") as AccountExchange[];
  const rows = tradeRows(exchanges, XRPL);

  it("says which side the account was on, what it traded and against whom", () => {
    expect(rows).toHaveLength(2);
    // The first row: the account sold LIONS (it is the seller), the second bought them.
    expect(rows.map((r) => r.side)).toEqual([exchanges[0]!.buyer === XRPL ? "buy" : "sell", exchanges[1]!.buyer === XRPL ? "buy" : "sell"]);
    expect(rows[0]).toMatchObject({
      pair: { base: { currency: "4C494F4E53000000000000000000000000000000" }, counter: { currency: "XRP" } },
      amount: { value: "15235.08", currency: "4C494F4E53000000000000000000000000000000" },
      price: { value: "0.00015827695", currency: "XRP" },
      hash: exchanges[0]!.tx_hash,
    });
    expect(rows[0]!.counterparty).toBe(exchanges[0]!.buyer === XRPL ? exchanges[0]!.seller : exchanges[0]!.buyer);
  });

  it("keeps the base issuer, and has no issuer for the native currency", () => {
    expect(rows[0]!.amount.issuer).toBe(exchanges[0]!.base_issuer);
    expect(rows[0]!.price).not.toHaveProperty("issuer");
  });
});

describe("offerRows", () => {
  const orders: OrdersResponse = {
    result: "success",
    ledger_index: 107721455,
    orders: [
      {
        specification: { direction: "sell", quantity: { currency: "XRP", value: "500" }, totalPrice: { currency: "USD", value: "1240.00", counterparty: "rA7wzfg95" } },
        properties: { maker: XRPL, flags: 131072, sequence: 46118301, makerExchangeRate: "2.48" },
      },
      {
        specification: { direction: "buy", quantity: { currency: "BTC", value: "0.01", counterparty: "rmMVsQCwp" }, totalPrice: { currency: "XRP", value: "6300" } },
        properties: { maker: XRPL, flags: 0, sequence: 46117950 },
      },
    ],
  };

  it("shows each open offer: side, quantity, total price, the rate as total over quantity (8 significant digits) and sequence", () => {
    expect(offerRows(orders)).toEqual([
      {
        side: "sell",
        quantity: { value: "500", currency: "XRP" },
        total: { value: "1240.00", currency: "USD", issuer: "rA7wzfg95" },
        rate: { value: "2.48", quote: "USD", per: "XRP" },
        sequence: 46118301,
      },
      {
        side: "buy",
        quantity: { value: "0.01", currency: "BTC", issuer: "rmMVsQCwp" },
        total: { value: "6300", currency: "XRP" },
        rate: { value: "630000", quote: "XRP", per: "BTC" },
        sequence: 46117950,
      },
    ]);
  });

  it("works the rate out exactly, to 8 significant digits, and never in exponent notation", () => {
    const one = (quantity: string, total: string) =>
      offerRows({ ...orders, orders: [{ ...orders.orders[0]!, specification: { direction: "sell", quantity: { currency: "AAA", value: quantity }, totalPrice: { currency: "BBB", value: total } } }] })[0]!.rate;
    expect(one("3", "1")!.value).toBe("0.33333333");
    expect(one("1000000000", "1")!.value).toBe("0.000000001");
    expect(one("1", "123456789012")!.value).toBe("123456790000");
    expect(one("0", "5")).toBeNull();
    expect(one("1e-15", "1e15")!.value).not.toMatch(/e/i);
  });

  it("is empty for no offers", () => {
    expect(offerRows({ ...orders, orders: [] })).toEqual([]);
  });
});

describe("objectRows", () => {
  const RIPPLE = 946_684_800;
  const objects: LedgerObject[] = [
    { LedgerEntryType: "RippleState", index: "R1" },
    { LedgerEntryType: "Offer", index: "O1" },
    {
      LedgerEntryType: "Escrow",
      index: "E1",
      Amount: "1000000000",
      Destination: "rCQfy3WWL",
      FinishAfter: 1792000000 - RIPPLE,
      CancelAfter: 1798000000 - RIPPLE,
      PreviousTxnID: "AB".repeat(32),
    },
    { LedgerEntryType: "Check", index: "C1", SendMax: { currency: "USD", issuer: "rI", value: "50" }, Destination: "rD", Expiration: 1792000000 - RIPPLE },
    { LedgerEntryType: "PayChannel", index: "P1", Amount: "5000000", Balance: "1000000", Destination: "rD" },
    { LedgerEntryType: "NFTokenPage", index: "N1", NFTokens: [{}, {}, {}] },
    { LedgerEntryType: "Ticket", index: "T1", TicketSequence: 77 },
    { LedgerEntryType: "SignerList", index: "S1", SignerQuorum: 2, SignerEntries: [{}, {}, {}] },
    { LedgerEntryType: "DepositPreauth", index: "D1", Authorize: "rFriend" },
    { LedgerEntryType: "Whatever", index: "W1" },
  ];
  const { rows, trustLines, offers } = objectRows(objects, "XRP");

  it("leaves the trust lines and offers to their own places and counts them", () => {
    expect(trustLines).toBe(1);
    expect(offers).toBe(1);
    expect(rows.map((r) => r.type)).toEqual(["Escrow", "Check", "PayChannel", "NFTokenPage", "Ticket", "SignerList", "DepositPreauth", "Whatever"]);
  });

  it("shows an escrow's amount, destination and times, and the transaction that last changed it", () => {
    const escrow = rows[0]!;
    expect(escrow.tx).toBe("AB".repeat(32));
    expect(escrow.fields.map((f) => f.label)).toEqual(["Amount", "To", "Can finish after", "Can cancel after"]);
    expect(escrow.fields[0]!.value).toEqual([{ t: "amount", value: "1000", currency: "XRP" }]);
    expect(escrow.fields[1]!.value).toEqual([{ t: "account", v: "rCQfy3WWL" }]);
    expect(text(escrow.fields[2]!.value)).toBe("2026-10-14 17:46:40 UTC");
  });

  it("shows the fields that matter for the other types, with amounts in whole units", () => {
    const byType = Object.fromEntries(rows.map((r) => [r.type, r.fields.map((f) => `${f.label}: ${text(f.value)}`)]));
    expect(byType.Check).toEqual(["Send up to: {50 USD}", "To: <rD>", "Expires: 2026-10-14 17:46:40 UTC"]);
    expect(byType.PayChannel).toEqual(["Amount: {5 XRP}", "Claimed so far: {1 XRP}", "To: <rD>"]);
    expect(byType.NFTokenPage).toEqual(["NFTs: 3"]);
    expect(byType.Ticket).toEqual(["Ticket sequence: 77"]);
    expect(byType.SignerList).toEqual(["Quorum: 2", "Signers: 3"]);
    expect(byType.DepositPreauth).toEqual(["Authorized: <rFriend>"]);
    expect(byType.Whatever).toEqual([]);
  });

  it("has no transaction link when the object names none, and carries none of the node's raw fields", () => {
    expect(rows[1]!.tx).toBeNull();
    const json = JSON.stringify(rows);
    for (const word of ["LedgerEntryType", "FinishAfter", "NFTokens", "SignerEntries", "PreviousTxnID"]) expect(json).not.toContain(word);
  });

  it("reads an amount it has no shape for as no field at all, and never throws on a malformed object", () => {
    const odd = objectRows([{ LedgerEntryType: "Escrow", Amount: { mpt_issuance_id: "x", value: "1" }, Destination: 5, FinishAfter: "soon" }, { LedgerEntryType: "Check" }], "XRP");
    expect(odd.rows.map((r) => r.fields)).toEqual([[], []]);
  });
});

describe("the lists of the tabs", () => {
  const ctx = (over = {}) => ({ net: "xrpl" as const, native: "XRP" as const, address: XRPL, back: [] as string[], ...over });

  it("pages the transactions by the API's marker: Older on the first page, Newer and Older after it", () => {
    const first = transactionsList(read(`xrpl/data-api/accounts/${XRPL}/transactions@descending=true&limit=20.json`), ctx());
    expect(first).toMatchObject({ state: "ok", tab: "transactions", paging: { newerHref: null, olderHref: `/xrpl/account/${XRPL}?marker=WzEwNzYxMjU3MywyNV0` } });
    expect(first.state === "ok" && first.tab === "transactions" && first.rows).toHaveLength(4);

    const second = transactionsList(read(`xrpl/data-api/accounts/${XRPL}/transactions@descending=true&limit=20&marker=WzEwNzYxMjU3MywyNV0.json`), ctx({ marker: "WzEwNzYxMjU3MywyNV0" }));
    expect(second).toMatchObject({ paging: { newerHref: `/xrpl/account/${XRPL}`, olderHref: null } });
  });

  it("gives the payments a link to the explorer's own CSV, the same on every page of the list", () => {
    const first = paymentsList(read(`xrpl/data-api/accounts/${XRPL}/payments@descending=true&limit=20.json`), ctx());
    expect(first).toMatchObject({ tab: "payments", csvHref: `/xrpl/account/${XRPL}/payments.csv`, paging: { olderHref: `/xrpl/account/${XRPL}?tab=payments&marker=WzEwNzYzNjY3Myw3OF0` } });
    const second = paymentsList(read(`xrpl/data-api/accounts/${XRPL}/payments@descending=true&limit=20&marker=WzEwNzYzNjY3Myw3OF0.json`), ctx({ marker: "WzEwNzYzNjY3Myw3OF0" }));
    expect(second).toMatchObject({ csvHref: `/xrpl/account/${XRPL}/payments.csv`, paging: { newerHref: `/xrpl/account/${XRPL}?tab=payments`, olderHref: null } });
  });

  it("pages the trades, and says so when there are none", () => {
    const first = tradesList(read(`xrpl/data-api/accounts/${XRPL}/exchanges@descending=true&limit=20.json`), ctx());
    expect(first).toMatchObject({ tab: "trades", paging: { olderHref: `/xrpl/account/${XRPL}?tab=trades&marker=WzEwNzcyMDExNSw1MV0` } });
    expect(tradesList({ result: "success", count: 0, exchanges: [] }, ctx())).toMatchObject({ rows: [], paging: { newerHref: null, olderHref: null } });
  });

  it("reads the offers live, with the ledger they were read at, and has no paging", () => {
    expect(offersList({ result: "success", ledger_index: 107721455, limit: 200, orders: [] })).toEqual({ state: "ok", tab: "offers", rows: [], ledgerIndex: 107721455, truncated: false });
    expect(offersList({ result: "success", orders: [] })).toMatchObject({ ledgerIndex: null, truncated: false });
  });

  it("says the offers may be more than it shows when the API filled the limit it was asked for (200 unless it says), as tokens do", () => {
    const offer = (sequence: number) => ({
      specification: { direction: "sell" as const, quantity: { currency: "XRP", value: "1" }, totalPrice: { currency: "USD", value: "2", counterparty: "rI" } },
      properties: { maker: XRPL, flags: 0, sequence },
    });
    const orders = (count: number, limit?: number) => ({ result: "success" as const, ledger_index: 5, ...(limit === undefined ? {} : { limit }), orders: Array.from({ length: count }, (_, i) => offer(i + 1)) });
    expect(offersList(orders(200, 200))).toMatchObject({ truncated: true });
    expect(offersList(orders(200))).toMatchObject({ truncated: true }); // no limit in the answer: the API's default is 200
    expect(offersList(orders(199, 200))).toMatchObject({ truncated: false });
    expect(offersList(orders(250, 400))).toMatchObject({ truncated: false });
    expect(offersList(orders(400, 400))).toMatchObject({ truncated: true });
    expect(offersList(orders(0, 200))).toMatchObject({ truncated: false });
  });

  it("lists the objects of the first page, and says when the node had more than that", () => {
    const objects = objectsOf("xrpl", XRPL);
    expect(objectsList(objects, "XRP")).toEqual({ state: "ok", tab: "objects", rows: [], trustLines: 1, offers: 0, truncated: false, ledgerIndex: 107721455 });
    expect(objectsList({ ...objects, marker: "MORE" }, "XRP")).toMatchObject({ truncated: true });
    // A deleted account has none to read.
    expect(objectsList(null, "XRP")).toEqual({ state: "ok", tab: "objects", rows: [], trustLines: 0, offers: 0, truncated: false, ledgerIndex: null });
  });

  it("names the section that failed after the tab it is for", () => {
    expect(failedList("transactions")).toEqual({ state: "failed", what: "transactions" });
    expect(failedList("payments")).toEqual({ state: "failed", what: "payments" });
    expect(failedList("trades")).toEqual({ state: "failed", what: "trades" });
    expect(failedList("offers")).toEqual({ state: "failed", what: "offers" });
    // The analytics view is no list; its whole-view error says "Couldn't load the analytics."
    expect(TAB_WHAT.analytics).toBe("the analytics");
  });
});
