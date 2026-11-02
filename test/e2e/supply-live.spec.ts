import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { fixtures, HEAD, supplyVariant } from "./fixture-control";
import { LIVE } from "./fixtures";
import { expect, freshHtml, hydrated, seriousViolations, test } from "./support";
import { VALIDATORS_OFF } from "./validators-pages";

// The supply page (`/{net}/supply`) in a browser: every test of it that needs the Worker to answer something the recordings do not say, and every test that must look at the page after one of
// those has been drawn. No spec of the `chromium` project opens it (supply C2): the page has one URL per network, its snapshot (S) and Xahau's minted days (M) are kept 300 s by the Worker,
// and an answer that fails is replaced by the stored copy of the page however old, so a test that makes S fail must be the first to ask for the page, and the next that wants it to have
// failed must find none stored. These tests change what the fixture server answers while they run, and every page the Worker renders meanwhile would show it: they are the `live` project's
// (playwright.config.ts, `*-live.spec.ts`), which runs alone after the others, one test at a time, in the order of this file. It is the order that keeps it so:
//
//   1. XRPL, S not computed yet: a 503, not stored (nothing is stored yet);
//   2. XRPL, S missing (a data API without D7): a 503, not stored;
//   3. XRPL, one snapshot with the stale warning, the escrow history incomplete and 29-digit AMM and reserves figures: the page is drawn, and stored for 300 s;
//   4. Xahau, M failing: the minted card says so with a Retry, nothing is stored; then the answer is back and Retry brings the card, and the page is stored;
//   5. what is kept: the bar's cursor, the toggles, the phone's layout of wide figures, axe on both pages, the menu's way to Supply and the tags after it.
//
// The recordings do not have the failure of S, nor a stale or an incomplete snapshot (the Worker's own tests have the others: no reserves is supply-page.spec.ts's). Against a real stack, or a
// deployed Worker, these tests skip, and the sandbox checklist (README) has the page on both testnets.

test.skip(LIVE, "changes what the fixture server answers: it needs the fixture server of the stack, not a real stack or a deployed Worker");
test.skip(featuresOff(process.env).has("SUPPLY"), "SUPPLY is off in the Worker under test: the supply page is not found (supply.spec.ts checks that)");

test.afterEach(async () => {
  await fixtures.reset();
});

const XRPL = "/xrpl/supply";
const XAHAU = "/xahau/supply";

/**
 * The ledger a page's data was built from (its `anchor`), as the HTML carries it. A page opened while the Worker still keeps the chain of the spec before (network-live.spec.ts moves it a day
 * on, and the Worker keeps `last_validated` 2 s) would ask for 90 days that end on another day, and no recording has them. So a test waits for the recordings' newest (`HEAD`) before it opens
 * the page. The amendments page carries the anchor and is not this file's page; where VALIDATORS is off it is not there, and the 2 s are waited out instead.
 */
const anchorOf = (html: string): number | null => {
  const found = /\\?"lastValidated\\?",(\d+)/.exec(html);
  return found ? Number(found[1]) : null;
};

async function atRecordedChain(page: Page): Promise<void> {
  if (VALIDATORS_OFF) {
    await page.waitForTimeout(2_500);
    return;
  }
  await expect.poll(async () => anchorOf((await freshHtml(page, "/xrpl/amendments")) ?? ""), { timeout: 15_000 }).toBe(HEAD);
}

/** The words of a page's HTML as a visitor reads them: the markers React puts between text pieces are not text. */
const wordsOf = async (page: Page, path: string): Promise<string> => (await (await page.request.get(path)).text()).replaceAll("<!-- -->", "");

const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);
const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { sameDocument: true }));

/** How far the page scrolls sideways: none, at any width (the tables scroll inside their cards). */
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** A tile of the figures by its label, and the figure in it. */
const tile = (page: Page, label: string) => page.locator(".stat", { has: page.locator(".stat__label", { hasText: new RegExp(`^${label}$`) }) });
const figureOf = (page: Page, label: string) => tile(page, label).locator(".supply__figure");

