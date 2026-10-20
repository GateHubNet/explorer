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

describe("the account analytics view", () => {
  /** The selector of every rule of the pages' sheet that names the view (`.analytics…`), at the top level or inside an at-rule. */
  const analyticsSelectors = [...pagesCss.matchAll(/(?:^|[{}])\s*([^{}@]+?)\s*\{[^{}]*\}/g)]
    .map(([, selector]) => selector!.trim())
    .filter((selector) => /\.analytics/.test(selector));

  it("is one column of rows 18 px apart, as the board is", () => {
    expect(rule(pagesCss, ".analytics")).toMatchObject({ display: "flex", "flex-direction": "column", gap: "18px", "min-width": "0" });
  });

  it("lays its four tiles out as many as fit at 220 px, and one under another on a screen narrower than that", () => {
    expect(rule(pagesCss, ".analytics > .stat-grid")["grid-template-columns"]).toBe("repeat(auto-fit, minmax(min(220px, 100%), 1fr))");
  });

  it("puts its cards in rows that fold on a phone: the two charts are 480 px at least, the two tables 460 px, each able to shrink", () => {
    expect(rule(pagesCss, ".analytics__row")).toMatchObject({ display: "flex", "flex-wrap": "wrap", "align-items": "stretch", gap: "18px" });
    expect(rule(pagesCss, ".analytics__half")).toMatchObject({ flex: "1 1 480px", "min-width": "0" });
    expect(rule(pagesCss, ".analytics__table-half")).toMatchObject({ flex: "1 1 460px", "min-width": "0" });
  });

  it("keeps a table's place while it loads: its header row and its rows of 46 px, as many as the card has", () => {
    expect(rule(pagesCss, ".analytics__table-loading")["min-height"]).toBe("calc(36px + var(--rows) * 46px)");
    // The rows of DataTable it stands in for.
    expect(rule(componentsCss, ".table__row")["min-height"]).toBe("46px");
    expect(rule(componentsCss, ".table__head")["min-height"]).toBe("36px");
  });

  it("is a filter row of the period links, the values note and the period note, which wrap on a phone", () => {
    expect(rule(pagesCss, ".analytics-filters")).toMatchObject({ display: "flex", "flex-wrap": "wrap", "align-items": "center" });
    expect(rule(pagesCss, ".analytics-filters__values").color).toBe("var(--muted)");
    expect(rule(pagesCss, ".analytics-filters__note").color).toBe("var(--faint)");
  });

  it("keeps the period links' 44 px target: no rule of the view's touches the segmented links or the network switch's segments", () => {
    expect(analyticsSelectors).toContain(".analytics-filters");
    expect(analyticsSelectors.filter((selector) => /seglinks|netswitch/.test(selector))).toEqual([]);
    expect(rule(componentsCss, ".netswitch__item")["min-height"]).toBe("32px");
    expect(rule(componentsCss, ".netswitch__item::after").inset).toBe("-6px 0");
  });

  it("writes its notes in --faint and the hint of a change type in --faint, text colours only", () => {
    expect(rule(pagesCss, ".analytics__notes").color).toBe("var(--faint)");
    expect(rule(pagesCss, ".analytics__hint").color).toBe("var(--faint)");
  });
});
