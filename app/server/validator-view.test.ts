import { describe, expect, it } from "vitest";

import {
  amendmentsSample,
  SAMPLE_KEYS,
  SAMPLE_SIGNING_KEYS,
  summarySample,
  UNKNOWN_ID,
  validationsSample,
  validatorDetailSample,
  XCB_ID,
} from "../../test/support/d1-samples";
import { tokenOf } from "../domain/fnv";
import { shortHash } from "../domain/format";
import type { NetworkInfo } from "../ui/networks";
import type { Loaded } from "./account-view";
import type { Anchor } from "./anchor";
import type { DomainVerification, ValidatorDetail, ValidatorsSummary, ValidatorValidation, ValidatorValidationsPage } from "./api-types";
import { agreementAxisStart, validatorHistoryPage, validatorPage, type ValidatorLiveData } from "./validator-view";

// ---- The world of the tests ------------------------------------------------------------------------------------------------------------------

const XRPL: NetworkInfo = { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" };
const XAHAU: NetworkInfo = { id: "xahau", name: "Xahau", native: "XAH", software: "xahaud" };

const ok = <T>(value: T): Loaded<T> => ({ state: "ok", value });
const FAILED: Loaded<never> = { state: "failed" };
const MISSING: Loaded<never> = { state: "missing" };

/** A copy of an object without some of its keys (D1 leaves a key out; it never sends `null`). */
function without<T extends object, K extends keyof T>(object: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...object };
  for (const key of keys) delete copy[key];
  return copy;
}

const KEY = SAMPLE_KEYS[0];
/** Unix seconds of a UTC moment (the month counts from 0, as `Date.UTC` has it). */
const unix = (year: number, month: number, day: number, hour: number, minute: number, second: number): number => Date.UTC(year, month, day, hour, minute, second) / 1000;

/** A moment on the newest day of the sample's daily agreement (2026-10-19), 15:54:12 UTC. */
const ANCHOR: Anchor = { lastValidated: 107748183, closeTime: unix(2026, 9, 19, 15, 54, 12) };
/** The same chain a day later: the sample's newest day has ended. */
const NEXT_DAY: Anchor = { lastValidated: 107750000, closeTime: unix(2026, 9, 20, 0, 0, 3) };

type Input = Parameters<typeof validatorPage>[0];

function build(over: Partial<Input> = {}): ValidatorLiveData {
  return validatorPage({
    network: XRPL,
    validator: validatorDetailSample(),
    recent: ok(validationsSample()),
    summary: ok(summarySample()),
    amendments: ok(amendmentsSample()),
    anchor: ANCHOR,
    ...over,
  });
}

const withVerification = (verification: DomainVerification): ValidatorDetail => validatorDetailSample({ domain_verification: verification });

/** A validator the data API lists and never saw: every key that is not always there is left out. */
function neverSeen(): ValidatorDetail {
  return {
    result: "success",
    validation_public_key: SAMPLE_KEYS[4],
    agreement_1h: { missed: 0, total: 0, incomplete: true, partial: 0 },
    agreement_24h: { missed: 0, total: 0, incomplete: true, partial: 0 },
    unl: true,
    agreement_30d: { missed: 0, total: 0, incomplete: true, partial: 0 },
    unl_lists: ["vl.ripple.com"],
    negative_unl: false,
    amendment_votes: { yes: [], votes: [] },
    daily_agreement: [],
  };
}

// ---- The axis ----------------------------------------------------------------------------------------------------------------------------------

describe("agreementAxisStart", () => {
  it.each([
    [["99.00", "100.00"], 99],
    [["98.99"], 95],
    [["94.90"], 90],
    [["49.00"], 0],
    [["0.00"], 0],
    [["50.00", null], 50],
  ] as const)("the axis of %j starts at %i", (values, start) => {
    expect(agreementAxisStart(values)).toBe(start);
  });

  it("starts at 99 when no day has a score: there is no day under it", () => {
    expect(agreementAxisStart([])).toBe(99);
    expect(agreementAxisStart([null, null])).toBe(99);
  });

  it("is the highest start at or below the lowest day, whatever the order", () => {
    expect(agreementAxisStart(["100.00", "97.50", "99.99"])).toBe(95);
    expect(agreementAxisStart(["95.00", "99.00"])).toBe(95);
    expect(agreementAxisStart(["99.99", "89.99"])).toBe(50);
    expect(agreementAxisStart(["90.00"])).toBe(90);
  });
});

// ---- The identity and the verification note ------------------------------------------------------------------------------------------------

const VERIFICATION_STATUSES = ["verified", "unverified", "pending"] as const;

