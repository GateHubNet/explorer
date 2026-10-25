import { describe, expect, it } from "vitest";

import {
  amendmentDetailSample,
  amendmentsSample,
  SAMPLE_KEYS,
  summarySample,
  validationsSample,
  validatorDetailSample,
  validatorRowSample,
} from "../../test/support/d1-samples";
import { UpstreamError } from "./upstream";
import {
  checkAmendmentDetail,
  checkAmendments,
  checkValidatorDetail,
  checkValidatorsList,
  checkValidatorsSummary,
  checkValidatorValidations,
} from "./validators-shape";

// The samples are small answers in the shapes of data-api-new/docs/api-reference.md ("Validators and amendments", at feat/explorer-data 7d495ab). A defect
// is one change to a sample.

/** A body to be broken in some way: a test reaches into it as it likes. */
type Body = any;
type Defect = [what: string, change: (body: Body) => void];
type Check = (body: unknown, path: string) => unknown;

const clone = <T>(value: T): T => structuredClone(value);

/** A list answer around rows, as the list route writes it. */
const listOf = (...validators: unknown[]) => ({ result: "success", count: validators.length, validators });

const ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

/** The check refuses `body` as an `UpstreamError` of kind `server` that marks an answer of the upstream (status 200), and its message names the request. */
function refuses(check: Check, body: unknown): void {
  let error: unknown;
  try {
    check(body, "/x");
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UpstreamError);
  expect((error as UpstreamError).kind).toBe("server");
  expect((error as UpstreamError).status).toBe(200);
  expect((error as UpstreamError).message).toContain("data API GET /x answered something unexpected");
}

/** The sample is taken and returned as it is, and every change in `defects` makes it a refused answer. */
function pins(check: Check, sample: () => unknown, defects: Defect[]): void {
  it("takes the sample, and returns it as it is", () => {
    const good = sample();
    expect(check(good, "/x")).toBe(good);
  });
  it.each(defects)("refuses %s", (_what, defect) => {
    const body = clone(sample());
    defect(body);
    refuses(check, body);
  });
}

describe("every check", () => {
  it.each([
    ["validators summary", checkValidatorsSummary, summarySample()],
    ["validators list", checkValidatorsList, listOf(validatorRowSample(), validatorRowSample({ validation_public_key: SAMPLE_KEYS[1] }))],
    ["validator", checkValidatorDetail, validatorDetailSample()],
    ["validator validations page", checkValidatorValidations, validationsSample()],
    ["amendments list", checkAmendments, amendmentsSample()],
    ["amendment", checkAmendmentDetail, amendmentDetailSample()],
  ])("accepts a well-formed %s and returns it", (_what, check, body) => {
    expect(check(body, "/x")).toBe(body);
  });

  it.each([
    ["validators summary", checkValidatorsSummary],
    ["validators list", checkValidatorsList],
    ["validator", checkValidatorDetail],
    ["validator validations page", checkValidatorValidations],
    ["amendments list", checkAmendments],
    ["amendment", checkAmendmentDetail],
  ])("refuses a %s that is not an object", (_what, check) => {
    for (const body of [null, [], "success", 7, undefined]) refuses(check, body);
  });

  it("refuses an answer that is not a success", () => {
    refuses(checkValidatorsSummary, { ...summarySample(), result: "error" });
    refuses(checkAmendments, { ...amendmentsSample(), result: "error" });
  });
});

describe("the message of a refusal", () => {
  const messageOf = (check: Check, body: unknown): string => {
    try {
      check(body, "/v2/network/validators/summary");
    } catch (error) {
      return (error as UpstreamError).message;
    }
    return "";
  };

  it("names the request and says which key of the answer is wrong, and what it should have been", () => {
    const summary = clone(summarySample()) as Body;
    summary.unl.publishers[0].status = "stale";
    expect(messageOf(checkValidatorsSummary, summary)).toBe(
      "data API GET /v2/network/validators/summary answered something unexpected: unl.publishers[0].status is not ok, expired or unavailable",
    );

    const list = clone(listOf(validatorRowSample())) as Body;
    list.validators[0].agreement_24h.score = 0.9998;
    expect(messageOf(checkValidatorsList, list)).toBe(
      "data API GET /v2/network/validators/summary answered something unexpected: validators[0].agreement_24h.score is not text of four decimals",
    );
  });

  it("does not repeat what the API sent", () => {
    const list = clone(listOf(validatorRowSample())) as Body;
    list.validators[0].domain = { secret: "<script>alert(1)</script>" };
    expect(messageOf(checkValidatorsList, list)).not.toContain("script");
  });
});

