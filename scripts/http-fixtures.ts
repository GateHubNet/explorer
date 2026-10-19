// What `pnpm fixtures:sync` writes into test/fixtures/http/: the data API's and the nodes' answers for the recorded
// mainnet ledgers (test/fixtures/ledgers/), shaped as those servers shape them. The CLI is make-http-fixtures.ts;
// test/support/upstream-core.ts says how a request finds its file.
//
// The answers follow the references: the data API's in data-api-new/docs/api-reference.md (and app/server/api-types.ts),
// the nodes' in rippled's API v1. The data API serves a transaction in its canonical form (decoded again from the binary
// format, so neither `hash` nor `DeliverMax` is in `tx`, and every successful Payment's metadata has `delivered_amount`),
// a ledger's transactions in ledger order, and its times as unix seconds or ISO text; a node serves Ripple-epoch times.
//
// Files with account data (test/fixtures/http/<net>/data-api/accounts/, node/account_info, node/account_objects and
// node/server_state.json) are written by hand and left alone; the transactions they name are served here too.
//
// What the recordings cannot give, the network page's aggregates over months, fee snapshots and validations, is synthetic: a seeded
// generator in network-fixtures.ts, called from `generate` below (README.md, "Upstream fixtures"; PROVENANCE.md, "Synthetic aggregates").
//
// `?binary=true` answers (`transactions/<HASH>@binary=true.json`) hold `tx` and `meta` as the hex of their serialization,
// made here with ripple-binary-codec (a devDependency: the Worker never serializes). XRPL uses the codec's own definitions,
// Xahau the ones recorded from a Xahau node (test/fixtures/definitions/xahau/server_definitions.json, see PROVENANCE.md).

import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { DEFAULT_DEFINITIONS, encode, XrplDefinitions, type XrplDefinitionsBase } from "ripple-binary-codec";

import type { FeeRow, LastValidated, Ledger, LedgerExpanded, LedgerWithHashes, Page, TxBinary, TxObject } from "../app/server/api-types";
import { dataApiFile, nodeFile, type NetworkName } from "../test/support/upstream-core";
import { networkFixtures } from "./network-fixtures";

export const LEDGERS = new URL("../test/fixtures/ledgers/", import.meta.url);
export const HTTP = new URL("../test/fixtures/http/", import.meta.url);

/** Seconds from the unix epoch to the Ripple epoch, 2000-01-01. */
const RIPPLE_EPOCH = 946_684_800;

/** The recorded sets that make up each network (test/fixtures/PROVENANCE.md). */
export const SETS: Record<NetworkName, string[]> = {
  xrpl: ["xrpl", "xrpl-amm", "xrpl-extra"],
  xahau: ["xahau", "xahau-extra"],
};

/** The prefix a transaction's hash is taken over, `TXN\0`: SHA-512Half of it and the serialized transaction is the hash. */
export const TX_HASH_PREFIX = "54584E00";

/** The binary codec's definitions of a network: the codec's own for XRPL, the recorded ones for Xahau (which has types XRPL has not). */
export function definitionsFor(net: NetworkName): XrplDefinitionsBase {
  if (net === "xrpl") return DEFAULT_DEFINITIONS;
  const recorded = readFileSync(new URL("../test/fixtures/definitions/xahau/server_definitions.json", import.meta.url), "utf8");
  return (xahauDefinitions ??= new XrplDefinitions(JSON.parse(recorded)));
}
let xahauDefinitions: XrplDefinitions | undefined;

/**
 * The ledgers served with their transactions in full (`?expand=true`) by the data API and by the node: the newest one,
 * which pages treat as live, and one that has a ledger after it. Xahau's two neighbours, 26540187 and 26540188, are the
 * only consecutive ledgers of the recordings (previous and next links that lead somewhere).
 */
export const EXPANDED: Record<NetworkName, number[]> = {
  xrpl: [107720688, 107721455],
  xahau: [26540187, 26540188, 26596843],
};

/** How many of the newest ledgers and transactions the list endpoints (`limit=8`) give. */
const LATEST = 8;

// ---- The recordings --------------------------------------------------------------------------------------------------

export type RawTx = Record<string, unknown> & {
  hash: string;
  TransactionType: string;
  Account: string;
  Fee?: string;
  metaData: Record<string, unknown> & { TransactionIndex: number; TransactionResult: string };
};