describe("validatorPage: the identity", () => {
  const OWN_TOML = "https://northpeak.example/.well-known/xrp-ledger.toml";

  const CASES = {
    verified: { verification: { status: "verified", toml_url: OWN_TOML, checked: "2026-10-19T19:15:52.489Z", verified: "2026-10-19T19:15:52.489Z" } satisfies DomainVerification },
    unverified: { verification: { status: "unverified", reason: "not_listed", toml_url: OWN_TOML, checked: "2026-10-19T19:15:52.489Z" } satisfies DomainVerification },
    pending: { verification: { status: "pending", toml_url: OWN_TOML } satisfies DomainVerification },
  };

  it.each(VERIFICATION_STATUSES)("writes the verification note for %s", (status) => {
    const { identity } = build({ validator: withVerification(CASES[status].verification) });
    expect(identity.domainStatus).toBe(status);
    expect(identity.heading).toEqual({ text: "northpeak.example", mono: false });
    expect(identity.masterKey).toBe(KEY);
    if (status === "verified") {
      // The file name is a link to the validator's own TOML, and only here.
      expect(identity.note).toEqual([
        "The ",
        { text: "xrp-ledger.toml", href: OWN_TOML, external: "nofollow" },
        " at northpeak.example lists this master key. Checked Oct 19, 2026, 19:15 UTC.",
      ]);
    } else if (status === "unverified") {
      expect(identity.note).toEqual(["The xrp-ledger.toml at northpeak.example does not list this master key."]);
    } else {
      expect(identity.note).toEqual(["The domain has not been checked yet."]);
    }
  });

  it("links the file only for a verified TOML on the validator's own domain", () => {
    const text = (note: ReturnType<typeof build>["identity"]["note"]) => (note ?? []).map((part) => (typeof part === "string" ? part : "link")).join("");
    for (const toml_url of ["https://elsewhere.example/.well-known/xrp-ledger.toml", "https://northpeak.example/other.toml", "http://northpeak.example/.well-known/xrp-ledger.toml"]) {
      const { identity } = build({ validator: withVerification({ status: "verified", toml_url, checked: "2026-10-19T19:15:52.489Z" }) });
      expect(text(identity.note)).toBe("The xrp-ledger.toml at northpeak.example lists this master key. Checked Oct 19, 2026, 19:15 UTC.");
    }
  });

  it("names the file of the network's software", () => {
    const toml_url = "https://northpeak.example/.well-known/xahau.toml";
    const { identity } = build({ network: XAHAU, validator: withVerification({ status: "verified", toml_url }) });
    expect(identity.note).toEqual(["The ", { text: "xahau.toml", href: toml_url, external: "nofollow" }, " at northpeak.example lists this master key."]);
  });

  it("names a validator without a domain by its short key in mono, and says nothing of a domain", () => {
    const validator = validatorDetailSample({ validation_public_key: SAMPLE_KEYS[3] });
    const { identity } = build({ validator: without(validator, "domain", "domain_verification") });
    expect(identity.heading).toEqual({ text: shortHash(SAMPLE_KEYS[3]), mono: true });
    expect(identity.domainStatus).toBeNull();
    expect(identity.note).toBeNull();
  });

  it("says nothing of a domain the data API sent no verification of", () => {
    const { identity } = build({ validator: without(validatorDetailSample(), "domain_verification") });
    expect(identity.heading.text).toBe("northpeak.example");
    expect(identity.domainStatus).toBeNull();
    expect(identity.note).toBeNull();
  });

  it("carries the UNL and the negative UNL as D has them", () => {
    const { identity } = build({ validator: validatorDetailSample({ unl: false, unl_lists: [], negative_unl: true }) });
    expect(identity).toMatchObject({ unl: false, unlPublishers: [], negativeUnl: true });
    expect(build().identity).toMatchObject({ unl: true, unlPublishers: ["unl.xrplf.org", "vl.ripple.com"], negativeUnl: false });
  });

  it("is the same in the history view", () => {
    const history = validatorHistoryPage({ network: XRPL, validator: validatorDetailSample(), recent: validationsSample(), marker: "AAAA", back: [] });
    expect(history.identity).toEqual(build().identity);
  });
});

// ---- The grid ----------------------------------------------------------------------------------------------------------------------------------