describe("checkValidatorsSummary", () => {
  pins(checkValidatorsSummary, summarySample, [
    ["a result that is not success", (b) => (b.result = "error")],
    ["a ledger_index that is text", (b) => (b.ledger_index = "107748183")],
    ["a close_time that is a number", (b) => (b.close_time = 1792256472)],
    ["no validators", (b) => delete b.validators],
    ["a validators count that is text", (b) => (b.validators.seen_24h = "54")],
    ["a negative count", (b) => (b.validators.all = -1)],
    ["a count that is not whole", (b) => (b.validators.unl_seen_24h = 34.5)],
    ["no unl", (b) => delete b.unl],
    ["publishers that is not a list", (b) => (b.unl.publishers = {})],
    ["a publisher that is not an object", (b) => (b.unl.publishers[0] = "vl.ripple.com")],
    ["a publisher without an id", (b) => delete b.unl.publishers[0].id],
    ["a publisher with a status of its own", (b) => (b.unl.publishers[0].status = "stale")],
    ["a publisher expiration that is a number", (b) => (b.unl.publishers[1].expiration = 1807000000)],
    ["a publisher seen_24h that is text", (b) => (b.unl.publishers[1].seen_24h = "34")],
    ["a publisher last_error_at that is not a time", (b) => (b.unl.publishers[0].last_error_at = "yesterday")],
    ["a threshold that is text", (b) => (b.unl.threshold = "1")],
    ["a quorum without its value", (b) => delete b.quorum.value],
    ["a quorum node that is text", (b) => (b.quorum.node = "28")],
    ["a negative UNL that is not a list", (b) => (b.negative_unl = {})],
    ["a negative UNL key that is an address", (b) => (b.negative_unl[0].validation_public_key = ADDRESS)],
    ["a negative UNL first_ledger that is text", (b) => (b.negative_unl[0].first_ledger = "107747000")],
    ["a pending key that is not a key", (b) => (b.negative_unl_pending.to_reenable = "nH-not-a-key")],
    ["a fee that is a number", (b) => (b.fees.base_fee = 0.00001)],
    ["a fee that is not a plain decimal", (b) => (b.fees.reserve_inc = "1e-5")],
    ["a negative fee", (b) => (b.fees.reserve_base = "-1")],
    ["fees without reserve_inc", (b) => delete b.fees.reserve_inc],
    ["a flag ledger without its voting ledger", (b) => delete b.next_flag_ledger.voting_ledger],
    ["a flag ledger expected that is a number", (b) => (b.next_flag_ledger.expected = 1792256472)],
    ["a latest_version that is a number", (b) => (b.latest_version = 3.4)],
    ["versions that is not a list", (b) => (b.versions = {})],
    ["a version count that is text", (b) => (b.versions[0].unl = "30")],
    ["a version that is empty", (b) => (b.versions[0].version = "")],
    ["no versions_unknown", (b) => delete b.versions_unknown],
    ["a versions_unknown count that is text", (b) => (b.versions_unknown.all = "2")],
    ["an agreement_through that is a number", (b) => (b.agreement_through = 1792256472)],
    ["a votes_through_ledger that is text", (b) => (b.votes_through_ledger = "107748095")],
    ["no updated", (b) => delete b.updated],
  ]);

  it("takes what a database that has no ledger yet leaves out", () => {
    const empty = {
      result: "success",
      validators: { seen_24h: 0, unl_seen_24h: 0, others_seen_24h: 0, all: 0 },
      unl: { trusted: 0, publishers: [] },
      quorum: { value: 0, unl_size: 0, negative_unl: 0 },
      negative_unl: [],
      versions: [],
      versions_unknown: { unl: 0, all: 0 },
      updated: "2026-10-19T15:54:20.222Z",
    };
    expect(checkValidatorsSummary(empty, "/x")).toBe(empty);
  });

  it("takes a publisher that has no list yet", () => {
    const body = summarySample();
    body.unl.publishers = [{ id: "vl.example", url: "https://vl.example", public_key: "ED" + "AB".repeat(32), status: "unavailable" }];
    expect(checkValidatorsSummary(body, "/x")).toBe(body);
  });

  // D-env serves Xahau Testnet's fixed list as the publisher `local`: no site, no key, and no expiration (a fixed list never expires).
  it("accepts the fixed list local, with an empty url and public_key and no expiration", () => {
    const body = summarySample();
    body.unl.publishers = [{ id: "local", url: "", public_key: "", status: "ok", sequence: 1, version: 1, fetched: "2026-10-19T15:51:26.114Z", validators: 4, seen_24h: 4 }];
    expect(checkValidatorsSummary(body, "/x")).toBe(body);
  });

  it("still refuses a publisher whose url is not text", () => {
    const body = clone(summarySample()) as Body;
    body.unl.publishers[0] = { id: "local", url: 5, public_key: "", status: "ok" };
    refuses(checkValidatorsSummary, body);
    expect(() => checkValidatorsSummary(body, "/x")).toThrow("unl.publishers[0].url is not text");
  });

  it("still refuses a publisher whose public_key is not text, or is missing, and one with an empty id", () => {
    for (const change of [
      (b: Body) => (b.unl.publishers[0].public_key = 5),
      (b: Body) => delete b.unl.publishers[0].public_key,
      (b: Body) => delete b.unl.publishers[0].url,
      (b: Body) => (b.unl.publishers[0].id = ""),
    ]) {
      const body = clone(summarySample()) as Body;
      change(body);
      refuses(checkValidatorsSummary, body);
    }
  });
});

