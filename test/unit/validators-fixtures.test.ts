import BigNumber from "bignumber.js";
import { decodeNodePublic, encodeNodePublic, isValidClassicAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import type { AmendmentStatus } from "../../app/domain/amendments-params";
import type {
  AmendmentDetail,
  AmendmentRow,
  AmendmentsList,
  LastValidated,
  LedgerValidations,
  ValidatorDetail,
  ValidatorRow,
  ValidatorsList,
  ValidatorsSummary,
  ValidatorValidationsPage,
} from "../../app/server/api-types";
import {
  checkAmendmentDetail,
  checkAmendments,
  checkValidatorDetail,
  checkValidatorsList,
  checkValidatorsSummary,
  checkValidatorValidations,
} from "../../app/server/validators-shape";
import { fixtureText, generate, isValidatorsGenerated } from "../../scripts/http-fixtures";
import { amendmentId, VALIDATORS_ROW_LISTS, validatorsFixtures } from "../../scripts/validators-fixtures";
import { dataApiFile, type NetworkName } from "../support/upstream-core";
import {
  AMENDMENT_CASE_RULES,
  AMENDMENT_CASES,
  signingFileOf,
  VALIDATOR_CASE_RULES,
  VALIDATOR_CASES,
  type AmendmentCase,
  type CaseSources,
  type ValidatorCase,
} from "../support/validators-case-rules";

// The answers of D1's six routes that scripts/validators-fixtures.ts makes up (E6 spec, "Testing", "Fixtures"): the rules of data-api-new's docs/api-reference.md at
// feat/explorer-data 7d495ab ("Validators and amendments") are worked out here again from the answers themselves, and checked. The inputs are those `generate()`
// hands over (the newest ledger and the ledger validations of its own map), never the files on disk.

type Net = NetworkName;
const NETS: Net[] = ["xrpl", "xahau"];
const DAY_MS = 86_400_000;

/** D1 §3.5's known pairs (data-api-new packages/shared/src/validators/amendments-config.spec.ts at 7d495ab). */
const AMM_ID = "8CC0774A3BF66D1D22E76BBDA8E8A232E6B6313834301B3B23E8601196AE6455";
const XCB_ID = "C98D98EE9616ACD36E81FDEB8D41D349BF5F1B41DD64A0ABC1FE9AA5EA267E9C";

const generated = generate();

function generatedText(path: string): string {
  const text = generated.get(path);
  if (text === undefined) throw new Error(`generate() writes no ${path}`);
  return text;
}

/** What `generate()` gives the generator for a network: its newest ledger and the validations of its two newest ledgers, from its own map. */
function inputsOf(net: Net): { last: LastValidated; validations: LedgerValidations[] } {
  const validations = [...generated]
    .filter(([path]) => new RegExp(`^${net}/data-api/ledgers/[0-9A-F]{64}/validations@`).test(path))
    .map(([, text]) => JSON.parse(text) as LedgerValidations);
  return { last: JSON.parse(generatedText(`${net}/data-api/last_validated.json`)) as LastValidated, validations };
}

const ANSWERS = Object.fromEntries(NETS.map((net) => [net, validatorsFixtures(net, inputsOf(net).last, inputsOf(net).validations)])) as Record<
  Net,
  ReturnType<typeof validatorsFixtures>
>;

function answer<T>(net: Net, path: string, query = ""): T {
  const found = ANSWERS[net].find((each) => each.path === path && each.query === query);
  if (found === undefined) throw new Error(`${net}: no answer for ${path}?${query}`);
  return found.value as T;
}
const summaryOf = (net: Net) => answer<ValidatorsSummary>(net, "/v2/network/validators/summary");
const listOf = (net: Net) => answer<ValidatorsList>(net, "/v2/network/validators", "limit=1000&scope=all");
const detailOf = (net: Net, key: string) => answer<ValidatorDetail>(net, `/v2/network/validators/${key}`);
const pageOf = (net: Net, key: string, query = "limit=20") => answer<ValidatorValidationsPage>(net, `/v2/network/validators/${key}/validations`, query);
const amendmentsOf = (net: Net) => answer<AmendmentsList>(net, "/v2/network/amendments");
const amendmentOf = (net: Net, ref: string) => answer<AmendmentDetail>(net, `/v2/network/amendments/${ref}`);
/** The validator files: the key a file is named by and its answer. */
const detailFiles = (net: Net) =>
  ANSWERS[net]
    .map((each) => ({ key: /^\/v2\/network\/validators\/(n[^/]+)$/.exec(each.path)?.[1], value: each.value as ValidatorDetail }))
    .filter((each): each is { key: string; value: ValidatorDetail } => each.key !== undefined);
const anchorOf = (net: Net) => Date.parse(inputsOf(net).last.close_time);

// ---- D1's rules, worked out again --------------------------------------------------------------------------------------

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** The validators list's order: those with a domain first, by domain in lower case, then by master key; then the others, by master key. */
function compareRows(a: Pick<ValidatorRow, "domain" | "validation_public_key">, b: Pick<ValidatorRow, "domain" | "validation_public_key">): number {
  if ((a.domain === undefined) !== (b.domain === undefined)) return a.domain === undefined ? 1 : -1;
  if (a.domain !== undefined && b.domain !== undefined) {
    const byDomain = compareText(a.domain.toLowerCase(), b.domain.toLowerCase());
    if (byDomain !== 0) return byDomain;
  }
  return compareText(a.validation_public_key, b.validation_public_key);
}

/** A version as D1 writes it: its numbers, and release 3, release candidate 2, beta 1, with the candidate's or beta's number. */
function versionParts(version: string): { triple: [number, number, number]; stage: number; number: number } {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(rc|b)(\d+))?$/.exec(version);
  if (!match) throw new Error(`not a version: ${version}`);
  return {
    triple: [Number(match[1]), Number(match[2]), Number(match[3])],
    stage: match[4] === "rc" ? 2 : match[4] === "b" ? 1 : 3,
    number: Number(match[5] ?? 0),
  };
}
const compareTriples = (a: number[], b: number[]) => Math.sign(a[0]! - b[0]!) || Math.sign(a[1]! - b[1]!) || Math.sign(a[2]! - b[2]!);
/** Newest first: the higher numbers, then the stage, then the candidate's number. */
function compareVersions(a: string, b: string): number {
  const [x, y] = [versionParts(a), versionParts(b)];
  return compareTriples(y.triple, x.triple) || Math.sign(y.stage - x.stage) || Math.sign(y.number - x.number);
}

