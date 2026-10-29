// What the specs of display names share (names.spec.ts, names-live.spec.ts and a11y.spec.ts's block of them): what a link to an account must read and carry, worked out from the names
// fixtures and never from a name written by hand. The Worker specs have their own (test/support/names.ts reads the fixtures through the app's own view code, `nameViewOf` and `linkTextOf`);
// the words here are the spec's, written out, so that a page that drew them wrongly is not excused by the code that drew them. (test/support/names.ts could not be imported here in any case:
// it uses `import.meta.glob`, which only Vite knows.)

import type { Locator } from "@playwright/test";

import { fixtureEntryOf, type FixtureName } from "./fixtures";
import { expect } from "./support";

export type Net = "xrpl" | "xahau";

/** The words a mark adds to a name in a link's text: the seal and the tag are read by a screen reader as these; the domain's tag is text. */
export const MARK_WORDS = { verified: "verified name", account: "named by GateHub", domain: "not verified" } as const;

/** A list as a sentence says it: `a`, `a and b`, `a, b and c`. */
export const joinAnd = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)!}`);

/** An address as a link shortens it. */
export const shortOf = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** The text of an element as a reader reads it: white space collapsed. */
export const flat = (text: string | null): string => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * What the fixtures say of an account, as a link to it must read (`text`: the name, the words of its mark and of its labels' mark, and the whole address after them for a `full` link; for
 * an account with no name its address, short or whole, then its labels' words) and carry (`title`). `named` is whether the link is by a name, and `kind` how the name is known.
 */
export function drawnBy(net: Net, address: string, { full = false }: { full?: boolean } = {}) {
  const entry: FixtureName = fixtureEntryOf(net, address) ?? {};
  const labels = Object.keys(entry.labels ?? {});
  const labelWords = labels.length > 0 ? `labelled ${joinAnd(labels)} by GateHub` : undefined;
  const labelTitle = labels.length > 0 ? ` · Labelled ${joinAnd(labels)} by GateHub` : "";
  const name = entry.display_name;
  if (!name) {
    return {
      named: false as const,
      kind: undefined,
      text: [full ? address : shortOf(address), labelWords].filter(Boolean).join(" "),
      title: labels.length > 0 ? `${address}${labelTitle}` : full ? null : address,
    };
  }
  const text = entry.account_network_name && entry.account_network_name !== name.text ? `${name.text} · ${entry.account_network_name}` : name.text;
  const known = name.kind === "verified" ? `Verified by ${entry.domain} · ${address}` : name.kind === "account" ? `Named by GateHub · ${address}` : `Domain not verified · ${address}`;
  return {
    named: true as const,
    kind: name.kind,
    text: [text, MARK_WORDS[name.kind], labelWords, full ? address : undefined].filter(Boolean).join(" "),
    title: `${known}${labelTitle}`,
  };
}

/**
 * Says that every link to an account of `net` in `scope` is drawn as the fixtures say (`drawnBy`): the name with its marks and the title that says how it is known, and the address with the
 * title that is the whole address for an account they give no name. `full` says how the scope draws its links: whole addresses, short ones, or `"either"` (a page that has both). Returns what it
 * saw (the kinds of the names, how many links were plain), so that a test can say that it looked at both.
 */
export async function expectAccountsDrawn(scope: Locator, net: Net, { full = false }: { full?: boolean | "either" } = {}) {
  const links = await scope.locator(`a[href^="/${net}/account/"]`).evaluateAll((anchors) =>
    anchors.map((anchor) => ({ href: anchor.getAttribute("href") ?? "", text: anchor.textContent ?? "", title: anchor.getAttribute("title") })),
  );
  expect(links.length, "the scope links accounts").toBeGreaterThan(0);
  const kinds = new Set<string>();
  let plain = 0;
  for (const link of links) {
    const address = link.href.slice(`/${net}/account/`.length).split(/[?#]/)[0]!;
    const whole = full === "either" ? flat(link.text).includes(address) : full;
    const expected = drawnBy(net, address, { full: whole });
    expect(flat(link.text), `the link to ${address}`).toBe(expected.text);
    expect(link.title, `the link to ${address}`).toBe(expected.title);
    if (expected.named) kinds.add(expected.kind);
    else plain += 1;
  }
  return { kinds, plain, links: links.length };
}
