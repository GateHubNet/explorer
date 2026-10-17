import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { TxJson, TxMeta } from "../domain/parse/types";
import type { LedgerExpanded } from "./api-types";
import { ledgerPage, sourceFromIndex, sourceFromNode } from "./ledger-view";
import type { NodeLedger } from "./node-rpc";

const fixture = (net: string, index: number): LedgerExpanded =>
  (JSON.parse(readFileSync(new URL(`../../test/fixtures/http/${net}/data-api/ledgers/${index}@expand=true&transactions=true.json`, import.meta.url), "utf8")) as { ledger: LedgerExpanded }).ledger;

const ALICE = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const BOB = "rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5";

function entry(index: number, type: string, fee: string, code = "tesSUCCESS", extra: Partial<TxJson> = {}) {
  const tx: TxJson = { TransactionType: type, Account: ALICE, Fee: fee, ...extra };
  const meta: TxMeta = { TransactionIndex: index, TransactionResult: code, AffectedNodes: [] };
  return { hash: index.toString(16).toUpperCase().padStart(64, "0"), tx, meta };
}

const nodeLedger = (transactions: NodeLedger["transactions"]): NodeLedger => ({
  ledger_hash: "AA".repeat(32),
  ledger_index: 90,
  parent_hash: "BB".repeat(32),
  total_coins: "99999999999999999",
  close_time: 1792253462,
  parent_close_time: 1792253460,
  close_time_resolution: 10,
  close_flags: 0,
  account_hash: "CC".repeat(32),
  transaction_hash: "DD".repeat(32),
  transactions,
});

describe("ledgerPage over a recorded ledger", () => {
  const page = ledgerPage(sourceFromIndex(fixture("xrpl", 107720688)), { native: "XRP", hasNext: true });

  it("carries the header, with the supply in whole units", () => {
    expect(page.origin).toBe("index");
    expect(page.header).toEqual({
      index: 107720688,
      hash: "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02",
      parentHash: "1B116BF6AAB5938BFCF58E5F64DA46B691E3420D6EBEEA25EAE1017766147200",
      closeTime: 1792253462,
      resolution: 10,
      supply: "99985590049.656326",
      accountHash: "CD13165529B32B4151F059707674853F484467D0E06EC6C4A9DF658C32D68B4B",
      transactionHash: "C70DCCA6D031A318EEAD867B202F7AC8BD463FDA3A865C924882561785EF6694",
    });
    expect(page.hasNext).toBe(true);
  });

  it("counts transactions by type and by result, the commonest first", () => {
    expect(page.txCount).toBe(66);
    expect(page.succeeded).toBe(63);
    expect(page.failures).toEqual([{ code: "tecPATH_DRY", count: 3 }]);
    expect(page.types).toEqual([
      { type: "OfferCreate", count: 48 },
      { type: "Payment", count: 11 },
      { type: "OfferCancel", count: 3 },
      { type: "AccountSet", count: 2 },
      { type: "EscrowCreate", count: 1 },
      { type: "NFTokenCreateOffer", count: 1 },
    ]);
  });

  it("finds the accounts created and the fees, exactly", () => {
    expect(page.accountsCreated).toEqual(["rNdr5eedoze9geAQJPRLa9sKRekEdCFZ71", "rBd2s7CkFMpyiWyEcFLTuvEjXiyqnjvxEf"]);
    // 6,252 drops in all; the dearest 5,000; the cheapest 10.
    expect(page.fees).toEqual({ total: "0.006252", min: "0.00001", max: "0.005" });
  });

  it("has a row per transaction, in ledger order, with the sentence of a table", () => {
    expect(page.rows.map((row) => row.index)).toEqual(Array.from({ length: 66 }, (_, i) => i));
    const [first] = page.rows;
    expect(first).toMatchObject({
      index: 0,
      type: "Payment",
      hash: "CAD1D63C59541B382D9A4E3B8E26689932B18338F6746D27BB1ED56BEC718181",
      account: "rggDqcUQ1E2CriaMg4YHzkD4YDid26wMe",
      ok: true,
      code: "tesSUCCESS",
      fee: "0.00001",
    });
    expect(first!.what[0]).toMatchObject({ t: "text" });
    expect((first!.what[0] as { v: string }).v).toMatch(/^Sent /);
    const failed = page.rows.find((row) => !row.ok)!;
    expect(failed.code).toBe("tecPATH_DRY");
    expect((failed.what[0] as { v: string }).v).toMatch(/^Tried to /);
  });

  it("gives the raw header as the API sent it, as JSON text", () => {
    const raw = JSON.parse(page.raw);
    expect(raw).toEqual({
      ledger_hash: "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02",
      ledger_index: 107720688,
      parent_hash: "1B116BF6AAB5938BFCF58E5F64DA46B691E3420D6EBEEA25EAE1017766147200",
      total_coins: "99985590049656326",
      close_time: 1792253462,
      close_time_human: "2026-Oct-17 16:11:02",
      close_time_resolution: "10",
      close_flags: "0",
      account_hash: "CD13165529B32B4151F059707674853F484467D0E06EC6C4A9DF658C32D68B4B",
      transaction_hash: "C70DCCA6D031A318EEAD867B202F7AC8BD463FDA3A865C924882561785EF6694",
    });
    expect(page.raw).toContain("\n  ");
  });

  it("is JSON the browser can have: nothing in it is a BigInt, a Map or undefined", () => {
    expect(JSON.parse(JSON.stringify(page))).toEqual(page);
  });
});

