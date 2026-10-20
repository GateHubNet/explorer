// Changing what the fixture server answers while a test runs, so that the chain can move on under an open page (live-home.spec.ts). The fixture
// server is the stack's (test/e2e/stack.ts), another process than the tests', and listens on a port the tests know (`fixturePort`); it takes
// the overrides over HTTP (test/support/fixture-server.ts). Not for a real stack or a deployed Worker, which have no such server.

import { readFileSync } from "node:fs";

import { fixturePort } from "../../scripts/e2e-env";
import { XRPL_HEAD_LEDGER, XRPL_LEDGER } from "./fixtures";

const url = () => `http://127.0.0.1:${fixturePort(process.env)}/__fixture/overrides`;

async function send(method: "PUT" | "DELETE", body?: unknown): Promise<void> {
  const response = await fetch(url(), {
    method,
    headers: { "Content-Type": "application/json", "X-Fixture-Control": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`the fixture server refused ${method}: ${response.status} ${await response.text()}`);
}

/**
 * An override that makes the call fail the way the data API does: `fixtures.override({ "GET /v2/stats/type?…": unavailable() })` answers 503
 * (`{ result: "error", message }`, not cacheable) until the overrides are reset. JSON cannot carry a `Response`, so the control path takes this
 * object and builds the answer (test/support/fixture-server.ts).
 */
export const unavailable = (status = 503, message = "unavailable") => ({ $error: { status, message } });

export const fixtures = {
  /** Answers with these (override keys as for `mockUpstream`, the unprefixed ones XRPL's; JSON bodies) instead of the recorded answers. */
  override: (overrides: Record<string, unknown>) => send("PUT", overrides),
  /** Back to the recorded answers. */
  reset: () => send("DELETE"),
};

const recorded = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../fixtures/http/xrpl/data-api/${path}.json`, import.meta.url), "utf8")) as T;

/** The newest recorded XRPL ledger (`last_validated`), and the one before it that the recordings have in full: `fixtures.ts` has them. */
export const HEAD = XRPL_HEAD_LEDGER;
export const BEFORE_HEAD = XRPL_LEDGER;

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

/** The issuer of RLUSD, the counter of the XRP/RLUSD market whose trades the fixtures derive from the recorded AMM ledgers. */
export const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";

/** RLUSD as the data API and the node are sent it: the code as the ledger holds it (40 hex), a `+` and the issuer. */
export const RLUSD_API = `524C555344000000000000000000000000000000+${RLUSD_ISSUER}`;

/** The first page of the trades of XRP/RLUSD, the call the pair page makes for its list (#2). */
const PAIR_TRADES = `exchanges/XRP/${RLUSD_API}@descending=true&limit=20`;

interface TradesAnswer {
  exchanges: unknown[];
  count: number;
  [key: string]: unknown;
}

/**
 * What the data API says for the trades of XRP/RLUSD when the market is one trade behind the recordings: the recorded first page without its
 * newest row (the trade of ledger 107,721,455, at 1.2890268 RLUSD), so the newest is the one before it (1.2935851 RLUSD). Put it in with
 * `fixtures.override`, open `/xrpl/markets/XRP/RLUSD.r…`, take it away with `fixtures.reset`, and the open page gets that trade as a new one.
 * Its marker (the Older link) is the recording's: the page behind it is the same.
 */
export function xrplPairOneTradeBehind(): Record<string, unknown> {
  const page = recorded<TradesAnswer>(PAIR_TRADES);
  return {
    [`GET /v2/exchanges/XRP/${RLUSD_API}?descending=true&limit=20`]: { ...page, exchanges: page.exchanges.slice(1), count: page.count - 1 },
  };
}

/**
 * The `result` a node gives for a call it cannot answer (`noNetwork`, HTTP 200 with `status: "error"`), as an override of a node key: the
 * node's answer for `node book_offers <gets>_<pays>` (test/support/upstream-core.ts has the codes; JSON carries it as it is).
 */
export const nodeNotSynced = () => ({ error: "noNetwork", error_code: 17, error_message: "Not synced to the network.", request: {}, status: "error" });

/**
 * What the data API says when the chain has crossed midnight UTC since the recordings: the newest ledger is the next one (107,721,456), closed
 * at 00:00:05 on Oct 18, so the index day is Oct 18 and every key a view asks for over a period (its `start` and `end`) is new. None of them has
 * a fixture, so each of those calls fails ("Cannot GET"), while the fees list, which has no dates in its query, is the recording's. Put it in
 * with `fixtures.override`, and the next beat of an open network page fails every part.
 */
export function xrplNextDay(): Record<string, unknown> {
  return {
    "GET /v2/last_validated": {
      result: "success",
      ledger_index: "107721456",
      ledger_hash: "C".repeat(64),
      parent_hash: "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092",
      close_time: "2026-10-18T00:00:05Z",
    },
  };
}