describe("checkValidatorsList", () => {
  const sample = () => listOf(validatorRowSample(), validatorRowSample({ validation_public_key: SAMPLE_KEYS[1], domain: "shoreline.example" }));

  pins(checkValidatorsList, sample, [
    ["a result that is not success", (b) => (b.result = "error")],
    ["a count that is text", (b) => (b.count = "2")],
    ["a marker that is not a marker", (b) => (b.marker = "not a marker!")],
    ["validators that is missing", (b) => delete b.validators],
    ["validators that is not a list", (b) => (b.validators = {})],
    ["a row that is not an object", (b) => (b.validators[1] = "row")],
    ["a master key that is a signing key of nothing (a wrong checksum)", (b) => (b.validators[0].validation_public_key = b.validators[0].validation_public_key.slice(0, -1) + "x")],
    ["a master key that is empty", (b) => (b.validators[0].validation_public_key = "")],
    ["a master key that is an address", (b) => (b.validators[0].validation_public_key = ADDRESS)],
    ["a signing key that is an address", (b) => (b.validators[0].signing_key = ADDRESS)],
    ["a domain that is a number", (b) => (b.validators[0].domain = 7)],
    ["a current_index that is text", (b) => (b.validators[0].current_index = "107748183")],
    ["an agreement window that is missing", (b) => delete b.validators[0].agreement_30d],
    ["an agreement window that is not an object", (b) => (b.validators[0].agreement_1h = "0.9989")],
    ["a score that is a number", (b) => (b.validators[0].agreement_24h.score = 0.9998)],
    ["a score with three decimals", (b) => (b.validators[0].agreement_24h.score = "0.999")],
    ["a score of 1 without its decimals", (b) => (b.validators[0].agreement_24h.score = "1")],
    ["a score of 100 %", (b) => (b.validators[0].agreement_24h.score = "99.99")],
    ["missed that is text", (b) => (b.validators[0].agreement_1h.missed = "1")],
    ["total that is negative", (b) => (b.validators[0].agreement_1h.total = -900)],
    ["incomplete that is text", (b) => (b.validators[0].agreement_30d.incomplete = "true")],
    ["a partial window count that is a boolean", (b) => (b.validators[0].agreement_30d.partial = true)],
    ["a row partial that is a count", (b) => (b.validators[0].partial = 1)],
    ["unl that is text", (b) => (b.validators[0].unl = "true")],
    ["no unl", (b) => delete b.validators[0].unl],
    ["unl_lists that is not a list", (b) => (b.validators[0].unl_lists = "vl.ripple.com")],
    ["a list id that is a number", (b) => (b.validators[0].unl_lists = [1])],
    ["negative_unl that is text", (b) => (b.validators[0].negative_unl = "false")],
    ["a version that is a number", (b) => (b.validators[0].version = 3.4)],
    ["a version_build that is text", (b) => (b.validators[0].version_build = "7")],
    ["a version_latest that is text", (b) => (b.validators[0].version_latest = "true")],
    ["a server_version that is a number", (b) => (b.validators[0].server_version = 1745992596280311808)],
    ["a server_version that is not decimal text", (b) => (b.validators[0].server_version = "3.4.1")],
    ["a fee vote that is a number", (b) => (b.validators[0].fee_vote.reserve_base = 1)],
    ["a fee vote that is not a plain decimal", (b) => (b.validators[0].fee_vote.base_fee = "1e-5")],
    ["a fee vote without its ledger", (b) => delete b.validators[0].fee_vote.ledger_index],
    ["amendment votes without their ledger", (b) => delete b.validators[0].amendment_votes.ledger_index],
    ["amendment votes whose yes is not a list", (b) => (b.validators[0].amendment_votes.yes = {})],
    ["a yes entry whose id is not 64 hex", (b) => (b.validators[0].amendment_votes.yes[0].id = "98433DD0")],
    ["a yes entry whose id is in lower case", (b) => (b.validators[0].amendment_votes.yes[0].id = b.validators[0].amendment_votes.yes[0].id.toLowerCase())],
    ["a yes entry whose name is a number", (b) => (b.validators[0].amendment_votes.yes[1].name = 7)],
    ["a first_seen that is a number", (b) => (b.validators[0].first_seen = 1784661953)],
    ["a last_seen that is not a time", (b) => (b.validators[0].last_seen = "yesterday")],
    ["a domain verification status that is empty", (b) => (b.validators[0].domain_verification.status = "")],
    ["a domain verification status that is a number", (b) => (b.validators[0].domain_verification.status = 1)],
    ["a domain verification without its status", (b) => delete b.validators[0].domain_verification.status],
    ["a domain verification without its toml_url", (b) => delete b.validators[0].domain_verification.toml_url],
    ["a domain verification checked that is a number", (b) => (b.validators[0].domain_verification.checked = 1)],
    ["a domain verification accounts that is text", (b) => (b.validators[0].domain_verification.accounts = ADDRESS)],
    ["a domain verification account that is a number", (b) => (b.validators[0].domain_verification.accounts = [7])],
    ["a domain verification status_code that is text", (b) => (b.validators[1].domain_verification.status_code = "404")],
  ]);

  it("takes a member of the UNL that was never seen, with only what its lists and its manifest give", () => {
    const never = {
      validation_public_key: SAMPLE_KEYS[6],
      agreement_1h: { missed: 0, total: 0, incomplete: false, partial: 0 },
      agreement_24h: { missed: 0, total: 0, incomplete: false, partial: 0 },
      unl: true,
      agreement_30d: { missed: 0, total: 0, incomplete: true, partial: 0 },
      unl_lists: ["unl.xrplf.org", "vl.ripple.com"],
      negative_unl: false,
    };
    const body = { result: "success", count: 1, validators: [never] };
    expect(checkValidatorsList(body, "/x")).toBe(body);
  });

  it("takes a marker, an empty page, and a validator whose domain was never checked", () => {
    const pending = validatorRowSample({ domain_verification: { status: "pending", toml_url: "https://pending.example/.well-known/xrp-ledger.toml" } });
    const body = { result: "success", count: 1, marker: "WzAsInNob3JlbGluZS5leGFtcGxlIiwibkhV", validators: [pending] };
    expect(checkValidatorsList(body, "/x")).toBe(body);
    const none = { result: "success", count: 0, validators: [] };
    expect(checkValidatorsList(none, "/x")).toBe(none);
  });

  it("takes a domain check's status a newer D1 sends: a word the pages read as not verified, not a refusal", () => {
    const body = listOf(validatorRowSample({ domain_verification: { status: "revoked", toml_url: "https://northpeak.example/.well-known/xrp-ledger.toml" } }));
    expect(checkValidatorsList(body, "/x")).toBe(body);
  });
});