describe("validatorPage: the grid", () => {
  it("carries the signing key in full, the version, and the first seen", () => {
    const { grid } = build();
    expect(grid.signingKey).toBe(SAMPLE_SIGNING_KEYS[0]);
    expect(grid.version).toEqual({ text: "3.4.1", latest: true });
    expect(grid.firstSeen).toBe("Jul 21, 2026 · first seen by the data API");
  });

  it("writes a Xahau build after the version, and no version for a validator that reported none", () => {
    const xahau = validatorDetailSample({ version: "2026.10.13", version_build: 4119, version_latest: false });
    expect(build({ network: XAHAU, validator: xahau }).grid.version).toEqual({ text: "2026.10.13 · build 4119", latest: false });
    expect(build({ validator: without(validatorDetailSample(), "version", "version_latest") }).grid.version).toBeNull();
  });

  it("says one signing key and n signing keys, with the manifest's sequence", () => {
    const manifest = (signing_keys_seen: number) => ({ sequence: 2, signing_key: SAMPLE_SIGNING_KEYS[0], signing_keys_seen });
    expect(build({ validator: validatorDetailSample({ manifest: manifest(1) }) }).grid).toMatchObject({ manifest: "one signing key seen", manifestSequence: "2" });
    expect(build({ validator: validatorDetailSample({ manifest: manifest(4) }) }).grid).toMatchObject({ manifest: "4 signing keys seen by the data API", manifestSequence: "2" });
    expect(build({ validator: validatorDetailSample({ manifest: { ...manifest(1), sequence: 2026070302 } }) }).grid.manifestSequence).toBe("2026070302");
  });

  it("leaves out what the data API did not send", () => {
    const { grid } = build({ validator: neverSeen() });
    expect(grid).toEqual({ signingKey: null, manifest: null, manifestSequence: null, version: null, firstSeen: null, lastSeenFallback: null, accounts: null });
  });

  it("lists the accounts a verified domain lists, skipping an invalid address", () => {
    const toml_url = "https://northpeak.example/.well-known/xrp-ledger.toml";
    const valid = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
    const badChecksum = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTX";
    const verified = (accounts?: string[]) => build({ validator: withVerification({ status: "verified", toml_url, ...(accounts && { accounts }) }) }).grid.accounts;

    expect(verified([badChecksum, valid, "not an address"])).toEqual([{ address: valid, href: `/xrpl/account/${valid}` }]);
    expect(build().grid.accounts).toEqual([{ address: valid, href: `/xrpl/account/${valid}` }]);
    expect(verified(undefined)).toBeNull();
    expect(verified([badChecksum])).toBeNull();
    // D1 serves the field for a TOML that verified only; the builder links nothing a domain that did not verify says.
    expect(build({ validator: withVerification({ status: "unverified", reason: "not_listed", toml_url, accounts: [valid] }) }).grid.accounts).toBeNull();
  });

  it("takes last seen from D's last_seen and current_index, as the fallback of the page", () => {
    expect(build().grid.lastSeenFallback).toEqual({
      at: unix(2026, 9, 19, 19, 24, 52),
      ledger: { text: "#107,748,183", href: "/xrpl/ledger/107748183" },
    });
  });

  it("falls back to a time alone without a ledger, and to nothing without a time", () => {
    const seen = build({ validator: without(validatorDetailSample(), "current_index") }).grid.lastSeenFallback;
    expect(seen).toEqual({ at: unix(2026, 9, 19, 19, 24, 52), ledger: null });
    expect(build({ validator: without(validatorDetailSample(), "last_seen") }).grid.lastSeenFallback).toBeNull();
  });
});

// ---- UNL membership ----------------------------------------------------------------------------------------------------------------------

describe("validatorPage: UNL membership", () => {
  it("lists every publisher as listed or not with S", () => {
    expect(build().summary).toMatchObject({
      state: "ok",
      membership: [
        { publisher: "unl.xrplf.org", listed: true },
        { publisher: "vl.ripple.com", listed: true },
      ],
    });
    const one = build({ validator: validatorDetailSample({ unl_lists: ["vl.ripple.com"] }) });
    expect(one.summary).toMatchObject({ membership: [{ publisher: "unl.xrplf.org", listed: false }, { publisher: "vl.ripple.com", listed: true }] });
    const none = build({ validator: validatorDetailSample({ unl: false, unl_lists: [] }) });
    expect(none.summary).toMatchObject({ membership: [{ publisher: "unl.xrplf.org", listed: false }, { publisher: "vl.ripple.com", listed: false }] });
  });

  it("lists the publishers in S's order", () => {
    const summary = summarySample();
    const reversed = summarySample({ unl: { ...summary.unl, publishers: [...summary.unl.publishers].reverse() } });
    const { summary: part } = build({ summary: ok(reversed) });
    expect(part.state === "ok" && part.membership.map((m) => m.publisher)).toEqual(["vl.ripple.com", "unl.xrplf.org"]);
  });

  it("has unl_lists alone without S", () => {
    for (const summary of [FAILED, MISSING]) {
      const page = build({ summary });
      expect(page.summary).toEqual({ state: "failed" });
      expect(page.identity).toMatchObject({ unl: true, unlPublishers: ["unl.xrplf.org", "vl.ripple.com"] });
    }
    expect(build({ summary: FAILED, validator: validatorDetailSample({ unl: false, unl_lists: [] }) }).identity.unlPublishers).toEqual([]);
  });

  it("says since which ledger a validator is on the negative UNL, from S", () => {
    const validator = validatorDetailSample({ validation_public_key: SAMPLE_KEYS[5], negative_unl: true });
    const page = build({ validator });
    expect(page.identity.negativeUnl).toBe(true);
    expect(page.summary).toMatchObject({ negativeSince: { text: "#107,747,000", href: "/xrpl/ledger/107747000" } });
    expect(build().summary).toMatchObject({ negativeSince: null });
    // Without S the flag is D's, and the ledger is not known.
    expect(build({ validator, summary: FAILED }).identity.negativeUnl).toBe(true);
  });
});

