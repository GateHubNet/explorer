import type { Page } from "@playwright/test";

import { BEFORE_HEAD, fixtures, HEAD, xrplHomeOneLedgerBehind } from "./fixture-control";
import { count, LIVE } from "./fixtures";
import { expect, hydrated, test } from "./support";

// The home page follows the chain (README, "Live updates"): while it is open it asks the explorer's own Worker for its data every 4 s, and when
// a ledger has closed the new one appears in the page, without a reload and with its animation.
//
// The fixture server is made to say that the newest ledger is the one before the recordings' newest (`xrplHomeOneLedgerBehind`), the page is
// opened, and the fixture server is let go back to the recordings: the chain has moved on by a ledger. These tests change what the Worker is
// told, so every other test would see it: they are a project of their own (playwright.config.ts) that runs after the others, one test at a time.

test.skip(LIVE, "moves the fixture server's chain on: it needs the fixture server of the stack, not a real stack or a deployed Worker");

/** The newest transaction of the recordings' newest XRPL ledger. */
const NEWEST_TRANSACTION = "1A00E4CC5EB143E8BFF4578019BDF45ECEA40C37F113D261ECFB276243858872";

/** What the page did to its rows and figures since `watch` was called, written down by a MutationObserver of the page itself. */
interface Seen {
  entering: string[];
  changed: number;
  moved: string[];
  /** The `animation-name` of each row and figure at the moment it was added: the next beat renders the page again and must not be a race. */
  rowAnimations: string[];
  figureAnimations: string[];
}

// The inner waits are several beats (4 s) long, and with the failure test's backoff (4, 8, 16 s) much longer than the default.
test.beforeEach(() => {
  test.slow();
});

test.afterEach(async () => {
  await fixtures.reset();
});

let opened = 0;

/** Opens the home page with the chain one ledger behind, and returns what to look at. */
async function openBehind(page: Page) {
  await fixtures.override(xrplHomeOneLedgerBehind());
  // A copy of its own at the edge. The Worker also keeps what the data API said for a second or two, and the test before this one left the
  // newest ledger there: ask until the page says what the fixture server says now, so that the test starts from the ledger it means to.
  const path = `/xrpl?live=${++opened}`;
  await expect.poll(async () => (await page.request.get(path)).text(), { timeout: 15_000 }).toContain(`#${count(BEFORE_HEAD)}`);
  await page.goto(path);
  await hydrated(page);
  const ledgerTile = page.locator(".stat", { hasText: "Latest validated ledger" }).locator(".stat__value");
  const ledgers = page.getByRole("table", { name: "Latest ledgers" });
  await expect(ledgerTile).toHaveText(`#${count(BEFORE_HEAD)}`);
  await expect(ledgers.getByRole("row").nth(1)).toContainText(`#${count(BEFORE_HEAD)}`);
  return { ledgerTile, ledgers };
}

/** Starts writing down what is added to the page and what is moved: rows that enter, figures that change, rows that are sent back to slide. */
async function watch(page: Page) {
  await page.evaluate(() => {
    const seen = { entering: [] as string[], changed: 0, moved: [] as string[], rowAnimations: [] as string[], figureAnimations: [] as string[] };
    Object.assign(window, { seen, sameDocument: true });
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.classList.contains("is-entering") && node.dataset.key) {
              seen.entering.push(node.dataset.key);
              seen.rowAnimations.push(getComputedStyle(node).animationName);
            }
            const figures = node.matches(".is-changed") ? [node] : [...node.querySelectorAll<HTMLElement>(".is-changed")];
            seen.changed += figures.length;
            for (const figure of figures) seen.figureAnimations.push(getComputedStyle(figure).animationName);
          }
        } else if (record.target instanceof HTMLElement && record.target.dataset.key && record.target.style.transform) {
          seen.moved.push(record.target.dataset.key);
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
  });
}

const seenBy = (page: Page) => page.evaluate(() => (window as unknown as { seen: Seen }).seen);