/** The cards of days, found by the id of their titles. */
const burnedCard = (page: Page) => page.locator('section[aria-labelledby="burned-title"]');
const mintedCard = (page: Page) => page.locator('section[aria-labelledby="minted-title"]');
const bar = (page: Page) => page.locator('section[aria-labelledby="supply-bar-title"]');
const slider = (page: Page, name: string | RegExp) => page.getByRole("slider", { name });

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const menu = (page: Page) => nav(page).locator('details[data-menu="network"]');
const summary = (page: Page) => menu(page).locator("summary");
const item = (page: Page, label: string) => menu(page).locator(".menu__item", { hasText: new RegExp(`^${label}( soon)?$`) });

const MINTED_FAILED = "Couldn’t load XAH minted per day.";

// ---- 1 and 2: the snapshot refused ---------------------------------------------------------------------------------------------------------------------------------

test.describe("when the snapshot cannot be had", () => {
  // The browser logs each 503 it is given as an error: the tests check that those are all it logs.
  test.use({ allowConsoleErrors: true });

  /** The page is a 503 that says to try again, with Retry-After, and is not stored: a second look is a miss, not a copy of the failure. */
  async function expectRefused(page: Page, browserErrors: string[]): Promise<void> {
    await atRecordedChain(page);
    const first = await page.request.get(XRPL);
    expect(first.status()).toBe(503);
    expect(first.headers()["retry-after"]).toBeDefined();
    expect(first.headers()["cache-control"]).toContain("no-store");
    const again = await page.request.get(XRPL);
    expect(again.status()).toBe(503);
    expect(again.headers()["x-cache"]).toBe("MISS");

    // In a browser: the try-again page, and nothing of the supply on it.
    const response = await page.goto(XRPL);
    expect(response?.status()).toBe(503);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Temporarily unavailable");
    await expect(page.locator(".supply")).toHaveCount(0);
    expect(browserErrors.length).toBeGreaterThan(0);
    expect(browserErrors.filter((line) => !line.includes("status of 503"))).toEqual([]);
  }

  test("XRPL: 'supply not computed yet' is the try-again page, a 503 that is not stored", async ({ page, browserErrors }) => {
    await fixtures.override(supplyVariant("not-computed"));
    await expectRefused(page, browserErrors);
  });

  test("XRPL: a data API without the supply route is the try-again page too, and not stored", async ({ page, browserErrors }) => {
    await fixtures.override(supplyVariant("route-missing"));
    await expectRefused(page, browserErrors);
  });
});

// ---- 3: one snapshot with its notices ----------------------------------------------------------------------------------------------------------------------------