describe("checkValidatorDetail", () => {
  pins(checkValidatorDetail, validatorDetailSample, [
    ["a result that is not success", (b) => (b.result = "error")],
    ["no result", (b) => delete b.result],
    ["a master key that is an address", (b) => (b.validation_public_key = ADDRESS)],
    ["an agreement window with a score that is a number", (b) => (b.agreement_1h.score = 0.9989)],
    ["no amendment_votes", (b) => delete b.amendment_votes],
    ["amendment votes without votes", (b) => delete b.amendment_votes.votes],
    ["votes that is not a list", (b) => (b.amendment_votes.votes = {})],
    ["a vote that is not an object", (b) => (b.amendment_votes.votes[0] = "yes")],
    ["a vote whose id is not 64 hex", (b) => (b.amendment_votes.votes[0].id = "98433DD0")],
    ["a vote whose name is a number", (b) => (b.amendment_votes.votes[1].name = 1)],
    ["a vote whose status is empty", (b) => (b.amendment_votes.votes[0].status = "")],
    ["a vote whose status is a number", (b) => (b.amendment_votes.votes[0].status = 1)],
    ["a vote with no status", (b) => delete b.amendment_votes.votes[0].status],
    ["a vote that is a boolean", (b) => (b.amendment_votes.votes[0].vote = true)],
    ["a vote of a word that is not one", (b) => (b.amendment_votes.votes[0].vote = "maybe")],
    ["a record ledger that is text", (b) => (b.amendment_votes.ledger_index = "107748095")],
    ["a manifest sequence that is text", (b) => (b.manifest.sequence = "2")],
    ["a manifest signing key that is an address", (b) => (b.manifest.signing_key = ADDRESS)],
    ["a manifest without signing_keys_seen", (b) => delete b.manifest.signing_keys_seen],
    ["daily_agreement that is missing", (b) => delete b.daily_agreement],
    ["daily_agreement that is not a list", (b) => (b.daily_agreement = {})],
    ["a day that is a number", (b) => (b.daily_agreement[0].date = 20261017)],
    ["a day that is not a date", (b) => (b.daily_agreement[0].date = "yesterday")],
    ["a day with a score that is a number", (b) => (b.daily_agreement[1].score = 1)],
    ["a day with a score of three decimals", (b) => (b.daily_agreement[1].score = "1.000")],
    ["a day with total as text", (b) => (b.daily_agreement[2].total = "21600")],
  ]);

  it("takes a validator with no record, no manifest and no days of agreement", () => {
    const body = validatorDetailSample();
    body.amendment_votes = { yes: [], votes: [{ id: "98433DD001A5737F773D74F8CA2A25A065089C73B2E611C760BAF369E4FECA76", status: "majority", vote: "none" }] };
    delete body.manifest;
    body.daily_agreement = [];
    expect(checkValidatorDetail(body, "/x")).toBe(body);
  });

  it("takes an unknown amendment's vote, which has no name", () => {
    const body = validatorDetailSample();
    body.amendment_votes.votes.push({ id: "2".repeat(64), status: "unknown", vote: "no" });
    expect(checkValidatorDetail(body, "/x")).toBe(body);
  });

  it("takes a vote's status that the reference does not list for it, and a domain check's status a newer D1 sends: words the page reads as its defaults", () => {
    const body = validatorDetailSample();
    body.amendment_votes.votes[0]!.status = "frozen";
    body.amendment_votes.votes[1]!.status = "enabled";
    body.domain_verification!.status = "revoked";
    expect(checkValidatorDetail(body, "/x")).toBe(body);
  });
});