test.describe("the home page follows the chain", () => {
  test("shows the next ledger without a reload: the figures tick in, the new row enters, the rows that were there slide", async ({ page }) => {
    const { ledgerTile, ledgers } = await openBehind(page);
    await watch(page);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await fixtures.reset();

    // Within a few beats of 4 s, and the stored copies of 1 to 3 s.
    await expect(ledgerTile).toHaveText(`#${count(HEAD)}`, { timeout: 20_000 });
    await expect(ledgers.getByRole("row").nth(1)).toContainText(`#${count(HEAD)}`);
    await expect(ledgers.getByRole("row")).toHaveCount(9);
    await expect(page.getByRole("table", { name: "Latest transactions" }).getByRole("row").nth(1)).toContainText("Batch");

    const seen = await seenBy(page);
    // The new ledger and the new transactions entered; the ledgers that were there did not, and slid.
    expect(seen.entering).toContain(String(HEAD));
    expect(seen.entering).toContain(NEWEST_TRANSACTION);
    expect(seen.entering).not.toContain(String(BEFORE_HEAD));
    expect(new Set(seen.moved)).toContain(String(BEFORE_HEAD));
    expect(seen.moved).not.toContain(String(HEAD));
    // The figures that changed ticked in (the latest ledger, the transactions in it, the fees, the supply, the hero's line, the examples).
    expect(seen.changed).toBeGreaterThanOrEqual(6);

    // What the stylesheet does with them, in the browser that runs it, as each was added: a slide, a wash and a mark, once.
    expect(new Set(seen.rowAnimations)).toEqual(new Set(["row-enter, live-flash, row-mark"]));
    expect(new Set(seen.figureAnimations)).toEqual(new Set(["value-in, live-flash, value-mark"]));

    // The same document, and the browser asked the explorer's own Worker for the data and nobody else: its `.data` URL, for the page's route alone.
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
    const origin = new URL(page.url()).origin;
    expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
    const asked = requests.filter((url) => url.includes(".data"));
    expect(asked.length).toBeGreaterThanOrEqual(1);
    for (const url of asked) expect(url).toMatch(/\/xrpl\.data\?.*_routes=routes%2Fnet\._index/);
  });

  test("moves nothing for a visitor who prefers reduced motion: the new row has the quiet highlight and nothing slides", async ({ contextFor }) => {
    const context = await contextFor({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const { ledgerTile } = await openBehind(page);
    await watch(page);

    await fixtures.reset();

    await expect(ledgerTile).toHaveText(`#${count(HEAD)}`, { timeout: 20_000 });
    const seen = await seenBy(page);
    expect(seen.entering).toContain(String(HEAD));
    expect(seen.moved).toEqual([]);
    // A colour fading out, once: no slide, no fade-in, no transition. (As each was added, so that the next beat is not a race.)
    expect(new Set(seen.rowAnimations)).toEqual(new Set(["live-flash, row-mark"]));
    expect(new Set(seen.figureAnimations)).toEqual(new Set(["live-flash, value-mark"]));
    expect(await page.locator(".table__row:not(.table__head)").nth(1).evaluate((row) => getComputedStyle(row).transitionDuration)).toBe("0s");
  });

  test("animates nothing when the page is first opened", async ({ page }) => {
    await openBehind(page);
    await expect(page.locator(".is-entering, .is-changed")).toHaveCount(0);
    expect(await page.locator("[data-key]").evaluateAll((rows) => rows.filter((row) => (row as HTMLElement).style.transform !== "").length)).toBe(0);
  });
});

test.describe("when the Worker cannot give the page new data", () => {
  // The browser logs each 503 it is given as an error.
  test.use({ allowConsoleErrors: true });

  test("keeps the page as it was, says that the updates are paused after two refusals, and goes on with the new data when the Worker answers again", async ({ page }) => {
    const { ledgerTile } = await openBehind(page);
    const status = page.locator('.hero__live[role="status"]');
    let refused = 0;
    await page.route(/\/xrpl\.data\?/, (route) => {
      refused += 1;
      return route.fulfill({ status: 503, contentType: "text/plain", body: "busy" });
    });

    await fixtures.reset();

    // Two refusals, the second 8 s after the first (the pace halves with each failure in a row): then the page says so, quietly, in text.
    await expect(status).toHaveText("Live updates paused, retrying…", { timeout: 30_000 });
    expect(refused).toBeGreaterThanOrEqual(2);
    // And it is the page it was: no error screen, the figures it had.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore the XRP Ledger");
    await expect(ledgerTile).toHaveText(`#${count(BEFORE_HEAD)}`);
    await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toHaveCount(0);

    await page.unroute(/\/xrpl\.data\?/);
    await expect(ledgerTile).toHaveText(`#${count(HEAD)}`, { timeout: 40_000 });
    await expect(status).toHaveText("Live updates reconnected");
    // Back to nothing to say.
    await expect(status).toHaveText("", { timeout: 10_000 });
  });
});

test.describe("pausing the updates", () => {
  test("has a button that pauses and resumes them, kept for the tab", async ({ page }) => {
    await openBehind(page);
    const pause = page.getByRole("button", { name: "Pause live updates" });
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    // A target of 44 px, as the stylesheet says.
    expect((await pause.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await pause.click();
    const resume = page.getByRole("button", { name: "Resume live updates" });
    await expect(resume).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".hero__dot")).toHaveClass(/is-paused/);

    // The choice is the tab's: a reload keeps it.
    await page.reload();
    await hydrated(page);
    await expect(page.getByRole("button", { name: "Resume live updates" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Resume live updates" }).click();
    await expect(page.getByRole("button", { name: "Pause live updates" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".hero__dot")).not.toHaveClass(/is-paused/);
  });
});
