import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// What the stylesheet of the chart kit (app/ui/charts.css) must keep, rule by rule: the card's toggle works without script and without
// hiding anything from a browser that cannot do it, targets are 44 px, a refetching page dims its charts, and under forced colours the
// marks and the legend's keys keep their colours, since that is all they say. The plot has its frame here: the gridlines, the labels, the
// heights, the cursor and its ring. Every later task of the kit adds the rules of its own marks: the columns, the lines and the panels.

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
/** The card is the container; a plot narrower than this has fewer labels and a lower height (spec 2.7). */
const NARROW = "@container (width < 480px)";
const REDUCED = "@media (prefers-reduced-motion: reduce)";

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

describe("the plot", () => {
  it("is 200 px high, and 160 px under a 480 px container (geometry.ts: PLOT_HEIGHT)", () => {
    expect(rule(chartsCss, ".plot").height).toBe("200px");
    expect(rule(chartsCss, ".plot", [NARROW]).height).toBe("160px");
  });

  it("has the gutters of the y labels and the end labels as high as the plot, at every width, so that a label is level with its line", () => {
    for (const selector of [".plot__y", ".plot__end"]) {
      expect(rule(chartsCss, selector).height, selector).toBe("200px");
      expect(rule(chartsCss, selector, [NARROW]).height, selector).toBe("160px");
    }
    // Not stretched to the region beside them, which a scrollbar can make higher than the plot.
    expect(rule(chartsCss, ".plot__frame")["align-items"]).toBe("flex-start");
  });

  it("is 64 px for the volume pane and 110 px for a small multiple at any width, in the plot and in the gutters", () => {
    for (const [kind, px] of [["pane", "64px"], ["panel", "110px"]] as const) {
      const selector = `.plot__frame--${kind} :is(.plot, .plot__y, .plot__end)`;
      expect(rule(chartsCss, selector).height, kind).toBe(px);
      // Over the container's rule by specificity, not by where it is written.
      expect(parse(chartsCss).filter((r) => r.selectors.includes(selector) && r.at.length > 0), kind).toEqual([]);
    }
  });

  it("is a box that its marks and labels are positioned in, and so is the frame, for the tooltip that the region cannot clip", () => {
    expect(rule(chartsCss, ".plot__frame").position).toBe("relative");
    expect(rule(chartsCss, ".plot").position).toBe("relative");
    expect(rule(chartsCss, ".plot__marks").position).toBe("absolute");
  });

  it("draws a gridline of 1 px --grid, and the 0 line in --axis", () => {
    expect(rule(chartsCss, ".plot__grid")["border-top"]).toBe("1px solid var(--grid)");
    expect(rule(chartsCss, ".plot__grid.is-base")["border-top-color"]).toBe("var(--axis)");
  });

  it("puts the y labels in a gutter of the longest label's characters and 8 px, sized with nothing measured", () => {
    expect(rule(chartsCss, ".plot__y").width).toBe("calc(var(--chars) * 1ch + 8px)");
    expect(rule(chartsCss, ".plot__y")["font-variant-numeric"]).toBe("tabular-nums");
    expect(rule(chartsCss, ".plot__y")["font-size"]).toBe("11px");
    expect(rule(chartsCss, ".plot__y")["color"]).toBe("var(--faint)");
    expect(rule(chartsCss, ".plot__y span")["transform"]).toBe("translateY(50%)");
  });

  it("shows the wide set of x labels, and the narrow set under a 480 px container", () => {
    expect(rule(chartsCss, ".plot__x--narrow").display).toBe("none");
    // The wide set is the default, so a browser without container queries still has labels.
    expect(parse(chartsCss).filter((r) => r.selectors.includes(".plot__x--wide") && r.at.length === 0)).toEqual([]);
    expect(rule(chartsCss, ".plot__x--wide", [NARROW]).display).toBe("none");
    expect(rule(chartsCss, ".plot__x--narrow", [NARROW]).display).toBe("block");
  });

  it("writes the x labels in --faint 11 px, centred on their place", () => {
    expect(rule(chartsCss, ".plot__x")).toMatchObject({ color: "var(--faint)", "font-size": "11px", position: "absolute" });
    expect(rule(chartsCss, ".plot__x span")).toMatchObject({ transform: "translateX(-50%)", "white-space": "nowrap" });
  });

  it("scrolls sideways for slots only, in a region whose focus ring is drawn inside it", () => {
    expect(rule(chartsCss, ".plot__scroll")["overflow-x"]).toBeUndefined();
    expect(rule(chartsCss, ".plot__scroll--slots")["overflow-x"]).toBe("auto");
    expect(rule(chartsCss, ".plot__scroll--slots")["overflow-y"]).toBe("hidden");
    expect(rule(chartsCss, ".plot__scroll:focus-visible")["outline-offset"]).toBe("-2px");
  });

  it("leaves room in the scroll region for the ring, which it would clip, without moving the plot", () => {
    const region = rule(chartsCss, ".plot__scroll--slots");
    expect(region.margin).toBe("-3px -16px -3px -3px");
    expect(region.padding).toBe("3px 16px calc(var(--x-band) + 3px) 3px");
  });

  it("leaves room at the end of the scroll region for the newest x label, half of which is past the last band: 16 px, inside the card's 18", () => {
    const region = rule(chartsCss, ".plot__scroll--slots");
    // The padding gives it and the margin takes it back, so that the plot is where it was; the room is in the card's padding, not past its edge.
    const end = parseInt(region.padding!.split(" ")[1]!, 10);
    expect(end).toBe(16);
    expect(region.margin!.split(" ")[1]).toBe(`-${end}px`);
    expect(end).toBeLessThanOrEqual(parseInt(rule(chartsCss, ".chart").padding!.split(" ")[1]!, 10));
  });

  it("leaves the end labels' gutter out under a 480 px container (its width is Plot's, from END_LABEL_GUTTER_PX)", () => {
    expect(rule(chartsCss, ".plot__end", [NARROW]).display).toBe("none");
    expect(rule(chartsCss, ".plot__end").flex).toBe("none");
  });

  it("leaves the room of the x labels under the plot, in the region that scrolls with them", () => {
    expect(rule(chartsCss, ".plot__scroll")["padding-bottom"]).toBe("var(--x-band)");
    expect(rule(chartsCss, ".plot__x").height).toBe("var(--x-band)");
    expect(rule(chartsCss, ".plot__frame")["--x-band"]).toBe("24px");
  });

  it("centres the empty text in --muted", () => {
    expect(rule(chartsCss, ".plot__empty")).toMatchObject({ position: "absolute", color: "var(--muted)", "text-align": "center" });
  });
});