describe("ledgerPage over hand-made ledgers", () => {
  const source = (transactions: ReturnType<typeof entry>[]) => ({ ...sourceFromIndex({ ...fixture("xrpl", 107720688), transactions: [] }), transactions });

  it("sorts by position, whatever order they came in", () => {
    const page = ledgerPage(source([entry(2, "Payment", "10"), entry(0, "TrustSet", "10"), entry(1, "Payment", "10")]), { native: "XRP", hasNext: false });
    expect(page.rows.map((row) => row.index)).toEqual([0, 1, 2]);
    expect(page.hasNext).toBe(false);
  });

  it("ranks equal counts by name, and failures by count", () => {
    const page = ledgerPage(
      source([
        entry(0, "TrustSet", "10"),
        entry(1, "Payment", "10", "tecNO_DST"),
        entry(2, "OfferCreate", "10", "tecKILLED"),
        entry(3, "OfferCreate", "10", "tecKILLED"),
        entry(4, "AccountSet", "10"),
      ]),
      { native: "XRP", hasNext: true },
    );
    expect(page.types).toEqual([
      { type: "OfferCreate", count: 2 },
      { type: "AccountSet", count: 1 },
      { type: "Payment", count: 1 },
      { type: "TrustSet", count: 1 },
    ]);
    expect(page.failures).toEqual([
      { code: "tecKILLED", count: 2 },
      { code: "tecNO_DST", count: 1 },
    ]);
    expect(page.succeeded).toBe(2);
  });

  it("adds fees as drops, so that a thousand small ones stay exact", () => {
    const many = Array.from({ length: 1000 }, (_, i) => entry(i, "Payment", "12"));
    const page = ledgerPage(source([...many, entry(1000, "Payment", "9007199254740993")]), { native: "XRP", hasNext: true });
    // 12,000 + 9,007,199,254,740,993 = 9,007,199,254,752,993 drops: beyond what a double can hold, and still exact.
    expect(page.fees).toEqual({ total: "9007199254.752993", min: "0.000012", max: "9007199254.740993" });
  });

  it("leaves a fee that is not drops out of the totals, and shows it as it is", () => {
    const page = ledgerPage(source([entry(0, "Payment", "12"), entry(1, "Payment", "n/a")]), { native: "XRP", hasNext: true });
    expect(page.fees).toEqual({ total: "0.000012", min: "0.000012", max: "0.000012" });
    expect(page.rows[1]!.fee).toBe("n/a");
  });

  it("has no fees and no counts for a ledger without transactions", () => {
    const page = ledgerPage(source([]), { native: "XRP", hasNext: true });
    expect(page).toMatchObject({ txCount: 0, succeeded: 0, failures: [], types: [], accountsCreated: [], fees: null, rows: [] });
  });

  it("lists an account created once, however many transactions say so", () => {
    const create = (index: number) => {
      const found = entry(index, "Payment", "10");
      found.meta.AffectedNodes = [{ CreatedNode: { LedgerEntryType: "AccountRoot", LedgerIndex: "AB".repeat(32), NewFields: { Account: BOB } } }];
      return found;
    };
    expect(ledgerPage(source([create(0), create(1)]), { native: "XRP", hasNext: true }).accountsCreated).toEqual([BOB]);
  });
});

describe("sourceFromNode", () => {
  it("reads the node's ledger, whose transactions are dated by it", () => {
    const hashes = ["AA".repeat(32)];
    const found = entry(0, "Payment", "10", "tesSUCCESS", { Destination: BOB, Amount: "1000000" });
    const page = ledgerPage(sourceFromNode(nodeLedger([{ ...found, ledger_index: 90, date: 1792253462 }])), { native: "XRP", hasNext: true });
    expect(page.origin).toBe("node");
    expect(page.header).toMatchObject({ index: 90, closeTime: 1792253462, resolution: 10, supply: "99999999999.999999" });
    expect(page.rows).toHaveLength(1);
    expect(JSON.parse(page.raw)).toMatchObject({ ledger_index: 90, close_flags: 0, close_time_resolution: 10 });
    expect(JSON.parse(page.raw)).not.toHaveProperty("close_time_human");
    // A node asked for hashes only has no transactions in full to show.
    expect(ledgerPage(sourceFromNode(nodeLedger(hashes)), { native: "XRP", hasNext: true }).rows).toEqual([]);
    expect(ledgerPage(sourceFromNode(nodeLedger(undefined)), { native: "XRP", hasNext: true }).rows).toEqual([]);
  });
});