export interface RawLedger {
  ledger_hash: string;
  ledger_index: number;
  validated: boolean;
  ledger: {
    ledger_hash: string;
    ledger_index: string;
    parent_hash: string;
    total_coins: string;
    close_time: number;
    parent_close_time: number;
    close_time_resolution: number;
    close_flags: number;
    account_hash: string;
    transaction_hash: string;
    transactions: RawTx[];
    [field: string]: unknown;
  };
}

/** The ledgers of a network, from its recorded sets, oldest first. */
export function readLedgers(net: NetworkName): RawLedger[] {
  const ledgers: RawLedger[] = [];
  for (const set of SETS[net]) {
    const dir = new URL(`${set}/`, LEDGERS);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".json.gz"))) {
      ledgers.push(JSON.parse(gunzipSync(readFileSync(new URL(file, dir))).toString("utf8")) as RawLedger);
    }
  }
  return ledgers.sort((a, b) => Number(a.ledger.ledger_index) - Number(b.ledger.ledger_index));
}

/** The hashes the recordings' manifests name: one transaction per type found and per AMM case. */
export function manifestHashes(net: NetworkName): string[] {
  const hashes = new Set<string>();
  for (const set of SETS[net]) {
    const manifest = JSON.parse(readFileSync(new URL(`${set}/manifest.json`, LEDGERS), "utf8")) as Record<string, unknown>;
    for (const part of [manifest.found, manifest.cases]) {
      for (const entry of Object.values((part ?? {}) as Record<string, { hash?: string }>)) {
        if (entry.hash) hashes.add(entry.hash);
      }
    }
  }
  return [...hashes];
}

/** The transactions of a ledger in ledger order (the recorder lists them in the order of the ledger's hash tree). */
export function inLedgerOrder(raw: RawLedger): RawTx[] {
  return [...raw.ledger.transactions].sort((a, b) => a.metaData.TransactionIndex - b.metaData.TransactionIndex);
}

// ---- Times -----------------------------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/** Unix seconds of a Ripple-epoch time. */
export const unixOf = (rippleTime: number) => rippleTime + RIPPLE_EPOCH;

function clock(unix: number) {
  const d = new Date(unix * 1000);
  return {
    date: `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`,
    time: `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`,
    human: `${d.getUTCFullYear()}-${MONTHS[d.getUTCMonth()]}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`,
  };
}

/** `2026-10-15T11:19:30Z`, the data API's usual time. */
export const isoTime = (unix: number) => `${clock(unix).date}T${clock(unix).time}Z`;
/** `2026-10-15T11:19:30+00:00`, the `date` of a transaction. */
export const txDate = (unix: number) => `${clock(unix).date}T${clock(unix).time}+00:00`;
/** `2026-Oct-15 11:19:30`, the `close_time_human` of a ledger. */
export const humanTime = (unix: number) => clock(unix).human;

// ---- The data API's shapes -------------------------------------------------------------------------------------------

/** A transaction as the data API serves it (`ledger_hash` only where the endpoint adds it). */
export function dataApiTx(raw: RawLedger, tx: RawTx, withLedgerHash = false): TxObject {
  const { hash, metaData, DeliverMax: _deliverMax, ...fields } = tx;
  const meta: Record<string, unknown> = { ...metaData };
  // The API computes `delivered_amount` itself from the binary fields; the recorded one is the node's.
  delete meta.delivered_amount;
  if (tx.TransactionType === "Payment" && metaData.TransactionResult === "tesSUCCESS") {
    meta.delivered_amount = metaData.DeliveredAmount ?? tx.Amount;
  }
  const object = {
    hash,
    ledger_index: Number(raw.ledger.ledger_index),
    date: txDate(unixOf(raw.ledger.close_time)),
    tx: fields,
    meta,
    ...(withLedgerHash && { ledger_hash: raw.ledger_hash }),
  };
  return object as unknown as TxObject;
}

/**
 * A transaction as `?binary=true` serves it: the same head, `tx` and `meta` as the upper-case hex of their serialization.
 * The blob of `tx` is the serialization the hash is taken over, so it re-hashes to `hash` (`TX_HASH_PREFIX`).
 */
export function binaryTx(net: NetworkName, served: TxObject): TxBinary {
  const definitions = definitionsFor(net);
  return {
    hash: served.hash,
    ledger_index: served.ledger_index,
    date: served.date,
    tx: encode(served.tx, definitions),
    meta: encode(served.meta, definitions),
  };
}

