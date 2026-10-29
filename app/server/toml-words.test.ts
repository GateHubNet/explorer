import { describe, expect, it } from "vitest";

import type { Loaded } from "./account-view";
import type { DomainVerification, TomlAnswer } from "./api-types";
import { domainNotVerifiedSentence, tomlFailureWords, tomlFileOf, unverifiedSentence } from "./toml-words";

// The sentences about a toml, which the validator's note and the account page's header both say (E9, spec 6.3). `validator-facts.test.ts` pins the validator's words through
// `verificationNote`; this file pins what is new: the reason words, the three sentences of an account whose domain is not verified, and the subject of `unverifiedSentence`.

describe("tomlFileOf", () => {
  it("names the file of the network's software", () => {
    expect(tomlFileOf("rippled")).toBe("xrp-ledger.toml");
    expect(tomlFileOf("xahaud")).toBe("xahau.toml");
  });
});

describe("tomlFailureWords", () => {
  it.each([
    ["dns_error", "the DNS lookup failed"],
    ["connect_error", "the connection failed"],
    ["tls_error", "TLS failed"],
    ["timeout", "it timed out"],
    ["too_large", "it is larger than 256 KiB"],
    ["toml_invalid", "it is not valid TOML"],
    ["redirect_rejected", "the server sent the request where the data API does not follow"],
    ["blocked_address", "the server sent the request where the data API does not follow"],
    ["domain_invalid", "the domain is not a valid domain name"],
  ])("says %s as %j", (reason, words) => {
    expect(tomlFailureWords(reason, undefined)).toBe(words);
  });

  it("says an HTTP status with its code, and without one that the server answered with an error", () => {
    expect(tomlFailureWords("http_status", 503)).toBe("the server answered HTTP 503");
    expect(tomlFailureWords("http_status", 404)).toBe("the server answered HTTP 404");
    expect(tomlFailureWords("http_status", undefined)).toBe("the server answered with an error");
  });

  it("does not add a code to a reason that has none", () => {
    expect(tomlFailureWords("timeout", 503)).toBe("it timed out");
  });

  it("says that the data API could not read it for a reason it does not know, and for none", () => {
    expect(tomlFailureWords("quota_exceeded", undefined)).toBe("the data API could not read it");
    expect(tomlFailureWords("", undefined)).toBe("the data API could not read it");
    expect(tomlFailureWords(undefined, undefined)).toBe("the data API could not read it");
    expect(tomlFailureWords(undefined, 503)).toBe("the data API could not read it");
  });
});

/** What `GET /v2/toml/lowtide.example` answers, with the keys a test changes. */
function answer(toml: Partial<TomlAnswer["toml"]>): Loaded<TomlAnswer> {
  return {
    state: "ok",
    value: {
      result: "success",
      toml: { domain: "lowtide.example", toml_url: "https://lowtide.example/.well-known/xrp-ledger.toml", status: "ok", checked: "2026-10-24T07:12:09.410Z", ...toml },
    },
  };
}

