import { describe, expect, it } from "vitest";

import {
  dataApiLedger,
  dataApiTx,
  feeRow,
  fixtureText,
  generate,
  humanTime,
  isHandWritten,
  isoTime,
  nodeLedgerResult,
  nodeTxResult,
  readLedgers,
  txDate,
  txMarker,
  unixOf,
  type RawLedger,
  type RawTx,
} from "./http-fixtures";
import { compare } from "./make-http-fixtures";

describe("the generated upstream fixtures", () => {
  // The committed files are what the generator writes from the recordings (`pnpm fixtures:sync` rewrites them).
  it("are up to date: regenerating changes, adds and removes nothing", () => {
    const differences = compare(generate());
    expect(differences).toEqual({ missing: [], changed: [], stale: [] });
  });

  it("are deterministic: two runs give the same text", () => {
    const first = generate();
    const second = generate();
    expect([...second.keys()]).toEqual([...first.keys()]);
    for (const [path, text] of first) expect(second.get(path)).toBe(text);
  });

  it("are compared file by file: a changed one, one that is not on disk, and one that no longer belongs are told apart", () => {
    const generated = generate();
    const [changed, dropped] = [...generated.keys()];
    generated.set(changed!, "changed\n");
    generated.delete(dropped!);
    generated.set("xrpl/data-api/never-written.json", "{}\n");
    expect(compare(generated)).toEqual({ missing: ["xrpl/data-api/never-written.json"], changed: [changed], stale: [dropped] });
  });

  it("never include a file that is written by hand", () => {
    expect([...generate().keys()].filter(isHandWritten)).toEqual([]);
  });
});

describe("fixtureText", () => {
  it("sorts keys, indents two spaces, and puts everything below the third level on one line", () => {
    const text = fixtureText({ b: 1, a: { z: [1, 2], y: { x: { w: 1, v: [] } } }, c: undefined });
    expect(text).toBe(['{', '  "a": {', '    "y": {', '      "x": {"v":[],"w":1}', '    },', '    "z": [', '      1,', '      2', '    ]', '  },', '  "b": 1', '}', ''].join("\n"));
  });

  it("writes a list of transactions one to a line, however deep it lies", () => {
    const text = fixtureText({ result: { ledger: { transactions: [{ a: { b: 1 } }, "HASH"] } } });
    expect(text).toBe(['{', '  "result": {', '    "ledger": {', '      "transactions": [', '        {"a":{"b":1}},', '        "HASH"', '      ]', '    }', '  }', '}', ''].join("\n"));
  });

  it("writes empty containers compactly and ends with a newline", () => {
    expect(fixtureText({ rows: [], none: {} })).toBe('{\n  "none": {},\n  "rows": []\n}\n');
  });
});

describe("times", () => {
  it("formats a Ripple-epoch close time the way the data API does", () => {
    const unix = unixOf(845378370); // the close time of ledger 107671593
    expect(unix).toBe(1792063170);
    expect(isoTime(unix)).toBe("2026-10-15T11:19:30Z");
    expect(txDate(unix)).toBe("2026-10-15T11:19:30+00:00");
    expect(humanTime(unix)).toBe("2026-Oct-15 11:19:30");
  });

  it("makes the marker of a list the base64url of [ledger_index, tx_index]", () => {
    expect(txMarker(107670360, 5)).toBe("WzEwNzY3MDM2MCw1XQ"); // the example of data-api-new's reference
  });
});

