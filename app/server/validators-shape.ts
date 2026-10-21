// What the answers of D1's six routes (validators and amendments) must look like for the pages to use them. Like `tx-shape.ts` and `aggregate-shape.ts`, the data
// API client runs the checks inside the load its subrequest cache runs, as `get()`'s `finish`: a 200 that is not what the reference promises is an `UpstreamError`
// of kind `server` (status 200 marks it as an answer of the upstream), is held when the call asks, and is never stored. Each check takes the whole body and the
// path that was asked for (the message names the request), and returns the body, typed, as it is. Worker-only code, no I/O.
//
// A check makes the types of api-types.ts true (data-api-new `feat/explorer-data` at 7d495ab, docs/api-reference.md, "Validators and amendments"): every key they
// do not mark optional is there with the type they give it, and an optional key, when it is there, has it too. Extra keys are not refused (the API may add one).
//   - lists are lists, counts and ledgers are whole numbers (`pct` is a number to two decimals);
//   - times are text in the three forms D1 writes: an instant `YYYY-MM-DDTHH:mm:ss.SSSZ`, a time `YYYY-MM-DDTHH:mm:ssZ`, or a day `YYYY-MM-DD`;
//   - native amounts are plain decimal strings (`"0.00001"`), a `score` is text to four decimals (`"0.9998"`);
//   - keys are base58 node public keys (`isNodePublicKey`); an amendment ID and the hash of an EnableAmendment are 64 hex digits in upper case;
//   - the words a newer D1 may add to (an amendment's status, a domain check's status, the status of a validator's vote, a history event: `OpenWord` in api-types.ts)
//     are any text that is not empty. The pages have a default for a word they do not know ("Unknown", "not verified", an event left out), so a new word is shown
//     as that, never a refused answer. The words the pages build on (a vote, a validation's match, an enabling's source, a publisher's status) keep their sets.

import { AMENDMENT_STATUSES } from "../domain/amendments-params";
import { isNodePublicKey } from "../domain/validator-key";
import type {
  AmendmentDetail,
  AmendmentsList,
  ValidatorDetail,
  ValidatorsList,
  ValidatorsSummary,
  ValidatorValidationsPage,
} from "./api-types";
import { isMarker } from "./marker";
import { isObject, malformed } from "./tx-shape";

type Row = Record<string, unknown>;

const WHOLE_UNITS = /^\d+(\.\d+)?$/;
const SCORE = /^\d\.\d{4}$/;
/** An amendment's ID, and the hash of an EnableAmendment: 64 hex digits in upper case. */
const HASH = /^[0-9A-F]{64}$/;
/** The hash of a validated ledger. D1 compares these without regard to case (it takes them as the collector stored them), so either is taken. */
const LEDGER_HASH = /^[0-9A-Fa-f]{64}$/;
const SERVER_VERSION = /^\d+$/;
/** The three forms of time D1 writes (its "Formats"): an instant of receipt with milliseconds, a ledger's close time, or a day. */
const TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A name that is there: a domain, a version, a description. */
const isName = (value: unknown): value is string => typeof value === "string" && value !== "";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
/** A count or an index: a whole number, not negative. */
const isWhole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isTime = (value: unknown): value is string => typeof value === "string" && TIME.test(value) && !Number.isNaN(Date.parse(value));
const isDay = (value: unknown): value is string => typeof value === "string" && DAY.test(value) && !Number.isNaN(Date.parse(value));
const isFee = (value: unknown): value is string => typeof value === "string" && WHOLE_UNITS.test(value);
const isScore = (value: unknown): value is string => typeof value === "string" && SCORE.test(value);
const isKey = (value: unknown): value is string => typeof value === "string" && isNodePublicKey(value);
/** The signing key of a validation: D1 reads it from the collector's `ephemeral_public_key`, a column that can be empty. */
const isKeyOrEmpty = (value: unknown): value is string => value === "" || isKey(value);
const isHash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
const isLedgerHash = (value: unknown): value is string => typeof value === "string" && LEDGER_HASH.test(value);
/** A word out of a fixed set. */
const oneOf =
  (...words: readonly string[]) =>
  (value: unknown): boolean =>
    typeof value === "string" && words.includes(value);

/** Where in the answer something is: `where` is the object it is in (empty for the answer itself), `name` the key. */
const at = (where: string, name: string): string => (where === "" ? name : `${where}.${name}`);