describe("checkValidatorValidations", () => {
  pins(checkValidatorValidations, validationsSample, [
    ["a result that is not success", (b) => (b.result = "error")],
    ["a master key that is an address", (b) => (b.validation_public_key = ADDRESS)],
    ["a count that is text", (b) => (b.count = "4")],
    ["a marker that is not a marker", (b) => (b.marker = "not a marker!")],
    ["validations that is not a list", (b) => (b.validations = {})],
    ["a validation that is not an object", (b) => (b.validations[0] = "row")],
    ["a ledger_index that is text", (b) => (b.validations[0].ledger_index = "107748007")],
    ["a ledger_hash that is not 64 hex", (b) => (b.validations[0].ledger_hash = "0000066C1AA7")],
    ["a ledger_hash that is a number", (b) => (b.validations[0].ledger_hash = 66)],
    ["a validated word that is not one", (b) => (b.validations[0].validated = "maybe")],
    ["a validated_hash that is not 64 hex", (b) => (b.validations[1].validated_hash = "066C1AA6")],
    ["a full that is text", (b) => (b.validations[0].full = "false")],
    ["a signing key that is an address", (b) => (b.validations[0].signing_key = ADDRESS)],
    ["a signing_time that is a number", (b) => (b.validations[0].signing_time = 1792254380)],
    ["a signing_time that is not a time", (b) => (b.validations[0].signing_time = "2026-10-19 16:26:20")],
    ["a first_datetime that is a number", (b) => (b.validations[0].first_datetime = 1)],
    ["a last_datetime that is missing", (b) => delete b.validations[0].last_datetime],
    ["a count of sightings that is text", (b) => (b.validations[0].count = "1")],
    ["a count of sightings that is negative", (b) => (b.validations[0].count = -1)],
  ]);

  it("takes an empty page, a signing key the API left empty, and hashes in lower case (D1 compares them without regard to case)", () => {
    const empty = { result: "success", validation_public_key: SAMPLE_KEYS[0], count: 0, validations: [] };
    expect(checkValidatorValidations(empty, "/x")).toBe(empty);
    const body = validationsSample();
    body.validations[0].signing_key = "";
    body.validations[0].ledger_hash = body.validations[0].ledger_hash.toLowerCase();
    body.validations[1].validated_hash = body.validations[1].validated_hash!.toLowerCase();
    expect(checkValidatorValidations(body, "/x")).toBe(body);
  });
});

