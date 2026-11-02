// What the answers of D9's MPT routes must look like for the MPT pages (E14) to use them: an issuance, its holders and its transfers, the lookup of several issuances, and the MPT list of
// the token tab (data-api `feat/explorer-data-2` at c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30, the spec's section 7 and `docs/api-reference.md` "MPT"; the types are in api-types.ts, "MPT"). Like
// `token-shape.ts`, the data API client runs the checks inside the load its subrequest cache runs, as `get()`'s `finish`: a 200 that is not what the reference promises is an `UpstreamError`
// of kind `server` (status 200 marks it as an answer of the upstream), is never stored, and the page fails with it. A check takes the whole body (and, as the client calls it, the path that was
// asked for, whose message it names) and returns it, typed, as it is. Worker-only code, no I/O.
//
// What is checked (a key the API leaves out when it has no value is checked when it is there, and `null` is never served; extra keys are not refused, the API may add one):
//   - every answer but the lookup's has a `coverage` that is one (`checkCoverage`); the lookup lists nothing of a history and has none;
//   - an issuance ID is 48 upper-case hex digits, because it goes into a path and a link and the pages compare it as text; an issuer, a holder, a source and a destination are classic addresses
//     with their checksum, because they go into a link (an X-address holds a tag and is not one); a transaction hash is 64 hexadecimal digits; a time is `YYYY-MM-DDTHH:mm:ssZ`;
//   - an amount is the ledger's integer units as text, 1 to 19 digits (a signed 64-bit value): never a decimal, never signed, never an exponent. `asset_scale` is a whole number from 0 to 255
//     (the ledger's own limit: the page shows one above 19 unscaled), `transfer_fee` a whole number from 0 to 50000, a `sequence` 32 bits; counts, ranks and ledgers are whole numbers;
//   - `flags` has the seven flags of D9, each a boolean (a key beside them is kept); `metadata_hex` is hex of whole bytes, `metadata_conforms` a boolean;
//   - the metadata is the issuer's word and is not trusted, but D9 has decoded it leniently (a field of the wrong type is dropped), so its text fields are text when they are there, and a
//     `uris` item has a `uri` that is text. `additional_info` is an object or a string and is not looked into;
//   - a transfer's `kind` is one of the seven D9 knows;
//   - the lookup has one entry for each ID asked, in the order asked, each the ID asked: an issuance (a summary) or, when the index has no state for it, the ID alone;
//   - the list of the token tab is `kind: "mpt"`. Before the first generation exists it has no `totals`, no `total` and no ledger: all of those are optional (D9 answers `count: 0` and no tokens);
//   - an issuance is the one asked for, and its ID is the one its `sequence` and `issuer` make (rippled's `makeMptID`, `mptIdOf`); a summary has no sequence, so its `issuer` is the one its ID holds
//     (`mptIssuerOf`). A data API that answered another issuance would draw the wrong page, and the cache would keep it;
//   - a holders page and a transfers page do not name the issuance they are of: only their URL does, so no check could tell another's from the one asked for.

import { mptIdOf, mptIssuerOf } from "../domain/mpt-id";
import { fields, isAccount, isBoolean, isIsoTime, isName, isText, isWhole, listOf, optionalFields, rowsOf } from "./aggregate-shape";
import type { MptHoldersPage, MptIssuanceAnswer, MptLookup, MptTokensPage, MptTransfersPage } from "./api-types";
import { checkCoverage } from "./coverage";
import { isObject, malformed } from "./tx-shape";

type Row = Record<string, unknown>;

const MPT_ID = "an issuance ID (48 upper-case hexadecimal digits)";
const ACCOUNT = "an account";
const WHOLE = "a whole number";
const TIME = "a time";
const BOOLEAN = "a boolean";
const TEXT = "text";
const AMOUNT = "an amount (1 to 19 digits of the ledger's integer units)";
const SCALE = "a whole number from 0 to 255";
const FEE = "a whole number from 0 to 50000";
const HASH = "a hash (64 hexadecimal digits)";

const ID_PATTERN = /^[0-9A-F]{48}$/;
const AMOUNT_PATTERN = /^\d{1,19}$/;
const HASH_PATTERN = /^[0-9A-Fa-f]{64}$/;
const HEX_BYTES = /^(?:[0-9A-Fa-f]{2})+$/;
const UINT32_MAX = 4_294_967_295;

const isMptId = (value: unknown): value is string => typeof value === "string" && ID_PATTERN.test(value);
const isAmount = (value: unknown): value is string => typeof value === "string" && AMOUNT_PATTERN.test(value);
const isScale = (value: unknown): value is number => isWhole(value) && value <= 255;
const isTransferFee = (value: unknown): value is number => isWhole(value) && value <= 50_000;
const isSequence = (value: unknown): value is number => isWhole(value) && value <= UINT32_MAX;
const isHash = (value: unknown): value is string => typeof value === "string" && HASH_PATTERN.test(value);
const isHexBytes = (value: unknown): value is string => typeof value === "string" && HEX_BYTES.test(value);

