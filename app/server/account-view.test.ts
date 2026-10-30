import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Segment } from "../domain/describe";
import { NO_NAMES } from "../domain/names";
import { nftSample, nftsPageSample, uriTokenSample, NFT_MARKER, NFT_OWNER, OTHER_ISSUER, URI_TOKEN_ID, URI_TOKEN_ISSUER } from "../../test/support/nft-samples";
import { DELEGATE, DELEGATOR, delegationsSample } from "../../test/support/object-samples";
import type { AccountData, AccountExchange, BalancesResponse, NftsPage, OrdersResponse, Payment, TxObject } from "./api-types";
import {
  ACCOUNT_TABS,
  accountFlags,
  accountHeader,
  accountHref,
  decodeDomain,
  delegationList,
  DELEGATIONS_LIMIT,
  DELEGATIONS_WORD,
  existenceOf,
  failedList,
  headerAccounts,
  isAccountTab,
  listAddresses,
  loaded,
  objectRows,
  nftsList,
  objectsList,
  offerRows,
  offersList,
  ownedCounts,
  PAGED_TABS,
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
  type AccountHeader,
  type Loaded,
  type TabList,
  type TxRow,
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

const text = (segments: readonly Segment[]) => segments.map((s) => (s.t === "text" ? s.v : s.t === "account" ? `<${s.v}>` : s.t === "amount" ? `{${s.value} ${s.currency}}` : s.t === "nft" ? `<NFT ${s.v}>` : `[${s.pair}]`)).join("");

describe("the tabs and the URL", () => {
  it("lists the eight tabs of the page, the first being the default, the NFTs and the delegation before the last, and the last the analytics", () => {
    expect(ACCOUNT_TABS).toEqual(["transactions", "payments", "trades", "offers", "objects", "nfts", "delegation", "analytics"]);
    for (const tab of ACCOUNT_TABS) expect(isAccountTab(tab)).toBe(true);
    for (const other of ["Analytics", "NFTs", "Delegation", "delegations", "", "Transactions", "tx", "constructor", "__proto__", null, undefined, 1]) expect(isAccountTab(other), String(other)).toBe(false);
  });

  it("pages the lists that are read from the data API by marker, the NFTs' among them, and not the offers, the objects or the delegations, which have one page", () => {
    expect([...PAGED_TABS]).toEqual(["transactions", "payments", "trades", "nfts"]);
  });

  it("names the tab in the URL as it names the others, and asks the API for at most 200 delegations of each direction", () => {
    expect(accountHref("xrpl", XRPL, { tab: "delegation" })).toBe(`/xrpl/account/${XRPL}?tab=delegation`);
    expect(DELEGATIONS_LIMIT).toBe(200);
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
    expect(accountHref("xrpl", XRPL, { tab: "nfts" })).toBe(`/xrpl/account/${XRPL}?tab=nfts`);
    expect(accountHref("xahau", XAHAU, { tab: "nfts", marker: "M2", back: ["M1"] })).toBe(`/xahau/account/${XAHAU}?tab=nfts&marker=M2&back=M1`);
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

  it("counts the one trust line of the recorded XRPL account, and the ledger-object pages' escrow, check, channel and delegation (C7)", () => {
    expect(ownedCounts(objectsOf("xrpl", XRPL).account_objects)).toEqual([
      { type: "RippleState", label: "trust line", count: 1 },
      { type: "Escrow", label: "escrow", count: 1 },
      { type: "Check", label: "check", count: 1 },
      { type: "PayChannel", label: "payment channel", count: 1 },
      { type: "Delegate", label: "Delegate", count: 1 },
    ]);
  });

  it("says URIToken, the glossary's word, and not 'URI token' (decision 18), in the singular and the plural", () => {
    expect(ownedCounts([object("URIToken")])).toEqual([{ type: "URIToken", label: "URIToken", count: 1 }]);
    expect(ownedCounts([object("URIToken"), object("URIToken"), object("NFTokenOffer")])).toEqual([
      { type: "NFTokenOffer", label: "NFT offer", count: 1 },
      { type: "URIToken", label: "URITokens", count: 2 },
    ]);
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
      // the fixture's `Domain` (E9: the domain its toml verifies, scripts/names-fixtures.ts)
      domain: "northpeak.example",
      lastActive: { ledgerIndex: 107720688, hash: "C7FE6468BA25CE904C41722C0892316954133B000339C644073A88CACD8A9143", time: 1792253462 },
    });
    // It owns four objects: its trust line, and the ledger-object pages' escrow, channel and delegation (scripts/object-fixtures.ts, C7).
    expect(header.balance).toEqual({
      native: "10.001625",
      available: "8.201625",
      reserve: { total: "1.8", base: "1", increment: "0.2", objects: 4 },
    });
    expect(header.tokens.state).toBe("ok");
    expect(header.owned).toEqual({
      counts: [
        { type: "RippleState", label: "trust line", count: 1 },
        { type: "Escrow", label: "escrow", count: 1 },
        { type: "Check", label: "check", count: 1 },
        { type: "PayChannel", label: "payment channel", count: 1 },
        { type: "Delegate", label: "Delegate", count: 1 },
      ],
      truncated: false,
    });
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
      reserve: { total: "18", base: "10", increment: "2", objects: 4 },
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

  it("needs the objects and the balances for a header with its holdings, as it has by default", () => {
    const { objects: _objects, ...withoutObjects } = input();
    const { balances: _balances, ...withoutBalances } = input();
    expect(() => accountHeader(withoutObjects)).toThrow(/objects/);
    expect(() => accountHeader(withoutBalances, { holdings: true })).toThrow(/balances/);
  });

  describe("without its holdings (the analytics view, spec 2.1)", () => {
    /** The header's input with neither the node's objects nor the index's balances: the view asks for neither. */
    const bare = (over: Partial<Parameters<typeof accountHeader>[0]> = {}) => {
      const { objects: _objects, balances: _balances, ...rest } = input(over);
      return rest;
    };

    it("has no owned objects and no tokens, and says nothing is missing", () => {
      const { header, problems } = accountHeader(bare(), { holdings: false });
      expect(problems).toEqual([]);
      expect(header.owned).toBeNull();
      expect(header.tokens).toEqual({ state: "none" });
      expect(header.nodeProblem).toBe(false);
    });

    it("keeps the rest of the header: the activation, the live state and the balance with its reserve", () => {
      const full = accountHeader(input()).header;
      const { header } = accountHeader(bare(), { holdings: false });
      expect(header.status).toBe("active");
      expect(header.activation).toEqual(full.activation);
      expect(header.live).toEqual(full.live);
      expect(header.balance).toEqual(full.balance);
    });

    it("reads neither the objects nor the balances when they are given", () => {
      const { header, problems } = accountHeader(input({ objects: FAILED, balances: FAILED }), { holdings: false });
      expect(problems).toEqual([]);
      expect(header.owned).toBeNull();
      expect(header.tokens).toEqual({ state: "none" });
    });

    it("has no balance when the node does not answer, which the page shows as 'The balance could not be read.'", () => {
      const { header, problems } = accountHeader(bare({ info: FAILED, state: FAILED }), { holdings: false });
      expect(header.live).toEqual({ state: "unavailable" });
      expect(header.balance).toBeNull();
      expect(header.owned).toBeNull();
      expect(header.tokens).toEqual({ state: "none" });
      expect(header.nodeProblem).toBe(true);
      expect(problems).toEqual(["node account_info failed", "node server_state failed"]);
    });

    it("is a deleted account as with its holdings", () => {
      const { header, problems } = accountHeader(bare({ created: ok(created("xrpl", "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC")), info: MISSING }), { holdings: false });
      expect(problems).toEqual([]);
      expect(header).toMatchObject({ status: "deleted", live: { state: "none" }, balance: null, tokens: { state: "none" }, owned: null });
    });
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

describe("objectRows: the NFT objects", () => {
  const NFT = "00081388AF09C1D4B4D1E8031467F3508DFFADABEA73255F370449870655E6D8";
  const RIPPLE = 946_684_800;
  const page: LedgerObject = { LedgerEntryType: "NFTokenPage", index: "N1", NFTokens: Array.from({ length: 32 }, () => ({})), PreviousTxnID: "AB".repeat(32) };
  const NFTS_HREF = `/xrpl/account/${XRPL}?tab=nfts`;
  const only = (objects: LedgerObject[], native: "XRP" | "XAH" = "XRP", href?: string) => objectRows(objects, native, href).rows;

  it("keeps 'NFTs: 32' of an NFT page and links to the account's NFTs when it is given the link", () => {
    const [row] = only([page], "XRP", NFTS_HREF);
    expect(row!.fields).toEqual([{ label: "NFTs", value: [{ t: "text", v: "32" }] }]);
    expect(row!.link).toEqual({ label: "See the account’s NFTs", href: NFTS_HREF });
  });

  it("has no link without it: NFTS is off, or nothing was given", () => {
    const [row] = only([page]);
    expect(row!.fields).toEqual([{ label: "NFTs", value: [{ t: "text", v: "32" }] }]);
    expect(row!.link).toBeUndefined();
    expect("link" in row!).toBe(false);
  });

  it("links from an NFT page only: no other object has the link", () => {
    const rows = only([page, { LedgerEntryType: "Ticket", index: "T1", TicketSequence: 5 }, { LedgerEntryType: "NFTokenOffer", index: "F1", NFTokenID: NFT, Flags: 1, Amount: "1" }], "XRP", NFTS_HREF);
    expect(rows.map((row) => [row.type, row.link?.href])).toEqual([
      ["NFTokenPage", NFTS_HREF],
      ["Ticket", undefined],
      ["NFTokenOffer", undefined],
    ]);
  });

  describe("an NFT offer", () => {
    const offer = (over: Record<string, unknown> = {}): LedgerObject => ({
      LedgerEntryType: "NFTokenOffer",
      index: "F1",
      NFTokenID: NFT,
      Owner: XRPL,
      Flags: 1,
      Amount: "25000000",
      Destination: "rBroker",
      Expiration: 1792000000 - RIPPLE,
      PreviousTxnID: "CD".repeat(32),
      ...over,
    });
    const fields = (row: LedgerObject) => only([row])[0]!.fields.map((f) => `${f.label}: ${text(f.value)}`);

    it("names the NFT as an nft segment of its NFTokenID, the side, the amount, who it is only for and when it expires, in that order", () => {
      const [row] = only([offer()]);
      expect(row!.fields.map((f) => f.label)).toEqual(["NFT", "Side", "Amount", "Only for", "Expires"]);
      expect(row!.fields[0]!.value).toEqual([{ t: "nft", v: NFT }]);
      expect(fields(offer())).toEqual([`NFT: <NFT ${NFT}>`, "Side: Sell", "Amount: {25 XRP}", "Only for: <rBroker>", "Expires: 2026-10-14 17:46:40 UTC"]);
      expect(row!.tx).toBe("CD".repeat(32));
      expect(row!.key).toBe("F1");
    });

    it("is a sell offer when the lsfSellNFToken bit (1) of its flags is set, and a buy offer when it is not, whatever the other bits say", () => {
      const side = (Flags: unknown) => only([offer({ Flags })])[0]!.fields[1]!.value;
      expect(side(1)).toEqual([{ t: "text", v: "Sell" }]);
      expect(side(0)).toEqual([{ t: "text", v: "Buy" }]);
      expect(side(3)).toEqual([{ t: "text", v: "Sell" }]);
      expect(side(2)).toEqual([{ t: "text", v: "Buy" }]);
      // The bit is the whole of it: a flags that is no number is no side.
      expect(only([offer({ Flags: undefined })])[0]!.fields.map((f) => f.label)).toEqual(["NFT", "Amount", "Only for", "Expires"]);
    });

    it("shows an issued amount with its issuer, and leaves out what the offer does not have", () => {
      const issued = offer({ Amount: { currency: "USD", issuer: "rIssuer", value: "12.50" }, Destination: undefined, Expiration: undefined });
      expect(fields(issued)).toEqual([`NFT: <NFT ${NFT}>`, "Side: Sell", "Amount: {12.50 USD}"]);
      expect(only([issued])[0]!.fields[2]!.value).toEqual([{ t: "amount", value: "12.50", currency: "USD", issuer: "rIssuer" }]);
    });

    it("writes the id as the node did, in capitals, and leaves out an id that is none: it would be a link to nothing", () => {
      expect(only([offer({ NFTokenID: NFT.toLowerCase() })])[0]!.fields[0]!.value).toEqual([{ t: "nft", v: NFT }]);
      for (const NFTokenID of ["nope", NFT.slice(1), `${NFT}0`, 5, undefined]) {
        expect(only([offer({ NFTokenID })])[0]!.fields.map((f) => f.label), String(NFTokenID)).not.toContain("NFT");
      }
    });

    it("carries none of the node's raw fields", () => {
      const json = JSON.stringify(only([offer()]));
      for (const word of ["LedgerEntryType", "NFTokenID", "Destination", "Expiration", "PreviousTxnID", "Owner"]) expect(json).not.toContain(word);
    });
  });

  describe("a URIToken", () => {
    const TOKEN = "9613336614047483F3AEC00173139D88FE9BA70720CAC2B46E12711A71A9AAE9";
    const token = (over: Record<string, unknown> = {}): LedgerObject => ({
      LedgerEntryType: "URIToken",
      index: TOKEN,
      Issuer: "rIssuer",
      Owner: XAHAU,
      URI: "68747470733A2F2F",
      Digest: "AA".repeat(32),
      Flags: 0,
      PreviousTxnID: "EF".repeat(32),
      ...over,
    });
    const fields = (row: LedgerObject) => only([row], "XAH")[0]!.fields.map((f) => `${f.label}: ${text(f.value)}`);

    it("names the token as an nft segment of its index and its issuer, and has no sell offer to show when it has none", () => {
      expect(fields(token())).toEqual([`URIToken: <NFT ${TOKEN}>`, "Issuer: <rIssuer>"]);
      const [row] = only([token()], "XAH");
      expect(row!.fields.map((f) => f.label)).toEqual(["URIToken", "Issuer"]);
      expect(row!.fields[0]!.value).toEqual([{ t: "nft", v: TOKEN }]);
      expect(row!.fields[1]!.value).toEqual([{ t: "account", v: "rIssuer" }]);
      expect(row!.key).toBe(TOKEN);
      expect(row!.tx).toBe("EF".repeat(32));
    });

    it("shows the sell offer: its amount, and 'only for' the account it is offered to", () => {
      const offered = token({ Amount: "1500000000", Destination: "rBuyer" });
      expect(fields(offered)).toEqual([`URIToken: <NFT ${TOKEN}>`, "Issuer: <rIssuer>", "Sell offer: {1500 XAH}, only for <rBuyer>"]);
      expect(only([offered], "XAH")[0]!.fields[2]!.value).toEqual([
        { t: "amount", value: "1500", currency: "XAH" },
        { t: "text", v: ", only for " },
        { t: "account", v: "rBuyer" },
      ]);
    });

    it("shows a sell offer to anyone as its amount alone, and an issued amount with its issuer", () => {
      expect(fields(token({ Amount: "1500000000" }))).toEqual([`URIToken: <NFT ${TOKEN}>`, "Issuer: <rIssuer>", "Sell offer: {1500 XAH}"]);
      expect(only([token({ Amount: { currency: "EVR", issuer: "rEvr", value: "30" } })], "XAH")[0]!.fields[2]!.value).toEqual([{ t: "amount", value: "30", currency: "EVR", issuer: "rEvr" }]);
    });

    it("shows no sell offer for an amount it has no shape for, and never throws on a malformed token", () => {
      expect(fields(token({ Amount: { mpt_issuance_id: "x", value: "1" }, Destination: "rBuyer" }))).toEqual([`URIToken: <NFT ${TOKEN}>`, "Issuer: <rIssuer>"]);
      expect(only([{ LedgerEntryType: "URIToken" }], "XAH")[0]!.fields).toEqual([]);
      expect(only([{ LedgerEntryType: "NFTokenOffer" }])[0]!.fields).toEqual([]);
    });

    it("has no link to the account's NFTs: only the NFT page has it", () => {
      expect(only([token()], "XAH", `/xahau/account/${XAHAU}?tab=nfts`)[0]!.link).toBeUndefined();
    });
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
    expect(offersList({ result: "success", ledger_index: 107721455, limit: 200, orders: [] })).toEqual({ state: "ok", tab: "offers", rows: [], ledgerIndex: 107721455, truncated: false, names: NO_NAMES });
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
    const list = objectsList(objects, "XRP");
    expect(list).toMatchObject({ state: "ok", tab: "objects", trustLines: 1, offers: 0, truncated: false, ledgerIndex: 107721455, names: NO_NAMES });
    // A row for each of the ledger-object pages' objects of the account (scripts/object-fixtures.ts, C7).
    expect(list.state === "ok" && list.tab === "objects" ? list.rows.map((row) => row.type) : []).toEqual(["Escrow", "Check", "PayChannel", "Delegate"]);
    expect(objectsList({ ...objects, marker: "MORE" }, "XRP")).toMatchObject({ truncated: true });
    // A deleted account has none to read.
    expect(objectsList(null, "XRP")).toEqual({ state: "ok", tab: "objects", rows: [], trustLines: 0, offers: 0, truncated: false, ledgerIndex: null, names: NO_NAMES });
  });

  describe("the NFTs", () => {
    const rows = (list: ReturnType<typeof nftsList>) => (list.state === "ok" && list.tab === "nfts" ? list.rows : []);
    const first = (page: Partial<NftsPage> = {}, over = {}) => nftsList(nftsPageSample(page), ctx(over));

    it("lists what the recorded account holds in the order the API gave, a row for each, with the glyph and the collection", () => {
      const page: NftsPage = read(`xrpl/data-api/accounts/${XRPL}/nfts@limit=20.json`);
      const list = nftsList(page, ctx());
      expect(list).toMatchObject({ state: "ok", tab: "nfts", paging: { newerHref: null, olderHref: null }, coverage: null });
      expect(rows(list).map((row) => row.nft.id)).toEqual(page.nfts.map((nft) => nft.nft_id));
      for (const [at, row] of rows(list).entries()) {
        const nft = page.nfts[at]!;
        expect(row.key).toBe(nft.nft_id);
        expect(row.nft).toEqual({ id: nft.nft_id, serial: nft.serial, glyph: String(nft.serial).padStart(2, "0").slice(-2) });
        expect(row.collection).toEqual({ label: `${nft.issuer.slice(0, 6)}…${nft.issuer.slice(-4)} · taxon ${nft.taxon}`, key: { issuer: nft.issuer, taxon: nft.taxon } });
      }
    });

    it("renders in the API's order and never sorts the page: serials and issuers out of order stay where they are", () => {
      const nfts = [
        nftSample({ nft_id: "B".repeat(64), serial: 9, issuer: OTHER_ISSUER, taxon: 2 }),
        nftSample({ nft_id: "A".repeat(64), serial: 100, issuer: OTHER_ISSUER, taxon: 1 }),
        nftSample({ nft_id: "C".repeat(64), serial: 3, issuer: URI_TOKEN_ISSUER, taxon: 0 }),
      ];
      expect(rows(first({ nfts, count: 3 })).map((row) => row.nft.serial)).toEqual([9, 100, 3]);
    });

    it("shows the last sale as the price in its own currency, with no conversion: an account's list has none, and the row has no field for one", () => {
      const nfts = [
        nftSample({ nft_id: "1".repeat(64), last_sale: { amount: "20", currency: "XRP", executed_time: "2026-10-25T04:47:41Z", ledger_index: 5, tx_hash: "AB".repeat(32) } }),
        nftSample({ nft_id: "2".repeat(64), last_sale: { amount: "1.50", currency: "USD", amount_issuer: "rIssuer", converted_amount: "3", executed_time: "2026-10-25T04:47:41Z", ledger_index: 5, tx_hash: "AB".repeat(32) } }),
        nftSample({ nft_id: "3".repeat(64), last_sale: undefined }),
      ];
      const [native, issued, none] = rows(first({ nfts, count: 3 }));
      expect(native!.lastSale).toEqual({ value: "20", currency: "XRP" });
      expect(issued!.lastSale).toEqual({ value: "1.50", currency: "USD", issuer: "rIssuer" });
      expect(none!.lastSale).toBeNull();
      expect(JSON.stringify(rows(first({ nfts, count: 3 })))).not.toMatch(/converted|≈/);
    });

    it("gives the day of the mint, and a dash when the mint is not in the index", () => {
      const nfts = [nftSample({ nft_id: "1".repeat(64), minted: { by: NFT_OWNER, to: NFT_OWNER, ledger_index: 5, tx_hash: "AB".repeat(32), executed_time: "2026-10-25T02:00:52Z" } }), nftSample({ nft_id: "2".repeat(64), minted: undefined })];
      expect(rows(first({ nfts, count: 2 })).map((row) => row.minted)).toEqual(["Oct 25, 2026", "—"]);
    });

    it("keys a Xahau URIToken's collection by its issuer alone, and its row has no serial", () => {
      const [row] = rows(nftsList(nftsPageSample({ nfts: [uriTokenSample()] }), ctx({ net: "xahau", native: "XAH" })));
      expect(row).toEqual({
        key: URI_TOKEN_ID,
        nft: { id: URI_TOKEN_ID, glyph: URI_TOKEN_ID.slice(0, 2) },
        collection: { label: `${URI_TOKEN_ISSUER.slice(0, 6)}…${URI_TOKEN_ISSUER.slice(-4)}`, key: { issuer: URI_TOKEN_ISSUER } },
        lastSale: { value: "4200", currency: "XAH" },
        minted: "—",
      });
      expect("serial" in row!.nft).toBe(false);
    });

    it("pages by the API's marker: Older on the first page, with the tab in its URL, and Newer and Older after it", () => {
      expect(first()).toMatchObject({ paging: { newerHref: null, olderHref: `/xrpl/account/${XRPL}?tab=nfts&marker=${NFT_MARKER}` } });
      expect(first({ marker: undefined })).toMatchObject({ paging: { newerHref: null, olderHref: null } });
      expect(first({ marker: "M3" }, { marker: "M2", back: ["M1"] })).toMatchObject({
        paging: { newerHref: `/xrpl/account/${XRPL}?tab=nfts&marker=M1`, olderHref: `/xrpl/account/${XRPL}?tab=nfts&marker=M3&back=M2.M1` },
      });
      expect(first({ marker: undefined }, { marker: "M1" })).toMatchObject({ paging: { newerHref: `/xrpl/account/${XRPL}?tab=nfts`, olderHref: null } });
    });

    it("has no rows for an account that holds none, and says nothing of coverage when it is whole", () => {
      // The deleted account's recorded list: an empty page of a whole coverage.
      const list = nftsList(read("xrpl/data-api/accounts/r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC/nfts@limit=20.json"), ctx());
      expect(list).toEqual({ state: "ok", tab: "nfts", rows: [], paging: { newerHref: null, olderHref: null }, coverage: null, names: NO_NAMES });
    });

    it("says what an incomplete coverage leaves out, in the network's words: NFTs, or URITokens", () => {
      const note = (net: "xrpl" | "xahau") => nftsList(nftsPageSample({ nfts: [], count: 0, marker: undefined, coverage: { complete: false, from_ledger_index: 96100001 } }), ctx({ net, native: net === "xahau" ? "XAH" : "XRP" }));
      expect(note("xrpl")).toMatchObject({ coverage: { before: "Covers ledger ", ledger: 96100001, after: " onwards: earlier NFTs are not in the index yet." } });
      expect(note("xahau")).toMatchObject({ coverage: { before: "Covers ledger ", ledger: 96100001, after: " onwards: earlier URITokens are not in the index yet." } });
      expect(first({ coverage: { complete: true } })).toMatchObject({ coverage: null });
      expect(nftsList(read(`xahau/data-api/accounts/${XAHAU}/nfts@limit=20.json`), ctx({ net: "xahau", native: "XAH", address: XAHAU }))).toMatchObject({ coverage: { ledger: 26533927 } });
    });

    it("carries nothing of the API's raw fields: no flags, uri, owner or history", () => {
      const json = JSON.stringify(first());
      for (const word of ["flags", "transfer_fee", "owner_since", "sale_count", "executed_time", "nftoken"]) expect(json).not.toContain(word);
    });
  });

  it("names the section that failed after the tab it is for", () => {
    expect(failedList("transactions")).toEqual({ state: "failed", what: "transactions" });
    expect(failedList("payments")).toEqual({ state: "failed", what: "payments" });
    expect(failedList("trades")).toEqual({ state: "failed", what: "trades" });
    expect(failedList("offers")).toEqual({ state: "failed", what: "offers" });
    expect(failedList("nfts")).toEqual({ state: "failed", what: "NFTs" });
    expect(failedList("delegation")).toEqual({ state: "failed", what: "delegations" });
    // The word is written once, in the domain file the page's loading line reads too.
    expect(TAB_WHAT.delegation).toBe(DELEGATIONS_WORD);
    expect(DELEGATIONS_WORD).toBe("delegations");
    expect(TAB_WHAT.nfts).toBe("NFTs");
    // The words of a network are its own: Xahau's tokens are URITokens.
    expect(failedList("nfts", "xrpl")).toEqual({ state: "failed", what: "NFTs" });
    expect(failedList("nfts", "xahau")).toEqual({ state: "failed", what: "URITokens" });
    expect(failedList("payments", "xahau")).toEqual({ state: "failed", what: "payments" });
    // The analytics view is no list; its whole-view error says "Couldn't load the analytics."
    expect(TAB_WHAT.analytics).toBe("the analytics");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The accounts the page draws, for their names (display names spec 1 and 5)

describe("the accounts the page draws", () => {
  const ctx = { net: "xrpl" as const, native: "XRP" as const, address: XRPL, back: [] as string[] };
  const PAGING = { newerHref: null, olderHref: null };
  const txRow = (what: Segment[]): TxRow => ({ hash: "AB".repeat(32), ledgerIndex: 1, time: 0, type: "Payment", what, change: null, ok: true, code: "tesSUCCESS" });

  describe("listAddresses: the accounts a tab's list draws as links", () => {
    it("is the accounts of the transactions' sentences, each once in the order drawn: not a pool's account (a link to the pool) or an amount's issuer (a title)", () => {
      const list: TabList = {
        state: "ok",
        tab: "transactions",
        rows: [
          txRow([{ t: "account", v: "rSender" }, { t: "text", v: " sent " }, { t: "amount", value: "1", currency: "USD", issuer: "rIssuer" }, { t: "text", v: " to " }, { t: "account", v: "rTo" }]),
          txRow([{ t: "text", v: "Swapped through " }, { t: "pool", v: "rPool", pair: "XRP/USD" }, { t: "text", v: " for " }, { t: "account", v: "rSender" }]),
          txRow([{ t: "text", v: "Burned " }, { t: "nft", v: "00".repeat(32) }]),
        ],
        paging: PAGING,
        names: NO_NAMES,
      };
      expect(listAddresses(list)).toEqual(["rSender", "rTo"]);
    });

    it("is what the recorded list's sentences draw: the sender of another account's transaction, and the account itself where a sentence names it", () => {
      const list = transactionsList(read(`xrpl/data-api/accounts/${XRPL}/transactions@descending=true&limit=20.json`), ctx);
      const senders = list.state === "ok" && list.tab === "transactions" ? list.rows.flatMap((row) => row.what.filter((s) => s.t === "account").map((s) => (s as { v: string }).v)) : [];
      expect(senders.length).toBeGreaterThan(0);
      expect(listAddresses(list)).toEqual([...new Set(senders)]);
      expect(listAddresses(list)[0]).toMatch(/^rDFDjd/);
      expect(listAddresses(list)).toContain(XRPL);
    });

    it("is the counterparty of each payment and of each trade, and no issuer of their amounts or pairs", () => {
      const payments = paymentsList(read(`xahau/data-api/accounts/${XAHAU}/payments@descending=true&limit=20.json`), { ...ctx, net: "xahau", native: "XAH", address: XAHAU });
      const paid = payments.state === "ok" && payments.tab === "payments" ? payments.rows : [];
      expect(paid.some((row) => row.amount.issuer !== undefined)).toBe(true);
      expect(listAddresses(payments)).toEqual([...new Set(paid.map((row) => row.counterparty))]);

      const trades = tradesList(read(`xrpl/data-api/accounts/${XRPL}/exchanges@descending=true&limit=20.json`), ctx);
      const traded = trades.state === "ok" && trades.tab === "trades" ? trades.rows : [];
      expect(traded.some((row) => row.amount.issuer !== undefined)).toBe(true);
      expect(listAddresses(trades)).toEqual([...new Set(traded.map((row) => row.counterparty))]);
      for (const row of traded) expect(listAddresses(trades)).not.toContain(row.amount.issuer);
    });

    it("is the accounts of the objects' fields (To, Only for, Issuer, Authorized, a sell offer's only for), and no amount's issuer", () => {
      const objects = objectsList(
        {
          account: XRPL,
          ledger_index: 5,
          validated: true,
          account_objects: [
            { LedgerEntryType: "Escrow", index: "E1", Amount: "1000000", Destination: "rEscrowTo" },
            { LedgerEntryType: "Check", index: "C1", SendMax: { currency: "USD", issuer: "rCheckIssuer", value: "5" }, Destination: "rCheckTo" },
            { LedgerEntryType: "NFTokenOffer", index: "N1", Amount: "5", Destination: "rOnlyFor", Flags: 1 },
            { LedgerEntryType: "URIToken", index: "U1", Issuer: "rUriIssuer", Amount: { currency: "EVR", issuer: "rEvr", value: "3" }, Destination: "rBuyer" },
            { LedgerEntryType: "DepositPreauth", index: "D1", Authorize: "rFriend" },
            { LedgerEntryType: "PayChannel", index: "P1", Amount: "5", Balance: "1", Destination: "rEscrowTo" },
          ],
        },
        "XRP",
      );
      expect(listAddresses(objects)).toEqual(["rEscrowTo", "rCheckTo", "rOnlyFor", "rUriIssuer", "rBuyer", "rFriend"]);
    });

    it("is the delegates of the given list, then the accounts of the held one, each once in the order drawn", () => {
      const row = (account: string, authorize: string) => ({ ...delegationsSample().delegations[0]!, account, authorize });
      const list = delegationList(
        delegationsSample({ delegations: [row(XRPL, DELEGATE), row(XRPL, "rSecondDelegate")], count: 2 }),
        delegationsSample({ delegations: [row(DELEGATOR, XRPL), row("rSecondDelegate", XRPL), row(DELEGATE, XRPL)], count: 3 }),
      );
      expect(list).toMatchObject({ state: "ok", tab: "delegation", names: NO_NAMES });
      // The account itself is in no row (it is the header's), a delegate that is also a delegator is drawn once.
      expect(listAddresses(list)).toEqual([DELEGATE, "rSecondDelegate", DELEGATOR]);
      expect(listAddresses(delegationList(delegationsSample({ delegations: [], count: 0 }), delegationsSample({ delegations: [], count: 0 })))).toEqual([]);
    });

    it("is none for the open offers and the NFTs, which draw no account, and for a list that failed", () => {
      const offers = offersList({
        result: "success",
        orders: [{ specification: { direction: "sell", quantity: { currency: "XRP", value: "1" }, totalPrice: { currency: "USD", value: "2", counterparty: "rI" } }, properties: { maker: XRPL, flags: 0, sequence: 1 } }],
      });
      expect(listAddresses(offers)).toEqual([]);
      expect(listAddresses(nftsList(nftsPageSample(), ctx))).toEqual([]);
      expect(listAddresses(failedList("transactions"))).toEqual([]);
    });
  });

  describe("headerAccounts: the accounts the header draws", () => {
    const tokens = (...items: Array<{ issuer: string; lp: boolean }>): AccountHeader["tokens"] => ({
      state: "ok",
      truncated: false,
      items: items.map(({ issuer, lp }) => ({ currency: lp ? `03${"AB".repeat(19)}` : "USD", issuer, value: "1", lp })),
    });
    const activation = { time: 0, parent: "rParent", initialBalance: "25", txHash: "AB".repeat(32) };

    it("is the address, the parent of its activation and the issuers of its tokens, in that order", () => {
      expect(headerAccounts(XRPL, { activation, tokens: tokens({ issuer: "rUsd", lp: false }, { issuer: "rEur", lp: false }) }, { ammPages: true })).toEqual([XRPL, "rParent", "rUsd", "rEur"]);
    });

    it("has an LP token's pool only while AMM_PAGES is off: on, the page links the pool's page, not its account", () => {
      const header = { activation, tokens: tokens({ issuer: "rUsd", lp: false }, { issuer: "rPool", lp: true }) };
      expect(headerAccounts(XRPL, header, { ammPages: true })).toEqual([XRPL, "rParent", "rUsd"]);
      expect(headerAccounts(XRPL, header, { ammPages: false })).toEqual([XRPL, "rParent", "rUsd", "rPool"]);
    });

    it("is the address alone without an activation or tokens (a genesis account, a deleted one, the analytics view)", () => {
      expect(headerAccounts(XRPL, { activation: null, tokens: { state: "none" } }, { ammPages: true })).toEqual([XRPL]);
      expect(headerAccounts(XRPL, { activation: null, tokens: { state: "failed" } }, { ammPages: true })).toEqual([XRPL]);
    });
  });

  it("has every list builder give its list no names: the loader names it", () => {
    const lists = [
      transactionsList(read(`xrpl/data-api/accounts/${XRPL}/transactions@descending=true&limit=20.json`), ctx),
      paymentsList(read(`xrpl/data-api/accounts/${XRPL}/payments@descending=true&limit=20.json`), ctx),
      tradesList(read(`xrpl/data-api/accounts/${XRPL}/exchanges@descending=true&limit=20.json`), ctx),
      offersList({ result: "success", orders: [] }),
      objectsList(null, "XRP"),
      nftsList(nftsPageSample(), ctx),
    ];
    for (const list of lists) expect(list.state === "ok" && list.names).toBe(NO_NAMES);
  });
});