// ---- Agreement ---------------------------------------------------------------------------------------------------------------------------

describe("validatorPage: the agreement tiles", () => {
  it("writes a tile for each window, with its score and the ledgers it counted", () => {
    expect(build().agreement.tiles).toEqual([
      { label: "Agreement, 1 h", value: "99.89%", sub: "1 missed of 900 validated ledgers · 1 partial", incomplete: false },
      { label: "Agreement, 24 h", value: "99.99%", sub: "2 missed of 21,600 validated ledgers · 1 partial", incomplete: false },
      { label: "Agreement, 30 days", value: "99.99%", sub: "3 missed of 43,200 validated ledgers · 2 partial", incomplete: true },
    ]);
  });

  it("writes agreement tiles without a score", () => {
    const validator = validatorDetailSample({ agreement_1h: { missed: 0, total: 0, incomplete: true, partial: 0 } });
    const [hour, day] = build({ validator }).agreement.tiles;
    expect(hour).toEqual({ label: "Agreement, 1 h", value: "—", sub: "No validated ledgers counted yet", incomplete: true });
    expect(day!.value).toBe("99.99%");
    expect(build({ validator: neverSeen() }).agreement.tiles.map((tile) => [tile.value, tile.sub])).toEqual(Array(3).fill(["—", "No validated ledgers counted yet"]));
  });

  it("writes one validated ledger in the singular and no partial without a ` · 0 partial`", () => {
    const validator = validatorDetailSample({ agreement_24h: { missed: 0, total: 1, score: "1.0000", incomplete: false, partial: 0 } });
    expect(build({ validator }).agreement.tiles[1]).toMatchObject({ value: "100.00%", sub: "0 missed of 1 validated ledger" });
  });
});

describe("validatorPage: the daily agreement", () => {
  it("builds the daily chart: values, gaps, forming, the Ledgers extra", () => {
    const { chart } = build().agreement;
    expect(chart.axis).toEqual({ unit: "day", buckets: ["2026-09-20", "2026-10-17", "2026-10-18", "2026-10-19"] });
    expect(chart.series).toEqual([{ id: "agreement", label: "Agreement", slot: 1, values: [null, "100.00", "100.00", "99.99"] }]);
    expect(chart.format).toEqual({ kind: "percent" });
    expect(chart.domain).toEqual({ min: "99" });
    expect(chart.forming).toBe(true);
    expect(chart.extras).toEqual([
      {
        id: "ledgers",
        label: "Ledgers",
        tooltip: "value",
        values: [
          "0 missed of 0 validated ledgers · incomplete",
          "0 missed of 4,500 validated ledgers · incomplete",
          "1 missed of 21,600 validated ledgers · 1 partial",
          "2 missed of 17,100 validated ledgers · 1 partial · incomplete",
        ],
      },
    ]);
    expect(chart.token).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is forming only while the newest day is the anchor's UTC day", () => {
    expect(build({ anchor: ANCHOR }).agreement.chart.forming).toBe(true);
    expect(build({ anchor: NEXT_DAY }).agreement.chart).not.toHaveProperty("forming");
    // A clock that is not a time makes no day running, and breaks nothing.
    expect(build({ anchor: { lastValidated: 1, closeTime: Number.NaN } }).agreement.chart).not.toHaveProperty("forming");
  });

  it("starts the axis where the lowest day lets it, and says so", () => {
    const days = (score: string) => [{ date: "2026-10-18", missed: 0, total: 100, score, incomplete: false, partial: 0 }, ...validatorDetailSample().daily_agreement.slice(-1)];
    const lowest = build({ validator: validatorDetailSample({ daily_agreement: days("0.9899") }) }).agreement;
    expect(lowest.chart.domain).toEqual({ min: "95" });
    expect(lowest.notes).toContain("The axis starts at 95%.");
    expect(build().agreement.notes).toContain("The axis starts at 99%.");
    expect(build({ validator: validatorDetailSample({ daily_agreement: days("0.4000") }) }).agreement.chart.domain).toEqual({ min: "0" });
  });

  it("writes the table newest first, one row a day", () => {
    const { table } = build().agreement;
    expect(table.map((row) => row.date)).toEqual(["2026-10-19", "2026-10-18", "2026-10-17", "2026-09-20"]);
    expect(table[0]).toEqual({ date: "2026-10-19", day: "Oct 19", agreement: "99.99%", validated: "17,100", missed: "2", partial: "1", complete: "no, hours missing" });
    expect(table[1]).toEqual({ date: "2026-10-18", day: "Oct 18", agreement: "100.00%", validated: "21,600", missed: "1", partial: "1", complete: "yes" });
    expect(table[3]).toEqual({ date: "2026-09-20", day: "Sep 20", agreement: "—", validated: "0", missed: "0", partial: "0", complete: "no, hours missing" });
  });

  it("writes the notes: what agreement is, what an incomplete day lacks, and where the axis starts", () => {
    expect(build().agreement.notes).toEqual([
      "Share of the validated ledgers this validator signed with the same hash. Partial validations do not count toward agreement.",
      "Incomplete days are missing some hours of the data API's record.",
      "The axis starts at 99%.",
    ]);
    const complete = validatorDetailSample({ daily_agreement: [{ date: "2026-10-19", missed: 0, total: 10, score: "1.0000", incomplete: false, partial: 0 }] });
    expect(build({ validator: complete }).agreement.notes).toEqual([
      "Share of the validated ledgers this validator signed with the same hash. Partial validations do not count toward agreement.",
      "The axis starts at 99%.",
    ]);
  });

  it("has a token that covers the extras, and nothing the chart does not draw", () => {
    const { chart } = build().agreement;
    const { token, ...data } = chart;
    expect(token).toBe(tokenOf(data));
    // A partial validation changes the Ledgers extra and not the score: the token follows.
    const days = validatorDetailSample().daily_agreement.map((day) => (day.date === "2026-10-18" ? { ...day, partial: day.partial + 1 } : day));
    const moved = build({ validator: validatorDetailSample({ daily_agreement: days }) }).agreement.chart;
    expect(moved.series).toEqual(chart.series);
    expect(moved.token).not.toBe(token);
    // The same data twice, and anything else of the page changing, keep it.
    expect(build({ summary: FAILED, recent: FAILED }).agreement.chart.token).toBe(token);
  });

  it("has no days, and no axis to explain, while no hour is final", () => {
    const page = build({ validator: neverSeen() });
    expect(page.agreement.chart.axis.buckets).toEqual([]);
    expect(page.agreement.chart.series[0]!.values).toEqual([]);
    expect(page.agreement.table).toEqual([]);
    expect(page.agreement.notes).toEqual(["Share of the validated ledgers this validator signed with the same hash. Partial validations do not count toward agreement."]);
  });
});

