import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// What the stylesheets of the transaction page must keep: links that stay readable on the tinted box of the flow, a focus ring
// that the card does not clip, hex that wraps, and targets of 44 px.

const read = (name: string) => readFileSync(new URL(`../../app/ui/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const pagesCss = read("pages.css");
const componentsCss = read("components.css");
const baseCss = read("base.css");
const tokensCss = read("tokens.css");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return Object.fromEntries(
    match[1]!
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const colon = declaration.indexOf(":");
        return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
      }),
  );
}

// --- Contrast of an accent link on the flow's tinted box --------------------------------------------------------------------

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const mix = (a: Rgb, b: Rgb, aShare: number): Rgb => a.map((v, i) => v * aShare + b[i]! * (1 - aShare)) as Rgb;
function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The value of a custom property in the first block of tokens.css after `from` that declares it (light: the first; dark: after the dark marker). */
function token(name: string, from = 0): string {
  const match = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(tokensCss.slice(from));
  if (!match) throw new Error(`no ${name}`);
  return match[1]!;
}
const DARK_AT = tokensCss.indexOf("@media (prefers-color-scheme: dark)");

const ACCENTS = { xrpl: "#2f5bea", xahau: "#b45309" };
const WHITE = rgb("#ffffff");

describe("the box of a pool or an offer in the flow", () => {
  const background = rule(pagesCss, ".flow__node--via").background!;
  const share = Number(/color-mix\(in srgb,\s*var\(--sunken\)\s+(\d+)%,\s*var\(--surface\)\)/.exec(background ?? "")?.[1]) / 100;

  it("is a blend of --sunken and --surface, not plain --sunken (where the Xahau accent is 4.40:1)", () => {
    expect(Number.isFinite(share)).toBe(true);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
  });

  it.each([
    ["light", 0],
    ["dark", DARK_AT],
  ] as const)("keeps a link of either network's accent at 4.5:1 or more in %s", (mode, from) => {
    const sunken = rgb(token("--sunken", from));
    const surface = rgb(token("--surface", from));
    const box = mix(sunken, surface, share);
    for (const [net, accent] of Object.entries(ACCENTS)) {
      const link = mode === "light" ? rgb(accent) : mix(rgb(accent), WHITE, 0.55);
      expect(contrast(link, box), `${net} in ${mode}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("would fail the check if it were plain --sunken (the check can tell)", () => {
    expect(contrast(rgb(ACCENTS.xahau), rgb(token("--sunken")))).toBeLessThan(4.5);
  });
});

describe("the raw tabs", () => {
  it("draw a focus ring inside the bar, where the card does not clip it", () => {
    expect(Number.parseFloat(rule(pagesCss, ".rawtabs__tab:focus-visible")["outline-offset"]!)).toBeLessThanOrEqual(-2);
  });

  it("have tabs of at least 44 px", () => {
    expect(Number.parseFloat(rule(pagesCss, ".rawtabs__tab")["min-height"]!)).toBeGreaterThanOrEqual(44);
  });

  it("wrap a blob of hex at the edge of the panel", () => {
    const wrap = rule(pagesCss, ".code--wrap");
    expect(wrap["white-space"]).toBe("pre-wrap");
    expect(wrap["overflow-wrap"]).toBe("anywhere");
  });
});

describe("the raw text blocks", () => {
  it("are a card's focusable content, whose ring the card would clip: the ring is drawn inside (the ledger page's raw header too)", () => {
    // The global ring is outset, and `.card` has `overflow: hidden`.
    expect(rule(baseCss, ":focus-visible")["outline-offset"]).toBe("2px");
    expect(rule(componentsCss, ".card").overflow).toBe("hidden");
    const code = rule(componentsCss, ".code:focus-visible");
    expect(Number.parseFloat(code["outline-offset"]!)).toBeLessThanOrEqual(-2);
    // It is not turned off: the global outline still applies.
    expect(code.outline ?? "2px solid").not.toMatch(/none|^0/);
  });
});

// --- The layout of the page's cards ---------------------------------------------------------------------------------------------

/** The text of a CSS file without the `@media` blocks that match `query`, and the text inside them. */
function mediaBlock(css: string, query: string): { inside: string; outside: string } {
  const at = css.indexOf(`@media ${query}`);
  if (at < 0) throw new Error(`no @media ${query}`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}" && --depth === 0) return { inside: css.slice(open + 1, i), outside: css.slice(0, at) + css.slice(i + 1) };
  }
  throw new Error("unbalanced braces");
}