describe("the cursor", () => {
  it("lets a finger scroll the page up and down and takes the sideways drag", () => {
    expect(rule(chartsCss, ".plot__cursor")["touch-action"]).toBe("pan-y");
  });

  it("lets a finger scroll a region that scrolls sideways, and still select with a tap: that is what the region is for", () => {
    expect(rule(chartsCss, ".plot__scroll--slots .plot__cursor")["touch-action"]).toBe("pan-x pan-y");
    // Anywhere else a drag along the plot is the cursor's.
    expect(rule(chartsCss, ".plot__cursor")["touch-action"]).toBe("pan-y");
  });

  it("covers the whole plot, a hit area larger than any mark", () => {
    expect(rule(chartsCss, ".plot__cursor")).toMatchObject({ position: "absolute", inset: "0" });
  });

  it("draws its focus ring inside, where a scroll region or the card around the plot does not clip it", () => {
    expect(rule(chartsCss, ".plot__cursor:focus-visible")["outline-offset"]).toBe("-2px");
  });

  it("draws a crosshair of 1 px --border-strong", () => {
    expect(rule(chartsCss, ".plot__crosshair")).toMatchObject({ width: "1px", background: "var(--border-strong)" });
  });

  it("draws a dot of 8 px in its slot's colour, with a ring of 2 px --surface", () => {
    expect(rule(chartsCss, ".plot__dot")).toMatchObject({
      width: "8px",
      height: "8px",
      "border-radius": "50%",
      background: "var(--mark)",
      "box-shadow": "0 0 0 2px var(--surface)",
    });
  });

  it("keeps the crosshair, the dots and the tooltip from taking the pointer", () => {
    for (const selector of [".plot__crosshair", ".plot__dot", ".plot__tip"]) expect(rule(chartsCss, selector)["pointer-events"], selector).toBe("none");
  });

  it("opens the tooltip at most min(260px, 90%) wide, on the right, on the left, or centred", () => {
    expect(rule(chartsCss, ".plot__tip")["max-width"]).toBe("min(260px, 90%)");
    expect(rule(chartsCss, ".plot__tip")["position"]).toBe("absolute");
    expect(rule(chartsCss, ".plot__tip.right").transform).toBe("translateX(8px)");
    expect(rule(chartsCss, ".plot__tip.left").transform).toBe("translateX(calc(-100% - 8px))");
    expect(rule(chartsCss, ".plot__tip.center").transform).toBe("translateX(-50%)");
  });

  it("keeps the dots' colours under forced colours, as identity is all they say", () => {
    expect(rule(chartsCss, ".plot__dot", ["@media (forced-colors: active)"])["forced-color-adjust"]).toBe("none");
  });
});

