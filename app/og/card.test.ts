import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ACCENTS, card, headlineSize, LOGO_SIZE, type CardElement } from "./card";
import { CARD_HEIGHT, CARD_WIDTH, type CardData } from "./types";

// The layout of the link-preview image (the LinkPreview board): a tree of elements for Satori, which draws a subset of CSS. The tests
// walk the tree for what the board shows and for what Satori needs (every element with several children is a flex container, no image
// is fetched); the PNG itself is drawn in test/worker/og.spec.ts.

const PAYMENT: CardData = {
  network: "xrpl",
  networkLabel: "XRPL mainnet",
  kind: "Payment",
  status: "success",
  headline: { text: "1,250.00 USD", mono: true },
  parties: ["rJF2Xa…FQvg", "rNYbL8…UKq5"],
  footer: [{ text: "Ledger " }, { text: "#107,695,660", mono: true }, { text: " · 17 Oct 2026, 15:42 UTC" }],
  footerEnd: "67F91E…7C31",
};

/** Every node of a tree, the root first. */
function nodes(node: unknown): CardElement[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object" || node === null) return [];
  const element = node as CardElement;
  return [element, ...nodes(element.props.children)];
}

/** The text of a tree, in reading order, one string per text node. */
function texts(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(texts);
  if (typeof node === "string") return [node];
  if (typeof node === "number") return [String(node)];
  if (typeof node !== "object" || node === null) return [];
  return texts((node as CardElement).props.children);
}

const childrenOf = (element: CardElement): unknown[] => {
  const { children } = element.props;
  return Array.isArray(children) ? children.flat(Infinity).filter((child) => child !== null && child !== false && child !== undefined) : children === undefined ? [] : [children];
};