/** What one answer is checked against: the request it was for (named in the message), and the failures it can throw. */
class Shape {
  private readonly what: string;

  constructor(path: string) {
    this.what = `data API GET ${path}`;
  }

  /** An object at `where`, or a failure. */
  object(where: string, value: unknown): Row {
    if (!isObject(value)) throw malformed(this.what, `${where} is not an object`);
    return value;
  }

  /** A list of objects at `where` (`key` of `row`), or a failure. */
  rows(where: string, row: Row, key: string): Row[] {
    const list = row[key];
    if (!Array.isArray(list)) throw malformed(this.what, `${at(where, key)} is not a list`);
    for (const [index, each] of (list as unknown[]).entries()) {
      if (!isObject(each)) throw malformed(this.what, `${at(where, key)}[${index}] is not an object`);
    }
    return list as Row[];
  }

  /** Throws unless each of `names` is a key of `row` that satisfies `is`; `kind` says what it should have been. */
  fields(where: string, row: Row, names: readonly string[], is: (value: unknown) => boolean, kind: string): void {
    for (const name of names) {
      if (!is(row[name])) throw malformed(this.what, `${at(where, name)} is not ${kind}`);
    }
  }

  /** Throws unless each of `names` that `row` has (a key the API leaves out when it has no value) satisfies `is`. */
  optional(where: string, row: Row, names: readonly string[], is: (value: unknown) => boolean, kind: string): void {
    for (const name of names) {
      if (row[name] !== undefined && !is(row[name])) throw malformed(this.what, `${at(where, name)} is not ${kind}`);
    }
  }

  /** The list at `key` of `row`, each of whose members satisfies `is`. */
  listOf(where: string, row: Row, key: string, is: (value: unknown) => boolean, kind: string): void {
    const list = row[key];
    if (!Array.isArray(list)) throw malformed(this.what, `${at(where, key)} is not a list`);
    for (const [index, each] of (list as unknown[]).entries()) {
      if (!is(each)) throw malformed(this.what, `${at(where, key)}[${index}] is not ${kind}`);
    }
  }

  /** The answer itself: an object that says `result: "success"`. */
  answer(body: unknown): Row {
    const head = this.object("answer", body);
    if (head.result !== "success") throw malformed(this.what, "result is not success");
    return head;
  }

  // ---- the parts the routes share -------------------------------------------------------------------------------------------------------------------

  /** A window of agreement, or a day of it. */
  agreement(where: string, value: unknown): void {
    const window = this.object(where, value);
    this.fields(where, window, ["missed", "total", "partial"], isWhole, "a whole number");
    this.fields(where, window, ["incomplete"], isBoolean, "a boolean");
    this.optional(where, window, ["score"], isScore, "text of four decimals");
  }

  /** `next_flag_ledger`, the summary's and the envelope's. */
  nextFlagLedger(where: string, value: unknown): void {
    const flag = this.object(where, value);
    this.fields(where, flag, ["ledger_index", "voting_ledger"], isWhole, "a whole number");
    this.optional(where, flag, ["expected"], isTime, "a time");
  }

  /** The three fees of the summary or of a fee vote. */
  fees(where: string, fees: Row): void {
    this.fields(where, fees, ["base_fee", "reserve_base", "reserve_inc"], isFee, "a decimal");
  }

  /** The `rules`, `round` and `next_flag_ledger` that both amendment routes start with, and their `ledger_index` (G3). */
  envelope(head: Row): void {
    this.optional("", head, ["ledger_index"], isWhole, "a whole number");
    const rules = this.object("rules", head.rules);
    this.fields("rules", rules, ["threshold_percent", "majority_hold_seconds", "flag_interval"], isWhole, "a whole number");
    if (head.round !== undefined) {
      const round = this.object("round", head.round);
      this.fields("round", round, ["ledger_index", "unl_size", "trusted", "threshold", "needed", "observed"], isWhole, "a whole number");
      this.fields("round", round, ["date"], isTime, "a time");
    }
    if (head.next_flag_ledger !== undefined) this.nextFlagLedger("next_flag_ledger", head.next_flag_ledger);
  }

