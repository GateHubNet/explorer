import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadTx } from "../../test/support/ledgers";
import { MPT_FIXTURE_IDS, MPT_RECORDED } from "../../test/support/mpt-case-rules";
import { mptIdOf } from "../domain/mpt-id";
import type { MptSummary } from "./api-types";
import { MPT_LOOKUP_MAX, mptAmountsOf, resolveMpt, type MptLookupMap, type MptLookupResult } from "./mpt-view";
import { transactionPage } from "./transaction-view";

const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const HTF = MPT_FIXTURE_IDS.htf;
const OTHER = MPT_FIXTURE_IDS.noMetadata;
const BARE = MPT_FIXTURE_IDS.shortKeys;

const summary = (id: string, over: Partial<MptSummary> = {}): MptSummary => ({
  mpt_issuance_id: id,
  issuer: ISSUER,
  ticker: "HTF",
  asset_scale: 2,
  outstanding_amount: "1000",
  holders: 3,
  transfer_fee: 0,
  flags: { locked: false, can_lock: false, require_auth: false, can_escrow: false, can_trade: false, can_transfer: true, can_clawback: false },
  destroyed: false,
  ...over,
});

const ok = (...entries: Array<MptSummary | { mpt_issuance_id: string }>): MptLookupResult => ({
  state: "ok",
  map: new Map(entries.map((entry) => [entry.mpt_issuance_id, entry])) satisfies MptLookupMap,
});

describe("mptAmountsOf", () => {
  it("takes the ID of a segment, of a flow amount or any object whose mpt is an ID, of E10's { id, units }, and of a balance change", () => {
    expect(mptAmountsOf({ t: "mpt", id: HTF, issuer: ISSUER, units: "5" })).toEqual([HTF]);
    expect(mptAmountsOf({ t: "mpt", id: HTF, issuer: ISSUER })).toEqual([HTF]);
    expect(mptAmountsOf({ mpt: HTF, issuer: ISSUER, units: "5" })).toEqual([HTF]);
    expect(mptAmountsOf({ change: "modified", type: "MPToken", index: "AB", mpt: HTF })).toEqual([HTF]);
    expect(mptAmountsOf({ mpt: { id: HTF, units: "5" }, more: false })).toEqual([HTF]);
    expect(mptAmountsOf({ account: ISSUER, currency: HTF, value: "5", mpt: true })).toEqual([HTF]);
  });

  it("walks arrays and objects to any depth, over several parts", () => {
    const sentence = [{ t: "text", v: "sent " }, { t: "mpt", id: HTF, issuer: ISSUER, units: "5" }];
    const flow = [{ role: "sender", account: ISSUER, label: "Sender", amount: { mpt: OTHER, issuer: ISSUER, units: "1" } }];
    const page = { sentence, nested: { deeper: [{ changes: [{ account: ISSUER, currency: BARE, value: "1", mpt: true }] }] } };
    expect(mptAmountsOf(sentence, flow, page)).toEqual([HTF, OTHER, BARE].sort());
  });

  it("upper-cases, sorts and deduplicates", () => {
    expect(mptAmountsOf({ mpt: OTHER.toLowerCase() }, { mpt: HTF }, { t: "mpt", id: OTHER }, { mpt: HTF })).toEqual([HTF, OTHER].sort());
  });

  it("keeps the first 100 of 120, in sorted order", () => {
    const ids = Array.from({ length: 120 }, (_, at) => mptIdOf(at + 1, ISSUER));
    const found = mptAmountsOf(ids.map((id) => ({ mpt: id })));
    expect(MPT_LOOKUP_MAX).toBe(100);
    expect(found).toHaveLength(100);
    expect(found).toEqual([...ids].sort().slice(0, 100));
  });

  it("reads no string, so the raw JSON of a transaction holds no carrier, and takes no object that only looks like one", () => {
    expect(mptAmountsOf({ raw: { tx: JSON.stringify({ mpt: HTF }), meta: `{"mpt":"${HTF}"}` } })).toEqual([]);
    for (const not of [
      { mpt: "AB".repeat(20) },
      { mpt: `${HTF}00` },
      { mpt: `G${HTF.slice(1)}` },
      { mpt: 5 },
      { mpt: false, currency: HTF },
      { mpt: true, currency: "USD" },
      { mpt: true },
      { mpt: { id: "AB", units: "1" } },
      { t: "mpt", id: "AB" },
      { t: "amount", id: HTF },
    ]) {
      expect(mptAmountsOf(not), JSON.stringify(not)).toEqual([]);
    }
  });

  it("walks no class instance, a string, a number or nothing", () => {
    expect(mptAmountsOf(new Map([["mpt", HTF]]), "text", 5, null, undefined, new Date())).toEqual([]);
    expect(mptAmountsOf()).toEqual([]);
  });
});

