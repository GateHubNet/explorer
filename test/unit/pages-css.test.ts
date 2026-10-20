import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// What the page stylesheets must keep: a focus indicator that the card's `overflow: hidden` does not clip.

const read = (name: string) =>
  readFileSync(new URL(`../../app/ui/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const pagesCss = read("pages.css");
const componentsCss = read("components.css");
const baseCss = read("base.css");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

describe("the raw header block", () => {
  it("is a card that clips what is outside its padding box", () => {
    expect(rule(componentsCss, ".card").overflow).toBe("hidden");
  });

  it("has the global focus ring, drawn outside the element: which the card would clip", () => {
    const global = rule(baseCss, ":focus-visible");
    expect(global.outline).toMatch(/^2px solid/);
    expect(global["outline-offset"]).toBe("2px");
  });

  it("draws the summary's focus ring inside it, where the card does not clip it", () => {
    const focused = rule(pagesCss, ".raw summary:focus-visible");
    expect(Number.parseFloat(focused["outline-offset"]!)).toBeLessThanOrEqual(-2);
    // Not turned off, and not made invisible: the global outline still applies (no `outline: none` or `0`).
    expect(focused.outline ?? "2px solid").not.toMatch(/none|^0/);
  });

  it("gives the summary a full-width target, so that the inset ring has the whole row to sit in", () => {
    const summary = rule(pagesCss, ".raw summary");
    expect(summary.display).toBe("flex");
    expect(summary["min-height"]).toBe("44px");
  });
});

describe("the list of accounts a ledger created", () => {
  // axe (WCAG 2.5.8, target-size): a link under 24 px high with less than 24 px between its centre and the next link's box fails. The
  // short addresses are 13 px text stacked 4 px apart, so each link gets a 24 px row of its own.
  it("gives every link a target of at least 24 px", () => {
    const link = rule(pagesCss, ".result__list a");
    expect(link.display).toMatch(/flex$/);
    expect(Number.parseFloat(link["min-height"]!)).toBeGreaterThanOrEqual(24);
  });
});

describe("the network dashboard", () => {
  it("is one column of rows 18 px apart, as the board is", () => {
    expect(rule(pagesCss, ".network")).toMatchObject({ display: "flex", "flex-direction": "column", gap: "18px" });
  });

  it("lays the cards out in pairs that fold on a phone: a half is 420 px at least, the wide one 520 px, the validators' 300 px, each able to shrink", () => {
    expect(rule(pagesCss, ".network__pair")).toMatchObject({ display: "flex", "flex-wrap": "wrap", gap: "18px" });
    expect(rule(pagesCss, ".network__half")).toMatchObject({ flex: "1 1 420px", "min-width": "0" });
    expect(rule(pagesCss, ".network__wide")).toMatchObject({ flex: "999 1 520px", "min-width": "0" });
    expect(rule(pagesCss, ".network__side")).toMatchObject({ flex: "1 1 300px", "min-width": "0" });
  });

  it("keeps the open ledger beside the chips while there is room for 220 px, and under them when there is not", () => {
    expect(rule(pagesCss, ".network__ledgers")).toMatchObject({ display: "flex", "flex-wrap": "wrap" });
    expect(rule(pagesCss, ".network__open").flex).toBe("1 1 220px");
    // The chips take what is left.
    expect(rule(pagesCss, ".network__chips").flex).toMatch(/^999 1 /);
  });

  it("writes its notes in --faint and the open ledger's lines in --muted, with the figures in --fg: text colours only", () => {
    expect(rule(pagesCss, ".network__note").color).toBe("var(--faint)");
    expect(rule(pagesCss, ".network__open").color).toBe("var(--muted)");
    expect(rule(pagesCss, ".network__open b").color).toBe("var(--fg)");
    expect(rule(pagesCss, ".network__count").color).toBe("var(--fg)");
  });

  it("holds the five first-seen keys as one block, so that the list is what rings when the ledger changes", () => {
    expect(pagesCss).toMatch(/\.network__first \.live,\s*\.network__first \.live__value\s*\{[^}]*display:\s*block/);
  });

  it("gives the link of the validators card a 32 px target, 44 px on a phone or a touch screen", () => {
    expect(Number.parseFloat(rule(pagesCss, ".network__all")["min-height"]!)).toBeGreaterThanOrEqual(32);
    expect(pagesCss).toMatch(/@media \(pointer: coarse\), \(max-width: 720px\) \{[^@]*\.network__all[^@]*min-height: 44px/);
  });
});

describe("the segmented links of a filter row", () => {
  it("has its label visible, in --faint, before the network switch's pill, which wraps under it on a screen too narrow for both", () => {
    expect(rule(componentsCss, ".seglinks__label").color).toBe("var(--faint)");
    expect(rule(componentsCss, ".seglinks")).toMatchObject({ display: "flex", "flex-wrap": "wrap", "align-items": "center" });
  });

  it("is the network switch's own segments: 32 px to look at, a 44 px target around them, the current one raised", () => {
    expect(rule(componentsCss, ".netswitch__item")["min-height"]).toBe("32px");
    expect(rule(componentsCss, ".netswitch__item::after").inset).toBe("-6px 0");
    expect(rule(componentsCss, ".netswitch__item[aria-current]").background).toBe("var(--surface)");
  });
});

describe("the validators list", () => {
  it("is one column of rows 18 px apart, as the board is, with six tiles in as many columns as fit at 300 px", () => {
    expect(rule(pagesCss, ".validators")).toMatchObject({ display: "flex", "flex-direction": "column", gap: "18px" });
    expect(rule(pagesCss, ".validators__tiles")).toMatchObject({ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "12px" });
  });

  it("makes the table's scroll region a containing block, so that the visually hidden words of a cell (`.sr`, absolute) stay inside it and do not widen the page", () => {
    expect(rule(baseCss, ".sr").position).toBe("absolute");
    expect(rule(pagesCss, ".validators__table").position).toBe("relative");
  });

  it("gives the form's controls and the disclosure a 44 px target, and draws the disclosure's ring inside it, where the table's scroll region does not clip it", () => {
    for (const selector of [".validators__field", ".validators__sel", ".validators__apply", ".validators__clear", ".validators__yes summary"]) {
      expect(Number.parseFloat(rule(pagesCss, selector)["min-height"]!), selector).toBeGreaterThanOrEqual(44);
    }
    expect(Number.parseFloat(rule(pagesCss, ".validators__yes summary:focus-visible")["outline-offset"]!)).toBeLessThanOrEqual(-2);
  });

  it("gives the validator's link a target of at least 24 px (WCAG 2.5.8)", () => {
    expect(Number.parseFloat(rule(pagesCss, ".validators__name")["min-height"]!)).toBeGreaterThanOrEqual(24);
  });

  it("colours the swatch of a version's group from its slot, the legend's way", () => {
    expect(rule(pagesCss, ".validators__swatch").background).toBe("var(--mark)");
  });
});

describe("the validator page", () => {
  it("is one column of rows 18 px apart, as the board is, with the facts in as many columns as fit at 240 px", () => {
    expect(rule(pagesCss, ".validator")).toMatchObject({ display: "flex", "flex-direction": "column", gap: "18px" });
    expect(rule(pagesCss, ".validator__grid")).toMatchObject({ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" });
  });

  it("lays the cards out in pairs that fold on a phone: the tiles 260 px at least beside the chart's 600 px, the votes' cards 420 px, each able to shrink", () => {
    expect(rule(pagesCss, ".validator__pair")).toMatchObject({ display: "flex", "flex-wrap": "wrap", gap: "18px" });
    expect(rule(pagesCss, ".validator__tiles")).toMatchObject({ flex: "1 1 260px", "min-width": "0" });
    expect(rule(pagesCss, ".validator__daily")).toMatchObject({ flex: "999 1 600px", "min-width": "0" });
    expect(rule(pagesCss, ".validator__pair > .validator__card")).toMatchObject({ flex: "1 1 420px", "min-width": "0" });
  });

  it("makes the recent validations' scroll region a containing block, so that the visually hidden words of a cell (`.sr`, absolute) stay inside it and do not widen the page", () => {
    expect(rule(baseCss, ".sr").position).toBe("absolute");
    expect(rule(pagesCss, ".validator__table").position).toBe("relative");
  });

  it("keeps the icon of a link to another site in the line of its words (the TOML file in the note), where base.css would make it a block", () => {
    expect(rule(baseCss, "img,\nsvg").display).toBe("block");
    expect(rule(componentsCss, ".extlink__icon").display).toBe("inline-block");
  });

  it("breaks the master key and a long domain anywhere, so that a phone does not scroll sideways", () => {
    expect(rule(pagesCss, ".validator__master")["overflow-wrap"]).toBe("anywhere");
    expect(rule(pagesCss, ".validator__title")["overflow-wrap"]).toBe("anywhere");
  });

  it("gives the links of a list a target of at least 24 px (WCAG 2.5.8), and the link to the amendments 32 px, 44 px on a phone or a touch screen", () => {
    expect(Number.parseFloat(rule(pagesCss, ".validator__account")["min-height"]!)).toBeGreaterThanOrEqual(24);
    expect(Number.parseFloat(rule(pagesCss, ".validator__amendment")["min-height"]!)).toBeGreaterThanOrEqual(24);
    expect(Number.parseFloat(rule(pagesCss, ".validator__cross")["min-height"]!)).toBeGreaterThanOrEqual(32);
    expect(pagesCss).toMatch(/@media \(pointer: coarse\), \(max-width: 720px\) \{[^@]*\.validator__cross[^@]*min-height: 44px/);
  });
});

describe("the amendments list", () => {
  it("is one column of rows 18 px apart, as the board is", () => {
    expect(rule(pagesCss, ".amendments")).toMatchObject({ display: "flex", "flex-direction": "column", gap: "18px" });
  });

  it("has the board's accent border on the card of the amendments about to activate", () => {
    expect(rule(pagesCss, ".amendments__soon")["border-color"]).toBe("color-mix(in srgb, var(--accent) 40%, var(--border))");
  });

  it("makes the table's scroll region a containing block, so that the visually hidden words of a cell (`.sr`, absolute) stay inside it and do not widen the page", () => {
    expect(rule(baseCss, ".sr").position).toBe("absolute");
    expect(rule(pagesCss, ".amendments__table").position).toBe("relative");
  });

  it("makes its rows 56 px high and keeps the header row at the table's own 36 px, after the rule for the rows (the head is a row too)", () => {
    expect(rule(pagesCss, ".amendments__table .table__row")["min-height"]).toBe("56px");
    expect(rule(pagesCss, ".amendments__table .table__head")["min-height"]).toBe("36px");
    expect(pagesCss.indexOf(".amendments__table .table__head")).toBeGreaterThan(pagesCss.indexOf(".amendments__table .table__row"));
  });

  it("lets the status chips wrap, so that six of them fit a phone", () => {
    expect(rule(pagesCss, ".amendments__cardhead .netswitch")).toMatchObject({ "flex-wrap": "wrap", "max-width": "100%" });
  });

  it("puts no link on --sunken: an XLS tag with a link in it is on the page's ground", () => {
    expect(rule(componentsCss, ".tag").background).toBe("var(--sunken)");
    expect(rule(pagesCss, ".amendments__xls--link").background).toBe("transparent");
  });

  it("gives the links of the table a target of at least 24 px (WCAG 2.5.8), and the links out of the heading and the card 32 px, 44 px on a phone or a touch screen", () => {
    expect(Number.parseFloat(rule(pagesCss, ".amendments__name")["min-height"]!)).toBeGreaterThanOrEqual(24);
    expect(Number.parseFloat(rule(pagesCss, ".amendments__cross")["min-height"]!)).toBeGreaterThanOrEqual(32);
    expect(Number.parseFloat(rule(pagesCss, ".amendments__soonlink")["min-height"]!)).toBeGreaterThanOrEqual(32);
    expect(pagesCss).toMatch(/@media \(pointer: coarse\), \(max-width: 720px\) \{[^@]*\.amendments__cross,\s*\.amendments__soonlink[^@]*min-height: 44px/);
  });

  it("wraps a status that is longer than its column inside its pill, which is nowrap elsewhere, and keeps the space before the arrow of the card's link", () => {
    expect(rule(componentsCss, ".pill")["white-space"]).toBe("nowrap");
    expect(rule(pagesCss, ".amendments__table .pill")).toMatchObject({ "max-width": "100%", "white-space": "normal" });
    // A flex box would make an item of each run of the link's text and drop the space before the arrow.
    expect(rule(pagesCss, ".amendments__soonlink").display).toBe("inline-block");
  });

  it("underlines the name that is a link inside the sentence of the activating card: its colour alone would not tell it from the words around it (axe: link-in-text-block)", () => {
    expect(rule(pagesCss, ".amendments__soonname")["text-decoration"]).toBe("underline");
  });

  it("keeps the bar's box the width of its column, at most 220 px (the board's)", () => {
    expect(rule(pagesCss, ".amendments__bar")).toMatchObject({ width: "100%", "max-width": "220px" });
  });
});


describe("the amendment page", () => {
  it("is one column of rows 18 px apart, as the board is, with the facts in as many columns as fit at 200 px", () => {
    expect(rule(pagesCss, ".amendment")).toMatchObject({ display: "flex", "flex-direction": "column", gap: "18px" });
    expect(rule(pagesCss, ".amendment__grid")).toMatchObject({ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(min(200px, 100%), 1fr))" });
  });

  it("lays the consensus beside the history, folding on a phone: the consensus 640 px at least, the history 340 px, each able to shrink", () => {
    expect(rule(pagesCss, ".amendment__pair")).toMatchObject({ display: "flex", "flex-wrap": "wrap", gap: "18px" });
    expect(rule(pagesCss, ".amendment__consensus")).toMatchObject({ flex: "999 1 640px", "min-width": "0" });
    expect(rule(pagesCss, ".amendment__history")).toMatchObject({ flex: "1 1 340px", "min-width": "0" });
  });

  it("draws the chart's card inside the consensus card without a frame of its own", () => {
    expect(rule(pagesCss, ".amendment__chart")).toMatchObject({ padding: "0", border: "0" });
  });

  it("has the board's 44 px figure", () => {
    expect(rule(pagesCss, ".amendment__share")["font-size"]).toBe("44px");
  });

  it("makes the vote tables' scroll region a containing block, so that the visually hidden words of a cell (`.sr`, absolute) stay inside it and do not widen the page", () => {
    expect(rule(baseCss, ".sr").position).toBe("absolute");
    expect(rule(pagesCss, ".amendment__table").position).toBe("relative");
  });

  it("breaks the ID and a long name anywhere, so that a phone does not scroll sideways", () => {
    expect(rule(pagesCss, ".amendment__id")["overflow-wrap"]).toBe("anywhere");
    expect(rule(pagesCss, ".amendment__title")["overflow-wrap"]).toBe("anywhere");
  });

  it("gives the disclosure of the other validators a 48 px summary across the card, its ring drawn inside it, where the card does not clip it", () => {
    expect(rule(pagesCss, ".amendment__others summary")).toMatchObject({ display: "flex", "min-height": "48px" });
    expect(Number.parseFloat(rule(pagesCss, ".amendment__others summary:focus-visible")["outline-offset"]!)).toBeLessThanOrEqual(-2);
  });

  it("dots the history: a majority filled in --series-1, its loss outlined in --border-strong, the enabling filled in --ok, the one to come dashed", () => {
    expect(rule(pagesCss, ".amendment__dot--got")).toMatchObject({ background: "var(--series-1)", "border-color": "var(--series-1)" });
    expect(rule(pagesCss, ".amendment__dot--lost")).toMatchObject({ background: "var(--surface)", "border-color": "var(--border-strong)" });
    expect(rule(pagesCss, ".amendment__dot--enabled")).toMatchObject({ background: "var(--ok)", "border-color": "var(--ok)" });
    expect(rule(pagesCss, ".amendment__dot--pending")).toMatchObject({ "border-style": "dashed", "border-color": "var(--border-strong)" });
  });

  it("underlines the links inside a sentence: their colour alone would not tell them from the words around them (axe: link-in-text-block)", () => {
    const prose = rule(pagesCss, ".amendment__value a,\n.amendment__since a,\n.amendment__when a,\n.amendment__foot a");
    expect(prose["text-decoration"]).toBe("underline");
  });

  it("gives the links of a vote table a target of at least 24 px (WCAG 2.5.8)", () => {
    expect(Number.parseFloat(rule(pagesCss, ".amendment__validator")["min-height"]!)).toBeGreaterThanOrEqual(24);
  });
});