// ---- Fee votes ---------------------------------------------------------------------------------------------------------------------------

describe("validatorPage: the fee votes", () => {
  it("writes fee votes with a record, and Now against S's fees", () => {
    const page = build();
    expect(page.fees).toEqual({
      voteLedger: { text: "#107,748,095", href: "/xrpl/ledger/107748095" },
      votes: [
        { setting: "Base reserve", vote: "1 XRP" },
        { setting: "Owner reserve", vote: "0.2 XRP" },
        { setting: "Base fee", vote: "10 drops" },
      ],
    });
    expect(page.summary).toMatchObject({
      now: [
        { now: "1 XRP", against: "same" },
        { now: "0.2 XRP", against: "same" },
        { now: "10 drops", against: "same" },
      ],
    });
  });

  it("compares each vote with the fee in force, as numbers", () => {
    const fee_vote = { ledger_index: 107748095, base_fee: "0.000012", reserve_base: "1.0", reserve_inc: "0.1" };
    const page = build({ validator: validatorDetailSample({ fee_vote }) });
    expect(page.fees.votes).toEqual([
      { setting: "Base reserve", vote: "1 XRP" },
      { setting: "Owner reserve", vote: "0.1 XRP" },
      { setting: "Base fee", vote: "12 drops" },
    ]);
    expect(page.summary).toMatchObject({ now: [{ against: "same" }, { against: "lower" }, { against: "higher" }] });
  });

  it("writes the reserves in the network's currency", () => {
    const page = build({ network: XAHAU });
    expect(page.fees.votes?.map((row) => row.vote)).toEqual(["1 XAH", "0.2 XAH", "10 drops"]);
    expect(page.summary).toMatchObject({ now: [{ now: "1 XAH" }, { now: "0.2 XAH" }, { now: "10 drops" }] });
  });

  it("writes fee votes without a record", () => {
    const page = build({ validator: without(validatorDetailSample(), "fee_vote") });
    expect(page.fees).toEqual({ voteLedger: null, votes: null });
    expect(page.summary).toMatchObject({ state: "ok", now: null });
  });

  it("writes Now only with S, and with the fees in it", () => {
    const failed = build({ summary: FAILED });
    expect(failed.summary).toEqual({ state: "failed" });
    // The vote itself does not depend on S.
    expect(failed.fees.votes).toHaveLength(3);
    const noFees: ValidatorsSummary = without(summarySample(), "fees");
    const page = build({ summary: ok(noFees) });
    expect(page.summary).toMatchObject({ state: "ok", now: null });
    expect(page.fees.votes).toHaveLength(3);
  });
});

// ---- Amendment votes ---------------------------------------------------------------------------------------------------------------------

