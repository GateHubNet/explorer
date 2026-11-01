// What the answers of D7's two routes must look like for the supply page (E12) to use them: the native supply at one ledger, and Xahau's minting per day (data-api `feat/explorer-data-2` at
// 31e97efaa1a6e098435b666e8893c79a0c4bee66, docs/api-reference.md `GET /v2/network/supply` and `GET /v2/network/supply/minted`; the types are in api-types.ts, "Supply"). Like `token-shape.ts`,
// the data API client runs the checks inside the load its subrequest cache runs, as `get()`'s `finish`: a 200 that is not what the reference promises is an `UpstreamError` of kind `server`
// (status 200 marks it as an answer of the upstream), is never stored, and the page fails with it. A check takes the whole body and the path that was asked for, whose message it names; the
// supply's also takes the native currency of the network asked. It returns the body, typed, as it is. Worker-only code, no I/O.
//
// What is checked (a key the API leaves out when it has no value is checked when it is there, and `null` is never served; extra keys are not refused, the API may add one):
//   - the supply has `result: "success"`, a `ledger_index` that is a positive whole number, a `close_time` and a `computed_at` that are times, and the `currency` of the network (`XRP` on the
//     XRP Ledger, `XAH` on Xahau): an answer for the other network is not the answer to that request, and the page would write its figures with the wrong code;
//   - `total`, `burned`, `escrowed` and `circulating` are there; `minted` (Xahau), `amm` (the XRP Ledger) and `reserves` are checked when they are;
//   - every amount is exact decimal text and not negative (`isDecimalText` lets a minus through, and a supply has no negative part); every count (`escrows`, `pools`, `accounts`, `owner_count`)
//     a whole number from 0;
//   - a part's `coverage`, when it has the key, goes through `checkCoverage`. The reference has every part but `total` and the XRP Ledger's `burned` end with one, and the types make it optional
//     (spec 3.1), so a part without one is not a failure (`burned` has none where the network cannot mint);
//   - a minted page has `result: "success"`, a `coverage` that is one (the feature `mints`'s), a `count`, a `marker` that is one when there is a next page, and `rows` that are a list: each row has
//     a `date` that is a time and its four amounts (`amount`, `rewards`, `import`, `genesis_mint`), all of them in every row.
// Not checked: that `circulating` is `total` less `escrowed`, or that `minted.amount` is the sum of its sources. Those are D7's to keep, and a page that drew a figure from one of them would
// be showing D7's number.

import { fields, isDecimalText, isIsoTime, isWhole, listOf } from "./aggregate-shape";
import type { MintedPage, NetworkSupply } from "./api-types";
import { checkCoverage } from "./coverage";
import { isObject, malformed } from "./tx-shape";

type Row = Record<string, unknown>;

const AMOUNT = "an amount (decimal text, not negative)";
const WHOLE = "a whole number";
const TIME = "a time";

/** An amount as D7 writes it: exact decimal text in whole units, never negative. */
const isAmount = (value: unknown): value is string => isDecimalText(value) && !value.startsWith("-");
/** A ledger: a positive whole number. */
const isLedger = (value: unknown): value is number => isWhole(value) && value >= 1;

/** What every answer starts with: an object that says `result: "success"`. */
function answerOf(what: string, body: unknown): Row {
  if (!isObject(body)) throw malformed(what, "the answer is not an object");
  if (body.result !== "success") throw malformed(what, 'result is not "success"');
  return body;
}

/**
 * The part `name` of the supply: an object whose `amount` and `amounts` are amounts and whose `counts` are whole numbers. Its coverage, when it has the key, must be one. A part that is
 * not there is an error when `required`, and nothing to check when it is not.
 */
function checkPart(what: string, body: Row, name: string, required: boolean, counts: readonly string[], amounts: readonly string[]): void {
  const part = body[name];
  if (part === undefined && !required) return;
  if (!isObject(part)) throw malformed(what, `${name} is not an object`);
  fields(what, name, part, ["amount", ...amounts], isAmount, AMOUNT);
  fields(what, name, part, counts, isWhole, WHOLE);
  // `checkCoverage` names the answer's `coverage`: the part it is of leads its reason.
  if (part.coverage !== undefined) checkCoverage(part, `${what} answered something unexpected: ${name}`);
}

/** `GET /v2/network/supply`: the snapshot, which must be the one of the network whose native currency is `native`. */
export function checkSupply(body: unknown, path: string, native: "XRP" | "XAH"): NetworkSupply {
  const what = `data API GET ${path}`;
  const head = answerOf(what, body);
  if (!isLedger(head.ledger_index)) throw malformed(what, "ledger_index is not a positive whole number");
  fields(what, "answer", head, ["close_time", "computed_at"], isIsoTime, TIME);
  if (head.currency !== native) throw malformed(what, `currency is not ${native}`);
  fields(what, "answer", head, ["total"], isAmount, AMOUNT);
  checkPart(what, head, "burned", true, [], []);
  checkPart(what, head, "minted", false, [], ["rewards", "import", "genesis_mint"]);
  checkPart(what, head, "escrowed", true, ["escrows"], []);
  checkPart(what, head, "circulating", true, [], []);
  checkPart(what, head, "amm", false, ["pools"], []);
  checkPart(what, head, "reserves", false, ["accounts", "owner_count"], ["base", "increment"]);
  return head as unknown as NetworkSupply;
}

/** `GET /v2/network/supply/minted`: the days of the minting, with the coverage of the mints. An empty list is an answer (a network that cannot mint). */
export function checkMintedPage(body: unknown, path: string): MintedPage {
  const what = `data API GET ${path}`;
  const head = answerOf(what, body);
  checkCoverage(head, `${what} answered something unexpected`);
  for (const [index, row] of listOf(what, head, "rows").entries()) {
    const where = `rows[${index}]`;
    fields(what, where, row, ["date"], isIsoTime, TIME);
    fields(what, where, row, ["amount", "rewards", "import", "genesis_mint"], isAmount, AMOUNT);
  }
  return head as unknown as MintedPage;
}