describe("domainNotVerifiedSentence", () => {
  const WITHOUT_VOUCHING = "The explorer shows the domain, without vouching for it.";

  it("says that the toml does not list the account, when it was read", () => {
    expect(domainNotVerifiedSentence("lowtide.example", "xrp-ledger.toml", answer({ fetched: "2026-10-24T07:12:09.410Z" }))).toBe(
      `This account names lowtide.example in its Domain field, but lowtide.example's xrp-ledger.toml does not list the account. ${WITHOUT_VOUCHING}`,
    );
  });

  it("says why the toml could not be read, when the check failed", () => {
    expect(domainNotVerifiedSentence("lowtide.example", "xrp-ledger.toml", answer({ status: "failed", reason: "http_status", status_code: 503 }))).toBe(
      `This account names lowtide.example in its Domain field, but its xrp-ledger.toml could not be read: the server answered HTTP 503. ${WITHOUT_VOUCHING}`,
    );
    expect(domainNotVerifiedSentence("lowtide.example", "xrp-ledger.toml", answer({ status: "failed", reason: "tls_error" }))).toBe(
      `This account names lowtide.example in its Domain field, but its xrp-ledger.toml could not be read: TLS failed. ${WITHOUT_VOUCHING}`,
    );
  });

  it("says that the data API could not read it when the check failed with no reason it knows", () => {
    expect(domainNotVerifiedSentence("lowtide.example", "xrp-ledger.toml", answer({ status: "failed" }))).toBe(
      `This account names lowtide.example in its Domain field, but its xrp-ledger.toml could not be read: the data API could not read it. ${WITHOUT_VOUCHING}`,
    );
  });

  it("says only that the account names the domain, when the call failed", () => {
    expect(domainNotVerifiedSentence("lowtide.example", "xrp-ledger.toml", { state: "failed" })).toBe(
      `This account names lowtide.example in its Domain field. ${WITHOUT_VOUCHING}`,
    );
  });

  it("says the same for a toml that is not there: the account page shows that state as pending, but the sentence has no reason to give", () => {
    expect(domainNotVerifiedSentence("lowtide.example", "xrp-ledger.toml", { state: "missing" })).toBe(
      `This account names lowtide.example in its Domain field. ${WITHOUT_VOUCHING}`,
    );
  });

  it("names xahau.toml on Xahau, in all three sentences", () => {
    const file = tomlFileOf("xahaud");
    expect(domainNotVerifiedSentence("saltmarsh.example", file, answer({ domain: "saltmarsh.example" }))).toBe(
      `This account names saltmarsh.example in its Domain field, but saltmarsh.example's xahau.toml does not list the account. ${WITHOUT_VOUCHING}`,
    );
    expect(domainNotVerifiedSentence("saltmarsh.example", file, answer({ status: "failed", reason: "dns_error" }))).toBe(
      `This account names saltmarsh.example in its Domain field, but its xahau.toml could not be read: the DNS lookup failed. ${WITHOUT_VOUCHING}`,
    );
    expect(domainNotVerifiedSentence("saltmarsh.example", file, { state: "failed" })).toBe(`This account names saltmarsh.example in its Domain field. ${WITHOUT_VOUCHING}`);
  });
});

describe("unverifiedSentence", () => {
  const dv = (reason: string, rest: Partial<DomainVerification> = {}): DomainVerification => ({
    status: "unverified",
    reason,
    toml_url: "https://lowtide.example/.well-known/xrp-ledger.toml",
    ...rest,
  });

  it("says this master key for a validator, as it always has", () => {
    expect(unverifiedSentence(dv("not_listed"), "lowtide.example", "xrp-ledger.toml")).toBe("The xrp-ledger.toml at lowtide.example does not list this master key.");
    expect(unverifiedSentence(dv("not_listed"), "lowtide.example", "xrp-ledger.toml", "this master key")).toBe(
      "The xrp-ledger.toml at lowtide.example does not list this master key.",
    );
  });

  it("says this account when the subject is an account", () => {
    expect(unverifiedSentence(dv("not_listed"), "lowtide.example", "xrp-ledger.toml", "this account")).toBe("The xrp-ledger.toml at lowtide.example does not list this account.");
    expect(unverifiedSentence(dv("not_listed"), "saltmarsh.example", "xahau.toml", "this account")).toBe("The xahau.toml at saltmarsh.example does not list this account.");
  });

  it("keeps every other sentence as it is, whatever the subject", () => {
    for (const subject of ["this master key", "this account"] as const) {
      expect(unverifiedSentence(dv("toml_invalid"), "lowtide.example", "xrp-ledger.toml", subject)).toBe("The xrp-ledger.toml at lowtide.example could not be read as TOML.");
      expect(unverifiedSentence(dv("http_status", { status_code: 503 }), "lowtide.example", "xrp-ledger.toml", subject)).toBe("lowtide.example answered HTTP 503 for its xrp-ledger.toml.");
      expect(unverifiedSentence(dv("http_status"), "lowtide.example", "xrp-ledger.toml", subject)).toBe("The domain could not be verified.");
      expect(unverifiedSentence(dv("something_new"), "lowtide.example", "xrp-ledger.toml", subject)).toBe("The domain could not be verified.");
    }
  });
});
