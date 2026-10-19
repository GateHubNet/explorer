import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// What the stylesheet of the chart kit (app/ui/charts.css) must keep, rule by rule: the card's toggle works without script and without
// hiding anything from a browser that cannot do it, targets are 44 px, a refetching page dims its charts, and under forced colours the
// marks and the legend's keys keep their colours, since that is all they say. Every later task of the kit adds the rules of its own marks.

const read = (name: string) => readFileSync(new URL(`../../app/ui/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const chartsCss = read("charts.css");
const componentsCss = read("components.css");
const stylesCss = read("styles.css");

interface Rule {
  /** The rule's selectors, whitespace normalised. */
  selectors: string[];
  declarations: Record<string, string>;
  /** The at-rules it sits in, outermost first: `@media (forced-colors: active)`. */
  at: string[];
}

/** Splits `text` at `separator`, except inside parentheses, brackets and quotes. */
function split(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

function declarationsOf(body: string): Record<string, string> {
  return Object.fromEntries(
    split(body, ";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const colon = declaration.indexOf(":");
        return [declaration.slice(0, colon).trim(), clean(declaration.slice(colon + 1))];
      }),
  );
}

const GROUPING = /^@(media|supports|container|layer)\b/;

/** Every style rule of `css`, with the at-rules around it. (No nesting: the kit's stylesheet does not use it.) */
function parse(css: string, at: string[] = []): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    let depth = 0;
    let close = open;
    for (; close < css.length; close += 1) {
      if (css[close] === "{") depth += 1;
      if (css[close] === "}" && --depth === 0) break;
    }
    if (depth !== 0) throw new Error(`unbalanced braces after ${clean(css.slice(i, open))}`);
    // An at-rule without a body (`@import "x";`) ends at its semicolon, before the next rule's selector.
    const prelude = clean(css.slice(i, open).replace(/^(\s*@[^{;]*;)+/, ""));
    const body = css.slice(open + 1, close);
    if (GROUPING.test(prelude)) rules.push(...parse(body, [...at, prelude]));
    else if (prelude.startsWith("@")) rules.push({ selectors: [prelude], declarations: declarationsOf(body), at });
    else rules.push({ selectors: split(prelude, ",").map(clean), declarations: declarationsOf(body), at });
    i = close + 1;
  }
  return rules;
}

const SUPPORTS_HAS = "@supports selector(:has(*))";

/** The declarations of the rules for exactly `selector`, in the at-rules `at` (none by default), later ones over earlier ones. */
function rule(css: string, selector: string, at: string[] = []): Record<string, string> {
  const found = parse(css).filter((r) => r.selectors.includes(selector) && r.at.join("|") === at.join("|"));
  if (found.length === 0) throw new Error(`no rule for ${selector}${at.length ? ` in ${at.join(" ")}` : ""}`);
  return Object.assign({}, ...found.map((r) => r.declarations));
}

describe("the parser of this test", () => {
  it("reads rules, selector lists, at-rules around them and values with semicolons and commas inside", () => {
    const css = `@import "./a.css";\n.a, .b:is(.c, .d) { color: red; background: url("x;y") }\n@media (min-width: 1px) { @supports selector(:has(*)) { .a:has(b[v="x"]:checked) .e { display: none } } }`;
    expect(parse(css)).toEqual([
      { selectors: [".a", ".b:is(.c, .d)"], declarations: { color: "red", background: 'url("x;y")' }, at: [] },
      { selectors: ['.a:has(b[v="x"]:checked) .e'], declarations: { display: "none" }, at: ["@media (min-width: 1px)", "@supports selector(:has(*))"] },
    ]);
    expect(() => rule(css, ".missing")).toThrow("no rule for .missing");
  });
});

describe("the stylesheet", () => {
  it("is imported after the components, before the pages", () => {
    const imports = [...stylesCss.matchAll(/@import\s+"\.\/([^"]+)"/g)].map((match) => match[1]);
    expect(imports.indexOf("charts.css")).toBe(imports.indexOf("components.css") + 1);
    expect(imports.indexOf("pages.css")).toBe(imports.indexOf("charts.css") + 1);
  });
});

describe("the card", () => {
  it("is a container, so that the plot can ask for its width and not the window's", () => {
    expect(rule(chartsCss, ".chart")["container-type"]).toBe("inline-size");
  });

  it("is dimmed, with no skeleton, while the page refetches", () => {
    expect(rule(chartsCss, ".is-refetching .chart").opacity).toBe("0.55");
  });
});

describe("the Chart/Table toggle", () => {
  it("has labels that are 44 px targets", () => {
    expect(rule(chartsCss, ".chart__toggle label")["min-height"]).toBe("44px");
  });

  it("keeps the radios in the page for a keyboard and a screen reader, only out of sight", () => {
    const radio = rule(chartsCss, ".chart__toggle input");
    expect(radio.position).toBe("absolute");
    expect(radio.opacity).toBe("0");
    for (const hidden of ["display", "visibility"]) expect(radio[hidden], hidden).toBeUndefined();
  });

  it("draws the focus ring on the label, inside it, where neither the trough nor the card clips it", () => {
    const ring = rule(chartsCss, ".chart__toggle label:has(input:focus-visible)", [SUPPORTS_HAS]);
    expect(ring.outline).toMatch(/^2px solid var\(--link\)$/);
    expect(ring["outline-offset"]).toBe("-2px");
  });

  it("marks the checked label", () => {
    expect(rule(chartsCss, ".chart__toggle label:has(input:checked)", [SUPPORTS_HAS]).background).toBe("var(--surface)");
  });

  it("switches the views in the CSS, where :has() is supported", () => {
    expect(rule(chartsCss, ".chart .chart__table", [SUPPORTS_HAS]).display).toBe("none");
    expect(rule(chartsCss, '.chart:has(input[value="table"]:checked) .chart__view', [SUPPORTS_HAS]).display).toBe("none");
    expect(rule(chartsCss, '.chart:has(input[value="table"]:checked) .chart__table', [SUPPORTS_HAS]).display).toBe("block");
  });

  it("hides neither view where :has() is not supported: both show", () => {
    const hides = (d: Record<string, string>) => d.display === "none" || d.visibility === "hidden" || d["content-visibility"] === "hidden";
    const hiding = parse(chartsCss).filter((r) => !r.at.includes(SUPPORTS_HAS) && r.selectors.some((selector) => /\.chart__(view|table)\b/.test(selector)) && hides(r.declarations));
    expect(hiding).toEqual([]);
  });

  it("is shown only where it works: a toggle that changed nothing would be a dead control", () => {
    expect(rule(chartsCss, ".chart__toggle").display).toBe("none");
    expect(rule(chartsCss, ".chart__toggle", [SUPPORTS_HAS]).display).toBe("flex");
  });
});

describe("the legend", () => {
  it("draws a swatch of 10 × 10 px with a 2 px radius", () => {
    expect(rule(chartsCss, ".legend__swatch")).toMatchObject({ width: "10px", height: "10px", "border-radius": "2px" });
  });

  it("draws a line key of 14 × 2 px", () => {
    expect(rule(chartsCss, ".legend__line")).toMatchObject({ width: "14px", height: "2px" });
  });

  it("colours a key by its slot, with the tokens of the series", () => {
    expect(rule(chartsCss, ".legend__swatch").background).toBe("var(--mark)");
    expect(rule(chartsCss, ".legend__line").background).toBe("var(--mark)");
    const tokens: Record<string, string> = {
      "1": "--series-1",
      "2": "--series-2",
      "3": "--series-3",
      "4": "--series-4",
      "5": "--series-5",
      other: "--series-other",
      up: "--up",
      down: "--down",
      neutral: "--series-other",
    };
    for (const [slot, token] of Object.entries(tokens)) {
      expect(rule(chartsCss, `[data-slot="${slot}"]`)["--mark"], slot).toBe(`var(${token})`);
    }
  });

  it("keeps the colours of its keys under forced colours, which is all they say", () => {
    for (const selector of [".legend__swatch", ".legend__line"]) {
      expect(rule(chartsCss, selector, ["@media (forced-colors: active)"])["forced-color-adjust"], selector).toBe("none");
    }
  });
});

describe("the tables of the charts (components.css)", () => {
  it("has rows of 34 px when compact", () => {
    expect(rule(componentsCss, ".table__row.table--compact")["min-height"]).toBe("34px");
    expect(rule(componentsCss, ".table__head.table--compact")["min-height"]).toBe("34px");
  });

  it("keeps the header row in view inside a region with a height cap, on an opaque ground", () => {
    expect(rule(componentsCss, ".table-scroll--capped")["overflow-y"]).toBe("auto");
    expect(rule(componentsCss, ".table-scroll--capped .table__head")).toMatchObject({ position: "sticky", top: "0", background: "var(--surface)" });
  });
});
