// The MPT amounts of a page, collected and resolved (E14 spec 2.4 and 5.1, Task 7): a page that shows an MPT amount outside an MPT answer collects the issuance IDs it draws (`mptAmountsOf`),
// the loader asks the data API once (`loadMptLookup`, mpt-load.ts) and `resolveMpt` fills each amount's scaled `value` and its `ticker`. Pure, Worker-only: the page receives the filled data and
// never an issuance; an MPT amount that is not filled is drawn in units, which is why `resolveMpt` says whether any was left (`unresolved`) and the transaction page is then not kept for a year.

import { isMptIssuanceId } from "../domain/mpt-id";
import { scaleUnits } from "../domain/mpt";
import type { MptSummary } from "./api-types";
import { MPT_LOOKUP_MAX } from "./data-api";

export { MPT_LOOKUP_MAX };

/** What the lookup answered, by issuance ID in capitals: the summary of an issuance the index knows, the ID alone for one it has no state for. */
export type MptLookupMap = ReadonlyMap<string, MptSummary | { mpt_issuance_id: string }>;

/**
 * What a page's lookup came to: `off` (no call was made: `MPT` is off, the network has none, or the page shows no MPT amount), `ok` with the answers, or `failed` (the call was made and did not
 * answer; the loader has logged it and marked the page degraded).
 */
export type MptLookupResult = { state: "off" } | { state: "ok"; map: MptLookupMap } | { state: "failed" };

type Plain = Record<string, unknown>;

/** A plain object of page data (a segment, a flow amount, a row), not an array and not an instance of a class. */
function isPlain(value: unknown): value is Plain {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** An MPT amount's carrier: the issuance ID, in capitals, and which of the four shapes carries it. */
type Carrier = { id: string; form: "segment" | "flat" | "nested" | "change" };

/**
 * The issuance an object carries, if it is one of the four carriers of an MPT amount or reference (`undefined` for any other object, and for an ID that is not 48 hex digits: the lookup takes no
 * other, and one stray ID would fail it whole):
 * - a segment `{ t: "mpt", id }` (a sentence, a detail);
 * - an object whose `mpt` is an ID string: an MPT `FlowAmount` `{ mpt, issuer, units }`, a payment row's amount, a Tokens-card holding, a touched object `{ mpt }`;
 * - an object whose `mpt` is `{ id, units }`: E10's `DisplayAmount` of an escrow;
 * - a balance change `{ mpt: true, currency }`, whose `currency` is the ID.
 */
function carrierOf(o: Plain): Carrier | undefined {
  if (o.t === "mpt" && isMptIssuanceId(o.id)) return { id: o.id.toUpperCase(), form: "segment" };
  const { mpt } = o;
  if (isMptIssuanceId(mpt)) return { id: mpt.toUpperCase(), form: "flat" };
  if (mpt === true && isMptIssuanceId(o.currency)) return { id: o.currency.toUpperCase(), form: "change" };
  if (isPlain(mpt) && isMptIssuanceId(mpt.id)) return { id: mpt.id.toUpperCase(), form: "nested" };
  return undefined;
}

/**
 * The issuance IDs of the MPT amounts and references in some page data (arrays and plain objects, walked to any depth; a string is never read, so the raw JSON of a transaction holds none): upper
 * case, sorted, each once, the first `MPT_LOOKUP_MAX` of them. The lookup takes 1 to 100, so a page that shows more keeps the rest in units.
 */
export function mptAmountsOf(...parts: unknown[]): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const inner of value) visit(inner);
      return;
    }
    if (!isPlain(value)) return;
    const carrier = carrierOf(value);
    if (carrier !== undefined) found.add(carrier.id);
    for (const inner of Object.values(value)) visit(inner);
  };
  for (const part of parts) visit(part);
  return [...found].sort().slice(0, MPT_LOOKUP_MAX);
}

/** What the lookup knows of an issuance: its summary when it has a scale, else nothing (an ID answered bare, an ID not asked, or no answer). */
function summaryOf(lookup: MptLookupResult, id: string): MptSummary | undefined {
  if (lookup.state !== "ok") return undefined;
  const entry = lookup.map.get(id);
  return entry !== undefined && "asset_scale" in entry ? entry : undefined;
}

/** The longest ticker D9 stores, in code points (`MPT_TICKER_MAX`, mpt-state.job.ts:483 at the pin). Nothing on the explorer's path checks a length (mpt-shape.ts takes any text), so a page cuts it again. */
export const MPT_TICKER_MAX = 16;

/**
 * The ticker a page draws: the issuer's text cut to `MPT_TICKER_MAX` code points as D9 cuts it (`cutText` does not split a character outside the BMP), and none when nothing visible is left. D9 leaves
 * out an empty ticker but keeps a blank one, which would draw an amount like "25,000.00 " with a link nobody can see.
 */
export function tickerText(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const cut = raw.length <= MPT_TICKER_MAX ? raw : Array.from(raw).slice(0, MPT_TICKER_MAX).join("");
  return cut.trim() === "" ? undefined : cut;
}

/** `fields` that are defined, merged into a copy of `target`: a ticker the issuance has none of, and a value above the largest scale, are left out. */
const filled = (target: Plain, fields: Plain): Plain => ({ ...target, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) });

/**
 * Fills the MPT amounts of some page data from a lookup, in a copy (the data is not changed):
 * - an amount with `units` (a segment, a flow amount, a holding, a payment row, E10's `{ id, units }`) gets `value`, the units scaled by the issuance's `asset_scale` (left out above 19, where the
 *   page shows the units), and the issuance's `ticker`;
 * - a balance change gets `scaled` (its `value` scaled), `scaledAfter` (its `after` scaled) and `ticker`;
 * - a carrier with no units (a reference segment, a touched object) gets its `ticker`.
 *
 * `unresolved` says whether any MPT amount or reference was left in units: the lookup failed, or an ID in the data got no scale from it (answered bare, or not asked: past the first 100). A lookup
 * that is `off` leaves everything as it was and is never unresolved.
 */
export function resolveMpt<T>(view: T, lookup: MptLookupResult): { view: T; unresolved: boolean } {
  if (lookup.state === "off") return { view, unresolved: false };
  let unresolved = lookup.state === "failed";

  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (!isPlain(value)) return value;
    const copy: Plain = Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, resolve(inner)]));
    const carrier = carrierOf(value);
    if (carrier === undefined) return copy;

    const summary = summaryOf(lookup, carrier.id);
    if (summary === undefined) {
      unresolved = true;
      return copy;
    }
    const { asset_scale: scale } = summary;
    const ticker = tickerText(summary.ticker);
    switch (carrier.form) {
      case "change":
        return filled(copy, {
          scaled: typeof value.value === "string" ? (scaleUnits(value.value, scale) ?? undefined) : undefined,
          scaledAfter: typeof value.after === "string" ? (scaleUnits(value.after, scale) ?? undefined) : undefined,
          ticker,
        });
      case "nested": {
        const inner = copy.mpt as Plain;
        return { ...copy, mpt: typeof inner.units === "string" ? filled(inner, { value: scaleUnits(inner.units, scale) ?? undefined, ticker }) : filled(inner, { ticker }) };
      }
      default:
        return filled(copy, { value: typeof value.units === "string" ? (scaleUnits(value.units, scale) ?? undefined) : undefined, ticker });
    }
  };

  const resolved = resolve(view) as T;
  return { view: resolved, unresolved };
}