describe("validatorPage: the amendment votes", () => {
  it("lists D's amendment votes with an unknown amendment as Yes, No and No recent vote, with A's status and with D's word", () => {
    const NONE_ID = "3".repeat(64);
    const validator = validatorDetailSample({
      amendment_votes: {
        ledger_index: 107748095,
        yes: [{ id: UNKNOWN_ID }, { id: XCB_ID, name: "XChainBridge" }],
        votes: [
          { id: XCB_ID, name: "XChainBridge", status: "majority", vote: "yes" },
          { id: UNKNOWN_ID, status: "voting", vote: "yes" },
          { id: "2".repeat(64), status: "unknown", vote: "no" },
          { id: NONE_ID, status: "unknown", vote: "none" },
        ],
      },
    });
    const { votes, amendments } = build({ validator });
    expect(votes.ledger).toEqual({ text: "#107,748,095", href: "/xrpl/ledger/107748095" });
    // D's order, whatever A's, and no row depends on A.
    expect(votes.rows).toEqual([
      { id: XCB_ID, label: { text: "XChainBridge", mono: false }, href: "/xrpl/amendments/XChainBridge", vote: "yes", word: "Activating" },
      { id: UNKNOWN_ID, label: { text: shortHash(UNKNOWN_ID), mono: true }, href: `/xrpl/amendments/${UNKNOWN_ID}`, vote: "yes", word: "Voting" },
      { id: "2".repeat(64), label: { text: shortHash("2".repeat(64)), mono: true }, href: `/xrpl/amendments/${"2".repeat(64)}`, vote: "no", word: "Unknown" },
      { id: NONE_ID, label: { text: shortHash(NONE_ID), mono: true }, href: `/xrpl/amendments/${NONE_ID}`, vote: "none", word: "Unknown" },
    ]);
    // A's status view for the amendments A has, by id; the ones it does not have get none (the page falls back to D's word).
    expect(amendments).toEqual({
      state: "ok",
      flagInterval: 256,
      status: {
        [XCB_ID]: { status: "majority", activation: { at: unix(2026, 9, 31, 15, 54, 20), fallback: "expected Oct 31" } },
        [UNKNOWN_ID]: { status: "unknown", share: "0.0%" },
      },
    });
  });

  it("gives A's status of the amendments being voted on, and none of the rest of A", () => {
    const { amendments } = build();
    expect(amendments.state === "ok" && Object.keys(amendments.status)).toEqual([XCB_ID, UNKNOWN_ID, amendmentsSample().amendments[1]!.id]);
    expect(amendments).toMatchObject({ status: { [amendmentsSample().amendments[1]!.id]: { status: "voting", share: "11.4%" } } });
  });

  it("keeps D's rows and words without A", () => {
    for (const list of [FAILED, MISSING]) {
      const page = build({ amendments: list });
      expect(page.amendments).toEqual({ state: "failed" });
      expect(page.votes.rows.map((row) => row.word)).toEqual(["Activating", "Voting", "Voting", "Unknown"]);
    }
  });

  it("takes the flag interval from A's rules", () => {
    const list = amendmentsSample();
    const { amendments } = build({ amendments: ok({ ...list, rules: { ...list.rules, flag_interval: 128 } }) });
    expect(amendments).toMatchObject({ state: "ok", flagInterval: 128 });
  });

  it("lists the amendments with No recent vote and no ledger for a validator without a vote record", () => {
    const validator = validatorDetailSample({
      amendment_votes: { yes: [], votes: [{ id: XCB_ID, name: "XChainBridge", status: "majority", vote: "none" }] },
    });
    const { votes } = build({ validator });
    expect(votes.ledger).toBeNull();
    expect(votes.rows).toEqual([{ id: XCB_ID, label: { text: "XChainBridge", mono: false }, href: "/xrpl/amendments/XChainBridge", vote: "none", word: "Activating" }]);
  });

  it("has no rows when no amendment is being decided", () => {
    const page = build({ validator: validatorDetailSample({ amendment_votes: { ledger_index: 107748095, yes: [], votes: [] } }) });
    expect(page.votes).toEqual({ ledger: { text: "#107,748,095", href: "/xrpl/ledger/107748095" }, rows: [] });
    expect(page.amendments).toEqual({ state: "ok", flagInterval: 256, status: {} });
  });
});

// ---- Recent validations ------------------------------------------------------------------------------------------------------------------

/** A validation on `signing_time`, with the keys that do not matter given. */
function validation(over: Partial<ValidatorValidation> & Pick<ValidatorValidation, "ledger_index" | "signing_time">): ValidatorValidation {
  return {
    ledger_hash: over.ledger_index.toString(16).toUpperCase().padStart(64, "0"),
    validated: "matches",
    full: true,
    signing_key: SAMPLE_SIGNING_KEYS[0],
    first_datetime: over.signing_time.replace("Z", ".250Z"),
    last_datetime: over.signing_time.replace("Z", ".250Z"),
    count: 1,
    ...over,
  };
}

const pageOf = (validations: ValidatorValidation[], marker?: string): ValidatorValidationsPage => ({
  result: "success",
  validation_public_key: KEY,
  count: validations.length,
  ...(marker !== undefined && { marker }),
  validations,
});

