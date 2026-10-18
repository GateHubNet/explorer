// Changing what the fixture server answers while a test runs, so that the chain can move on under an open page (live-home.spec.ts). The fixture
// server is the stack's (test/e2e/stack.ts), another process than the tests', and listens on a port the tests know (`fixturePort`); it takes
// the overrides over HTTP (test/support/fixture-server.ts). Not for a real stack or a deployed Worker, which have no such server.

import { readFileSync } from "node:fs";

import { fixturePort } from "../../scripts/e2e-env";

const url = () => `http://127.0.0.1:${fixturePort(process.env)}/__fixture/overrides`;

async function send(method: "PUT" | "DELETE", body?: unknown): Promise<void> {
  const response = await fetch(url(), {
    method,
    headers: { "Content-Type": "application/json", "X-Fixture-Control": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`the fixture server refused ${method}: ${response.status} ${await response.text()}`);
}

export const fixtures = {
  /** Answers with these (override keys as for `mockUpstream`, the unprefixed ones XRPL's; JSON bodies) instead of the recorded answers. */
  override: (overrides: Record<string, unknown>) => send("PUT", overrides),
  /** Back to the recorded answers. */
  reset: () => send("DELETE"),
};

const recorded = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../fixtures/http/xrpl/data-api/${path}.json`, import.meta.url), "utf8")) as T;

/** The newest recorded XRPL ledger, and the one before it that the recordings have in full. */
export const HEAD = 107721455;
export const BEFORE_HEAD = 107720688;

interface FeesAnswer {
  rows: unknown[];
  count: number;
  [key: string]: unknown;
}

/**
 * What the data API says for the XRPL home page when the chain is one recorded ledger behind the recordings' newest: that ledger (107,720,688)
 * is the newest, the ledgers listed are the recorded ones from it down, the transactions its own newest. Put them in with
 * `fixtures.override`, open the page, take them away with `fixtures.reset`, and the home page that follows the chain gets the recordings'
 * newest ledger (107,721,455, 107 transactions) as the next one.
 */
export function xrplHomeOneLedgerBehind(): Record<string, unknown> {
  const { ledger } = recorded<{ ledger: { ledger_hash: string; parent_hash: string; close_time: number } }>(`ledgers/${BEFORE_HEAD}`);
  const full = recorded<{ ledger: { transactions: Array<{ meta: { TransactionIndex: number } }> } }>(`ledgers/${BEFORE_HEAD}@expand=true&transactions=true`);
  const fees = recorded<FeesAnswer>("network/fees@descending=true&limit=8");
  // The ledger as the API's /last_validated says it: the close time as ISO 8601 without milliseconds.
  const closed = new Date(ledger.close_time * 1000).toISOString().replace(".000Z", "Z");
  const newestFirst = [...full.ledger.transactions].sort((a, b) => b.meta.TransactionIndex - a.meta.TransactionIndex).slice(0, 8);
  return {
    "GET /v2/last_validated": {
      result: "success",
      ledger_index: String(BEFORE_HEAD),
      ledger_hash: ledger.ledger_hash,
      parent_hash: ledger.parent_hash,
      close_time: closed,
    },
    "GET /v2/network/fees?descending=true&limit=8": { ...fees, rows: fees.rows.slice(1), count: fees.rows.length - 1 },
    "GET /v2/transactions?descending=true&limit=8": { result: "success", count: newestFirst.length, transactions: newestFirst },
  };
}
