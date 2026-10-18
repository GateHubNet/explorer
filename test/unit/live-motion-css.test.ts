import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// What the home page's live updates (a new row, a changed figure) may do in the stylesheet: how long they move, that they run once, that the
// highlight leaves every text of the page at WCAG AA (4.5:1) in both themes and on both networks' accents, and that a visitor who asked for
// less motion gets none (README, "Live updates").

const read = (name: string) => readFileSync(new URL(`../../app/ui/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const components = read("components.css");
const base = read("base.css");
const tokens = read("tokens.css");
/** How long the rows that were there slide, from motion.ts (a module of the browser's types, which this project does not have: read as text). */
const motion = readFileSync(new URL("../../app/ui/motion.ts", import.meta.url), "utf8");
const FLIP_MS = Number(/export const FLIP_MS = (\d+);/.exec(motion)?.[1]);
/** How long a row is kept `.is-entering` by the script, from motion.ts. */
const ENTER_MS = Number(/export const ENTER_MS = (\d+);/.exec(motion)?.[1]);

/** The text between the braces that follow `head` (the first occurrence), braces balanced. */
function braces(css: string, head: string): string {
  const at = css.indexOf(head);
  if (at < 0) throw new Error(`no ${head}`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces after ${head}`);
}

/** The declarations of the rule whose selector is exactly `selector` in `css`. */
function rule(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return Object.fromEntries(
    match[1]!
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => [declaration.slice(0, declaration.indexOf(":")).trim(), declaration.slice(declaration.indexOf(":") + 1).trim()]),
  );
}

const keyframes = (name: string) => braces(components, `@keyframes ${name}`);
const ms = (value: string) => (value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000);

/** `row-enter 400ms cubic-bezier(.2,.7,.2,1) 60ms backwards, live-flash 1200ms ease-out` as one entry per animation. */
function animations(value: string) {
  return value.split(/,(?![^(]*\))/).map((part) => {
    const words = part.trim().split(/\s+(?![^(]*\))/);
    const times = words.filter((word) => /^[\d.]+m?s$/.test(word)).map(ms);
    return { name: words[0]!, duration: times[0] ?? 0, delay: times[1] ?? 0, words };
  });
}

describe("the keyframes", () => {
  it("bring a new row in with a fade and a slide of about 8 px", () => {
    const enter = keyframes("row-enter");
    expect(enter).toMatch(/from\s*\{[^}]*opacity:\s*0/);
    expect(enter).toMatch(/from\s*\{[^}]*translateY\(-8px\)/);
    expect(enter).toMatch(/to\s*\{[^}]*opacity:\s*1/);
  });

  it("bring a changed figure in from below", () => {
    const tick = keyframes("value-in");
    expect(tick).toMatch(/from\s*\{[^}]*opacity:\s*0/);
    // A short way, in the figure's own em: a share of its height would reach the note under a value that wraps onto two lines.
    expect(tick).toMatch(/from\s*\{[^}]*translateY\(0?\.\d+em\)/);
    expect(Number(/translateY\((0?\.\d+)em\)/.exec(tick)![1])).toBeLessThanOrEqual(0.5);
  });

  it("make the highlight a colour that fades out and nothing else: it moves nothing and changes no opacity", () => {
    const flash = keyframes("live-flash");
    expect(flash).toMatch(/from\s*\{[^}]*background-color:\s*color-mix\(in srgb, var\(--accent\) [\d.]+%, transparent\)/);
    expect(flash).toMatch(/to\s*\{[^}]*background-color:\s*transparent/);
    expect(flash).not.toMatch(/transform|translate|opacity|scale/);
  });

  // The wash is as strong as the text on it allows (below), which on the lightest backgrounds is hardly to be seen. What makes a new row
  // and a changed figure easy to find is a mark that is not behind any text: a bar in the row's own padding, a ring round the figure.
  it("mark a new row with a bar in its padding and a changed figure with a ring outside it, in colours that fade out, behind no text", () => {
    const bar = keyframes("row-mark");
    const ring = keyframes("value-mark");
    for (const frames of [bar, ring]) {
      expect(frames).not.toMatch(/transform|translate|opacity|scale|background/);
      expect(frames).toMatch(/from\s*\{[^}]*box-shadow:[^;}]*color-mix\(in srgb, var\(--accent\) [\d.]+%, transparent\)/);
      expect(frames).toMatch(/to\s*\{[^}]*box-shadow:[^;}]*transparent/);
    }
    // The bar is inset and thinner than the padding of a row (16 px), so that it never reaches the text; the ring is outside its element.
    const width = Number(/from\s*\{[^}]*box-shadow:\s*inset (\d+)px 0 0/.exec(bar)?.[1]);
    const padding = Number(/^0 (\d+)px$/.exec(rule(components, ".table__row").padding ?? "")?.[1]);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(padding);
    expect(ring).toMatch(/from\s*\{[^}]*box-shadow:\s*0 0 0 \d+px/);
    expect(ring).not.toMatch(/inset/);
  });
});

