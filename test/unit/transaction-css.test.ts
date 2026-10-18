import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// What the stylesheets of the transaction page must keep: links that stay readable on the tinted box of the flow, a focus ring
// that the card does not clip, hex that wraps, and targets of 44 px.

const read = (name: string) => readFileSync(new URL(`../../app/ui/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const pagesCss = read("pages.css");
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

describe("the wide column", () => {
  it("may be narrower than the balance table's minimum width, which scrolls inside its card (or a phone scrolls sideways)", () => {
    expect(rule(pagesCss, ".stack")["min-width"]).toBe("0");
  });
});

describe("the account link in a box of the flow", () => {
  it("is a 44 px target (20 px of text and the padding), the padding taken back by the margin so that the box does not grow", () => {
    const link = rule(pagesCss, ".flow__node > a");
    const padding = Number.parseFloat(link["padding-block"]!);
    expect(20 + 2 * padding).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(link["margin-block"]!)).toBe(-padding);
  });
});

describe("the margin's controls", () => {
  it.each([".neighbours__link", ".objects__more summary"])("%s is a target of at least 44 px", (selector) => {
    expect(Number.parseFloat(rule(pagesCss, selector)["min-height"]!)).toBeGreaterThanOrEqual(44);
  });
});
