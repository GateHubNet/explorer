// The layout of the link-preview image (spec 9, the LinkPreview board): 1200 × 630, a bar and a logo in the network's accent, the kind of
// object and its result, one big line, the accounts, and a footer. A tree of plain elements for Satori, which draws a
// subset of CSS: every element with more than one child is `display: flex`, sizes are numbers, and nothing is fetched. Pure: no I/O,
// and no React runtime beyond the elements themselves (the tree is never rendered to a page).
//
// The image is always drawn in the light theme, as the board is.

import type { CSSProperties, ReactElement, ReactNode } from "react";

import { PRODUCT_NAME } from "../ui/brand";
import { CARD_HEIGHT, CARD_WIDTH, type CardData, type CardRun } from "./types";

/** A network's accent (spec 8, `--accent-xrpl` and `--accent-xahau` of app/ui/tokens.css). */
export const ACCENTS = { xrpl: "#2F5BEA", xahau: "#B45309" } as const;

/** What `card` returns: an element of the kind Satori reads, `{ type, props }`. */
export type CardElement = ReactElement<{ style?: CSSProperties; children?: ReactNode; [prop: string]: unknown }, string>;

// The families `fonts.ts` loads.
const TEXT = "Geist";
const MONO = "Geist Mono";

// The board's colours that are not accents (the light column of spec 8 and the board's own greys).
const INK = "#0F1217";
const SECONDARY = "#3B434E";
const MUTED = "#4F5864";
const BORDER = "#E1E4E9";
const RULE = "#EEF0F3";
const ARROW = "#7A8390";
const SUCCESS = { color: "#17733F", background: "#E3F3E9" };
const FAILURE = { color: "#B42318", background: "#FCEBE9" };

/** The width between the card's side padding. */
const CONTENT_WIDTH = CARD_WIDTH - 2 * 72;

// ---- The size of the big line ------------------------------------------------------------------------------------------------------

const HEADLINE_MAX = 92;
const HEADLINE_MIN = 36;
/** The advance of a character of Geist Mono, in ems, less the board's letter spacing of -0.035em. */
const MONO_ADVANCE = 0.6 - 0.035;
/** A sentence is set in at most three lines; this is its mean character width in ems (Geist, weight 600, with room for a word that wraps early). */
const SENTENCE_ADVANCE = 0.62;
const SENTENCE_MAX_SIZE = 56;
const SENTENCE_MIN_SIZE = 40;

/** The most characters of a monospaced headline that fit the width at the smallest size. */
const MONO_MAX_CHARS = Math.floor(CONTENT_WIDTH / (HEADLINE_MIN * MONO_ADVANCE));
const SENTENCE_MAX_CHARS = 100;

/**
 * The font size of the headline: the board's 92 px for a short amount, smaller as it gets longer so that it stays on one line (an amount,
 * an address) or within three (a sentence, 56 px at the most), and 36 px (40 for a sentence) at the least.
 */
export function headlineSize(text: string, mono: boolean): number {
  const length = Math.max(1, Array.from(text).length);
  if (mono) return Math.max(HEADLINE_MIN, Math.min(HEADLINE_MAX, Math.floor(CONTENT_WIDTH / (length * MONO_ADVANCE))));
  return Math.max(SENTENCE_MIN_SIZE, Math.min(SENTENCE_MAX_SIZE, Math.floor((3 * CONTENT_WIDTH) / (length * SENTENCE_ADVANCE))));
}

function fitted(text: string, mono: boolean): string {
  const max = mono ? MONO_MAX_CHARS : SENTENCE_MAX_CHARS;
  const characters = Array.from(text);
  return characters.length > max ? `${characters.slice(0, max - 1).join("")}…` : text;
}

// ---- Pieces ---------------------------------------------------------------------------------------------------------------------------

/** An element: a function in place of JSX so that the tree is plain data, with no component for Satori to call. */
function el(type: "div" | "span", style: CSSProperties, ...parts: ReactNode[]): CardElement {
  // What is not there (no chip, no note) is left out, not passed on as a child.
  const children = parts.filter((part) => part !== null && part !== undefined && part !== false);
  const props: { style: CSSProperties; children?: ReactNode } = { style };
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;
  return { type, props, key: null } as unknown as CardElement;
}

/** An SVG icon: `shapes` are the drawn parts, as `[tag, attributes]`. */
function icon(size: number, viewBox: string, shapes: Array<["path" | "rect", Record<string, string | number>]>): CardElement {
  return {
    type: "svg",
    key: null,
    props: {
      width: size,
      height: size,
      viewBox,
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      children: shapes.map(([type, props]) => ({ type, key: null, props })),
    },
  } as unknown as CardElement;
}

