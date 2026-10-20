import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  binaryTx,
  compare,
  dataApiLedger,
  dataApiTx,
  feeRow,
  fixtureText,
  generate,
  definitionsFor,
  humanTime,
  isHandWritten,
  isoTime,
  nodeLedgerResult,
  nodeTxResult,
  readLedgers,
  TX_HASH_PREFIX,
  txDate,
  txMarker,
  unixOf,
  type RawLedger,
  type RawTx,
} from "./http-fixtures";
import { ammInfoFixtures } from "./amm-info-fixtures";
import { marketFixtures } from "./market-fixtures";

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

  // The markets pages' answers (market-fixtures.ts: a pair's trades, candles, 24-hour rows and active accounts, and the markets table) and the pools'
  // `amm_info` answers (amm-info-fixtures.ts) are generated with the rest, so `pnpm fixtures:sync` writes them and `fixtures:check` fails when they part ways.
  it("hold the market fixtures and the amm_info files, as their generators write them, none of them written by hand", () => {
    const generated = generate();
    const market = marketFixtures();
    const pools = ammInfoFixtures();
    expect(market.size).toBeGreaterThan(50);
    expect([...pools.keys()]).toEqual(
      expect.arrayContaining([
        "xrpl/node/amm_info/rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3.json",
        "xrpl/node/amm_info/XRP_524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De.json",
      ]),
    );
    for (const [path, text] of [...market, ...pools]) expect(generated.get(path), path).toBe(text);
    expect([...market.keys(), ...pools.keys()].filter(isHandWritten)).toEqual([]);
    expect([...market.keys()].some((path) => path.startsWith("xrpl/data-api/network/markets@"))).toBe(true);
    expect([...market.keys()].some((path) => path.startsWith("xahau/data-api/exchanges/EVR+rEvernodee8dJLaFsujS6q1EiXvZYmHXr8/XAH@"))).toBe(true);
  });

  // The order books are recorded from the public nodes (scripts/record-node-fixtures.ts), not worked out from the recorded ledgers: the generator
  // neither writes nor reports them.
  it("leave the recorded order books alone: a node/book_offers file is not generated and not stale", () => {
    const book = "node/book_offers/XRP_524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De@limit=60.json";
    expect(isHandWritten(`xrpl/${book}`)).toBe(true);
    expect(isHandWritten("xahau/node/book_offers/XAH_EVR+rEvernodee8dJLaFsujS6q1EiXvZYmHXr8@limit=60.json")).toBe(true);
    // Only the books: another method's node files are still the generator's to report.
    expect(isHandWritten("xrpl/node/tx/AAAA.json")).toBe(false);
    expect(isHandWritten("xrpl/node/amm_info/rAAAA.json")).toBe(false);
    expect(isHandWritten("xrpl/data-api/book_offers/x.json")).toBe(false);

    expect([...generate().keys()].filter((path) => path.includes("/node/book_offers/"))).toEqual([]);
    expect(compare(generate()).stale.filter((path) => path.includes("/node/book_offers/"))).toEqual([]);
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

  // The synthetic files (network-fixtures.ts) have a row to a line, sorted keys and all; the recorded ones keep their layout.
  it("writes the rows of the lists it is told to one to a line, at the root too, and any other list as before", () => {
    const value = { rows: [{ b: { c: [1, { d: 2 }] }, a: 1 }, { a: 2 }], other: [{ a: { b: { c: 1 } } }], count: 2 };
    expect(fixtureText(value, ["rows"])).toBe(
      ['{', '  "count": 2,', '  "other": [', '    {', '      "a": {"b":{"c":1}}', '    }', '  ],', '  "rows": [', '    {"a":1,"b":{"c":[1,{"d":2}]}},', '    {"a":2}', '  ]', '}', ''].join("\n"),
    );
    // Without the list named, the rows keep the layout every other file has.
    expect(fixtureText(value)).toBe(fixtureText(value, []));
    expect(fixtureText(value).split("\n").length).toBeGreaterThan(fixtureText(value, ["rows", "other"]).split("\n").length);
  });

  it("leaves the layout of every generated file that is not synthetic as it is: a list called rows is not one line a row unless it is told to be", () => {
    const fees = generate().get("xrpl/data-api/network/fees@descending=true&limit=8.json")!;
    expect(fees.split("\n").length).toBeGreaterThan(8 * 3);
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


// The data API's `?binary=true` answer: `tx` and `meta` as the upper-case hex of the serialization (api-reference.md, "Transactions").
// ripple-binary-codec is a devDependency used here and nowhere else: the Worker never serializes anything.
describe("the ?binary=true fixtures", () => {
  const files = generate();
  const plain = [...files.keys()].filter((path) => /\/data-api\/transactions\/[0-9A-F]{64}\.json$/.test(path));
  const binaryOf = (path: string) => path.replace(/\.json$/, "@binary=true.json");
  const body = (path: string) => JSON.parse(files.get(path)!) as { result: string; transaction: Record<string, any> };

  /** The hash of a transaction: SHA-512Half of "TXN\0" and the serialized transaction. */
  const rehash = (txBlob: string) =>
    createHash("sha512")
      .update(Buffer.from(TX_HASH_PREFIX + txBlob, "hex"))
      .digest("hex")
      .slice(0, 64)
      .toUpperCase();

  it("exist beside every transaction file, and for nothing else", () => {
    expect(plain.length).toBeGreaterThan(50);
    const binary = [...files.keys()].filter((path) => path.endsWith("@binary=true.json"));
    expect(binary.sort()).toEqual(plain.map(binaryOf).sort());
  });

  it("have the shape the API gives: the hash, the ledger and the date of the transaction beside it, tx and meta as upper-case hex", () => {
    for (const path of plain) {
      const { result, transaction } = body(binaryOf(path));
      const beside = body(path).transaction;
      expect(result, path).toBe("success");
      // (A fixture file has its keys sorted, so the order of the API's answer is not kept.)
      expect(Object.keys(transaction).sort(), path).toEqual(["date", "hash", "ledger_index", "meta", "tx"]);
      expect(transaction.hash, path).toBe(beside.hash);
      expect(transaction.ledger_index, path).toBe(beside.ledger_index);
      expect(transaction.date, path).toBe(beside.date);
      for (const blob of [transaction.tx, transaction.meta]) expect(blob, path).toMatch(/^(?:[0-9A-F]{2})+$/);
    }
  });

  it("re-hash to the hash of their transaction, on both networks (the API's hex is the serialization itself)", () => {
    const nets = new Set<string>();
    for (const path of plain) {
      const { transaction } = body(binaryOf(path));
      expect(rehash(transaction.tx), path).toBe(transaction.hash);
      nets.add(path.split("/")[0]!);
    }
    expect([...nets].sort()).toEqual(["xahau", "xrpl"]);
  });

  it("serialize the type the transaction beside them has (a Xahau type needs the recorded definitions of Xahau)", () => {
    // A blob begins with the field TransactionType (code 0x12) and its two-byte number.
    const typeCode = (hex: string) => Number.parseInt(hex.slice(2, 6), 16);
    for (const net of ["xrpl", "xahau"] as const) {
      const definitions = definitionsFor(net);
      for (const path of plain.filter((p) => p.startsWith(`${net}/`))) {
        const { transaction } = body(binaryOf(path));
        const type = body(path).transaction.tx.TransactionType as string;
        expect(transaction.tx.slice(0, 2), path).toBe("12");
        expect(definitions.transactionType.from(type)?.ordinal, `${path} ${type}`).toBe(typeCode(transaction.tx));
      }
    }
  });

  it("are made by binaryTx from the transaction beside them", () => {
    const [path] = plain;
    const beside = body(path!).transaction as Parameters<typeof binaryTx>[1];
    const made = binaryTx(path!.split("/")[0] as "xrpl" | "xahau", beside);
    expect(made).toEqual(body(binaryOf(path!)).transaction);
  });

  it("use, for Xahau, the definitions recorded from a Xahau node: the file copied into test/fixtures/definitions", () => {
    const provenance = readFileSync(new URL("../test/fixtures/PROVENANCE.md", import.meta.url), "utf8");
    expect(provenance).toContain("definitions/xahau/server_definitions.json");
    expect(provenance).toMatch(/packages\/shared\/test\/fixtures\/xahau\/recorded\/server_definitions\.json/);
    expect(provenance).toMatch(/server_definitions[^\n]*\b[0-9a-f]{40}\b/);
    // Types of Xahau, which the codec's own definitions of the XRP Ledger do not have.
    expect(definitionsFor("xahau").transactionType.from("URITokenMint")).toBeDefined();
    expect(definitionsFor("xrpl").transactionType.from("URITokenMint")).toBeUndefined();
  });
});

// The command (`tsx scripts/make-http-fixtures.ts`, `pnpm fixtures:check`) once decided whether it was being run by comparing the URL of its
// module (a real path) with `process.argv[1]` (the path as it was typed): through a link they differ, and then it printed nothing and exited 0,
// so that a check passed whatever the fixtures held. It runs every time it is run, however it was reached.
describe("the command", () => {
  const script = fileURLToPath(new URL("./make-http-fixtures.ts", import.meta.url));
  const links = mkdtempSync(join(tmpdir(), "fw-fixtures-links-"));
  afterAll(() => rmSync(links, { recursive: true, force: true }));
  symlinkSync(script, join(links, "make-http-fixtures.ts"));
  symlinkSync(dirname(script), join(links, "linked-scripts"));
  const entries = {
    directly: script,
    "a link to the file": join(links, "make-http-fixtures.ts"),
    "a link to the directory": join(links, "linked-scripts", "make-http-fixtures.ts"),
  };

  it.each(Object.keys(entries) as Array<keyof typeof entries>)("checks the fixtures, and says so, when it is reached %s", (how) => {
    const result = spawnSync("pnpm", ["exec", "tsx", entries[how], "--check"], { encoding: "utf8", cwd: dirname(script) });
    const said = `${result.stdout}${result.stderr}`;
    expect(result.status, said).toBe(0);
    // A command that did not run would have said nothing.
    expect(result.stdout).toMatch(/\d+ generated fixture files are up to date/);
  }, 60_000);
});