/** A ledger as the data API serves it, without its transactions. */
export function dataApiLedger(raw: RawLedger): Ledger {
  const header = raw.ledger;
  return {
    ledger_hash: raw.ledger_hash,
    ledger_index: Number(header.ledger_index),
    parent_hash: header.parent_hash,
    total_coins: header.total_coins,
    close_time: unixOf(header.close_time),
    close_time_human: humanTime(unixOf(header.close_time)),
    close_time_resolution: String(header.close_time_resolution),
    close_flags: String(header.close_flags),
    parent_close_time: unixOf(header.parent_close_time),
    account_hash: header.account_hash,
    transaction_hash: header.transaction_hash,
    hash: raw.ledger_hash,
    seqNum: String(header.ledger_index),
    totalCoins: header.total_coins,
    accepted: "true",
    closed: "true",
  };
}

export function dataApiLastValidated(raw: RawLedger): LastValidated {
  return {
    result: "success",
    ledger_index: String(raw.ledger.ledger_index),
    ledger_hash: raw.ledger_hash,
    parent_hash: raw.ledger.parent_hash,
    close_time: isoTime(unixOf(raw.ledger.close_time)),
  };
}

/** The marker of a list that continues after a transaction: the base64url of `[ledger_index, tx_index]`. */
export function txMarker(ledgerIndex: number, txIndex: number): string {
  return Buffer.from(JSON.stringify([ledgerIndex, txIndex])).toString("base64url");
}

/** A row of `/v2/network/fees` (`interval=ledger`): the fees the transactions of a ledger paid, in whole native units. */
export function feeRow(raw: RawLedger): FeeRow {
  const fees = raw.ledger.transactions.map((tx) => BigInt(tx.Fee ?? "0"));
  const total = fees.reduce((sum, fee) => sum + fee, 0n);
  const toNative = (drops: bigint) => Number(drops) / 1_000_000;
  // The mean to six significant digits, then to a drop (fee-object.ts of data-api-new).
  const mean = fees.length === 0 ? 0 : Number((toNative(total) / fees.length).toPrecision(6));
  return {
    avg: Math.round(Number(`${mean.toFixed(12)}e6`)) / 1_000_000,
    max: toNative(fees.reduce((most, fee) => (fee > most ? fee : most), 0n)),
    min: toNative(fees.length === 0 ? 0n : fees.reduce((least, fee) => (fee < least ? fee : least))),
    total: toNative(total),
    tx_count: fees.length,
    date: isoTime(unixOf(raw.ledger.close_time)),
    ledger_index: Number(raw.ledger.ledger_index),
  };
}

// ---- The nodes' shapes -----------------------------------------------------------------------------------------------

/** `tx` of rippled (API v1): the transaction's fields with `meta` and the ledger it is in. Times count from 2000. */
export function nodeTxResult(raw: RawLedger, tx: RawTx): Record<string, unknown> {
  const { metaData, ...fields } = tx;
  return {
    ...fields,
    meta: metaData,
    validated: true,
    date: raw.ledger.close_time,
    inLedger: Number(raw.ledger.ledger_index),
    ledger_index: Number(raw.ledger.ledger_index),
    status: "success",
  };
}

/** `ledger` of rippled: the header as recorded, with the transactions as asked for. */
export function nodeLedgerResult(raw: RawLedger, transactions: "none" | "hashes" | "expanded"): Record<string, unknown> {
  const { transactions: all, ...header } = raw.ledger;
  return {
    ledger: {
      ...header,
      ...(transactions === "hashes" && { transactions: all.map((tx) => tx.hash) }),
      ...(transactions === "expanded" && { transactions: all }),
    },
    ledger_hash: raw.ledger_hash,
    ledger_index: raw.ledger_index,
    validated: true,
    status: "success",
  };
}

// ---- Text ------------------------------------------------------------------------------------------------------------

/**
 * Containers nested this deep (counting the root as 0) are written on one line, and a list of transactions
 * (`transactions`, wherever it is) is written one transaction to a line: a transaction is one line.
 */
const INLINE_DEPTH = 3;

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, sorted(item)]));
  }
  return value;
}

