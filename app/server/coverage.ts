// The `coverage` of an answer of the data API (data-api-new D3, docs/api-reference.md "Coverage"): how much of the ledger history the index the answer is read from holds.
// Every NFT answer has it as the key after `result` (and later features of the same program will); it is not in the CSV. Worker-only code, no I/O.
// `checkCoverage` is the check of the answer, `coverageNote` the line a page says of it (spec 8), which the `CoverageNote` component draws.
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

/**
 * The line a page says of an incomplete coverage, in three parts so that the page draws the ledger as a link (`CoverageNote`): `before` and `after` are text around `ledger`,
 * which is `null` when there is no ledger to name (`before` is then the whole line and `after` is empty).
 */
export interface CoverageNoteText {
  before: string;
  ledger: number | null;
  after: string;
}

/**
 * The note under a list or a figure whose history the index holds only from a ledger on (spec 8): `null` when `coverage.complete` (nothing can be missing), else
 * "Covers ledger #N onwards: earlier {words} are not in the index yet." (`words` is what the list holds: "NFT sales", "collections", "NFT activity"), or with a `subject`
 * "{subject} in the index starts at ledger #N: earlier {words} are not in the index yet." (an NFT's own: "This NFT's history"). A coverage without `from_ledger_index`
 * (D3: no ledger is stored at all) is "The index does not hold this history yet."
 *
 * The ledger is as the answer has it. D3 can give the one after the newest stored ledger (a parser rollout has just begun), a ledger that the index does not hold yet: its page
 * answers 404 for a few seconds, and the link is as any other.
 */
export function coverageNote(coverage: Coverage, words: string, subject?: string): CoverageNoteText | null {
  if (coverage.complete) return null;
  const ledger = coverage.from_ledger_index;
  if (ledger === undefined) return { before: "The index does not hold this history yet.", ledger: null, after: "" };
  const earlier = `earlier ${words} are not in the index yet.`;
  return subject === undefined
    ? { before: "Covers ledger ", ledger, after: ` onwards: ${earlier}` }
    : { before: `${subject} in the index starts at ledger `, ledger, after: `: ${earlier}` };
}
