// The validators and amendments of the synthetic D1 fixtures (scripts/validators-fixtures.ts, `pnpm fixtures:sync`) that the worker specs need: a validator or an
// amendment of each case the pages draw, every validator key that has a file (for specs that need a new key per test), and the one second page of validations. Each
// case is found in the files' data by its rule in validators-case-rules.ts (the rules the fixtures test checks the generator with), never from a table of keys, so a
// change of the generator's seeds moves nothing here. Read from the fixture files themselves (Vite bundles them, as ledger-hashes.ts does), not through the client under test.

import type { AmendmentsList, ValidatorDetail, ValidatorsList, ValidatorsSummary } from "../../app/server/api-types";
import type { NetworkId } from "../../app/server/networks";
import {
  AMENDMENT_CASE_RULES,
  signingFileOf,
  VALIDATOR_CASE_RULES,
  type AmendmentCase,
  type CaseSources,
  type ValidatorCase,
} from "./validators-case-rules";

export type { AmendmentCase, ValidatorCase } from "./validators-case-rules";

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

/** The summary and every validator file of a network, which the rules read beside a row. */
async function sourcesOf(net: NetworkId): Promise<CaseSources> {
  const [summary, details] = await Promise.all([
    summaryOf(net),
    Promise.all(fileKeys(net).map(async (key) => [key, await detailOf(net, key)] as const)),
  ]);
  return { summary, details: new Map(details) };
}

/**
 * The first validator of the list (D1's order) that is the case: its master key, and its domain when it has one. For `signing-key`, the validator whose signing key
 * has a file of its own (D answers it with the master's answer), and that key as `signing`. Throws when the network's fixtures hold no such validator (XRPL has no
 * build numbers, Xahau no unknown amendment to vote on).
 */
export async function validatorCase(net: NetworkId, which: ValidatorCase): Promise<{ key: string; signing?: string; domain?: string }> {
  const [rows, sources] = await Promise.all([rowsOf(net), sourcesOf(net)]);
  const row = rows.find((each) => VALIDATOR_CASE_RULES[which](each, sources));
  if (row === undefined) throw new Error(`the ${net} fixtures have no ${which} validator`);
  const signing = which === "signing-key" ? signingFileOf(row, sources) : undefined;
  return { key: row.validation_public_key, ...(signing !== undefined && { signing }), ...(row.domain !== undefined && { domain: row.domain }) };
}

/** D's answer for `key` as the fixtures hold it (what the pages are drawn from): for a spec that checks a figure of the page against its source. */
export const fixtureValidator = (net: NetworkId, key: string): Promise<ValidatorDetail> => detailOf(net, key);

/** Every master key that has a validator file, in D1's order: a spec takes a new one for each test that must not meet another's cached answers. */
export async function fixtureValidatorKeys(net: NetworkId): Promise<string[]> {
  const named = new Set(fileKeys(net));
  return (await rowsOf(net)).map((row) => row.validation_public_key).filter((key) => named.has(key));
}

/** The first amendment of the list (D1's order) that is the case: its ID, and its name when it has one. Throws when the network has none (Xahau: obsolete, unknown; XRPL: retired). */
export async function amendmentCase(net: NetworkId, which: AmendmentCase): Promise<{ id: string; name?: string }> {
  const { amendments } = await read<AmendmentsList>(`${net}/data-api/network/amendments.json`);
  const row = amendments.find(AMENDMENT_CASE_RULES[which]);
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