describe("resolveMpt", () => {
  const HTF_SUMMARY = summary(HTF, { asset_scale: 2, ticker: "HTF" });
  const segment = { t: "mpt", id: HTF, issuer: ISSUER, units: "124000000" };

  it("fills the value, scaled by the asset scale, and the ticker, of a segment, a flow amount and a holding", () => {
    const view = { sentence: [segment], flow: [{ role: "destination", amount: { mpt: HTF, issuer: ISSUER, units: "124000000" } }], holding: { mpt: HTF, units: "5", locked: false } };
    const { view: resolved, unresolved } = resolveMpt(view, ok(HTF_SUMMARY));
    expect(unresolved).toBe(false);
    expect(resolved.sentence[0]).toEqual({ ...segment, value: "1240000.00", ticker: "HTF" });
    expect(resolved.flow[0]!.amount).toEqual({ mpt: HTF, issuer: ISSUER, units: "124000000", value: "1240000.00", ticker: "HTF" });
    expect(resolved.holding).toEqual({ mpt: HTF, units: "5", locked: false, value: "0.05", ticker: "HTF" });
  });

  it("changes nothing in what it was given", () => {
    const view = { sentence: [segment], changes: [{ account: ISSUER, currency: HTF, value: "5", after: "9", mpt: true }] };
    const before = structuredClone(view);
    resolveMpt(view, ok(HTF_SUMMARY));
    expect(view).toEqual(before);
  });

  it("scales at scale 0 (the value is the units) and writes exactly the scale's decimals at any other", () => {
    expect(resolveMpt({ t: "mpt", id: HTF, issuer: ISSUER, units: "7" }, ok(summary(HTF, { asset_scale: 0 }))).view).toEqual({ t: "mpt", id: HTF, issuer: ISSUER, units: "7", value: "7", ticker: "HTF" });
    expect(resolveMpt({ t: "mpt", id: HTF, issuer: ISSUER, units: "1" }, ok(summary(HTF, { asset_scale: 15 }))).view).toMatchObject({ value: "0.000000000000001" });
  });

  it("leaves the value out above scale 19 and counts the amount as resolved: the page shows the units", () => {
    const { view, unresolved } = resolveMpt({ t: "mpt", id: HTF, issuer: ISSUER, units: "1" }, ok(summary(HTF, { asset_scale: 25 })));
    expect(unresolved).toBe(false);
    expect(view).toEqual({ t: "mpt", id: HTF, issuer: ISSUER, units: "1", ticker: "HTF" });
    expect("value" in view).toBe(false);
  });

  it("leaves the ticker out of an issuance that has none, and keeps no key undefined", () => {
    const { view } = resolveMpt({ t: "mpt", id: HTF, issuer: ISSUER, units: "100" }, ok(summary(HTF, { ticker: undefined })));
    expect(view).toStrictEqual({ t: "mpt", id: HTF, issuer: ISSUER, units: "100", value: "1.00" });
  });

  it("gives a reference (no units) its ticker alone", () => {
    expect(resolveMpt({ t: "mpt", id: HTF, issuer: ISSUER }, ok(HTF_SUMMARY)).view).toEqual({ t: "mpt", id: HTF, issuer: ISSUER, ticker: "HTF" });
    const touched = { change: "modified", type: "MPToken", index: "AB", account: ISSUER, mpt: HTF };
    expect(resolveMpt([touched], ok(HTF_SUMMARY)).view).toEqual([{ ...touched, ticker: "HTF" }]);
  });

  it("gives E10's { id, units } its value and ticker inside, and a balance change its scaled change, scaled balance and ticker, the units kept", () => {
    expect(resolveMpt({ mpt: { id: HTF, units: "250" } }, ok(HTF_SUMMARY)).view).toEqual({ mpt: { id: HTF, units: "250", value: "2.50", ticker: "HTF" } });
    const change = { account: ISSUER, currency: HTF, issuer: ISSUER, value: "-1005890", after: "199999997994097", mpt: true };
    expect(resolveMpt(change, ok(HTF_SUMMARY)).view).toEqual({ ...change, scaled: "-10058.90", scaledAfter: "1999999979940.97", ticker: "HTF" });
    // The issuer's row has no balance after.
    const issuer = { account: ISSUER, currency: HTF, value: "5890", mpt: true };
    expect(resolveMpt(issuer, ok(HTF_SUMMARY)).view).toEqual({ ...issuer, scaled: "58.90", ticker: "HTF" });
  });

  it("leaves an ID the lookup answered bare in units, and says so", () => {
    const view = { sentence: [{ t: "mpt", id: BARE, issuer: ISSUER, units: "5" }, segment] };
    const { view: resolved, unresolved } = resolveMpt(view, ok({ mpt_issuance_id: BARE }, HTF_SUMMARY));
    expect(unresolved).toBe(true);
    expect(resolved.sentence[0]).toEqual({ t: "mpt", id: BARE, issuer: ISSUER, units: "5" });
    expect(resolved.sentence[1]).toMatchObject({ value: "1240000.00" });
  });

  it("counts an ID the lookup was not asked, past the first 100, as unresolved too", () => {
    const { unresolved } = resolveMpt({ mpt: OTHER, units: "5" }, ok(HTF_SUMMARY));
    expect(unresolved).toBe(true);
  });

  it("fills nothing and is unresolved when the lookup failed", () => {
    const view = { sentence: [segment] };
    const { view: resolved, unresolved } = resolveMpt(view, { state: "failed" });
    expect(unresolved).toBe(true);
    expect(resolved).toEqual(view);
  });

  it("is never unresolved when no lookup was made, and gives the view back as it is", () => {
    const view = { sentence: [segment] };
    const result = resolveMpt(view, { state: "off" });
    expect(result.unresolved).toBe(false);
    expect(result.view).toBe(view);
  });

  it("is not unresolved for a view with no MPT amount", () => {
    expect(resolveMpt({ sentence: [{ t: "text", v: "hello" }] }, ok(HTF_SUMMARY)).unresolved).toBe(false);
  });

  it("does not scale units that are no integer", () => {
    const { view } = resolveMpt({ mpt: HTF, units: "1.5" }, ok(HTF_SUMMARY));
    expect(view).toEqual({ mpt: HTF, units: "1.5", ticker: "HTF" });
  });
});