/** `sfServerVersion` decoded as D1 does (F3, F4): prefix 0x183B, major, minor, patch, the release byte, and on xahaud the build (the year counting from 2023). */
function decodeServerVersion(raw: string, net: Net): { version: string; build?: number } | undefined {
  const value = BigInt(raw);
  if (value >> 48n !== 0x183bn) return undefined;
  const field = (shift: bigint) => Number((value >> shift) & 0xffn);
  const xahaud = net === "xahau";
  const triple = [field(40n) + (xahaud ? 2023 : 0), field(32n), field(24n)];
  const byte = field(16n);
  const suffix = (byte & 0xc0) === 0x80 ? `-rc${byte & 0x3f}` : (byte & 0xc0) === 0x40 ? `-b${byte & 0x3f}` : "";
  const build = Number(value & 0xffffn);
  return { version: `${triple.join(".")}${suffix}`, ...(xahaud && build !== 0 && { build }) };
}

/** F7: the votes to exceed, max(1, ⌊trusted × 80 / 100⌋); the votes that pass, that + 1 (1 for up to one trusted); whether `yes` carries it. */
const thresholdOf = (trusted: number) => Math.max(1, Math.floor((trusted * 80) / 100));
const neededOf = (trusted: number) => (trusted <= 1 ? 1 : thresholdOf(trusted) + 1);
const passesOf = (yes: number, trusted: number) => (trusted === 1 ? yes >= thresholdOf(trusted) : yes > thresholdOf(trusted));
/** yes / trusted × 100 to two decimals, half up; 0 when nobody is trusted. */
const pctOf = (yes: number, trusted: number) => (trusted <= 0 ? 0 : new BigNumber(yes).times(100).div(trusted).decimalPlaces(2, BigNumber.ROUND_HALF_UP).toNumber());

/** A list's order: majority by expected activation, voting by yes (most first) then name, unknown by ID, enabled by its ledger (newest first, none last) then name, obsolete by name. */
const GROUPS: AmendmentStatus[] = ["majority", "voting", "unknown", "enabled", "obsolete"];
function compareByName(a: AmendmentRow, b: AmendmentRow): number {
  if ((a.name === undefined) !== (b.name === undefined)) return a.name === undefined ? 1 : -1;
  if (a.name !== undefined && b.name !== undefined) {
    const byName = compareText(a.name.toLowerCase(), b.name.toLowerCase()) || compareText(a.name, b.name);
    if (byName !== 0) return byName;
  }
  return compareText(a.id, b.id);
}
function compareAmendments(a: AmendmentRow, b: AmendmentRow): number {
  const group = GROUPS.indexOf(a.status) - GROUPS.indexOf(b.status);
  if (group !== 0) return group;
  if (a.status === "majority") return compareText(a.majority!.expected_activation, b.majority!.expected_activation) || compareByName(a, b);
  if (a.status === "voting") return b.votes!.yes - a.votes!.yes || compareByName(a, b);
  if (a.status === "unknown") return compareText(a.id, b.id);
  if (a.status === "enabled") {
    const [x, y] = [a.enabled?.ledger_index, b.enabled?.ledger_index];
    if ((x === undefined) !== (y === undefined)) return x === undefined ? 1 : -1;
    if (x !== undefined && y !== undefined && x !== y) return y - x;
  }
  return compareByName(a, b);
}

// ---- The cases the pages draw: the rules validators-cases.ts finds them by for the worker specs -----------------------------------------------------

/** What the case rules read beside a row: the summary, and every validator file by the key it is named by. */
const sourcesOf = (net: Net): CaseSources => ({ summary: summaryOf(net), details: new Map(detailFiles(net).map(({ key, value }) => [key, value])) });
/** Xahau has no unknown amendment to vote on, and XRPL no build number. */
const VALIDATOR_CASES_OF: Record<Net, ValidatorCase[]> = {
  xrpl: VALIDATOR_CASES.filter((which) => which !== "xahau-build"),
  xahau: VALIDATOR_CASES.filter((which) => which !== "votes-unknown"),
};
/** Xahau has no obsolete or unknown amendment, and XRPL no retired one. */
const AMENDMENT_CASES_OF: Record<Net, AmendmentCase[]> = {
  xrpl: AMENDMENT_CASES.filter((which) => which !== "retired"),
  xahau: AMENDMENT_CASES.filter((which) => which !== "obsolete" && which !== "unknown"),
};

// ---- The tests ---------------------------------------------------------------------------------------------------------

