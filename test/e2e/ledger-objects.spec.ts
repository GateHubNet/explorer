import type { Locator, Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { LIVE, XRPL_ACCOUNT } from "./fixtures";
import { expectAccountsDrawn, type Net, objectNamedPages } from "./names-pages";
import { historyOf, historyPageSizes, objectCase, type ObjectCase, removedBy, rowValue } from "./object-pages";
import { expect, hashHint, hydrated, reactOwns, test } from "./support";

// The ledger object pages (`/{net}/escrows/{ID}`, `/{net}/checks/{ID}`, `/{net}/payment-channels/{ID}`, `/{net}/escrows/{owner}/{sequence}`, README "Ledger object pages") in a browser, on both
// networks and with and without JavaScript: each page in each state the fixtures hold (the escrow pending, finishable, cancellable, finished, cancelled, of a token, of an MPT, with a
// history the index starts late, only the node's, and on Xahau; the check open, expired, cashed, cancelled, only the node's and on Xahau; the channel open, closing, closed, with three pages of events and on Xahau), the
// removed banner, the not-found page and its offer of the other network, the owner and sequence address, Older and Newer through the long channel, the links into the pages (from a
// transaction's sentence and its objects touched, and from the Objects tab), the window bar's segments with the keyboard, a phone's width, and the page with no script. Every object is the case
// of the fixtures that its name says (test/e2e/object-pages.ts finds it by the rules the Worker's specs use, test/support/object-case-rules.ts): no ID is written here, and no test changes what
// the fixture server answers, so none is in the `live` project. The Delegation tab is delegation.spec.ts's. Where `E2E_FEATURES_OFF` lists `LEDGER_OBJECTS` the pages are not found, and the
// off-case is checked instead.

const OFF = featuresOff(process.env).has("LEDGER_OBJECTS");

const NET_NAME: Record<Net, string> = { xrpl: "XRPL", xahau: "Xahau" };

type Segment = "escrows" | "checks" | "payment-channels";

/** What each kind of page calls itself: its `<h1>`, the noun of its removed and as-of lines, the label of its ID row and the group that is its figure. */
const KINDS: Record<Segment, { title: string; noun: string; idRow: string; figure: string; pages: string }> = {
  escrows: { title: "Escrow", noun: "escrow", idRow: "Escrow ID", figure: "When the escrow can be finished or cancelled", pages: "escrow" },
  checks: { title: "Check", noun: "check", idRow: "Check ID", figure: "Flow of the check", pages: "check" },
  "payment-channels": { title: "Payment channel", noun: "channel", idRow: "Channel ID", figure: "Deposit paid out and left", pages: "payment channel" },
};

const shortOf = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`;
const pathOf = (net: Net, segment: Segment, id: string) => `/${net}/${segment}/${id}`;

const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { sameDocument: true }));
const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);
/** How far the page runs past the viewport on the right, in px: at a phone's width it must not (nothing but a table's own scroll area may). */
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The head of the document as the browser has it now: what a search engine and a link preview would read. */
const head = (page: Page) =>
  page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
    ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
    card: document.querySelector('meta[name="twitter:card"]')?.getAttribute("content") ?? null,
    title: document.title,
  }));

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const pill = (page: Page) => page.locator(".object-page__head .pill");
const pager = (page: Page) => page.getByRole("navigation", { name: "Pagination" });
/** The events of the history on the page: the lines for a transaction (the rest are times that passed and what can still happen). */
const transactions = (page: Page) => page.locator(".timeline__dot--tx");
const windowBar = (page: Page) => page.getByRole("group", { name: KINDS.escrows.figure });

// ---- Each page, in each state ----------------------------------------------------------------------------------------------------------------------------------------------

const CREATED = /^Created \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC/;
const CREATED_BEFORE = /^Created before ledger #[\d,]+$/;
const LAST_CHANGED = /^Last changed in ledger #[\d,]+ by transaction /;
const AS_OF = /^As of ledger #[\d,]+, [A-Z][a-z]{2} \d{1,2}, \d{4}, \d\d:\d\d UTC\.$/;
const READ_LIVE = /^Read live from the network at ledger #[\d,]+\.$/;
const fromHistory = (noun: string) => new RegExp(`^From history: the ${noun}’s last state, before ledger #[\\d,]+ removed it\\.$`);
const startsLate = (noun: string) => new RegExp(`^Covers ledger #[\\d,]+ onwards: earlier events of this ${noun} are not in the index yet\\.$`);
const removedBanner = (txType: string) => new RegExp(`^Removed from the ledger in ledger #[\\d,]+ by ${txType} `);

/** A page of the fixtures and what it must say: its status (the pill, the headline, the state the strip marks), its title line, its as-of note, and its banner when it has one. */
interface State {
  name: string;
  net: Net;
  which: ObjectCase;
  segment: Segment;
  pill: string;
  headline: RegExp;
  /** The state the strip of states marks as this object's. */
  here: string;
  titleLine: RegExp;
  asOf: RegExp;
  /** The transaction type of the removed banner: the object is not in the ledger now. */
  removedBy?: string;
  /** The words of a banner that is not the removed one. */
  banner?: RegExp;
  /** The note under the history (`CoverageNote`). */
  coverage?: RegExp;
}

const STATES: State[] = [
  { name: "an escrow still pending", net: "xrpl", which: "escrow-pending", segment: "escrows", pill: "Pending", headline: /^Can be finished by anyone after .+ UTC/, here: "Pending", titleLine: CREATED, asOf: AS_OF },
  { name: "an escrow that can be finished", net: "xrpl", which: "escrow-finishable", segment: "escrows", pill: "Can be finished", headline: /^Can be finished by anyone, with no end$/, here: "Can be finished", titleLine: CREATED, asOf: AS_OF },
  {
    name: "an escrow that can be cancelled",
    net: "xrpl",
    which: "escrow-cancellable",
    segment: "escrows",
    pill: "Can be cancelled",
    headline: /^Can be cancelled: CancelAfter has passed$/,
    here: "Can be cancelled",
    titleLine: CREATED,
    asOf: AS_OF,
  },
  {
    name: "a finished escrow",
    net: "xrpl",
    which: "escrow-finished",
    segment: "escrows",
    pill: "Finished",
    headline: /^Finished: .+ delivered to the destination$/,
    here: "Finished",
    titleLine: CREATED,
    asOf: fromHistory("escrow"),
    removedBy: "EscrowFinish",
  },
  {
    name: "a cancelled escrow",
    net: "xrpl",
    which: "escrow-cancelled",
    segment: "escrows",
    pill: "Cancelled",
    headline: /^Cancelled: .+ returned to the owner$/,
    here: "Cancelled",
    titleLine: CREATED,
    asOf: fromHistory("escrow"),
    removedBy: "EscrowCancel",
  },
  { name: "an escrow of a token", net: "xrpl", which: "escrow-token", segment: "escrows", pill: "Can be cancelled", headline: /^Can be cancelled: CancelAfter has passed$/, here: "Can be cancelled", titleLine: CREATED, asOf: AS_OF },
  { name: "an escrow of an MPT", net: "xrpl", which: "escrow-mpt", segment: "escrows", pill: "Pending", headline: /^Can be finished by anyone after .+ UTC/, here: "Pending", titleLine: CREATED, asOf: AS_OF },
  {
    name: "a finished escrow whose creation the index does not hold",
    net: "xrpl",
    which: "escrow-incomplete",
    segment: "escrows",
    pill: "Finished",
    headline: /^Finished: .+ delivered to the destination$/,
    here: "Finished",
    titleLine: CREATED_BEFORE,
    asOf: fromHistory("escrow"),
    removedBy: "EscrowFinish",
    coverage: startsLate("escrow"),
  },
  {
    name: "an escrow only the node has",
    net: "xrpl",
    which: "escrow-node-only",
    segment: "escrows",
    pill: "Can be cancelled",
    headline: /^Can be cancelled: CancelAfter has passed$/,
    here: "Can be cancelled",
    titleLine: LAST_CHANGED,
    asOf: READ_LIVE,
    coverage: /^The index does not hold this history yet\.$/,
  },
  { name: "an escrow on Xahau", net: "xahau", which: "xahau-escrow", segment: "escrows", pill: "Pending", headline: /^Can be finished by anyone after .+ UTC/, here: "Pending", titleLine: CREATED, asOf: AS_OF },
  { name: "an open check", net: "xrpl", which: "check-open", segment: "checks", pill: "Open", headline: /^The destination can cash up to .+/, here: "Open", titleLine: CREATED, asOf: AS_OF },
  {
    name: "a check that expired and is still in the ledger",
    net: "xrpl",
    which: "check-expired",
    segment: "checks",
    pill: "Expired",
    headline: /^Expired: it can no longer be cashed$/,
    here: "Expired",
    titleLine: CREATED,
    asOf: AS_OF,
    banner: /^Expired, but still in the ledger/,
  },
  {
    name: "a cashed check",
    net: "xrpl",
    which: "check-cashed",
    segment: "checks",
    pill: "Cashed",
    headline: /^Cashed: .+ delivered to the destination$/,
    here: "Cashed",
    titleLine: CREATED_BEFORE,
    asOf: fromHistory("check"),
    removedBy: "CheckCash",
    coverage: startsLate("check"),
  },
  {
    name: "a cancelled check",
    net: "xrpl",
    which: "check-cancelled",
    segment: "checks",
    pill: "Cancelled",
    headline: /^Cancelled before it was cashed$/,
    here: "Cancelled",
    titleLine: CREATED_BEFORE,
    asOf: fromHistory("check"),
    removedBy: "CheckCancel",
    coverage: startsLate("check"),
  },
  {
    name: "a check only the node has",
    net: "xrpl",
    which: "check-node-only",
    segment: "checks",
    pill: "Open",
    headline: /^The destination can cash up to .+/,
    here: "Open",
    titleLine: LAST_CHANGED,
    asOf: READ_LIVE,
    coverage: /^The index does not hold this history yet\.$/,
  },
  { name: "a check on Xahau", net: "xahau", which: "check-cashed", segment: "checks", pill: "Cashed", headline: /^Cashed: .+ delivered to the destination$/, here: "Cashed", titleLine: CREATED_BEFORE, asOf: fromHistory("check"), removedBy: "CheckCash", coverage: startsLate("check") },
  { name: "an open channel", net: "xrpl", which: "channel-open", segment: "payment-channels", pill: "Open", headline: /^Open: .+ left to pay out$/, here: "Open", titleLine: CREATED, asOf: AS_OF },
  {
    name: "a channel that is closing",
    net: "xrpl",
    which: "channel-closing",
    segment: "payment-channels",
    pill: "Closing",
    headline: /^Closing: claims can still be redeemed until .+ UTC/,
    here: "Closing",
    titleLine: CREATED,
    asOf: AS_OF,
  },
  {
    name: "a closed channel",
    net: "xrpl",
    which: "channel-closed",
    segment: "payment-channels",
    pill: "Closed",
    headline: /^Closed: .+ paid out, .+ returned to the source$/,
    here: "Closed",
    titleLine: CREATED_BEFORE,
    asOf: fromHistory("channel"),
    removedBy: "PaymentChannelClaim",
    coverage: startsLate("payment channel"),
  },
  { name: "a channel with three pages of events", net: "xrpl", which: "channel-long", segment: "payment-channels", pill: "Open", headline: /^Open: .+ left to pay out$/, here: "Open", titleLine: CREATED, asOf: AS_OF },
  {
    name: "a channel of a token on Xahau",
    net: "xahau",
    which: "xahau-token-channel",
    segment: "payment-channels",
    pill: "Open",
    headline: /^Open: .+ left to pay out$/,
    here: "Open",
    titleLine: CREATED,
    asOf: AS_OF,
  },
];

const pathOfState = (state: State) => pathOf(state.net, state.segment, objectCase(state.net, state.which).id);

test.describe("the pages", () => {
  test.skip(OFF, "LEDGER_OBJECTS is off in the Worker under test: its pages are not found (checked below)");
  test.skip(LIVE, "the pages are drawn from the generated object fixtures (test/e2e/object-pages.ts), which a real stack does not hold");

  for (const state of STATES) {
    const kind = KINDS[state.segment];

    test(`${state.name}: its status, its states, its title line, its figure and its history`, async ({ page }) => {
      const { id } = objectCase(state.net, state.which);
      const response = await page.goto(pathOfState(state));
      expect(response?.status()).toBe(200);
      await hydrated(page);

      // The head: the type as the one <h1>, the status as an icon and a word, and the line beside it; the title of the document says the network.
      await expect(heading(page)).toHaveText(kind.title);
      await expect(page).toHaveTitle(`${kind.title} ${shortOf(id)} · ${NET_NAME[state.net]} · explorer`);
      await expect(pill(page)).toHaveText(state.pill);
      await expect(pill(page).locator("svg")).toHaveCount(1);
      await expect(page.locator(".object-page__titleline")).toHaveText(state.titleLine);
      await expect(page.locator(".object-page__headline")).toHaveText(state.headline);
      await expect(page.locator(".object-page__asof")).toHaveText(state.asOf);

      // The breadcrumb ends with the type; the ID row says the whole ID.
      const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
      await expect(crumbs).toContainText(NET_NAME[state.net]);
      await expect(crumbs.locator('[aria-current="page"]')).toHaveText(kind.title);
      await expect(rowValue(page, kind.idRow)).toContainText(id);

      // The strip of states marks this object's state, in words, and one only (a removed object, finished or cancelled, is the state it ended in).
      const strip = page.getByRole("list", { name: "States" });
      await expect(strip.locator('[aria-current="true"]')).toHaveCount(1);
      await expect(strip.locator('[aria-current="true"] .states__name')).toHaveText(`${state.here} · this ${kind.noun}`);

      // The banner of a removed object names the transaction that removed it; the others have none of that (the check that expired has its own).
      if (state.removedBy !== undefined) {
        const removed = removedBy(state.net, state.which)!;
        expect(removed.txType).toBe(state.removedBy);
        await expect(page.locator(".object-page__removed")).toHaveText(removedBanner(removed.txType));
        await expect(page.locator(".object-page__removed").getByRole("link", { name: `${removed.txType} transaction ${shortOf(removed.hash)}` })).toHaveAttribute("href", `/${state.net}/tx/${removed.hash}`);
        await expect(page.locator(".object-page__removed-note")).toContainText("This page shows it from history: its last state before it was removed.");
      } else {
        await expect(page.locator(".object-page__removed")).toHaveCount(0);
      }
      if (state.banner !== undefined) await expect(page.locator(".notice").filter({ hasText: state.banner })).toBeVisible();

      // The figure of the type: the escrow's window bar, the check's flow, the channel's deposit bar.
      await expect(page.getByRole("group", { name: kind.figure })).toBeVisible();

      // The history: a line for each event the fixtures hold (none for what only the node says), oldest first, and what can still happen only while the object is in the ledger.
      const events = state.which === "escrow-node-only" || state.which === "check-node-only" ? 0 : historyPageSizes(state.net, state.which)[0]!;
      await expect(transactions(page)).toHaveCount(events);
      const times = await page
        .locator(".timeline__item", { has: page.locator(".timeline__dot--tx") })
        .locator(".timeline__when > time:first-child")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime") ?? ""));
      expect(times, "the events' times").toHaveLength(events);
      expect(times, "the history is oldest first").toEqual([...times].sort());
      if (state.removedBy === undefined) await expect(page.locator(".timeline__dot--next")).not.toHaveCount(0);
      else await expect(page.locator(".timeline__dot--next")).toHaveCount(0);
      if (state.coverage !== undefined) await expect(page.getByRole("note")).toHaveText(state.coverage);
      else await expect(page.getByRole("note")).toHaveCount(0);

      // Its tags: indexable, the canonical URL of its own page on the origin of the request, a summary card and no image (a link preview is text only).
      const tags = await head(page);
      expect(tags.canonical).toMatch(new RegExp(`/${state.net}/${state.segment}/${id}$`));
      expect(tags.robots).toBeNull();
      expect(tags.ogImage).toBeNull();
      expect(tags.card).toBe("summary");
    });
  }

  test("an escrow of a token says who issued it, and one of an MPT says its units and the issuance, whole on hover", async ({ page }) => {
    await page.goto(pathOf("xrpl", "escrows", objectCase("xrpl", "escrow-token").id));
    await expect(rowValue(page, "Amount")).toContainText("issued by");
    await expect(rowValue(page, "Amount").locator(".object-page__issuer a")).toHaveAttribute("href", /^\/xrpl\/account\/r\w+$/);

    await page.goto(pathOf("xrpl", "escrows", objectCase("xrpl", "escrow-mpt").id));
    const amount = rowValue(page, "Amount").locator(".mptamount");
    await expect(amount).toHaveText(/^[\d,]+ units of MPT [0-9A-F]{8}…$/);
    await expect(amount).toHaveAttribute("title", /^[0-9A-F]{48}$/);
  });
});

// ---- The accounts on the pages -----------------------------------------------------------------------------------------------------------------------------------------------

test.describe("the accounts on the pages", () => {
  test.skip(OFF, "LEDGER_OBJECTS is off in the Worker under test: its pages are not found (checked below)");
  test.skip(LIVE, "the pages are drawn from the generated object fixtures, and the names are the fixtures' (a real stack has names of its own)");
  test.skip(featuresOff(process.env).has("NAMES"), "NAMES is off in the Worker under test: its off-case is the Worker specs' (pages-names-off.spec.ts)");

  // Every address is an `AccountLink` (E9): drawn by the name the fixtures give it, with the words of its marks and the title that says how it is known, or by its address. The pages are
  // those of `objectNamedPages` (test/e2e/names-pages.ts), which a11y.spec.ts checks the accessible names of; between them the three kinds of names are drawn.
  for (const under of objectNamedPages().filter((each) => each.needs === "LEDGER_OBJECTS")) {
    test(`${under.name}: each link to an account is drawn by what the fixtures say, with the kinds of names the page has`, async ({ page }) => {
      await page.goto(under.path);
      await hydrated(page);
      await under.ready(page);
      const drawn = await expectAccountsDrawn(page.getByRole("main"), under.net, { full: "either" });
      expect([...drawn.kinds].sort()).toEqual(expect.arrayContaining(under.kinds.slice().sort()));
    });
  }
});

// ---- Older and Newer through a long history, and the tags that go with them ---------------------------------------------------------------------------------------------------

test.describe("a long history", () => {
  test.skip(OFF, "LEDGER_OBJECTS is off in the Worker under test: its pages are not found (checked below)");
  test.skip(LIVE, "the pages are drawn from the generated object fixtures (test/e2e/object-pages.ts), which a real stack does not hold");

  test("pages through the channel's three pages of events with Older and Newer, in one document, and the pages behind a marker are kept from a search engine", async ({ page }) => {
    const { id, markers } = objectCase("xrpl", "channel-long");
    const sizes = historyPageSizes("xrpl", "channel-long");
    expect(markers, "the fixtures' channel has two markers behind its first page").toHaveLength(2);
    expect(sizes, "and three pages of events").toHaveLength(3);
    const path = pathOf("xrpl", "payment-channels", id);
    const older = pager(page).getByRole("link", { name: "Older" });
    const newer = pager(page).getByRole("link", { name: "Newer" });

    await page.goto(path);
    await hydrated(page);
    await markDocument(page);
    await expect(transactions(page)).toHaveCount(sizes[0]!);
    // The first page: nothing newer, indexable, and what can still happen is after its newest event.
    await expect(newer).toHaveCount(0);
    expect(await head(page)).toMatchObject({ canonical: expect.stringMatching(new RegExp(`${path}$`)), robots: null });
    await expect(page.locator(".timeline__dot--next")).not.toHaveCount(0);

    await older.click();
    await page.waitForURL(`**${path}?marker=${markers![0]}`);
    await expect(transactions(page)).toHaveCount(sizes[1]!);
    // A page behind a marker is for a reader, not a crawler: no canonical URL and no Open Graph card, and the events behind the first page have no "what can still happen".
    await expect.poll(() => head(page)).toMatchObject({ canonical: null, robots: "noindex, follow", card: null });
    await expect(page.locator(".timeline__dot--next")).toHaveCount(0);
    await expect(newer).toHaveAttribute("href", path);

    await older.click();
    await page.waitForURL(`**${path}?marker=${markers![1]}&back=${markers![0]}`);
    await expect(transactions(page)).toHaveCount(sizes[2]!);
    // The oldest page has nothing older: the button stays, disabled, so that the pair does not jump about.
    await expect(older).toHaveCount(0);
    await expect(pager(page).getByText("Older")).toHaveAttribute("aria-disabled", "true");

    await newer.click();
    await page.waitForURL(`**${path}?marker=${markers![0]}`);
    await expect(transactions(page)).toHaveCount(sizes[1]!);

    await newer.click();
    await page.waitForURL(`**${path}`);
    await expect(transactions(page)).toHaveCount(sizes[0]!);
    // Back on the first page, the tags are the page's again.
    await expect.poll(() => head(page)).toMatchObject({ canonical: expect.stringMatching(new RegExp(`${path}$`)), robots: null, card: "summary" });
    expect(await sameDocument(page)).toBe(true);
  });

  test("works without JavaScript: Older is a link", async ({ contextFor }) => {
    const { id, markers } = objectCase("xrpl", "channel-long");
    const page = await (await contextFor({ javaScriptEnabled: false })).newPage();
    const path = pathOf("xrpl", "payment-channels", id);
    await page.goto(path);
    await pager(page).getByRole("link", { name: "Older" }).click();
    await page.waitForURL(`**${path}?marker=${markers![0]}`);
    await expect(transactions(page)).toHaveCount(historyPageSizes("xrpl", "channel-long")[1]!);
  });
});

// ---- The window bar with the keyboard -----------------------------------------------------------------------------------------------------------------------------------------

test.describe("the window bar", () => {
  test.skip(OFF, "LEDGER_OBJECTS is off in the Worker under test: its pages are not found (checked below)");
  test.skip(LIVE, "the pages are drawn from the generated object fixtures (test/e2e/object-pages.ts), which a real stack does not hold");

  test("has each window as a button that Tab reaches, with its range in its name and its tooltip shown by the focus and put away by Escape", async ({ page }) => {
    await page.goto(pathOf("xrpl", "escrows", objectCase("xrpl", "escrow-cancellable").id));
    await hydrated(page);
    const bar = windowBar(page);
    const segments = bar.getByRole("button");
    await expect(segments).toHaveCount(3);
    const tip = bar.locator(".wbar__tip");
    await expect(tip).toHaveCount(0);

    // The first window is reached by Tab from the top of the page, in a handful of presses (the header, the breadcrumb, the sentence's links).
    const inBar = () => bar.evaluate((element) => element.contains(document.activeElement));
    let presses = 0;
    while (!(await inBar()) && presses < 60) {
      await page.keyboard.press("Tab");
      presses += 1;
    }
    expect(presses, "Tab presses from the top of the page").toBeLessThan(60);
    await expect(segments.nth(0)).toBeFocused();

    // Each button is named by its window and its range, and the tooltip it shows says the same: the window, its range and its length.
    const names: string[] = [];
    for (const [at, window] of ["Pending", "Can be finished", "Can be cancelled"].entries()) {
      if (at > 0) await page.keyboard.press("Tab");
      await expect(segments.nth(at)).toBeFocused();
      const name = (await segments.nth(at).getAttribute("aria-label"))!;
      names.push(name);
      expect(name.startsWith(`${window}: `), name).toBe(true);
      await expect(tip).toBeVisible();
      await expect(tip.locator("b")).toHaveText(window);
      await expect(tip.locator(".plot__tip-name")).toHaveText(name.slice(window.length + 2));
    }
    expect(new Set(names).size, "each window has a range of its own").toBe(3);

    // Escape puts the tooltip away while the focus stays (WCAG 1.4.13), and the next focus shows it again.
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCount(0);
    await expect(segments.nth(2)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(segments.nth(1)).toBeFocused();
    await expect(tip.locator("b")).toHaveText("Can be finished");

    // Leaving the bar puts the tooltip away, and Tab goes on to what follows it.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    expect(await inBar()).toBe(false);
    await expect(tip).toHaveCount(0);
  });

  test("says where the object is in its words for a screen reader, once: the mark's label", async ({ page }) => {
    await page.goto(pathOf("xrpl", "escrows", objectCase("xrpl", "escrow-cancellable").id));
    await expect(windowBar(page).locator(".sr")).toHaveText(/^Now · .+/);
    // A removed escrow's mark says how it ended.
    await page.goto(pathOf("xrpl", "escrows", objectCase("xrpl", "escrow-finished").id));
    await expect(windowBar(page).locator(".sr")).toHaveText(/^Finished · .+/);
    await page.goto(pathOf("xrpl", "escrows", objectCase("xrpl", "escrow-cancelled").id));
    await expect(windowBar(page).locator(".sr")).toHaveText(/^Cancelled · .+/);
  });
});

// ---- The URLs themselves ---------------------------------------------------------------------------------------------------------------------------------------------------

/** An ID that no fixture and no node has. */
const NOTHING = `5B9C0E${"0".repeat(58)}`;

test.describe("the addresses", () => {
  test.skip(OFF, "LEDGER_OBJECTS is off in the Worker under test: its pages are not found (checked below)");
  test.skip(LIVE, "the pages are drawn from the generated object fixtures (test/e2e/object-pages.ts), which a real stack does not hold");

  test("an escrow's owner and sequence lead to its page, as a redirect that asks nothing of the index, and a form that is none is not found", async ({ page, request }) => {
    const { id, owner, sequence } = objectCase("xrpl", "escrow-finishable");
    const address = `/xrpl/escrows/${owner}/${sequence}`;
    const redirect = await request.get(address, { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers().location).toBe(`/xrpl/escrows/${id}`);

    await page.goto(address);
    await page.waitForURL(`**/xrpl/escrows/${id}`);
    await expect(heading(page)).toHaveText("Escrow");
    await expect(rowValue(page, "Escrow ID")).toContainText(id);

    // A sequence written with a leading zero, a sign or as a fraction is another address that no escrow has; a check has no such address at all.
    for (const bad of [`/xrpl/escrows/${owner}/0${sequence}`, `/xrpl/escrows/${owner}/-${sequence}`, `/xrpl/escrows/${owner}/${sequence}.5`, `/xrpl/escrows/${id.slice(0, 34)}/${sequence}`, `/xrpl/checks/${owner}/${sequence}`]) {
      expect((await request.get(bad, { maxRedirects: 0 })).status(), bad).toBe(404);
    }
  });

  test("an ID in lower case is the page of the upper-case one, with its query; an ID with 0x, a short one and a long one are not found", async ({ request }) => {
    const { id } = objectCase("xrpl", "check-open");
    const lower = await request.get(`/xrpl/checks/${id.toLowerCase()}?x=1`, { maxRedirects: 0 });
    expect(lower.status()).toBe(302);
    expect(lower.headers().location).toBe(`/xrpl/checks/${id}?x=1`);
    for (const bad of [`/xrpl/checks/0x${id}`, `/xrpl/checks/${id.slice(0, 63)}`, `/xrpl/checks/${id}0`, `/xrpl/checks/${"G".repeat(64)}`]) {
      expect((await request.get(bad, { maxRedirects: 0 })).status(), bad).toBe(404);
    }
  });

  test("the node's own entry of another kind leads to that kind's page, and the answer of neither is the not-found page of the page asked for", async ({ page }) => {
    // The node has this ID as a check, which the index has not heard of: asked for as an escrow it is the check's page, read from the node.
    const { id } = objectCase("xrpl", "check-node-only");
    await page.goto(pathOf("xrpl", "escrows", id));
    await page.waitForURL(`**/xrpl/checks/${id}`);
    await expect(heading(page)).toHaveText("Check");
    await expect(page.locator(".object-page__asof")).toHaveText(READ_LIVE);

    // The node has this one as an escrow: the same answer asked for as a channel.
    const escrow = objectCase("xrpl", "escrow-node-only").id;
    await page.goto(pathOf("xrpl", "payment-channels", escrow));
    await page.waitForURL(`**/xrpl/escrows/${escrow}`);
    await expect(heading(page)).toHaveText("Escrow");
    await expect(page.locator(".object-page__asof")).toHaveText(READ_LIVE);
  });

  test("an ID nothing has is the not-found page with the ID shortened, kept from search engines, and the way to search the other network", async ({ page }) => {
    const response = await page.goto(pathOf("xrpl", "escrows", NOTHING));
    expect(response?.status()).toBe(404);
    await expect(heading(page)).toHaveText("Not found");
    await expect(page.getByRole("main")).toContainText(`We couldn’t find escrow ${shortOf(NOTHING)} on XRPL.`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await expect(page.getByRole("link", { name: "Search on Xahau" })).toHaveAttribute("href", `/xahau/search?q=${NOTHING}`);

    // The same with a check's and a channel's own words.
    for (const [segment, words] of [
      ["checks", "check"],
      ["payment-channels", "payment channel"],
    ] as const) {
      expect((await page.goto(pathOf("xrpl", segment, NOTHING)))?.status()).toBe(404);
      await expect(page.getByRole("main")).toContainText(`We couldn’t find ${words} ${shortOf(NOTHING)} on XRPL.`);
    }
  });

  test("an object of the other network is found by the not-found page's link: Search on Xahau leads to its page", async ({ page }) => {
    const { id } = objectCase("xahau", "xahau-escrow");
    await page.goto(pathOf("xrpl", "escrows", id));
    await expect(page.getByRole("main")).toContainText(`We couldn’t find escrow ${shortOf(id)} on XRPL.`);
    await hydrated(page);
    await page.getByRole("link", { name: "Search on Xahau" }).click();
    await page.waitForURL(`**/xahau/escrows/${id}`);
    await expect(heading(page)).toHaveText("Escrow");
    await expect(page).toHaveTitle(`Escrow ${shortOf(id)} · Xahau · explorer`);
  });

  test("a search for an ID in lower case leads to its page", async ({ page }) => {
    const { id } = objectCase("xrpl", "escrow-cancelled");
    await page.goto("/xrpl");
    await hydrated(page);
    const box = page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" });
    await box.fill(id.toLowerCase());
    await expect(page.getByRole("list", { name: "Matches" })).toContainText(hashHint("xrpl"));
    await box.press("Enter");
    await page.waitForURL(`**/xrpl/escrows/${id}`);
    await expect(heading(page)).toHaveText("Escrow");
  });
});

// ---- The links into the pages ------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The links from a transaction to what it did to an object: its sentence (the escrow by its sequence, the check by "a check", the channel by its short ID), a detail that holds the object's ID,
 * and the list of the ledger objects it touched. `via` is the transaction the object's own page links to: the one that removed it, or an event of its history.
 */
const FROM_TRANSACTIONS: Array<{
  name: string;
  which: ObjectCase;
  segment: Segment;
  via: (which: ObjectCase) => { hash: string; type: string };
  sentence: ((id: string, sequence: number | undefined) => string) | null;
  /** The label of the detail that holds the object's ID, and how it writes it: the whole ID, or the short one (the created node of a Create). */
  detail: { label: string; shown: "whole" | "short" } | null;
  /** What the object is called in the list of the ledger objects the transaction touched. */
  touched: string;
}> = [
  {
    name: "an EscrowFinish names its escrow in its sentence",
    which: "escrow-finished",
    segment: "escrows",
    via: (which) => ({ hash: removedBy("xrpl", which)!.hash, type: removedBy("xrpl", which)!.txType }),
    sentence: (_id, sequence) => `escrow ${sequence}`,
    detail: null,
    touched: "Escrow",
  },
  {
    name: "a CheckCash names its check in its sentence and in its Check ID",
    which: "check-cashed",
    segment: "checks",
    via: (which) => ({ hash: removedBy("xrpl", which)!.hash, type: removedBy("xrpl", which)!.txType }),
    sentence: () => "a check",
    detail: { label: "Check ID", shown: "whole" },
    touched: "Check",
  },
  {
    name: "a CheckCreate holds the ID of the check it made",
    which: "check-open",
    segment: "checks",
    via: (which) => {
      const event = historyOf("xrpl", which).find((each) => each.tx_type === "CheckCreate")!;
      return { hash: event.tx_hash, type: event.tx_type };
    },
    sentence: null,
    detail: { label: "Check", shown: "short" },
    touched: "Check",
  },
  {
    name: "a PaymentChannelClaim names its channel in its sentence and in its Channel",
    which: "channel-open",
    segment: "payment-channels",
    via: (which) => {
      const event = historyOf("xrpl", which).find((each) => each.tx_type === "PaymentChannelClaim")!;
      return { hash: event.tx_hash, type: event.tx_type };
    },
    sentence: (id) => `channel ${shortOf(id)}`,
    detail: { label: "Channel", shown: "whole" },
    touched: "PayChannel",
  },
];

test.describe("the links from a transaction", () => {
  test.skip(OFF, "LEDGER_OBJECTS is off in the Worker under test: the transaction names its object as text (checked below)");
  test.skip(LIVE, "the pages are drawn from the generated object fixtures (test/e2e/object-pages.ts), which a real stack does not hold");

  for (const link of FROM_TRANSACTIONS) {
    test(`${link.name}, and each link it has, the objects it touched among them, leads to the page`, async ({ page }) => {
      const { id, sequence } = objectCase("xrpl", link.which);
      const path = pathOf("xrpl", link.segment, id);
      const via = link.via(link.which);
      const kind = KINDS[link.segment];

      // From the object's page to the transaction (its removal, or the event of its history), in the page.
      await page.goto(path);
      await hydrated(page);
      await markDocument(page);
      await page.getByRole("link", { name: `${via.type} transaction ${shortOf(via.hash)}` }).first().click();
      await page.waitForURL(`**/xrpl/tx/${via.hash}`);

      // The ways to the object from there: the sentence, when the type's names it; the detail that holds its ID (the whole ID is the link's title); the entry of the objects it touched.
      const ways: Array<{ what: string; link: Locator }> = [];
      if (link.sentence !== null) ways.push({ what: "the sentence", link: page.getByRole("link", { name: link.sentence(id, sequence), exact: true }) });
      if (link.detail !== null) {
        const detail = rowValue(page, link.detail.label).getByRole("link");
        await expect(detail).toHaveAttribute("title", id);
        await expect(detail).toHaveText(link.detail.shown === "whole" ? id : shortOf(id));
        ways.push({ what: `the ${link.detail.label} detail`, link: detail });
      }
      const touched = page.locator(`a.objects__type[href="${path}"]`);
      await expect(touched, "the entry of the objects touched").toHaveText(link.touched);
      ways.push({ what: "the objects touched", link: touched });

      for (const way of ways) {
        await expect(way.link, way.what).toHaveAttribute("href", path);
        await way.link.click();
        await page.waitForURL(`**${path}`);
        await expect(heading(page), way.what).toHaveText(kind.title);
        await expect(rowValue(page, kind.idRow), way.what).toContainText(id);
        await page.goBack();
        await page.waitForURL(`**/xrpl/tx/${via.hash}`);
      }
      expect(await sameDocument(page), "every step was the router's").toBe(true);
    });
  }
});

test.describe("the links from the Objects tab", () => {
  test.skip(OFF, "LEDGER_OBJECTS is off in the Worker under test: the tab opens nothing (checked below)");
  test.skip(LIVE, "reads the hand-written account files of the fixtures and the objects the generator gave the active account");

  // What each button opens, as the page it opens says it: the account is the escrow's owner, the check's destination and the channel's source.
  for (const [button, segment, row] of [
    ["Open escrow →", "escrows", "Owner"],
    ["Open check →", "checks", "Destination"],
    ["Open payment channel →", "payment-channels", "Source"],
  ] as const) {
    test(`'${button}' opens the page of the account's object, in the same document`, async ({ page }) => {
      await page.goto(`/xrpl/account/${XRPL_ACCOUNT}?tab=objects`);
      await hydrated(page);
      await markDocument(page);
      const open = page.getByRole("link", { name: button });
      await expect(open).toHaveAttribute("href", new RegExp(`^/xrpl/${segment}/[0-9A-F]{64}$`));
      // The Objects tab's list is the lazy panels' chunk's: its links are the router's once React has hydrated them (`reactOwns`).
      await reactOwns(open);
      await open.click();
      await page.waitForURL(new RegExp(`/xrpl/${segment}/[0-9A-F]{64}$`));
      await expect(heading(page)).toHaveText(KINDS[segment].title);
      await expect(rowValue(page, row).locator(`a[href="/xrpl/account/${XRPL_ACCOUNT}"]`)).toHaveCount(1);
      expect(await sameDocument(page)).toBe(true);
    });
  }

  test("names the source of the check the account was sent: a From field with its account, which leads to it", async ({ page }) => {
    const { owner } = objectCase("xrpl", "check-expired");
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}?tab=objects`);
    const from = page.locator(".object__field").filter({ has: page.locator(".object__label", { hasText: /^From$/ }) });
    await expect(from).toHaveCount(1);
    await expect(from.locator(".object__value a")).toHaveAttribute("href", `/xrpl/account/${owner}`);
    await expect(from.locator(".object__value a")).toHaveText(shortOf(owner));
  });
});

// ---- A phone, and no script ------------------------------------------------------------------------------------------------------------------------------------------------

test.describe("a phone's width", () => {
  test.skip(OFF, "LEDGER_OBJECTS is off in the Worker under test: its pages are not found (checked below)");
  test.skip(LIVE, "the pages are drawn from the generated object fixtures (test/e2e/object-pages.ts), which a real stack does not hold");
  test.use({ viewport: { width: 375, height: 812 } });

  for (const state of STATES) {
    test(`${state.name} does not scroll sideways at 375 px`, async ({ page }) => {
      await page.goto(pathOfState(state));
      await hydrated(page);
      await expect(page.getByRole("group", { name: KINDS[state.segment].figure })).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }
});

/** The absolute form of a time: what a page prints before a script has put an age beside it. */
const ABSOLUTE = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$/;
/** What an age is, as the pages write one: "15 d ago", "in 4 days". */
const AGE = /\b\d+ (?:s|min|h|d|mo|y) ago\b|\bin (?:under a minute|~?\d+ (?:min|h|days))\b/;

test.describe("without JavaScript", () => {
  test.skip(OFF, "LEDGER_OBJECTS is off in the Worker under test: its pages are not found (checked below)");
  test.skip(LIVE, "the pages are drawn from the generated object fixtures (test/e2e/object-pages.ts), which a real stack does not hold");

  for (const state of STATES.filter((each) => ["escrow-cancellable", "escrow-finished", "check-expired", "check-open", "channel-closing", "channel-closed", "escrow-node-only"].includes(each.which))) {
    test(`${state.name} is whole, and its times are absolute`, async ({ contextFor }) => {
      const page = await (await contextFor({ javaScriptEnabled: false })).newPage();
      await page.goto(pathOfState(state));
      const kind = KINDS[state.segment];

      // Everything the server draws is there: the head, the status, the figure, the details and the history.
      await expect(heading(page)).toHaveText(kind.title);
      await expect(pill(page)).toHaveText(state.pill);
      await expect(page.locator(".object-page__headline")).toHaveText(state.headline);
      await expect(page.getByRole("group", { name: kind.figure })).toBeVisible();
      await expect(rowValue(page, kind.idRow)).toContainText(objectCase(state.net, state.which).id);
      await expect(page.locator(".timeline__footnote")).toBeVisible();
      if (state.segment === "escrows") await expect(windowBar(page).getByRole("button")).not.toHaveCount(0);

      // Every time is the one the stored page has: written out, with the place of its age empty. No age is said anywhere (it would be wrong from the moment the page was stored).
      const times = await page.locator("main time").allInnerTexts();
      expect(times.length, "the page has times").toBeGreaterThan(0);
      expect(times.filter((text) => text !== "" && !ABSOLUTE.test(text.trim())), "a time that is neither absolute nor empty").toEqual([]);
      expect(times.some((text) => ABSOLUTE.test(text.trim())), "an absolute time").toBe(true);
      expect(await page.getByRole("main").innerText()).not.toMatch(AGE);
    });
  }

  test("the same page with JavaScript puts an age beside the absolute time, once it has hydrated", async ({ page }) => {
    await page.goto(pathOf("xrpl", "escrows", objectCase("xrpl", "escrow-cancellable").id));
    await hydrated(page);
    await expect(page.locator(".object-page__titleline")).toContainText(/ ago/);
    expect(await page.locator(".object-page__titleline time").first().innerText()).toMatch(ABSOLUTE);
  });
});

// ---- With LEDGER_OBJECTS off ------------------------------------------------------------------------------------------------------------------------------------------------

test.describe("with LEDGER_OBJECTS off", () => {
  test.skip(!OFF, "LEDGER_OBJECTS is on in the Worker under test: its pages are checked above");

  // Every address of the pages is the not-found page, a 404 made before any call: the owner and sequence of an escrow, an ID in lower case and a marker are not read.
  const escrow = objectCase("xrpl", "escrow-finished");
  const long = objectCase("xrpl", "channel-long");
  for (const [path, words, network] of [
    [pathOf("xrpl", "escrows", escrow.id), "escrow", "XRPL"],
    [`/xrpl/escrows/${escrow.owner}/${escrow.sequence}`, "escrow", "XRPL"],
    [pathOf("xahau", "escrows", escrow.id), "escrow", "Xahau"],
    [pathOf("xrpl", "escrows", escrow.id.toLowerCase()), "escrow", "XRPL"],
    [pathOf("xrpl", "checks", objectCase("xrpl", "check-open").id), "check", "XRPL"],
    [pathOf("xrpl", "payment-channels", objectCase("xrpl", "channel-open").id), "payment channel", "XRPL"],
    [`${pathOf("xrpl", "payment-channels", long.id)}?marker=${long.markers![0]}`, "payment channel", "XRPL"],
  ] as const) {
    test(`${path} is the not-found page of the ${words} pages`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByText(`We couldn’t find the ${words} pages on ${network}.`)).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    });
  }

  // What links into the pages names its object in the same words and leads nowhere: no link to a page that is not there.
  test.describe("the links", () => {
    test.skip(LIVE, "reads the hand-written account files of the fixtures and the objects the generator gave the active account");

    test("the Objects tab keeps every field, the check's source among them, and opens nothing", async ({ page }) => {
      const { owner } = objectCase("xrpl", "check-expired");
      await page.goto(`/xrpl/account/${XRPL_ACCOUNT}?tab=objects`);
      await expect(page.getByRole("link", { name: /^Open (escrow|check|payment channel) →$/ })).toHaveCount(0);
      await expect(page.locator('a[href*="/escrows/"], a[href*="/checks/"], a[href*="/payment-channels/"]')).toHaveCount(0);
      const from = page.locator(".object__field").filter({ has: page.locator(".object__label", { hasText: /^From$/ }) });
      await expect(from.locator(".object__value a")).toHaveAttribute("href", `/xrpl/account/${owner}`);
    });

    test("a transaction names its escrow in the same words, as text, and its objects touched lead nowhere", async ({ page }) => {
      const { sequence } = objectCase("xrpl", "escrow-finished");
      await page.goto(`/xrpl/tx/${removedBy("xrpl", "escrow-finished")!.hash}`);
      await expect(page.getByRole("main")).toContainText(`escrow ${sequence}`);
      await expect(page.getByRole("link", { name: `escrow ${sequence}` })).toHaveCount(0);
      await expect(page.locator('a[href*="/escrows/"], a[href*="/checks/"], a[href*="/payment-channels/"]')).toHaveCount(0);
    });

    test("the box says what a hash can be without the objects", async ({ page }) => {
      await page.goto("/xrpl");
      await hydrated(page);
      await page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" }).fill(objectCase("xrpl", "escrow-finished").id);
      await expect(page.getByRole("list", { name: "Matches" })).toContainText(hashHint("xrpl"));
      await expect(page.getByRole("list", { name: "Matches" })).not.toContainText(/escrow/i);
    });
  });
});