describe("the grid of the transaction page", () => {
  const { inside, outside } = mediaBlock(pagesCss, "(min-width: 900px)");
  const areas = [...(/grid-template-areas\s*:\s*([^;]+);/.exec(inside)?.[1] ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1]!.trim().split(/\s+/));

  it("puts the raw card in the left column under Details and Balance changes, with the margin cards in the right column spanning them all (the desktop board)", () => {
    expect(areas.length).toBeGreaterThanOrEqual(3);
    const columnOf = (name: string) => areas.flatMap((row) => row.flatMap((cell, column) => (cell === name ? [column] : [])));
    for (const name of ["details", "balance", "raw"]) expect(new Set(columnOf(name)), name).toEqual(new Set([0]));
    expect(new Set(columnOf("aside"))).toEqual(new Set([1]));
    const rowOf = (name: string) => areas.findIndex((row) => row.includes(name));
    expect(rowOf("details")).toBeLessThan(rowOf("balance"));
    expect(rowOf("balance")).toBeLessThan(rowOf("raw"));
    // The margin spans every row (a row of its own at the end takes what the margin has over, so the cards on the left do not stretch).
    for (const row of areas) expect(row[1]).toBe("aside");
    expect(areas.at(-1)![0]).toBe(".");
    expect(/grid-template-rows\s*:[^;]*1fr/.test(inside)).toBe(true);
  });

  it("keeps the columns able to shrink below their content (the balance table scrolls inside its card instead of widening the page)", () => {
    expect(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+\d+px/.test(inside)).toBe(true);
    expect(rule(outside, ".txgrid")["grid-template-columns"]).toBe("minmax(0, 1fr)");
  });

  it("gives its cards their areas only in that layout: on a phone they follow the order of the page, the raw data last (TransactionMobile)", () => {
    expect(outside).not.toMatch(/grid-area/);
    expect(outside).not.toMatch(/grid-template-areas/);
    for (const name of ["details", "balance", "aside", "raw"]) expect(inside).toContain(`grid-area: ${name}`);
  });
});

describe("the account link in a box of the flow", () => {
  it("is a 44 px target (20 px of text and the padding), the padding taken back by the margin so that the box does not grow", () => {
    const link = rule(pagesCss, ".flow__node > a");
    const padding = Number.parseFloat(link["padding-block"]!);
    expect(20 + 2 * padding).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(link["margin-block"]!)).toBe(-padding);
  });

  // While AMM_PAGES is on, a pool's label is a link to its pool page (Flow.tsx): a second target in the box, right above the account link.
  it("is at least 24 px under a pool's label that is a link, which is a 24 px target of its own, and the two boxes never overlap", () => {
    const label = rule(pagesCss, ".flow__label > a");
    expect(label.display).toBe("inline-block");
    const around = Number.parseFloat(label["padding-block"]!);
    // The label's 18 px line (12 px type), and the padding the margin takes back.
    expect(18 + 2 * around).toBeGreaterThanOrEqual(24);
    expect(Number.parseFloat(label["margin-block"]!)).toBe(-around);

    // Under such a label the account link's box starts at its text: its padding is all below, taken back by the margin below.
    const account = rule(pagesCss, ".flow__label:has(> a) + a");
    const [top, below] = account["padding-block"]!.split(/\s+/).map(Number.parseFloat) as [number, number];
    expect(top).toBe(0);
    expect(20 + below).toBeGreaterThanOrEqual(44);
    expect(account["margin-block"]!.split(/\s+/).map(Number.parseFloat)).toEqual([0, -below]);
    // So the label's box, which reaches `around` below its line, ends where the gap of the box does: before the account link's.
    expect(Number.parseFloat(rule(pagesCss, ".flow__node").gap!)).toBeGreaterThanOrEqual(around);
  });
});

describe("the margin's controls", () => {
  it.each([".neighbours__link", ".objects__more summary"])("%s is a target of at least 44 px", (selector) => {
    expect(Number.parseFloat(rule(pagesCss, selector)["min-height"]!)).toBeGreaterThanOrEqual(44);
  });
});
