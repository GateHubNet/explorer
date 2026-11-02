import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COUNTRIES, COUNTRY_CODES } from "../app/server/countries";
import { countriesModule, dotsPath, OUTPUTS, pointOf, staleOutputs, worldDotsSvg } from "./world-map-core";
import { BOARD_CODES, COUNTRY_POINTS, LAND, WATER } from "./world-map-data";

// The world map of the validators page (E13 spec 1): the dots of `app/ui/map/world-dots.svg` and the table of `app/server/countries.ts` are made by `scripts/world-map-core.ts` from
// `scripts/world-map-data.ts`. What the tests hold them to is written out here and does not come from the data: the 250 codes the data API accepts (D8's `ISO_COUNTRY_CODES`), and
// the names and projected points of the mock kit's board.

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The 250 codes D8 accepts: the 249 ISO 3166-1 alpha-2 codes assigned on 2026-10-24, and `XK` (Kosovo) last. */
const ISO_CODES = `
  AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
  DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM
  JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP
  NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO
  TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK
`
  .trim()
  .split(/\s+/);

/** The kit's projected points of the board's 55 hub countries: x and y in the 1000 × 378 box. */
const KIT_POINTS: Record<string, [number, number]> = {
  US: [226.1, 106.1], CA: [222.2, 66.7], MX: [215.3, 151.1], BR: [353.1, 246.7], AR: [318.9, 315], CL: [303.6, 309.7], CO: [294.2, 203.9], PE: [291.7, 242.2],
  GB: [495, 69.4], IE: [477.8, 68.9], IS: [448.3, 36.4], PT: [477.8, 106.7], ES: [490, 105], FR: [506.7, 87.2], BE: [512.8, 76.1], NL: [514.7, 71.7], LU: [516.9, 78.3],
  DE: [528.9, 74.4], CH: [522.8, 86.7], AT: [539.2, 84.4], IT: [535, 97.8], DK: [526.4, 61.1], NO: [525, 47.2], SE: [541.7, 49.7], FI: [572.2, 44.4], EE: [569.4, 53.9],
  LT: [566.4, 63.3], PL: [553.9, 71.9], CZ: [543.1, 78.3], RO: [569.2, 89.2], UA: [587.2, 80.6], TR: [597.8, 108.3], RU: [777.8, 45.8], KZ: [686.1, 83.3],
  IL: [597.2, 129.4], SA: [625, 150], AE: [650.8, 149.2], EG: [585.6, 142.2], NG: [524.2, 191.4], KE: [605.3, 216.1], ZA: [569.4, 297.2], IN: [716.7, 158.3],
  CN: [788.9, 119.4], HK: [817.2, 154.7], TW: [836.1, 150.8], KR: [855.3, 115.3], JP: [884.2, 116.1], TH: [780.3, 172.5], VN: [800.8, 177.5], MY: [783.3, 205],
  SG: [788.3, 212.9], ID: [827.8, 223.6], PH: [838.3, 180.8], AU: [871.7, 286.9], NZ: [983.3, 330.6],
};

/** The names of the board's 55 hub countries, as the kit writes them. */
const KIT_NAMES: Record<string, string> = {
  US: "United States", CA: "Canada", MX: "Mexico", BR: "Brazil", AR: "Argentina", CL: "Chile", CO: "Colombia", PE: "Peru", GB: "United Kingdom", IE: "Ireland",
  IS: "Iceland", PT: "Portugal", ES: "Spain", FR: "France", BE: "Belgium", NL: "Netherlands", LU: "Luxembourg", DE: "Germany", CH: "Switzerland", AT: "Austria",
  IT: "Italy", DK: "Denmark", NO: "Norway", SE: "Sweden", FI: "Finland", EE: "Estonia", LT: "Lithuania", PL: "Poland", CZ: "Czechia", RO: "Romania", UA: "Ukraine",
  TR: "Türkiye", RU: "Russia", KZ: "Kazakhstan", IL: "Israel", SA: "Saudi Arabia", AE: "United Arab Emirates", EG: "Egypt", NG: "Nigeria", KE: "Kenya",
  ZA: "South Africa", IN: "India", CN: "China", HK: "Hong Kong", TW: "Taiwan", KR: "South Korea", JP: "Japan", TH: "Thailand", VN: "Vietnam", MY: "Malaysia",
  SG: "Singapore", ID: "Indonesia", PH: "Philippines", AU: "Australia", NZ: "New Zealand",
};

const near = (a: number, b: number, within = 0.1) => Math.abs(a - b) <= within + 1e-9;

