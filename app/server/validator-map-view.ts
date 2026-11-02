// What the validators page's countries card shows (E13 spec 4.1 and 4.2), counted in the Worker from every row of L (before the scope chip and the filters): the circles of the
// map, the rows of the countries table, the chip of the validators whose location is unknown, the Country select's options and the notes. Pure: no I/O, no clock, no `Intl`
// (the names are ordered by `COUNTRIES[code].order`, which the generator took from the CLDR English names), counts are `count` and shares `shareText`, so no float reaches a
// label. `app/server/countries.ts` is imported here and by the loaders alone: a page receives text and percentages, and no JavaScript file of the build holds the table.

import { joinAnd } from "../domain/join-and";
import { UNKNOWN_COUNTRY, validatorsHref, type ValidatorsParams } from "../domain/validators-params";
import type { NetworkInfo } from "../ui/networks";
import type { ValidatorRow } from "./api-types";
import { COUNTRIES } from "./countries";
import { tomlFileOf } from "./toml-words";
import { count, shareText } from "./validator-facts";

/** The sentence that says the list stopped at L's `limit` (E6's footer says it too). */
export const LIMITED_SENTENCE = "The first 1,000 validators in this order are shown.";

/** The words of the unknown location, in the select, the chosen country's name and the chip. */
const UNKNOWN_NAME = "Unknown location";

export interface CircleView {
  code: string;
  href: string;
  current: boolean;
  /** Another country is chosen. */
  dim: boolean;
  /** `x / 10` and `y / 3.78` of the table's point, as percentages of the map's box: `"52.89%"`, `"19.68%"`. */
  left: string;
  top: string;
  /** The diameter in px at full width: `max(10, 44 × √(n / largest))`, one decimal. */
  size: number;
  /** `Germany: 16 validators, 5 on the UNL`. */
  label: string;
  tip: { name: string; counts: string; share: string; hint: string };
}

export interface CountryRowView {
  code: string;
  name: string;
  /** `null` for a code this build's table lacks: a link to it would be dropped by the first redirect and show every validator (the row is text). */
  href: string | null;
  current: boolean;
  validators: string;
  unl: string;
  share: string;
  meter: { value: string; max: string };
}

export interface ValidatorMapView {
  /** Every row of L (the All count). */
  total: number;
  /** The file the validators' domains publish on this network, for the attribution. */
  file: "xrp-ledger.toml" | "xahau.toml";
  /** The placed countries, the largest first (painted under the smaller ones). */
  circles: CircleView[];
  /** Every country with a validator, a code this build does not place included. */
  rows: CountryRowView[];
  /** The validators whose toml gives no server country; `href` is `null` when there are none. `noun` agrees with `count`. */
  unknown: { count: string; noun: "validator" | "validators"; href: string | null };
  chosen: { name: string; clear: string } | null;
  /** The note of spec 1.3 about the codes this build does not place. */
  unplaced: string | null;
  /** E6's sentence, when L has more than the 1,000 rows it was asked for. */
  limited: string | null;
  /** The Country select's options (spec 4.4). */
  options: { value: string; label: string }[];
  /** The circles' codes from west to east, then north to south: the arrow keys' order. */
  order: string[];
}

