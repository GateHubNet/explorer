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