describe("checkAmendments", () => {
  pins(checkAmendments, amendmentsSample, [
    ["a result that is not success", (b) => (b.result = "error")],
    ["a ledger_index that is text", (b) => (b.ledger_index = "107748183")],
    ["no rules", (b) => delete b.rules],
    ["a rule that is text", (b) => (b.rules.threshold_percent = "80")],
    ["a rules hold that is missing", (b) => delete b.rules.majority_hold_seconds],
    ["a round without its needed", (b) => delete b.round.needed],
    ["a round date that is a number", (b) => (b.round.date = 1792252100)],
    ["a round count that is text", (b) => (b.round.unl_size = "36")],
    ["a flag ledger that is text", (b) => (b.next_flag_ledger.ledger_index = "107748352")],
    ["counts that are missing", (b) => delete b.counts],
    ["counts without a status", (b) => delete b.counts.obsolete],
    ["a count that is text", (b) => (b.counts.enabled = "3")],
    ["a count of amendments that is text", (b) => (b.count = "5")],
    ["amendments that is not a list", (b) => (b.amendments = {})],
    ["an amendment that is not an object", (b) => (b.amendments[0] = "AMM")],
    ["an id that is not 64 hex", (b) => (b.amendments[0].id = "8CC0774A")],
    ["an id in lower case", (b) => (b.amendments[0].id = b.amendments[0].id.toLowerCase())],
    ["an id of 65 digits", (b) => (b.amendments[0].id += "0")],
    ["a name that is a number", (b) => (b.amendments[0].name = 7)],
    ["a status that is empty", (b) => (b.amendments[0].status = "")],
    ["a status that is a number", (b) => (b.amendments[0].status = 1)],
    ["no status", (b) => delete b.amendments[0].status],
    ["retired that is false", (b) => (b.amendments[0].retired = false)],
    ["retired that is text", (b) => (b.amendments[0].retired = "true")],
    ["an introduced that is a number", (b) => (b.amendments[0].introduced = 3.5)],
    ["an xls_url that is a number", (b) => (b.amendments[0].xls_url = 1)],
    ["a description that is a number", (b) => (b.amendments[0].description = 1)],
    ["node_supported that is text", (b) => (b.amendments[0].node_supported = "true")],
    ["votes that are not an object", (b) => (b.amendments[0].votes = 30)],
    ["votes whose pct is text", (b) => (b.amendments[0].votes.pct = "85.71")],
    ["votes whose yes is text", (b) => (b.amendments[0].votes.yes = "30")],
    ["votes without needed", (b) => delete b.amendments[0].votes.needed],
    ["a majority since that is a number", (b) => (b.amendments[0].majority.since = 1791993260)],
    ["a majority without expected_activation", (b) => delete b.amendments[0].majority.expected_activation],
    ["a majority ledger_index that is text", (b) => (b.amendments[0].majority.ledger_index = "107704833")],
    ["a majority tx_hash that is not 64 hex", (b) => (b.amendments[0].majority.tx_hash = "F78430AD")],
    ["a majority tx_hash that is a number", (b) => (b.amendments[0].majority.tx_hash = 1)],
    ["enabled that is not an object", (b) => (b.amendments[3].enabled = true)],
    ["an enabled source that is not one", (b) => (b.amendments[3].enabled.source = "node")],
    ["no enabled source", (b) => delete b.amendments[3].enabled.source],
    ["an enabled date that is a number", (b) => (b.amendments[3].enabled.date = 1792251084)],
    ["an enabled ledger that is text", (b) => (b.amendments[3].enabled.ledger_index = "107747841")],
    ["an enabled tx_hash that is not 64 hex", (b) => (b.amendments[3].enabled.tx_hash = "F5AFF7C2")],
  ]);

  it("takes what a database with no ledger, no round and no head leaves out, and rows that are only an ID and a status", () => {
    const bare = {
      result: "success",
      rules: { threshold_percent: 80, majority_hold_seconds: 1209600, flag_interval: 256 },
      counts: { enabled: 0, majority: 0, voting: 0, obsolete: 0, unknown: 1 },
      count: 1,
      amendments: [{ id: "2".repeat(64), status: "unknown" }],
    };
    expect(checkAmendments(bare, "/x")).toBe(bare);
  });

  it("takes a retired row, a majority whose EnableAmendment is not indexed, and an enabled one the metadata file dates by a day only", () => {
    const body = amendmentsSample();
    body.amendments = [
      { id: "1".repeat(64), name: "RetiredOnXahau", status: "enabled", retired: true, introduced: "2023.4.6" },
      { id: "3".repeat(64), name: "NoTx", status: "majority", majority: { since: "2026-10-14T15:54:20Z", expected_activation: "2026-10-28T15:54:20Z" } },
      { id: "4".repeat(64), name: "ByFile", status: "enabled", enabled: { date: "2025-02-03", source: "metadata" } },
      { id: "5".repeat(64), name: "ByFileNoDate", status: "enabled", enabled: { source: "metadata" } },
      { id: "6".repeat(64), status: "unknown", node_supported: true, votes: { ledger_index: 107748095, yes: 0, trusted: 35, needed: 29, pct: 0 } },
    ];
    expect(checkAmendments(body, "/x")).toBe(body);
  });

  it("takes a status a newer D1 sends: a word the pages read as Unknown, not a refusal (the counts keep D1's five)", () => {
    const body = amendmentsSample();
    body.amendments[1]!.status = "frozen";
    expect(checkAmendments(body, "/x")).toBe(body);
  });
});