test.describe("a snapshot that is old, with an incomplete escrow history", () => {
  test("XRPL: the page says both, in its place, and the figures are the snapshot's", async ({ page }) => {
    await fixtures.override(supplyVariant(["stale", "escrowed-incomplete", "wide-figures"]));
    await atRecordedChain(page);
    // The Worker has no copy of the page (the two before it were refused), so the first look draws this snapshot; it is then kept.
    expect(await wordsOf(page, XRPL)).toContain("This snapshot is 5 hours older than the newest ledger");

    await page.goto(XRPL);
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Supply");
    await expect(page).toHaveTitle("Supply · XRPL · explorer");
    await expect(page.getByRole("alert")).toHaveCount(0);

    // The stale warning under the snapshot line, which names a ledger and a time 5 hours before the newest recorded one.
    const warning = page.locator(".notice--warning");
    await expect(warning).toHaveCount(1);
    await expect(warning).toHaveText("This snapshot is 5 hours older than the newest ledger: the data API has not computed a newer one.");
    await expect(page.locator(".supply__snapshot")).toContainText(`#${(HEAD - 4_500).toLocaleString("en-US")}`);
    await expect(page.locator(".supply__snapshot")).toContainText("Oct 17, 2026, 12:01 UTC");

    // The escrow history note under the bar and under the figures that are made of it, each with the ledger as a link; the reserves' own note (the recordings have it) stands too.
    const escrows = page.getByRole("note").filter({ hasText: "Covers ledger #99,413,505 onwards: earlier escrows are not in the index yet." });
    await expect(escrows).toHaveCount(3);
    await expect(bar(page).getByRole("note")).toHaveText("Covers ledger #99,413,505 onwards: earlier escrows are not in the index yet.");
    await expect(escrows.first().getByRole("link", { name: "#99,413,505" })).toHaveAttribute("href", "/xrpl/ledger/99413505");
    await expect(tile(page, "Account reserves").getByRole("note")).toHaveText("Covers ledger #28,685,313 onwards: earlier account changes are not in the index yet.");

    // XRPL's figures, exact: the snapshot's own, six decimals, the fraction muted.
    await expect(figureOf(page, "Total supply")).toHaveText("99,985,312,374.716318 XRP");
    await expect(figureOf(page, "Burned")).toHaveText("14,687,625.283682 XRP");
    await expect(figureOf(page, "Escrowed")).toHaveText("35,212,847,105.402318 XRP");
    await expect(figureOf(page, "Circulating supply")).toHaveText("64,772,465,269.314000 XRP");
    await expect(figureOf(page, "In AMM pools")).toHaveText("46,218,377,402,915,000,000,000,000,000.402915 XRP");
    await expect(figureOf(page, "Account reserves")).toHaveText("9,810,004,000,000,000,000,000,000,000.500000 XRP");
    await expect(page.locator(".supply__figure")).toHaveCount(6);
    await expect(page.locator(".supply__fraction").first()).toHaveText(".716318");
    await expect(bar(page).getByRole("heading", { level: 2 })).toHaveText("Where the 100 billion XRP are");
    await expect(page.locator(".supply__burned")).toContainText("14.69M XRP");
    // The burned card has its days, today marked as it is on every page of the explorer.
    await expect(burnedCard(page).getByRole("heading", { level: 2 })).toHaveText("XRP burned per day");
    await expect(burnedCard(page)).toContainText("3,466.85 XRP");
    await expect(burnedCard(page).getByRole("alert")).toHaveCount(0);
    // XRPL mints nothing.
    await expect(mintedCard(page)).toHaveCount(0);
  });
});

// ---- 4: Xahau's minted days ---------------------------------------------------------------------------------------------------------------------------------------

