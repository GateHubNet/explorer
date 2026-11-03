import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadTx } from "../../test/support/ledgers";
import { MPT_FIXTURE_IDS, MPT_RECORDED } from "../../test/support/mpt-case-rules";
import { mptCoverageSample, mptFlagsSample, mptTokenRowSample, mptTokensSample, MPT_SAMPLE_ID, MPT_SAMPLE_ISSUER } from "../../test/support/mpt-samples";
import { env as WORLD_ENV, XRPL } from "../../test/support/object-view-world";
import { MPT_FLAGS_LEGEND } from "../domain/mpt";
import { mptIdOf, mptIssuerOf } from "../domain/mpt-id";
import { NO_NAMES, type NamesPart, type NameView } from "../domain/names";
import type { MptFlags, MptHolder, MptHoldersPage, MptIssuance, MptIssuanceAnswer, MptSummary, MptTransfer, MptTransfersPage, NodeMptIssuance } from "./api-types";
import {
  MPT_LOOKUP_MAX,
  mptAmountsOf,
  mptFacts,
  mptHead,
  mptHolderRows,
  mptHoldersPage,
  mptPage,
  mptTokensTab,
  mptTransferRows,
  mptTransfersPage,
  noMptPage,
  nodeFlags,
  resolveMpt,
  topLineOf,
  type MptLookupMap,
  type MptLookupResult,
  type MptPageData,
  type MptSource,
} from "./mpt-view";
import { networkOf } from "./networks";
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

  // Review of Tasks 7 and 8, M2: D9 omits an empty ticker but keeps a blank one (`cutText` does not trim), and the amount would read "25,000.00 " with a link nobody can see.
  it.each([" ", "   ", "\t\n", " "])("treats the blank ticker %j as none: the amount is in units, with no empty link", (ticker) => {
    const { view } = resolveMpt({ t: "mpt", id: HTF, issuer: ISSUER, units: "100" }, ok(summary(HTF, { ticker })));
    expect(view).toStrictEqual({ t: "mpt", id: HTF, issuer: ISSUER, units: "100", value: "1.00" });
    expect(resolveMpt({ account: ISSUER, currency: HTF, value: "5890", mpt: true }, ok(summary(HTF, { ticker }))).view).not.toHaveProperty("ticker");
    expect(resolveMpt({ change: "modified", type: "MPToken", index: "AB", mpt: HTF }, ok(summary(HTF, { ticker }))).view).not.toHaveProperty("ticker");
  });

  // The cut is D9's (`MPT_TICKER_MAX`, `cutText` at the pin): 16 code points, so a character outside the BMP stays whole. The explorer's own path checks no length (mpt-shape.ts), so a longer text
  // from an upstream that did not cut cannot reach a sentence, a description or a card.
  it("cuts a ticker to 16 code points, as D9 does, and keeps a character outside the BMP whole", () => {
    const long = "A".repeat(128);
    expect(resolveMpt({ t: "mpt", id: HTF, issuer: ISSUER, units: "100" }, ok(summary(HTF, { ticker: long }))).view).toMatchObject({ ticker: "A".repeat(16) });
    expect(resolveMpt({ t: "mpt", id: HTF, issuer: ISSUER }, ok(summary(HTF, { ticker: "😀".repeat(17) }))).view).toMatchObject({ ticker: "😀".repeat(16) });
    expect(resolveMpt({ t: "mpt", id: HTF, issuer: ISSUER }, ok(summary(HTF, { ticker: "😀".repeat(16) }))).view).toMatchObject({ ticker: "😀".repeat(16) });
    expect(resolveMpt({ t: "mpt", id: HTF, issuer: ISSUER }, ok(summary(HTF, { ticker: "A".repeat(16) }))).view).toMatchObject({ ticker: "A".repeat(16) });
  });

  // The whole-branch review's I1: an override (U+202E) in a ticker turns everything after it in the paragraph it is drawn in, the destination address of a payment's sentence among it. The ticker is read
  // without its bidi controls, before the cut, so that a control does not use up the length either.
  it("takes the bidi controls out of a ticker before the cut to 16 code points, and treats a ticker of controls alone as none", () => {
    const amount = { t: "mpt", id: HTF, issuer: ISSUER, units: "100" };
    expect(resolveMpt(amount, ok(summary(HTF, { ticker: "‮DSU" }))).view).toMatchObject({ ticker: "DSU", value: "1.00" });
    expect(resolveMpt(amount, ok(summary(HTF, { ticker: `‮⁦‏${"A".repeat(16)}` }))).view).toMatchObject({ ticker: "A".repeat(16) });
    expect(resolveMpt(amount, ok(summary(HTF, { ticker: "‮‬؜" }))).view).not.toHaveProperty("ticker");
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


// ---- The MPT page (Task 9) ------------------------------------------------------------------------------------------------------------------------------------------------------------
//
// Inputs built by hand with the board's figures: 18,204,511.20 outstanding of a max of 50,000,000.00, 1,240,000.00 locked over 1 holder, 3,412 holders, a fee of 0.10%, scale 2, the ticker HTF.

const PAGE_ID = mptIdOf(298, ISSUER);
const PAGE_ISSUER = ISSUER;
const FLAGS: MptFlags = { locked: false, can_lock: true, require_auth: false, can_escrow: true, can_trade: false, can_transfer: true, can_clawback: true };
const COMPLETE = { from_ledger_index: 99226369, complete: true };
const INCOMPLETE = { from_ledger_index: 99226369, complete: false };

const issuanceOf = (over: Partial<MptIssuance> = {}): MptIssuance => ({
  mpt_issuance_id: PAGE_ID,
  issuer: PAGE_ISSUER,
  sequence: 298,
  ticker: "HTF",
  name: "Harborline Treasury Fund",
  asset_scale: 2,
  maximum_amount: "5000000000",
  outstanding_amount: "1820451120",
  escrowed_amount: "0",
  locked_amount: "124000000",
  locked_holders: 1,
  holders: 3412,
  transfer_fee: 100,
  flags: FLAGS,
  metadata: { ticker: "HTF", name: "Harborline Treasury Fund" },
  metadata_hex: "7B7D",
  metadata_conforms: true,
  created_ledger: 99226400,
  created_time: "2025-10-09T08:30:00Z",
  last_ledger: 107721455,
  destroyed: false,
  ...over,
});

const indexed = (over: Partial<MptIssuance> = {}, coverage = COMPLETE): MptSource => ({ origin: "index", answer: { coverage, issuance: issuanceOf(over) } satisfies MptIssuanceAnswer });
const withoutKeys = (issuance: MptIssuance, ...keys: Array<keyof MptIssuance>): MptIssuance => {
  const copy: Record<string, unknown> = { ...issuance };
  for (const key of keys) delete copy[key];
  return copy as unknown as MptIssuance;
};
const sourceWithout = (...keys: Array<keyof MptIssuance>): MptSource => ({ origin: "index", answer: { coverage: COMPLETE, issuance: withoutKeys(issuanceOf(), ...keys) } });

const entryOf = (over: Partial<NodeMptIssuance> = {}): NodeMptIssuance => ({ LedgerEntryType: "MPTokenIssuance", Issuer: PAGE_ISSUER, Sequence: 298, Flags: 0x02 | 0x20, ...over });
const fromNode = (over: Partial<NodeMptIssuance> = {}): MptSource => ({ origin: "node", node: entryOf(over), ledgerIndex: 107721455, id: PAGE_ID });

const holderOf = (holder: string, amount: string, over: Partial<MptHolder> = {}): MptHolder => ({ holder, amount, escrowed_amount: "0", locked: false, authorized: true, ...over });
const holdersPage = (holders: MptHolder[], over: Partial<MptHoldersPage> = {}): MptHoldersPage => ({ coverage: COMPLETE, count: holders.length, holders, ...over });
const transferOf = (over: Partial<MptTransfer> = {}): MptTransfer => ({
  ledger_index: 107000000,
  tx_index: 3,
  tx_hash: "AB".repeat(32),
  executed_time: "2026-10-02T16:27:51Z",
  tx_type: "Payment",
  kind: "payment",
  source: PAGE_ISSUER,
  destination: "rKSg2VZbw9gRRuSwBjBFAfBoGC5Vs1FmFn",
  amount: "250000",
  ...over,
});
const transfersPage = (transfers: MptTransfer[], over: Partial<MptTransfersPage> = {}): MptTransfersPage => ({ coverage: COMPLETE, count: transfers.length, transfers, ...over });

const A = (n: number) => mptIssuerOf(mptIdOf(n, PAGE_ISSUER));
const named = (text = "Harborline"): NamesPart => ({ state: "ok", map: { [PAGE_ISSUER]: { name: { text, kind: "verified" }, labels: [] } satisfies NameView } });

const OK = { state: "ok" } as const;
const page = (over: Partial<Parameters<typeof mptPage>[0]> = {}): MptPageData =>
  mptPage({ net: XRPL, source: indexed(), holders: { ...OK, value: holdersPage([]) }, transfers: { ...OK, value: transfersPage([]) }, names: NO_NAMES, ...over });
const tilesOf = (source: MptSource) => page({ source }).tiles;
const tile = (source: MptSource, label: string) => tilesOf(source).find((one) => one.label === label)!;

describe("mptPage: the six figures", () => {
  it("are the board's, in its order, with their lines", () => {
    expect(tilesOf(indexed())).toEqual([
      { label: "Outstanding", value: "18,204,511.20", line: "HTF held by holders, 36.4% of the max amount" },
      { label: "Max amount", value: "50,000,000.00", line: "HTF, fixed when the issuance was created" },
      { label: "Locked", value: "1,240,000.00", line: "HTF in 1 holder balance the issuer has locked" },
      { label: "Holders", value: "3,412", line: "accounts holding HTF" },
      { label: "Transfer fee", value: "0.10%", line: "charged when holders send HTF to each other" },
      { label: "Asset scale", value: "2", line: "Amounts are integers scaled by 10⁻²: 1 HTF is 100 on the ledger." },
    ]);
  });

  it("says 'no max amount is set' when there is none", () => {
    const source = sourceWithout("maximum_amount");
    expect(tile(source, "Outstanding").line).toBe("HTF held by holders; no max amount is set");
    expect(tile(source, "Max amount")).toMatchObject({ value: "Not set", line: "Up to the ledger's limit" });
  });

  it("writes the locked line for every state: balances, every balance, nothing, and an issuer that cannot lock", () => {
    expect(tile(indexed({ locked_holders: 3 }), "Locked").line).toBe("HTF in 3 holder balances the issuer has locked");
    expect(tile(indexed({ flags: { ...FLAGS, locked: true }, locked_amount: "1820451120", locked_holders: 3412 }), "Locked")).toEqual({ label: "Locked", value: "18,204,511.20", line: "Every balance is locked" });
    expect(tile(indexed({ locked_amount: "0", locked_holders: 0 }), "Locked")).toEqual({ label: "Locked", value: "0.00", line: "Nothing is locked" });
    expect(tile(indexed({ locked_amount: "0", locked_holders: 0, flags: { ...FLAGS, can_lock: false } }), "Locked").line).toBe("The issuer cannot lock HTF");
  });

  it("adds what is in escrow to the locked line, after a semicolon, and only when above 0", () => {
    expect(tile(indexed({ escrowed_amount: "1200000" }), "Locked").line).toBe("HTF in 1 holder balance the issuer has locked; 12,000.00 HTF in escrow");
    expect(tile(indexed({ escrowed_amount: "1200000", locked_amount: "0", locked_holders: 0 }), "Locked").line).toBe("Nothing is locked; 12,000.00 HTF in escrow");
    expect(tile(indexed({ escrowed_amount: "0" }), "Locked").line).not.toContain("escrow");
  });

  it("writes the fee line, and 'None' for no fee", () => {
    expect(tile(indexed({ transfer_fee: 0 }), "Transfer fee")).toEqual({ label: "Transfer fee", value: "None", line: "holders pay no fee to send HTF" });
    expect(tile(indexed({ transfer_fee: 192 }), "Transfer fee").value).toBe("0.192%");
  });

  it("writes the scale line for scale 0, for scale 15 (the power grouped) and, above 19, with no power", () => {
    expect(tile(indexed({ asset_scale: 0 }), "Asset scale")).toEqual({ label: "Asset scale", value: "0", line: "Amounts are whole numbers: 1 HTF is 1 on the ledger." });
    expect(tile(indexed({ asset_scale: 15 }), "Asset scale").line).toBe("Amounts are integers scaled by 10⁻¹⁵: 1 HTF is 1,000,000,000,000,000 on the ledger.");
    const big = indexed({ asset_scale: 25, outstanding_amount: "1820451120", maximum_amount: "5000000000" });
    expect(tile(big, "Asset scale")).toEqual({ label: "Asset scale", value: "25", line: "Amounts are shown as the ledger's integer units." });
    // Nothing is scaled: the units as the ledger holds them, grouped.
    expect(tile(big, "Outstanding").value).toBe("1,820,451,120");
    expect(tile(big, "Max amount").value).toBe("5,000,000,000");
  });

  // The whole-branch review's M1: above scale 19 the page shows the ledger's integers, which are not the token's amounts (1.82×10⁻¹⁶ HTF at scale 25), so every label of an amount says "units". The
  // lines that name the token, its heading, its crumb and its name stay the ticker.
  it("labels an amount above scale 19 'units' and not by the ticker, in the lines, the description, the card and the list summary", () => {
    const big = indexed({ asset_scale: 25, outstanding_amount: "1820451120", maximum_amount: "5000000000", escrowed_amount: "1200" });
    expect(mptHead(big)).toMatchObject({ crumb: "HTF", heading: "Harborline Treasury Fund", ticker: "HTF", tickerOrUnits: "HTF", amountWord: "units", scale: null });
    expect(tilesOf(big).map((one) => [one.label, one.value, one.line])).toEqual([
      ["Outstanding", "1,820,451,120", "units held by holders, 36.4% of the max amount"],
      ["Max amount", "5,000,000,000", "units, fixed when the issuance was created"],
      ["Locked", "124,000,000", "units in 1 holder balance the issuer has locked; 1,200 units in escrow"],
      ["Holders", "3,412", "accounts holding HTF"],
      ["Transfer fee", "0.10%", "charged when holders send HTF to each other"],
      ["Asset scale", "25", "Amounts are shown as the ledger's integer units."],
    ]);
    const facts = mptFacts(XRPL, big, NO_NAMES);
    expect(facts.description).toBe(`MPT issued by ${PAGE_ISSUER.slice(0, 6)}…${PAGE_ISSUER.slice(-4)}: 1,820,451,120 units outstanding, 3,412 holders · XRPL`);
    expect(facts.card.outstanding).toBe("1.82B units");
    expect(facts.title).toBe("HTF · Harborline Treasury Fund · MPT");
    const holders = mptHoldersPage({ net: XRPL, source: big, page: { ...OK, value: holdersPage([holderOf(A(1), "612000000")]) }, view: { back: [] }, names: NO_NAMES });
    expect(holders).toMatchObject({ title: "Holders of HTF", summary: "3,412 accounts hold 1,820,451,120 units", head: { amountWord: "units" } });
    expect(mptTransfersPage({ net: XRPL, source: indexed({ asset_scale: 25 }), page: { ...OK, value: transfersPage([]) }, view: { back: [] }, names: NO_NAMES }).summary).toBe("3,412 accounts hold 1,820,451,120 units");
    // The scales the page applies keep the ticker.
    expect(tilesOf(indexed({ asset_scale: 19 }))[0]!.line).toBe("HTF held by holders, 36.4% of the max amount");
  });

  it("says 'units' where the issuance has no ticker, in every line", () => {
    const source = indexed({ ticker: undefined, name: undefined, metadata: undefined, metadata_hex: undefined, metadata_conforms: undefined, escrowed_amount: "100" });
    expect(tilesOf(source).map((one) => one.line)).toEqual([
      "units held by holders, 36.4% of the max amount",
      "units, fixed when the issuance was created",
      "units in 1 holder balance the issuer has locked; 1.00 units in escrow",
      "accounts holding units",
      "charged when holders send units to each other",
      "Amounts are integers scaled by 10⁻²: 1 units is 100 on the ledger.",
    ]);
  });

  it("reads 1 holder in the singular only where a count is said: the tile is the figure", () => {
    expect(tile(indexed({ holders: 1 }), "Holders").value).toBe("1");
  });
});

describe("mptPage: the figures from the network", () => {
  it("reads a field the node left out as 0, and has no holders or locked holders to say", () => {
    // An entry with nothing but the issuer, the sequence and its flags: every default is left out.
    const tiles = tilesOf(fromNode({ Flags: 0x02 }));
    expect(tiles).toEqual([
      { label: "Outstanding", value: "0", line: "units held by holders; no max amount is set" },
      { label: "Max amount", value: "Not set", line: "Up to the ledger's limit" },
      { label: "Locked", value: "—", line: "not in the index yet" },
      { label: "Holders", value: "—", line: "not in the index yet" },
      { label: "Transfer fee", value: "None", line: "holders pay no fee to send units" },
      { label: "Asset scale", value: "0", line: "Amounts are whole numbers: 1 units is 1 on the ledger." },
    ]);
  });

  it("scales by the entry's AssetScale and reads its amounts", () => {
    const tiles = tilesOf(fromNode({ AssetScale: 2, OutstandingAmount: "1820451120", MaximumAmount: "5000000000", TransferFee: 100, LockedAmount: "1200000" }));
    expect(tiles.map((one) => one.value)).toEqual(["18,204,511.20", "50,000,000.00", "—", "—", "0.10%", "2"]);
    expect(tiles[2]!.line).toBe("not in the index yet; 12,000.00 units in escrow");
  });

  it("says what the Locked tile can: every balance when lsfMPTLocked is set, '0' when the issuer cannot lock, '—' otherwise", () => {
    const locked = fromNode({ Flags: 0x01 | 0x02, AssetScale: 2, OutstandingAmount: "1820451120" });
    expect(tile(locked, "Locked")).toEqual({ label: "Locked", value: "18,204,511.20", line: "Every balance is locked" });
    expect(tile(fromNode({ Flags: 0x20 }), "Locked")).toEqual({ label: "Locked", value: "0", line: "The issuer cannot lock units" });
    expect(tile(fromNode({ Flags: 0x02 }), "Locked")).toEqual({ label: "Locked", value: "—", line: "not in the index yet" });
  });

  it("reads the flag bits as rippled sets them: locked 0x01, can lock 0x02, require auth 0x04, can escrow 0x08, can trade 0x10, can transfer 0x20, can clawback 0x40", () => {
    expect(nodeFlags(0)).toEqual({ locked: false, can_lock: false, require_auth: false, can_escrow: false, can_trade: false, can_transfer: false, can_clawback: false });
    expect(nodeFlags(0x7f)).toEqual({ locked: true, can_lock: true, require_auth: true, can_escrow: true, can_trade: true, can_transfer: true, can_clawback: true });
    const one = (flags: number) => Object.entries(nodeFlags(flags)).filter(([, on]) => on).map(([key]) => key);
    expect([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40].map(one)).toEqual([["locked"], ["can_lock"], ["require_auth"], ["can_escrow"], ["can_trade"], ["can_transfer"], ["can_clawback"]]);
    // Flags above the seven are not read.
    expect(one(0x80 | 0x10000)).toEqual([]);
  });
});

describe("mptPage: the Flags card", () => {
  it("has the intro of decision 3 and the six rows of the board, each Yes or No with its line, the ticker in place of HTF", () => {
    const { flags } = page();
    expect(flags.intro).toBe("What the issuer allows, as the issuance says now.");
    expect(flags.rows).toEqual([
      { label: "Can lock", yes: true, line: "The issuer can lock one holder's balance, or all of HTF, so it cannot move." },
      { label: "Require auth", yes: false, line: "Any account can hold HTF without the issuer's approval." },
      { label: "Can escrow", yes: true, line: "HTF can be held in escrows." },
      { label: "Can trade", yes: false, line: "The issuer does not allow HTF on the DEX." },
      { label: "Can transfer", yes: true, line: "Holders can send HTF to each other, not only back to the issuer." },
      { label: "Can clawback", yes: true, line: "The issuer can take HTF back from a holder." },
    ]);
  });

  it("says that MPT trading is not enabled yet where the issuer allows it", () => {
    const row = page({ source: indexed({ flags: { ...FLAGS, can_trade: true } }) }).flags.rows[3]!;
    expect(row).toEqual({ label: "Can trade", yes: true, line: "The issuer allows HTF on the DEX. MPT trading isn't enabled on XRPL yet." });
  });

  it("has no row for the locked flag: it is a notice", () => {
    expect(page({ source: indexed({ flags: { ...FLAGS, locked: true } }) }).flags.rows.map((row) => row.label)).not.toContain("Locked");
  });

  it("writes a ticker that holds '$&' as it is: the words are replaced with a function", () => {
    const row = page({ source: indexed({ ticker: "$&A$1", metadata: undefined }) }).flags.rows[2]!;
    expect(row.line).toBe("$&A$1 can be held in escrows.");
  });
});

describe("mptPage: the notices", () => {
  it("is none for an ordinary issuance", () => {
    expect(page().notices).toEqual([]);
  });

  it("says a destroyed issuance was destroyed in its last ledger, and names it", () => {
    expect(page({ source: indexed({ destroyed: true, last_ledger: 107721455 }) }).notices).toEqual([{ text: "This issuance was destroyed in ledger #107,721,455.", ledger: 107721455, tone: "warning" }]);
  });

  it("says the issuer has locked every balance, with the ticker", () => {
    expect(page({ source: indexed({ flags: { ...FLAGS, locked: true } }) }).notices).toEqual([{ text: "The issuer has locked every HTF balance.", tone: "warning" }]);
    // Above scale 19 the amounts say "units", but the notice names the token: the ticker stays.
    expect(page({ source: indexed({ flags: { ...FLAGS, locked: true }, asset_scale: 25 }) }).notices).toEqual([{ text: "The issuer has locked every HTF balance.", tone: "warning" }]);
  });

  // The whole-branch review's M5: with no ticker "HTF" read as "units" made "every units balance", which is not a sentence.
  it("says the issuer has locked every balance, with no word for the token, where the issuance has no ticker", () => {
    const text = "The issuer has locked every balance.";
    expect(page({ source: indexed({ flags: { ...FLAGS, locked: true }, ticker: undefined, metadata: undefined }) }).notices).toEqual([{ text, tone: "warning" }]);
    expect(page({ source: indexed({ flags: { ...FLAGS, locked: true }, ticker: "   ", metadata: undefined }) }).notices).toEqual([{ text, tone: "warning" }]);
  });

  it("says an issuance read from the network is not in the index yet, and keeps the others after it", () => {
    expect(page({ source: fromNode() }).notices).toEqual([{ text: "Not in the index yet, shown from the network", tone: "info" }]);
    expect(page({ source: fromNode({ Flags: 0x01 }) }).notices.map((notice) => notice.text)).toEqual(["Not in the index yet, shown from the network", "The issuer has locked every balance."]);
  });
});

describe("mptHead", () => {
  it("is the metadata's name, the ticker's letter and the ticker, from the metadata", () => {
    expect(mptHead(indexed())).toEqual({
      crumb: "HTF",
      letter: "H",
      heading: "Harborline Treasury Fund",
      ticker: "HTF",
      name: "Harborline Treasury Fund",
      fromMetadata: true,
      issuer: PAGE_ISSUER,
      id: PAGE_ID,
      tickerOrUnits: "HTF",
      amountWord: "HTF",
      scale: 2,
    });
  });

  it("falls back from the name to the ticker, and from the ticker to 'MPT' and the ID's start and end", () => {
    expect(mptHead(indexed({ name: undefined, metadata: undefined })).heading).toBe("HTF");
    const bare = mptHead(indexed({ ticker: undefined, name: undefined, metadata: undefined }));
    expect(bare).toMatchObject({ crumb: "MPT", letter: "?", heading: `MPT ${PAGE_ID.slice(0, 8)}…${PAGE_ID.slice(-4)}`, fromMetadata: false, tickerOrUnits: "units", amountWord: "units" });
    expect(bare).not.toHaveProperty("ticker");
    expect(bare).not.toHaveProperty("name");
    // A name alone is the heading; the circle has no letter.
    expect(mptHead(indexed({ ticker: undefined, metadata: undefined }))).toMatchObject({ heading: "Harborline Treasury Fund", letter: "?", crumb: "MPT", fromMetadata: true });
  });

  it("reads the ticker and the name of the metadata when the row has none of its own", () => {
    expect(mptHead(indexed({ ticker: undefined, name: undefined, metadata: { ticker: "MDT", name: "Meta Name" } }))).toMatchObject({ ticker: "MDT", heading: "Meta Name", letter: "M" });
  });

  it("cuts the ticker to 16 code points and treats a blank one as none; the circle takes the first code point whole", () => {
    expect(mptHead(indexed({ ticker: "😀".repeat(20), metadata: undefined })).ticker).toBe("😀".repeat(16));
    expect(mptHead(indexed({ ticker: "😀AB", metadata: undefined })).letter).toBe("😀");
    expect(mptHead(indexed({ ticker: "   ", name: undefined, metadata: undefined }))).toMatchObject({ crumb: "MPT", letter: "?", tickerOrUnits: "units" });
    expect(mptHead(indexed({ name: "x".repeat(300), metadata: undefined })).heading).toBe("x".repeat(128));
  });

  // The whole-branch review's I1: the head is read without the issuer's bidi controls, so the heading, the crumb, the title, the description and every line that writes the ticker are in reading order.
  it("reads the ticker and the name without their bidi controls: the heading, the title, the description and the lines that write the ticker", () => {
    const source = indexed({ ticker: "‮DSU", name: "⁧Harbor⁩ Fund", metadata: undefined });
    expect(mptHead(source)).toMatchObject({ crumb: "DSU", letter: "D", heading: "Harbor Fund", ticker: "DSU", name: "Harbor Fund", tickerOrUnits: "DSU" });
    const facts = mptFacts(XRPL, source, NO_NAMES);
    expect(facts.title).toBe("DSU · Harbor Fund · MPT");
    expect(facts.description).toBe(`MPT issued by ${PAGE_ISSUER.slice(0, 6)}…${PAGE_ISSUER.slice(-4)}: 18,204,511.20 DSU outstanding, 3,412 holders · XRPL`);
    expect(tile(source, "Outstanding").line).toBe("DSU held by holders, 36.4% of the max amount");
    // Nowhere in what the page draws: its data holds no bidi control.
    expect(JSON.stringify(page({ source }))).not.toMatch(/[؜‎‏‪-‮⁦-⁩]/);
  });

  it("has no scale to apply above 19", () => {
    expect(mptHead(indexed({ asset_scale: 19 })).scale).toBe(19);
    expect(mptHead(indexed({ asset_scale: 20 })).scale).toBeNull();
  });

  it("is the ID's start and end from the network, with the entry's scale and no ticker", () => {
    expect(mptHead(fromNode({ AssetScale: 3 }))).toEqual({ crumb: "MPT", letter: "?", heading: `MPT ${PAGE_ID.slice(0, 8)}…${PAGE_ID.slice(-4)}`, fromMetadata: false, issuer: PAGE_ISSUER, id: PAGE_ID, tickerOrUnits: "units", amountWord: "units", scale: 3 });
    expect(mptHead({ origin: "node", node: entryOf(), ledgerIndex: 1, id: PAGE_ID.toLowerCase() }).id).toBe(PAGE_ID);
  });
});

const metadataOf = (over: Partial<MptIssuance>) => page({ source: indexed(over) }).metadata;

describe("mptPage: the metadata card", () => {
  const FULL: NonNullable<MptIssuance["metadata"]> = {
    ticker: "HTF",
    name: "Harborline Treasury Fund",
    desc: "A fund.",
    icon: "https://harborline.example/icon.png",
    asset_class: "rwa",
    asset_subclass: "treasury",
    issuer_name: "Harborline Capital",
    uris: [
      { uri: "https://harborline.example/fund", category: "website", title: "Fund" },
      { uri: "harborline.example/docs/htf", category: "docs", title: "Docs" },
    ],
    additional_info: { interest_rate: "4.1%", custodian: "Harborline" },
  };

  it("lists the decoded fields in XLS-89's order, labelled by their long key, with the hex and its size", () => {
    const view = metadataOf({ metadata: FULL, metadata_hex: "AB".repeat(40) });
    expect(view).toMatchObject({ state: "decoded", conforms: true, hex: "AB".repeat(40), bytes: 40 });
    if (view.state !== "decoded") throw new Error("not decoded");
    expect(view.rows.map((row) => row.key)).toEqual(["ticker", "name", "desc", "icon", "asset_class", "asset_subclass", "issuer_name", "uris", "uris", "additional_info"]);
    expect(view.rows[4]).toEqual({ key: "asset_class", text: "rwa (real-world asset)" });
    expect(view.rows[5]).toEqual({ key: "asset_subclass", text: "treasury" });
  });

  it("gives the icon a link only through safeLink, and each uri '{title} · {host/path}' as a link, its category in the title", () => {
    const view = metadataOf({ metadata: FULL });
    if (view.state !== "decoded") throw new Error("not decoded");
    expect(view.rows[3]).toEqual({ key: "icon", text: "https://harborline.example/icon.png", href: "https://harborline.example/icon.png" });
    expect(view.rows[7]).toEqual({ key: "uris", text: "Fund · harborline.example/fund", href: "https://harborline.example/fund", title: "website" });
    expect(view.rows[8]).toEqual({ key: "uris", text: "Docs · harborline.example/docs/htf", href: "https://harborline.example/docs/htf", title: "docs" });
  });

  it("writes a uri that is not a safe link as text, with no href and no title, whatever its category", () => {
    const view = metadataOf({ metadata: { uris: [{ uri: "javascript:alert(1)", category: "website", title: "Click" }, { uri: "http://plain.example/x", title: "Plain" }, { uri: "ipfs://Qm123" }] } });
    if (view.state !== "decoded") throw new Error("not decoded");
    expect(view.rows).toEqual([
      { key: "uris", text: "Click · javascript:alert(1)" },
      { key: "uris", text: "Plain · http://plain.example/x" },
      { key: "uris", text: "ipfs://Qm123" },
    ]);
    for (const row of view.rows) expect(row).not.toHaveProperty("href");
  });

  it("lets only XLS-89's own categories become a title: the issuer's other words never reach an attribute", () => {
    const view = metadataOf({ metadata: { uris: [{ uri: "https://a.example/x", category: '"><img src=x>' }, { uri: "https://b.example/x", category: "Social" }, { uri: "https://c.example/x" }] } });
    if (view.state !== "decoded") throw new Error("not decoded");
    expect(view.rows.map((row) => row.title)).toEqual([undefined, "social", undefined]);
    expect(view.rows[0]!.href).toBe("https://a.example/x");
  });

  // The whole-branch review's I1: the issuer's text rows are read without bidi controls, as its ticker and name are. The raw hex, in the `<details>`, keeps the bytes; a link is made of what the issuer
  // wrote, which `safeLink` checks.
  it("takes the bidi controls out of the text rows, the uri titles and their link text, the additional info and the raw text, and keeps the hex as it is", () => {
    const RLO = "‮";
    const view = metadataOf({
      metadata_hex: `${RLO}AB`,
      metadata: {
        desc: `A ${RLO}fund.`,
        asset_class: `fu${RLO}nd`,
        issuer_name: `Harbor${RLO}line`,
        icon: `https://harborline.example/${RLO}icon.png`,
        uris: [{ uri: `https://harborline.example/${RLO}fund`, category: "website", title: `${RLO}Fund` }],
        additional_info: `see ${RLO}this`,
      },
    });
    if (view.state !== "decoded") throw new Error("not decoded");
    expect(view.rows.map((row) => row.text)).toEqual(["A fund.", "https://harborline.example/icon.png", "fund", "Harborline", "Fund · harborline.example/fund", "see this"]);
    expect(view.hex).toBe(`${RLO}AB`);
    const json = metadataOf({ metadata: { additional_info: { note: `a${RLO}b` } } });
    if (json.state !== "decoded") throw new Error("not decoded");
    expect(json.rows[0]!.text).toBe(JSON.stringify({ note: "ab" }, null, 2));
    const hex = Array.from(new TextEncoder().encode(`https://harborline.example/${RLO}meta.json`), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    expect(metadataOf({ metadata: undefined, metadata_hex: hex, metadata_conforms: false })).toMatchObject({ state: "raw", text: "https://harborline.example/meta.json", hex });
  });

  it("writes the icon as text when it is not a safe link", () => {
    const view = metadataOf({ metadata: { icon: "javascript:alert(1)" } });
    if (view.state !== "decoded") throw new Error("not decoded");
    expect(view.rows).toEqual([{ key: "icon", text: "javascript:alert(1)" }]);
  });

  it("shows an asset class that is none of the six as written, and one that is a name of Object's own prototype too", () => {
    for (const asset_class of ["fund", "constructor", "__proto__", "toString"]) {
      const view = metadataOf({ metadata: { asset_class } });
      if (view.state !== "decoded") throw new Error("not decoded");
      expect(view.rows).toEqual([{ key: "asset_class", text: asset_class }]);
    }
    const words = (asset_class: string) => (metadataOf({ metadata: { asset_class } }) as { rows: Array<{ text: string }> }).rows[0]!.text;
    expect(["memes", "wrapped", "gaming", "defi", "other"].map(words)).toEqual(["memes", "wrapped (a token of another chain)", "gaming", "defi (decentralised finance)", "other"]);
  });

  it("draws additional_info as indented JSON in a code block when it is an object, and as text when it is a string", () => {
    const object = metadataOf({ metadata: { additional_info: { a: "1", b: { c: 2 } } } });
    if (object.state !== "decoded") throw new Error("not decoded");
    expect(object.rows).toEqual([{ key: "additional_info", text: JSON.stringify({ a: "1", b: { c: 2 } }, null, 2), code: true }]);
    const text = metadataOf({ metadata: { additional_info: "see the prospectus" } });
    if (text.state !== "decoded") throw new Error("not decoded");
    expect(text.rows).toEqual([{ key: "additional_info", text: "see the prospectus" }]);
  });

  it("cuts additional_info to 2,000 characters, as a string and as JSON", () => {
    const huge = metadataOf({ metadata: { additional_info: { notes: "n".repeat(50_000) } } });
    if (huge.state !== "decoded") throw new Error("not decoded");
    expect(huge.rows[0]!.text).toHaveLength(2000);
    expect(huge.rows[0]!.code).toBe(true);
    const long = metadataOf({ metadata: { additional_info: "x".repeat(50_000) } });
    if (long.state !== "decoded") throw new Error("not decoded");
    expect(long.rows[0]!.text).toHaveLength(2000);
  });

  it("says metadata that decoded to nothing, and does not conform, has no rows and does not follow XLS-89", () => {
    const view = metadataOf({ metadata: {}, metadata_conforms: false, metadata_hex: "7B7D" });
    expect(view).toEqual({ state: "decoded", rows: [], conforms: false, hex: "7B7D", bytes: 2 });
  });

  it("says a metadata that does not conform so, and keeps the rows it has", () => {
    const view = metadataOf({ metadata: { name: "Odd" }, metadata_conforms: false });
    expect(view).toMatchObject({ state: "decoded", conforms: false, rows: [{ key: "name", text: "Odd" }] });
  });

  it("is 'none' for an issuance with no metadata and no hex", () => {
    expect(metadataOf({ metadata: undefined, metadata_hex: undefined, metadata_conforms: undefined })).toEqual({ state: "none" });
  });

  it("is raw for a hex that did not decode: its text when it reads as UTF-8 text, and null when it does not", () => {
    const text = "https://harborline.example/meta.json";
    const hex = Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    expect(metadataOf({ metadata: undefined, metadata_hex: hex, metadata_conforms: false })).toEqual({ state: "raw", text, hex, bytes: text.length, fromNode: false });
    expect(metadataOf({ metadata: undefined, metadata_hex: "FFFE00", metadata_conforms: false })).toEqual({ state: "raw", text: null, hex: "FFFE00", bytes: 3, fromNode: false });
  });

  it("reads the node's hex as written, with its text, and says it came from the network", () => {
    const hex = "68656C6C6F";
    expect(page({ source: fromNode({ MPTokenMetadata: hex }) }).metadata).toEqual({ state: "raw", text: "hello", hex, bytes: 5, fromNode: true });
    expect(page({ source: fromNode({ MPTokenMetadata: "00FF" }) }).metadata).toEqual({ state: "raw", text: null, hex: "00FF", bytes: 2, fromNode: true });
    expect(page({ source: fromNode() }).metadata).toEqual({ state: "none" });
  });
});

describe("the holders' rows and the top line", () => {
  const head = mptHead(indexed());
  const context = { head, outstanding: "1820451120" };

  it("writes the balance as amount and escrowed amount together, scaled, with what of it is in escrow under it", () => {
    const [plain, escrowed] = mptHolderRows(holdersPage([holderOf(A(1), "612000000"), holderOf(A(2), "100000", { escrowed_amount: "1200" })]), context, 1);
    expect(plain).toMatchObject({ rank: 1, holder: A(1), units: "612000000", balance: "6,120,000.00", escrow: null, locked: false });
    expect(escrowed).toMatchObject({ rank: 2, units: "101200", balance: "1,012.00", escrow: "incl. 12.00 in escrow" });
  });

  it("writes the share of the outstanding amount with two decimals from the exact integers, and '<0.01%' below the step", () => {
    const rows = mptHolderRows(holdersPage([holderOf(A(1), "612000000"), holderOf(A(2), "1"), holderOf(A(3), "182046")]), context, 1);
    // 612,000,000 / 1,820,451,120 is 33.6168…%; 1 unit is far below 0.01% of it, and 182,046 units are just over it (0.0100005…%).
    expect(rows.map((row) => row.share)).toEqual(["33.62%", "<0.01%", "0.01%"]);
    expect(rows[0]!.meter).toEqual({ value: "612000000", max: "612000000", label: "33.62% of the outstanding HTF" });
    expect(rows[2]!.meter).toEqual({ value: "182046", max: "612000000", label: "0.01% of the outstanding HTF" });
  });

  it("marks a locked balance, and gives the rank from where the page starts, or none where it is not known", () => {
    const page_ = holdersPage([holderOf(A(1), "5", { locked: true }), holderOf(A(2), "4")]);
    expect(mptHolderRows(page_, context, 51).map((row) => [row.rank, row.locked])).toEqual([[51, true], [52, false]]);
    expect(mptHolderRows(page_, context, null).map((row) => row.rank)).toEqual([null, null]);
  });

  it("scales by nothing above 19 and has a meter that is safe for a first balance of 0", () => {
    const unscaled = mptHolderRows(holdersPage([holderOf(A(1), "12345")]), { head: mptHead(indexed({ asset_scale: 30 })), outstanding: "20000" }, 1);
    expect(unscaled[0]).toMatchObject({ balance: "12,345", share: "61.73%" });
    expect(mptHolderRows(holdersPage([holderOf(A(1), "0")]), context, 1)[0]!.meter.max).toBe("1");
  });

  it("writes the top line from two rows on, as the sum of their balances over the outstanding amount, and none from one", () => {
    const ten = holdersPage(Array.from({ length: 10 }, (_, at) => holderOf(A(at + 1), "100000000")));
    expect(topLineOf(mptHolderRows(ten, context, 1), context)).toBe("The top 10 hold 54.93% of the outstanding HTF.");
    expect(topLineOf(mptHolderRows(holdersPage([holderOf(A(1), "100000000"), holderOf(A(2), "100000000")]), context, 1), context)).toBe("The top 2 hold 10.99% of the outstanding HTF.");
    expect(topLineOf(mptHolderRows(holdersPage([holderOf(A(1), "100000000")]), context, 1), context)).toBeNull();
    expect(topLineOf([], context)).toBeNull();
  });

  it("writes no top line when there is nothing to share", () => {
    const rows = mptHolderRows(holdersPage([holderOf(A(1), "1"), holderOf(A(2), "1")]), { head, outstanding: "0" }, 1);
    expect(topLineOf(rows, { head, outstanding: "0" })).toBeNull();
  });
});

describe("mptPage: the Top holders card", () => {
  const ten = holdersPage(Array.from({ length: 10 }, (_, at) => holderOf(A(at + 1), "100000000")));

  it("has the rows, the top line, the link to all the holders with their count, and no note when the index is complete", () => {
    const { holders } = page({ holders: { ...OK, value: ten } });
    expect(holders).toMatchObject({
      state: "ok",
      outstanding: "18,204,511.20",
      topLine: "The top 10 hold 54.93% of the outstanding HTF.",
      total: 3412,
      allHref: `/xrpl/mpt/${PAGE_ID}/holders`,
      allLabel: "All 3,412 holders →",
      empty: null,
      coverage: null,
      notes: [],
    });
    if (holders.state !== "ok") throw new Error("not ok");
    expect(holders.rows).toHaveLength(10);
    expect(holders.rows[0]!.rank).toBe(1);
  });

  it("says 'All 1 holder' for one, and 'All holders' where the count is not known", () => {
    expect((page({ source: indexed({ holders: 1 }), holders: { ...OK, value: holdersPage([holderOf(A(1), "5")]) } }).holders as { allLabel: string }).allLabel).toBe("All 1 holder →");
    expect((page({ source: fromNode(), holders: { ...OK, value: holdersPage([holderOf(A(1), "5")]) } }).holders as { allLabel: string; total: number | null }).allLabel).toBe("All holders →");
  });

  it("adds the coverage note, then 'A holder whose balance has not changed since is not listed yet.', while the index is incomplete", () => {
    const { holders } = page({ holders: { ...OK, value: holdersPage([holderOf(A(1), "5")], { coverage: INCOMPLETE }) } });
    if (holders.state !== "ok") throw new Error("not ok");
    expect(holders.coverage).toEqual({ before: "Covers ledger ", ledger: 99226369, after: " onwards: earlier holders are not in the index yet." });
    expect(holders.notes).toEqual(["A holder whose balance has not changed since is not listed yet."]);
  });

  it("says nobody holds the token, and 'yet in the index' while the index is incomplete", () => {
    const empty = (coverage: typeof COMPLETE) => (page({ holders: { ...OK, value: holdersPage([], { coverage }) } }).holders as { empty: string | null }).empty;
    expect(empty(COMPLETE)).toBe("Nobody holds HTF.");
    expect(empty(INCOMPLETE)).toBe("Nobody holds HTF yet in the index.");
  });

  it("is missing where the index has no rows for the issuance, and failed where the call failed, each on its own", () => {
    expect(page({ holders: { state: "missing" } }).holders).toEqual({ state: "missing" });
    expect(page({ holders: { state: "failed" } }).holders).toEqual({ state: "failed" });
    // The other card is whole.
    expect(page({ holders: { state: "failed" }, transfers: { ...OK, value: transfersPage([transferOf()]) } }).transfers.state).toBe("ok");
  });
});

describe("mptPage: the Recent transfers card", () => {
  it("writes the kinds in decision 9's words", () => {
    const kinds = ["payment", "clawback", "lock", "unlock", "escrow_create", "escrow_finish", "escrow_cancel"] as const;
    const rows = mptTransferRows(transfersPage(kinds.map((kind) => transferOf({ kind }))), mptHead(indexed()));
    expect(rows.map((row) => row.kind)).toEqual(["Transfer", "Clawback", "Lock", "Unlock", "Escrow", "Escrow finished", "Escrow cancelled"]);
  });

  it("writes the time as Unix seconds, the parties, the amount scaled and the hash", () => {
    const [row] = mptTransferRows(transfersPage([transferOf({ amount: "250000" })]), mptHead(indexed()));
    expect(row).toEqual({
      time: Date.parse("2026-10-02T16:27:51Z") / 1000,
      kind: "Transfer",
      from: PAGE_ISSUER,
      to: "rKSg2VZbw9gRRuSwBjBFAfBoGC5Vs1FmFn",
      everyHolder: false,
      amount: "2,500.00",
      muted: false,
      hash: "AB".repeat(32),
    });
  });

  it("says 'every holder' for a lock or an unlock with no destination, and mutes a lock's amount alone", () => {
    const rows = mptTransferRows(
      transfersPage([
        transferOf({ kind: "lock", destination: undefined }),
        transferOf({ kind: "unlock", destination: undefined }),
        transferOf({ kind: "lock", destination: A(1) }),
        transferOf({ kind: "payment", destination: undefined }),
        transferOf({ kind: "clawback" }),
      ]),
      mptHead(indexed()),
    );
    expect(rows.map((row) => [row.everyHolder, row.muted, row.to === null])).toEqual([
      [true, true, true],
      [true, false, true],
      [false, true, false],
      [false, false, true],
      [false, false, false],
    ]);
  });

  it("has the board's footnote with the issuer by its plain name, or by its short address", () => {
    const words = (names: NamesPart) => {
      const { transfers } = page({ names, transfers: { ...OK, value: transfersPage([transferOf()]) } });
      return transfers.state === "ok" ? transfers.footnote : "";
    };
    const tail = "issues new HTF. A clawback takes HTF back. A lock stops a balance from moving; its amount is the balance locked.";
    expect(words(named("Harborline"))).toBe(`Newest first. A transfer from Harborline ${tail}`);
    expect(words(NO_NAMES)).toBe(`Newest first. A transfer from ${PAGE_ISSUER.slice(0, 6)}…${PAGE_ISSUER.slice(-4)} ${tail}`);
  });

  it("links Older with the marker of its call, and has none where the call had none; the coverage note is the one of the transfers", () => {
    const { transfers } = page({ transfers: { ...OK, value: transfersPage([transferOf()], { marker: "WzEsMl0", coverage: INCOMPLETE }) } });
    if (transfers.state !== "ok") throw new Error("not ok");
    expect(transfers.olderHref).toBe(`/xrpl/mpt/${PAGE_ID}/transfers?marker=WzEsMl0`);
    expect(transfers.note).toEqual({ before: "Covers ledger ", ledger: 99226369, after: " onwards: earlier transfers are not in the index yet." });
    const last = page({ transfers: { ...OK, value: transfersPage([transferOf()]) } }).transfers;
    expect(last).toMatchObject({ state: "ok", olderHref: null, note: null, empty: null });
  });

  it("says there is no transfer in the index, and is missing or failed on its own", () => {
    expect(page().transfers).toMatchObject({ state: "ok", empty: "No transfers of HTF in the index." });
    expect(page({ transfers: { state: "missing" } }).transfers).toEqual({ state: "missing" });
    expect(page({ transfers: { state: "failed" } }).transfers).toEqual({ state: "failed" });
  });
});

describe("mptPage: the tags' and the card's facts", () => {
  it("names the canonical path of the page, in capitals, for the tags' module that may not import the words", () => {
    expect(mptFacts(XRPL, indexed(), NO_NAMES).href).toBe(`/xrpl/mpt/${PAGE_ID}`);
    expect(mptFacts({ id: "xahau", name: "Xahau" }, fromNode(), NO_NAMES).href).toBe(`/xahau/mpt/${PAGE_ID}`);
  });

  it("writes the title of an issuance with a ticker and a name, with a ticker alone, a name alone, and neither", () => {
    expect(mptFacts(XRPL, indexed(), NO_NAMES).title).toBe("HTF · Harborline Treasury Fund · MPT");
    expect(mptFacts(XRPL, indexed({ name: undefined, metadata: undefined }), NO_NAMES).title).toBe("HTF · MPT");
    expect(mptFacts(XRPL, indexed({ ticker: undefined, metadata: undefined }), NO_NAMES).title).toBe("Harborline Treasury Fund · MPT");
    expect(mptFacts(XRPL, indexed({ ticker: undefined, name: undefined, metadata: undefined }), NO_NAMES).title).toBe(`MPT ${PAGE_ID.slice(0, 8)}…${PAGE_ID.slice(-4)}`);
  });

  it("writes the description with the issuer's display name, the outstanding amount, the holders and the network", () => {
    expect(mptFacts(XRPL, indexed(), named("Harborline")).description).toBe("MPT issued by Harborline: 18,204,511.20 HTF outstanding, 3,412 holders · XRPL");
    expect(mptFacts(XRPL, indexed({ holders: 1 }), NO_NAMES).description).toBe(`MPT issued by ${PAGE_ISSUER.slice(0, 6)}…${PAGE_ISSUER.slice(-4)}: 18,204,511.20 HTF outstanding, 1 holder · XRPL`);
  });

  it("is indexable from the index and not from the network, where it has no holders to say", () => {
    expect(mptFacts(XRPL, indexed(), NO_NAMES).noindex).toBe(false);
    const node = mptFacts(XRPL, fromNode({ AssetScale: 2, OutstandingAmount: "1820451120" }), NO_NAMES);
    expect(node.noindex).toBe(true);
    expect(node.description).toBe(`MPT issued by ${PAGE_ISSUER.slice(0, 6)}…${PAGE_ISSUER.slice(-4)}: 18,204,511.20 units outstanding · XRPL`);
    expect(node.title).toBe(`MPT ${PAGE_ID.slice(0, 8)}…${PAGE_ID.slice(-4)}`);
  });

  it("gives the card its headline, name, issuer, compact outstanding amount, holders and creation time", () => {
    expect(mptFacts(XRPL, indexed(), named("Harborline")).card).toEqual({
      headline: "HTF",
      name: "Harborline Treasury Fund",
      issuer: "Harborline",
      outstanding: "18.2M HTF",
      holders: 3412,
      created: Date.parse("2025-10-09T08:30:00Z") / 1000,
    });
    const bare = mptFacts(XRPL, fromNode(), NO_NAMES).card;
    expect(bare).toEqual({ headline: `${PAGE_ID.slice(0, 8)}…${PAGE_ID.slice(-4)}`, issuer: `${PAGE_ISSUER.slice(0, 6)}…${PAGE_ISSUER.slice(-4)}`, outstanding: "0 units" });
  });
});

describe("mptFacts: the card's text (Task 14)", () => {
  const SHORT_ID = `${PAGE_ID.slice(0, 8)}…${PAGE_ID.slice(-4)}`;

  it("names the issuance's ID in capitals, for the tags' module that writes the link-preview image's path from it", () => {
    expect(mptFacts(XRPL, indexed(), NO_NAMES).id).toBe(PAGE_ID);
    expect(mptFacts(XRPL, fromNode(), NO_NAMES).id).toBe(PAGE_ID);
    expect(mptFacts(XRPL, { origin: "node", node: entryOf(), ledgerIndex: 1, id: PAGE_ID.toLowerCase() }, NO_NAMES).id).toBe(PAGE_ID);
  });

  // The whole-branch review's I1, one rule for the issuer's text: the tab, the card, the tags and the pages read the ticker and the name without the bidi controls that would turn the words around them.
  it("gives the card, the title and the description the ticker and the name without their bidi controls", () => {
    const facts = mptFacts(XRPL, indexed({ ticker: "H\u202ETF", name: "Harbor\u2066line\u200F Fund", metadata: undefined }), NO_NAMES);
    expect(facts.card).toMatchObject({ headline: "HTF", name: "Harborline Fund", outstanding: "18.2M HTF" });
    expect(facts.title).toBe("HTF · Harborline Fund · MPT");
    expect(facts.description).toContain("18,204,511.20 HTF outstanding");
  });

  it("reads a ticker or a name of controls alone as none: the ID's start and end, units, and no name", () => {
    const { card } = mptFacts(XRPL, indexed({ ticker: "\u202E\u202C", name: "\u2066\u2069", metadata: undefined }), NO_NAMES);
    expect(card).toEqual({ headline: SHORT_ID, issuer: `${PAGE_ISSUER.slice(0, 6)}…${PAGE_ISSUER.slice(-4)}`, outstanding: "18.2M units", holders: 3412, created: Date.parse("2025-10-09T08:30:00Z") / 1000 });
  });

  it("reads the ticker as the head does for the card too: 16 code points, and a blank one is none", () => {
    expect(mptFacts(XRPL, indexed({ ticker: "ABCDEFGHIJKLMNOPQRST", metadata: undefined }), NO_NAMES).card).toMatchObject({ headline: "ABCDEFGHIJKLMNOP", outstanding: "18.2M ABCDEFGHIJKLMNOP" });
    expect(mptFacts(XRPL, indexed({ ticker: "😀".repeat(20), metadata: undefined }), NO_NAMES).card.headline).toBe("😀".repeat(16));
    expect(mptFacts(XRPL, indexed({ ticker: "   ", metadata: undefined }), NO_NAMES).card).toMatchObject({ headline: SHORT_ID, outstanding: "18.2M units" });
  });
});

describe("mptPage", () => {
  it("names the network, the origin, the caption of the cards and passes the names on", () => {
    const data = page({ names: named() });
    expect(data).toMatchObject({ kind: "mpt", origin: "index", source: `/v2/mpt/${PAGE_ID}`, network: { id: "xrpl", name: "XRPL" } });
    expect(data.names).toEqual(named());
    expect(data.network).not.toHaveProperty("features");
    expect(data.facts).toEqual(mptFacts(XRPL, indexed(), named()));
  });

  it("says where the page was read from, and at which ledger, when it is the network's", () => {
    expect(page({ source: fromNode() })).toMatchObject({ origin: "node", source: "ledger_entry · mpt_issuance · ledger #107,721,455" });
  });

  it("serves the holders and transfers cards of a page read from the network when they answered", () => {
    const data = page({ source: fromNode({ AssetScale: 2, OutstandingAmount: "1820451120" }), holders: { ...OK, value: holdersPage([holderOf(A(1), "612000000")]) } });
    expect(data.holders).toMatchObject({ state: "ok", total: null, rows: [{ balance: "6,120,000.00", share: "33.62%" }] });
  });

  // The whole-branch review's M6: the ticker is the issuer's text too (cut to 16 code points it is `"><img src=x one`); the only strings the page data puts in an attribute are its hrefs, and none holds it.
  it("holds nothing the issuer wrote in a field the page puts in an attribute but the hrefs", () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const data = page({ source: indexed({ ticker: hostile, name: hostile, metadata: { icon: hostile, uris: [{ uri: "javascript:alert(1)", title: hostile, category: hostile }] } }) });
    const view = data.metadata;
    if (view.state !== "decoded") throw new Error("not decoded");
    expect(view.rows.filter((row) => row.href !== undefined || row.title !== undefined)).toEqual([]);
    expect(data.head.ticker).toBe('"><img src=x one');
    const hrefs: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === "object" && value !== null)
        for (const [key, inner] of Object.entries(value)) {
          if (/href$/i.test(key) && typeof inner === "string") hrefs.push(inner);
          walk(inner);
        }
    };
    walk(data);
    expect(hrefs).not.toEqual([]);
    for (const href of hrefs) expect(href).not.toMatch(/img|onerror|alert|"/);
  });
});

// ---- The holders' and the transfers' pages (Task 11) ----------------------------------------------------------------------------------------------------------------------------------

describe("mptHoldersPage", () => {
  const holders = holdersPage([holderOf(A(1), "612000000"), holderOf(A(2), "100000", { escrowed_amount: "1200", locked: true })]);
  const build = (over: Partial<Parameters<typeof mptHoldersPage>[0]> = {}) => mptHoldersPage({ net: XRPL, source: indexed(), page: { ...OK, value: holders }, view: { back: [] }, names: NO_NAMES, ...over });

  it("is the head, the heading, what is held, the way back and the call it is made from", () => {
    const data = build();
    expect(data).toMatchObject({
      kind: "mpt-holders",
      origin: "index",
      network: { id: "xrpl", name: "XRPL" },
      title: "Holders of HTF",
      summary: "3,412 accounts hold 18,204,511.20 HTF",
      back: { href: `/xrpl/mpt/${PAGE_ID}`, label: "Back to HTF" },
      source: `/v2/mpt/${PAGE_ID}/holders`,
      notices: [],
    });
    expect(data.head).toEqual(mptHead(indexed()));
    expect(data.names).toBe(NO_NAMES);
  });

  it("says 1 account holds, and without the count where the head is from the network", () => {
    expect(build({ source: indexed({ holders: 1 }) }).summary).toBe("1 account holds 18,204,511.20 HTF");
    const node = build({ source: fromNode({ AssetScale: 2, OutstandingAmount: "1820451120" }) });
    expect(node.summary).toBe("18,204,511.20 units outstanding");
    expect(node.notices).toEqual([{ text: "Not in the index yet, shown from the network", tone: "info" }]);
    expect(node.origin).toBe("node");
  });

  it("names the page by the ticker, else by the heading", () => {
    expect(build().title).toBe("Holders of HTF");
    expect(build({ source: indexed({ ticker: undefined, metadata: undefined }) }).title).toBe("Holders of Harborline Treasury Fund");
    expect(build({ source: indexed({ ticker: undefined, name: undefined, metadata: undefined }) }).title).toBe(`Holders of MPT ${PAGE_ID.slice(0, 8)}…${PAGE_ID.slice(-4)}`);
  });

  it("has the rows of the first page ranked from 1, with the balance, the escrow under it, the share and whether it is locked", () => {
    const { holders: list } = build();
    if (list.state !== "ok") throw new Error("not ok");
    expect(list.ranked).toBe(true);
    expect(list.rows.map((row) => [row.rank, row.balance, row.escrow, row.share, row.locked])).toEqual([
      [1, "6,120,000.00", null, "33.62%", false],
      [2, "1,012.00", "incl. 12.00 in escrow", "<0.01%", true],
    ]);
    expect(list.empty).toBeNull();
    expect(list.coverage).toBeNull();
    expect(list.notes).toEqual([]);
  });

  it("has no rank behind a marker: the API gives none and the trail does not tell the place", () => {
    const { holders: list } = build({ view: { marker: "M2", back: ["M1"] } });
    if (list.state !== "ok") throw new Error("not ok");
    expect(list.ranked).toBe(false);
    expect(list.rows.map((row) => row.rank)).toEqual([null, null]);
  });

  it("links Newer and Older by the trail: the first page has no Newer, the next page's marker is Older's, and Newer goes back along the trail", () => {
    const first = build({ page: { ...OK, value: holdersPage([holderOf(A(1), "5")], { marker: "M2" }) } }).holders;
    if (first.state !== "ok") throw new Error("not ok");
    expect(first.pager).toEqual({ newerHref: null, olderHref: `/xrpl/mpt/${PAGE_ID}/holders?marker=M2` });
    const third = build({ view: { marker: "M3", back: ["M2", "M1"] }, page: { ...OK, value: holdersPage([holderOf(A(1), "5")], { marker: "M4" }) } }).holders;
    if (third.state !== "ok") throw new Error("not ok");
    expect(third.pager).toEqual({ newerHref: `/xrpl/mpt/${PAGE_ID}/holders?marker=M2&back=M1`, olderHref: `/xrpl/mpt/${PAGE_ID}/holders?marker=M4&back=M3.M2.M1` });
    const second = build({ view: { marker: "M2", back: [] }, page: { ...OK, value: holdersPage([holderOf(A(1), "5")]) } }).holders;
    if (second.state !== "ok") throw new Error("not ok");
    expect(second.pager).toEqual({ newerHref: `/xrpl/mpt/${PAGE_ID}/holders`, olderHref: null });
  });

  it("has the coverage note and the line after it while the index is incomplete, and says nobody holds the token", () => {
    const { holders: list } = build({ page: { ...OK, value: holdersPage([], { coverage: INCOMPLETE }) } });
    if (list.state !== "ok") throw new Error("not ok");
    expect(list.coverage).toEqual({ before: "Covers ledger ", ledger: 99226369, after: " onwards: earlier holders are not in the index yet." });
    expect(list.notes).toEqual(["A holder whose balance has not changed since is not listed yet."]);
    expect(list.empty).toBe("Nobody holds HTF yet in the index.");
    expect((build({ page: { ...OK, value: holdersPage([]) } }).holders as { empty: string }).empty).toBe("Nobody holds HTF.");
  });

  it("is missing or failed on its own, with the head whole", () => {
    expect(build({ page: { state: "missing" } }).holders).toEqual({ state: "missing" });
    expect(build({ page: { state: "failed" } }).holders).toEqual({ state: "failed" });
    expect(build({ page: { state: "failed" } }).title).toBe("Holders of HTF");
  });

  it("writes the facts of the tags: the code, the issuer, the first page's path, and whether it is behind a marker", () => {
    expect(build().meta).toEqual({ code: "HTF", issuer: PAGE_ISSUER, href: `/xrpl/mpt/${PAGE_ID}/holders`, more: false, noindex: false });
    expect(build({ view: { marker: "M2", back: [] } }).meta).toMatchObject({ href: `/xrpl/mpt/${PAGE_ID}/holders`, more: true });
    // The whole-branch review's M2: a head read from the network is `noindex`, as the issuance's page is.
    expect(build({ source: fromNode(), page: { state: "missing" } }).meta).toMatchObject({ noindex: true });
  });
});

describe("mptTransfersPage", () => {
  const transfers = transfersPage([transferOf(), transferOf({ kind: "lock", destination: undefined })], { marker: "M2" });
  const build = (over: Partial<Parameters<typeof mptTransfersPage>[0]> = {}) => mptTransfersPage({ net: XRPL, source: indexed(), page: { ...OK, value: transfers }, view: { back: [] }, names: NO_NAMES, ...over });

  it("is the head, the heading, the way back and the call it is made from", () => {
    expect(build()).toMatchObject({
      kind: "mpt-transfers",
      title: "Transfers of HTF",
      summary: "3,412 accounts hold 18,204,511.20 HTF",
      back: { href: `/xrpl/mpt/${PAGE_ID}`, label: "Back to HTF" },
      source: `/v2/mpt/${PAGE_ID}/transfers`,
    });
  });

  it("has the rows of the MPT page's card, the footnote with the issuer's name, the coverage note, and Older with the call's marker", () => {
    const { transfers: list } = build({ names: named("Harborline"), page: { ...OK, value: { ...transfers, coverage: INCOMPLETE } } });
    if (list.state !== "ok") throw new Error("not ok");
    expect(list.rows.map((row) => [row.kind, row.everyHolder, row.muted])).toEqual([["Transfer", false, false], ["Lock", true, true]]);
    expect(list.footnote.startsWith("Newest first. A transfer from Harborline issues new HTF.")).toBe(true);
    expect(list.note).toEqual({ before: "Covers ledger ", ledger: 99226369, after: " onwards: earlier transfers are not in the index yet." });
    expect(list.pager).toEqual({ newerHref: null, olderHref: `/xrpl/mpt/${PAGE_ID}/transfers?marker=M2` });
    expect(list.empty).toBeNull();
  });

  it("links Newer along the trail behind a marker, and says there is no transfer", () => {
    const { transfers: list } = build({ view: { marker: "M2", back: ["M1"] }, page: { ...OK, value: transfersPage([], { coverage: COMPLETE }) } });
    if (list.state !== "ok") throw new Error("not ok");
    expect(list.pager).toEqual({ newerHref: `/xrpl/mpt/${PAGE_ID}/transfers?marker=M1`, olderHref: null });
    expect(list.empty).toBe("No transfers of HTF in the index.");
  });

  it("is missing or failed on its own, writes the facts of the tags, and is noindex behind a marker", () => {
    expect(build({ page: { state: "missing" } }).transfers).toEqual({ state: "missing" });
    expect(build({ page: { state: "failed" } }).transfers).toEqual({ state: "failed" });
    expect(build().meta).toEqual({ code: "HTF", issuer: PAGE_ISSUER, href: `/xrpl/mpt/${PAGE_ID}/transfers`, more: false, noindex: false });
    expect(build({ view: { marker: "M2", back: [] } }).meta.more).toBe(true);
    expect(build({ source: fromNode(), page: { state: "missing" } }).meta).toMatchObject({ noindex: true });
  });
});

describe("noMptPage", () => {
  it("names the network, the other one and the ID, for the page that says MPT is not on Xahau", () => {
    expect(noMptPage({ id: "xahau", kind: "mainnet", other: "xrpl" }, PAGE_ID)).toEqual({
      kind: "no-mpt",
      network: { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX" },
      other: { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX" },
      id: PAGE_ID,
    });
  });

  it("uses the names of the sandbox in the sandbox: XRPL Testnet is the other one", () => {
    const data = noMptPage({ id: "xahau", kind: "testnet", other: "xrpl" }, PAGE_ID);
    expect(data.network.name).toBe("Xahau Testnet");
    expect(data.other).toMatchObject({ id: "xrpl", name: "XRPL Testnet" });
  });
});

// ---- The MPT tab of the token list (E14 spec 4, Task 12) -------------------------------------------------------------------------------------------------------------------------------

describe("mptTokensTab", () => {
  const TESTNET = networkOf("xrpl", { ...WORLD_ENV, ENVIRONMENT: "sandbox" });
  const tab = (answer = mptTokensSample(), o: { q?: string } = {}) => mptTokensTab(answer, { net: XRPL, ...o });
  const row = (over: Parameters<typeof mptTokenRowSample>[0] = {}, o: { q?: string } = {}) => tab(mptTokensSample({ tokens: [mptTokenRowSample(over)] }), o).mpt!.rows[0]!;

  it("writes the intro, the source line and the search's words, on the network's own name", () => {
    const { intro, source, search } = tab();
    expect(intro).toBe("Tokens on XRPL, ranked by holders. Tickers and names come from each issuance's metadata.");
    expect(source).toBe("/v2/tokens?kind=mpt");
    expect(search).toEqual({ label: "Ticker, name, issuer or issuance ID", placeholder: "Ticker, name, issuer or issuance ID" });
    expect(mptTokensTab(mptTokensSample(), { net: TESTNET }).intro).toBe("Tokens on XRPL Testnet, ranked by holders. Tickers and names come from each issuance's metadata.");
  });

  it("has the three tiles of the totals, with the board's lines", () => {
    expect(tab().tiles).toEqual([
      { label: "MPT issuances", value: "214", sub: "on XRPL, with any number of holders" },
      { label: "Holders", value: "9,862", sub: "accounts holding at least one MPT" },
      { label: "Transfers, 24 h", value: "2,415", sub: "MPT payments between accounts" },
    ]);
    expect(mptTokensTab(mptTokensSample(), { net: TESTNET }).tiles[0]!.sub).toBe("on XRPL Testnet, with any number of holders");
  });

  it("draws a dash for each tile when D9 has no totals yet (C19), under the same labels and lines", () => {
    const fresh = tab(mptTokensSample({ totals: undefined, total: undefined, count: 0, tokens: [] }));
    expect(fresh.tiles.map((tile) => [tile.label, tile.value])).toEqual([
      ["MPT issuances", "—"],
      ["Holders", "—"],
      ["Transfers, 24 h", "—"],
    ]);
    expect(fresh.tiles[1]!.sub).toBe("accounts holding at least one MPT");
  });

  it("is a row of the table: the rank, the ticker and the name, the link, the issuer, and the figures, the amounts scaled and compact", () => {
    expect(row()).toEqual({
      key: MPT_SAMPLE_ID,
      rank: "1",
      letter: "H",
      ticker: "HTF",
      name: "Harborline Treasury Fund",
      id: MPT_SAMPLE_ID,
      shortId: `${MPT_SAMPLE_ID.slice(0, 8)}…${MPT_SAMPLE_ID.slice(-4)}`,
      href: `/xrpl/mpt/${MPT_SAMPLE_ID}`,
      issuer: MPT_SAMPLE_ISSUER,
      holders: "3,412",
      // 1820451120 units at scale 2 are 18,204,511.20; the maximum 5000000000 units are 50,000,000.00.
      outstanding: "18.2M",
      max: "50M",
      flags: [
        { label: "Transfer", title: "Holders can send it to each other" },
        { label: "Trade", title: "The issuer allows it on the DEX. MPT trading isn't enabled on XRPL yet." },
        { label: "Lock", title: "The issuer can lock balances" },
        { label: "Clawback", title: "The issuer can take it back" },
        { label: "Auth", title: "Holders need the issuer's approval" },
      ],
      transfers: "412",
    });
  });

  // The whole-branch review's M3: the issuer next to an issuance is the one in its ID, as every MPT title has it; D9's `issuer` field is not drawn, and one bad row is not a refused tab.
  it("draws the issuer the issuance ID holds, whatever the row's issuer says", () => {
    const other = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
    expect(other).not.toBe(MPT_SAMPLE_ISSUER);
    expect(row({ issuer: other })).toMatchObject({ key: MPT_SAMPLE_ID, issuer: MPT_SAMPLE_ISSUER, href: `/xrpl/mpt/${MPT_SAMPLE_ID}` });
  });

  it("keeps the rank of the whole ranking with its thousands grouped, and the figures from the row's own scale", () => {
    expect(row({ rank: 1284 }).rank).toBe("1,284");
    expect(row({ asset_scale: 0, outstanding_amount: "1", maximum_amount: "2" })).toMatchObject({ outstanding: "1", max: "2" });
    // 15 at scale 15 is 0.000000000000015: three significant digits.
    expect(row({ asset_scale: 15, outstanding_amount: "15" }).outstanding).toBe("0.000000000000015");
    expect(row({ asset_scale: 19, outstanding_amount: "12345" }).outstanding).toBe("0.00000000000000123");
    expect(row({ asset_scale: 4, outstanding_amount: "0" }).outstanding).toBe("0");
  });

  it("shows the units, unscaled and compact with the word 'units', for an asset scale above 19", () => {
    const wide = row({ asset_scale: 20, outstanding_amount: "123456789012", maximum_amount: "9000000000000" });
    expect(wide.outstanding).toBe("123B units");
    expect(wide.max).toBe("9T units");
    expect(row({ asset_scale: 255, outstanding_amount: "7", maximum_amount: undefined })).toMatchObject({ outstanding: "7 units", max: null });
  });

  it("says 'not set' (a null max) where the issuance has no maximum, and has no pills for flags it does not have", () => {
    const bare = row({ maximum_amount: undefined, flags: mptFlagsSample({ can_lock: false, require_auth: false, can_trade: false, can_transfer: false, can_clawback: false }) });
    expect(bare.max).toBeNull();
    expect(bare.flags).toEqual([]);
  });

  it("writes the pills in the board's order whatever the order of the keys, and never one for 'locked'", () => {
    const all = row({ flags: { locked: true, require_auth: true, can_escrow: true, can_clawback: true, can_lock: true, can_trade: true, can_transfer: true } });
    expect(all.flags.map((flag) => flag.label)).toEqual(["Transfer", "Trade", "Lock", "Clawback", "Escrow", "Auth"]);
    expect(row({ flags: mptFlagsSample({ locked: true, can_lock: false, require_auth: false, can_trade: false, can_clawback: false }) }).flags.map((flag) => flag.label)).toEqual(["Transfer"]);
  });

  it("is the no-metadata cell without a ticker: '?' for the coin, the short ID and the full one, and no name", () => {
    const none = row({ ticker: undefined, name: undefined, mpt_issuance_id: MPT_FIXTURE_IDS.noMetadata });
    expect(none).toMatchObject({ letter: "?", id: MPT_FIXTURE_IDS.noMetadata, shortId: `${MPT_FIXTURE_IDS.noMetadata.slice(0, 8)}…${MPT_FIXTURE_IDS.noMetadata.slice(-4)}` });
    expect(none.ticker).toBeUndefined();
    expect(none.name).toBeUndefined();
    // A name with no ticker reads as the board does: the cell is the no-metadata one (the ticker decides).
    expect(row({ ticker: undefined, name: "Only a name" }).ticker).toBeUndefined();
  });

  it("reads a ticker as every page does: cut to 16 code points (an astral character whole), a blank one is none, and the name is cut to 128", () => {
    expect(row({ ticker: "ABCDEFGHIJKLMNOPQRST" })).toMatchObject({ ticker: "ABCDEFGHIJKLMNOP", letter: "A" });
    expect(row({ ticker: `${"😀".repeat(17)}` }).ticker).toBe("😀".repeat(16));
    expect(row({ ticker: "😀X" }).letter).toBe("😀");
    const blank = row({ ticker: "   ", name: "Name" });
    expect(blank.ticker).toBeUndefined();
    expect(blank.letter).toBe("?");
    expect(row({ name: "n".repeat(300) }).name).toBe("n".repeat(128));
    expect(row({ name: "  " }).name).toBeUndefined();
  });

  it("takes the bidi controls out of the issuer's text, as the issued list does for a toml name, and keeps the markup as text", () => {
    const hostile = row({ ticker: "A\u202EB", name: "x\u2066y</td><b>" });
    expect(hostile.ticker).toBe("AB");
    expect(hostile.name).toBe("xy</td><b>");
    expect(row({ ticker: "\u202E\u202E", name: undefined }).ticker).toBeUndefined();
  });

  it("links by mptLink: the ID in capitals, and no link while the switch is off", () => {
    expect(row({ mpt_issuance_id: MPT_SAMPLE_ID.toLowerCase() }).href).toBe(`/xrpl/mpt/${MPT_SAMPLE_ID}`);
    const off = mptTokensTab(mptTokensSample(), { net: { ...XRPL, features: { ...XRPL.features, mpt: false } } });
    expect(off.mpt!.rows[0]!.href).toBeNull();
  });

  it("keeps nothing the issuer wrote out of anything but the ticker and name (the link is made of the ID alone)", () => {
    const hostile = row({ ticker: '"><script>x</script>', name: "javascript:alert(1)" });
    expect(hostile.href).toBe(`/xrpl/mpt/${MPT_SAMPLE_ID}`);
    expect(hostile.key).toBe(MPT_SAMPLE_ID);
    expect(hostile.id).toBe(MPT_SAMPLE_ID);
  });

  it("says where the page stands in the ranking, from the first and last rank and the total", () => {
    const page = mptTokensSample({ total: 214, count: 2, tokens: [mptTokenRowSample({ rank: 21 }), mptTokenRowSample({ rank: 22, mpt_issuance_id: MPT_FIXTURE_IDS.noMetadata })] });
    expect(tab(page).mpt!.note).toEqual({ text: "Showing 21–22 of 214 issuances" });
    expect(tab(mptTokensSample({ total: 1284, tokens: [mptTokenRowSample({ rank: 1001 })] })).mpt!.note).toEqual({ text: "Showing 1,001–1,001 of 1,284 issuances" });
  });

  it("counts the matches of a search from the total: '1 match', 'N matches', '0 matches'", () => {
    expect(tab(mptTokensSample({ total: 1 }), { q: "HTF" }).mpt!.note).toEqual({ text: "1 match" });
    expect(tab(mptTokensSample({ total: 12 }), { q: "fund" }).mpt!.note).toEqual({ text: "12 matches" });
    expect(tab(mptTokensSample({ total: 1284, tokens: [mptTokenRowSample()] }), { q: "a" }).mpt!.note).toEqual({ text: "1,284 matches" });
    expect(tab(mptTokensSample({ total: 0, count: 0, tokens: [] }), { q: "zzz" }).mpt!.note).toEqual({ text: "0 matches" });
  });

  it("has no note without a total (C19), and none for an empty page that is no search", () => {
    expect(tab(mptTokensSample({ total: undefined })).mpt!.note).toBeNull();
    expect(tab(mptTokensSample({ total: undefined }), { q: "HTF" }).mpt!.note).toBeNull();
    expect(tab(mptTokensSample({ total: 0, count: 0, tokens: [] })).mpt!.note).toBeNull();
  });

  it("says what an empty table says: no MPT matches the search, or the index has none", () => {
    const none = mptTokensSample({ total: 0, count: 0, tokens: [] });
    expect(tab(none, { q: "zzz" }).mpt).toMatchObject({ rows: [], empty: "No MPTs match “zzz”." });
    expect(tab(none).mpt!.empty).toBe("No MPTs in the index yet.");
    expect(tab(mptTokensSample({ totals: undefined, total: undefined, count: 0, tokens: [] })).mpt!.empty).toBe("No MPTs in the index yet.");
    expect(tab().mpt!.empty).toBeNull();
  });

  it("has the board's flags legend as the footnote", () => {
    expect(tab().mpt!.footnote).toBe(MPT_FLAGS_LEGEND);
  });

  it("is E8's coverage note for the answer's coverage, in the words 'issuances', and none when it is complete", () => {
    expect(tab().coverage).toBeNull();
    expect(tab(mptTokensSample({ coverage: mptCoverageSample({ complete: false, from_ledger_index: 99226369 }) })).coverage).toEqual({
      before: "Covers ledger ",
      ledger: 99226369,
      after: " onwards: earlier issuances are not in the index yet.",
    });
    expect(tab(mptTokensSample({ coverage: { complete: false } })).coverage).toEqual({ before: "The index does not hold this history yet.", ledger: null, after: "" });
  });

  it("is the tab without a list when the search was too long to ask (no answer): dashes, no table, no note", () => {
    const tooLong = mptTokensTab(null, { net: XRPL });
    expect(tooLong.mpt).toBeNull();
    expect(tooLong.coverage).toBeNull();
    expect(tooLong.tiles.map((tile) => tile.value)).toEqual(["—", "—", "—"]);
    expect(tooLong.intro).toBe("Tokens on XRPL, ranked by holders. Tickers and names come from each issuance's metadata.");
    expect(tooLong.source).toBe("/v2/tokens?kind=mpt");
  });
});