const TRANSFER_KINDS: readonly string[] = ["payment", "clawback", "lock", "unlock", "escrow_create", "escrow_finish", "escrow_cancel"];
const isTransferKind = (value: unknown): boolean => typeof value === "string" && TRANSFER_KINDS.includes(value);

const FLAGS = ["locked", "can_lock", "require_auth", "can_escrow", "can_trade", "can_transfer", "can_clawback"] as const;
const METADATA_TEXT = ["ticker", "name", "desc", "icon", "asset_class", "asset_subclass", "issuer_name"] as const;

/** The object under `where`, or a failure. */
function objectAt(what: string, where: string, value: unknown): Row {
  if (!isObject(value)) throw malformed(what, `${where} is not an object`);
  return value;
}

/** What every answer with a coverage starts with: an object with a `coverage`. Returned, so that a check reads its keys from it. */
function answerOf(what: string, body: unknown): Row {
  if (!isObject(body)) throw malformed(what, "the answer is not an object");
  checkCoverage(body, `${what} answered something unexpected`);
  return body;
}

/** The seven flags, each a boolean. */
function checkFlags(what: string, where: string, value: unknown): void {
  fields(what, where, objectAt(what, where, value), FLAGS, isBoolean, BOOLEAN);
}

/** The issuer's metadata as D9 decoded it: text where a field is text, and its `uris` each with a `uri`. */
function checkMetadata(what: string, where: string, value: unknown): void {
  const metadata = objectAt(what, where, value);
  optionalFields(what, where, metadata, METADATA_TEXT, isText, TEXT);
  if (metadata.uris === undefined) return;
  for (const [index, item] of rowsOf(what, metadata, "uris").entries()) {
    const at = `${where}.uris[${index}]`;
    fields(what, at, item, ["uri"], isText, TEXT);
    optionalFields(what, at, item, ["category", "title"], isText, TEXT);
  }
}

/** What the summary of an issuance and the row of the list have in common: the ID and what it is, from `mpt_issuance_id` to `flags` (the rest of each is its own). */
function checkSummaryFields(what: string, where: string, row: Row): void {
  fields(what, where, row, ["mpt_issuance_id"], isMptId, MPT_ID);
  fields(what, where, row, ["issuer"], isAccount, ACCOUNT);
  optionalFields(what, where, row, ["ticker", "name"], isText, TEXT);
  fields(what, where, row, ["asset_scale"], isScale, SCALE);
  optionalFields(what, where, row, ["maximum_amount"], isAmount, AMOUNT);
  fields(what, where, row, ["outstanding_amount"], isAmount, AMOUNT);
  fields(what, where, row, ["holders"], isWhole, WHOLE);
  fields(what, where, row, ["transfer_fee"], isTransferFee, FEE);
  checkFlags(what, `${where}.flags`, row.flags);
}

/** The name of the request in a message: the path the client asked for, else the route. */
const whatOf = (route: string, path: string | undefined): string => (path === undefined ? `data API ${route}` : `data API GET ${path}`);

/**
 * `GET /v2/mpt/{issuanceId}`: one issuance, with its metadata as D9 decoded it. `asked` is the ID the client asked for (upper case, as a page writes it): the answer must be that issuance's. A test of the
 * shape alone leaves it out; the ID is then still the one its `sequence` and `issuer` make.
 */
export function checkMptIssuance(body: unknown, path?: string, asked?: string): MptIssuanceAnswer {
  const what = whatOf("MPT issuance", path);
  const head = answerOf(what, body);
  const issuance = objectAt(what, "issuance", head.issuance);
  fields(what, "issuance", issuance, ["mpt_issuance_id"], isMptId, MPT_ID);
  fields(what, "issuance", issuance, ["issuer"], isAccount, ACCOUNT);
  fields(what, "issuance", issuance, ["sequence"], isSequence, "a whole number up to 4294967295");
  // After the three it is made of are known to be what they should be (`mptIdOf` throws for a sequence or an issuer that is not).
  if (issuance.mpt_issuance_id !== mptIdOf(issuance.sequence as number, issuance.issuer as string)) throw malformed(what, "issuance.mpt_issuance_id is not the ID of its sequence and issuer");
  if (asked !== undefined && issuance.mpt_issuance_id !== asked) throw malformed(what, "issuance.mpt_issuance_id is not the issuance asked for");
  optionalFields(what, "issuance", issuance, ["ticker", "name"], isText, TEXT);
  fields(what, "issuance", issuance, ["asset_scale"], isScale, SCALE);
  optionalFields(what, "issuance", issuance, ["maximum_amount"], isAmount, AMOUNT);
  fields(what, "issuance", issuance, ["outstanding_amount", "escrowed_amount", "locked_amount"], isAmount, AMOUNT);
  fields(what, "issuance", issuance, ["locked_holders", "holders"], isWhole, WHOLE);
  fields(what, "issuance", issuance, ["transfer_fee"], isTransferFee, FEE);
  checkFlags(what, "issuance.flags", issuance.flags);
  if (issuance.metadata !== undefined) checkMetadata(what, "issuance.metadata", issuance.metadata);
  optionalFields(what, "issuance", issuance, ["metadata_hex"], isHexBytes, "hex");
  optionalFields(what, "issuance", issuance, ["metadata_conforms"], isBoolean, BOOLEAN);
  optionalFields(what, "issuance", issuance, ["created_ledger"], isWhole, WHOLE);
  optionalFields(what, "issuance", issuance, ["created_time"], isIsoTime, TIME);
  optionalFields(what, "issuance", issuance, ["created_tx_hash"], isHash, HASH);
  fields(what, "issuance", issuance, ["last_ledger"], isWhole, WHOLE);
  fields(what, "issuance", issuance, ["destroyed"], isBoolean, BOOLEAN);
  return body as MptIssuanceAnswer;
}

