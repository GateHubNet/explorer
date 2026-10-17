// Test-only access to the recorded mainnet ledgers in test/fixtures/ledgers/ (see test/fixtures/PROVENANCE.md).
// Uses Node's fs and zlib, so it must never be imported from app code.

import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { TxJson, TxMeta } from "../../app/domain/parse/types";

export type FixtureSet = "xrpl" | "xrpl-amm" | "xahau";

export type FixtureTx = {
  tx: TxJson;
  meta: TxMeta;
  ledgerIndex: number;
  /** The ledger's close time, in seconds since the Ripple epoch (2000-01-01 00:00:00 UTC). */
  closeTime: number;
};

const DIR = new URL("../fixtures/ledgers/", import.meta.url);

/** Freezes a value and everything in it, so that a parser that writes to its input throws in a test. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

type RawLedger = {
  ledger: {
    ledger_index: string | number;
    close_time: number;
    transactions: Array<Record<string, unknown> & { hash: string; metaData?: TxMeta; meta?: TxMeta }>;
  };
};

const cache = new Map<FixtureSet, FixtureTx[]>();

/** Every transaction of every ledger of a set, in ledger order and then ledger position. Deep-frozen. */
export function allTxs(set: FixtureSet): FixtureTx[] {
  const cached = cache.get(set);
  if (cached) return cached;

  const dir = new URL(`${set}/`, DIR);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json.gz"))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

  const txs: FixtureTx[] = [];
  for (const file of files) {
    const { ledger } = JSON.parse(gunzipSync(readFileSync(new URL(file, dir))).toString("utf8")) as RawLedger;
    for (const { metaData, meta, ...tx } of ledger.transactions) {
      const txMeta = metaData ?? meta;
      if (!txMeta) throw new Error(`${set}/${file}: transaction ${tx.hash} has no metadata`);
      txs.push({
        tx: tx as TxJson,
        meta: txMeta,
        ledgerIndex: Number(ledger.ledger_index),
        closeTime: ledger.close_time,
      });
    }
  }
  cache.set(set, deepFreeze(txs));
  return txs;
}

/** One transaction of a set by its hash (upper-case hex), with its metadata. Throws if the set has no such hash. */
export function loadTx(set: FixtureSet, hash: string): FixtureTx {
  const found = allTxs(set).find(({ tx }) => tx.hash === hash);
  if (!found) throw new Error(`no transaction ${hash} in the ${set} fixtures`);
  return found;
}

/** The set's `manifest.json`, as the recorder wrote it. */
export function loadManifest(set: FixtureSet): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`${set}/manifest.json`, DIR), "utf8"));
}
