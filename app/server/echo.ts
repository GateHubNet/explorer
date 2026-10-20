// What a not-found page repeats of what the visitor asked for (`We couldn't find account "…" on XRPL`): the text of a URL, which anyone can
// write and link to. Worker-only code, no I/O.

/** How much of what was asked the not-found page repeats, in code points. */
export const ECHO_LENGTH = 40;

/**
 * The characters a not-found page leaves out of what it repeats: the format characters (`\p{Cf}`: the bidi embeddings and overrides
 * U+202A–U+202E and isolates U+2066–U+2069, which would reorder the sentence they are put in, and the zero-width ones) and the C1 controls
 * (U+0080–U+009F). `JSON.stringify` escapes the C0 controls, the quote and the backslash, and none of these.
 */
const UNSHOWN = /[\p{Cf}\u0080-\u009F]/gu;

/**
 * What was asked as the not-found page says it: without the characters that change how a sentence is drawn (`UNSHOWN`), cut to `ECHO_LENGTH`
 * code points (between characters: a surrogate pair is one), in quotes, escaped as `JSON.stringify` escapes a string. The one echo of the
 * account, ledger, transaction and market pair routes.
 */
export function echoOf(asked: string): string {
  return JSON.stringify([...asked.replace(UNSHOWN, "")].slice(0, ECHO_LENGTH).join(""));
}