/** `GET /v2/mpt/{issuanceId}/holders`: the largest balance first, `amount` and `escrowed_amount` counting together. */
export function checkMptHoldersPage(body: unknown, path?: string): MptHoldersPage {
  const what = whatOf("MPT holders", path);
  answerOf(what, body);
  for (const [index, row] of listOf(what, body, "holders").entries()) {
    const where = `holders[${index}]`;
    fields(what, where, row, ["holder"], isAccount, ACCOUNT);
    fields(what, where, row, ["amount", "escrowed_amount"], isAmount, AMOUNT);
    fields(what, where, row, ["locked", "authorized"], isBoolean, BOOLEAN);
  }
  return body as MptHoldersPage;
}

/** `GET /v2/mpt/{issuanceId}/transfers`: what moved, clawed back, locked or unlocked. A lock of every balance has no destination, and no row needs a source. */
export function checkMptTransfersPage(body: unknown, path?: string): MptTransfersPage {
  const what = whatOf("MPT transfers", path);
  answerOf(what, body);
  for (const [index, row] of listOf(what, body, "transfers").entries()) {
    const where = `transfers[${index}]`;
    fields(what, where, row, ["ledger_index", "tx_index"], isWhole, WHOLE);
    fields(what, where, row, ["tx_hash"], isHash, HASH);
    fields(what, where, row, ["executed_time"], isIsoTime, TIME);
    fields(what, where, row, ["tx_type"], isName, "a transaction type");
    fields(what, where, row, ["kind"], isTransferKind, `one of ${TRANSFER_KINDS.join(", ")}`);
    optionalFields(what, where, row, ["source", "destination"], isAccount, ACCOUNT);
    fields(what, where, row, ["amount"], isAmount, AMOUNT);
    optionalFields(what, where, row, ["fee"], isAmount, AMOUNT);
  }
  return body as MptTransfersPage;
}

/**
 * `GET /v2/mpt?ids=`: `ids` is what was asked for (sorted and without duplicates, as the client sends it), and the answer has one entry for each, in that order, each the ID asked: the
 * summary of an issuance whose state the index knows, or the ID alone. There is no coverage and no paging.
 */
export function checkMptLookup(body: unknown, ids: readonly string[], path?: string): MptLookup {
  const what = whatOf("MPT lookup", path);
  if (!isObject(body)) throw malformed(what, "the answer is not an object");
  if (!isWhole(body.count)) throw malformed(what, "count is not a whole number");
  const entries = rowsOf(what, body, "issuances");
  if (entries.length !== ids.length) throw malformed(what, `${entries.length} issuances where ${ids.length} were asked for`);
  for (const [index, entry] of entries.entries()) {
    const where = `issuances[${index}]`;
    if (entry.mpt_issuance_id !== ids[index]) throw malformed(what, `${where} is not the issuance asked for`);
    // The ID alone is an issuance the index has no state for; anything else is a summary, with all of its keys.
    if (Object.keys(entry).length === 1) continue;
    checkSummaryFields(what, where, entry);
    // A summary has no sequence: the ID, which is the one asked and a well formed one by now, holds the issuer.
    if (entry.issuer !== mptIssuerOf(entry.mpt_issuance_id as string)) throw malformed(what, `${where}.issuer is not the issuer of the issuance asked for`);
    fields(what, where, entry, ["destroyed"], isBoolean, BOOLEAN);
  }
  return body as unknown as MptLookup;
}

/** `GET /v2/tokens?kind=mpt`: the issuances ranked by holders, with the totals of the kind when it has a generation. */
export function checkMptTokens(body: unknown, path?: string): MptTokensPage {
  const what = whatOf("MPT tokens", path);
  const head = answerOf(what, body);
  if (head.kind !== "mpt") throw malformed(what, 'kind is not "mpt"');
  optionalFields(what, "answer", head, ["ledger_index", "total", "total_below"], isWhole, WHOLE);
  optionalFields(what, "answer", head, ["close_time"], isIsoTime, TIME);
  if (head.totals !== undefined) fields(what, "totals", objectAt(what, "totals", head.totals), ["issuances", "holders", "transfers_24h"], isWhole, WHOLE);
  for (const [index, row] of listOf(what, body, "tokens").entries()) {
    const where = `tokens[${index}]`;
    fields(what, where, row, ["rank", "transfers_24h"], isWhole, WHOLE);
    checkSummaryFields(what, where, row);
  }
  return body as MptTokensPage;
}