function layout(value: unknown, depth: number, indent: string): string {
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (depth >= INLINE_DEPTH) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => `${inner}${layout(item, depth + 1, inner)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  const lines = entries.map(([key, item]) => {
    // The list of transactions breaks at the level of the ledger's own, however deep the ledger lies.
    const childDepth = key === "transactions" && Array.isArray(item) ? Math.min(depth + 1, INLINE_DEPTH - 1) : depth + 1;
    return `${inner}${JSON.stringify(key)}: ${layout(item, childDepth, inner)}`;
  });
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** A fixture file's text: keys sorted, two-space indent down to the transactions, one line each below, a final newline. */
export function fixtureText(value: unknown): string {
  return `${layout(sorted(value), 0, "")}\n`;
}

// ---- Which files are written by hand ---------------------------------------------------------------------------------

/** Paths (below test/fixtures/http/) of files that hold account data and are written by hand; the generator leaves them. */
export function isHandWritten(path: string): boolean {
  return /^(xrpl|xahau)\/data-api\/accounts\//.test(path) || /^(xrpl|xahau)\/node\/(account_info|account_objects)\//.test(path) || /^(xrpl|xahau)\/node\/server_state\.json$/.test(path);
}

/**
 * Paths (below test/fixtures/http/) of the synthetic aggregates, fee snapshots and validations that network-fixtures.ts writes: reviewed in the
 * generator and not in the files, they have a size budget of their own (test/unit/http-fixtures.test.ts), and `network-fixtures.test.ts` keeps
 * this in step with the generator.
 */
export function isSynthetic(path: string): boolean {
  return /^(xrpl|xahau)\/data-api\/(stats\/|ledgers\/[0-9A-F]{64}\/validations@|network\/(fee_stats@|fees@end=|(payment|exchange|amm)_volume@))/.test(path);
}

/** The hashes of the transactions the hand-written account lists name, so that every row can be opened. */
function accountListHashes(net: NetworkName): string[] {
  const dir = new URL(`${net}/data-api/accounts/`, HTTP);
  const hashes: string[] = [];
  let accounts: string[];
  try {
    accounts = readdirSync(dir);
  } catch {
    return hashes;
  }
  for (const account of accounts) {
    let files: string[];
    try {
      files = readdirSync(new URL(`${account}/`, dir));
    } catch {
      continue; // `<account>.json`: the account's creation, not a directory
    }
    for (const file of files) {
      const body = JSON.parse(readFileSync(new URL(`${account}/${file}`, dir), "utf8")) as Record<string, Array<{ hash?: string; tx_hash?: string }> | undefined>;
      for (const row of [...(body.transactions ?? []), ...(body.payments ?? []), ...(body.exchanges ?? [])]) {
        const hash = row.hash ?? row.tx_hash;
        if (hash) hashes.push(hash);
      }
    }
  }
  return hashes;
}

// ---- Comparing with the disk -------------------------------------------------------------------------------------------

/** Every file below `dir`, as paths relative to it. */
function filesBelow(dir: URL, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...filesBelow(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`));
    else found.push(`${prefix}${entry.name}`);
  }
  return found;
}

export interface Differences {
  /** Generated files that are not on disk. */
  missing: string[];
  /** Generated files whose text differs from the disk's. */
  changed: string[];
  /** Files on disk that are neither generated nor written by hand. */
  stale: string[];
}

/** How the generated files differ from test/fixtures/http/ (`pnpm fixtures:check` and the test of this file; the command is make-http-fixtures.ts). */
export function compare(generated: Map<string, string>): Differences {
  const missing: string[] = [];
  const changed: string[] = [];
  for (const [path, text] of generated) {
    let onDisk: string;
    try {
      onDisk = readFileSync(new URL(path, HTTP), "utf8");
    } catch {
      missing.push(path);
      continue;
    }
    if (onDisk !== text) changed.push(path);
  }
  let present: string[] = [];
  try {
    present = filesBelow(HTTP);
  } catch {
    // No fixtures directory yet.
  }
  const stale = present.filter((path) => !generated.has(path) && !isHandWritten(path));
  return { missing: missing.sort(), changed: changed.sort(), stale: stale.sort() };
}

// ---- Generating ------------------------------------------------------------------------------------------------------