function logo(accent: string): CardElement {
  return icon(48, "0 0 28 28", [
    ["rect", { width: 28, height: 28, rx: 8, fill: accent }],
    ["path", { d: "M8 10h7M8 14h12M8 18h9", stroke: "#FFFFFF", "stroke-width": 2.2, "stroke-linecap": "round" }],
  ]);
}

function chip(status: "success" | "failed"): CardElement {
  const ok = status === "success";
  const { color, background } = ok ? SUCCESS : FAILURE;
  const path = ok ? "M5 12.5l4.5 4.5L19 7.5" : "M6 6l12 12M18 6L6 18";
  return el(
    "div",
    { display: "flex", alignItems: "center", gap: 10, fontSize: 26, fontWeight: 600, color, background, borderRadius: 999, padding: "6px 18px" },
    icon(24, "0 0 24 24", [["path", { d: path, stroke: color, "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }]]),
    el("span", {}, ok ? "Success" : "Failed"),
  );
}

function arrow(): CardElement {
  return icon(34, "0 0 24 24", [["path", { d: "M5 12h14M13 6l6 6-6 6", stroke: ARROW, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }]]);
}

/** A piece of the footer: its spaces are kept. */
function run({ text, mono }: CardRun): CardElement {
  return el("span", { whiteSpace: "pre", ...(mono ? { fontFamily: MONO } : {}) }, text);
}

// ---- The card ----------------------------------------------------------------------------------------------------------------------------

export function card(data: CardData): CardElement {
  const accent = ACCENTS[data.network];
  const headline = fitted(data.headline.text, data.headline.mono);
  const mono = data.headline.mono;

  const parties =
    data.parties && data.parties.length > 0
      ? el(
          "div",
          { display: "flex", alignItems: "center", gap: 18, fontFamily: MONO, fontSize: 34, color: SECONDARY },
          ...data.parties.flatMap((party, i) => (i === 0 ? [el("span", {}, party)] : [arrow(), el("span", {}, party)])),
        )
      : null;

  const top = el(
    "div",
    { display: "flex", alignItems: "center", justifyContent: "space-between" },
    el(
      "div",
      { display: "flex", alignItems: "center", gap: 16 },
      logo(accent),
      el("span", { fontSize: 30, fontWeight: 600, letterSpacing: -0.3 }, PRODUCT_NAME),
    ),
    el(
      "div",
      { display: "flex", alignItems: "center", gap: 12, fontSize: 26, fontWeight: 500, color: SECONDARY, border: `2px solid ${BORDER}`, borderRadius: 999, padding: "8px 22px" },
      el("div", { width: 14, height: 14, borderRadius: 7, background: accent }),
      el("span", {}, data.networkLabel),
    ),
  );

  const middle = el(
    "div",
    { display: "flex", flexDirection: "column", gap: 18 },
    el(
      "div",
      { display: "flex", alignItems: "center", gap: 18 },
      el("span", { fontSize: 34, fontWeight: 600, color: SECONDARY }, data.kind),
      data.status ? chip(data.status) : null,
    ),
    el(
      "span",
      mono
        ? { fontFamily: MONO, fontSize: headlineSize(headline, true), fontWeight: 500, letterSpacing: -0.035 * headlineSize(headline, true), lineHeight: 1, whiteSpace: "nowrap" }
        : { fontSize: headlineSize(headline, false), fontWeight: 600, lineHeight: 1.2, lineClamp: 3 },
      headline,
    ),
    parties,
    data.note ? el("span", { fontSize: 34, color: SECONDARY }, data.note) : null,
  );

  const bottom = el(
    "div",
    { display: "flex", alignItems: "flex-end", justifyContent: "space-between", borderTop: `2px solid ${RULE}`, paddingTop: 24, fontSize: 24, color: MUTED },
    el("div", { display: "flex", alignItems: "baseline" }, ...data.footer.map(run)),
    data.footerEnd ? el("span", { fontFamily: MONO }, data.footerEnd) : el("div", {}),
  );

  return el(
    "div",
    { display: "flex", flexDirection: "column", width: CARD_WIDTH, height: CARD_HEIGHT, background: "#FFFFFF", color: INK, fontFamily: TEXT },
    el("div", { height: 10, background: accent }),
    el(
      "div",
      { display: "flex", flexDirection: "column", justifyContent: "space-between", flexGrow: 1, padding: "56px 72px 52px" },
      top,
      middle,
      bottom,
    ),
  );
}
