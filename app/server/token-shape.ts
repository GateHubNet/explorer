// What the answers of D6's routes must look like for the token pages (E11) to use them: the list of issued tokens, one token, its holders and its transfers (data-api
// `feat/explorer-data-2` at 2fb4183721af6df58dd345f4a6ef90a293ae70b0, docs/api-reference.md "Tokens"; the types are in api-types.ts, "Tokens"). Like `object-shape.ts`, the data API client
// runs the checks inside the load its subrequest cache runs, as `get()`'s `finish`: a 200 that is not what the reference promises is an `UpstreamError` of kind `server` (status 200 marks
// it as an answer of the upstream), is never stored, and the page fails with it. A check takes the whole body and the path that was asked for, whose message it names; the detail's also
// takes the token that was asked for. It returns the body, typed, as it is, except for one field of a market that it deletes (below). Worker-only code, no I/O.
//
// What is checked (a key the API leaves out when it has no value is checked when it is there, and `null` is never served; extra keys are not refused, the API may add one):
//   - every answer has `result: "success"` and a `coverage` that is one (`checkCoverage`); the detail and the holders have a `ledger_index` that is a whole number and a `close_time`
//     that is a time, the list has them when it has a generation, and the transfers have none of their own;
//   - the list is `kind: "issued"` (the only kind there is), with a `count`, a `marker` that is one when there is a next page, and `tokens` that are a list. Before the first generation
//     exists the answer has no `totals`, no `total` and no ledger: all of those are optional. `totals.holders` is too, until the tokens job has counted the distinct holders;
//   - an issuer, a holder, a source and a destination are classic addresses with their checksum, because they go into a link (an X-address holds a tag and is not one); a transaction hash
//     is 64 hexadecimal digits; a time is `YYYY-MM-DDTHH:mm:ssZ`; counts, ranks, ledgers, trades and tags are whole numbers; a flag is a boolean;
//   - the amounts that D6 writes are number text (`isNumberText`): `supply`, `balance`, `limit`, `amount`, `volume`, `counter_volume`, `native_volume` (a row's, a market's and the totals'),
//     and the 8-significant-digit `price` and `last`, which are in exponent form below 0.000001 and from 100,000,000 (`"1.2000000e-7"`): the pages compute with them as with any decimal.
//     What D6 keeps plain is decimal text (`isDecimalText`): `price_change` and `change` (percent) and `transfer_fee`; and a `share` has exactly 6 decimals (`"0.117300"`);
//   - `toml.display_decimals` is a whole number from 0 to 30, the rest of the toml is text;
//   - the detail is the token that was asked for: its `currency` and `issuer` are the ones in the path, as the ledger holds the currency. An answer for another token is not the answer to
//     that request, and a page would show it as the one asked for;
//   - two fields are not checked but deleted when they are not readable: a market's `last` and a token's `price` (a row's and the detail's). D6 writes `"Infinity"` for a pair whose stored
//     rate is 0 (its ratio of 1 and 0, which it declined to fix): the `last` of that market, and the `price` of a token that is the counter side of its pair with the native currency.
//     One such pair or token must not take the whole list, or the token's page, down. A `last` or `price` that is not number text is deleted from the returned value, so that it reads as
//     not known (both are optional in the types) and the page draws "—", as `checkMarkets` does for an AMM field it cannot read. `price_change` and `price_time` are not affected: D6
//     leaves out a change that is not finite.

import { dropUnless, fields, isAccount, isBoolean, isDecimalText, isIsoTime, isName, isNumberText, isText, isWhole, listOf, optionalFields, rowsOf } from "./aggregate-shape";
import type { TokenAnswer, TokenHoldersResponse, TokensResponse, TokenTransfersResponse } from "./api-types";
import { checkCoverage } from "./coverage";
import { isObject, malformed } from "./tx-shape";

type Row = Record<string, unknown>;

const ACCOUNT = "an account";
const WHOLE = "a whole number";
const DECIMAL = "a decimal as text";
const NUMBER = "a number as text";
const TIME = "a time";
const BOOLEAN = "a boolean";

const SHARE = /^\d+\.\d{6}$/;
const HASH = /^[0-9A-Fa-f]{64}$/;