// The lookup table the mock answers from (test/fixtures/http/xrpl/data-api/mpt_lookup.json) against the real collection: the IDs `mptAmountsOf` finds in the page of each recorded transaction. (T2's
// test of the table made its own list of them; the function exists now, and this is it, M7 of the review of Tasks 1 and 2.)
describe("the lookup table and the pages of the recorded transactions", () => {
  const table = JSON.parse(readFileSync(new URL("../../test/fixtures/http/xrpl/data-api/mpt_lookup.json", import.meta.url), "utf8")) as Record<string, MptSummary>;
  const idsOf = (name: keyof typeof MPT_RECORDED): string[] => {
    const { hash } = MPT_RECORDED[name];
    const { tx, meta, ledgerIndex, closeTime } = loadTx("xrpl-mpt", hash);
    return mptAmountsOf(transactionPage({ origin: "index", hash, ledgerIndex, closeTime, tx, meta }, { network: { native: "XRP", ctidNetworkId: 0 }, neighbours: null, binary: { state: "pending" } }));
  };

  it("answers every issuance of each recorded transaction's page with a summary, and the recorded clawback of an issued token asks for none", () => {
    for (const name of Object.keys(MPT_RECORDED) as Array<keyof typeof MPT_RECORDED>) {
      const ids = idsOf(name);
      expect(ids.length > 0, name).toBe(name !== "clawback_issued");
      for (const id of ids) expect(table[id], `${name} ${id}`).toBeDefined();
    }
  });

  it("finds one issuance in a create's page, the created node's, and the same one in the mint's, the opt-in's and the clawback's (D9's FINDINGS: three transactions share it)", () => {
    expect(idsOf("issuance_create")).toEqual([MPT_FIXTURE_IDS.htf]);
    expect(idsOf("issuance_create_short_keys")).toEqual([MPT_FIXTURE_IDS.shortKeys]);
    const shared = [idsOf("payment_mint"), idsOf("authorize_holder"), idsOf("clawback_full")];
    expect(shared.every((ids) => ids.length === 1)).toBe(true);
    expect(new Set(shared.flat()).size).toBe(1);
  });
});