test.describe("when Xahau's minted days cannot be loaded", () => {
  /** The page with its minted call failed: asked for until it says so, then opened. (A degraded page is served and not stored, so each look draws the page again.) */
  async function openFailing(page: Page): Promise<void> {
    await fixtures.override(supplyVariant("minted-failing"));
    await atRecordedChain(page);
    await expect.poll(async () => (await wordsOf(page, XAHAU)).includes(MINTED_FAILED), { timeout: 15_000 }).toBe(true);
    await page.goto(XAHAU);
    await hydrated(page);
    await expect(mintedCard(page).getByRole("alert")).toBeVisible();
  }

  test("the minted card says so in its place with a Retry, the rest of the page stands, and the answer is not stored", async ({ page }) => {
    await openFailing(page);
    await expect(mintedCard(page).getByRole("heading", { level: 2 })).toHaveText("XAH minted per day, by source");
    await expect(mintedCard(page).getByRole("alert")).toContainText(MINTED_FAILED);
    await expect(mintedCard(page).getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(mintedCard(page).getByRole("table")).toHaveCount(0);
    // It is the only alert: a failed card does not fail the page. The tile that sums the days has nothing to sum, and says why.
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Supply");
    await expect(figureOf(page, "Total supply")).toHaveText("613,401,782.117306 XAH");
    await expect(figureOf(page, "Escrowed")).toHaveText("18,406,227.318004 XAH");
    await expect(tile(page, "Minted, last 90 days")).toContainText("—");
    await expect(tile(page, "Minted, last 90 days")).toContainText("Couldn't load the minted days.");
    // The table view is there (hidden until Table is chosen): the burned card was drawn.
    await expect(burnedCard(page).getByRole("table", { name: "Burned per day", includeHidden: true })).toBeAttached();
    await expect(burnedCard(page).getByRole("alert")).toHaveCount(0);

    // A degraded answer is served and never stored: a second look is a miss.
    const again = await page.request.get(XAHAU);
    expect(again.status()).toBe(200);
    expect(again.headers()["cache-control"]).toContain("no-store");
    expect(again.headers()["x-cache"]).toBe("MISS");
  });

  test("Retry brings the card back, in the same document, once the answer is there again", async ({ page }) => {
    await openFailing(page);
    await markDocument(page);

    await fixtures.reset();
    // The page is asked for, fresh, until no card says it failed (a degraded page is not stored, so the first look after the reset may still be the Worker's M of a moment ago), and only
    // then is Retry pressed.
    await expect
      .poll(
        async () => {
          const html = (await freshHtml(page, XAHAU))?.replaceAll("<!-- -->", "");
          return html !== undefined && !html.includes(MINTED_FAILED);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await mintedCard(page).getByRole("button", { name: "Retry" }).click();

    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(mintedCard(page).getByRole("table", { name: "Minted per day", includeHidden: true })).toBeAttached();
    await expect(figureOf(page, "Minted, last 90 days")).toHaveText("2,981,418.527222 XAH");
    await expect(mintedCard(page)).toContainText("Since ledger #1: 49,425,551.616207 XAH minted: 41,203,318.512207 as rewards, 8,102,233.104 by Import, 120,000 by GenesisMint.");
    expect(await sameDocument(page)).toBe(true);
  });
});

// ---- 5: what is kept ----------------------------------------------------------------------------------------------------------------------------------------------
// From here on the Worker keeps both pages (XRPL's with the snapshot of the test above, Xahau's with the recordings), and each test only reads them. Nothing here changes an answer.

const NETWORKS = [
  {
    net: "xrpl",
    path: XRPL,
    title: "Where the 100 billion XRP are",
    // Burned, escrowed, circulating: the segments in reading order, as the slider says them and the tooltip shows them.
    segments: [
      { said: "Burned, 14,687,625.283682 XRP (0.015% of the 100 billion XRP)", name: "Burned", figure: "14,687,625.283682 XRP", share: "0.015% of the 100 billion XRP" },
      { said: "Escrowed, 35,212,847,105.402318 XRP (35.21% of the 100 billion XRP)", name: "Escrowed", figure: "35,212,847,105.402318 XRP", share: "35.21% of the 100 billion XRP" },
      { said: "Circulating supply, 64,772,465,269.314 XRP (64.77% of the 100 billion XRP)", name: "Circulating supply", figure: "64,772,465,269.314 XRP", share: "64.77% of the 100 billion XRP" },
    ],
  },
  {
    net: "xahau",
    path: XAHAU,
    title: "Where the XAH are",
    // Escrowed (3%) and circulating: the burned segment is too small to draw.
    segments: [
      { said: "Escrowed, 18,406,227.318004 XAH (3.00% of the total supply)", name: "Escrowed", figure: "18,406,227.318004 XAH", share: "3.00% of the total supply" },
      { said: "Circulating supply, 594,995,554.799302 XAH (97.00% of the total supply)", name: "Circulating supply", figure: "594,995,554.799302 XAH", share: "97.00% of the total supply" },
    ],
  },
] as const;

for (const { net, path, title, segments } of NETWORKS) {
  test.describe(`the bar of ${net}`, () => {
    test("is reached with Tab, and the arrows, Home and End step through the segments, each said by the slider and shown in the tooltip", async ({ page }) => {
      await page.goto(path);
      await hydrated(page);
      const cursor = slider(page, `${title}, segment by segment`);
      const tip = bar(page).locator(".plot__tip");
      await expect(tip).toHaveCount(0);

      // Tab from the ledger link of the snapshot line reaches the bar's slider, and the tooltip opens on the first segment.
      await page.locator(".supply__snapshot a").focus();
      await page.keyboard.press("Tab");
      await expect(cursor).toBeFocused();
      await expect(cursor).toHaveAttribute("aria-valuemin", "0");
      await expect(cursor).toHaveAttribute("aria-valuemax", String(segments.length - 1));

      const shows = async (at: number) => {
        await expect(cursor).toHaveAttribute("aria-valuenow", String(at));
        await expect(cursor).toHaveAttribute("aria-valuetext", segments[at]!.said);
        await expect(tip).toBeVisible();
        await expect(tip).toContainText(segments[at]!.name);
        await expect(tip).toContainText(segments[at]!.figure);
        await expect(tip).toContainText(segments[at]!.share);
      };
      await shows(0);
      await page.keyboard.press("ArrowRight");
      await shows(1);
      await page.keyboard.press("End");
      await shows(segments.length - 1);
      await page.keyboard.press("ArrowRight");
      await shows(segments.length - 1);
      await page.keyboard.press("Home");
      await shows(0);
      await page.keyboard.press("ArrowLeft");
      await shows(0);

      // Leaving the slider takes the tooltip away, and the segment under the pointer shows its own.
      await page.keyboard.press("Tab");
      await expect(tip).toHaveCount(0);
      await bar(page).locator(".share__seg").last().hover();
      await expect(tip).toContainText(segments.at(-1)!.name);
    });
  });
}

test.describe("the cards of days", () => {
  test("XRPL: the burned card switches to its table of 90 days and back", async ({ page }) => {
    await page.goto(XRPL);
    await hydrated(page);
    const card = burnedCard(page);
    await expect(card.getByRole("radio", { name: "Chart" })).toBeChecked();
    await expect(card.locator(".chart__view")).toBeVisible();
    await expect(card.locator(".col")).toHaveCount(90);

    await card.getByRole("radio", { name: "Table" }).check();
    const table = card.getByRole("table", { name: "Burned per day" });
    await expect(table).toBeVisible();
    await expect(card.locator(".chart__view")).toBeHidden();
    await expect(table.locator('[role="row"]:not(.table__head)')).toHaveCount(90);
    await expect(table.locator('[role="row"]:not(.table__head)').first()).toContainText("Oct 17, 2026, so far");
    await expect(table.locator('[role="row"]:not(.table__head)').first()).toContainText("21.803244");
    await expect(table.getByRole("columnheader", { name: "Burned, XRP" })).toBeVisible();

    await card.getByRole("radio", { name: "Chart" }).check();
    await expect(card.locator(".chart__view")).toBeVisible();
    await expect(table).toBeHidden();
  });

  test("Xahau: the burned card and the minted card each switch to their table and back, and the minted table has its total", async ({ page }) => {
    await page.goto(XAHAU);
    await hydrated(page);
    for (const [card, name, first] of [
      [burnedCard(page), "Burned per day", "2.49892"],
      [mintedCard(page), "Minted per day", undefined],
    ] as const) {
      await expect(card.getByRole("radio", { name: "Chart" })).toBeChecked();
      await expect(card.locator(".chart__view")).toBeVisible();
      await card.getByRole("radio", { name: "Table" }).check();
      const table = card.getByRole("table", { name });
      await expect(table).toBeVisible();
      await expect(card.locator(".chart__view")).toBeHidden();
      await expect(table.locator('[role="row"]:not(.table__head)')).toHaveCount(90);
      await expect(table.locator('[role="row"]:not(.table__head)').first()).toContainText("Oct 17, 2026, so far");
      if (first !== undefined) await expect(table.locator('[role="row"]:not(.table__head)').first()).toContainText(first);
      await card.getByRole("radio", { name: "Chart" }).check();
      await expect(card.locator(".chart__view")).toBeVisible();
    }
    await mintedCard(page).getByRole("radio", { name: "Table" }).check();
    await expect(mintedCard(page).getByRole("table", { name: "Minted per day" }).getByRole("columnheader", { name: "Total, XAH" })).toBeVisible();
  });
});

test.describe("wide figures", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  // The snapshot of test 3 has AMM and reserves figures of 29 digits. A tile breaks its figure anywhere, the bar's captions are cut by an ellipsis inside their segments, and nothing reaches
  // out of the card or the tile that holds it. (The unit tests cannot measure a box: this is the one check of the layout.)
  test("XRPL at 375 px: nothing in a tile or in the bar reaches out of it, and the page does not scroll sideways", async ({ page }) => {
    await page.goto(XRPL);
    await hydrated(page);
    // The page of test 3, kept: a test run alone would look at the recordings' figures and prove nothing.
    await expect(figureOf(page, "In AMM pools")).toHaveText("46,218,377,402,915,000,000,000,000,000.402915 XRP");
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    const outside = await page.evaluate(() => {
      const leaks: string[] = [];
      const within = (inner: Element, outer: Element, what: string) => {
        const a = inner.getBoundingClientRect();
        const b = outer.getBoundingClientRect();
        if (a.width > 0 && (a.left < b.left - 0.5 || a.right > b.right + 0.5)) leaks.push(`${what}: ${(inner.textContent ?? "").trim().slice(0, 40)} [${a.left.toFixed(1)}, ${a.right.toFixed(1)}] against [${b.left.toFixed(1)}, ${b.right.toFixed(1)}]`);
      };
      for (const stat of document.querySelectorAll(".stat")) for (const child of stat.querySelectorAll("*")) within(child, stat, "a tile");
      const barCard = document.querySelector(".supply__bar")!;
      for (const part of barCard.querySelectorAll(".share__label, .supply__part, .supply__part-text, .supply__burned, .supply__text, .share__bar")) within(part, barCard, "the bar");
      return leaks;
    });
    expect(outside).toEqual([]);

    // The 29 digits are broken over lines inside their tile (one line would be wider than the phone), and every tile is as wide as the grid's column.
    const amm = figureOf(page, "In AMM pools");
    const figure = (await amm.boundingBox())!;
    const column = (await tile(page, "In AMM pools").boundingBox())!;
    expect(figure.x + figure.width).toBeLessThanOrEqual(column.x + column.width + 0.5);
    expect(figure.height).toBeGreaterThan(30);
    // The Escrowed caption is clipped by its segment, as the owner knows: the figures are also in the tile, the tooltip and the slider.
    await expect(bar(page).locator(".share__label").first()).toBeVisible();
  });
});

for (const { net, path } of NETWORKS) {
  for (const viewport of [
    { name: "desktop", size: { width: 1280, height: 800 } },
    { name: "375 px", size: { width: 375, height: 812 } },
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      test.describe(`the ${net} supply page at ${viewport.name}, in ${scheme}`, () => {
        test.use({ viewport: viewport.size, colorScheme: scheme });

        test("has no serious or critical violation and no sideways scroll", async ({ page }) => {
          await page.goto(path);
          await hydrated(page);
          await expect(slider(page, /segment by segment$/)).toBeAttached();
          await expect(burnedCard(page).getByRole("slider")).toBeAttached();
          await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).colorScheme)).toBe(scheme);
          expect(await seriousViolations(page)).toEqual([]);
          expect(await sideways(page)).toBeLessThanOrEqual(0);
        });
      });
    }
  }

  test.describe(`the ${net} supply page, landmarks and names`, () => {
    test("has no two landmarks of one role and name, and nothing is given a name it cannot have, the Network menu open", async ({ page }) => {
      await page.goto(path);
      await hydrated(page);
      await expect(slider(page, /segment by segment$/)).toBeAttached();
      const landmarks = await new AxeBuilder({ page }).withRules(["landmark-unique"]).analyze();
      expect(landmarks.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`)).toEqual([]);

      // With the menu open: the summary's and the current item's `aria-current` are what `aria-allowed-attr` reads (the pages the menu marks on any page of the section).
      await summary(page).click();
      await expect(menu(page)).toHaveJSProperty("open", true);
      const names = await new AxeBuilder({ page }).withRules(["aria-prohibited-attr", "aria-allowed-attr", "aria-allowed-role"]).analyze();
      const found = [...names.violations, ...names.incomplete].map((rule) => `${rule.id}: ${rule.nodes.map((node) => node.target.join(" ")).join(" | ")}`);
      expect(found).toEqual([]);
      expect(await seriousViolations(page)).toEqual([]);
    });
  });
}

// ---- The menu's way to the page ---------------------------------------------------------------------------------------------------------------------------------

test.describe("the Network menu leads to Supply", () => {
  test("the keyboard opens it, Tab reaches Supply, Enter goes there in the same document, the panel is closed, and the menu marks the page", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    await markDocument(page);
    await summary(page).focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toHaveJSProperty("open", true);
    // Overview, then Validators and Amendments where VALIDATORS is on, then Supply.
    const links = menu(page).locator("a.menu__item");
    const count = await links.count();
    for (let i = 0; i < count; i++) await page.keyboard.press("Tab");
    await expect(item(page, "Supply")).toBeFocused();
    await page.keyboard.press("Enter");

    await page.waitForURL("**/xrpl/supply");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Supply");
    await expect(menu(page)).toHaveJSProperty("open", false);
    expect(await sameDocument(page)).toBe(true);
    await expect(summary(page)).toHaveAttribute("aria-current", "true");
    await expect(summary(page)).toHaveClass(/is-current/);
    await expect(item(page, "Supply")).toHaveAttribute("aria-current", "page");
    await expect(item(page, "Overview")).not.toHaveAttribute("aria-current", /./);
  });

  test("Xahau's page marks the menu the same way", async ({ page }) => {
    await page.goto(XAHAU);
    await hydrated(page);
    await expect(summary(page)).toHaveAttribute("aria-current", "true");
    await expect(item(page, "Supply")).toHaveAttribute("aria-current", "page");
    await expect(item(page, "Supply")).toHaveAttribute("href", "/xahau/supply");
    await expect(menu(page).locator(".menu__item[aria-current]")).toHaveCount(1);
  });

  // The route is in the first page's route table (route discovery is `initial`): moving to it by the menu asks for no manifest, and the tags are made in the browser (README, "SEO and link
  // previews"). It is here, and not in client-meta.spec.ts, because no `chromium` spec opens the page.
  test("asks for no route manifest, takes the tags of the page with it, and Back is the network page again", async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const manifests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/__manifest") manifests.push(request.url());
    });
    const head = () =>
      page.evaluate(() => {
        const content = (selector: string) => document.querySelector(selector)?.getAttribute("content") ?? null;
        return {
          title: document.title,
          canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
          robots: content('meta[name="robots"]'),
          ogUrl: content('meta[property="og:url"]'),
          ogImage: content('meta[property="og:image"]'),
          twitterCard: content('meta[name="twitter:card"]'),
        };
      });
    await page.goto("/xrpl/network");
    await hydrated(page);
    await markDocument(page);
    await expect(page).toHaveTitle("XRPL network · explorer");

    await summary(page).click();
    await item(page, "Supply").hover();
    await item(page, "Supply").click();
    await page.waitForURL("**/xrpl/supply");
    await expect(page).toHaveTitle("Supply · XRPL · explorer");
    const supply = await head();
    expect(supply.canonical).toBe(`${origin}/xrpl/supply`);
    expect(supply.ogUrl).toBe(supply.canonical);
    // No image of its own: the plain summary card, like the tokens list.
    expect(supply.ogImage).toBeNull();
    expect(supply.twitterCard).toBe("summary");
    expect(supply.robots).toBeNull();

    await page.goBack();
    await page.waitForURL("**/xrpl/network");
    await expect(page).toHaveTitle("XRPL network · explorer");
    expect((await head()).canonical).toBe(`${origin}/xrpl/network`);
    expect(await sameDocument(page)).toBe(true);
    expect(manifests).toEqual([]);
  });
});