/** A share of a token's supply as D6 writes it: exact, 6 decimals, half up (`"0.117300"`). */
const isShare = (value: unknown): value is string => typeof value === "string" && SHARE.test(value);
const isHash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
/** The decimals a toml asks a token to be shown with: a whole number from 0 to 30. */
const isDisplayDecimals = (value: unknown): value is number => isWhole(value) && value <= 30;

/** The object under `where`, or a failure. */
function objectAt(what: string, where: string, value: unknown): Row {
  if (!isObject(value)) throw malformed(what, `${where} is not an object`);
  return value;
}

/** What every answer starts with: `result`, a coverage, and (`asOf`) the ledger it is as of. Returned, so that a check reads its keys from it. */
function answerOf(what: string, body: unknown, asOf: boolean): Row {
  if (!isObject(body)) throw malformed(what, "the answer is not an object");
  if (body.result !== "success") throw malformed(what, 'result is not "success"');
  checkCoverage(body, `${what} answered something unexpected`);
  if (asOf) {
    fields(what, "answer", body, ["ledger_index"], isWhole, WHOLE);
    fields(what, "answer", body, ["close_time"], isIsoTime, TIME);
  }
  return body;
}

/** What a row of the list and the token of the detail have in common, from `currency` to `listed` (the rest of each is its own). A `price` that is not number text is deleted. */
function checkTokenFields(what: string, where: string, token: Row): void {
  fields(what, where, token, ["currency"], isName, "a currency");
  optionalFields(what, where, token, ["code"], isName, "a code");
  fields(what, where, token, ["issuer"], isAccount, ACCOUNT);
  fields(what, where, token, ["holders", "trust_lines"], isWhole, WHOLE);
  fields(what, where, token, ["supply"], isNumberText, NUMBER);
  // A `price` D6 could not compute (`"Infinity"`, see the head of this file) is deleted, as a market's `last` is.
  dropUnless(token, ["price"], isNumberText);
  optionalFields(what, where, token, ["native_volume"], isNumberText, NUMBER);
  optionalFields(what, where, token, ["price_change"], isDecimalText, DECIMAL);
  optionalFields(what, where, token, ["price_time"], isIsoTime, TIME);
  optionalFields(what, where, token, ["trades"], isWhole, WHOLE);
  optionalFields(what, where, token, ["domain"], isText, "text");
  fields(what, where, token, ["listed"], isBoolean, BOOLEAN);
}

/** `GET /v2/tokens`: the tokens of a kind, ranked, with the totals of the kind when it has a generation. */
export function checkTokens(body: unknown, path: string): TokensResponse {
  const what = `data API GET ${path}`;
  const head = answerOf(what, body, false);
  if (head.kind !== "issued") throw malformed(what, 'kind is not "issued"');
  optionalFields(what, "answer", head, ["ledger_index", "total", "total_below"], isWhole, WHOLE);
  optionalFields(what, "answer", head, ["close_time"], isIsoTime, TIME);
  if (head.totals !== undefined) {
    const totals = objectAt(what, "totals", head.totals);
    fields(what, "totals", totals, ["tokens", "tokens_with_10_holders"], isWhole, WHOLE);
    optionalFields(what, "totals", totals, ["holders"], isWhole, WHOLE);
    optionalFields(what, "totals", totals, ["native_volume"], isNumberText, NUMBER);
  }
  for (const [index, row] of listOf(what, body, "tokens").entries()) {
    const where = `tokens[${index}]`;
    fields(what, where, row, ["rank"], isWhole, WHOLE);
    checkTokenFields(what, where, row);
    optionalFields(what, where, row, ["name"], isText, "text");
  }
  return body as TokensResponse;
}

/** The toml's entry of a token: text, and the decimals a whole number from 0 to 30. */
function checkToml(what: string, where: string, value: unknown): void {
  const toml = objectAt(what, where, value);
  optionalFields(what, where, toml, ["name", "desc", "icon", "symbol", "asset_class", "asset_subclass", "attestation"], isText, "text");
  optionalFields(what, where, toml, ["display_decimals"], isDisplayDecimals, "a whole number from 0 to 30");
}