describe("the columns (ColumnChart)", () => {
  it("lays the slots of a plot out as equal shares of its width, which are the bands the cursor reads", () => {
    expect(rule(chartsCss, ".plot__cols")).toMatchObject({ position: "absolute", inset: "0", display: "flex" });
    expect(rule(chartsCss, ".col")).toMatchObject({ position: "relative", flex: "1 1 0", "min-width": "0" });
  });

  it("makes a bar at most 24 px wide, at most 72% of its slot, and 2 px short of it: the gap", () => {
    expect(rule(chartsCss, ".col__bar").width).toBe("min(24px, 72%, calc(100% - 2px))");
  });

  it("stands a bar on the bottom of its slot, in the middle of it, with no tween", () => {
    expect(rule(chartsCss, ".col__bar")).toMatchObject({ position: "absolute", bottom: "0", left: "0", right: "0", margin: "0 auto" });
    for (const selector of [".col", ".col__bar", ".col__seg"]) {
      expect(rule(chartsCss, selector).transition, selector).toBeUndefined();
      expect(rule(chartsCss, selector).animation, selector).toBeUndefined();
    }
  });

  it("rounds the top of a stack by 4 px and leaves its base square, and rounds the bottom of a diverging down bar instead", () => {
    expect(rule(chartsCss, ".col__bar")["border-radius"]).toBe("4px 4px 0 0");
    expect(rule(chartsCss, ".col__bar--down")["border-radius"]).toBe("0 0 4px 4px");
    // The segments are cut at the radius.
    expect(rule(chartsCss, ".col__bar").overflow).toBe("hidden");
  });

  it("stacks the segments from the bottom, so that the first in the DOM is the lowest", () => {
    expect(rule(chartsCss, ".col__bar")).toMatchObject({ display: "flex", "flex-direction": "column-reverse" });
    expect(rule(chartsCss, ".col__seg").flex).toBe("none");
  });

  it("draws a bar and a segment in the colour of its slot", () => {
    expect(rule(chartsCss, ".col__seg").background).toBe("var(--mark)");
    expect(rule(chartsCss, ".col__bar[data-slot]").background).toBe("var(--mark)");
  });

  it("insets every segment but the highest by 2 px of --surface at its top, so that the totals stay exact", () => {
    expect(rule(chartsCss, ".col__seg:not(:last-child)")["box-shadow"]).toBe("inset 0 2px 0 var(--surface)");
    // The highest has none, and neither has a rule that would give one to all.
    expect(parse(chartsCss).filter((r) => r.selectors.includes(".col__seg") && r.declarations["box-shadow"] !== undefined)).toEqual([]);
  });

  it("dims the other columns to 45% while one is hovered, and not the hovered one", () => {
    expect(rule(chartsCss, ".plot[data-active] .col:not(.is-active)").opacity).toBe("0.45");
  });

  it("writes an annotation in --bad above its column, keeping it inside the plot", () => {
    const note = rule(chartsCss, ".col__note");
    expect(note.color).toBe("var(--bad)");
    expect(note.position).toBe("absolute");
    expect(note.bottom).toBe("min(calc(var(--top) + 2px), calc(100% - 12px))");
    expect(note["pointer-events"]).toBe("none");
  });

  it("keeps the colours of the bars, the segments and the tooltip's keys under forced colours, since that is what they say", () => {
    for (const selector of [".col__bar", ".col__seg", ".plot__tip-key"]) {
      expect(rule(chartsCss, selector, ["@media (forced-colors: active)"])["forced-color-adjust"], selector).toBe("none");
    }
  });
});

describe("the lines (LineChart)", () => {
  it("draws a line 2 px wide at any width: the svg is stretched, so the stroke does not scale with it", () => {
    expect(rule(chartsCss, ".line")).toMatchObject({
      "stroke-width": "2",
      "vector-effect": "non-scaling-stroke",
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
      fill: "none",
    });
  });

  it("draws a line in the colour of its slot, and an area in the same colour at 10%", () => {
    expect(rule(chartsCss, ".line").stroke).toBe("var(--mark)");
    expect(rule(chartsCss, ".area")).toMatchObject({ fill: "var(--mark)", "fill-opacity": "0.1" });
    // An area has no outline: the line over it is the edge.
    expect(rule(chartsCss, ".area")["vector-effect"]).toBeUndefined();
    expect(rule(chartsCss, ".area").stroke).toBeUndefined();
  });

  it("stretches the svg over the plot and lets the line at the edge of the scale keep its whole width, which the box would cut by half", () => {
    expect(rule(chartsCss, ".lines")).toMatchObject({ position: "absolute", inset: "0", width: "100%", height: "100%", overflow: "visible" });
  });

  it("draws a reference as a line of 1.5 px dashed in --muted across the plot, which takes no pointer", () => {
    const reference = rule(chartsCss, ".ref");
    expect(reference).toMatchObject({ position: "absolute", left: "0", right: "0", "border-top": "1.5px dashed var(--muted)", "pointer-events": "none" });
  });

  it("keeps dashes for references: no other rule of the stylesheet has them, and the gridlines are solid", () => {
    const dashed = parse(chartsCss).filter((r) => Object.values(r.declarations).some((value) => /\bdash(ed)?\b/.test(value)));
    expect(dashed.map((r) => r.selectors)).toEqual([[".ref"]]);
    expect(rule(chartsCss, ".plot__grid")["border-top"]).toBe("1px solid var(--grid)");
  });

  it("labels a reference in --fg on a --surface chip, on the line, inside the plot", () => {
    expect(rule(chartsCss, ".ref__label")).toMatchObject({ position: "absolute", color: "var(--fg)", background: "var(--surface)", "white-space": "nowrap" });
    expect(rule(chartsCss, ".ref__label").transform).toBe("translateY(-50%)");
  });

  it("writes an end label in --muted at 12 px, level with its dot, with the figure strong in --fg", () => {
    expect(rule(chartsCss, ".plot__end-label")).toMatchObject({ position: "absolute", left: "8px", transform: "translateY(-50%)", "white-space": "nowrap" });
    expect(rule(chartsCss, ".plot__end-label b")).toMatchObject({ color: "var(--fg)", "font-weight": "600" });
    // The gutter has the colour and the size, which Plot's frame sets.
    expect(rule(chartsCss, ".plot__end")).toMatchObject({ color: "var(--muted)", "font-size": "12px" });
  });

  it("keeps the colours of the lines and the areas under forced colours, since that is what identifies a series", () => {
    for (const selector of [".line", ".area"]) {
      expect(rule(chartsCss, selector, ["@media (forced-colors: active)"])["forced-color-adjust"], selector).toBe("none");
    }
  });

  it("has no transition or animation on a line: it redraws in place", () => {
    for (const selector of [".line", ".area", ".ref"]) {
      expect(rule(chartsCss, selector).transition, selector).toBeUndefined();
      expect(rule(chartsCss, selector).animation, selector).toBeUndefined();
    }
  });
});

