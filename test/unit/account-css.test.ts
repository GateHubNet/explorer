import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// What the stylesheets of the account page must keep: focus rings that the cards do not clip, a panel that holds a link on a blend and
// not on plain --sunken, targets of 44 px, and the boxes that must be allowed to shrink so that a
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
const BLACK = rgb("#000000");

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
    for (const [net, accent] of Object.entries({ xrpl: "#0a6cf1", xahau: "#b45309" })) {
      const link = mode === "light" ? mix(rgb(accent), BLACK, 0.82) : mix(rgb(accent), WHITE, 0.55);
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

  it("makes the QR button a 44 px target on touch screens and phones, as every .copy button is, and every .btn too (the Objects tab's row button: its 36 px is the desktop's)", () => {
    const touch = /@media \(pointer: coarse\), \(max-width: 720px\)\s*\{([\s\S]*?)\n\}/.exec(componentsCss)![1]!;
    expect(touch).toMatch(/\.copy\s*\{[^}]*min-height:\s*44px/);
    expect(touch).toMatch(/\.btn,[^{}]*\{[^}]*min-height:\s*44px/);
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

describe("the activation line", () => {
  // The line under the address reads "Activated on <date> by <parent> with 25 XRP · domain northpeak.example": once an account's domain lengthens it, axe reads it as a
  // sentence of muted text, and the date's link is told from the words around it by its colour alone (link-in-text-block).
  it("underlines the date's link, so that more than its colour tells it from the words around it", () => {
    expect(rule(pagesCss, ".account-id__meta > a.num")["text-decoration"]).toBe("underline");
  });
});

describe("the name header (display names spec 6.1 to 6.4)", () => {
  it("has the 'How we know' summary at 44 px, a native disclosure's summary with its marker drawn by the page", () => {
    expect(rule(componentsCss, ".disc > summary")["min-height"]).toBe("44px");
    expect(rule(componentsCss, ".disc > summary")["list-style"]).toBe("none");
  });

  it("turns the chevron when the disclosure is open", () => {
    expect(rule(componentsCss, ".disc[open] .disc__chevron").transform).toBe("rotate(90deg)");
  });

  // `--link` against the text colour is under 3:1 (2.88:1 on XRPL, 2.73:1 on Xahau, 2.06:1 in dark), so a link in a sentence is told from it by more than its colour (WCAG 1.4.1;
  // axe cannot say it here: the hidden "(opens in a new tab)" of an `ExternalLink` makes its check incomplete). AccountPage.test.tsx holds every link the header draws to these.
  it("underlines the links in its muted lines, in the checks of 'How we know' and in a warning banner, so that more than their colour tells them from the words around them (WCAG 1.4.1)", () => {
    const underlined = [...componentsCss.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, , body]) => /text-decoration:\s*underline/.test(body!))
      .flatMap(([, selectors]) => selectors!.split(",").map((selector) => selector.trim()));
    expect(underlined).toEqual(expect.arrayContaining([".account-head__kind a", ".disc__checks a", ".notice--warning a"]));
  });

  it.each([
    ["light", 0],
    ["dark", DARK_AT],
  ] as const)("holds the facts' labels (--muted) at 4.5:1 or more on the box's --sunken in %s, and the box has no ground but that", (_mode, from) => {
    expect(rule(componentsCss, ".disc__box").background).toBe("var(--sunken)");
    expect(rule(componentsCss, ".toml-facts dt").color).toBe("var(--muted)");
    expect(contrast(rgb(token("--muted", from)), rgb(token("--sunken", from)))).toBeGreaterThanOrEqual(4.5);
  });

  it("makes a banner's 'Details' link a target of 24 px at least: it is a flex item, not a word in a sentence", () => {
    expect(rule(componentsCss, ".label-banner__meta a")["min-height"]).toBe("24px");
  });

  it("cuts a name in the breadcrumb's last item by the stylesheet, which lets it shrink", () => {
    const cut = rule(componentsCss, ".crumbs [aria-current]:has(> .acct__name)");
    expect(cut.display).toBe("flex");
    expect(cut["min-width"]).toBe("0");
  });

  it("lets the h1 and the address under it wrap, so that a phone does not scroll sideways, and keeps the marks in the h1's line of text", () => {
    expect(rule(componentsCss, ".account-head__name")["overflow-wrap"]).toBe("anywhere");
    expect(rule(componentsCss, ".account-head__name")["min-width"]).toBe("0");
    expect(rule(componentsCss, ".account-head__address")["overflow-wrap"]).toBe("anywhere");
    // Not a flex container: its marks would wrap to a line of their own under a name that wraps.
    expect(rule(componentsCss, ".account-head__name").display).toBeUndefined();
  });
});