describe("the classes", () => {
  const entering = animations(rule(components, ".table__row.is-entering").animation!);
  const changed = animations(rule(components, ".live__value.is-changed").animation!);

  it("play a new row's slide, highlight and mark, and a changed figure's tick, highlight and mark", () => {
    expect(entering.map((a) => a.name)).toEqual(["row-enter", "live-flash", "row-mark"]);
    expect(changed.map((a) => a.name)).toEqual(["value-in", "live-flash", "value-mark"]);
  });

  it("move for 600 ms at most, the delay included, and fade the highlight out in about 1.2 s", () => {
    for (const a of [entering[0]!, changed[0]!]) expect(a.duration + a.delay, a.name).toBeLessThanOrEqual(600);
    expect(FLIP_MS).toBeLessThanOrEqual(600);
    for (const a of [entering[1]!, changed[1]!, entering[2]!, changed[2]!]) {
      expect(a.duration, a.name).toBeGreaterThanOrEqual(1000);
      expect(a.duration, a.name).toBeLessThanOrEqual(1500);
    }
  });

  it("are kept on a row by the script (ENTER_MS) for as long as the longest of them runs, and no longer than a beat", () => {
    const longest = Math.max(...entering.map((a) => a.duration + a.delay));
    expect(ENTER_MS).toBeGreaterThanOrEqual(longest);
    expect(ENTER_MS).toBeLessThanOrEqual(longest + 500);
    expect(ENTER_MS).toBeLessThan(4000);
  });

  it("run once: nothing repeats, so nothing flashes more than three times a second", () => {
    for (const a of [...entering, ...changed]) {
      expect(a.words.join(" "), a.name).not.toMatch(/infinite|alternate/);
      expect(a.words.filter((word) => /^\d+$/.test(word)), a.name).toEqual([]);
    }
  });
});