describe("the small multiples (SmallMultiples)", () => {
  it("is a grid of panels at least 240 px wide, as many as fit", () => {
    expect(rule(chartsCss, ".multiples")).toMatchObject({ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(240px, 1fr))" });
  });

  it("lets a panel shrink with its track, and stacks its header over its plot", () => {
    expect(rule(chartsCss, ".panel")).toMatchObject({ display: "flex", "flex-direction": "column", "min-width": "0" });
  });

  it("puts the label at the start of a panel's header and the readout at the end, on the baseline", () => {
    expect(rule(chartsCss, ".panel__head")).toMatchObject({ display: "flex", "justify-content": "space-between", "align-items": "baseline" });
    expect(rule(chartsCss, ".panel__name")["font-weight"]).toBe("600");
    expect(rule(chartsCss, ".panel__value")).toMatchObject({ color: "var(--fg)", "font-weight": "600", "font-variant-numeric": "tabular-nums" });
  });

  it("clips nothing and makes no stacking context, so that a panel's tooltip is not cut at the panel's edge or hidden under the next panel (the card clips at its own edge)", () => {
    const clipping = ["overflow", "overflow-x", "overflow-y", "contain", "clip-path", "z-index", "transform", "opacity", "isolation", "filter", "will-change"];
    for (const selector of [".multiples", ".panel", ".panel__head"]) {
      const declarations = rule(chartsCss, selector);
      for (const property of clipping) expect(declarations[property], `${selector} ${property}`).toBeUndefined();
    }
    // The tooltip is in the panel's frame, near its top, and above the plots that follow it.
    expect(rule(chartsCss, ".plot__tip")).toMatchObject({ top: "6px", "z-index": "3" });
    expect(rule(chartsCss, ".plot__frame--panel :is(.plot, .plot__y, .plot__end)").height).toBe("110px");
  });

  it("keeps the panels' x labels at the plot's two ends inside it: the first starts at the left and the last ends at the right, a lone one is centred", () => {
    expect(rule(chartsCss, ".plot__x--ends span:first-child").transform).toBe("none");
    expect(rule(chartsCss, ".plot__x--ends span:last-child").transform).toBe("translateX(-100%)");
    expect(rule(chartsCss, ".plot__x--ends span:only-child").transform).toBe("translateX(-50%)");
    // The set is shown at any width: it has no display rule, as the wide and narrow sets have.
    expect(parse(chartsCss).filter((r) => r.selectors.includes(".plot__x--ends") && r.declarations.display !== undefined)).toEqual([]);
  });

  it("says that there is nothing to show in the grid's whole width, in --muted", () => {
    expect(rule(chartsCss, ".multiples__empty")).toMatchObject({ color: "var(--muted)", "grid-column": "1 / -1" });
  });
});

describe("the stylesheets of the document", () => {
  /** The class names of the selectors of a sheet's style rules. */
  const classesOf = (css: string) => {
    const selectors = parse(css).flatMap((r) => r.selectors).filter((selector) => !selector.startsWith("@"));
    return new Set(selectors.flatMap((selector) => [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]!)));
  };

  it("do not define a class of the kit's in the pages' sheet: pages.css comes after charts.css and would override its rules", () => {
    // `.cols`, a page's columns (wrap, a 20 px gap, top-aligned), was the kit's row of column slots too, and over the kit's rule it made every
    // slot 0 px high and the bars of a chart invisible: jsdom has no stylesheet to show it.
    const pages = classesOf(read("pages.css"));
    expect([...classesOf(chartsCss)].filter((name) => pages.has(name))).toEqual([]);
  });

  it("lays the slots of a plot out in a class of the plot's own, which the pages' columns do not share", () => {
    expect(classesOf(chartsCss).has("plot__cols")).toBe(true);
    expect(classesOf(read("pages.css")).has("cols")).toBe(true);
    expect(classesOf(chartsCss).has("cols")).toBe(false);
  });
});

