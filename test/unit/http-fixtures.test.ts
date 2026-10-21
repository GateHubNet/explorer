import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { isValidClassicAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import {
  dataApiTx,
  HTTP,
  inLedgerOrder,
  isAmmGenerated,
  isAnalyticsGenerated,
  isMarketGenerated,
  isSynthetic,
  isValidatorsGenerated,
  LEDGERS,
  isoTime,
  readLedgers,
  txMarker,
  unixOf,
  type RawLedger,
  type RawTx,
} from "../../scripts/http-fixtures";
import { canonicalQuery, dataApiFile } from "../support/upstream-core";

// What the fixtures of test/fixtures/http/ promise the tests that use them. The generated files are checked against
// their generator in scripts/http-fixtures.test.ts; the files written by hand (accounts, server_state) are checked
// here against the recordings and against each other.

type Net = "xrpl" | "xahau";
const NETS: Net[] = ["xrpl", "xahau"];

const NEVER_FUNDED = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";
/** The accounts the fixtures describe (README.md, "Upstream fixtures"). */
const ACTIVE: Record<Net, string> = { xrpl: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", xahau: "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto" };
const DELETED: Record<Net, string> = { xrpl: "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC", xahau: "rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD" };

const json = (path: string): any => JSON.parse(readFileSync(new URL(path, HTTP), "utf8"));
const exists = (path: string): boolean => {
  try {
    readFileSync(new URL(path, HTTP));
    return true;
  } catch {
    return false;
  }
};
const allFiles = (): string[] => readdirSync(HTTP, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => `${e.parentPath.slice(HTTP.pathname.length)}/${e.name}`.replace(/^\//, ""));

const recorded = Object.fromEntries(NETS.map((net) => [net, readLedgers(net)])) as Record<Net, RawLedger[]>;
function recordedTx(net: Net, hash: string): { raw: RawLedger; tx: RawTx } {
  for (const raw of recorded[net]) {
    const tx = raw.ledger.transactions.find((t) => t.hash === hash);
    if (tx) return { raw, tx };
  }
  throw new Error(`${net}: no recorded transaction ${hash}`);
}
const head = (net: Net) => recorded[net].at(-1)!;

describe("every fixture file", () => {
  const files = allFiles();

  it("is JSON", () => {
    expect(files.length).toBeGreaterThan(200);
    for (const file of files) expect(() => JSON.parse(readFileSync(new URL(file, HTTP), "utf8")), file).not.toThrow();
  });

  /**
   * The request a data API file's name stands for, read back: the file it finds and the canonical form of its query. A file's query is the decoded text of the
   * request's (`canonicalQuery`), where a `+` is a value's (an asset's `CUR+issuer`, which the client sends as `%2B`), so only the `+` is sent encoded again;
   * any other escape in a name (`%2B`, `%3D`) reads back as another name, as it did before the AMM files.
   */
  const readBack = (file: string): { found: string | undefined; query: string; canonical: string } => {
    const [path, query = ""] = file.replace(/\.json$/, "").split("@");
    const [net, , ...rest] = path!.split("/");
    const sent = query.replace(/\+/g, "%2B");
    return { found: dataApiFile(net as Net, `/v2/${rest.join("/")}`, sent), query, canonical: canonicalQuery(sent) };
  };

  it("is named by the rule that finds it: a sorted query after `@`, and upper-case hashes", () => {
    for (const file of files.filter((f) => f.includes("/data-api/"))) {
      const { found, query, canonical } = readBack(file);
      expect(file, "a data API file").toBe(found);
      expect(canonical, file).toBe(query);
    }
    for (const file of files) for (const hash of file.match(/[0-9a-fA-F]{64}/g) ?? []) expect(hash, file).toBe(hash.toUpperCase());
  });

  it("takes a `+` of an asset's `CUR+issuer` in a query as the value's, and no escaped name: `%2B` and `%3D` read back as another file", () => {
    const named = (file: string) => {
      const { found, query, canonical } = readBack(file);
      return found === file && canonical === query;
    };
    const amm = "xrpl/data-api/amm/pools@asset=524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De&limit=20.json";
    expect(files).toContain(amm);
    expect(named(amm)).toBe(true);
    expect(named(amm.replace("+", "%2B"))).toBe(false);
    expect(named("xrpl/data-api/amm/pools@limit=20&marker=WzEsInIiXQ%3D%3D.json")).toBe(false);
    expect(named("xrpl/data-api/transactions@descending=true&limit=8.json")).toBe(true);
    expect(named("xrpl/data-api/transactions@limit=8&descending=true.json")).toBe(false);
  });

  it("holds no API key", () => {
    for (const file of files) {
      const text = readFileSync(new URL(file, HTTP), "utf8");
      expect(text, file).not.toMatch(/api-?key/i);
      expect(text, file).not.toContain("test-key");
    }
  });

  it("stays within the budget that keeps the set reviewable", () => {
    const bytes = (names: string[]) => names.reduce((sum, file) => sum + readFileSync(new URL(file, HTTP)).length, 0);
    expect(
      bytes(files.filter((file) => !isSynthetic(file) && !isMarketGenerated(file) && !isAnalyticsGenerated(file) && !isValidatorsGenerated(file) && !isAmmGenerated(file))),
    ).toBeLessThan(3.5 * 1024 * 1024);
    // The synthetic aggregates of the network page (about 2.3 MiB, a row to a line: four periods, two display currencies, three volumes) are
    // generated and reviewed as the generator, so they have a budget of their own; a later generator that adds files raises it with its data.
    // The accounts' analytics answers (scripts/analytics-fixtures.ts: 144 files, about 0.31 MiB, a row to a line) are synthetic too, and fit in it.
    const synthetic = (file: string) => isSynthetic(file) || isAnalyticsGenerated(file);
    expect(bytes(files.filter(isAnalyticsGenerated))).toBeGreaterThan(0);
    expect(bytes(files.filter(synthetic))).toBeLessThan(2.7 * 1024 * 1024);
    // The markets pages' files (scripts/market-fixtures.ts: the pairs' trades, candles, 24-hour rows and active accounts, and the nine XRPL and three
    // Xahau markets tables, a row to a line; 81 files, 896,584 bytes, about 0.86 MiB) are reviewed as their generator too, and have a budget of their own.
    expect(bytes(files.filter(isMarketGenerated))).toBeGreaterThan(0);
    expect(bytes(files.filter(isMarketGenerated))).toBeLessThan(1.0 * 1024 * 1024);
    // The validators and amendments pages' files (scripts/validators-fixtures.ts: D1's six routes, a row to a line; 239 files, 2,869,339 bytes, about 2.7 MiB, of
    // which the 30 days of XRPL's majority amendment, under its name and its ID, are 0.7 MiB) are reviewed as their generator too, with a budget of their own.
    expect(bytes(files.filter(isValidatorsGenerated))).toBeGreaterThan(0);
    expect(bytes(files.filter(isValidatorsGenerated))).toBeLessThan(3.0 * 1024 * 1024);
    // The AMM pages' files (scripts/amm-fixtures.ts, a row to a line: the pool routes derived from the recordings, 185 files of 142,231 bytes, and the synthetic
    // day rows, AMM-only candles and live volume as P2 of E5 scopes them, VOX/XRP's four empty answers among them, 39 files of 513,235 bytes; 224 files,
    // 655,466 bytes, about 0.63 MiB) are reviewed as their generator too, with a budget of their own (P2), which a later file raises with its data, never above
    // 1.0 MiB.
    expect(bytes(files.filter(isAmmGenerated))).toBeGreaterThan(0);
    expect(bytes(files.filter(isAmmGenerated))).toBeLessThan(0.65 * 1024 * 1024);
  });
});

describe.each(NETS)("%s", (net) => {
  it("serves the newest recorded ledger as last_validated, in full, with the newest transactions and fees", () => {
    const newest = head(net);
    const index = Number(newest.ledger.ledger_index);
    expect(json(`${net}/data-api/last_validated.json`)).toMatchObject({ ledger_index: String(index), ledger_hash: newest.ledger_hash });
    expect(exists(`${net}/data-api/ledgers/${index}@expand=true&transactions=true.json`)).toBe(true);
    expect(exists(`${net}/node/ledger/${index}@expand=true&transactions=true.json`)).toBe(true);

    const last = inLedgerOrder(newest).at(-1)!;
    expect(json(`${net}/data-api/transactions@descending=true&limit=8.json`).transactions[0].hash).toBe(last.hash);
    expect(json(`${net}/data-api/network/fees@descending=true&limit=8.json`).rows[0]).toMatchObject({ ledger_index: index, tx_count: newest.ledger.transactions.length });
  });

  it("finds every recorded ledger by its hash", () => {
    const hashes = json(`${net}/ledger-hashes.json`) as Record<string, number>;
    expect(Object.keys(hashes)).toHaveLength(recorded[net].length);
    for (const raw of recorded[net]) {
      expect(hashes[raw.ledger_hash]).toBe(raw.ledger_index);
      expect(json(`${net}/data-api/ledgers/${raw.ledger_index}.json`).ledger.ledger_hash).toBe(raw.ledger_hash);
      expect(exists(`${net}/data-api/ledgers/${raw.ledger_index}@transactions=true.json`)).toBe(true);
    }
  });

  it("serves the transactions of a ledger in ledger order, one position each", () => {
    for (const raw of recorded[net]) {
      const { hashes } = { hashes: json(`${net}/data-api/ledgers/${raw.ledger_index}@transactions=true.json`).ledger.transactions as string[] };
      expect(hashes).toHaveLength(raw.ledger.transactions.length);
      hashes.forEach((hash, position) => expect(recordedTx(net, hash).tx.metaData.TransactionIndex).toBe(position));
    }
  });

  it("serves the transaction of every type the recordings looked for", () => {
    for (const set of net === "xrpl" ? ["xrpl", "xrpl-amm", "xrpl-extra"] : ["xahau", "xahau-extra"]) {
      const manifest = JSON.parse(readFileSync(new URL(`${set}/manifest.json`, LEDGERS), "utf8"));
      for (const entry of [...Object.values(manifest.found ?? {}), ...Object.values(manifest.cases ?? {})] as Array<{ hash: string; ledger: number }>) {
        const served = json(`${net}/data-api/transactions/${entry.hash}.json`).transaction;
        expect(served.ledger_index).toBe(entry.ledger);
        expect(json(`${net}/node/tx/${entry.hash}.json`).result.ledger_index).toBe(entry.ledger);
      }
    }
  });
});

describe("the accounts written by hand", () => {
  type Page = { count: number; marker?: string } & Record<string, any[]>;

  /** The pages of a list, from the first through the marker of each to the last. */
  function pages(net: Net, account: string, endpoint: string): Page[] {
    const out: Page[] = [];
    let marker: string | undefined;
    do {
      const query = marker ? `descending=true&limit=20&marker=${marker}` : "descending=true&limit=20";
      const page = json(`${net}/data-api/accounts/${account}/${endpoint}@${query}.json`) as Page;
      out.push(page);
      marker = page.marker;
    } while (marker);
    return out;
  }
  const rowsOf = (net: Net, account: string, endpoint: string) => pages(net, account, endpoint).flatMap((page) => page[endpoint]!);
  const position = (row: any) => [row.ledger_index, row.tx_index ?? row.meta?.TransactionIndex] as const;

  describe.each(NETS)("%s", (net) => {
    const active = ACTIVE[net];

    it("lists real transactions, newest first, in pages linked by the marker of the last row", () => {
      for (const endpoint of ["transactions", "payments", "exchanges"]) {
        for (const account of [active, DELETED[net], NEVER_FUNDED]) {
          const all = pages(net, account, endpoint);
          all.forEach((page, i) => {
            expect(page.count).toBe(page[endpoint]!.length);
            const last = page[endpoint]!.at(-1);
            if (i < all.length - 1) expect(page.marker, `${account} ${endpoint}`).toBe(txMarker(...position(last)));
            else expect(page.marker).toBeUndefined();
          });
          const positions = rowsOf(net, account, endpoint).map(position);
          const newestFirst = [...positions].sort(([la, ta], [lb, tb]) => lb - la || tb - ta);
          expect(positions, `${account} ${endpoint}`).toEqual(newestFirst);
        }
      }
    });

    it("lists each transaction exactly as the transactions endpoint serves it, and serves every one that a row names", () => {
      for (const account of [active, DELETED[net]]) {
        const rows = rowsOf(net, account, "transactions");
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          const { raw, tx } = recordedTx(net, row.hash);
          expect(row).toEqual(dataApiTx(raw, tx));
          expect(json(`${net}/data-api/transactions/${row.hash}.json`).transaction).toEqual(row);
          expect(json(`${net}/node/tx/${row.hash}.json`).result.hash).toBe(row.hash);
        }
      }
    });

    it("lists payments and exchanges that the recorded transactions made", () => {
      for (const account of [active, DELETED[net]]) {
        for (const row of rowsOf(net, account, "payments")) {
          const { raw, tx } = recordedTx(net, row.tx_hash);
          expect(tx.TransactionType).toBe("Payment");
          expect(tx.metaData.TransactionResult).toBe("tesSUCCESS");
          expect(row).toMatchObject({
            source: tx.Account,
            destination: tx.Destination,
            ledger_index: Number(raw.ledger.ledger_index),
            tx_index: tx.metaData.TransactionIndex,
            executed_time: isoTime(unixOf(raw.ledger.close_time)),
            transaction_cost: String(Number(tx.Fee) / 1_000_000),
          });
          expect([row.source, row.destination]).toContain(account);
          expect(exists(`${net}/data-api/transactions/${row.tx_hash}.json`)).toBe(true);
        }
        for (const row of rowsOf(net, account, "exchanges")) {
          const { raw, tx } = recordedTx(net, row.tx_hash);
          expect(row).toMatchObject({ taker: tx.Account, tx_type: tx.TransactionType, ledger_index: Number(raw.ledger.ledger_index), tx_index: tx.metaData.TransactionIndex });
          expect([row.buyer, row.seller].sort()).toEqual([row.provider, row.taker].sort());
          expect([row.provider, row.taker]).toContain(account);
        }
      }
    });

    it("has an active account whose state is that of its newest transaction, on the newest ledger", () => {
      const newest = rowsOf(net, active, "transactions")[0];
      const info = json(`${net}/node/account_info/${active}.json`).result;
      expect(info).toMatchObject({ ledger_index: head(net).ledger_index, ledger_hash: head(net).ledger_hash, validated: true });
      expect(info.account_data).toMatchObject({ Account: active, LedgerEntryType: "AccountRoot", PreviousTxnID: newest.hash, PreviousTxnLgrSeq: newest.ledger_index });

      const balances = json(`${net}/data-api/accounts/${active}/balances.json`);
      expect(balances.ledger_index).toBe(head(net).ledger_index);
      expect(balances.balances[0]).toMatchObject({ currency: net === "xrpl" ? "XRP" : "XAH", value: String(Number(info.account_data.Balance) / 1_000_000) });
      expect(balances.balances[0]).not.toHaveProperty("counterparty");

      const objects = json(`${net}/node/account_objects/${active}.json`).result;
      expect(objects).toMatchObject({ account: active, ledger_hash: head(net).ledger_hash, validated: true });
      expect(objects.marker).toBeUndefined();
      const lines = objects.account_objects.filter((o: any) => o.LedgerEntryType === "RippleState");
      expect(lines).toHaveLength(balances.balances.length - 1);
      expect(json(`${net}/data-api/accounts/${active}/orders.json`).orders).toEqual([]);
    });

    it("has a deleted account that the data API knows and the node does not", () => {
      const deleted = DELETED[net];
      expect(json(`${net}/data-api/accounts/${deleted}.json`).account_data.account).toBe(deleted);
      for (const absent of [`data-api/accounts/${deleted}/balances.json`, `data-api/accounts/${deleted}/orders.json`, `node/account_info/${deleted}.json`, `node/account_objects/${deleted}.json`]) {
        expect(exists(`${net}/${absent}`), absent).toBe(false);
      }
      expect(rowsOf(net, deleted, "transactions").length).toBeGreaterThan(0);
    });

    it("has a creation for each account that the account's first recorded transaction follows", () => {
      for (const account of [active, DELETED[net]]) {
        const created = json(`${net}/data-api/accounts/${account}.json`).account_data;
        expect(created).toMatchObject({ account, parent: expect.stringMatching(/^r/), inception: expect.stringMatching(/Z$/) });
        const oldest = rowsOf(net, account, "transactions").at(-1);
        expect(created.ledger_index).toBeLessThan(oldest.ledger_index);
        expect(Date.parse(created.inception)).toBeLessThan(Date.parse(oldest.date));
      }
    });

    it("has a server_state that is the newest ledger, with the reserves", () => {
      const state = json(`${net}/node/server_state.json`).result.state;
      const newest = head(net);
      expect(state.validated_ledger).toMatchObject({ seq: newest.ledger_index, hash: newest.ledger_hash, close_time: newest.ledger.close_time });
      expect(state.validated_ledger.reserve_base).toBeGreaterThan(0);
      expect(state.validated_ledger.reserve_inc).toBeGreaterThan(0);
      expect(state.complete_ledgers).toMatch(new RegExp(`-${newest.ledger_index}$`));
    });

    it("has a never-funded address that is valid, in no recording, with an empty history and nothing else", () => {
      expect(isValidClassicAddress(NEVER_FUNDED)).toBe(true);
      for (const absent of [`data-api/accounts/${NEVER_FUNDED}.json`, `data-api/accounts/${NEVER_FUNDED}/balances.json`, `data-api/accounts/${NEVER_FUNDED}/orders.json`, `node/account_info/${NEVER_FUNDED}.json`]) {
        expect(exists(`${net}/${absent}`), absent).toBe(false);
      }
      for (const endpoint of ["transactions", "payments", "exchanges"]) expect(rowsOf(net, NEVER_FUNDED, endpoint)).toEqual([]);
    });
  });

  it("has an XRPL deleted account whose history ends with its AccountDelete", () => {
    const rows = rowsOf("xrpl", DELETED.xrpl, "transactions");
    expect(rows[0].tx).toMatchObject({ TransactionType: "AccountDelete", Account: DELETED.xrpl });
    expect(rows[0].meta.TransactionResult).toBe("tesSUCCESS");
  });

  it("has an active XRPL account that owns what its objects say, and a trade it was part of on each side", () => {
    const info = json(`xrpl/node/account_info/${ACTIVE.xrpl}.json`).result.account_data;
    const objects = json(`xrpl/node/account_objects/${ACTIVE.xrpl}.json`).result.account_objects;
    expect(info.OwnerCount).toBe(objects.length); // one trust line, and nothing else it owns
    const roles = new Set(rowsOf("xrpl", ACTIVE.xrpl, "exchanges").map((row) => (row.taker === ACTIVE.xrpl ? "taker" : "provider")));
    expect([...roles].sort()).toEqual(["provider", "taker"]);
  });

  it("appears in no recording: the never-funded address", () => {
    for (const set of readdirSync(LEDGERS)) {
      for (const file of readdirSync(new URL(`${set}/`, LEDGERS)).filter((name) => name.endsWith(".gz"))) {
        const text = gunzipSync(readFileSync(new URL(`${set}/${file}`, LEDGERS))).toString("utf8");
        expect(text, `${set}/${file}`).not.toContain(NEVER_FUNDED);
      }
    }
  });
});

describe("the binary codec", () => {
  it("is imported by scripts and tests only, never by the app or the Worker (a devDependency)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies).toHaveProperty("ripple-binary-codec");
    expect(pkg.dependencies).not.toHaveProperty("ripple-binary-codec");

    const roots = ["../../app/", "../../workers/"];
    const offenders: string[] = [];
    const walk = (dir: URL) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
        if (entry.isDirectory()) walk(child);
        else if (/\.(ts|tsx)$/.test(entry.name) && /ripple-binary-codec/.test(readFileSync(child, "utf8"))) offenders.push(child.pathname);
      }
    };
    for (const root of roots) walk(new URL(root, import.meta.url));
    expect(offenders).toEqual([]);
  });
});