  /** An amendment as the list has it; `where` says which, and `row` is the object (the list's member, or the whole answer of one amendment). */
  amendment(where: string, row: Row): void {
    this.fields(where, row, ["id"], isHash, "64 hex digits in upper case");
    this.fields(where, row, ["status"], isName, "text");
    this.optional(where, row, ["name", "introduced", "xls", "xls_url", "description"], isName, "text");
    this.optional(where, row, ["retired"], (value) => value === true, "true");
    this.optional(where, row, ["node_supported"], isBoolean, "a boolean");
    if (row.votes !== undefined) {
      const votes = this.object(`${where}.votes`, row.votes);
      this.fields(`${where}.votes`, votes, ["ledger_index", "yes", "trusted", "needed"], isWhole, "a whole number");
      this.fields(`${where}.votes`, votes, ["pct"], isNumber, "a number");
    }
    if (row.majority !== undefined) {
      const majority = this.object(`${where}.majority`, row.majority);
      this.fields(`${where}.majority`, majority, ["since", "expected_activation"], isTime, "a time");
      this.optional(`${where}.majority`, majority, ["ledger_index"], isWhole, "a whole number");
      this.optional(`${where}.majority`, majority, ["tx_hash"], isHash, "64 hex digits in upper case");
    }
    if (row.enabled !== undefined) {
      const enabled = this.object(`${where}.enabled`, row.enabled);
      this.fields(`${where}.enabled`, enabled, ["source"], oneOf("ledger", "metadata"), "ledger or metadata");
      this.optional(`${where}.enabled`, enabled, ["ledger_index"], isWhole, "a whole number");
      this.optional(`${where}.enabled`, enabled, ["date"], isTime, "a time");
      this.optional(`${where}.enabled`, enabled, ["tx_hash"], isHash, "64 hex digits in upper case");
    }
  }

  /** A validator of the list, or the validator answer (which has `amendment_votes` always, with the votes). */
  validator(where: string, row: Row, detail: boolean): void {
    this.fields(where, row, ["validation_public_key"], isKey, "a node public key");
    this.optional(where, row, ["signing_key"], isKey, "a node public key");
    this.optional(where, row, ["domain", "version"], isName, "text");
    this.optional(where, row, ["current_index", "version_build"], isWhole, "a whole number");
    this.optional(where, row, ["partial", "version_latest"], isBoolean, "a boolean");
    this.optional(where, row, ["server_version"], (value) => typeof value === "string" && SERVER_VERSION.test(value), "decimal text");
    this.optional(where, row, ["first_seen", "last_seen"], isTime, "a time");
    this.fields(where, row, ["unl", "negative_unl"], isBoolean, "a boolean");
    for (const window of ["agreement_1h", "agreement_24h", "agreement_30d"]) this.agreement(`${where}.${window}`, row[window]);
    this.listOf(where, row, "unl_lists", isName, "text");

    if (row.domain_verification !== undefined) {
      const verification = this.object(`${where}.domain_verification`, row.domain_verification);
      const here = `${where}.domain_verification`;
      this.fields(here, verification, ["status"], isName, "text");
      this.fields(here, verification, ["toml_url"], isName, "text");
      this.optional(here, verification, ["reason"], isName, "text");
      this.optional(here, verification, ["status_code"], isWhole, "a whole number");
      this.optional(here, verification, ["checked", "verified"], isTime, "a time");
      if (verification.accounts !== undefined) this.listOf(here, verification, "accounts", isName, "text");
    }
    if (row.fee_vote !== undefined) {
      const vote = this.object(`${where}.fee_vote`, row.fee_vote);
      this.fields(`${where}.fee_vote`, vote, ["ledger_index"], isWhole, "a whole number");
      this.fees(`${where}.fee_vote`, vote);
    }

    if (detail || row.amendment_votes !== undefined) this.amendmentVotes(`${where}.amendment_votes`, this.object(`${where}.amendment_votes`, row.amendment_votes), detail);
  }

  /**
   * `amendment_votes` of a row: the ledger of the record (absent from the validator answer of a validator with no record) and the amendments it votes yes for;
   * the validator answer adds a vote on every amendment still being decided.
   */
  amendmentVotes(here: string, votes: Row, detail: boolean): void {
    if (detail) this.optional(here, votes, ["ledger_index"], isWhole, "a whole number");
    else this.fields(here, votes, ["ledger_index"], isWhole, "a whole number");
    for (const [index, yes] of this.rows(here, votes, "yes").entries()) {
      this.fields(`${here}.yes[${index}]`, yes, ["id"], isHash, "64 hex digits in upper case");
      this.optional(`${here}.yes[${index}]`, yes, ["name"], isName, "text");
    }
    if (!detail) return;
    for (const [index, vote] of this.rows(here, votes, "votes").entries()) {
      const where = `${here}.votes[${index}]`;
      this.fields(where, vote, ["id"], isHash, "64 hex digits in upper case");
      this.optional(where, vote, ["name"], isName, "text");
      this.fields(where, vote, ["status"], isName, "text");
      this.fields(where, vote, ["vote"], oneOf("yes", "no", "none"), "yes, no or none");
    }
  }

