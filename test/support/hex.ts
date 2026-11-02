// Text as the ledger writes it in a field of hex (an account's `Domain`), for the tests that make one up. Pure.

/** `text` (ASCII) as upper-case hex, two digits a character. */
export const hexOfText = (text: string): string => [...text].map((char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();
