// The sentences about a domain's toml (E9, spec 6.3), which two places say: the note under a validator's name (4.2 of the validators' spec; E6) and the account page's header,
// where an account names a domain that its toml does not vouch for. They were validator-facts.ts's; they live here so that the header says the same things in the same words, with
// the subject of the sentence a parameter ("this master key", "this account"). Pure, no I/O; worker-only like the files that use it (it imports types only).

import type { Loaded } from "./account-view";
import type { DomainVerification, TomlAnswer } from "./api-types";
import type { Network } from "./networks";

/** Whose entry in the toml a sentence looks for: a validator's master key, or an account. */
export type TomlSubject = "this master key" | "this account";

/** The file a domain publishes on the network whose software this is. */
export function tomlFileOf(software: Network["software"]): "xrp-ledger.toml" | "xahau.toml" {
  return software === "xahaud" ? "xahau.toml" : "xrp-ledger.toml";
}

/** What a domain's check that is `unverified` reads as when D1 gives no reason this build can word. */
export const UNVERIFIED = "The domain could not be verified.";

/**
 * The sentence of an `unverified` domain: its `reason`, which D1 sets for that status only. A reason this file does not know (a newer D1), or one that lacks what its sentence needs,
 * reads `UNVERIFIED`. `subject` is whom the toml should have listed: the validator's note says "this master key" (its words, as they were), an account's page "this account".
 */
export function unverifiedSentence(dv: DomainVerification, domain: string, file: string, subject: TomlSubject = "this master key"): string {
  switch (dv.reason) {
    case "not_listed":
      return `The ${file} at ${domain} does not list ${subject}.`;
    case "toml_invalid":
      return `The ${file} at ${domain} could not be read as TOML.`;
    case "too_large":
      return `The ${file} at ${domain} is larger than 256 KiB.`;
    case "http_status":
      return dv.status_code === undefined ? UNVERIFIED : `${domain} answered HTTP ${dv.status_code} for its ${file}.`;
    case "dns_error":
      return `${domain} could not be reached (the DNS lookup failed). The data API tries again within the hour.`;
    case "connect_error":
      return `${domain} could not be reached (the connection failed). The data API tries again within the hour.`;
    case "tls_error":
      return `${domain} could not be reached (TLS failed). The data API tries again within the hour.`;
    case "timeout":
      return `${domain} could not be reached (it timed out). The data API tries again within the hour.`;
    case "redirect_rejected":
    case "blocked_address":
      return `${domain} sent the request where the data API does not follow.`;
    case "domain_invalid":
      return "The manifest's domain is not a valid domain name.";
    case "manifest_unverified":
      return "The manifest that names this domain could not be verified.";
    default:
      return UNVERIFIED;
  }
}

/**
 * Why a toml could not be read, in words that follow "could not be read: ". `reason` is the data API's (`GET /v2/toml/{domain}`, a `failed` status); `http_status` has the
 * `status_code`. A reason this build does not know (a newer API) reads as the data API's own failure to read it.
 */
export function tomlFailureWords(reason: string | undefined, statusCode: number | undefined): string {
  switch (reason) {
    case "dns_error":
      return "the DNS lookup failed";
    case "connect_error":
      return "the connection failed";
    case "tls_error":
      return "TLS failed";
    case "timeout":
      return "it timed out";
    case "http_status":
      return statusCode === undefined ? "the server answered with an error" : `the server answered HTTP ${statusCode}`;
    case "too_large":
      return "it is larger than 256 KiB";
    case "toml_invalid":
      return "it is not valid TOML";
    case "redirect_rejected":
    case "blocked_address":
      return "the server sent the request where the data API does not follow";
    case "domain_invalid":
      return "the domain is not a valid domain name";
    default:
      return "the data API could not read it";
  }
}

const WITHOUT_VOUCHING = "The explorer shows the domain, without vouching for it.";

/**
 * What the account page says of a domain an account names and nothing vouches for (spec 6.3), by what the toml call found: the toml was read and does not list the account; its check
 * failed (and why); or the call itself failed (then there is no reason to give). A toml that is not there (`missing`) is the account page's pending state, not this one; if it is
 * asked anyway it gets the last sentence, which claims nothing about the file. The same sentence is the title of the domain's mark.
 */
export function domainNotVerifiedSentence(domain: string, file: string, toml: Loaded<TomlAnswer>): string {
  if (toml.state === "ok") {
    const { status, reason, status_code } = toml.value.toml;
    return status === "failed"
      ? `This account names ${domain} in its Domain field, but its ${file} could not be read: ${tomlFailureWords(reason, status_code)}. ${WITHOUT_VOUCHING}`
      : `This account names ${domain} in its Domain field, but ${domain}'s ${file} does not list the account. ${WITHOUT_VOUCHING}`;
  }
  return `This account names ${domain} in its Domain field. ${WITHOUT_VOUCHING}`;
}