describe("validatorPage: the recent validations", () => {
  it("builds a row for each validation, keyed by ledger and hash", () => {
    const { recent } = build();
    if (recent.state !== "ok") throw new Error("expected the recent validations");
    expect(recent.rows.map((row) => row.key)).toEqual([
      "107748007:00000000000000000000000000000000000000000000000000000000066C1AA7",
      "107748006:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "107748006:00000000000000000000000000000000000000000000000000000000066C1AA6",
      "107748005:00000000000000000000000000000000000000000000000000000000066C1AA5",
    ]);
    expect(recent.rows[0]).toEqual({
      key: "107748007:00000000000000000000000000000000000000000000000000000000066C1AA7",
      ledger: { text: "#107,748,007", href: "/xrpl/ledger/107748007" },
      hash: shortHash("00000000000000000000000000000000000000000000000000000000066C1AA7"),
      signed: "16:26:20",
      full: false,
      validated: "matches",
    });
  });

  it("writes signed times with the date prefix only across a day, and the three validated states", () => {
    const validations = [
      validation({ ledger_index: 300, signing_time: "2026-10-19T00:00:05Z" }),
      validation({ ledger_index: 299, signing_time: "2026-10-19T00:00:01Z", validated: "unknown", full: false }),
      validation({ ledger_index: 298, signing_time: "2026-10-18T23:59:57Z", validated: "different", validated_hash: "C".repeat(64) }),
      validation({ ledger_index: 297, signing_time: "2026-09-30T08:09:10Z" }),
    ];
    const { recent } = build({ recent: ok(pageOf(validations)) });
    if (recent.state !== "ok") throw new Error("expected the recent validations");
    expect(recent.rows.map((row) => row.signed)).toEqual(["00:00:05", "00:00:01", "Oct 18, 23:59:57", "Sep 30, 08:09:10"]);
    expect(recent.rows.map((row) => [row.validated, row.full])).toEqual([
      ["matches", true],
      ["unknown", false],
      ["different", true],
      ["matches", true],
    ]);
    // Only a different hash carries the validated one, short.
    expect(recent.rows.map((row) => row.validatedShort)).toEqual([undefined, undefined, shortHash("C".repeat(64)), undefined]);
    expect(recent.rows[2]).toHaveProperty("validatedShort", shortHash("C".repeat(64)));
    expect(recent.rows[0]).not.toHaveProperty("validatedShort");
  });

  it("reads the day of the newest row from the row, not from the clock", () => {
    // The first row of an older page opens its own day: nothing in front of it.
    const { recent } = build({ recent: ok(pageOf([validation({ ledger_index: 10, signing_time: "2026-08-02T09:00:00Z" }), validation({ ledger_index: 9, signing_time: "2026-08-01T23:59:58Z" })])) });
    expect(recent.state === "ok" && recent.rows.map((row) => row.signed)).toEqual(["09:00:00", "Aug 1, 23:59:58"]);
  });

  it("takes last seen from VV's newest validation", () => {
    const { recent } = build();
    expect(recent).toMatchObject({ state: "ok", newest: { at: unix(2026, 9, 19, 16, 26, 20), ledger: { text: "#107,748,007", href: "/xrpl/ledger/107748007" } } });
  });

  it("has no newest validation on an empty page", () => {
    const { recent } = build({ recent: ok(pageOf([])) });
    expect(recent).toEqual({ state: "ok", rows: [], paging: { newerHref: null, olderHref: null }, newest: null });
  });

  it("is a failed part when VV did not load, and D still gives last seen", () => {
    for (const recent of [FAILED, MISSING]) {
      const page = build({ recent });
      expect(page.recent).toEqual({ state: "failed" });
      expect(page.grid.lastSeenFallback).not.toBeNull();
    }
  });

  it("pages with trailPaging and validatorHref", () => {
    const marker = validationsSample().marker!;
    expect(build().recent).toMatchObject({ paging: { newerHref: null, olderHref: `/xrpl/validators/${KEY}?marker=${encodeURIComponent(marker)}` } });
    // The last page of the 7 days has no Older.
    expect(build({ recent: ok(validationsSample({ marker: undefined })) }).recent).toMatchObject({ paging: { newerHref: null, olderHref: null } });
    // The links name the master key, whichever key the page was asked by.
    expect(build({ validator: validatorDetailSample({ validation_public_key: SAMPLE_KEYS[2] }) }).recent).toMatchObject({
      paging: { olderHref: `/xrpl/validators/${SAMPLE_KEYS[2]}?marker=${encodeURIComponent(marker)}` },
    });
  });
});

