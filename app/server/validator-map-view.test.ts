import { describe, expect, it } from "vitest";

import { validatorRowSample } from "../../test/support/d1-samples";
import type { ValidatorsParams } from "../domain/validators-params";
import type { NetworkInfo } from "../ui/networks";
import type { ValidatorRow } from "./api-types";
import { validatorMapOf, type ValidatorMapView } from "./validator-map-view";

const XRPL: NetworkInfo = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" };
const XAHAU: NetworkInfo = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud" };

/** How many validators a country has in a test's list, and how many of them are on the UNL. */
type Fleet = Record<string, [validators: number, unl: number]>;

let serial = 0;

/**
 * L's rows for a fleet: for each country, that many validators (the first `unl` of them on the UNL) whose toml gives it as the server country; then `unknown` validators with no
 * server country, alternately with no toml, a toml of `{}` and one that gives an owner country alone, none of which places a row.
 */
function listOf(fleet: Fleet, unknown = 0): ValidatorRow[] {
  const rows: ValidatorRow[] = [];
  const row = (over: Partial<ValidatorRow>): ValidatorRow => validatorRowSample({ validation_public_key: `nTestKey${(serial += 1)}`, ...over });
  for (const [code, [validators, unl]] of Object.entries(fleet)) {
    for (let i = 0; i < validators; i += 1) rows.push(row({ unl: i < unl, toml: { server_country: code } }));
  }
  for (let i = 0; i < unknown; i += 1) {
    const toml = [undefined, {}, { owner_country: "US" }][i % 3];
    rows.push(row({ unl: false, ...(toml !== undefined && { toml }) }));
  }
  return rows;
}

function build(rows: ValidatorRow[], over: { network?: NetworkInfo; params?: ValidatorsParams; truncated?: boolean } = {}): ValidatorMapView {
  return validatorMapOf({ network: over.network ?? XRPL, params: over.params ?? { scope: "unl" }, rows, truncated: over.truncated ?? false });
}

const circleOf = (view: ValidatorMapView, code: string) => {
  const circle = view.circles.find((candidate) => candidate.code === code);
  if (circle === undefined) throw new Error(`no circle for ${code}`);
  return circle;
};
const rowOf = (view: ValidatorMapView, code: string) => {
  const row = view.rows.find((candidate) => candidate.code === code);
  if (row === undefined) throw new Error(`no row for ${code}`);
  return row;
};