describe("the candles (Candles)", () => {
  it("has no scrollbar on the upper pane, whose region follows the lower one's, which has it under the x labels", () => {
    const upper = rule(chartsCss, ".candles .plot__frame--bare .plot__scroll");
    expect(upper["scrollbar-width"]).toBe("none");
    expect(rule(chartsCss, ".candles .plot__frame--bare .plot__scroll::-webkit-scrollbar").display).toBe("none");
  });

  it("fills the slot of the plot with the candle, so that its wick and body are placed in percent of the plot's height", () => {
    expect(rule(chartsCss, ".candle")).toMatchObject({ position: "absolute", inset: "0" });
  });

  it("draws the wick 1 px wide, in the middle of its slot, in the candle's colour", () => {
    expect(rule(chartsCss, ".candle__wick")).toMatchObject({
      position: "absolute",
      left: "50%",
      width: "1px",
      transform: "translateX(-50%)",
      background: "var(--mark)",
    });
  });

  it("draws the body min(9px, 62%) wide, at least 1 px high, in the middle of its slot, in the candle's colour", () => {
    expect(rule(chartsCss, ".candle__body")).toMatchObject({
      position: "absolute",
      left: "50%",
      width: "min(9px, 62%)",
      "min-height": "1px",
      transform: "translateX(-50%)",
      background: "var(--mark)",
    });
  });

  it("colours a candle by its slot: --up for one that closed higher (or where it opened), --down for one that closed lower", () => {
    expect(rule(chartsCss, '[data-slot="up"]')["--mark"]).toBe("var(--up)");
    expect(rule(chartsCss, '[data-slot="down"]')["--mark"]).toBe("var(--down)");
    // The slot is the candle's: nothing in the stylesheet gives a wick or a body a colour of its own.
    for (const selector of [".candle", ".candle__wick", ".candle__body"]) {
      expect(rule(chartsCss, selector).color, selector).toBeUndefined();
    }
  });

  it("dims the other candles to 45% while one is hovered, as the columns are: the slot is the column's", () => {
    expect(rule(chartsCss, ".plot[data-active] .col:not(.is-active)").opacity).toBe("0.45");
  });

  it("draws the volume columns as wide as the bodies above them, with a 2 px radius at the top, in the colour of the slot", () => {
    expect(rule(chartsCss, ".col__bar--volume")).toMatchObject({ width: "min(9px, 62%)", "border-radius": "2px 2px 0 0" });
    expect(rule(chartsCss, '[data-slot="other"]')["--mark"]).toBe("var(--series-other)");
    // It wins over the column's own width by coming after it.
    const order = parse(chartsCss).findIndex((r) => r.selectors.includes(".col__bar--volume")) - parse(chartsCss).findIndex((r) => r.selectors.includes(".col__bar"));
    expect(order).toBeGreaterThan(0);
  });

  it("stacks the readout over the price pane and the volume pane, which are one chart: no gap that would read as two", () => {
    expect(rule(chartsCss, ".candles")).toMatchObject({ display: "flex", "flex-direction": "column", "min-width": "0" });
    expect(rule(chartsCss, ".candles__readout")).toMatchObject({ display: "flex", "flex-wrap": "wrap", "font-variant-numeric": "tabular-nums", color: "var(--muted)" });
    expect(rule(chartsCss, ".candles__time").color).toBe("var(--fg)");
  });

  it("keeps the colours of the candles and the volume columns under forced colours, since up and down is all they say", () => {
    for (const selector of [".candle__wick", ".candle__body", ".col__bar"]) {
      expect(rule(chartsCss, selector, ["@media (forced-colors: active)"])["forced-color-adjust"], selector).toBe("none");
    }
  });
});

describe("the right axis (Plot yAxis right)", () => {
  it("puts the labels 8 px from the plot's end, not from the gutter's right edge", () => {
    expect(rule(chartsCss, ".plot__y--right span")).toMatchObject({ right: "auto", left: "8px" });
  });

  it("leaves the room of the x labels out of a frame that has none: the upper pane of two", () => {
    expect(rule(chartsCss, ".plot__frame--bare")["--x-band"]).toBe("0px");
  });

  it("covers the end room of the scroll region, which the region extends under the gutter, so that a plot scrolled under it does not show through the labels", () => {
    const gutter = rule(chartsCss, ".plot__y--right");
    expect(gutter.background).toBe("var(--surface)");
    // The ring of a change is 3 px outside the plot, and the gutter starts after it.
    expect(gutter["margin-left"]).toBe("3px");
  });
});