describe("the synthetic answers of D1's validators and amendments routes", () => {
  it("names AMM and XChainBridge by D1's known IDs", () => {
    expect(amendmentId("AMM")).toBe(AMM_ID);
    expect(amendmentId("XChainBridge")).toBe(XCB_ID);
    for (const net of NETS) {
      for (const row of amendmentsOf(net).amendments) if (row.name !== undefined) expect(row.id, row.name).toBe(amendmentId(row.name));
    }
    expect(amendmentsOf("xrpl").amendments.find((row) => row.name === "AMM")?.id).toBe(AMM_ID);
    expect(amendmentsOf("xrpl").amendments.find((row) => row.name === "XChainBridge")?.id).toBe(XCB_ID);
  });

  it("passes the client's checks, every answer", () => {
    for (const net of NETS) {
      for (const { path, query, value } of ANSWERS[net]) {
        const where = `${path}?${query}`;
        if (path === "/v2/network/validators/summary") expect(() => checkValidatorsSummary(value, where)).not.toThrow();
        else if (path === "/v2/network/validators") expect(() => checkValidatorsList(value, where)).not.toThrow();
        else if (/^\/v2\/network\/validators\/[^/]+\/validations$/.test(path)) expect(() => checkValidatorValidations(value, where)).not.toThrow();
        else if (/^\/v2\/network\/validators\/[^/]+$/.test(path)) expect(() => checkValidatorDetail(value, where)).not.toThrow();
        else if (path === "/v2/network/amendments") expect(() => checkAmendments(value, where)).not.toThrow();
        else if (/^\/v2\/network\/amendments\/[^/]+$/.test(path)) expect(() => checkAmendmentDetail(value, where)).not.toThrow();
        else throw new Error(`an answer of no D1 route: ${where}`);
      }
    }
  });

  it.each(NETS)("%s: every key is a node key and every domain is *.example", (net) => {
    const isKey = (key: string, prefixes: number[]) => {
      const bytes = decodeNodePublic(key);
      return bytes.length === 33 && prefixes.includes(bytes[0]!);
    };
    const toml = net === "xrpl" ? "xrp-ledger.toml" : "xahau.toml";
    for (const row of listOf(net).validators) {
      expect(isKey(row.validation_public_key, [0xed]), row.validation_public_key).toBe(true);
      if (row.signing_key !== undefined) expect(isKey(row.signing_key, [0x02, 0x03]), row.signing_key).toBe(true);
      const detail = detailOf(net, row.validation_public_key);
      expect(detail.manifest?.signing_key).toBe(row.signing_key);
      expect(detail.manifest?.domain).toBe(row.domain);
      if (row.domain === undefined) {
        expect(row.domain_verification).toBeUndefined();
        continue;
      }
      expect(row.domain).toMatch(/^[a-z0-9-]+\.example$/);
      expect(row.domain_verification!.toml_url).toBe(`https://${row.domain}/.well-known/${toml}`);
      for (const account of row.domain_verification!.accounts ?? []) expect(isValidClassicAddress(account), account).toBe(true);
    }
    // No other domain is anywhere in the answers: the votes' domains are the validators', and the publishers are the data API's.
    const publishers = summaryOf(net).unl.publishers.map((publisher) => publisher.id);
    for (const { value } of ANSWERS[net]) {
      for (const [, domain] of JSON.stringify(value).matchAll(/"domain":"([^"]*)"/g)) expect(domain).toMatch(/\.example$/);
      for (const [, host] of JSON.stringify(value).matchAll(/"(?:toml_url|url)":"https:\/\/([^/"]+)/g)) {
        expect(host!.endsWith(".example") || publishers.includes(host!), host).toBe(true);
      }
    }
  });

  it.each(NETS)("%s: the list is in D1's order, and the summary's counts and versions add up from it", (net) => {
    const s = summaryOf(net);
    const rows = listOf(net).validators;
    expect(listOf(net).count).toBe(rows.length);
    expect(listOf(net).marker).toBeUndefined();
    expect(rows.map((row) => row.validation_public_key)).toEqual([...rows].sort(compareRows).map((row) => row.validation_public_key));

    const anchor = anchorOf(net);
    const seen = rows.filter((row) => row.last_seen !== undefined && Date.parse(row.last_seen) >= anchor - DAY_MS);
    const unl = rows.filter((row) => row.unl);
    // scope=all: the trusted UNL, seen or not, and every validator seen in 24 hours.
    expect(rows.every((row) => row.unl || seen.includes(row))).toBe(true);
    const othersSeen = seen.filter((row) => !row.unl).length;
    expect(s.validators).toEqual({ seen_24h: seen.length, unl_seen_24h: seen.length - othersSeen, others_seen_24h: othersSeen, all: unl.length + othersSeen });
    expect(s.unl.trusted).toBe(unl.length);
    expect(s.unl.trusted).toBe(net === "xrpl" ? 35 : 31);
    expect(rows.length - unl.length).toBe(net === "xrpl" ? 25 : 10);

    // The publishers: what each list names, and how many of those were seen.
    for (const publisher of s.unl.publishers) {
      const named = rows.filter((row) => row.unl_lists.includes(publisher.id));
      expect(publisher.validators, publisher.id).toBe(named.length);
      expect(publisher.seen_24h, publisher.id).toBe(named.filter((row) => seen.includes(row)).length);
    }
    expect(s.unl.publishers.map((publisher) => publisher.id)).toEqual(net === "xrpl" ? ["unl.xrplf.org", "vl.ripple.com"] : ["vl.xahau.org"]);
    for (const row of rows) expect(row.unl, row.validation_public_key).toBe(row.unl_lists.length >= (s.unl.threshold ?? 1));

    // The negative UNL, its pending change and the quorum: max(⌈0.8 × (unl − negative)⌉, ⌈0.6 × unl⌉).
    const negative = rows.filter((row) => row.negative_unl);
    expect(s.negative_unl.map((member) => member.validation_public_key)).toEqual(negative.map((row) => row.validation_public_key));
    expect(s.negative_unl.every((member) => member.first_ledger % 256 === 0 && member.first_ledger < s.ledger_index!)).toBe(true);
    const onUnl = negative.filter((row) => row.unl).length;
    expect(s.quorum).toMatchObject({ unl_size: unl.length, negative_unl: onUnl, value: Math.max(Math.ceil((4 * (unl.length - onUnl)) / 5), Math.ceil((3 * unl.length) / 5)) });

    // The versions: of the trusted validators (`unl`) and of those seen in 24 hours (`all`), newest first; the rest are unknown.
    const counts = new Map<string, { unl: number; all: number }>();
    const unknown = { unl: 0, all: 0 };
    const count = (list: ValidatorRow[], field: "unl" | "all") => {
      for (const row of list) {
        if (row.version === undefined) unknown[field] += 1;
        else counts.set(row.version, { ...(counts.get(row.version) ?? { unl: 0, all: 0 }), [field]: (counts.get(row.version)?.[field] ?? 0) + 1 });
      }
    };
    count(unl, "unl");
    count(seen, "all");
    expect(s.versions).toEqual([...counts].sort(([a], [b]) => compareVersions(a, b)).map(([version, n]) => ({ version, ...n })));
    expect(s.versions_unknown).toEqual(unknown);
    const releases = unl.flatMap((row) => (row.version !== undefined && versionParts(row.version).stage === 3 ? [row.version] : [])).sort(compareVersions);
    expect(s.latest_version).toBe(releases[0]);
    for (const row of rows) {
      if (row.version === undefined) expect(row.version_latest).toBeUndefined();
      else expect(row.version_latest, row.validation_public_key).toBe(compareTriples(versionParts(row.version).triple, versionParts(s.latest_version!).triple) >= 0);
      if (row.server_version !== undefined) {
        const decoded = decodeServerVersion(row.server_version, net);
        expect(decoded?.version, row.server_version).toBe(row.version);
        expect(decoded?.build).toBe(row.version_build);
      }
    }

    // The newest ledger and the next flag ledger.
    expect(String(s.ledger_index)).toBe(inputsOf(net).last.ledger_index);
    expect(s.close_time).toBe(inputsOf(net).last.close_time);
    expect(s.next_flag_ledger!.ledger_index).toBe((Math.floor(s.ledger_index! / 256) + 1) * 256);
    expect(s.next_flag_ledger!.voting_ledger).toBe(s.next_flag_ledger!.ledger_index - 1);
    expect(s.votes_through_ledger).toBe(amendmentsOf(net).round!.ledger_index);

    // Each row's answer: the row, with the votes on every amendment being decided, its manifest and its 30 days; and its newest validations.
    for (const row of rows) {
      const { amendment_votes: votes, manifest, daily_agreement: days, result, ...rest } = detailOf(net, row.validation_public_key);
      const { amendment_votes: rowVotes, ...rowRest } = row;
      expect(rest, row.validation_public_key).toEqual(rowRest);
      expect(result).toBe("success");
      expect(votes.yes).toEqual(rowVotes?.yes ?? []);
      expect(votes.ledger_index).toBe(rowVotes?.ledger_index);
      expect(manifest!.sequence).toBeGreaterThanOrEqual(manifest!.signing_keys_seen);
      expect(days).toHaveLength(30);
      const page = pageOf(net, row.validation_public_key);
      expect(page.validation_public_key).toBe(row.validation_public_key);
      if (row.last_seen === undefined) expect(page.validations).toEqual([]);
      else expect(page.validations).toHaveLength(20);
      if (row.current_index !== undefined) {
        expect(page.validations[0]!.ledger_index).toBe(row.current_index);
        expect(row.partial).toBe(!page.validations[0]!.full);
        expect(row.last_seen).toBe(page.validations[0]!.last_datetime);
      }
    }
  });

  it.each(NETS)("%s: holds every validator case, by the rules the worker specs find them by", (net) => {
    const sources = sourcesOf(net);
    for (const which of VALIDATOR_CASES_OF[net]) {
      expect(listOf(net).validators.some((row) => VALIDATOR_CASE_RULES[which](row, sources)), which).toBe(true);
    }
    // The signing-key case names the one signing key that has a file; the others are cases of none.
    const signing = listOf(net).validators.filter((row) => VALIDATOR_CASE_RULES["signing-key"](row, sources));
    expect(signing.map((row) => signingFileOf(row, sources))).toEqual([signing[0]!.signing_key]);
    for (const which of VALIDATOR_CASES.filter((each) => !VALIDATOR_CASES_OF[net].includes(each))) {
      expect(listOf(net).validators.some((row) => VALIDATOR_CASE_RULES[which](row, sources)), which).toBe(false);
    }
  });

  it.each(NETS)("%s: holds every amendment case, by the same rules", (net) => {
    for (const which of AMENDMENT_CASES) {
      expect(amendmentsOf(net).amendments.some(AMENDMENT_CASE_RULES[which]), which).toBe(AMENDMENT_CASES_OF[net].includes(which));
    }
  });

  it.each(NETS)("%s: pages a validator's validations: one second page, after the first page's last row, with every state", (net) => {
    const pages = ANSWERS[net].filter((each) => /\/validations$/.test(each.path) && each.query.includes("marker="));
    expect(pages).toHaveLength(1);
    const key = /^\/v2\/network\/validators\/([^/]+)\/validations$/.exec(pages[0]!.path)![1]!;
    const first = pageOf(net, key);
    const last = first.validations.at(-1)!;
    expect(first.marker).toBe(Buffer.from(JSON.stringify([last.ledger_index, last.ledger_hash])).toString("base64url"));
    expect(pages[0]!.query).toBe(`limit=20&marker=${first.marker}`);
    for (const row of listOf(net).validators) if (row.validation_public_key !== key) expect(pageOf(net, row.validation_public_key).marker).toBeUndefined();

    const second = pages[0]!.value as ValidatorValidationsPage;
    expect(second.marker).toBeUndefined();
    expect(second.count).toBe(second.validations.length);
    expect(second.validations).toHaveLength(20);
    expect(second.validations[0]!.ledger_index).toBeLessThan(last.ledger_index);
    expect(second.validations[0]!.validated).toBe("unknown");
    const different = second.validations.filter((row) => row.validated === "different");
    expect(different).toHaveLength(1);
    // A fork: the same ledger signed twice, the indexed hash `matches` and is named as the other's `validated_hash`.
    const twin = second.validations.filter((row) => row.ledger_index === different[0]!.ledger_index && row !== different[0]);
    expect(twin.map((row) => [row.validated, row.ledger_hash])).toEqual([["matches", different[0]!.validated_hash]]);
    expect(second.validations.filter((row) => !row.full)).toHaveLength(1);
    expect(second.validations.filter((row) => row.validated === "matches")).toHaveLength(18);
    // Newest first; the two rows of a ledger in the order of the hash, as the page is.
    const keys = second.validations.map((row) => [row.ledger_index, row.ledger_hash] as const);
    expect(keys).toEqual([...keys].sort(([i, h], [j, g]) => j - i || compareText(g, h)));
    // The newest recorded ledger is matched by its own hash.
    const head = Number(inputsOf(net).last.ledger_index);
    for (const row of listOf(net).validators) {
      for (const validation of pageOf(net, row.validation_public_key).validations) {
        if (validation.ledger_index === head) expect(validation.ledger_hash).toBe(inputsOf(net).last.ledger_hash);
        expect(validation.validated_hash === undefined).toBe(validation.validated !== "different");
      }
    }
  });

  it("XRPL's majority amendment has 2,500 to 2,700 rounds and a got/lost/got history", () => {
    const row = amendmentsOf("xrpl").amendments.find((each) => each.status === "majority")!;
    expect(row.name).toBe("MPTokensV1");
    const detail = amendmentOf("xrpl", "MPTokensV1");
    expect(detail.rounds.length).toBeGreaterThanOrEqual(2_500);
    expect(detail.rounds.length).toBeLessThanOrEqual(2_700);
    expect(detail.history.map((event) => event.event)).toEqual(["got_majority", "lost_majority", "got_majority"]);
    // Each event is in the ledger after the flag ledger of the round that changed it: passing, failing, passing.
    const runs = detail.rounds.filter((round, at) => at === 0 || round.passes !== detail.rounds[at - 1]!.passes);
    expect(runs.map((round) => round.passes)).toEqual([false, true, false, true]);
    expect(detail.history.map((event) => event.ledger_index)).toEqual(runs.slice(1).map((round) => round.flag_ledger + 1));
    const got = detail.history.at(-1)!;
    expect(detail.majority).toEqual({
      since: got.date,
      ledger_index: got.ledger_index,
      tx_hash: got.tx_hash,
      expected_activation: new Date(Date.parse(got.date) + 1_209_600_000).toISOString().replace(".000Z", "Z"),
    });
    // The majority was got 10 days before the newest ledger, so it activates in 4.
    const anchor = anchorOf("xrpl");
    expect(Math.round((anchor - Date.parse(got.date)) / DAY_MS)).toBe(10);
    expect(Math.round((Date.parse(detail.majority!.expected_activation) - anchor) / DAY_MS)).toBe(4);
  });

  it.each(NETS)("%s: a tally holds from round to round, with a handful of changes in its rounds (spec 6.3 and 7)", (net) => {
    // A validator changes its vote, or misses a round, now and then: the yes-votes chart is a few steps and its table of changes a few rows. The 30 days of
    // XRPL's majority, about 2,600 rounds, change at the runs of its got/lost/got history and little more.
    const withRounds = amendmentsOf(net).amendments.map((row) => ({ row, rounds: amendmentOf(net, row.name ?? row.id).rounds })).filter(({ rounds }) => rounds.length > 0);
    expect(withRounds.length).toBeGreaterThan(0);
    for (const { row, rounds } of withRounds) {
      const changes = rounds.filter((round, at) => at > 0 && round.yes !== rounds[at - 1]!.yes).length;
      expect(changes, row.name ?? row.id).toBeLessThanOrEqual(row.status === "majority" && rounds.length > 1_000 ? 10 : 6);
    }
  });

  it("Xahau's majority amendment has no majority.ledger_index or tx_hash", () => {
    const detail = amendmentOf("xahau", "Remit");
    expect(detail.status).toBe("majority");
    expect(Object.keys(detail.majority!)).toEqual(["since", "expected_activation"]);
    expect(Date.parse(detail.majority!.expected_activation) - Date.parse(detail.majority!.since)).toBe(432_000_000);
    expect(Date.parse(detail.majority!.expected_activation)).toBeGreaterThan(anchorOf("xahau"));
    expect(detail.history).toEqual([]);
    expect(detail.rounds.length).toBeGreaterThan(0);
    // Xahau writes `introduced` as xahaud's date versions.
    for (const row of amendmentsOf("xahau").amendments) expect(row.introduced, row.name).toMatch(/^20\d\d\.\d{1,2}\.\d{1,2}$/);
  });

  it.each(NETS)("%s: needed, passes, pct, counts and A's order obey D1's rules", (net) => {
    const a = amendmentsOf(net);
    const round = a.round!;
    expect(round.threshold).toBe(thresholdOf(round.trusted));
    expect(round.needed).toBe(neededOf(round.trusted));
    expect(round.ledger_index % 256).toBe(255);
    expect(a.rules).toEqual({ threshold_percent: 80, majority_hold_seconds: net === "xrpl" ? 1_209_600 : 432_000, flag_interval: 256 });
    expect(a.next_flag_ledger).toEqual(summaryOf(net).next_flag_ledger);
    expect(a.ledger_index).toBe(summaryOf(net).ledger_index);
    expect(a.count).toBe(a.amendments.length);
    expect(a.counts).toEqual(Object.fromEntries(["enabled", "majority", "voting", "obsolete", "unknown"].map((status) => [status, a.amendments.filter((row) => row.status === status).length])));
    expect(a.amendments.map((row) => row.id)).toEqual([...a.amendments].sort(compareAmendments).map((row) => row.id));
    expect(a.amendments.map((row) => row.status)).toEqual(
      net === "xrpl"
        ? ["majority", "voting", "voting", "voting", "unknown", "enabled", "enabled", "enabled", "obsolete"]
        : ["majority", "voting", "enabled", "enabled", "enabled"],
    );

    const rows = listOf(net).validators;
    for (const row of a.amendments) {
      const detail = amendmentOf(net, row.id);
      const undecided = row.status === "majority" || row.status === "voting" || row.status === "unknown";
      if (undecided) {
        expect(row.votes, row.id).toEqual({ ledger_index: round.ledger_index, yes: row.votes!.yes, trusted: round.trusted, needed: round.needed, pct: pctOf(row.votes!.yes, round.trusted) });
        expect(passesOf(row.votes!.yes, round.trusted), row.id).toBe(row.status === "majority");
      } else expect(row.votes, row.id).toBeUndefined();
      expect(row.majority !== undefined, row.id).toBe(row.status === "majority");
      if (row.status === "unknown") expect(row.name).toBeUndefined();
      if (row.retired) expect(row.status).toBe("enabled");

      // The rounds: voting ledgers, oldest first, each with its own F7.
      for (const [at, point] of detail.rounds.entries()) {
        expect(point.ledger_index % 256, row.id).toBe(255);
        expect(point.flag_ledger).toBe(point.ledger_index + 1);
        expect(point.threshold).toBe(thresholdOf(point.trusted));
        expect(point.passes).toBe(passesOf(point.yes, point.trusted));
        expect(point.yes).toBeLessThanOrEqual(point.trusted);
        if (at > 0) {
          expect(point.ledger_index).toBe(detail.rounds[at - 1]!.ledger_index + 256);
          expect(Date.parse(point.date)).toBeGreaterThan(Date.parse(detail.rounds[at - 1]!.date));
        }
      }
      if (undecided) {
        expect(detail.rounds.at(-1), row.id).toMatchObject({ ledger_index: round.ledger_index, date: round.date, yes: row.votes!.yes, trusted: round.trusted });
      }
      if (row.status === "enabled") {
        for (const point of detail.rounds) expect(point.ledger_index).toBeLessThan(row.enabled?.ledger_index ?? -1);
      }
      if (row.enabled?.source === "ledger") expect(detail.history.at(-1)).toEqual({ event: "enabled", ledger_index: row.enabled.ledger_index, date: row.enabled.date, tx_hash: row.enabled.tx_hash });

      // The votes: every member of the round's UNL as its counted record says, then the others seen with a record, both in the list's order.
      expect(detail.unl_votes).toHaveLength(round.unl_size);
      expect(detail.unl_votes.map((vote) => vote.validation_public_key)).toEqual(rows.filter((each) => each.unl).map((each) => each.validation_public_key));
      expect(detail.unl_votes.filter((vote) => vote.vote === "none")).toHaveLength(round.unl_size - round.trusted);
      if (undecided) expect(detail.unl_votes.filter((vote) => vote.vote === "yes"), row.id).toHaveLength(row.votes!.yes);
      expect(detail.other_votes.map((vote) => vote.validation_public_key)).toEqual(
        rows.filter((each) => !each.unl && each.amendment_votes !== undefined).map((each) => each.validation_public_key),
      );
      expect(detail.other_votes.every((vote) => vote.vote !== "none")).toBe(true);
      for (const vote of [...detail.unl_votes, ...detail.other_votes]) {
        const of = rows.find((each) => each.validation_public_key === vote.validation_public_key)!;
        expect(vote.domain).toBe(of.domain);
        expect(vote.version).toBe(of.version);
        expect(vote.last_seen).toBe(of.last_seen);
        const supports = of.version === undefined || row.introduced === undefined ? undefined : compareTriples(versionParts(of.version).triple, versionParts(row.introduced).triple) >= 0;
        expect(vote.version_supports, `${row.id} ${vote.validation_public_key}`).toBe(supports);
        // A validator votes only for what its software knows.
        if (supports === false) expect(vote.vote).not.toBe("yes");
        const recorded = of.amendment_votes?.yes.some((yes) => yes.id === row.id);
        if (vote.vote !== "none") expect(vote.vote === "yes").toBe(recorded);
      }
    }
    // A validator's votes on what is being decided are A's in its order, as its record says.
    for (const row of rows) {
      const votes = detailOf(net, row.validation_public_key).amendment_votes;
      const decided = a.amendments.filter((each) => each.status === "majority" || each.status === "voting" || each.status === "unknown");
      expect(votes.votes.map((vote) => vote.id)).toEqual(decided.map((each) => each.id));
      for (const vote of votes.votes) {
        expect(vote.vote).toBe(row.amendment_votes === undefined ? "none" : votes.yes.some((yes) => yes.id === vote.id) ? "yes" : "no");
        expect(vote.name).toBe(decided.find((each) => each.id === vote.id)!.name);
      }
      for (const yes of votes.yes) expect(yes.name).toBe(a.amendments.find((each) => each.id === yes.id)!.name);
    }
  });

  it.each(NETS)("%s: every amendment file carries A's envelope", (net) => {
    const { ledger_index, rules, round, next_flag_ledger, amendments } = amendmentsOf(net);
    const files = ANSWERS[net].filter((each) => /^\/v2\/network\/amendments\/[^/]+$/.test(each.path));
    expect(files).toHaveLength(amendments.reduce((sum, row) => sum + (row.name === undefined ? 1 : 2), 0));
    for (const row of amendments) {
      const detail = amendmentOf(net, row.id);
      const { unl_votes, other_votes, rounds, history, result, ...rest } = detail;
      expect(rest).toEqual({ ledger_index, rules, round, next_flag_ledger, ...row });
      expect(result).toBe("success");
      // D1 answers a name and an ID alike: the two files are one answer.
      if (row.name !== undefined) expect(amendmentOf(net, row.name)).toEqual(detail);
    }
  });

  it("writes every object's keys in the reference's order", () => {
    for (const net of NETS) {
      for (const { path, value } of ANSWERS[net]) {
        if (path === "/v2/network/validators/summary") keysOfSummary(value as ValidatorsSummary);
        else if (path === "/v2/network/validators") {
          ordered(value, KEYS.validatorsAnswer, path);
          for (const row of (value as ValidatorsList).validators) keysOfRow(row, false, path);
        } else if (/\/validations$/.test(path)) {
          ordered(value, KEYS.validationsAnswer, path);
          for (const row of (value as ValidatorValidationsPage).validations) ordered(row, KEYS.validation, path);
        } else if (path.startsWith("/v2/network/validators/")) keysOfRow(value as ValidatorDetail, true, path);
        else if (path === "/v2/network/amendments") {
          const list = value as AmendmentsList;
          ordered(list, KEYS.amendmentsAnswer, path);
          keysOfEnvelope(list, path);
          ordered(list.counts, KEYS.counts, path);
          for (const row of list.amendments) keysOfAmendment(row, KEYS.amendment, path);
        } else {
          const detail = value as AmendmentDetail;
          keysOfAmendment(detail, KEYS.amendmentAnswer, path);
          keysOfEnvelope(detail, path);
          for (const vote of [...detail.unl_votes, ...detail.other_votes]) ordered(vote, KEYS.unlVote, path);
          for (const point of detail.rounds) ordered(point, KEYS.roundPoint, path);
          for (const event of detail.history) ordered(event, KEYS.history, path);
        }
      }
    }
  });

  it.each(NETS)("%s: the signing key's file answers its master", (net) => {
    const signing = detailFiles(net).filter((file) => file.key !== file.value.validation_public_key);
    expect(signing).toHaveLength(1);
    const { key, value } = signing[0]!;
    expect(value).toEqual(detailOf(net, value.validation_public_key));
    expect(value.signing_key).toBe(key);
    expect(value.manifest!.signing_keys_seen).toBeGreaterThan(1);
  });

  it("has a validator file for every key of E2's ledger validations fixtures", () => {
    for (const net of NETS) {
      const keys = new Set(inputsOf(net).validations.flatMap((body) => body.validations.map((validation) => validation.validation_public_key)));
      expect(keys.size).toBe(net === "xrpl" ? 35 : 25);
      for (const key of keys) {
        expect(generated.has(`${net}/data-api/network/validators/${key}.json`), key).toBe(true);
        expect(generated.has(`${net}/data-api/network/validators/${key}/validations@limit=20.json`), key).toBe(true);
      }
      // generate() writes each answer as it is, a row of a list to a line, and nothing else under the D1 routes.
      for (const { path, query, value } of ANSWERS[net]) expect(generatedText(dataApiFile(net, path, query)!)).toBe(fixtureText(value, VALIDATORS_ROW_LISTS));
      const written = new Set(ANSWERS[net].map((each) => dataApiFile(net, each.path, each.query)));
      expect(written.size).toBe(ANSWERS[net].length);
      expect([...generated.keys()].filter((path) => path.startsWith(`${net}/`) && isValidatorsGenerated(path)).sort()).toEqual([...written].sort());
    }
  });

  it("gives the same output for the same input, whatever order the files are written in", () => {
    for (const net of NETS) {
      const { last, validations } = inputsOf(net);
      expect(validatorsFixtures(net, last, validations)).toEqual(ANSWERS[net]);
      expect(validatorsFixtures(net, last, [...validations].reverse())).toEqual(ANSWERS[net]);
    }
    // The keys come from the validations it is given, not from the disk: more keys than the fleet has places for make more validators.
    const { last, validations } = inputsOf("xahau");
    const extra = Array.from({ length: 30 }, (_, at) => encodeNodePublic(Uint8Array.from([0xed, ...Array.from({ length: 32 }, () => at + 1)])));
    const body: LedgerValidations = {
      ...validations[0]!,
      validations: [...validations[0]!.validations, ...extra.map((key) => ({ ...validations[0]!.validations[0]!, validation_public_key: key }))],
    };
    const grown = validatorsFixtures("xahau", last, [body]);
    const rows = (grown.find((each) => each.path === "/v2/network/validators")!.value as ValidatorsList).validators;
    for (const key of [...extra, ...validations[0]!.validations.map((validation) => validation.validation_public_key)]) {
      expect(grown.some((each) => each.path === `/v2/network/validators/${key}`), key).toBe(true);
    }
    expect(rows.filter((row) => row.unl)).toHaveLength(31);
    expect(rows.length).toBeGreaterThan(41);
  });
});