describe("validatorHistoryPage", () => {
  const history = (marker: string, back: string[], recent = validationsSample({ marker: "NEXT" })) =>
    validatorHistoryPage({ network: XRPL, validator: validatorDetailSample(), recent, marker, back });

  it("builds the history view with nothing live in it", () => {
    const data = history("AAAA", []);
    expect(Object.keys(data).sort()).toEqual(["identity", "key", "kind", "network", "recent"]);
    expect(data).toMatchObject({ kind: "history", network: XRPL, key: KEY, identity: build().identity });
    expect(Object.keys(data.recent).sort()).toEqual(["paging", "rows", "state"]);
    expect(data.recent.state).toBe("ok");
    expect(data.recent.rows).toHaveLength(4);
  });

  it("writes its rows as the live view does, the date prefix relative to its own first row", () => {
    const validations = [validation({ ledger_index: 20, signing_time: "2026-10-12T00:00:01Z" }), validation({ ledger_index: 19, signing_time: "2026-10-11T23:59:59Z" })];
    expect(history("AAAA", [], pageOf(validations)).recent.rows.map((row) => row.signed)).toEqual(["00:00:01", "Oct 11, 23:59:59"]);
    // The same page of validations is the same rows in both views.
    const live = build().recent;
    expect(live.state === "ok" && live.rows).toEqual(history("AAAA", []).recent.rows);
  });

  it("pages with the trail: Newer goes back one page, Older remembers this one", () => {
    // Reached from the first page: Newer is the live page, Older carries this marker in its trail.
    expect(history("AAAA", []).recent.paging).toEqual({ newerHref: `/xrpl/validators/${KEY}`, olderHref: `/xrpl/validators/${KEY}?marker=NEXT&back=AAAA` });
    // Reached from two pages before: Newer is the page before this one, with the trail behind it.
    expect(history("CCCC", ["BBBB", "AAAA"]).recent.paging).toEqual({
      newerHref: `/xrpl/validators/${KEY}?marker=BBBB&back=AAAA`,
      olderHref: `/xrpl/validators/${KEY}?marker=NEXT&back=CCCC.BBBB.AAAA`,
    });
  });

  it("has no Older on the last page", () => {
    expect(history("AAAA", [], validationsSample({ marker: undefined })).recent.paging.olderHref).toBeNull();
  });
});

// ---- What the page needs of the rest -----------------------------------------------------------------------------------------------------

describe("validatorPage: the meta", () => {
  it("carries what the title and description say", () => {
    expect(build().meta).toEqual({ name: "northpeak.example", publishers: ["unl.xrplf.org", "vl.ripple.com"], version: "3.4.1", domain: "verified" });
  });

  it("is the short key for a validator without a domain, and nothing for a domain not checked yet", () => {
    const bare = without(validatorDetailSample({ validation_public_key: SAMPLE_KEYS[3], unl: false, unl_lists: [] }), "domain", "domain_verification", "version");
    expect(build({ validator: bare }).meta).toEqual({ name: shortHash(SAMPLE_KEYS[3]), publishers: [], version: null, domain: null });
    expect(build({ validator: withVerification({ status: "pending", toml_url: "https://northpeak.example/.well-known/xrp-ledger.toml" }) }).meta.domain).toBeNull();
    expect(build({ validator: withVerification({ status: "unverified", reason: "timeout", toml_url: "https://northpeak.example/.well-known/xrp-ledger.toml" }) }).meta.domain).toBe("unverified");
  });

  it("leaves a Xahau build out of the version", () => {
    expect(build({ network: XAHAU, validator: validatorDetailSample({ version: "2026.10.13", version_build: 4119 }) }).meta.version).toBe("2026.10.13");
  });
});

describe("validatorPage: the whole page", () => {
  it("is a live page of the network and the master key", () => {
    const page = build();
    expect(page).toMatchObject({ kind: "live", network: XRPL, key: KEY });
  });

  it("builds from the fewest keys D1 sends, without throwing", () => {
    const page = build({ validator: neverSeen(), recent: ok(pageOf([])) });
    expect(page.identity.heading).toEqual({ text: shortHash(SAMPLE_KEYS[4]), mono: true });
    expect(page.fees).toEqual({ voteLedger: null, votes: null });
    expect(page.votes).toEqual({ ledger: null, rows: [] });
    expect(page.grid.accounts).toBeNull();
  });

  it("stands each of VV, S and A on its own", () => {
    const page = build({ recent: FAILED, summary: FAILED, amendments: FAILED });
    expect([page.recent.state, page.summary.state, page.amendments.state]).toEqual(["failed", "failed", "failed"]);
    // What D alone gives stays.
    expect(page.identity.heading.text).toBe("northpeak.example");
    expect(page.agreement.tiles).toHaveLength(3);
    expect(page.fees.votes).toHaveLength(3);
    expect(page.votes.rows).toHaveLength(4);
  });

  it("puts no float in any string", () => {
    const pages = [
      build(),
      build({ network: XAHAU, validator: validatorDetailSample({ fee_vote: { ledger_index: 1, base_fee: "0.000001", reserve_base: "1.5", reserve_inc: "0.3" } }) }),
      build({ summary: FAILED, amendments: FAILED, recent: FAILED }),
      build({ validator: neverSeen() }),
    ];
    for (const data of pages) expect(JSON.stringify(data)).not.toMatch(/\d\.\d{5,}/);
  });
});