describe("shapes", () => {
  const ledgers = readLedgers("xrpl");
  const raw = (index: number): RawLedger => ledgers.find((l) => Number(l.ledger.ledger_index) === index)!;
  const hashed = (hash: string): { raw: RawLedger; tx: RawTx } => {
    for (const l of ledgers) {
      const tx = l.ledger.transactions.find((t) => t.hash === hash);
      if (tx) return { raw: l, tx };
    }
    throw new Error(`no ${hash}`);
  };

  it("serves a ledger as the reference lists it: text except index and times, which are unix seconds", () => {
    expect(dataApiLedger(raw(107671593))).toEqual({
      ledger_hash: "6362E55E66FFC49651601E7F9ED75905F0E98CF18CD50FC1DD0398806C319940",
      ledger_index: 107671593,
      parent_hash: "58F1E25E2ED9FB2660C1602DE0FDCC9E4A7A12DEB08046075D3522F6832DBF77",
      total_coins: "99985591048774338",
      close_time: 1792063170,
      close_time_human: "2026-Oct-15 11:19:30",
      close_time_resolution: "10",
      close_flags: "0",
      parent_close_time: 1792063161,
      account_hash: "67A88EA1E06E40EE3E2EEB9326337BC79E5FD96D6633370E134A5F242AA82E8B",
      transaction_hash: "C0288010AE331EE1C86086F2B3290FA169FF8A81AF41D5850C21AEDAC9B5389B",
      hash: "6362E55E66FFC49651601E7F9ED75905F0E98CF18CD50FC1DD0398806C319940",
      seqNum: "107671593",
      totalCoins: "99985591048774338",
      accepted: "true",
      closed: "true",
    });
  });

  it("serves a transaction in canonical form: no hash or DeliverMax in tx, delivered_amount on a successful Payment", () => {
    // A Payment of the recordings with both Amount and DeliverMax.
    const { raw: ledger, tx } = hashed("28C533CC1B9C72894AFBFCC9B4F3C7C7D210E7F2B70F6B1615805B35ED0B4BAF");
    expect(tx.DeliverMax).toBeDefined();
    const served = dataApiTx(ledger, tx);
    expect(Object.keys(served)).toEqual(["hash", "ledger_index", "date", "tx", "meta"]);
    expect(served.tx).not.toHaveProperty("hash");
    expect(served.tx).not.toHaveProperty("DeliverMax");
    expect(served.tx).toHaveProperty("Amount");
    expect(served.meta.delivered_amount).toEqual(tx.Amount);
    expect(dataApiTx(ledger, tx, true).ledger_hash).toBe(ledger.ledger_hash);
  });

  it("takes the delivered amount from the metadata's DeliveredAmount when it has one", () => {
    const withDelivered = ledgers.flatMap((l) => l.ledger.transactions.map((tx) => ({ raw: l, tx }))).find(({ tx }) => tx.TransactionType === "Payment" && tx.metaData.DeliveredAmount !== undefined);
    expect(withDelivered).toBeDefined();
    const served = dataApiTx(withDelivered!.raw, withDelivered!.tx);
    expect(served.meta.delivered_amount).toEqual(withDelivered!.tx.metaData.DeliveredAmount);
  });

  it("sums a ledger's fees as the data API does: the example of the reference, 13 transactions of 138000 drops", () => {
    const fees = [10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 18000];
    const ledger = {
      ledger_index: "11118827",
      ledger: { ledger_index: "11118827", close_time: 421256000, transactions: fees.map((fee) => ({ Fee: String(fee) })) },
    } as unknown as RawLedger;
    expect(feeRow(ledger)).toEqual({ avg: 0.010615, max: 0.018, min: 0.01, total: 0.138, tx_count: 13, date: isoTime(unixOf(421256000)), ledger_index: 11118827 });
  });

  it("gives a ledger without transactions an avg and min of 0", () => {
    const empty = { ledger_index: 1, ledger: { ledger_index: "1", close_time: 0, transactions: [] } } as unknown as RawLedger;
    expect(feeRow(empty)).toMatchObject({ avg: 0, min: 0, max: 0, total: 0, tx_count: 0 });
  });

  it("gives a node a transaction with its metadata as `meta` and the Ripple-epoch date of its ledger", () => {
    const { raw: ledger, tx } = hashed("83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B");
    const result = nodeTxResult(ledger, tx);
    expect(result).toMatchObject({ validated: true, status: "success", date: ledger.ledger.close_time, ledger_index: 107671558, inLedger: 107671558 });
    expect(result.meta).toBe(tx.metaData);
    expect(result).not.toHaveProperty("metaData");
    expect(result.hash).toBe(tx.hash);
  });

  it("gives a node a ledger with its header as recorded and the transactions as asked for", () => {
    const ledger = raw(107671593);
    const plain = nodeLedgerResult(ledger, "none") as { ledger: Record<string, unknown>; ledger_index: number };
    expect(plain.ledger).not.toHaveProperty("transactions");
    expect(plain.ledger.ledger_index).toBe("107671593"); // text in the header, a number beside it
    expect(plain.ledger_index).toBe(107671593);
    const hashes = nodeLedgerResult(ledger, "hashes") as { ledger: { transactions: string[] } };
    expect(hashes.ledger.transactions).toHaveLength(187);
    expect(typeof hashes.ledger.transactions[0]).toBe("string");
    const expanded = nodeLedgerResult(ledger, "expanded") as { ledger: { transactions: RawTx[] } };
    expect(expanded.ledger.transactions[0]).toHaveProperty("metaData");
  });
});