/** The settings of the issuer: the transfer fee in percent, and its five flags. */
function checkIssuerSettings(what: string, where: string, value: unknown): void {
  const settings = objectAt(what, where, value);
  fields(what, where, settings, ["transfer_fee"], isDecimalText, DECIMAL);
  fields(what, where, settings, ["global_freeze", "no_freeze", "allow_trust_line_clawback", "require_auth", "default_ripple"], isBoolean, BOOLEAN);
}

/** A pair of the token's markets, the token being the base. A `last` that is not number text is deleted (see the head of this file). */
function checkMarket(what: string, where: string, market: Row): void {
  fields(what, where, market, ["counter_currency"], isName, "a currency");
  optionalFields(what, where, market, ["counter_issuer"], isAccount, ACCOUNT);
  fields(what, where, market, ["count"], isWhole, WHOLE);
  fields(what, where, market, ["volume", "counter_volume"], isNumberText, NUMBER);
  optionalFields(what, where, market, ["native_volume"], isNumberText, NUMBER);
  dropUnless(market, ["last"], isNumberText);
  optionalFields(what, where, market, ["change"], isDecimalText, DECIMAL);
  fields(what, where, market, ["last_time"], isIsoTime, TIME);
  optionalFields(what, where, market, ["amm_pool"], isBoolean, BOOLEAN);
}

/**
 * `GET /v2/tokens/{token}`: the token, which must be the one `asked` for (the currency as the ledger holds it, and its issuer), with its markets (the ones whose `last` is not number text lose
 * that key).
 */
export function checkToken(body: unknown, path: string, asked: { currency: string; issuer: string }): TokenAnswer {
  const what = `data API GET ${path}`;
  const head = answerOf(what, body, true);
  const token = objectAt(what, "token", head.token);
  checkTokenFields(what, "token", token);
  if (token.currency !== asked.currency) throw malformed(what, "token.currency is not the currency asked for");
  if (token.issuer !== asked.issuer) throw malformed(what, "token.issuer is not the issuer asked for");
  optionalFields(what, "token", token, ["toml_url"], isText, "text");
  if (token.toml !== undefined) checkToml(what, "token.toml", token.toml);
  if (token.issuer_settings !== undefined) checkIssuerSettings(what, "token.issuer_settings", token.issuer_settings);
  for (const [index, market] of rowsOf(what, token, "markets").entries()) checkMarket(what, `token.markets[${index}]`, market);
  fields(what, "token", token, ["last_ledger"], isWhole, WHOLE);
  return body as TokenAnswer;
}

/** `GET /v2/tokens/{token}/holders`: the holders of a token, the largest balance first, each with its share of the supply. */
export function checkTokenHolders(body: unknown, path: string): TokenHoldersResponse {
  const what = `data API GET ${path}`;
  const head = answerOf(what, body, true);
  fields(what, "answer", head, ["supply"], isNumberText, NUMBER);
  for (const [index, row] of listOf(what, body, "holders").entries()) {
    const where = `holders[${index}]`;
    fields(what, where, row, ["rank"], isWhole, WHOLE);
    fields(what, where, row, ["holder"], isAccount, ACCOUNT);
    fields(what, where, row, ["balance", "limit"], isNumberText, NUMBER);
    fields(what, where, row, ["share"], isShare, "a share (decimal text with 6 decimals)");
    fields(what, where, row, ["frozen", "authorized"], isBoolean, BOOLEAN);
  }
  return body as TokenHoldersResponse;
}

/** `GET /v2/tokens/{token}/transfers`: the payments that delivered the token; no ledger of their own, and an empty list is an answer. */
export function checkTokenTransfers(body: unknown, path: string): TokenTransfersResponse {
  const what = `data API GET ${path}`;
  answerOf(what, body, false);
  for (const [index, row] of listOf(what, body, "transfers").entries()) {
    const where = `transfers[${index}]`;
    fields(what, where, row, ["hash"], isHash, "a hash (64 hexadecimal digits)");
    fields(what, where, row, ["ledger_index"], isWhole, WHOLE);
    fields(what, where, row, ["executed_time"], isIsoTime, TIME);
    fields(what, where, row, ["source", "destination"], isAccount, ACCOUNT);
    fields(what, where, row, ["amount"], isNumberText, NUMBER);
    optionalFields(what, where, row, ["source_tag", "destination_tag"], isWhole, WHOLE);
  }
  return body as TokenTransfersResponse;
}