  /** How a validator votes on an amendment (a member of `unl_votes` or `other_votes`). */
  vote(where: string, row: Row): void {
    this.fields(where, row, ["validation_public_key"], isKey, "a node public key");
    this.fields(where, row, ["vote"], oneOf("yes", "no", "none"), "yes, no or none");
    this.optional(where, row, ["domain", "version"], isName, "text");
    this.optional(where, row, ["version_supports"], isBoolean, "a boolean");
    this.optional(where, row, ["last_seen"], isTime, "a time");
  }

  /** The `marker` of a list, when it has one: a token the explorer may send back. */
  marker(head: Row): void {
    if (head.marker !== undefined && !isMarker(head.marker)) throw malformed(this.what, "marker is not a marker");
  }
}

/** `GET /v2/network/validators/summary` (`ValidatorsSummary`). */
export function checkValidatorsSummary(body: unknown, path: string): ValidatorsSummary {
  const s = new Shape(path);
  const head = s.answer(body);
  s.optional("", head, ["ledger_index", "votes_through_ledger"], isWhole, "a whole number");
  s.optional("", head, ["close_time", "agreement_through"], isTime, "a time");
  s.optional("", head, ["latest_version"], isName, "text");
  s.fields("", head, ["updated"], isTime, "a time");

  const validators = s.object("validators", head.validators);
  s.fields("validators", validators, ["seen_24h", "unl_seen_24h", "others_seen_24h", "all"], isWhole, "a whole number");

  const unl = s.object("unl", head.unl);
  s.fields("unl", unl, ["trusted"], isWhole, "a whole number");
  s.optional("unl", unl, ["threshold"], isWhole, "a whole number");
  for (const [index, publisher] of s.rows("unl", unl, "publishers").entries()) {
    const where = `unl.publishers[${index}]`;
    s.fields(where, publisher, ["id", "url", "public_key"], isName, "text");
    s.fields(where, publisher, ["status"], oneOf("ok", "expired", "unavailable"), "ok, expired or unavailable");
    s.optional(where, publisher, ["sequence", "version", "validators", "seen_24h"], isWhole, "a whole number");
    s.optional(where, publisher, ["expiration", "fetched", "last_error_at"], isTime, "a time");
    s.optional(where, publisher, ["last_error"], isName, "text");
  }

  const quorum = s.object("quorum", head.quorum);
  s.fields("quorum", quorum, ["value", "unl_size", "negative_unl"], isWhole, "a whole number");
  s.optional("quorum", quorum, ["node"], isWhole, "a whole number");

  for (const [index, member] of s.rows("", head, "negative_unl").entries()) {
    s.fields(`negative_unl[${index}]`, member, ["validation_public_key"], isKey, "a node public key");
    s.fields(`negative_unl[${index}]`, member, ["first_ledger"], isWhole, "a whole number");
  }
  if (head.negative_unl_pending !== undefined) {
    s.optional("negative_unl_pending", s.object("negative_unl_pending", head.negative_unl_pending), ["to_disable", "to_reenable"], isKey, "a node public key");
  }
  if (head.fees !== undefined) s.fees("fees", s.object("fees", head.fees));
  if (head.next_flag_ledger !== undefined) s.nextFlagLedger("next_flag_ledger", head.next_flag_ledger);

  for (const [index, version] of s.rows("", head, "versions").entries()) {
    s.fields(`versions[${index}]`, version, ["version"], isName, "text");
    s.fields(`versions[${index}]`, version, ["unl", "all"], isWhole, "a whole number");
  }
  s.fields("versions_unknown", s.object("versions_unknown", head.versions_unknown), ["unl", "all"], isWhole, "a whole number");
  return body as ValidatorsSummary;
}

