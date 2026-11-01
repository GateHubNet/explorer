// What the specs of display names share (names.spec.ts, names-live.spec.ts and a11y.spec.ts's block of them): what a link to an account must read and carry, worked out from the names
// fixtures and never from a name written by hand. The Worker specs have their own (test/support/names.ts reads the fixtures through the app's own view code, `nameViewOf` and `linkTextOf`);
// the words here are the spec's, written out, so that a page that drew them wrongly is not excused by the code that drew them. (test/support/names.ts could not be imported here in any case:
// it uses `import.meta.glob`, which only Vite knows.)

import type { Locator, Page } from "@playwright/test";

import type { FeatureVar } from "../../app/ui/features";
import { fixtureEntryOf, type FixtureName, XRPL_ACCOUNT } from "./fixtures";
import { objectCase, type ObjectCase } from "./object-pages";
import { expect } from "./support";
import { tokenCase } from "./token-pages";

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
 * saw (the kinds of the names, how many links were plain), so that a test can say that it looked at both. `except` is an account whose links the scope has under words of their own (a token
 * page's "Issuer account" button), which are left out.
 */
export async function expectAccountsDrawn(scope: Locator, net: Net, { full = false, except }: { full?: boolean | "either"; except?: string } = {}) {
  const links = await scope.locator(`a[href^="/${net}/account/"]`).evaluateAll((anchors) =>
    anchors.map((anchor) => ({ href: anchor.getAttribute("href") ?? "", text: anchor.textContent ?? "", title: anchor.getAttribute("title") })),
  );
  expect(links.length, "the scope links accounts").toBeGreaterThan(0);
  const kinds = new Set<string>();
  let plain = 0;
  for (const link of links) {
    const address = link.href.slice(`/${net}/account/`.length).split(/[?#]/)[0]!;
    if (address === except) continue;
    const whole = full === "either" ? flat(link.text).includes(address) : full;
    const expected = drawnBy(net, address, { full: whole });
    expect(flat(link.text), `the link to ${address}`).toBe(expected.text);
    expect(link.title, `the link to ${address}`).toBe(expected.title);
    if (expected.named) kinds.add(expected.kind);
    else plain += 1;
  }
  return { kinds, plain, links: links.length };
}

/**
 * A page that draws accounts, as the specs of names look at it: where it is, what shows that it is whole, where its links to accounts are (the page's main, unless it has others that are no
 * account's name), the account it is of (its tabs and its pager are links to the page by their own words), the kinds of names the links must have among them (`verified`, `account`, `domain`), and
 * whether one must be an account with a label and no name. `needs` is the switch the page needs on in the Worker under test: with it off the page is not there.
 */
export interface NamedPage {
  name: string;
  net: Net;
  path: string;
  ready: (page: Page) => Promise<void>;
  scope?: (page: Page) => Locator;
  own?: string;
  kinds: string[];
  labelled?: boolean;
  needs?: FeatureVar;
}

/** The pages of `pages` that the Worker under test has: those whose switch is not in `off` (`featuresOff(process.env)`). */
export const namedPagesOn = (pages: readonly NamedPage[], off: ReadonlySet<FeatureVar>): NamedPage[] => pages.filter((page) => page.needs === undefined || !off.has(page.needs));

/** An object's page is whole when its `<h1>` is drawn. */
const titled = (title: string) => async (page: Page) => void (await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible());

/**
 * The ledger object pages (E10) and the account's Delegation tab: every address on them is an `AccountLink`, drawn by what the names fixtures say. The objects are the cases of the fixtures
 * (test/e2e/object-pages.ts, never written here), chosen so that the three kinds of names are among them: the escrow's and the channel's owner is a verified name, the finished escrow's owner is
 * a domain that is not verified, the cashed check's destination is GateHub's own name; Xahau's channel has all three. The tab's accounts are the delegates and the delegators of the active
 * account's two lists, and, in its header, the account that activated it, which has a label and no name. The names are the fixtures' (a real stack has names of its own).
 */
export function objectNamedPages(): NamedPage[] {
  const object = (name: string, net: Net, segment: string, which: ObjectCase, title: string, kinds: string[]): NamedPage => ({
    name,
    net,
    path: `/${net}/${segment}/${objectCase(net, which).id}`,
    ready: titled(title),
    kinds,
    needs: "LEDGER_OBJECTS",
  });
  return [
    object("an escrow that can be cancelled", "xrpl", "escrows", "escrow-cancellable", "Escrow", ["verified"]),
    object("a finished escrow", "xrpl", "escrows", "escrow-finished", "Escrow", ["domain"]),
    object("an expired check", "xrpl", "checks", "check-expired", "Check", ["verified"]),
    object("a cashed check", "xrpl", "checks", "check-cashed", "Check", ["account"]),
    object("a channel that is closing", "xrpl", "payment-channels", "channel-closing", "Payment channel", ["verified"]),
    object("a channel on Xahau", "xahau", "payment-channels", "xahau-token-channel", "Payment channel", ["verified", "account"]),
    {
      name: "the account's Delegation tab",
      net: "xrpl",
      path: `/xrpl/account/${XRPL_ACCOUNT}?tab=delegation`,
      ready: async (page) => {
        await expect(page.getByRole("table", { name: "Permissions given" })).toBeVisible();
        await expect(page.getByRole("table", { name: "Permissions held" })).toBeVisible();
      },
      own: XRPL_ACCOUNT,
      kinds: ["account"],
      labelled: true,
      needs: "DELEGATION",
    },
  ];
}

/**
 * The token pages (E11): every address on them is an `AccountLink`, drawn by what the names fixtures say. The tokens are the cases of the fixtures (test/e2e/token-pages.ts, never written
 * here), chosen so that the three kinds of names are among them: the list's issuers are verified names, GateHub's own and domains that are not verified; RLUSD's page has the same among its
 * markets' issuers, its holders and its transfers; the first page of its holders has two accounts with a label and no name (a scam and a spam label); Xahau's EVR has all three. The token
 * page's "Issuer account" button is a link to the issuer by its own words, so the page is `own` to the issuer, whose other link (the "Issued by" line) the specs of the page check apart. The
 * names are the fixtures' (a real stack has names of its own).
 */
export function tokenNamedPages(): NamedPage[] {
  const rlusd = tokenCase("xrpl", "rlusd");
  const evr = tokenCase("xahau", "evr");
  const all = ["verified", "account", "domain"];
  const tableVisible = (name: string) => async (page: Page) => void (await expect(page.getByRole("table", { name, exact: true })).toBeVisible());
  const tokenReady = async (page: Page) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await tableVisible("Recent transfers")(page);
  };
  return [
    { name: "the token list", net: "xrpl", path: "/xrpl/tokens", ready: tableVisible("Issued tokens"), kinds: all, needs: "TOKENS" },
    { name: "a token's page", net: "xrpl", path: `/xrpl/token/${rlusd.path}`, ready: tokenReady, own: rlusd.issuer, kinds: all, needs: "TOKENS" },
    { name: "a token's holders", net: "xrpl", path: `/xrpl/token/${rlusd.path}/holders`, ready: tableVisible("Holders"), kinds: ["account", "domain"], labelled: true, needs: "TOKENS" },
    { name: "a Xahau token's page", net: "xahau", path: `/xahau/token/${evr.path}`, ready: tokenReady, own: evr.issuer, kinds: all, needs: "TOKENS" },
  ];
}
