// What the specs of the MPT pages share (mpt.spec.ts, tokens.spec.ts, a11y.spec.ts's block of them, og.spec.ts and client-meta.spec.ts): the answers of the data API the fixtures hold for an issuance, its holders, its transfers and the
// MPT tab, read back from their files, so that a figure or a count a spec expects is the fixtures' and not a number written here. The issuances and the recorded transactions are named in test/support/mpt-case-rules.ts (pure
// literals, listed by tsconfig.e2e.json); the answers are D9's, generated around the recordings (test/fixtures/PROVENANCE.md, "MPT answers"; scripts/mpt-fixtures.ts). The Worker's specs read the same files through
// `import.meta.glob`, which only Vite knows, so the Playwright process reads them itself, with Node's `fs`. XRPL only: Xahau has no MPT and no file.

import { readFileSync } from "node:fs";

import type { MptHoldersPage, MptIssuance, MptIssuanceAnswer, MptTokensPage, MptTransfersPage } from "../../app/server/api-types";

const ROOT = new URL("../fixtures/http/xrpl/data-api/", import.meta.url);

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, ROOT), "utf8")) as T;

/** The issuance the index holds for `id` (`mpt/<ID>.json`): what `GET /v2/mpt/{ID}` answers. Throws for an issuance the index does not have (`nodeOnly` and `nowhere` have no file). */
export const issuanceOf = (id: string): MptIssuance => read<MptIssuanceAnswer>(`mpt/${id}.json`).issuance;

/** A page of an issuance's holders (`mpt/<ID>/holders@limit=<limit>[&marker=<M>].json`): the top ten of its page (`limit: 10`), or the 50 of its holders' page and, behind its marker, the rest. */
export const holdersOf = (id: string, { limit, marker }: { limit: 10 | 50; marker?: string }): MptHoldersPage =>
  read<MptHoldersPage>(`mpt/${id}/holders@limit=${limit}${marker === undefined ? "" : `&marker=${marker}`}.json`);

/** A page of an issuance's transfers, newest first (`mpt/<ID>/transfers@descending=true&limit=<limit>[&marker=<M>].json`): the eight of its page (`limit: 8`), or the 20 of its transfers' page and, behind its marker, the rest. */
export const transfersOf = (id: string, { limit, marker }: { limit: 8 | 20; marker?: string }): MptTransfersPage =>
  read<MptTransfersPage>(`mpt/${id}/transfers@descending=true&limit=${limit}${marker === undefined ? "" : `&marker=${marker}`}.json`);

/**
 * The MPT tab's answer the fixtures hold for a view (E14 spec 4; D9's list, `tokens@kind=mpt&limit=20[&marker=M][&q=Q].json`, the query written sorted by name): its 20 issuances, its totals and the marker of
 * the next page. `q` is a search, `marker` a page behind one. The first page is `mptListOf()`.
 */
export const mptListOf = ({ q, marker }: { q?: string; marker?: string } = {}): MptTokensPage =>
  read<MptTokensPage>(`tokens@kind=mpt&limit=20${marker === undefined ? "" : `&marker=${marker}`}${q === undefined ? "" : `&q=${q}`}.json`);

/**
 * A scaled amount as a page writes it: the ledger's integer text (`units`) with its `scale` decimals, the integer part in groups of three (E14 spec 3.3). Written here on the digits, as text, with no number type, so that
 * it is not the app's `scaleUnits` (BigNumber) checked against itself.
 */
export function scaled(units: string, scale: number): string {
  const digits = units.padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return scale === 0 ? whole : `${whole}.${digits.slice(digits.length - scale)}`;
}

/** `part` of `whole` (both integer text) as a percentage of two decimals, rounded half up, the way a holder's share is written ("7.47%"). */
export function share(part: string, whole: string): string {
  const hundredths = (BigInt(part) * 20_000n + BigInt(whole)) / (2n * BigInt(whole));
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")}%`;
}