describe("the share bars (ShareBar)", () => {
  it("has rows of a column for the label and a column for the bar, and a gap between them", () => {
    expect(rule(chartsCss, ".share__row")).toMatchObject({ display: "grid", "grid-template-columns": "72px minmax(0, 1fr)" });
    // A long label breaks inside its 72 px.
    expect(rule(chartsCss, ".share__name")).toMatchObject({ "min-width": "0", "overflow-wrap": "anywhere" });
  });

  it("puts the label and the total over the bar under 480 px of card, so that the bars have the card's width and a segment of 18% holds its label", () => {
    expect(rule(chartsCss, ".share__row", [NARROW])["grid-template-columns"]).toBe("minmax(0, 1fr)");
    expect(rule(chartsCss, ".share__name", [NARROW])["flex-direction"]).toBe("row");
    // The axis has no column to keep, so its spacer goes.
    expect(rule(chartsCss, ".share__row--axis > :first-child", [NARROW]).display).toBe("none");
    // Over 480 px the column is there: nothing outside the container query changes the grid.
    expect(rule(chartsCss, ".share__row")["grid-template-columns"]).toBe("72px minmax(0, 1fr)");
  });

  it("draws a bar 28 px high with a 4 px radius at the ends of the row, which clips the segments", () => {
    expect(rule(chartsCss, ".share__bar")).toMatchObject({ display: "flex", height: "28px", "border-radius": "4px", overflow: "hidden" });
  });

  it("draws a segment in the colour of its slot, as wide as the style says, a sliver at the least, and not shrunk past it", () => {
    const segment = rule(chartsCss, ".share__seg");
    expect(segment).toMatchObject({ background: "var(--mark)", "min-width": "3px", height: "100%" });
    expect(segment.flex).toBe("0 1 auto");
  });

  it("draws the 2 px gap inside the end of each segment but the last, in --surface, so that the widths stay exact shares", () => {
    expect(rule(chartsCss, ".share__seg:not(:last-child)")["box-shadow"]).toBe("inset -2px 0 0 var(--surface)");
    expect(parse(chartsCss).filter((r) => r.selectors.includes(".share__seg") && r.declarations["box-shadow"] !== undefined)).toEqual([]);
  });

  it("dims the other segments to 45% while one is hovered, in every row, and not the hovered one", () => {
    expect(rule(chartsCss, ".share[data-active] .share__seg:not(.is-active)").opacity).toBe("0.45");
  });

  it("puts a segment's label under it, in the 22 px band under the bar, at its own place: the name strong in --fg, the rest in --muted", () => {
    expect(rule(chartsCss, ".share__labels")).toMatchObject({ position: "relative", height: "22px" });
    expect(rule(chartsCss, ".share__label")).toMatchObject({ position: "absolute", color: "var(--muted)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" });
    expect(rule(chartsCss, ".share__label b")).toMatchObject({ color: "var(--fg)", "font-weight": "600" });
  });

  it("draws the % axis as a line of 1 px --axis under the rows with its labels in --faint 11 px, the ends inside the bar's edges", () => {
    expect(rule(chartsCss, ".share__axis")).toMatchObject({ position: "relative", "border-top": "1px solid var(--axis)" });
    expect(rule(chartsCss, ".share__axis span")).toMatchObject({ position: "absolute", color: "var(--faint)", "font-size": "11px", transform: "translateX(-50%)" });
    expect(rule(chartsCss, ".share__axis span:first-child").transform).toBe("none");
    expect(rule(chartsCss, ".share__axis span:last-child").transform).toBe("translateX(-100%)");
  });

  it("lays the cursor over the rows without taking the pointer, which the segments take, and draws its ring inside", () => {
    expect(rule(chartsCss, ".share__cursor")).toMatchObject({ position: "absolute", inset: "0", "pointer-events": "none" });
    expect(rule(chartsCss, ".share__cursor:focus-visible")["outline-offset"]).toBe("-2px");
  });

  it("lets a finger scroll the page over the bars, and a tap select", () => {
    expect(rule(chartsCss, ".share__rows")["touch-action"]).toBe("pan-y");
  });

  it("opens the tooltip under the row it is for, as the board does, over the label band", () => {
    expect(rule(chartsCss, ".share__tip").top).toBe("34px");
  });

  it("is the one thing in the kit with the ring of a change besides the plot: value-mark, once", () => {
    expect(rule(chartsCss, ".share.is-changed").animation).toBe("value-mark 1200ms ease-out");
    expect(rule(chartsCss, ".share.is-changed", [REDUCED]).animation).toBe("value-mark 1200ms ease-out !important");
  });

  it("keeps the colours of the segments under forced colours", () => {
    expect(rule(chartsCss, ".share__seg", ["@media (forced-colors: active)"])["forced-color-adjust"]).toBe("none");
  });

  it("says that there is nothing to show in --muted", () => {
    expect(rule(chartsCss, ".share__empty").color).toBe("var(--muted)");
  });
});

describe("the sparkline (Sparkline)", () => {
  it("is a box that does not shrink in a row: its size is the svg's own, 100 × 28 px", () => {
    expect(rule(chartsCss, ".spark").flex).toBe("none");
    expect(rule(chartsCss, ".spark").width).toBeUndefined();
  });

  it("draws the line 1.5 px wide in --faint, with round joins and caps", () => {
    expect(rule(chartsCss, ".spark__line")).toMatchObject({
      fill: "none",
      stroke: "var(--faint)",
      "stroke-width": "1.5",
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    });
  });

  it("draws the end dot in --accent, with a ring in the colour of the surface under it", () => {
    expect(rule(chartsCss, ".spark__dot").fill).toBe("var(--accent)");
    expect(rule(chartsCss, ".spark__ring").fill).toBe("var(--surface)");
  });

  it("keeps the colours of the line and the dot under forced colours", () => {
    for (const selector of [".spark__line", ".spark__ring", ".spark__dot"]) {
      expect(rule(chartsCss, selector, ["@media (forced-colors: active)"])["forced-color-adjust"], selector).toBe("none");
    }
  });
});

