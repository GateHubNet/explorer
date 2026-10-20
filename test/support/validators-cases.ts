// The validators and amendments of the synthetic D1 fixtures (scripts/validators-fixtures.ts, `pnpm fixtures:sync`) that the worker specs need: a validator or an
// amendment of each case the pages draw, every validator key that has a file (for specs that need a new key per test), and the one second page of validations. Each
// case is found in the files' data by a predicate, never from a table of keys, so a change of the generator's seeds moves nothing here. Read from the fixture files
// themselves (Vite bundles them, as ledger-hashes.ts does), not through the client under test.

import BigNumber from "bignumber.js";

import type { AmendmentsList, ValidatorDetail, ValidatorRow, ValidatorsList, ValidatorsSummary } from "../../app/server/api-types";
import type { NetworkId } from "../../app/server/networks";

const ROOT = "../fixtures/http/";
const files = import.meta.glob(
  [
    "../fixtures/http/*/data-api/network/validators/*.json",
    "../fixtures/http/*/data-api/network/validators@*.json",
    "../fixtures/http/*/data-api/network/amendments.json",
  ],
  { query: "?raw", import: "default" },
) as Record<string, () => Promise<string>>;
/** The validations files are only looked at by name. */
const validationFiles = Object.keys(import.meta.glob("../fixtures/http/*/data-api/network/validators/*/validations@*.json", { query: "?raw", import: "default" }));

async function read<T>(path: string): Promise<T> {
  const load = files[`${ROOT}${path}`];
  if (load === undefined) throw new Error(`no fixture ${path}`);
  return JSON.parse(await load()) as T;
}

const summaryOf = (net: NetworkId) => read<ValidatorsSummary>(`${net}/data-api/network/validators/summary.json`);
const rowsOf = async (net: NetworkId) => (await read<ValidatorsList>(`${net}/data-api/network/validators@limit=1000&scope=all.json`)).validators;
const detailOf = (net: NetworkId, key: string) => read<ValidatorDetail>(`${net}/data-api/network/validators/${key}.json`);
/** The keys the validator files of a network are named by (masters, and the one signing key that has a file). */
const fileKeys = (net: NetworkId): string[] =>
  Object.keys(files).flatMap((path) => {
    const key = new RegExp(`^${net}/data-api/network/validators/(n[^/]+)\\.json$`).exec(path.slice(ROOT.length))?.[1];
    return key === undefined ? [] : [key];
  });

export type ValidatorCase =
  | "verified-unl"
  | "with-accounts"
  | "unverified"
  | "pending"
  | "no-domain"
  | "never-seen"
  | "negative-unl"
  | "signing-key"
  | "votes-unknown"
  | "no-fee-vote"
  | "fee-higher"
  | "fee-lower"
  | "incomplete"
  | "no-score"
  | "xahau-build";

const FEES = ["base_fee", "reserve_base", "reserve_inc"] as const;
/** A fee vote above (`1`) or below (`-1`) the fees in force, in one of the three fees at least. */
const feeAgainst = (row: ValidatorRow, summary: ValidatorsSummary, sign: 1 | -1): boolean =>
  row.fee_vote !== undefined && summary.fees !== undefined && FEES.some((fee) => new BigNumber(row.fee_vote![fee]).comparedTo(summary.fees![fee]) === sign);

/** What makes a row of the list a case. `signing-key` and `votes-unknown` are read from the validator files. */
const ROW_CASES: Record<Exclude<ValidatorCase, "signing-key" | "votes-unknown">, (row: ValidatorRow, summary: ValidatorsSummary) => boolean> = {
  // A verified domain without accounts, on every publisher's list, not on the negative UNL.
  "verified-unl": (row, summary) =>
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
  "negative-unl": (row, summary) => row.negative_unl && summary.negative_unl_pending?.to_reenable === row.validation_public_key,
  "no-fee-vote": (row) => row.last_seen !== undefined && row.fee_vote === undefined,
  "fee-higher": (row, summary) => feeAgainst(row, summary, 1),
  "fee-lower": (row, summary) => feeAgainst(row, summary, -1),
  incomplete: (row) => row.last_seen !== undefined && [row.agreement_1h, row.agreement_24h, row.agreement_30d].some((window) => window.incomplete),
  "no-score": (row) => row.last_seen !== undefined && row.agreement_24h.score === undefined,
  "xahau-build": (row) => row.version_build !== undefined,
};

