// What a link-preview image says (spec 9), as plain data: the words and numbers of the card, and nothing of how it is drawn. The server
// makes it from the same facts as a page's tags (app/server/card-data.ts); app/og/card.tsx draws it. Types and two constants only, so
// the pages' tags (which the browser runs too) can name the size of the image without pulling in the renderer.

/** The size every link-preview image has (the `og:image:width` and `og:image:height` of the pages). */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** A piece of text on the card: in the text font, or in the monospaced one (amounts, accounts, hashes, ledger indexes). */
export interface CardRun {
  text: string;
  mono?: boolean;
}

export interface CardData {
  /** Whose accent the card is drawn in. */
  network: "xrpl" | "xahau";
  /** The pill at the top right: `XRPL mainnet`. */
  networkLabel: string;
  /** What the card is of, above the headline: `Payment`, `Ledger`, `Account`. */
  kind: string;
  /** The result of a transaction, as a chip beside the kind. Left out for a ledger and an account. */
  status?: "success" | "failed";
  /** The big line: an amount, a ledger index, an address, or a sentence when there is nothing better. */
  headline: { text: string; mono: boolean };
  /** The accounts under the headline, in monospace: one, or from and to with an arrow between. */
  parties?: string[];
  /** A line of text under the headline. */
  note?: string;
  /** The bottom left. */
  footer: CardRun[];
  /** The bottom right, in monospace: a short hash. */
  footerEnd?: string;
}