describe("the bar list (BarList)", () => {
  it("is a column of rows 10 px apart, and 6 px apart when dense", () => {
    expect(rule(chartsCss, ".barlist")).toMatchObject({ display: "flex", "flex-direction": "column", gap: "10px", "font-family": "var(--font-mono)", "font-size": "13px" });
    expect(rule(chartsCss, ".barlist--dense").gap).toBe("6px");
  });

  it("has a column for the label, as wide as the longest (the list's --label, 56px when it does not say), and one for the bar and its tip", () => {
    expect(rule(chartsCss, ".barlist__item")).toMatchObject({ display: "grid", "grid-template-columns": "var(--label, 56px) minmax(0, 1fr)", "align-items": "center" });
    expect(rule(chartsCss, ".barlist__name")).toMatchObject({ "min-width": "0", "overflow-wrap": "anywhere" });
    expect(rule(chartsCss, ".barlist__sub")).toMatchObject({ color: "var(--faint)", "font-size": "11px" });
  });

  it("draws the bar 18 px thick, 12 px when dense, in --series-1, with a 4 px radius at its end and a square start", () => {
    expect(rule(chartsCss, ".barlist__bar")).toMatchObject({ height: "18px", background: "var(--series-1)", "border-radius": "0 4px 4px 0", flex: "none" });
    expect(rule(chartsCss, ".barlist--dense .barlist__bar").height).toBe("12px");
  });

  it("leaves room after the longest bar for its tip (the list's --tip), so that the bar's width is a share of the rest and the tip follows the bar", () => {
    // The room is in the lane's own characters, which are those of the tip's font: sans at 12 px.
    expect(rule(chartsCss, ".barlist__lane")).toMatchObject({
      display: "flex",
      "align-items": "center",
      gap: "10px",
      "padding-right": "var(--tip, 0px)",
      "min-width": "0",
      "font-family": "var(--font-sans)",
      "font-size": "12px",
    });
  });

  it("writes the tip in --muted at 12 px on one line, with the value strong in --fg", () => {
    expect(rule(chartsCss, ".barlist__tip")).toMatchObject({ color: "var(--muted)", "white-space": "nowrap", flex: "none", "font-variant-numeric": "tabular-nums" });
    expect(rule(chartsCss, ".barlist__tip b")).toMatchObject({ color: "var(--fg)", "font-weight": "600" });
  });

  it("rings once after a change, as the plot does, and the ring stays under prefers-reduced-motion: reduce", () => {
    expect(rule(chartsCss, ".barlist.is-changed").animation).toBe("value-mark 1200ms ease-out");
    expect(rule(chartsCss, ".barlist.is-changed", [REDUCED]).animation).toBe("value-mark 1200ms ease-out !important");
  });

  it("keeps the colour of the bars under forced colours", () => {
    expect(rule(chartsCss, ".barlist__bar", ["@media (forced-colors: active)"])["forced-color-adjust"]).toBe("none");
  });
});

describe("the meter (Meter)", () => {
  it("is 12 px high, and 6 px when small, as one size the track and the tick's room are made from", () => {
    expect(rule(chartsCss, ".meter")["--meter"]).toBe("12px");
    expect(rule(chartsCss, ".meter--small")["--meter"]).toBe("6px");
    expect(rule(chartsCss, ".meter__track")).toMatchObject({ height: "var(--meter)", background: "var(--track)", "border-radius": "999px", position: "relative" });
  });

  it("fills the track from its start in --series-1, with full radius", () => {
    expect(rule(chartsCss, ".meter__fill")).toMatchObject({ position: "absolute", left: "0", top: "0", bottom: "0", background: "var(--series-1)", "border-radius": "999px" });
  });

  it("draws the threshold's tick 2 px wide in --fg, centred on its place and reaching 5 px past the track on both sides", () => {
    expect(rule(chartsCss, ".meter__tick")).toMatchObject({
      position: "absolute",
      top: "-5px",
      bottom: "-5px",
      width: "2px",
      "margin-left": "-1px",
      background: "var(--fg)",
    });
  });

  it("makes room for the tick above the track and the label under it, and only when there is a threshold", () => {
    expect(rule(chartsCss, ".meter--threshold")).toMatchObject({ "padding-top": "5px", "padding-bottom": "22px" });
    expect(rule(chartsCss, ".meter")["padding-top"]).toBeUndefined();
  });

  it("writes the label in --fg at 11 px under the tick's end, to the right of it near the start of the track, to the left near its end, else centred on it", () => {
    expect(rule(chartsCss, ".meter__label")).toMatchObject({
      position: "absolute",
      top: "calc(5px + var(--meter) + 5px + 3px)",
      color: "var(--fg)",
      "font-size": "11px",
      "line-height": "14px",
      "white-space": "nowrap",
    });
    expect(rule(chartsCss, '.meter__label[data-side="center"]').transform).toBe("translateX(-50%)");
    expect(rule(chartsCss, '.meter__label[data-side="left"]').transform).toBe("translateX(-100%)");
    // Opening to the right is where it starts: no transform.
    expect(rule(chartsCss, ".meter__label").transform).toBeUndefined();
  });

  it("keeps the colours of the fill and the tick under forced colours", () => {
    for (const selector of [".meter__track", ".meter__fill", ".meter__tick"]) {
      expect(rule(chartsCss, selector, ["@media (forced-colors: active)"])["forced-color-adjust"], selector).toBe("none");
    }
  });
});

