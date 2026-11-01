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

describe("an NFT's page", () => {
  it("puts the details beside the id's card while there is room for 520 and 420 px, and one under the other when there is not, each able to shrink (the board's)", () => {
    expect(rule(pagesCss, ".nft-page__pair")).toMatchObject({ display: "flex", "flex-wrap": "wrap", gap: "18px" });
    expect(rule(pagesCss, ".nft-page__details")).toMatchObject({ flex: "1 1 520px", "min-width": "0" });
    expect(rule(pagesCss, ".nft-page__idcard")).toMatchObject({ flex: "1 1 420px", "min-width": "0" });
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

describe("the order book of the pair page", () => {
  // The prices of the levels are 500, and so is the middle row's last price, which sits in the same column between them.
  it("sets the last price of the middle row in the weight of the levels' prices", () => {
    expect(rule(pagesCss, ".pair__level > .pair__level-price")["font-weight"]).toBe("500");
    expect(rule(pagesCss, ".pair__book-mid .pair__level-price")["font-weight"]).toBe("500");
  });
});

describe("the page of older trades of a pair", () => {
  // The note says where the price and the chart are, and its link is a part of the sentence in another colour: it is underlined too.
  it("underlines the link in its note, so that more than the colour tells it from the words around it", () => {
    expect(rule(pagesCss, ".pair__older a")["text-decoration"]).toBe("underline");
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
    expect(Number.parseFloat(rule(pagesCss, ".validator__accounts a")["min-height"]!)).toBeGreaterThanOrEqual(24);
    // The accounts' wrapper is no box: its links stay the flex items of the fact's value.
    expect(rule(pagesCss, ".validator__accounts").display).toBe("contents");
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

describe("the AMM pool page", () => {
  it("underlines the links inside a sentence, the state card's ledger and the deleted pool's last ledger: their colour alone would not tell them from the words around them (axe: link-in-text-block)", () => {
    const prose = rule(pagesCss, ".amm-pool__caption a,\n.amm-pool > .notice a");
    expect(prose["text-decoration"]).toBe("underline");
  });
});

describe("the token list", () => {
  it("makes the table's scroll region a containing block, so that the visually hidden words of a cell (`.sr`, absolute) stay inside it and do not widen the page", () => {
    expect(rule(baseCss, ".sr").position).toBe("absolute");
    expect(rule(pagesCss, ".tokens__table").position).toBe("relative");
  });

  it("gives the form's controls and the pager 44 px targets, and the links of the table a target of at least 24 px (WCAG 2.5.8)", () => {
    for (const selector of [".tokens__field", ".tokens__submit,\n.tokens__all", ".tokens .pager .btn"]) {
      expect(Number.parseFloat(rule(pagesCss, selector)["min-height"]!), selector).toBeGreaterThanOrEqual(44);
    }
    expect(Number.parseFloat(rule(pagesCss, ".tokens__table a")["min-height"]!)).toBeGreaterThanOrEqual(24);
  });

  it("underlines the link inside the note's sentence: its colour alone would not tell it from the words around it (axe: link-in-text-block)", () => {
    expect(rule(pagesCss, ".tokens__more")["text-decoration"]).toBe("underline");
    expect(rule(pagesCss, ".tokens__more")["text-underline-offset"]).toBe("3px");
  });

  it("is one column of rows 18 px apart, as the board is", () => {
    expect(rule(pagesCss, ".tokens")).toMatchObject({ display: "flex", "flex-direction": "column", gap: "18px" });
  });
});

describe("the token page", () => {
  it("gives its buttons (the copy button, the issuer's account, the toml file, All holders, All pools, the way back, the pager) 44 px targets", () => {
    expect(Number.parseFloat(rule(pagesCss, ".token-page .btn")["min-height"]!)).toBeGreaterThanOrEqual(44);
  });

  it("underlines the issuer's link and the links in the toml's sentence: their colour alone would not tell them from the words around them (axe: link-in-text-block)", () => {
    const words = rule(pagesCss, ".token-page__issuer a,\n.token-page__lede a");
    expect(words["text-decoration"]).toBe("underline");
    expect(words["text-underline-offset"]).toBe("3px");
  });

  it("folds its pairs of cards under each other when there is no room for both, each able to shrink: 420 px, and a phone has no sideways scroll", () => {
    expect(rule(pagesCss, ".token-page__pair")).toMatchObject({ display: "flex", "flex-wrap": "wrap" });
    expect(rule(pagesCss, ".token-page__pair > .card")).toMatchObject({ flex: "1 1 420px", "min-width": "0" });
  });

  it("sets the figures a little smaller than the figure style, so that an exact supply keeps its line in a tile of 200 px", () => {
    expect(Number.parseFloat(rule(pagesCss, ".token-page__figures .stat__value")["font-size"]!)).toBeLessThan(24);
  });

  it("wraps what the issuer wrote anywhere in its box, so that a long name or domain widens nothing", () => {
    expect(rule(pagesCss, ".token-page")["overflow-wrap"]).toBe("anywhere");
  });
});

describe("a disabled segment of the segmented links", () => {
  it("is quieter than a link and keeps its colour on hover; its note sits beside the control", () => {
    expect(rule(componentsCss, ".netswitch__item.is-disabled,\n.netswitch__item.is-disabled:hover")).toMatchObject({ color: "var(--faint)", cursor: "not-allowed" });
    expect(rule(componentsCss, ".seglinks__note").display).toBe("inline-flex");
  });
});

describe("the Testnet badge", () => {
  it("draws the testnet pill as the board's .tnet", () => {
    expect(rule(componentsCss, ".pill--testnet")).toMatchObject({
      "font-size": "11.5px",
      "font-weight": "600",
      "letter-spacing": ".02em",
      padding: "2px 8px",
      "border-radius": "999px",
      background: "var(--testnet-bg)",
      color: "var(--testnet-fg)",
      border: "1px solid var(--testnet-border)",
    });
  });

  it("groups the brand and the badge as the board does: a flex row, centred, 10px apart", () => {
    expect(rule(componentsCss, ".hdr__brandgroup")).toMatchObject({ display: "flex", "align-items": "center", gap: "10px" });
  });
});

/** What is inside the braces of every media block that starts `@media ${query} {`, one after the other (the sheet's queries are flat). */
function mediaBlocks(css: string, query: string): string {
  const head = `@media ${query} {`;
  const blocks: string[] = [];
  for (let start = css.indexOf(head); start >= 0; start = css.indexOf(head, start + head.length)) {
    const open = start + head.length - 1;
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        blocks.push(css.slice(open + 1, i));
        break;
      }
    }
  }
  if (blocks.length === 0) throw new Error(`no @media ${query}`);
  return blocks.join("\n");
}

/** The rules of a block as selector to declarations. */
function rulesOf(block: string): Record<string, Record<string, string>> {
  return Object.fromEntries(
    [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [
      selector!.trim(),
      Object.fromEntries(
        body!
          .split(";")
          .map((declaration) => declaration.trim())
          .filter(Boolean)
          .map((declaration) => [declaration.slice(0, declaration.indexOf(":")).trim(), declaration.slice(declaration.indexOf(":") + 1).trim()]),
      ),
    ]),
  );
}

describe("the header's toggle", () => {
  // The toggle is never alone on a row of its own, at any width and in any environment (the sandbox's badge makes the header wider): the item before it in the markup, the box or the nav where
  // there is no box (the home page), carries the room of the toggle and its gap as a margin and the toggle takes it back, so the two wrap together. A width at which it would be alone moves
  // with the nav's items, the badge and the fonts, so it is not named here: `test/e2e/theme.spec.ts` sweeps the widths in a browser.
  const toggle = Number.parseInt(rule(componentsCss, ".icon-btn").width!, 10);
  const gap = Number.parseInt(rule(componentsCss, ".hdr__inner").gap!.split(/\s+/)[1]!, 10);
  const room = "var(--hdr-tools-room)";
  const takenBack = { "margin-left": `calc(-1 * ${room})` };
  const rules = rulesOf(mediaBlocks(componentsCss, "(min-width: 721px)"));

  it("takes the room of the toggle and its gap: the width of the toggle and the column gap of the header", () => {
    expect([toggle, gap]).toEqual([44, 20]);
    expect(rules[".hdr__inner"]).toEqual({ "--hdr-tools-room": `calc(${toggle}px + ${gap}px)` });
  });

  it("gives the room to the box as a margin, and the toggle that follows it takes it back", () => {
    expect(rules[".search--header"]).toEqual({ "margin-right": room });
    expect(rules[".search--header + .hdr__tools"]).toEqual(takenBack);
  });

  it("gives it to the nav where there is no box, which grows so that the toggle stays at the right and is held to a row less the room, and the toggle that follows it takes it back", () => {
    // The cap is what keeps the nav, with the room, on one row: a nav wider than that (production's, with its "soon" labels) would be alone on its line and leave the toggle off the page.
    expect(rules[".hdr__nav:has(+ .hdr__tools)"]).toEqual({ flex: "1 1 auto", "max-width": `calc(100% - ${room})`, "margin-right": room });
    expect(rules[".hdr__nav:has(+ .hdr__tools) + .hdr__tools"]).toEqual(takenBack);
    // Nothing else is in the block: a rule of it is a rule for every page above a phone.
    expect(Object.keys(rules)).toHaveLength(5);
  });

  it("starts where the phone layout ends, which has its own rules for the box, the nav and the toggle", () => {
    const phone = rulesOf(mediaBlocks(componentsCss, "(max-width: 720px)"));
    expect(phone[".search--header"]).toMatchObject({ order: "5", flex: "1 1 100%" });
    expect(phone[".hdr__nav"]).toMatchObject({ display: "none", order: "4", flex: "1 1 100%" });
    expect(phone[".hdr__tools"]).toEqual({ order: "2" });
    expect(componentsCss.split("@media (min-width: 721px) {")).toHaveLength(2);
  });

  it("leaves the box its flex and the toggle its auto margin outside that: on a phone the margins are none and auto", () => {
    expect(rule(componentsCss, ".search--header")).toEqual({ flex: "1 1 260px" });
    expect(rule(componentsCss, ".hdr__tools")).toMatchObject({ "margin-left": "auto" });
  });
});

describe("the classes of an account link (display names spec 4.4)", () => {
  // `.acct` was once the balance changes' account too, defined in pages.css, which `styles.css` imports after components.css: at equal specificity the later rule won on every named
  // `AccountLink`, which became a block-level flex box with an 8 px gap, and a name in a sentence broke the line. The classes of `AccountLink` and its marks are components.css's alone.
  const chartsCss = read("charts.css");
  const CLASSES = [".acct", ".acct__name", ".acct__address", ".namemark", ".namemark--verified", ".namemark--account", ".labelmark"];
  /** Whether a stylesheet's rules mention `name` as a class: not a longer class that starts with it (`.acct__name` is not `.acct`). */
  const mentions = (css: string, name: string) => new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(css);

  it.each(CLASSES)("%s is defined in components.css and in no other stylesheet", (name) => {
    expect(mentions(componentsCss, name), `components.css has ${name}`).toBe(true);
    for (const [file, css] of [["pages.css", pagesCss], ["charts.css", chartsCss], ["base.css", baseCss]] as const) expect(mentions(css, name), `${file} has ${name}`).toBe(false);
  });

  it("is a link of its own as the name's box: inline-flex with a 4 px gap, as components.css says, whatever page it is on", () => {
    expect(rule(componentsCss, ".acct")).toMatchObject({ display: "inline-flex", gap: "4px" });
  });

  // A name is not mono, so the face no longer tells a link from the words around it, and `--link` against the text is under 3:1 (2.06:1 to 2.88:1 on `--fg`, 1.0 to 1.4 on
  // `--muted` and `--faint`). axe cannot say it: it does not count an inline-flex link as one in a block of text. So the name of every named link is underlined, in a sentence,
  // a cell or a list alike (a rule scoped to the sentences would miss the next one a page adds); a chip (`.ent`) has its box to tell it, and the h1 is no link.
  it("underlines a named link's name wherever it stands, so that more than its colour tells it from the words around it (WCAG 1.4.1); not a chip's", () => {
    expect(rule(componentsCss, "a.acct:not(.ent) > .acct__name")).toMatchObject({ "text-decoration": "underline", "text-underline-offset": "2px" });
  });

  // `a:hover` underlines the whole link, and that line (its own offset) would lie under the name's own, 1 px apart: two lines. A hovered named link takes none, and its name's
  // line grows instead, so that hover still shows, and stays apart from focus (the ring).
  it("draws one line under a hovered name: the link's hover underline is off, and the name's own grows to 2 px", () => {
    expect(rule(baseCss, "a:hover")["text-decoration"]).toBe("underline");
    expect(rule(componentsCss, "a.acct:not(.ent):hover")["text-decoration"]).toBe("none");
    expect(rule(componentsCss, "a.acct:not(.ent):hover > .acct__name")["text-decoration-thickness"]).toBe("2px");
  });

  it("leaves the balance changes' account to a class of its own: a flex row 8 px apart that cuts its link, and keeps the role small", () => {
    expect(rule(pagesCss, ".change-acct")).toMatchObject({ display: "flex", "align-items": "center", gap: "8px", "min-width": "0" });
    expect(rule(pagesCss, ".change-acct > a")).toMatchObject({ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" });
    expect(rule(pagesCss, ".change-acct .type")).toMatchObject({ flex: "none", "font-size": "11px" });
  });
});

describe("the issuers under a pair (display names decision 12)", () => {
  // A labelled issuer's mark follows its issuer, and the counter's comes last: an ellipsis would cut it first, and a scam warning would be lost to sight. The issuers wrap
  // instead, as the AMM list's do (`.amm__detail`), and a labelled issuer and its mark are one unit that does not break (IssuerTexts, the Analytics view's Pair).
  it.each([".markets__issuers", ".analytics__issuers", ".amm__detail"])("lets %s wrap and never cuts it, so that a label mark stays in sight", (selector) => {
    const issuers = rule(pagesCss, selector);
    expect(issuers["white-space"]).toBe("normal");
    expect(issuers["overflow-wrap"]).toBe("anywhere");
    expect(issuers.overflow).toBeUndefined();
    expect(issuers["text-overflow"]).toBeUndefined();
  });

  it("holds a labelled issuer and its mark together, so that the wrapped line never leaves the mark alone at the start of the next", () => {
    expect(rule(componentsCss, ".issued-marked")["white-space"]).toBe("nowrap");
  });
});

describe("the classes of the ledger object pages' components (Task 5)", () => {
  // E9 found `.acct` also defined in pages.css, which `styles.css` imports after components.css: at equal specificity the later rule won on every `AccountLink`. So the classes of the
  // states strip, the timeline, the check flow, the permission chip, the MPT amount and the warn pill are components.css's alone, and no other sheet may take one of them over.
  const chartsCss = read("charts.css");
  const tokensCss = read("tokens.css");
  const CLASSES = [
    ".pill--warn",
    ".states",
    ".states__title",
    ".states__list",
    ".states__item",
    ".states__item.is-current",
    ".states__name",
    ".states__here",
    ".states__meaning",
    ".timeline",
    ".timeline__list",
    ".timeline__item",
    ".timeline__dot",
    ".timeline__dot--tx",
    ".timeline__dot--mark",
    ".timeline__dot--next",
    ".timeline__head",
    ".timeline__type--ghost",
    ".timeline__title",
    ".timeline__when",
    ".timeline__line",
    ".timeline__what",
    ".timeline__footnote",
    ".checkflow",
    ".checkflow__issuer",
    ".permchip",
    ".permchip--granular",
    ".mptamount",
    ".objectlink",
    ".tokenlink",
  ];
  /** Whether a stylesheet's rules mention `name` as a class: not a longer class that starts with it (`.states` is not `.states__item`, `.timeline__dot` is not `.timeline__dot--tx`). */
  const mentions = (css: string, name: string) => new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(css);

  it.each(CLASSES)("%s is defined in components.css and in no other stylesheet", (name) => {
    expect(mentions(componentsCss, name), `components.css has ${name}`).toBe(true);
    for (const [file, css] of [["pages.css", pagesCss], ["charts.css", chartsCss], ["base.css", baseCss], ["tokens.css", tokensCss]] as const) {
      expect(mentions(css, name), `${file} has ${name}`).toBe(false);
    }
  });

  // The roots are the whole class, whatever follows them: nothing of another sheet starts with one of these names either (`.timeline-x`, `.states-y`), which would be the next collision.
  it.each(["states", "timeline", "checkflow", "permchip", "mptamount"])("no stylesheet but components.css has a class that starts with .%s", (root) => {
    const started = new RegExp(`\\.${root}(?![\\w-])|\\.${root}[_-]`);
    for (const [file, css] of [["pages.css", pagesCss], ["charts.css", chartsCss], ["base.css", baseCss], ["tokens.css", tokensCss]] as const) {
      expect(started.test(css), `${file} has a class of ${root}`).toBe(false);
    }
  });

  // The strip is a legend. The current state is told by its words ("· this escrow") and a frame in the link colour, never by the colour alone.
  it("frames the current state in the link colour, and names it in --link text on the card", () => {
    expect(rule(componentsCss, ".states__item.is-current")).toMatchObject({ "border-color": "var(--link)" });
    expect(rule(componentsCss, ".states__item.is-current .states__name")).toMatchObject({ color: "var(--link)" });
  });

  it("lets the states wrap at 150 px each, so that the strip never scrolls sideways on a phone", () => {
    expect(rule(componentsCss, ".states__list")).toMatchObject({ display: "flex", "flex-wrap": "wrap" });
    expect(rule(componentsCss, ".states__item")).toMatchObject({ flex: "1 1 150px", "min-width": "0" });
  });

  // The board's dots: filled for a transaction, outlined for a time that passed, dashed for what can still happen.
  it("dots the timeline: a transaction filled, a mark outlined on the card, a next step dashed", () => {
    expect(rule(componentsCss, ".timeline__dot--tx")).toMatchObject({ background: "var(--accent)", "border-color": "var(--accent)" });
    expect(rule(componentsCss, ".timeline__dot--mark")).toMatchObject({ background: "var(--surface)", "border-color": "var(--muted)" });
    expect(rule(componentsCss, ".timeline__dot--next")).toMatchObject({ background: "transparent", "border-style": "dashed", "border-color": "var(--border-strong)" });
  });

  it("lets a long address or a hash break at the edge of the card, and the list shrink with it", () => {
    expect(rule(componentsCss, ".timeline__line")["overflow-wrap"]).toBe("anywhere");
    expect(rule(componentsCss, ".timeline__item")["grid-template-columns"]).toBe("14px minmax(0, 1fr)");
  });

  // A link in a sentence is told from the words round it by more than its colour (WCAG 1.4.1; axe: link-in-text-block). A named account is underlined by its own rule
  // (`a.acct:not(.ent) > .acct__name`, and a second line on the whole link would lie 1 px under it), and a chip has its box; everything else in the timeline's lines is underlined.
  it("underlines every link in a line of the timeline that is not a named account or a chip: the by line's addresses, the hash, the ledger, an NFT", () => {
    expect(rule(componentsCss, ".timeline__line a:not(.ent):not(.acct)")).toMatchObject({ "text-decoration": "underline", "text-underline-offset": "3px" });
    expect(rule(componentsCss, "a.acct:not(.ent) > .acct__name")["text-decoration"]).toBe("underline");
  });

  it("underlines the issuer of a check, which is in the words 'issued by', and the ID of an MPT amount that is a link, which is in the words 'units of MPT'", () => {
    expect(rule(componentsCss, ".checkflow__issuer a:not(.acct)")).toMatchObject({ "text-decoration": "underline", "text-underline-offset": "3px" });
    expect(rule(componentsCss, ".mptamount a")).toMatchObject({ "text-decoration": "underline", "text-underline-offset": "3px" });
    // `Sentence`'s link to an object, the one a transaction's sentence, a ledger's row and an account's row draw. Axe does not see it (its heuristic wants more words than link), so this is its pin.
    expect(rule(componentsCss, ".objectlink")).toMatchObject({ "text-decoration": "underline", "text-underline-offset": "3px" });
  });

  // E11: a token whose code is a link has two links in its row, one under the other (the code's and the issuer's), and the pool's issuer lines wrap on a phone to put the issuer's link under
  // the code's: two links under 24 px leave less than 24 px between their centres (axe, WCAG 2.5.8). Each is a target of at least 24 px.
  it("gives the code that is a link and the issuer's link under it, in the account's Tokens card and in the pool's issuer lines, targets of at least 24 px (WCAG 2.5.8)", () => {
    for (const selector of [
      ".token--linked .token__name a",
      ".amm-pool__fact a",
    ]) {
      const link = rule(pagesCss, selector);
      expect(link, selector).toMatchObject({ display: "inline-flex", "align-items": "center" });
      expect(Number.parseFloat(link["min-height"]!), selector).toBeGreaterThanOrEqual(24);
      expect(Number.parseFloat(link["min-width"]!), selector).toBeGreaterThanOrEqual(24);
    }
  });

  // E11: a token's code is a link in the words of a pair's and a pool's "USD issued by r…" and of the toml's currencies under "How we know", where a colour alone would not tell it (WCAG 1.4.1).
  it("underlines a token's code that is a link in running words, with an offset of 3 px, as an object link is", () => {
    expect(rule(componentsCss, ".tokenlink")).toMatchObject({ "text-decoration": "underline", "text-underline-offset": "3px" });
  });

  it("keeps the permission chip's hidden words inside it, so that they do not widen a scrolling table or the page (`.sr` is absolute)", () => {
    expect(rule(baseCss, ".sr").position).toBe("absolute");
    expect(rule(componentsCss, ".permchip").position).toBe("relative");
    expect(rule(componentsCss, ".permchip")["white-space"]).toBe("nowrap");
  });

  it("outlines a narrower right and a permission nobody knows, and fills a transaction type's chip, as the board does", () => {
    expect(rule(componentsCss, ".permchip")).toMatchObject({ background: "var(--sunken)", border: "1px solid var(--border)" });
    expect(rule(componentsCss, ".permchip--granular,\n.permchip--unknown")).toMatchObject({ background: "transparent", "border-color": "var(--border-strong)" });
  });

  it("breaks the MPT amount at the edge of its cell instead of widening it, in mono with tabular figures", () => {
    expect(rule(componentsCss, ".mptamount")).toMatchObject({ "overflow-wrap": "anywhere", "font-variant-numeric": "tabular-nums" });
  });

  it("draws the check flow's text anywhere it must, so that a long amount or issuer does not widen the page", () => {
    expect(rule(componentsCss, ".checkflow")["overflow-wrap"]).toBe("anywhere");
  });
});

describe("the ledger object pages", () => {
  // The title line's ledger and transaction, the removed banner's, and the issuer of a token's amount are links inside words: each is told from them by more than its colour
  // (WCAG 1.4.1). An issuer without a name is its mono address; a named one underlines its name already (`a.acct:not(.ent) > .acct__name`, components.css), so that link draws no second line.
  it("underlines the links inside their sentences", () => {
    expect(rule(pagesCss, ".object-page__titleline a,\n.object-page__removed a,\n.object-page__issuer a.mono")["text-decoration"]).toBe("underline");
  });

  it("puts the two cards side by side while there is room for 400 px each, and one under the other when there is not, each able to shrink", () => {
    expect(rule(pagesCss, ".object-page__col")).toMatchObject({ flex: "1 1 400px", "min-width": "0" });
  });

  // The channel's deposit: the two parts under the bar share a row while they fit and wrap under one another on a phone, and a long amount breaks at the edge of its part. Each class is declared
  // once in the sheet: a second rule of the same selector later in the file would override the first without a word (an AccountLink once lost its look that way).
  it("lays the deposit's two parts out side by side, wrapping on a phone, with the amount in the page's text colour and the name and share faint", () => {
    // The deposit is the legend, the bar and the parts one under another, with a gap between them.
    expect(rule(pagesCss, ".object-page__deposit")).toMatchObject({ display: "flex", "flex-direction": "column", gap: "10px" });
    expect(rule(pagesCss, ".object-page__shares")).toMatchObject({ display: "flex", "flex-wrap": "wrap", "justify-content": "space-between" });
    expect(rule(pagesCss, ".object-page__share")).toMatchObject({ display: "flex", "flex-direction": "column", "min-width": "0", "overflow-wrap": "anywhere" });
    expect(rule(pagesCss, ".object-page__share-amount").color).toBe("var(--fg)");
    expect(rule(pagesCss, ".object-page__share-name,\n.object-page__share-of").color).toBe("var(--faint)");
  });

  // The check's flow stands in half a page, where its three boxes and their arrows do not fit in a row: the card says so (a container query), not the screen, and the boxes then stand one
  // under another with their arrows pointing down, as `.flow__arrow` does on a phone (the media rule above it, which is the screen's).
  it("stacks the check's flow, its arrows pointing down, where its card is narrower than three boxes in a row, by a container query on the card", () => {
    expect(rule(pagesCss, ".object-page__flow")).toMatchObject({ "container-type": "inline-size" });
    const stacked = /@container \(width < 720px\) \{\s*\.object-page__flow \.flow__arrow \{\s*width: 100%;\s*\}\s*\.object-page__flow \.flow__arrow > svg \{\s*transform: rotate\(90deg\);\s*\}\s*\}/;
    expect(pagesCss).toMatch(stacked);
  });

  const DECLARED_ONCE = [
    ".object-page__flow",
    ".object-page__deposit",
    ".object-page__shares",
    ".object-page__share",
    ".object-page__share-name",
    ".object-page__share-of",
    ".object-page__share-amount",
    ".object-page__claims",
  ];
  it.each(DECLARED_ONCE)("declares %s once in the sheet", (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(pagesCss.match(new RegExp(`(?:^|[},])\\s*${escaped}\\s*[{,]`, "gm")) ?? []).toHaveLength(1);
  });
});

describe("the account's Delegation tab", () => {
  // The tab's two lists are tables of the page's DataTable under a head each; what the stylesheet adds is the intro with its legend, the head of a section, the cell of the chips and the foot under a
  // table. Each class is declared once in the sheet: a second rule of the same selector later in the file would override the first without a word (an AccountLink once lost its look that way).
  it("lays the intro and its legend out side by side while there is room, the legend wrapping under the words on a phone", () => {
    expect(rule(pagesCss, ".delegation__intro")).toMatchObject({ display: "flex", "flex-wrap": "wrap", "justify-content": "space-between" });
    expect(rule(pagesCss, ".delegation__intro > p").flex).toBe("1 1 560px");
    expect(rule(pagesCss, ".delegation__legend")).toMatchObject({ display: "flex", "flex-wrap": "wrap", color: "var(--muted)" });
    expect(rule(pagesCss, ".delegation__key")).toMatchObject({ display: "inline-flex", "align-items": "center" });
  });

  it("separates the two lists by a line, and heads each with its title above its sentence in the muted colour", () => {
    expect(rule(pagesCss, ".delegation__section")["border-top"]).toBe("1px solid var(--border)");
    expect(rule(pagesCss, ".delegation__head")).toMatchObject({ display: "flex", "flex-direction": "column" });
    expect(rule(pagesCss, ".delegation__sub").color).toBe("var(--muted)");
  });

  it("wraps the chips of a delegation inside their cell, a row as tall as its chips need, with the count after them in the faint colour", () => {
    expect(rule(pagesCss, ".delegation__perms")).toMatchObject({ display: "flex", "flex-wrap": "wrap", "align-items": "center" });
    expect(rule(pagesCss, ".delegation__count").color).toBe("var(--faint)");
  });

  it("writes the notes under a list in the faint colour, one under another", () => {
    expect(rule(pagesCss, ".delegation__foot")).toMatchObject({ display: "flex", "flex-direction": "column", color: "var(--faint)" });
  });

  const DECLARED_ONCE = [
    ".delegation__intro",
    ".delegation__legend",
    ".delegation__key",
    ".delegation__section",
    ".delegation__head",
    ".delegation__sub",
    ".delegation__perms",
    ".delegation__count",
    ".delegation__foot",
  ];
  it.each(DECLARED_ONCE)("declares %s once in the sheet", (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(pagesCss.match(new RegExp(`(?:^|[},])\\s*${escaped}\\s*[{,]`, "gm")) ?? []).toHaveLength(1);
  });

  it("does not declare them in the component sheet or the base sheet either", () => {
    for (const css of [componentsCss, baseCss]) expect(css).not.toContain(".delegation__");
  });
});

describe("the transaction page's delegation", () => {
  // What a transaction a delegate sent adds (ledger object pages spec 6.2): the note under the summary's sentence (a DelegateSet's), and the "Sent by" row, the delegate on a line of its own
  // with what that means under it, both in the board's small muted words. Each class is declared once in the sheet: a second rule of the same selector later in the file would override
  // the first without a word (an AccountLink once lost its look that way).
  it("writes the note under the sentence small and muted", () => {
    expect(rule(pagesCss, ".summary__note")).toMatchObject({ color: "var(--muted)", "font-size": "13px" });
  });

  it("puts the delegate of the Sent by row above what that means, which is small and muted", () => {
    expect(rule(pagesCss, ".sentby")).toMatchObject({ display: "flex", "flex-direction": "column", "align-items": "flex-start" });
    expect(rule(pagesCss, ".sentby__why")).toMatchObject({ color: "var(--muted)", "font-size": "12.5px" });
  });

  it("underlines the link in what that means: in dark its colour is 1.01:1 against the words round it (WCAG 1.4.1; axe, in light: link-in-text-block)", () => {
    expect(rule(pagesCss, ".sentby__why a")).toMatchObject({ "text-decoration": "underline", "text-underline-offset": "3px" });
  });

  const DECLARED_ONCE = [".summary__note", ".sentby", ".sentby__why"];
  it.each(DECLARED_ONCE)("declares %s once in the sheet", (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(pagesCss.match(new RegExp(`(?:^|[},])\\s*${escaped}\\s*[{,]`, "gm")) ?? []).toHaveLength(1);
  });

  it("does not declare them in the component sheet or the base sheet either", () => {
    for (const css of [componentsCss, baseCss]) {
      expect(css).not.toContain(".sentby");
      expect(css).not.toContain(".summary__note");
    }
  });
});

describe("the end of a row of the account's Objects tab", () => {
  // Where a row leads (ledger object pages spec 7: "Open escrow →" and the like, the board's button; an NFT page's "See the account’s NFTs") over the transaction that last changed it, at the
  // row's end; on a phone, where the row wraps, at the start of a line of its own. The link under the button is 24 px high, so the two do not crowd each other (axe, WCAG 2.5.8).
  it("stacks the button over the transaction's link at the row's end, the link 24 px high, and lines them up on the left on a phone", () => {
    expect(rule(pagesCss, ".object__end")).toMatchObject({ display: "flex", "flex-direction": "column", "align-items": "flex-end", "margin-left": "auto" });
    expect(rule(pagesCss, ".object__tx")).toMatchObject({ display: "inline-flex", "align-items": "center", "min-height": "24px" });
    expect(pagesCss).toMatch(/@media \(max-width: 640px\) \{[^@]*\.object__end \{\s*align-items: flex-start;\s*margin-left: 0;\s*\}/);
  });

  it("gives the transaction's link 44 px on a touch screen and on a phone (spec 8), where it is a target of its own", () => {
    expect(pagesCss).toMatch(/@media \(pointer: coarse\), \(max-width: 720px\) \{\s*\.object__tx \{\s*min-height: 44px;\s*\}/);
  });

  // Each class is declared once in the sheet but for the phone's rule: a second rule of the same selector later in the file would override the first without a word.
  const outsideMedia = pagesCss.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "");
  it.each([".object__end", ".object__tx"])("declares %s once in the sheet, the phone's rule aside", (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(outsideMedia.match(new RegExp(`(?:^|[},])\\s*${escaped}\\s*[{,]`, "gm")) ?? []).toHaveLength(1);
  });

  it("does not declare them in the component sheet or the base sheet either", () => {
    for (const css of [componentsCss, baseCss]) expect(css).not.toMatch(/\.object__(end|tx)\b/);
  });
});

describe("the type link of a transaction's ledger objects touched", () => {
  // `.objects li > a` lets the account's link shrink and ellipsize beside the rest of its row (ledger object pages spec 7: the type is now a link too, which the rule also matches). The type keeps
  // its own width, as its text did, so that "PayChannel" never reads "PayCh…" beside a long name.
  it("does not shrink, whatever the account's link beside it does", () => {
    expect(rule(pagesCss, ".objects li > a")["min-width"]).toBe("0");
    expect(rule(pagesCss, ".objects__type").flex).toBe("none");
  });

  it("declares .objects__type once in the sheet, and not in the component sheet or the base sheet", () => {
    expect(pagesCss.match(/(?:^|[},])\s*\.objects__type\s*[{,]/gm) ?? []).toHaveLength(1);
    for (const css of [componentsCss, baseCss]) expect(css).not.toContain(".objects__type");
  });
});

describe("the hints of the search box", () => {
  // The tag of a hash's hint is "Transaction, ledger, URIToken, escrow, check or payment channel" (E10), about 400 px of 12 px text: wider than a 375 px phone. `.type` never wraps (a transaction
  // type is one word), so in a hint it does (e2e a11y: "a hint of a hash fits a … px phone").
  it("lets the tag of a hint wrap, though a type tag never does", () => {
    expect(rule(componentsCss, ".type")["white-space"]).toBe("nowrap");
    expect(rule(componentsCss, ".search__hints .hit .type")["white-space"]).toBe("normal");
  });

  it("lets the row of a hint wrap, and gives the hash at least 8rem of it", () => {
    expect(rule(componentsCss, ".search__hints .hit")["flex-wrap"]).toBe("wrap");
    expect(rule(componentsCss, ".search__hints .hit__detail")["flex-basis"]).toBe("8rem");
  });
});
