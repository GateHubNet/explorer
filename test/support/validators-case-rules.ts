// What makes a validator or an amendment of the synthetic D1 fixtures (scripts/validators-fixtures.ts) one of the cases the pages draw: a predicate per case over
// D1's answers. Pure, no file reading, for Node and the Workers runtime alike: test/support/validators-cases.ts finds the cases in the fixture files with these rules
// for the worker specs, and test/unit/validators-fixtures.test.ts checks with the same rules that the generator writes every case, so the two cannot part ways.

import BigNumber from "bignumber.js";

import type { AmendmentRow, ValidatorDetail, ValidatorRow, ValidatorsSummary } from "../../app/server/api-types";

export const VALIDATOR_CASES = [
  "verified-unl",
  "with-accounts",
  "unverified",
  "pending",
  "no-domain",
  "never-seen",
  "negative-unl",
  "signing-key",
  "votes-unknown",
  "no-fee-vote",
  "fee-higher",
  "fee-lower",
  "incomplete",
  "no-score",
  "xahau-build",
] as const;
export type ValidatorCase = (typeof VALIDATOR_CASES)[number];

/** What a validator's case is read from, beside its row of the list: the network's summary and its validator files, by the key each file is named by. */
export interface CaseSources {
  summary: ValidatorsSummary;
  /** The answers of `GET /v2/network/validators/{key}` the fixtures hold: a master key's, and the one signing key's that has a file. */
  details: ReadonlyMap<string, ValidatorDetail>;
}

const FEES = ["base_fee", "reserve_base", "reserve_inc"] as const;
/** A fee vote above (`1`) or below (`-1`) the fees in force, in one of the three fees at least. */
const feeAgainst = (row: ValidatorRow, summary: ValidatorsSummary, sign: 1 | -1): boolean =>
  row.fee_vote !== undefined && summary.fees !== undefined && FEES.some((fee) => new BigNumber(row.fee_vote![fee]).comparedTo(summary.fees![fee]) === sign);

/** The signing key of `row` that has a validator file of its own, answered with the master's answer (D answers a signing key), if one has. */
export function signingFileOf(row: ValidatorRow, { details }: CaseSources): string | undefined {
  for (const [key, detail] of details) if (key !== row.validation_public_key && detail.validation_public_key === row.validation_public_key) return key;
  return undefined;
}

/** What makes a row of the list a case. */
export const VALIDATOR_CASE_RULES: Record<ValidatorCase, (row: ValidatorRow, sources: CaseSources) => boolean> = {
  // A verified domain without accounts, on every publisher's list, not on the negative UNL.
  "verified-unl": (row, { summary }) =>
    row.unl &&
    row.domain_verification?.status === "verified" &&
    row.domain_verification.accounts === undefined &&
    !row.negative_unl &&
    row.unl_lists.length === summary.unl.publishers.length,
  // G1: the TOML that verified lists accounts.
  "with-accounts": (row) => row.domain_verification?.status === "verified" && (row.domain_verification.accounts?.length ?? 0) > 0,
  unverified: (row) => row.domain_verification?.status === "unverified",
  pending: (row) => row.domain_verification?.status === "pending",
  "no-domain": (row) => row.domain === undefined && row.last_seen !== undefined,
  "never-seen": (row) => row.unl && row.last_seen === undefined,
  "negative-unl": (row, { summary }) => row.negative_unl && summary.negative_unl_pending?.to_reenable === row.validation_public_key,
  "signing-key": (row, sources) => signingFileOf(row, sources) !== undefined,
  // G4: D's votes hold the unknown amendment, with a vote its record makes (by D1's rules nobody votes yes for one: that makes it `voting`).
  "votes-unknown": (row, { details }) =>
    details.get(row.validation_public_key)?.amendment_votes.votes.some((vote) => vote.status === "unknown" && vote.vote !== "none") === true,
  "no-fee-vote": (row) => row.last_seen !== undefined && row.fee_vote === undefined,
  "fee-higher": (row, { summary }) => feeAgainst(row, summary, 1),
  "fee-lower": (row, { summary }) => feeAgainst(row, summary, -1),
  incomplete: (row) => row.last_seen !== undefined && [row.agreement_1h, row.agreement_24h, row.agreement_30d].some((window) => window.incomplete),
  "no-score": (row) => row.last_seen !== undefined && row.agreement_24h.score === undefined,
  "xahau-build": (row) => row.version_build !== undefined,
};

export const AMENDMENT_CASES = ["majority", "voting", "enabled-ledger", "enabled-metadata", "obsolete", "unknown", "retired"] as const;
export type AmendmentCase = (typeof AMENDMENT_CASES)[number];

/** What makes an amendment of the list a case. */
export const AMENDMENT_CASE_RULES: Record<AmendmentCase, (row: AmendmentRow) => boolean> = {
  majority: (row) => row.status === "majority",
  voting: (row) => row.status === "voting",
  "enabled-ledger": (row) => row.enabled?.source === "ledger",
  "enabled-metadata": (row) => row.enabled?.source === "metadata",
  obsolete: (row) => row.status === "obsolete",
  unknown: (row) => row.status === "unknown",
  retired: (row) => row.retired === true,
};