describe("the world map", () => {
  it("writes outputs that are current", () => {
    expect(staleOutputs(ROOT)).toEqual([]);
  });

  it("names the outputs that are missing or differ", () => {
    const root = mkdtempSync(join(tmpdir(), "world-map-"));
    try {
      expect(staleOutputs(root)).toEqual(OUTPUTS.map((output) => output.path));
      for (const { path, text } of OUTPUTS) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text());
      }
      expect(staleOutputs(root)).toEqual([]);
      writeFileSync(join(root, "app/server/countries.ts"), `${countriesModule()}// edited\n`);
      expect(staleOutputs(root)).toEqual(["app/server/countries.ts"]);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it("places the 250 codes D8 accepts, and no other", () => {
    const codes = COUNTRY_POINTS.map(([code]) => code);
    expect(ISO_CODES).toHaveLength(250);
    expect(new Set(codes).size).toBe(250);
    expect([...codes].sort()).toEqual([...ISO_CODES].sort());
    expect(codes).toEqual([...codes].sort());
    for (const [code, name, lat, lon] of COUNTRY_POINTS) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(name, code).not.toBe("");
      expect(lat, code).toBeGreaterThanOrEqual(-90);
      expect(lat, code).toBeLessThanOrEqual(90);
      expect(lon, code).toBeGreaterThanOrEqual(-180);
      expect(lon, code).toBeLessThanOrEqual(180);
      const { x, y } = pointOf(lat, lon);
      expect(x, code).toBeGreaterThanOrEqual(0);
      expect(x, code).toBeLessThanOrEqual(1000);
      expect(y, code).toBeGreaterThanOrEqual(0);
      expect(y, code).toBeLessThanOrEqual(378);
    }
    expect(new Set(COUNTRY_POINTS.map(([, name]) => name)).size).toBe(250);
    for (const absent of ["UK", "EU", "ZZ"]) {
      expect(codes).not.toContain(absent);
      expect(COUNTRY_CODES.has(absent)).toBe(false);
    }
    expect([...COUNTRY_CODES].sort()).toEqual([...ISO_CODES].sort());
    expect(Object.keys(COUNTRIES)).toEqual(codes);
  });

  it("keeps the board's 55 points and names", () => {
    expect(BOARD_CODES).toHaveLength(55);
    expect(Object.keys(KIT_POINTS)).toEqual([...BOARD_CODES]);
    expect(Object.keys(KIT_NAMES)).toEqual([...BOARD_CODES]);
    for (const code of BOARD_CODES) {
      const point = COUNTRY_POINTS.find(([each]) => each === code)!;
      expect(point[1], code).toBe(KIT_NAMES[code]);
      const { x, y } = pointOf(point[2], point[3]);
      const [kitX, kitY] = KIT_POINTS[code]!;
      expect(near(x, kitX), `${code} x ${x} against ${kitX}`).toBe(true);
      expect(near(y, kitY), `${code} y ${y} against ${kitY}`).toBe(true);
    }
  });

  it("names the countries as CLDR's English does, with the short forms of HK, MO, PS and MM", () => {
    const names: Record<string, string> = {
      BA: "Bosnia & Herzegovina",
      CD: "Congo - Kinshasa",
      CG: "Congo - Brazzaville",
      CI: "Côte d’Ivoire",
      HK: "Hong Kong",
      MM: "Myanmar",
      MO: "Macao",
      PS: "Palestine",
      TR: "Türkiye",
      XK: "Kosovo",
    };
    for (const [code, name] of Object.entries(names)) expect(COUNTRIES[code]!.name, code).toBe(name);
  });

  // The mirror the Factbook's coordinates come from names its files by FIPS codes (`gm` is Germany, `ni` Nigeria, `ag` Algeria, `ch` China, `au` Austria, `bf` the Bahamas), so a
  // point read by file name is wrong for the codes the board does not pin. These need no typed coordinate: where a country lies is known without one.
  it("puts the countries a FIPS code would swap where they are", () => {
    const x = (code: string) => COUNTRIES[code]!.x;
    const y = (code: string) => COUNTRIES[code]!.y;
    const equator = pointOf(0, 0).y;
    const degrees = 1000 / 360;
    for (const code of ["NI", "BS", "AG"]) expect(x(code), `${code} is in the Americas`).toBeLessThan(400);
    expect(x("BF"), "Burkina Faso is in West Africa").toBeGreaterThan(400);
    expect(x("GM"), "the Gambia lies west of Nigeria").toBeLessThan(x("NG"));
    for (const code of ["SB", "KI"]) expect(x(code), `${code} is in the Pacific`).toBeGreaterThan(900);
    for (const code of ["CG", "CD"]) expect(Math.abs(y(code) - equator), `${code} is within 10° of the equator`).toBeLessThanOrEqual(10 * degrees);
    // More that a swap would move far: Brunei and Benin, Senegal, Gabon and the Gambia, Niger and Nigeria, Chad.
    expect(x("BN"), "Brunei is in Southeast Asia").toBeGreaterThan(800);
    expect(x("BJ"), "Benin is in West Africa").toBeLessThan(600);
    expect(x("SN"), "Senegal is in West Africa").toBeLessThan(500);
    expect(x("GA"), "Gabon lies east of the Gambia").toBeGreaterThan(x("GM"));
    expect(y("NE"), "Niger lies north of Nigeria").toBeLessThan(y("NG"));
    expect(y("TD"), "Chad is north of the equator").toBeLessThan(equator - 10 * degrees);
    expect(y("AQ"), "Antarctica sits on the bottom edge").toBe(378);
  });

  it("projects by hand", () => {
    expect(pointOf(0, 0)).toEqual({ x: 500, y: 216.7 });
    // Antarctica is held to the bottom edge, and Svalbard's latitude beyond the top to the top.
    expect(pointOf(-90, 0).y).toBe(378);
    expect(pointOf(78, -180)).toEqual({ x: 0, y: 0 });
    expect(pointOf(90, 20).y).toBe(0);
  });

  it("draws the kit's 2,374 dots", () => {
    const path = dotsPath();
    expect(path.split("M").length - 1).toBe(2_374);
    expect(path).toHaveLength(32_104);
    expect(path.startsWith("M316.0 3.5h0M322.9 3.5h0M329.9 3")).toBe(true);
    // Every segment is a point inside the box.
    const segments = [...path.matchAll(/M(\d+\.\d) (\d+\.\d)h0/g)];
    expect(segments).toHaveLength(2_374);
    for (const [, x, y] of segments) {
      expect(Number(x)).toBeGreaterThan(0);
      expect(Number(x)).toBeLessThan(1000);
      expect(Number(y)).toBeGreaterThan(0);
      expect(Number(y)).toBeLessThan(378);
    }
    // The kit's 36 polygons: 33 of land, and the Caspian, the Black Sea and the Persian Gulf.
    expect(Object.keys(LAND)).toHaveLength(33);
    expect(Object.keys(WATER)).toEqual(["caspian", "black_sea", "persian_gulf"]);
  });

  it("writes the svg the page draws", () => {
    const svg = worldDotsSvg();
    expect(svg.startsWith("<!-- Generated by scripts/world-map.ts (pnpm map:sync): do not edit. -->\n<svg ")).toBe(true);
    for (const part of ['viewBox="0 0 1000 378"', '<path id="dots"', 'stroke="currentColor"', 'stroke-width="3.4"', 'stroke-linecap="round"', 'fill="none"']) {
      expect(svg, part).toContain(part);
    }
    expect(svg).toContain(`d="${dotsPath()}"`);
    expect(svg.endsWith("</svg>\n")).toBe(true);
  });

  it("orders the names in English", () => {
    const orders = Object.values(COUNTRIES).map((country) => country.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(Array.from({ length: 250 }, (_, at) => at));
    expect(COUNTRIES.AF!.order).toBe(0);
    expect(COUNTRIES.AX!.order).toBe(1);
    expect(COUNTRIES.AL!.order).toBe(2);
    // "Türkiye" sorts as "Turkiye": after Tunisia and before Turkmenistan.
    expect(COUNTRIES.TN!.order).toBeLessThan(COUNTRIES.TR!.order);
    expect(COUNTRIES.TR!.order).toBeLessThan(COUNTRIES.TM!.order);
    const collator = new Intl.Collator("en");
    const byOrder = Object.values(COUNTRIES).sort((a, b) => a.order - b.order);
    for (const [at, country] of byOrder.entries()) if (at > 0) expect(collator.compare(byOrder[at - 1]!.name, country.name), country.name).toBeLessThan(0);
  });

  it("writes the table as one line to a code, in code order", () => {
    const lines = countriesModule().split("\n");
    expect(lines[0]).toBe("// Generated by scripts/world-map.ts (pnpm map:sync): do not edit.");
    expect(lines).toContain('  DE: { name: "Germany", x: 528.9, y: 74.4, order: 84 },');
    expect(lines.at(-2)).toBe("export const COUNTRY_CODES: ReadonlySet<string> = new Set(Object.keys(COUNTRIES));");
    expect(lines.at(-1)).toBe("");
    expect(lines.filter((line) => /^ {2}[A-Z]{2}: /.test(line))).toHaveLength(250);
  });
});
