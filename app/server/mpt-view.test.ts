import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadTx } from "../../test/support/ledgers";
import { MPT_FIXTURE_IDS, MPT_RECORDED } from "../../test/support/mpt-case-rules";
import { XRPL } from "../../test/support/object-view-world";
import { mptIdOf, mptIssuerOf } from "../domain/mpt-id";
import { NO_NAMES, type NamesPart, type NameView } from "../domain/names";
import type { MptFlags, MptHolder, MptHoldersPage, MptIssuance, MptIssuanceAnswer, MptSummary, MptTransfer, MptTransfersPage, NodeMptIssuance } from "./api-types";
import {
  MPT_LOOKUP_MAX,
  mptAmountsOf,
  mptFacts,
  mptHead,
  mptHolderRows,
  mptPage,
  mptTransferRows,
  nodeFlags,
  resolveMpt,
  topLineOf,
  type MptLookupMap,
  type MptLookupResult,
  type MptPageData,
  type MptSource,
} from "./mpt-view";
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
    expect(page({ source: indexed({ destroyed: true, last_ledger: 107721455 }) }).notices).toEqual([{ text: "This issuance was destroyed in ledger #107,721,455.", ledger: 107721455 }]);
  });

  it("says the issuer has locked every balance, with the ticker", () => {
    expect(page({ source: indexed({ flags: { ...FLAGS, locked: true } }) }).notices).toEqual([{ text: "The issuer has locked every HTF balance." }]);
    expect(page({ source: indexed({ flags: { ...FLAGS, locked: true }, ticker: undefined, metadata: undefined }) }).notices).toEqual([{ text: "The issuer has locked every units balance." }]);
  });

  it("says an issuance read from the network is not in the index yet, and keeps the others after it", () => {
    expect(page({ source: fromNode() }).notices).toEqual([{ text: "Not in the index yet, shown from the network" }]);
    expect(page({ source: fromNode({ Flags: 0x01 }) }).notices.map((notice) => notice.text)).toEqual(["Not in the index yet, shown from the network", "The issuer has locked every units balance."]);
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
      scale: 2,
    });
  });

  it("falls back from the name to the ticker, and from the ticker to 'MPT' and the ID's start and end", () => {
    expect(mptHead(indexed({ name: undefined, metadata: undefined })).heading).toBe("HTF");
    const bare = mptHead(indexed({ ticker: undefined, name: undefined, metadata: undefined }));
    expect(bare).toMatchObject({ crumb: "MPT", letter: "?", heading: `MPT ${PAGE_ID.slice(0, 8)}…${PAGE_ID.slice(-4)}`, fromMetadata: false, tickerOrUnits: "units" });
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

  it("has no scale to apply above 19", () => {
    expect(mptHead(indexed({ asset_scale: 19 })).scale).toBe(19);
    expect(mptHead(indexed({ asset_scale: 20 })).scale).toBeNull();
  });

  it("is the ID's start and end from the network, with the entry's scale and no ticker", () => {
    expect(mptHead(fromNode({ AssetScale: 3 }))).toEqual({ crumb: "MPT", letter: "?", heading: `MPT ${PAGE_ID.slice(0, 8)}…${PAGE_ID.slice(-4)}`, fromMetadata: false, issuer: PAGE_ISSUER, id: PAGE_ID, tickerOrUnits: "units", scale: 3 });
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

  it("holds nothing the issuer wrote in a field the page puts in an attribute but the hrefs", () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const data = page({ source: indexed({ ticker: undefined, name: hostile, metadata: { icon: hostile, uris: [{ uri: "javascript:alert(1)", title: hostile, category: hostile }] } }) });
    const view = data.metadata;
    if (view.state !== "decoded") throw new Error("not decoded");
    expect(view.rows.filter((row) => row.href !== undefined || row.title !== undefined)).toEqual([]);
  });
});