describe("the card", () => {
  it("is 1200 × 630", () => {
    const root = card(PAYMENT);
    expect(root.props.style).toMatchObject({ width: CARD_WIDTH, height: CARD_HEIGHT });
    expect([CARD_WIDTH, CARD_HEIGHT]).toEqual([1200, 630]);
  });

  it("shows what the board shows, in order", () => {
    const text = texts(card(PAYMENT)).join("|");
    for (const part of ["XRPL mainnet", "Payment", "Success", "1,250.00 USD", "rJF2Xa…FQvg", "rNYbL8…UKq5", "Ledger ", "#107,695,660", " · 17 Oct 2026, 15:42 UTC", "67F91E…7C31"]) {
      expect(text, part).toContain(part);
    }
    const order = ["XRPL mainnet", "Payment", "Success", "1,250.00 USD", "rJF2Xa…FQvg", "rNYbL8…UKq5", "#107,695,660", "67F91E…7C31"].map((part) => text.indexOf(part));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("starts with the header's logo, the dark one, drawn from its file at the logo's height", () => {
    const file = readFileSync(new URL("../ui/logo/gatehub-explorer-dark.svg", import.meta.url), "utf8");
    const logo = nodes(card(PAYMENT)).find((node) => node.type === "svg")!;
    // 130 × 48, at 72 px: 195 px wide.
    expect(logo.props).toMatchObject({ viewBox: "0 0 130 48", width: 195, height: LOGO_SIZE });
    const paths = childrenOf(logo) as CardElement[];
    expect(paths.map((path) => path.props.d)).toEqual(Array.from(file.matchAll(/ d="([^"]*)"/g), ([, d]) => d));
    expect(new Set(paths.map((path) => path.props.fill))).toEqual(new Set(["#2B3040"]));
    // "Explorer", lighter than "GateHub", as in the file.
    expect(paths.filter((path) => path.props.opacity === "0.7")).toHaveLength(1);
    // Its words are the logo's: the product's name is not written beside it.
    expect(texts(card(PAYMENT))).not.toContain("explorer");
  });

  it("says Failed with the failure's icon and text, not by colour alone", () => {
    const failed = card({ ...PAYMENT, status: "failed" });
    expect(texts(failed).join("|")).toContain("Failed");
    expect(texts(failed).join("|")).not.toContain("Success");
    // The icon is part of the chip: an svg inside it.
    const chip = nodes(failed).find((node) => texts(node).join("") === "Failed" && nodes(node).some((inner) => inner.type === "svg"));
    expect(chip).toBeDefined();
  });

  it("has no chip for a card with no result (a ledger, an account)", () => {
    const text = texts(card({ network: "xrpl", networkLabel: "XRPL mainnet", kind: "Ledger", headline: { text: "#1", mono: true }, footer: [{ text: "Closed x" }] })).join("|");
    expect(text).not.toMatch(/Success|Failed/);
  });

  it("draws the accent of the network on the top bar and the pill", () => {
    expect(ACCENTS).toEqual({ xrpl: "#0A6CF1", xahau: "#B45309" });
    for (const [network, accent] of Object.entries(ACCENTS)) {
      const root = card({ ...PAYMENT, network: network as "xrpl" | "xahau" });
      const painted = nodes(root).filter((node) => JSON.stringify(node.props).includes(accent));
      // Top bar and the dot of the pill.
      expect(painted.length, network).toBeGreaterThanOrEqual(2);
    }
    expect(JSON.stringify(card(PAYMENT))).not.toContain(ACCENTS.xahau);
  });

  it("uses the accents of the design tokens", () => {
    const css = readFileSync(new URL("../ui/tokens.css", import.meta.url), "utf8");
    expect(css).toContain(`--accent-xrpl: ${ACCENTS.xrpl}`);
    expect(css).toContain(`--accent-xahau: ${ACCENTS.xahau}`);
  });

  it("uses Geist for text and Geist Mono for the headline amount, the accounts, the ledger and the hash", () => {
    const families = new Set(nodes(card(PAYMENT)).flatMap((node) => ((node.props.style as { fontFamily?: string } | undefined)?.fontFamily ? [(node.props.style as { fontFamily: string }).fontFamily] : [])));
    expect([...families].sort()).toEqual(["Geist", "Geist Mono"]);
    const mono = nodes(card(PAYMENT))
      .filter((node) => (node.props.style as { fontFamily?: string } | undefined)?.fontFamily === "Geist Mono")
      .flatMap((node) => texts(node));
    expect(mono).toEqual(expect.arrayContaining(["1,250.00 USD", "rJF2Xa…FQvg", "rNYbL8…UKq5", "#107,695,660", "67F91E…7C31"]));
  });

  it("is something Satori can draw: an element with several children is a flex container, and nothing is fetched", () => {
    for (const data of [
      PAYMENT,
      { ...PAYMENT, status: undefined, parties: ["rJF2Xa…FQvg"] },
      { network: "xahau", networkLabel: "Xahau mainnet", kind: "Ledger", headline: { text: "#26,540,187", mono: true }, note: "7 transactions · 1 failed", footer: [{ text: "Closed " }, { text: "x" }], footerEnd: "AAAAAA…BBBB" } as CardData,
    ]) {
      for (const node of nodes(card(data))) {
        expect(["div", "span", "svg", "path", "rect"], String(node.type)).toContain(node.type);
        if (node.type === "svg" || node.type === "path" || node.type === "rect") continue;
        if (childrenOf(node).length > 1) {
          expect((node.props.style as { display?: string } | undefined)?.display, `${String(node.type)}: ${texts(node).join("|")}`).toBe("flex");
        }
        // No image, no `src`, nothing to fetch.
        expect(node.props).not.toHaveProperty("src");
      }
    }
  });

  it("has an arrow between the two accounts, and none for one", () => {
    const arrows = (data: CardData) => nodes(card(data)).filter((node) => node.type === "svg" && JSON.stringify(node.props).includes("M5 12h14M13 6l6 6-6 6")).length;
    expect(arrows(PAYMENT)).toBe(1);
    expect(arrows({ ...PAYMENT, parties: ["rJF2Xa…FQvg"] })).toBe(0);
    expect(arrows({ ...PAYMENT, parties: undefined })).toBe(0);
  });

  it("sets a sentence in at most three lines, at a size that leaves room for them between the header and the footer", () => {
    const sentence = "word ".repeat(19).trim();
    const data: CardData = { ...PAYMENT, headline: { text: sentence, mono: false }, parties: undefined };
    const headline = nodes(card(data)).find((node) => texts(node).join("") === sentence)!;
    const style = headline.props.style as { fontSize: number; lineHeight: number; lineClamp: number };
    expect(style.lineClamp).toBe(3);
    // The body is 630 - 10 (bar) - 56 - 52 (padding) = 512 px; the header row is the logo's height, the footer about 90 with its rule, the kind row 40 and two gaps of 18.
    expect(3 * style.fontSize * style.lineHeight + LOGO_SIZE + 90 + 40 + 2 * 18).toBeLessThanOrEqual(512);
  });

  it("puts a sentence in the text font and a note under the headline", () => {
    const data: CardData = { ...PAYMENT, headline: { text: "rJF2Xa…FQvg set a trust line", mono: false }, note: "66 transactions · 2 failed", parties: undefined };
    const text = texts(card(data));
    expect(text).toContain("rJF2Xa…FQvg set a trust line");
    expect(text).toContain("66 transactions · 2 failed");
  });
});

describe("headlineSize", () => {
  it("is the board's 92 px for a short amount", () => {
    expect(headlineSize("1,250.00 USD", true)).toBe(92);
  });

  it("shrinks a long monospaced headline to fit the width and never below 36 px", () => {
    const widthOf = (text: string, size: number) => text.length * size * 0.6;
    const text = "123,456,789,012.123456 XRP";
    const size = headlineSize(text, true);
    expect(size).toBeLessThan(92);
    expect(size).toBeGreaterThanOrEqual(36);
    // 1056 px is the width between the card's padding.
    expect(widthOf(text, size)).toBeLessThanOrEqual(1056 * 1.06);
    expect(headlineSize("x".repeat(200), true)).toBe(36);
  });

  it("is smaller for a sentence, and shrinks as it grows", () => {
    expect(headlineSize("short", false)).toBeLessThanOrEqual(64);
    expect(headlineSize("x".repeat(120), false)).toBeLessThan(headlineSize("short", false));
  });
});

describe("the headline that does not fit", () => {
  it("is cut with an ellipsis, in the card", () => {
    const long = "1".repeat(120);
    const text = texts(card({ ...PAYMENT, headline: { text: long, mono: true } })).filter((part) => part.startsWith("1"));
    expect(text).toHaveLength(1);
    expect(text[0]!.endsWith("…")).toBe(true);
    expect(Array.from(text[0]!).length).toBeLessThan(long.length);
  });
});