describe("checkAmendmentDetail", () => {
  pins(checkAmendmentDetail, amendmentDetailSample, [
    ["a result that is not success", (b) => (b.result = "error")],
    ["no result", (b) => delete b.result],
    ["no rules", (b) => delete b.rules],
    ["a round that is a list", (b) => (b.round = [])],
    ["an id that is not 64 hex", (b) => (b.id = "C98D98EE")],
    ["a status that is empty", (b) => (b.status = "")],
    ["no status", (b) => delete b.status],
    ["votes whose pct is text", (b) => (b.votes.pct = "85.71")],
    ["a majority since that is a number", (b) => (b.majority.since = 1)],
    ["unl_votes that is not a list", (b) => (b.unl_votes = {})],
    ["unl_votes that is missing", (b) => delete b.unl_votes],
    ["other_votes that is missing", (b) => delete b.other_votes],
    ["a vote that is not an object", (b) => (b.unl_votes[0] = "yes")],
    ["a voter key that is an address", (b) => (b.unl_votes[0].validation_public_key = ADDRESS)],
    ["a voter key that is empty", (b) => (b.unl_votes[0].validation_public_key = "")],
    ["a voter domain that is a number", (b) => (b.unl_votes[0].domain = 7)],
    ["a vote word that is not one", (b) => (b.unl_votes[0].vote = "maybe")],
    ["a vote that is a boolean", (b) => (b.other_votes[0].vote = true)],
    ["a voter version that is a number", (b) => (b.unl_votes[0].version = 3.4)],
    ["a version_supports that is text", (b) => (b.unl_votes[0].version_supports = "true")],
    ["a voter last_seen that is a number", (b) => (b.unl_votes[0].last_seen = 1)],
    ["rounds that is not a list", (b) => (b.rounds = {})],
    ["rounds that is missing", (b) => delete b.rounds],
    ["a round that is not an object", (b) => (b.rounds[0] = 1)],
    ["a round ledger_index that is text", (b) => (b.rounds[0].ledger_index = "107543295")],
    ["a round flag_ledger that is missing", (b) => delete b.rounds[0].flag_ledger],
    ["a round date that is a number", (b) => (b.rounds[0].date = 1)],
    ["a round yes that is text", (b) => (b.rounds[0].yes = "0")],
    ["a round threshold that is missing", (b) => delete b.rounds[0].threshold],
    ["a round passes that is text", (b) => (b.rounds[0].passes = "false")],
    ["history that is not a list", (b) => (b.history = {})],
    ["history that is missing", (b) => delete b.history],
    ["an event that is empty", (b) => (b.history[0].event = "")],
    ["an event that is a number", (b) => (b.history[0].event = 1)],
    ["no event", (b) => delete b.history[0].event],
    ["an event ledger_index that is text", (b) => (b.history[0].ledger_index = "106500001")],
    ["an event date that is a number", (b) => (b.history[0].date = 1)],
    ["an event tx_hash that is not 64 hex", (b) => (b.history[0].tx_hash = "62C1656A")],
    ["an event tx_hash that is missing", (b) => delete b.history[0].tx_hash],
  ]);

  it("takes a voter that was never seen (a vote of none, with no version and no last_seen), no rounds and no history", () => {
    const body = amendmentDetailSample();
    body.unl_votes = [{ validation_public_key: SAMPLE_KEYS[4], vote: "none" }];
    body.other_votes = [];
    body.rounds = [];
    body.history = [];
    expect(checkAmendmentDetail(body, "/x")).toBe(body);
  });

  it("takes an amendment of the three kinds of history event", () => {
    const body = amendmentDetailSample();
    const tx = "A".repeat(64);
    body.history = [
      { event: "got_majority", ledger_index: 1, date: "2026-08-20T15:54:20Z", tx_hash: tx },
      { event: "lost_majority", ledger_index: 2, date: "2026-08-30T15:54:20Z", tx_hash: tx },
      { event: "enabled", ledger_index: 3, date: "2026-09-13T15:54:20Z", tx_hash: tx },
    ];
    expect(checkAmendmentDetail(body, "/x")).toBe(body);
  });

  it("takes a status and a history event a newer D1 sends: words the page reads as Unknown and leaves out, not a refusal", () => {
    const body = amendmentDetailSample();
    body.status = "frozen";
    body.history = [...body.history, { event: "vetoed", ledger_index: 4, date: "2026-09-20T15:54:20Z", tx_hash: "A".repeat(64) }];
    expect(checkAmendmentDetail(body, "/x")).toBe(body);
  });
});