describe("the inline bars (InlineBar)", () => {
  it("grows the depth from the row's end, 2 px in from the row's top and bottom, with a 3 px radius at its open end, and takes no pointer", () => {
    for (const selector of [".inline-bar--up", ".inline-bar--down"]) {
      expect(rule(chartsCss, selector), selector).toMatchObject({
        position: "absolute",
        top: "2px",
        bottom: "2px",
        right: "0",
        "z-index": "0",
        "border-radius": "3px 0 0 3px",
        "pointer-events": "none",
      });
    }
  });

  it("washes bids with --up-wash and asks with --down-wash", () => {
    expect(rule(chartsCss, ".inline-bar--up").background).toBe("var(--up-wash)");
    expect(rule(chartsCss, ".inline-bar--down").background).toBe("var(--down-wash)");
  });

  it("puts what follows the depth bar in its row above it, so that the text is on the wash and not under it: the wash's contrast is computed with the text over it", () => {
    for (const selector of [".inline-bar--up ~ *", ".inline-bar--down ~ *"]) {
      expect(rule(chartsCss, selector), selector).toMatchObject({ position: "relative", "z-index": "1" });
    }
  });

  it("draws the diverging form 14 px high with a centre line of 1 px in --axis", () => {
    expect(rule(chartsCss, ".inline-bar--diverging")).toMatchObject({ position: "relative", display: "block", height: "14px" });
    expect(rule(chartsCss, ".inline-bar--diverging::before")).toMatchObject({
      position: "absolute",
      left: "50%",
      top: "0",
      bottom: "0",
      width: "1px",
      background: "var(--axis)",
    });
  });

  it("draws out in --down to the left of the centre, with its radius on the left end, and in in --up to the right, with its radius on the right", () => {
    expect(rule(chartsCss, ".inline-bar__out")).toMatchObject({
      position: "absolute",
      top: "0",
      bottom: "0",
      right: "calc(50% + 0.5px)",
      background: "var(--down)",
      "border-radius": "3px 0 0 3px",
    });
    expect(rule(chartsCss, ".inline-bar__in")).toMatchObject({
      position: "absolute",
      top: "0",
      bottom: "0",
      left: "calc(50% + 0.5px)",
      background: "var(--up)",
      "border-radius": "0 3px 3px 0",
    });
  });

  it("keeps the colours of out and in under forced colours, since that is what they say", () => {
    for (const selector of [".inline-bar__out", ".inline-bar__in"]) {
      expect(rule(chartsCss, selector, ["@media (forced-colors: active)"])["forced-color-adjust"], selector).toBe("none");
    }
  });
});

describe("the tiles (components.css)", () => {
  it("keep the home page's grid of 220 px tiles, and the narrow grid is of 150 px", () => {
    expect(rule(componentsCss, ".stat-grid")["grid-template-columns"]).toBe("repeat(auto-fit, minmax(220px, 1fr))");
    expect(rule(componentsCss, ".stat-grid--narrow")["grid-template-columns"]).toBe("repeat(auto-fit, minmax(150px, 1fr))");
  });

  it("keep the home page's tile mono at 22 px, and the figure tile is sans, proportional, 24 px and weight 600", () => {
    expect(rule(componentsCss, ".stat__value")).toMatchObject({ "font-family": "var(--font-mono)", "font-size": "22px", "font-weight": "500" });
    expect(rule(componentsCss, ".stat--figure .stat__value")).toMatchObject({
      "font-family": "var(--font-sans)",
      "font-size": "24px",
      "font-weight": "600",
      "font-variant-numeric": "proportional-nums",
    });
  });

  it("write the delta in --muted at 12 px, the triangle beside its first line", () => {
    expect(rule(componentsCss, ".stat__delta")).toMatchObject({ display: "flex", "align-items": "flex-start", gap: "4px", color: "var(--muted)", "font-size": "12px" });
    expect(rule(componentsCss, ".stat__delta svg")).toMatchObject({ flex: "none" });
  });
});

describe("the rows of a tooltip", () => {
  it("has the date in --faint, the name and the notes in --muted, and the value strong", () => {
    expect(rule(chartsCss, ".plot__tip-date").color).toBe("var(--faint)");
    expect(rule(chartsCss, ".plot__tip-name").color).toBe("var(--muted)");
    expect(rule(chartsCss, ".plot__tip-note").color).toBe("var(--muted)");
    expect(rule(chartsCss, ".plot__tip b")).toMatchObject({ "font-weight": "600", "font-variant-numeric": "tabular-nums" });
  });

  it("draws the key of a series as a line of 12 × 2 px in the colour of its slot", () => {
    expect(rule(chartsCss, ".plot__tip-key")).toMatchObject({ width: "12px", height: "2px", background: "var(--mark)" });
  });

  it("sets a total off from the rows above it with a line", () => {
    expect(rule(chartsCss, ".plot__tip-total")["border-top"]).toBe("1px solid var(--border)");
  });
});

describe("the ring after a change", () => {
  it("is the figure mark of the live values: value-mark, 1200 ms, once", () => {
    expect(rule(chartsCss, ".plot.is-changed").animation).toBe("value-mark 1200ms ease-out");
    expect(parse(componentsCss).some((r) => r.selectors.includes("@keyframes value-mark"))).toBe(true);
  });

  it("stays under prefers-reduced-motion: reduce, a colour that fades and nothing that moves", () => {
    expect(rule(chartsCss, ".plot.is-changed", [REDUCED]).animation).toBe("value-mark 1200ms ease-out !important");
  });

  it("is outside the plot, and never moves it", () => {
    const frames = /@keyframes value-mark\s*\{[^]*?\}\s*\}/.exec(readFileSync(new URL("../../app/ui/components.css", import.meta.url), "utf8"))![0];
    expect(frames).toContain("box-shadow: 0 0 0 3px");
    expect(frames).not.toMatch(/transform|top|left|width|height/);
  });
});