/** Every generated file of the fixtures: path below test/fixtures/http/ and text. */
export function generate(): Map<string, string> {
  const files = new Map<string, string>();
  const put = (path: string | undefined, value: unknown) => {
    if (path === undefined) throw new Error("no file for a fixture");
    files.set(path, fixtureText(value));
  };
  const api = (net: NetworkName, path: string, query: string, value: unknown) => put(dataApiFile(net, path, query), value);

  for (const net of Object.keys(SETS) as NetworkName[]) {
    const ledgers = readLedgers(net);
    const head = ledgers.at(-1)!;
    const byHash = new Map<string, { raw: RawLedger; tx: RawTx }>();
    for (const raw of ledgers) for (const tx of raw.ledger.transactions) byHash.set(tx.hash, { raw, tx });

    api(net, "/v2/last_validated", "", dataApiLastValidated(head));
    put(`${net}/ledger-hashes.json`, Object.fromEntries(ledgers.map((raw) => [raw.ledger_hash, raw.ledger_index])));

    for (const raw of ledgers) {
      const index = Number(raw.ledger.ledger_index);
      const ledger = dataApiLedger(raw);
      const ordered = inLedgerOrder(raw);
      const plain: { result: "success"; ledger: Ledger } = { result: "success", ledger };
      const hashes: { result: "success"; ledger: LedgerWithHashes } = {
        result: "success",
        ledger: { ...ledger, transactions: ordered.map((tx) => tx.hash) },
      };
      api(net, `/v2/ledgers/${index}`, "", plain);
      api(net, `/v2/ledgers/${index}`, "transactions=true", hashes);

      if (EXPANDED[net].includes(index)) {
        const expanded: { result: "success"; ledger: LedgerExpanded } = {
          result: "success",
          ledger: { ...ledger, transactions: ordered.map((tx) => dataApiTx(raw, tx)) },
        };
        api(net, `/v2/ledgers/${index}`, "expand=true&transactions=true", expanded);
        for (const [shape, flags] of [["none", {}], ["hashes", { transactions: true }], ["expanded", { transactions: true, expand: true }]] as const) {
          put(nodeFile(net, "ledger", { ledger_index: index, ...flags }), { result: nodeLedgerResult(raw, shape) });
        }
      }
    }

    // The newest transactions, newest first, as `/v2/transactions?descending=true&limit=8` gives them.
    const newest: Array<{ raw: RawLedger; tx: RawTx }> = [];
    for (const raw of [...ledgers].reverse()) {
      for (const tx of [...inLedgerOrder(raw)].reverse()) if (newest.length < LATEST) newest.push({ raw, tx });
      if (newest.length >= LATEST) break;
    }
    const last = newest.at(-1)!;
    const page: Page<"transactions", TxObject> = {
      result: "success",
      count: newest.length,
      marker: txMarker(Number(last.raw.ledger.ledger_index), last.tx.metaData.TransactionIndex),
      transactions: newest.map(({ raw, tx }) => dataApiTx(raw, tx, true)),
    };
    api(net, "/v2/transactions", "descending=true&limit=8", page);

    const rows = [...ledgers].reverse().slice(0, LATEST).map(feeRow);
    const fees: Page<"rows", FeeRow> = { result: "success", count: rows.length, marker: String(rows.at(-1)!.ledger_index), rows };
    api(net, "/v2/network/fees", "descending=true&limit=8", fees);

    // The network page's aggregates, fee snapshot and validations: synthetic. The validations are of the two newest ledgers (the end-to-end suite
    // moves the chain back by one), which are the first two rows of the list above.
    const newestTwo = rows.slice(0, 2).map((row, at) => ({ index: row.ledger_index, hash: ledgers[ledgers.length - 1 - at]!.ledger_hash, date: row.date }));
    for (const { path, query, value } of networkFixtures(net, dataApiLastValidated(head), newestTwo)) api(net, path, query, value);

    // Single transactions: one per type the recordings looked for, the newest ones, and those the account lists show.
    const served = new Set([...manifestHashes(net), ...newest.map(({ tx }) => tx.hash), ...accountListHashes(net)]);
    for (const hash of served) {
      const found = byHash.get(hash);
      if (!found) throw new Error(`${net}: no recorded transaction ${hash}`);
      const served = dataApiTx(found.raw, found.tx);
      api(net, `/v2/transactions/${hash}`, "", { result: "success", transaction: served });
      api(net, `/v2/transactions/${hash}`, "binary=true", { result: "success", transaction: binaryTx(net, served) });
      put(nodeFile(net, "tx", { transaction: hash }), { result: nodeTxResult(found.raw, found.tx) });
    }
  }
  return files;
}