// ---- Key orders --------------------------------------------------------------------------------------------------------

/**
 * The order of the keys of every object of the answers, copied from data-api-new docs/api-reference.md at 7d495ab ("Validators and amendments"): its "Keys of …,
 * in order" lines, and for the objects that have none (the summary's parts, `rules`, `counts`) the order of its examples.
 */
const ROW = [
  "validation_public_key",
  "domain",
  "current_index",
  "agreement_1h",
  "agreement_24h",
  "partial",
  "unl",
  "agreement_30d",
  "signing_key",
  "domain_verification",
  "unl_lists",
  "negative_unl",
  "version",
  "version_build",
  "version_latest",
  "server_version",
  "fee_vote",
  "amendment_votes",
  "first_seen",
  "last_seen",
];
const AMENDMENT = ["id", "name", "status", "retired", "introduced", "xls", "xls_url", "description", "node_supported", "votes", "majority", "enabled"];
const KEYS = {
  summary: [
    "result",
    "ledger_index",
    "close_time",
    "validators",
    "unl",
    "quorum",
    "negative_unl",
    "negative_unl_pending",
    "fees",
    "next_flag_ledger",
    "latest_version",
    "versions",
    "versions_unknown",
    "agreement_through",
    "votes_through_ledger",
    "updated",
  ],
  publisher: ["id", "url", "public_key", "status", "sequence", "version", "expiration", "fetched", "validators", "seen_24h", "last_error", "last_error_at"],
  summaryValidators: ["seen_24h", "unl_seen_24h", "others_seen_24h", "all"],
  unl: ["trusted", "threshold", "publishers"],
  quorum: ["value", "unl_size", "negative_unl", "node"],
  negativeUnl: ["validation_public_key", "first_ledger"],
  negativeUnlPending: ["to_disable", "to_reenable"],
  fees: ["base_fee", "reserve_base", "reserve_inc"],
  nextFlagLedger: ["ledger_index", "voting_ledger", "expected"],
  version: ["version", "unl", "all"],
  versionsUnknown: ["unl", "all"],
  validatorsAnswer: ["result", "count", "marker", "validators"],
  row: ROW,
  detail: [...ROW, "manifest", "daily_agreement", "result"],
  agreement: ["missed", "total", "score", "incomplete", "partial"],
  domainVerification: ["status", "reason", "status_code", "toml_url", "checked", "verified", "accounts"],
  feeVote: ["ledger_index", "base_fee", "reserve_base", "reserve_inc"],
  rowVotes: ["ledger_index", "yes"],
  yes: ["id", "name"],
  detailVotes: ["ledger_index", "yes", "votes"],
  vote: ["id", "name", "status", "vote"],
  manifest: ["sequence", "signing_key", "signing_keys_seen", "domain"],
  daily: ["date", "missed", "total", "score", "incomplete", "partial"],
  validationsAnswer: ["result", "validation_public_key", "count", "marker", "validations"],
  validation: ["ledger_index", "ledger_hash", "validated", "validated_hash", "full", "signing_key", "signing_time", "first_datetime", "last_datetime", "count"],
  amendmentsAnswer: ["result", "ledger_index", "rules", "round", "next_flag_ledger", "counts", "count", "amendments"],
  rules: ["threshold_percent", "majority_hold_seconds", "flag_interval"],
  round: ["ledger_index", "date", "unl_size", "trusted", "threshold", "needed", "observed"],
  counts: ["enabled", "majority", "voting", "obsolete", "unknown"],
  amendment: AMENDMENT,
  votes: ["ledger_index", "yes", "trusted", "needed", "pct"],
  majority: ["since", "ledger_index", "tx_hash", "expected_activation"],
  enabled: ["ledger_index", "date", "tx_hash", "source"],
  amendmentAnswer: ["ledger_index", "rules", "round", "next_flag_ledger", ...AMENDMENT, "unl_votes", "other_votes", "rounds", "history", "result"],
  unlVote: ["validation_public_key", "domain", "vote", "version", "version_supports", "last_seen"],
  roundPoint: ["ledger_index", "flag_ledger", "date", "yes", "trusted", "threshold", "passes"],
  history: ["event", "ledger_index", "date", "tx_hash"],
} as const;