/** The named countries by the order of their names, then the codes the table lacks by code. */
function byName(a: string, b: string): number {
  const x = COUNTRIES[a]?.order;
  const y = COUNTRIES[b]?.order;
  if (x !== undefined && y !== undefined) return x - y;
  if (x !== undefined) return -1;
  if (y !== undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A country's name, or its code when this build's table lacks it (the Country filter, the map and a row's place say it the same way). */
export const countryName = (code: string): string => COUNTRIES[code]?.name ?? code;

const validatorsOf = (n: number): string => `${count(n)} ${n === 1 ? "validator" : "validators"}`;

/** The view without its `country`: where a second select of the chosen country, "Clear country" and the like go. */
function withoutCountry(params: ValidatorsParams): ValidatorsParams {
  const { country: _chosen, ...rest } = params;
  return rest;
}

/**
 * The map of the validators of `rows` (all of L's, whatever the scope and the filters). A row's country is its toml's `server_country`; a row without one is of unknown
 * location (no toml, a toml of `{}`, one that gives other keys: the owner country does not place a server). `truncated` is whether L has a `marker`.
 */
export function validatorMapOf(input: { network: NetworkInfo; params: ValidatorsParams; rows: readonly ValidatorRow[]; truncated: boolean }): ValidatorMapView {
  const { network, params, rows, truncated } = input;
  const net = network.id;
  const total = rows.length;

  const tally = new Map<string, { validators: number; unl: number }>();
  let unknown = 0;
  for (const row of rows) {
    const code = row.toml?.server_country;
    if (code === undefined) {
      unknown += 1;
      continue;
    }
    const entry = tally.get(code) ?? { validators: 0, unl: 0 };
    entry.validators += 1;
    if (row.unl) entry.unl += 1;
    tally.set(code, entry);
  }
  const countries = [...tally].sort(([a, x], [b, y]) => y.validators - x.validators || y.unl - x.unl || byName(a, b));
  const placed = countries.filter(([code]) => COUNTRIES[code] !== undefined);
  const largest = countries[0]?.[1].validators ?? 0;
  const largestPlaced = placed[0]?.[1].validators ?? 0;

  const chosen = params.country;
  const clear = validatorsHref(net, withoutCountry(params));
  /** Where a country's circle and row go: its view, or, for the chosen one, the view without it. */
  const hrefOf = (code: string): string => (code === chosen ? clear : validatorsHref(net, { ...params, country: code }));

  const circles: CircleView[] = placed.map(([code, { validators, unl }]) => {
    const point = COUNTRIES[code]!;
    const name = point.name;
    return {
      code,
      href: hrefOf(code),
      current: code === chosen,
      dim: chosen !== undefined && code !== chosen,
      left: `${(point.x / 10).toFixed(2)}%`,
      top: `${(point.y / 3.78).toFixed(2)}%`,
      size: Number(Math.max(10, 44 * Math.sqrt(validators / largestPlaced)).toFixed(1)),
      label: `${name}: ${validatorsOf(validators)}, ${count(unl)} on the UNL`,
      tip: {
        name,
        counts: `${validatorsOf(validators)} · ${count(unl)} on the UNL`,
        share: `${shareText(validators, total)} of the validators in All`,
        hint: code === chosen ? "Select to show every country again" : "Select to show only this country in the list",
      },
    };
  });

  const countryRows: CountryRowView[] = countries.map(([code, { validators, unl }]) => ({
    code,
    name: countryName(code),
    href: COUNTRIES[code] === undefined ? null : hrefOf(code),
    current: code === chosen,
    validators: count(validators),
    unl: count(unl),
    share: shareText(validators, total),
    meter: { value: String(validators), max: String(largest) },
  }));

  const unplacedCodes = countries.filter(([code]) => COUNTRIES[code] === undefined).map(([code]) => code);
  const unplacedValidators = countries.reduce((n, [code, { validators }]) => (COUNTRIES[code] === undefined ? n + validators : n), 0);
  const unplaced =
    unplacedCodes.length === 0
      ? null
      : `${validatorsOf(unplacedValidators)} ${unplacedValidators === 1 ? "is" : "are"} in ${unplacedCodes.length === 1 ? "a country" : "countries"} the map does not place: ${joinAnd(unplacedCodes)}.`;

  // The select offers the codes it can link to; a chosen country without a row is added so that the select shows the view it is on (a code the table lacks is dropped by
  // the first redirect, so it is never chosen).
  const optionCodes = placed.map(([code]) => code);
  if (chosen !== undefined && chosen !== UNKNOWN_COUNTRY && !optionCodes.includes(chosen)) optionCodes.push(chosen);
  optionCodes.sort(byName);
  const options = optionCodes.map((code) => ({ value: code, label: countryName(code) }));
  if (unknown > 0 || chosen === UNKNOWN_COUNTRY) options.push({ value: UNKNOWN_COUNTRY, label: UNKNOWN_NAME });

  return {
    total,
    file: tomlFileOf(network.software),
    circles,
    rows: countryRows,
    unknown: { count: count(unknown), noun: unknown === 1 ? "validator" : "validators", href: unknown > 0 ? validatorsHref(net, { ...params, country: UNKNOWN_COUNTRY }) : null },
    chosen: chosen === undefined ? null : { name: chosen === UNKNOWN_COUNTRY ? UNKNOWN_NAME : countryName(chosen), clear },
    unplaced,
    limited: truncated ? LIMITED_SENTENCE : null,
    options,
    order: circles
      .map(({ code }) => code)
      .sort((a, b) => COUNTRIES[a]!.x - COUNTRIES[b]!.x || COUNTRIES[a]!.y - COUNTRIES[b]!.y),
  };
}