describe("contrast under the highlight", () => {
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
  const contrast = (a: Rgb, b: Rgb) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  /** The custom properties of the rule whose selector is exactly `selector`, searched in `scope`. */
  function tokensOf(selector: string, scope: string): Record<string, string> {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(scope);
    if (!match) throw new Error(`no rule for ${selector}`);
    return Object.fromEntries([...match[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim().toLowerCase()]));
  }
  const darkMedia = braces(tokens, "@media (prefers-color-scheme: dark)");
  const themes = {
    light: tokensOf(":root, [data-net]", tokens),
    dark: tokensOf(':root[data-theme="dark"], :root[data-theme="dark"] [data-net]', tokens),
    "dark by the system": tokensOf(':root:not([data-theme="light"]), :root:not([data-theme="light"]) [data-net]', darkMedia),
  };
  const accents = { xrpl: rgb(tokensOf(":root", tokens)["--accent-xrpl"]!), xahau: rgb(tokensOf(":root", tokens)["--accent-xahau"]!) };
  const share = Number(/color-mix\(in srgb, var\(--accent\) ([\d.]+)%, transparent\)/.exec(keyframes("live-flash"))![1]) / 100;

  // What is behind a highlighted element: the page (`--bg`, where the hero's status line and its examples' labels are) or a card, a tile, a
  // chip (`--surface`). The animation replaces a hovered row's colour, so a row's backdrop is its card's.
  const BACKDROPS = ["--bg", "--surface"] as const;

  /** The lowest contrast of any text colour that can be inside a highlighted element, on the highlight at `at`, over every backdrop, theme and accent. */
  function worst(at: number): { ratio: number; where: string } {
    let found = { ratio: Number.POSITIVE_INFINITY, where: "" };
    for (const [name, t] of Object.entries(themes)) {
      for (const [net, accent] of Object.entries(accents)) {
        const link = name === "light" ? accent : mix(accent, [255, 255, 255], 0.55);
        for (const backdrop of BACKDROPS) {
          const peak = mix(accent, rgb(t[backdrop]!), at);
          for (const [token, colour] of [["--fg", rgb(t["--fg"]!)], ["--muted", rgb(t["--muted"]!)], ["--faint", rgb(t["--faint"]!)], ["--link", link]] as const) {
            const ratio = contrast(colour, peak);
            if (ratio < found.ratio) found = { ratio, where: `${token} on ${backdrop}, ${name}, ${net}` };
          }
        }
      }
    }
    return found;
  }

  it("tints the background with a little of the accent", () => {
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThanOrEqual(0.05);
  });

  describe.each(Object.entries(themes))("%s", (name, t) => {
    describe.each(Object.entries(accents))("with the %s accent", (_net, accent) => {
      const link = name === "light" ? accent : mix(accent, [255, 255, 255], 0.55);

      describe.each(BACKDROPS)("on %s", (backdrop) => {
        // The highlight is the accent at `share` over what is behind the element.
        const peak = mix(accent, rgb(t[backdrop]!), share);

        it.each([
          ["--fg", () => rgb(t["--fg"]!)],
          ["--muted", () => rgb(t["--muted"]!)],
          ["--faint", () => rgb(t["--faint"]!)],
          ["--link", () => link],
        ] as const)("%s on the strongest moment of the highlight is at least 4.5:1", (_token, colour) => {
          expect(contrast(colour(), peak)).toBeGreaterThanOrEqual(4.5);
        });
      });
    });
  });

  it("is the strongest wash that keeps all of them at 4.5:1: a whole percent more would not (the Xahau link in light mode, on the page's own background)", () => {
    expect(worst(share).ratio).toBeGreaterThanOrEqual(4.5);
    expect(worst(share + 0.01).ratio).toBeLessThan(4.5);
    // And where it is the page's background that it is least on:
    expect(worst(share + 0.01).where).toMatch(/--link on --bg, light, xahau/);
  });
});

describe("prefers-reduced-motion: reduce", () => {
  const reduced = braces(components, "@media (prefers-reduced-motion: reduce)");

  it("still turns every animation and transition off in base.css", () => {
    const all = braces(base, "@media (prefers-reduced-motion: reduce)");
    expect(all).toMatch(/animation:\s*none\s*!important/);
    expect(all).toMatch(/transition:\s*none\s*!important/);
  });

  it("leaves a new row and a changed figure the highlight and the mark only: colours fading out, nothing moves", () => {
    for (const [selector, mark] of [[".table__row.is-entering", "row-mark"], [".live__value.is-changed", "value-mark"]] as const) {
      const declarations = rule(reduced, selector);
      const kept = animations(declarations.animation!.replace(/\s*!important$/, ""));
      expect(kept.map((a) => a.name), selector).toEqual(["live-flash", mark]);
      // `!important` against base.css's `animation: none !important` on `*`; the class's specificity wins between the two.
      expect(declarations.animation, selector).toMatch(/!important$/);
      expect(declarations.transform, selector).toBeUndefined();
    }
  });
});

describe("the pause button and the status", () => {
  const pages = read("pages.css");

  it("is a 44 px target (WCAG 2.2.2's pause is also a target), a pill like the examples beside it, in tokens", () => {
    const toggle = rule(components, ".live-toggle");
    expect(toggle["min-height"]).toBe("44px");
    expect(toggle["min-width"]).toBe("44px");
    expect(toggle.color).toBe("var(--muted)");
    expect(toggle.background).toBe("var(--surface)");
    // Pressed it is filled with --sunken: --muted and --fg are both AA on it (tokens.test.ts).
    expect(rule(components, '.live-toggle[aria-pressed="true"]').background).toBe("var(--sunken)");
  });

  it("sits in a row as high as the button, so that adding it when the script runs moves nothing below", () => {
    expect(rule(pages, ".hero__status-row")["min-height"]).toBe("44px");
  });

  it("says what it has to say in a token's colour that is AA on the page, and the dot goes quiet in tokens", () => {
    expect(rule(pages, ".hero__live").color).toBe("var(--muted)");
    const dot = rule(pages, ".hero__dot.is-paused");
    expect(dot.background).toBe("var(--faint)");
    expect(dot["box-shadow"]).toBe("0 0 0 4px var(--sunken)");
  });
});