/**
 * The first validator of the list (D1's order) that is the case: its master key, and its domain when it has one. For `signing-key`, the validator whose signing key
 * has a file of its own (D answers it with the master's answer), and that key as `signing`. Throws when the network's fixtures hold no such validator (XRPL has no
 * build numbers, Xahau no unknown amendment to vote on).
 */
export async function validatorCase(net: NetworkId, which: ValidatorCase): Promise<{ key: string; signing?: string; domain?: string }> {
  const rows = await rowsOf(net);
  const found = async (): Promise<{ row: ValidatorRow; signing?: string } | undefined> => {
    if (which === "signing-key") {
      for (const key of fileKeys(net)) {
        const detail = await detailOf(net, key);
        if (detail.validation_public_key !== key) return { row: rows.find((row) => row.validation_public_key === detail.validation_public_key)!, signing: key };
      }
      return undefined;
    }
    if (which === "votes-unknown") {
      // G4: D's votes hold the unknown amendment, with a vote the record makes.
      for (const row of rows) {
        const { amendment_votes } = await detailOf(net, row.validation_public_key);
        if (amendment_votes.votes.some((vote) => vote.status === "unknown" && vote.vote !== "none")) return { row };
      }
      return undefined;
    }
    const summary = await summaryOf(net);
    const row = rows.find((each) => ROW_CASES[which](each, summary));
    return row === undefined ? undefined : { row };
  };
  const match = await found();
  if (match === undefined) throw new Error(`the ${net} fixtures have no ${which} validator`);
  const { row, signing } = match;
  return { key: row.validation_public_key, ...(signing !== undefined && { signing }), ...(row.domain !== undefined && { domain: row.domain }) };
}

/** Every master key that has a validator file, in D1's order: a spec takes a new one for each test that must not meet another's cached answers. */
export async function fixtureValidatorKeys(net: NetworkId): Promise<string[]> {
  const named = new Set(fileKeys(net));
  return (await rowsOf(net)).map((row) => row.validation_public_key).filter((key) => named.has(key));
}

export type AmendmentCase = "majority" | "voting" | "enabled-ledger" | "enabled-metadata" | "obsolete" | "unknown" | "retired";

const AMENDMENT_CASES: Record<AmendmentCase, (row: AmendmentsList["amendments"][number]) => boolean> = {
  majority: (row) => row.status === "majority",
  voting: (row) => row.status === "voting",
  "enabled-ledger": (row) => row.enabled?.source === "ledger",
  "enabled-metadata": (row) => row.enabled?.source === "metadata",
  obsolete: (row) => row.status === "obsolete",
  unknown: (row) => row.status === "unknown",
  retired: (row) => row.retired === true,
};

/** The first amendment of the list (D1's order) that is the case: its ID, and its name when it has one. Throws when the network has none (Xahau: obsolete, unknown; XRPL: retired). */
export async function amendmentCase(net: NetworkId, which: AmendmentCase): Promise<{ id: string; name?: string }> {
  const { amendments } = await read<AmendmentsList>(`${net}/data-api/network/amendments.json`);
  const row = amendments.find(AMENDMENT_CASES[which]);
  if (row === undefined) throw new Error(`the ${net} fixtures have no ${which} amendment`);
  return { id: row.id, ...(row.name !== undefined && { name: row.name }) };
}

/** The validator whose validations have a second page, and the marker of it (the network's one `…/validations@limit=20&marker=<M>.json`). */
export async function validationsMarker(net: NetworkId): Promise<{ key: string; marker: string }> {
  const pattern = new RegExp(`^${net}/data-api/network/validators/([^/]+)/validations@limit=20&marker=([A-Za-z0-9_-]+)\\.json$`);
  const pages = validationFiles.flatMap((path) => {
    const match = pattern.exec(path.slice(ROOT.length));
    return match === null ? [] : [{ key: match[1]!, marker: match[2]! }];
  });
  if (pages.length !== 1) throw new Error(`the ${net} fixtures have ${pages.length} second pages of validations, not one`);
  return pages[0]!;
}