describe("validatorMapOf", () => {
  it("counts and orders the countries", () => {
    // US and DE tie on 16 validators and US has more on the UNL; AU and AT tie on both counts and go by the names' order (Australia before Austria), not by code.
    const view = build(listOf({ DE: [16, 5], AT: [2, 1], US: [16, 9], AU: [2, 1], FR: [3, 0] }, 4));
    expect(view.rows.map((row) => [row.code, row.name, row.validators, row.unl])).toEqual([
      ["US", "United States", "16", "9"],
      ["DE", "Germany", "16", "5"],
      ["FR", "France", "3", "0"],
      ["AU", "Australia", "2", "1"],
      ["AT", "Austria", "2", "1"],
    ]);
    expect(view.total).toBe(43);
    expect(view.unknown.count).toBe("4");
  });

  it("counts a thousand with its separator", () => {
    const view = build(listOf({ DE: [1000, 0] }));
    expect(rowOf(view, "DE").validators).toBe("1,000");
    expect(circleOf(view, "DE").label).toBe("Germany: 1,000 validators, 0 on the UNL");
  });

  it("writes shares of All, unknown included", () => {
    const view = build(listOf({ DE: [19, 5], US: [5, 5] }, 76));
    expect(view.total).toBe(100);
    expect(rowOf(view, "DE")).toMatchObject({ share: "19.0%", meter: { value: "19", max: "19" } });
    expect(rowOf(view, "US")).toMatchObject({ share: "5.0%", meter: { value: "5", max: "19" } });
    expect(circleOf(view, "DE").tip).toEqual({
      name: "Germany",
      counts: "19 validators · 5 on the UNL",
      share: "19.0% of the validators in All",
      hint: "Select to show only this country in the list",
    });
  });

  it("words one validator in the singular", () => {
    const view = build(listOf({ DE: [1, 1], US: [3, 0] }, 1));
    expect(circleOf(view, "DE").label).toBe("Germany: 1 validator, 1 on the UNL");
    expect(circleOf(view, "DE").tip.counts).toBe("1 validator · 1 on the UNL");
    expect(circleOf(view, "US").label).toBe("United States: 3 validators, 0 on the UNL");
    expect(view.unknown).toMatchObject({ count: "1", noun: "validator" });
  });

  it("sizes circles by area: the largest 44, none below 10", () => {
    const sixteen = build(listOf({ DE: [16, 0], FR: [1, 0] }));
    expect(circleOf(sixteen, "DE").size).toBe(44);
    expect(circleOf(sixteen, "FR").size).toBe(11);
    // 44 × √(1/27) is 8.5: held up to 10.
    const twentySeven = build(listOf({ DE: [27, 0], FR: [1, 0] }));
    expect(circleOf(twentySeven, "DE").size).toBe(44);
    expect(circleOf(twentySeven, "FR").size).toBe(10);
    // One decimal: 44 × √(2/3) is 35.93.
    expect(circleOf(build(listOf({ DE: [3, 0], FR: [2, 0] })), "FR").size).toBe(35.9);
  });

  it("places a circle by the table's point", () => {
    const view = build(listOf({ DE: [2, 0], US: [1, 0] }));
    expect(circleOf(view, "DE")).toMatchObject({ left: "52.89%", top: "19.68%" });
    expect(circleOf(view, "US")).toMatchObject({ left: "22.61%", top: "28.07%" });
  });

  it("paints the largest circle first and orders the circles west to east", () => {
    // CU and PA are at the same x (277.8): the northern one comes first.
    const view = build(listOf({ DE: [5, 0], PA: [4, 0], US: [3, 0], CU: [1, 0] }));
    expect(view.circles.map((circle) => circle.code)).toEqual(["DE", "PA", "US", "CU"]);
    expect(view.order).toEqual(["US", "CU", "PA", "DE"]);
  });

  it("keeps the other parameters in every href, and the chosen country's clears it", () => {
    const params: ValidatorsParams = { scope: "all", publisher: "vl.ripple.com", q: "peak", country: "DE" };
    const view = build(listOf({ DE: [2, 0], US: [1, 0] }), { params });
    expect(circleOf(view, "US").href).toBe("/xrpl/validators?scope=all&publisher=vl.ripple.com&country=US&q=peak");
    expect(rowOf(view, "US").href).toBe("/xrpl/validators?scope=all&publisher=vl.ripple.com&country=US&q=peak");
    // A second select of the chosen country shows every country again.
    expect(circleOf(view, "DE").href).toBe("/xrpl/validators?scope=all&publisher=vl.ripple.com&q=peak");
    expect(rowOf(view, "DE").href).toBe("/xrpl/validators?scope=all&publisher=vl.ripple.com&q=peak");
    expect(view.chosen).toEqual({ name: "Germany", clear: "/xrpl/validators?scope=all&publisher=vl.ripple.com&q=peak" });
    expect(circleOf(view, "DE").current).toBe(true);
    expect(rowOf(view, "DE").current).toBe(true);
    expect(circleOf(view, "US").current).toBe(false);
    expect(circleOf(view, "DE").tip.hint).toBe("Select to show every country again");
    expect(circleOf(view, "US").tip.hint).toBe("Select to show only this country in the list");
  });

  it("links with the network's own path", () => {
    expect(circleOf(build(listOf({ DE: [1, 0] }), { network: XAHAU }), "DE").href).toBe("/xahau/validators?country=DE");
  });

  it("has no chosen country on a view without one", () => {
    const view = build(listOf({ DE: [1, 0] }));
    expect(view.chosen).toBeNull();
    expect(circleOf(view, "DE").current).toBe(false);
  });

  it("dims the others while one is chosen", () => {
    const rows = listOf({ DE: [2, 0], US: [1, 0], FR: [1, 0] });
    const none = build(rows);
    expect(none.circles.map((circle) => circle.dim)).toEqual([false, false, false]);
    const view = build(rows, { params: { scope: "unl", country: "DE" } });
    expect(view.circles.map((circle) => [circle.code, circle.dim])).toEqual([
      ["DE", false],
      ["FR", true],
      ["US", true],
    ]);
    // Unknown location chosen: no circle is the chosen one.
    expect(build(listOf({ DE: [2, 0] }, 1), { params: { scope: "unl", country: "unknown" } }).circles.map((circle) => circle.dim)).toEqual([true]);
  });

  it("links unknown location only when there is one", () => {
    const params: ValidatorsParams = { scope: "all", q: "a" };
    expect(build(listOf({ DE: [1, 0] }, 3), { params }).unknown).toEqual({ count: "3", noun: "validators", href: "/xrpl/validators?scope=all&country=unknown&q=a" });
    expect(build(listOf({ DE: [1, 0] }), { params }).unknown).toEqual({ count: "0", noun: "validators", href: null });
  });

  it("names the chosen country, unknown location, or an unnamed code by its code", () => {
    const rows = listOf({ DE: [1, 0] }, 1);
    expect(build(rows, { params: { scope: "unl", country: "unknown" } }).chosen).toEqual({ name: "Unknown location", clear: "/xrpl/validators" });
    expect(build(rows, { params: { scope: "unl", country: "QQ" } }).chosen).toEqual({ name: "QQ", clear: "/xrpl/validators" });
  });

  it("lists an unplaced code in the table, without a circle, with the note", () => {
    // QQ is a code this build's table lacks (a new ISO assignment before it is regenerated): a row named by its code, after the named ones, with no link, no circle and no
    // option (a link to it would be dropped by the first redirect and show every validator, against the figure in the row), and a note.
    const view = build(listOf({ DE: [2, 1], QQ: [1, 1] }, 1));
    expect(view.rows.map((row) => [row.code, row.name, row.href === null])).toEqual([
      ["DE", "Germany", false],
      ["QQ", "QQ", true],
    ]);
    expect(rowOf(view, "QQ")).toMatchObject({ validators: "1", unl: "1", share: "25.0%", current: false, meter: { value: "1", max: "2" } });
    expect(view.circles.map((circle) => circle.code)).toEqual(["DE"]);
    expect(view.order).toEqual(["DE"]);
    expect(view.options).toEqual([
      { value: "DE", label: "Germany" },
      { value: "unknown", label: "Unknown location" },
    ]);
    expect(view.unplaced).toBe("1 validator is in a country the map does not place: QQ.");
  });

  it("words the unplaced note for several validators and several codes", () => {
    expect(build(listOf({ DE: [1, 0], QQ: [2, 0] })).unplaced).toBe("2 validators are in a country the map does not place: QQ.");
    expect(build(listOf({ DE: [1, 0], QZ: [1, 0], QQ: [2, 0] })).unplaced).toBe("3 validators are in countries the map does not place: QQ and QZ.");
    expect(build(listOf({ DE: [1, 0], QZ: [1, 0], QQ: [1, 0], QX: [1, 0] })).unplaced).toBe("3 validators are in countries the map does not place: QQ, QX and QZ.");
    expect(build(listOf({ DE: [1, 0] })).unplaced).toBeNull();
  });

  it("sizes a circle by the largest placed country", () => {
    const view = build(listOf({ QQ: [20, 0], DE: [4, 0], FR: [1, 0] }));
    expect(rowOf(view, "QQ").meter).toEqual({ value: "20", max: "20" });
    expect(rowOf(view, "DE").meter).toEqual({ value: "4", max: "20" });
    expect(circleOf(view, "DE").size).toBe(44);
    expect(circleOf(view, "FR").size).toBe(22);
  });

  it("offers the countries by name, the chosen one, then unknown location", () => {
    // By the names' order (France, Germany, United States), not by count or code; the chosen JP has no row and joins the others at its name's place.
    const rows = listOf({ US: [5, 0], DE: [2, 0], FR: [1, 0] }, 2);
    expect(build(rows).options).toEqual([
      { value: "FR", label: "France" },
      { value: "DE", label: "Germany" },
      { value: "US", label: "United States" },
      { value: "unknown", label: "Unknown location" },
    ]);
    expect(build(rows, { params: { scope: "unl", country: "JP" } }).options).toEqual([
      { value: "FR", label: "France" },
      { value: "DE", label: "Germany" },
      { value: "JP", label: "Japan" },
      { value: "US", label: "United States" },
      { value: "unknown", label: "Unknown location" },
    ]);
    // No unknown option without such a validator, unless it is the chosen value.
    expect(build(listOf({ DE: [1, 0] })).options).toEqual([{ value: "DE", label: "Germany" }]);
    expect(build(listOf({ DE: [1, 0] }), { params: { scope: "unl", country: "unknown" } }).options).toEqual([
      { value: "DE", label: "Germany" },
      { value: "unknown", label: "Unknown location" },
    ]);
  });

  it("answers an empty list", () => {
    const view = build([]);
    expect(view).toMatchObject({
      total: 0,
      circles: [],
      rows: [],
      unknown: { count: "0", href: null },
      chosen: null,
      unplaced: null,
      options: [],
      order: [],
      limited: null,
    });
  });

  it("answers an L with no row placed: no circle, no row, every validator unknown", () => {
    // D8 not yet read the files, or an API without D8: no toml at all, a toml of {}, and one that gives an owner country (which places nothing).
    const view = build(listOf({}, 6));
    expect(view.total).toBe(6);
    expect(view.circles).toEqual([]);
    expect(view.rows).toEqual([]);
    expect(view.order).toEqual([]);
    expect(view.unplaced).toBeNull();
    expect(view.unknown).toEqual({ count: "6", noun: "validators", href: "/xrpl/validators?country=unknown" });
    expect(view.options).toEqual([{ value: "unknown", label: "Unknown location" }]);
  });

  it("says when L was truncated", () => {
    expect(build(listOf({ DE: [1, 0] }), { truncated: true }).limited).toBe("The first 1,000 validators in this order are shown.");
    expect(build(listOf({ DE: [1, 0] })).limited).toBeNull();
  });

  it("names the file of the network", () => {
    expect(build([], { network: XRPL }).file).toBe("xrp-ledger.toml");
    expect(build([], { network: XAHAU }).file).toBe("xahau.toml");
  });
});
