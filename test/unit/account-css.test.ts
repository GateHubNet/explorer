import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// What the stylesheets of the account page must keep: focus rings that the cards do not clip, a panel that holds a link on a blend and
// not on plain --sunken (the Xahau accent is 4.40:1 there), targets of 44 px, and the boxes that must be allowed to shrink so that a
// phone does not scroll sideways.

const read = (name: string) => readFileSync(new URL(`../../app/ui/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const pagesCss = read("pages.css");
const componentsCss = read("components.css");
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
function token(name: string, from = 0): string {
  const match = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(tokensCss.slice(from));
  if (!match) throw new Error(`no ${name}`);
  return match[1]!;
}
const DARK_AT = tokensCss.indexOf("@media (prefers-color-scheme: dark)");
const WHITE = rgb("#ffffff");

describe("the panel of the account page that holds a link", () => {
  const background = rule(pagesCss, ".account-balance--soft").background!;
  const share = Number(/color-mix\(in srgb,\s*var\(--sunken\)\s+(\d+)%,\s*var\(--surface\)\)/.exec(background ?? "")?.[1]) / 100;

  it("is a blend of --sunken and --surface, not plain --sunken", () => {
    expect(Number.isFinite(share)).toBe(true);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
  });

  it.each([
    ["light", 0],
    ["dark", DARK_AT],
  ] as const)("keeps a link of either network's accent at 4.5:1 or more in %s", (mode, from) => {
    const box = mix(rgb(token("--sunken", from)), rgb(token("--surface", from)), share);
    for (const [net, accent] of Object.entries({ xrpl: "#2f5bea", xahau: "#b45309" })) {
      const link = mode === "light" ? rgb(accent) : mix(rgb(accent), WHITE, 0.55);
      expect(contrast(link, box), `${net} in ${mode}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("focus rings inside a card", () => {
  // `.card` clips what is outside its padding box, and these controls sit at its edge: the ring is drawn inside them.
  it.each([
    [".tabs__item:focus-visible", pagesCss],
    [".qr__toggle:focus-visible", pagesCss],
    [".more > summary:focus-visible", pagesCss],
    // The scroll region of a table is focusable (axe: scrollable-region-focusable) and fills its card.
    [".table-scroll:focus-visible", componentsCss],
  ] as const)("%s is drawn inside", (selector, css) => {
    expect(rule(css, selector)["outline-offset"]).toBe("-2px");
  });
});

describe("targets and boxes", () => {
  it("has summaries and the link of the history panel at 44 px", () => {
    expect(rule(pagesCss, ".more > summary")["min-height"]).toBe("44px");
    expect(rule(pagesCss, ".account-balance__link")["min-height"]).toBe("44px");
  });

  it("makes the QR button a 44 px target on touch screens and phones, as every .copy button is", () => {
    const touch = /@media \(pointer: coarse\), \(max-width: 720px\)\s*\{([\s\S]*?)\n\}/.exec(componentsCss)![1]!;
    expect(touch).toMatch(/\.copy\s*\{[^}]*min-height:\s*44px/);
  });

  it("lets the boxes of the page shrink below their content, so that a phone does not scroll sideways", () => {
    expect(rule(pagesCss, ".account-id")["min-width"]).toBe("0");
    expect(rule(pagesCss, ".account-balance")["min-width"]).toBe("0");
    expect(rule(pagesCss, ".activity")["min-width"]).toBe("0");
    expect(rule(pagesCss, ".account-id__address h1")["overflow-wrap"]).toBe("anywhere");
    expect(rule(pagesCss, ".account-balance__value")["overflow-wrap"]).toBe("anywhere");
  });

  it("opens the QR code on a row of its own, under the address", () => {
    expect(rule(pagesCss, ".qr[open]").flex).toBe("1 0 100%");
  });

  it("draws the QR code on white whatever the theme: scanners want dark modules on a light ground", () => {
    const component = readFileSync(new URL("../../app/ui/components/QrButton.tsx", import.meta.url), "utf8");
    expect(component).toContain('fill="#ffffff"');
    expect(component).toContain('fill="#000000"');
  });
});
