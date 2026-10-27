// The `coverage` of an answer of the data API (data-api-new D3, docs/api-reference.md "Coverage"): how much of the ledger history the index the answer is read from holds.
// Every NFT answer has it as the key after `result` (and later features of the same program will); it is not in the CSV. Worker-only code, no I/O.
//
//   "coverage": { "from_ledger_index": 107874617, "complete": false }
//
// `from_ledger_index` is where the feature's rows start (a ledger, so a positive whole number; left out when no ledger is stored at all), `complete` that no row can be
// missing. A page that cannot tell whether its history is whole would say it is, so an answer whose coverage is not that is a failure: it is checked inside the load the
// subrequest cache runs, with the rest of the answer (nft-shape.ts), and never stored.

import type { Coverage } from "./api-types";
import { isObject } from "./tx-shape";
import { UpstreamError } from "./upstream";

/**
 * The `coverage` of an answer body: an object with `complete` a boolean and `from_ledger_index`, when it is there, a positive whole number. Anything else, or none, is an
 * `UpstreamError` of kind `server` (status 200 marks it as an answer of the upstream) whose message starts with `path`, which names what was asked: the shape checks pass
 * `data API GET <request> answered something unexpected`, a caller with the body alone gets "the answer".
 */
export function checkCoverage(body: unknown, path = "the answer"): Coverage {
  const coverage = isObject(body) ? body.coverage : undefined;
  if (!isObject(coverage)) throw refused(path, "coverage is not an object");
  if (typeof coverage.complete !== "boolean") throw refused(path, "coverage.complete is not a boolean");
  const from = coverage.from_ledger_index;
  if (from !== undefined && !(typeof from === "number" && Number.isSafeInteger(from) && from >= 1)) {
    throw refused(path, "coverage.from_ledger_index is not a positive whole number");
  }
  return coverage as unknown as Coverage;
}

function refused(path: string, why: string): UpstreamError {
  return new UpstreamError("server", `${path}: ${why}`, { status: 200 });
}
