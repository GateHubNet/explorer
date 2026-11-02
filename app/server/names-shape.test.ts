import { describe, expect, it } from "vitest";

import type { AccountNamesResponse, TomlAnswer } from "./api-types";
import { checkAccountNames, checkToml } from "./names-shape";
import { UpstreamError } from "./upstream";

// The examples are the ones of data-api-new/docs/api-reference.md ("Account names and tomls", D4 at 3feb11a), where it gives one; the rest are built from its
// list of keys. A defect is one change to an example.

/** A body to be broken in some way: a test reaches into it as it likes. */
type Body = any;
type Defect = [what: string, change: (body: Body) => void];

const clone = <T>(value: T): T => structuredClone(value);

/** The check refuses `body` as an `UpstreamError` of kind `server` that marks an answer of the upstream (status 200), naming the field in its message. */
function refuses(check: (body: Body) => unknown, body: unknown, field?: string): void {
  let error: unknown;
  try {
    check(body);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UpstreamError);
  expect((error as UpstreamError).kind).toBe("server");
  expect((error as UpstreamError).status).toBe(200);
  expect((error as UpstreamError).message).toContain("answered something unexpected");
  if (field !== undefined) expect((error as UpstreamError).message).toContain(field);
}

const VERIFIED = "rrrrrrrrrrrrrrrrrrrpnkLzyT5b";
const OPERATOR = "rrrrrrrrrrrrrrrrrrrpnkW55rwD";
const DOMAIN_ONLY = "rrrrrrrrrrrrrrrrrrrpnkjf2SSq";
const NOTHING = "rrrrrrrrrrrrrrrrrrrpnkmG5Qdx";
const LABELLED = "rrrrrrrrrrrrrrrrrrrpnkAqFzdM";
const ASKED = [VERIFIED, OPERATOR, DOMAIN_ONLY, NOTHING];

/**
 * `GET /v2/account_names?addresses=…` for the four addresses of the reference's first example: a verified name with its domain, an operator's name with a network name and an
 * advisory, an unverified domain, an address nothing names.
 */