/** The keys of `value` are some of `order`'s, in its order. */
function ordered(value: unknown, order: readonly string[], where: string): void {
  const keys = Object.keys(value as object);
  expect(
    keys.filter((key) => !order.includes(key)),
    `${where}: keys the reference does not name`,
  ).toEqual([]);
  const places = keys.map((key) => order.indexOf(key));
  expect(places, `${where}: ${keys.join(", ")}`).toEqual([...places].sort((a, b) => a - b));
}

function keysOfSummary(s: ValidatorsSummary): void {
  const where = "summary";
  ordered(s, KEYS.summary, where);
  ordered(s.validators, KEYS.summaryValidators, where);
  ordered(s.unl, KEYS.unl, where);
  for (const publisher of s.unl.publishers) ordered(publisher, KEYS.publisher, where);
  ordered(s.quorum, KEYS.quorum, where);
  for (const member of s.negative_unl) ordered(member, KEYS.negativeUnl, where);
  if (s.negative_unl_pending) ordered(s.negative_unl_pending, KEYS.negativeUnlPending, where);
  if (s.fees) ordered(s.fees, KEYS.fees, where);
  if (s.next_flag_ledger) ordered(s.next_flag_ledger, KEYS.nextFlagLedger, where);
  for (const version of s.versions) ordered(version, KEYS.version, where);
  ordered(s.versions_unknown, KEYS.versionsUnknown, where);
}