/** `GET /v2/network/validators`: a page of rows, each in the shape of `ValidatorRow`. */
export function checkValidatorsList(body: unknown, path: string): ValidatorsList {
  const s = new Shape(path);
  const head = s.answer(body);
  s.fields("", head, ["count"], isWhole, "a whole number");
  s.marker(head);
  for (const [index, row] of s.rows("", head, "validators").entries()) s.validator(`validators[${index}]`, row, false);
  return body as ValidatorsList;
}

/** `GET /v2/network/validators/{key}`: the row of the list, its vote on every amendment being decided, its manifest and its 30 days of agreement. */
export function checkValidatorDetail(body: unknown, path: string): ValidatorDetail {
  const s = new Shape(path);
  const head = s.answer(body);
  s.validator("answer", head, true);
  if (head.manifest !== undefined) {
    const manifest = s.object("manifest", head.manifest);
    s.fields("manifest", manifest, ["sequence", "signing_keys_seen"], isWhole, "a whole number");
    s.optional("manifest", manifest, ["signing_key"], isKey, "a node public key");
    s.optional("manifest", manifest, ["domain"], isName, "text");
  }
  for (const [index, day] of s.rows("", head, "daily_agreement").entries()) {
    s.fields(`daily_agreement[${index}]`, day, ["date"], isDay, "a day");
    s.agreement(`daily_agreement[${index}]`, day);
  }
  return body as ValidatorDetail;
}

/** `GET /v2/network/validators/{key}/validations`: a page of a validator's validations. */
export function checkValidatorValidations(body: unknown, path: string): ValidatorValidationsPage {
  const s = new Shape(path);
  const head = s.answer(body);
  s.fields("", head, ["validation_public_key"], isKey, "a node public key");
  s.fields("", head, ["count"], isWhole, "a whole number");
  s.marker(head);
  for (const [index, row] of s.rows("", head, "validations").entries()) {
    const where = `validations[${index}]`;
    s.fields(where, row, ["ledger_index", "count"], isWhole, "a whole number");
    s.fields(where, row, ["ledger_hash"], isLedgerHash, "64 hex digits");
    s.optional(where, row, ["validated_hash"], isLedgerHash, "64 hex digits");
    s.fields(where, row, ["validated"], oneOf("matches", "different", "unknown"), "matches, different or unknown");
    s.fields(where, row, ["full"], isBoolean, "a boolean");
    s.fields(where, row, ["signing_key"], isKeyOrEmpty, "a node public key");
    s.fields(where, row, ["signing_time", "first_datetime", "last_datetime"], isTime, "a time");
  }
  return body as ValidatorValidationsPage;
}

/** `GET /v2/network/amendments`: the envelope, the count of each status and the amendments. */
export function checkAmendments(body: unknown, path: string): AmendmentsList {
  const s = new Shape(path);
  const head = s.answer(body);
  s.envelope(head);
  s.fields("counts", s.object("counts", head.counts), AMENDMENT_STATUSES, isWhole, "a whole number");
  s.fields("", head, ["count"], isWhole, "a whole number");
  for (const [index, row] of s.rows("", head, "amendments").entries()) s.amendment(`amendments[${index}]`, row);
  return body as AmendmentsList;
}

/** `GET /v2/network/amendments/{name}`: the envelope, the amendment as the list has it, how the validators vote on it, its rounds and its history. */
export function checkAmendmentDetail(body: unknown, path: string): AmendmentDetail {
  const s = new Shape(path);
  const head = s.answer(body);
  s.envelope(head);
  s.amendment("answer", head);
  for (const key of ["unl_votes", "other_votes"]) {
    for (const [index, vote] of s.rows("", head, key).entries()) s.vote(`${key}[${index}]`, vote);
  }
  for (const [index, round] of s.rows("", head, "rounds").entries()) {
    const where = `rounds[${index}]`;
    s.fields(where, round, ["ledger_index", "flag_ledger", "yes", "trusted", "threshold"], isWhole, "a whole number");
    s.fields(where, round, ["date"], isTime, "a time");
    s.fields(where, round, ["passes"], isBoolean, "a boolean");
  }
  for (const [index, event] of s.rows("", head, "history").entries()) {
    const where = `history[${index}]`;
    s.fields(where, event, ["event"], isName, "text");
    s.fields(where, event, ["ledger_index"], isWhole, "a whole number");
    s.fields(where, event, ["date"], isTime, "a time");
    s.fields(where, event, ["tx_hash"], isHash, "64 hex digits in upper case");
  }
  return body as AmendmentDetail;
}