const namesExample = (): AccountNamesResponse => ({
  result: "success",
  count: 4,
  account_names: [
    { address: VERIFIED, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example" },
    {
      address: OPERATOR,
      display_name: { text: "Harborline Exchange", kind: "account" },
      account_name: "Harborline Exchange",
      account_network_name: "hot wallet",
      labels: { advisory: { description: "Withdrawals paused since 2026-10-01", url: "https://harborline.example/status" } },
    },
    { address: DOMAIN_ONLY, display_name: { text: "lowtide.example", kind: "domain" }, domain: "lowtide.example" },
    { address: NOTHING },
  ],
});

/** The reference's second example: an address with all three labels, each with the keys the operator gave. */
const labelsExample = (): AccountNamesResponse => ({
  result: "success",
  count: 1,
  account_names: [
    {
      address: LABELLED,
      labels: {
        scam: { description: "Fake giveaway", source: "Harbor compliance desk", url: "https://harborline.example/reports/1" },
        spam: { description: "Dust payments", source: "Harbor compliance desk" },
        advisory: { description: "Named in a warning" },
      },
    },
  ],
});

describe("checkAccountNames", () => {
  it("takes the reference's examples, and returns them as they are", () => {
    const names = namesExample();
    expect(checkAccountNames(names, ASKED)).toBe(names);
    const labels = labelsExample();
    expect(checkAccountNames(labels, [LABELLED])).toBe(labels);
  });

  it("takes an entry that carries a domain and no display name, which is how D4 answers when it could not read its toml store", () => {
    const body: AccountNamesResponse = { result: "success", count: 2, account_names: [{ address: VERIFIED, domain: "northpeak.example" }, { address: NOTHING }] };
    expect(checkAccountNames(body, [VERIFIED, NOTHING])).toBe(body);
  });

  it("takes an address asked twice, answered at each place, and a label whose description is empty", () => {
    const body: AccountNamesResponse = {
      result: "success",
      count: 3,
      account_names: [{ address: NOTHING }, { address: LABELLED, labels: { advisory: { description: "" } } }, { address: NOTHING }],
    };
    expect(checkAccountNames(body, [NOTHING, LABELLED, NOTHING])).toBe(body);
  });

  it("takes a kind of display name that a newer API may add, which the pages read as no name", () => {
    const body: Body = namesExample();
    body.account_names[0].display_name.kind = "curated";
    expect(checkAccountNames(body, ASKED)).toBe(body);
  });

  it("takes a label of a newer API and the keys it may add", () => {
    const body: Body = labelsExample();
    body.account_names[0].labels.sanctioned = { description: "Listed", source: "Somebody" };
    body.account_names[0].something_new = { any: "thing" };
    body.future = true;
    expect(checkAccountNames(body, [LABELLED])).toBe(body);
  });

  const defects: Defect[] = [
    ["a count of 3 for 4 addresses", (b) => (b.count = 3)],
    ["a count of 5 for 4 addresses", (b) => (b.count = 5)],
    ["a count that is text", (b) => (b.count = "4")],
    ["a list of 3 for 4 addresses, under the right count", (b) => b.account_names.pop()],
    ["a list of 5 for 4 addresses, under the right count", (b) => b.account_names.push({ address: LABELLED })],
    ["a list that is an object", (b) => (b.account_names = {})],
    ["no list", (b) => delete b.account_names],
    ["an entry for another address at a place", (b) => (b.account_names[1].address = LABELLED)],
    ["two entries in the other order", (b) => b.account_names.reverse()],
    ["an entry without an address", (b) => delete b.account_names[3].address],
    ["an entry that is not an object", (b) => (b.account_names[3] = NOTHING)],
    ["a display name with no text", (b) => (b.account_names[0].display_name.text = "")],
    ["a display name whose text is not text", (b) => (b.account_names[0].display_name.text = 7)],
    ["a display name without a text", (b) => delete b.account_names[0].display_name.text],
    ["a display name whose kind is not text", (b) => (b.account_names[0].display_name.kind = 1)],
    ["a display name without a kind", (b) => delete b.account_names[0].display_name.kind],
    ["a display name that is text", (b) => (b.account_names[0].display_name = "Northpeak Treasury")],
    ["a display name that is null", (b) => (b.account_names[0].display_name = null)],
    ["labels that is a list", (b) => (b.account_names[1].labels = [])],
    ["labels that is null", (b) => (b.account_names[1].labels = null)],
    ["a label that is empty", (b) => (b.account_names[1].labels = { scam: {} })],
    ["a label that is text", (b) => (b.account_names[1].labels = { scam: "Fake giveaway" })],
    ["a label whose description is not text", (b) => (b.account_names[1].labels.advisory.description = 3)],
    ["a label whose source is not text", (b) => (b.account_names[1].labels.advisory.source = 3)],
    ["a label whose url is not text", (b) => (b.account_names[1].labels.advisory.url = 3)],
    ["a domain that is not text", (b) => (b.account_names[0].domain = 3)],
    ["an account name that is not text", (b) => (b.account_names[1].account_name = 3)],
    ["an account network name that is not text", (b) => (b.account_names[1].account_network_name = ["hot wallet"])],
  ];
  it.each(defects)("refuses %s", (_what, defect) => {
    const body = clone(namesExample());
    defect(body);
    refuses((checked) => checkAccountNames(checked, ASKED), body);
  });

  it.each([null, undefined, "success", 4, [], [namesExample()]])("refuses %j as the answer", (body) => {
    refuses((checked) => checkAccountNames(checked, ASKED), body);
  });

  it("names the field that is wrong", () => {
    const body: Body = clone(namesExample());
    body.account_names[1].labels = { scam: {} };
    refuses((checked) => checkAccountNames(checked, ASKED), body, "account_names[1].labels.scam.description");

    const other: Body = clone(namesExample());
    other.account_names[2].address = NOTHING;
    refuses((checked) => checkAccountNames(checked, ASKED), other, "account_names[2].address");

    const counted: Body = clone(namesExample());
    counted.count = 3;
    refuses((checked) => checkAccountNames(checked, ASKED), counted, "count");
  });

  it("holds an answer to the addresses asked, not to the ones it carries", () => {
    // The same body is right for the four addresses and wrong for the other four, and for the first three.
    const body = namesExample();
    expect(checkAccountNames(body, ASKED)).toBe(body);
    refuses((checked) => checkAccountNames(checked, [LABELLED, VERIFIED, OPERATOR, DOMAIN_ONLY]), body);
    refuses((checked) => checkAccountNames(checked, ASKED.slice(0, 3)), body);
  });
});

/** `GET /v2/toml/northpeak.example`: a domain whose toml was read. */
const tomlExample = (): TomlAnswer => ({
  result: "success",
  toml: {
    domain: "northpeak.example",
    toml_url: "https://northpeak.example/.well-known/xrp-ledger.toml",
    status: "ok",
    checked: "2026-10-24T07:12:09.410Z",
    fetched: "2026-10-24T07:12:09.410Z",
    modified: "2026-10-02T00:00:00Z",
    accounts: [
      { address: "rrrrrrrrrrrrrrrrrrrpaEDEVjEj", desc: "Northpeak Treasury" },
      { address: "rrrrrrrrrrrrrrrrrrrpaEPPn7z7", desc: "Northpeak Payroll" },
    ],
    currencies: [{ code: "NPUSD", issuer: "rrrrrrrrrrrrrrrrrrrpaEDEVjEj", display_decimals: 2, name: "Northpeak Dollar" }],
    principals: ["Mara Lindqvist", "Tomas Okafor"],
    validators: [{ public_key: "nHUCsRY4GY2nvLSb1kv8AL8Rt36c9icCuZmBUKwzmoATeRcFkVMu", owner_country: "NO", server_country: "DE", unl: "https://vl.ripple.com" }],
  },
});

/** A check that failed within the grace of a transient failure: it says what failed and still carries what the last read said. */
const failedWithContentExample = (): TomlAnswer => ({
  result: "success",
  toml: {
    domain: "blip.example",
    toml_url: "https://blip.example/.well-known/xrp-ledger.toml",
    status: "failed",
    reason: "http_status",
    status_code: 503,
    checked: "2026-10-20T11:00:00.250Z",
    fetched: "2026-10-20T10:00:00.250Z",
    modified: "2026-10-01T00:00:00Z",
    accounts: [{ address: "rrrrrrrrrrrrrrrrrrrpaEDEVjEj", desc: "Tidewater Treasury" }],
    principals: ["Ines Brandt"],
  },
});

/** A definite failure carries nothing but the check. */
const failedExample = (): TomlAnswer => ({
  result: "success",
  toml: {
    domain: "gone.example",
    toml_url: "https://gone.example/.well-known/xrp-ledger.toml",
    status: "failed",
    reason: "http_status",
    status_code: 404,
    checked: "2026-10-20T11:00:00.250Z",
  },
});

describe("checkToml", () => {
  it("takes the reference's examples, and returns them as they are", () => {
    const read = tomlExample();
    expect(checkToml(read, "northpeak.example")).toBe(read);
    const transient = failedWithContentExample();
    expect(checkToml(transient, "blip.example")).toBe(transient);
    const definite = failedExample();
    expect(checkToml(definite, "gone.example")).toBe(definite);
  });

  it("takes an address listed twice (once for each network that counts), and empty lists", () => {
    const body: Body = tomlExample();
    body.toml.accounts.push({ address: "rrrrrrrrrrrrrrrrrrrpaEDEVjEj" });
    body.toml.currencies = [];
    body.toml.principals = [];
    body.toml.validators = [];
    expect(checkToml(body, "northpeak.example")).toBe(body);
  });

  it("takes the keys of a failed check: its reason, its status code and a last good read", () => {
    const body: Body = failedWithContentExample();
    body.toml.expires = "2027-01-01T00:00:00Z";
    expect(checkToml(body, "blip.example")).toBe(body);
  });

  it("names the field of a reason, a status code or a time that is wrong", () => {
    for (const [key, value] of [["reason", 7], ["status_code", "503"], ["fetched", 7], ["modified", 7], ["expires", 7]] as const) {
      const body: Body = clone(failedWithContentExample());
      body.toml[key] = value;
      refuses((checked) => checkToml(checked, "blip.example"), body, `toml.${key}`);
    }
  });

  it("takes the keys a newer API may add", () => {
    const body: Body = tomlExample();
    body.toml.expires = "2027-01-01T00:00:00Z";
    body.toml.something_new = 1;
    body.toml.accounts[0].network = "main";
    expect(checkToml(body, "northpeak.example")).toBe(body);
  });

  const defects: Defect[] = [
    ["another domain", (b) => (b.toml.domain = "lowtide.example")],
    ["a domain in another case", (b) => (b.toml.domain = "Northpeak.example")],
    ["no domain", (b) => delete b.toml.domain],
    ["a status that is pending", (b) => (b.toml.status = "pending")],
    ["no status", (b) => delete b.toml.status],
    ["a status that is not text", (b) => (b.toml.status = true)],
    ["no checked time", (b) => delete b.toml.checked],
    ["a checked time that is a number", (b) => (b.toml.checked = 1792000000)],
    ["no toml_url", (b) => delete b.toml.toml_url],
    ["a reason that is not text", (b) => (b.toml.reason = 7)],
    ["a status code that is text", (b) => (b.toml.status_code = "503")],
    ["a status code that is not whole", (b) => (b.toml.status_code = 503.5)],
    ["a status code that is negative", (b) => (b.toml.status_code = -1)],
    ["a fetched time that is a number", (b) => (b.toml.fetched = 7)],
    ["a modified time that is a number", (b) => (b.toml.modified = 7)],
    ["an expires time that is a number", (b) => (b.toml.expires = 7)],
    ["no toml", (b) => delete b.toml],
    ["a toml that is a list", (b) => (b.toml = [])],
    ["a toml that is text", (b) => (b.toml = "northpeak.example")],
    ["accounts that is an object", (b) => (b.toml.accounts = {})],
    ["an account that is text", (b) => (b.toml.accounts = ["rrrrrrrrrrrrrrrrrrrpaEDEVjEj"])],
    ["an account with no address", (b) => delete b.toml.accounts[1].address],
    ["an account whose address is not text", (b) => (b.toml.accounts[0].address = 1)],
    ["currencies that is text", (b) => (b.toml.currencies = "NPUSD")],
    ["a currency with no code", (b) => delete b.toml.currencies[0].code],
    ["a currency whose code is a number", (b) => (b.toml.currencies[0].code = 1)],
    ["validators that is null", (b) => (b.toml.validators = null)],
    ["a validator with no public key", (b) => delete b.toml.validators[0].public_key],
    ["a validator whose public key is a number", (b) => (b.toml.validators[0].public_key = 1)],
    ["principals that is text", (b) => (b.toml.principals = "Mara Lindqvist")],
    ["a principal that is not text", (b) => (b.toml.principals = ["Mara Lindqvist", 7])],
    ["a principal that is an object", (b) => (b.toml.principals[0] = { name: "Mara Lindqvist" })],
  ];
  it.each(defects)("refuses %s", (_what, defect) => {
    const body = clone(tomlExample());
    defect(body);
    refuses((checked) => checkToml(checked, "northpeak.example"), body);
  });

  it.each([null, undefined, "success", 4, [], [tomlExample()]])("refuses %j as the answer", (body) => {
    refuses((checked) => checkToml(checked, "northpeak.example"), body);
  });

  it("holds an answer to the domain asked, and names the field that is wrong", () => {
    refuses((checked) => checkToml(checked, "lowtide.example"), tomlExample(), "toml.domain");

    const pending: Body = clone(tomlExample());
    pending.toml.status = "pending";
    refuses((checked) => checkToml(checked, "northpeak.example"), pending, "toml.status");

    const nameless: Body = clone(tomlExample());
    delete nameless.toml.validators[0].public_key;
    refuses((checked) => checkToml(checked, "northpeak.example"), nameless, "toml.validators[0].public_key");
  });
});