function keysOfRow(row: ValidatorRow | ValidatorDetail, detail: boolean, where: string): void {
  ordered(row, detail ? KEYS.detail : KEYS.row, where);
  for (const window of [row.agreement_1h, row.agreement_24h, row.agreement_30d]) ordered(window, KEYS.agreement, where);
  if (row.domain_verification) ordered(row.domain_verification, KEYS.domainVerification, where);
  if (row.fee_vote) ordered(row.fee_vote, KEYS.feeVote, where);
  if (row.amendment_votes) {
    ordered(row.amendment_votes, detail ? KEYS.detailVotes : KEYS.rowVotes, where);
    for (const yes of row.amendment_votes.yes) ordered(yes, KEYS.yes, where);
  }
  if (!detail) return;
  const answer = row as ValidatorDetail;
  for (const vote of answer.amendment_votes.votes) ordered(vote, KEYS.vote, where);
  if (answer.manifest) ordered(answer.manifest, KEYS.manifest, where);
  for (const day of answer.daily_agreement) ordered(day, KEYS.daily, where);
}

function keysOfEnvelope(envelope: AmendmentsList | AmendmentDetail, where: string): void {
  ordered(envelope.rules, KEYS.rules, where);
  if (envelope.round) ordered(envelope.round, KEYS.round, where);
  if (envelope.next_flag_ledger) ordered(envelope.next_flag_ledger, KEYS.nextFlagLedger, where);
}

function keysOfAmendment(row: AmendmentRow, order: readonly string[], where: string): void {
  ordered(row, order, where);
  if (row.votes) ordered(row.votes, KEYS.votes, where);
  if (row.majority) ordered(row.majority, KEYS.majority, where);
  if (row.enabled) ordered(row.enabled, KEYS.enabled, where);
}
