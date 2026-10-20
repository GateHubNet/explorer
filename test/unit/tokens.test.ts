import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Spec section 8, verbatim, in app/ui/tokens.css: the light and dark values, the accent of each network, and the
// contrast of the pairs the components put on each other (WCAG 2.2 AA: 4.5:1 for text).

const css = readFileSync(new URL("../../app/ui/tokens.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the rule whose selector is exactly `selector`, searched in `scope` (default: the whole file). */
function block(selector: string, scope: string = css): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(scope);
  if (!match) throw new Error(`no rule for ${selector}`);
  const declarations: Record<string, string> = {};
  for (const [, name, value] of match[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations[name!] = value!.trim().toLowerCase();
  }
  return declarations;
}

/** The text of the `@media (prefers-color-scheme: dark) { ... }` block. */
function darkMedia(): string {
  const at = css.indexOf("@media (prefers-color-scheme: dark)");
  expect(at, "a prefers-color-scheme: dark block").toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

// Declared on :root and on every [data-net] element, see the head of tokens.css.
const light = block(":root, [data-net]");
const darkByAttribute = block(':root[data-theme="dark"], :root[data-theme="dark"] [data-net]');
const darkByMedia = block(':root:not([data-theme="light"]), :root:not([data-theme="light"]) [data-net]', darkMedia());

const LIGHT = {
  "--bg": "#f5f6f8",
  "--surface": "#ffffff",
  "--sunken": "#eef0f3",
  "--border": "#e1e4e9",
  "--border-strong": "#cdd2d9",
  "--fg": "#0f1217",
  "--muted": "#4f5864",
  "--faint": "#646d7a",
  "--ok": "#17733f",
  "--ok-bg": "#e3f3e9",
  "--bad": "#b42318",
  "--bad-bg": "#fcebe9",
};
const DARK = {
  "--bg": "#0b0e12",
  "--surface": "#12161c",
  "--sunken": "#181d24",
  "--border": "#232a33",
  "--border-strong": "#323b46",
  "--fg": "#e7ebf0",
  "--muted": "#a3acb9",
  "--faint": "#8d97a5",
  "--ok": "#5bd08f",
  "--ok-bg": "#10281b",
  "--bad": "#f28b80",
  "--bad-bg": "#30161a",
};

describe("tokens.css", () => {
  it("has the light tokens of spec section 8", () => {
    expect(light).toMatchObject(LIGHT);
  });

  it("has the dark tokens, both for a visitor whose system is dark and for one who chose dark", () => {
    expect(darkByAttribute).toMatchObject(DARK);
    expect(darkByMedia).toMatchObject(DARK);
  });

  it("says the same in the two dark blocks (CSS cannot share them, so this keeps them from drifting)", () => {
    expect(darkByMedia).toEqual(darkByAttribute);
  });

  it("lets a visitor who chose light keep light on a dark system (the media block skips data-theme=light)", () => {
    expect(darkMedia()).toContain(':root:not([data-theme="light"])');
  });

  it("gives each network its accent: XRPL's on pages that belong to neither, and each on its own wrapper", () => {
    const root = block(":root");
    expect(root["--accent-xrpl"]).toBe("#2f5bea");
    expect(root["--accent-xahau"]).toBe("#b45309");
    expect(root["--accent"]).toBe("var(--accent-xrpl)");
    expect(block('[data-net="xrpl"]')["--accent"]).toBe("var(--accent-xrpl)");
    expect(block('[data-net="xahau"]')["--accent"]).toBe("var(--accent-xahau)");
  });

  it("sets --accent only where --link is declared too, so a link follows the wrapper's accent", () => {
    // `--link: var(--accent)` is resolved where it is declared. The wrapper ([data-net]) is in the selector list of
    // every block that declares --link, and none of them declares --accent, which would shadow the network's.
    for (const tokens of [light, darkByAttribute, darkByMedia]) {
      expect(tokens["--link"]).toBeDefined();
      expect(tokens["--accent"]).toBeUndefined();
    }
  });

  it("makes links the accent in light and the accent mixed 55% with white in dark", () => {
    expect(light["--link"]).toBe("var(--accent)");
    expect(darkByAttribute["--link"]).toBe("color-mix(in srgb, var(--accent) 55%, #ffffff)");
    expect(darkByMedia["--link"]).toBe("color-mix(in srgb, var(--accent) 55%, #ffffff)");
  });

  it("defines the chart colours of spec section 8 in their fixed order", () => {
    expect([1, 2, 3, 4, 5].map((n) => light[`--series-${n}`])).toEqual(["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]);
    expect([1, 2, 3, 4, 5].map((n) => darkByAttribute[`--series-${n}`])).toEqual(["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"]);
    expect([light["--up"], light["--down"]]).toEqual(["#2a78d6", "#e34948"]);
    expect([darkByAttribute["--up"], darkByAttribute["--down"]]).toEqual(["#3987e5", "#e66767"]);
    expect(light["--series-other"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(darkByAttribute["--series-other"]).toMatch(/^#[0-9a-f]{6}$/);
  });

  // Spec section 2.10: the grid, the axis, the meter's track and the two washes of the order book's depth.
  const CHART_LIGHT = {
    "--grid": "#eef0f3",
    "--axis": "#cdd2d9",
    "--track": "#cde2fb",
    "--up-wash": "rgba(42,120,214,.13)",
    "--down-wash": "rgba(227,73,72,.12)",
  };
  const CHART_DARK = {
    "--grid": "#1d232b",
    "--axis": "#323b46",
    "--track": "#0d366b",
    "--up-wash": "rgba(57,135,229,.18)",
    "--down-wash": "rgba(230,103,103,.16)",
  };

  it("defines the grid, axis, track and wash tokens of spec section 2.10 in all three blocks", () => {
    expect(light).toMatchObject(CHART_LIGHT);
    expect(darkByAttribute).toMatchObject(CHART_DARK);
    expect(darkByMedia).toMatchObject(CHART_DARK);
  });
});

// --- Contrast ---------------------------------------------------------------------------------------------------

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

/** `rgba(42,120,214,.13)` as its colour and its opacity. */
function rgba(text: string): { color: Rgb; alpha: number } {
  const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(text);
  if (!match) throw new Error(`not an rgba() colour: ${text}`);
  return { color: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: Number(match[4]) };
}
/** A translucent colour painted over an opaque one. Each channel is rounded to an 8-bit integer, as a browser paints it. */
const over = (text: string, backdrop: Rgb): Rgb => {
  const { color, alpha } = rgba(text);
  return color.map((v, i) => Math.round(v * alpha + backdrop[i]! * (1 - alpha))) as Rgb;
};

const ACCENTS = { xrpl: "#2f5bea", xahau: "#b45309" };
const WHITE = rgb("#ffffff");
const AA = 4.5;
const componentsCss = readFileSync(new URL("../../app/ui/components.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the rule whose selector is exactly `selector` in components.css. */
function componentsRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(componentsCss);
  if (!match) throw new Error(`no rule for ${selector} in components.css`);
  return match[1]!;
}

/** The share of --sunken in the background of a hovered table row, as written in components.css. */
const ROW_HOVER_SHARE = Number(/\.table__row:not\(\.table__head\):hover\s*\{[^}]*--sunken\)\s+(\d+)%/.exec(readFileSync(new URL("../../app/ui/components.css", import.meta.url), "utf8"))?.[1]) / 100;

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
] as const)("contrast in %s", (mode, t) => {
  const c = (name: keyof typeof LIGHT) => rgb(t[name]);

  it.each([
    ["--fg", "--bg"],
    ["--fg", "--surface"],
    ["--fg", "--sunken"],
    ["--muted", "--bg"],
    ["--muted", "--surface"],
    ["--muted", "--sunken"],
    ["--faint", "--bg"],
    ["--faint", "--surface"],
    ["--ok", "--ok-bg"],
    ["--bad", "--bad-bg"],
    ["--ok", "--surface"],
    ["--bad", "--surface"],
  ] as const)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrast(c(fg), c(bg))).toBeGreaterThanOrEqual(AA);
  });

  // A hovered table row is --sunken mixed with --surface (components.css, ROW_HOVER_SHARE): the Xahau accent in light mode is
  // 4.40:1 on plain --sunken, just under AA, so links never sit on --sunken itself.
  it.each(Object.entries(ACCENTS))("a link of the %s accent is at least 4.5:1 on bg, surface and a hovered row", (_net, accent) => {
    const link = mode === "light" ? rgb(accent) : mix(rgb(accent), WHITE, 0.55);
    const hoveredRow = mix(c("--sunken"), c("--surface"), ROW_HOVER_SHARE);
    for (const [name, background] of [["--bg", c("--bg")], ["--surface", c("--surface")], ["hovered row", hoveredRow]] as const) {
      expect(contrast(link, background), name).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(Object.entries(ACCENTS))("white text on the %s accent (the search button) is at least 4.5:1", (_net, accent) => {
    expect(contrast(WHITE, rgb(accent))).toBeGreaterThanOrEqual(AA);
  });

  // The result code beside "Success" (ResultPill showCode) is 11 px text in the pill's own colour, so it needs the full 4.5:1.
  // `opacity` makes text fainter than its colour says: 0.85 turned the light success pill's 5.0:1 into 3.9:1. The rule's opacity,
  // if it has one, is modelled here, so a fade comes back as a failure.
  it.each([
    ["--ok", "--ok-bg"],
    ["--bad", "--bad-bg"],
  ] as const)("the result code (.pill__code) in a %s pill is at least 4.5:1 on %s, whatever opacity the rule sets", (fg, bg) => {
    const opacity = Number(/opacity\s*:\s*([\d.]+)/.exec(componentsRule(".pill__code"))?.[1] ?? 1);
    expect(opacity).toBeGreaterThan(0);
    const shown = mix(c(fg), c(bg), opacity); // the text colour blended into the pill's background
    expect(contrast(shown, c(bg))).toBeGreaterThanOrEqual(AA);
  });

  // The charts' tokens (spec section 2.10). Their figures are the spec's, to 2 decimals.
  const chart = mode === "light" ? light : darkByAttribute;
  const TRACK = { light: 3.34, dark: 3.28 }[mode];
  const WASH = { light: { "--up-wash": 6.1, "--down-wash": 6.17 }, dark: { "--up-wash": 6.33, "--down-wash": 6.46 } }[mode];

  it(`the meter's fill (--series-1) on its track is at least 3:1 (${TRACK}:1)`, () => {
    const ratio = contrast(rgb(chart["--series-1"]!), rgb(chart["--track"]!));
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio.toFixed(2)).toBe(TRACK.toFixed(2));
  });

  it.each([
    ["--up-wash", "bids"],
    ["--down-wash", "asks"],
  ] as const)("--muted on %s (the depth of the %s) over --surface is at least 4.5:1, the spec's figure to 2 decimals", (wash, depth) => {
    const painted = over(chart[wash]!, c("--surface"));
    expect(contrast(c("--muted"), painted).toFixed(2), depth).toBe(WASH[wash].toFixed(2));
    expect(contrast(c("--muted"), painted), depth).toBeGreaterThanOrEqual(AA);
  });
});

// Spec 2.5: the marks of the validators and amendments pages. The rules are read from components.css, so a change of the wash, the text colour or
// the background of a rule is a change of the pair tested here. Checked in every block that declares the tokens: light, dark by choice and dark
// by system (the last two are asserted equal above; a drift would show here too).
const BLOCKS = [
  ["light", light],
  ["dark by choice", darkByAttribute],
  ["dark by system", darkByMedia],
] as const;

/** One property of a rule of components.css, as written (`""` when the rule does not set it). `color` does not find `background-color`. */
function ruleProperty(selector: string, name: string): string {
  const match = new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+)`).exec(componentsRule(selector));
  return match?.[1]?.trim() ?? "";
}

/** `--fg` from `var(--fg)`. */
function tokenOf(value: string): string {
  const match = /^var\((--[\w-]+)\)$/.exec(value);
  if (!match) throw new Error(`not a var(): ${value}`);
  return match[1]!;
}

describe.each(BLOCKS)("the status marks in %s", (_block, tokens) => {
  const color = (name: string) => rgb(tokens[name]!);
  const hoveredRow = () => mix(color("--sunken"), color("--surface"), ROW_HOVER_SHARE);

  // `.pill--info`: --fg on the accent wash, 12% accent over --surface, for each network's accent.
  it.each(Object.entries(ACCENTS))("--fg on .pill--info's wash of the %s accent is at least 4.5:1", (_net, accent) => {
    const wash = /^color-mix\(\s*in srgb\s*,\s*var\(--accent\)\s+(\d+)%\s*,\s*var\((--[\w-]+)\)\s*\)$/.exec(ruleProperty(".pill--info", "background"));
    expect(wash, "the background of .pill--info is a color-mix of the accent over a token").not.toBeNull();
    const backdrop = mix(rgb(accent), color(wash![2]!), Number(wash![1]) / 100);
    expect(contrast(color(tokenOf(ruleProperty(".pill--info", "color"))), backdrop)).toBeGreaterThanOrEqual(AA);
  });

  it("--muted on .pill--off, which has no background of its own, is at least 4.5:1 on a card and on a hovered row", () => {
    expect(ruleProperty(".pill--off", "background")).toBe("transparent");
    const text = color(tokenOf(ruleProperty(".pill--off", "color")));
    expect(contrast(text, color("--surface"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(text, hoveredRow())).toBeGreaterThanOrEqual(AA);
  });

  // `.st`: the quiet text with an icon (a domain's verification, "latest", "incomplete") has no background: it sits on a card or a hovered row.
  it.each([".st--ok", ".st--quiet"])("%s text is at least 4.5:1 on a card and on a hovered row", (selector) => {
    expect(ruleProperty(selector, "background")).toBe("");
    const text = color(tokenOf(ruleProperty(selector, "color")));
    expect(contrast(text, color("--surface"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(text, hoveredRow())).toBeGreaterThanOrEqual(AA);
  });
});
