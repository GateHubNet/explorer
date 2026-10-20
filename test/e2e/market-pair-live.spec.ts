import type { Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { fixtures, nodeNotSynced, RLUSD_API, RLUSD_ISSUER, xrplPairOneTradeBehind } from "./fixture-control";
import { LIVE } from "./fixtures";
import { expect, hydrated, seriousViolations, test } from "./support";

// The market pair page follows the chain (README, "The markets pages"): every 4 s it asks the explorer's own Worker for its route's data, a new
// trade enters its list and the figures tick in, and what it shows is kept through the beats that fail. These tests change what the fixture
// server answers, and every page the Worker renders meanwhile would show it: they are in the `live` project (playwright.config.ts,
// `*-live.spec.ts`), which runs alone after the others, one test at a time.
//
// The market moves on by one trade: the fixture server is made to say that the newest trade of XRP/RLUSD is the one before the recordings'
// newest (`xrplPairOneTradeBehind`), the page is opened, and the fixture server goes back to the recordings.

test.skip(LIVE, "changes what the fixture server answers: it needs the fixture server of the stack, not a real stack or a deployed Worker");
test.skip(featuresOff(process.env).has("MARKETS"), "MARKETS is off in the Worker under test: the pair pages are not found");

const PAIR = `/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}`;

/** The keys of the trades of the first page (`ledger:tx:node`): the recordings' newest, and the newest while the market is one trade behind. */
const NEW_TRADE = "107721455:81:3";
const BEFORE = "107720688:6:1";
/** The last price each of them makes. */
const NEW_PRICE = "1.2890268";
const BEFORE_PRICE = "1.2935851";

/** The two sides of the XRP/RLUSD book (#6 and #7), the node failing them both. */
const BOOK_FAILS = {
  [`node book_offers XRP_${RLUSD_API}`]: nodeNotSynced(),
  [`node book_offers ${RLUSD_API}_XRP`]: nodeNotSynced(),
};

/** The markets call of the 24 hours, which the pair page never makes. */
const MARKETS_DAY = "GET /v2/network/markets?limit=1000&period=day";

/** The route's own `.data` URL: what the page asks for on each beat, and nothing else. */
const PAIR_DATA = /\/xrpl\/markets\/XRP\/RLUSD\.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De\.data\?/;

// The inner waits are several beats (4 s) long, and with the failure test's backoff (4, 8, 16 s) much longer than the default.
test.beforeEach(() => {
  test.slow();
});

test.afterEach(async () => {
  await fixtures.reset();
});

const tradesOf = (page: Page) => page.getByRole("table", { name: "Recent trades" });
/** The first trade of the list, the newest. */
const newestRow = (page: Page) => tradesOf(page).locator("[data-key]").first();
const priceOf = (page: Page) => page.locator(".pair__figure");
const statusOf = (page: Page) => page.locator('.hero__live[role="status"]');
const bookCard = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Order book" }) });

/** The key of the newest trade of the page the Worker would give now, as its HTML says it: the first `data-key` (the trades are the page's one live table). */
async function newestOnPage(page: Page): Promise<string | undefined> {
  return /data-key="([^"]+)"/.exec(await (await page.request.get(PAIR)).text())?.[1];
}

/** Opens the page with the market one trade behind (`xrplPairOneTradeBehind`). */
async function openBehind(page: Page): Promise<void> {
  await fixtures.override(xrplPairOneTradeBehind());
  // The Worker keeps the trades for 2 s, and a stored copy of the page is served for 3: ask until the page says what the fixture server says
  // now, so that the test starts from the trade it means to. (A query string of its own would be a redirect.)
  await expect.poll(() => newestOnPage(page), { timeout: 15_000 }).toBe(BEFORE);
  await page.goto(PAIR);
  await hydrated(page);
  await expect(newestRow(page)).toHaveAttribute("data-key", BEFORE);
  await expect(tradesOf(page).locator("[data-key]")).toHaveCount(19);
  await expect(priceOf(page)).toHaveText(BEFORE_PRICE);
}

/** What the page did to its rows and figures since `watch` was called, written down by a MutationObserver of the page itself. */
interface Seen {
  entering: string[];
  changed: number;
  moved: string[];
  /** The `animation-name` of each row and figure at the moment it was added: the next beat renders the page again and must not be a race. */
  rowAnimations: string[];
  figureAnimations: string[];
}

/** Starts writing down what is added to the page and what is moved: rows that enter, figures that change, rows that are sent back to slide. */
async function watch(page: Page): Promise<void> {
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

/** Every request the page makes from now on, by URL. */
function requestsOf(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

// ---- The page follows the chain ---------------------------------------------------------------------------------------------------------------

test.describe("the pair page follows the chain", () => {
  test("shows a new trade without a reload: its row enters, the rows that were there slide, the price ticks in, and the route's .data is all it asks for", async ({ page }) => {
    await openBehind(page);
    await watch(page);
    const requests = requestsOf(page);

    await fixtures.reset();

    // Within a few beats of 4 s, and the stored copies of 1 to 3 s.
    await expect(newestRow(page)).toHaveAttribute("data-key", NEW_TRADE, { timeout: 20_000 });
    await expect(tradesOf(page).locator("[data-key]")).toHaveCount(20);
    await expect(priceOf(page)).toHaveText(NEW_PRICE);
    // The book's middle row has the last price too.
    await expect(page.locator(".pair__book-mid")).toContainText(NEW_PRICE);

    const seen = await seenBy(page);
    // The new trade entered, and no other row; the one that was the newest slid with the others.
    expect(seen.entering).toEqual([NEW_TRADE]);
    expect(new Set(seen.moved)).toContain(BEFORE);
    expect(seen.moved).not.toContain(NEW_TRADE);
    // The price, and the book's last price, ticked in.
    expect(seen.changed).toBeGreaterThanOrEqual(2);
    // What the stylesheet does with them, in the browser that runs it, as each was added: a slide, a wash and a mark, once.
    expect(new Set(seen.rowAnimations)).toEqual(new Set(["row-enter, live-flash, row-mark"]));
    expect(new Set(seen.figureAnimations)).toEqual(new Set(["value-in, live-flash, value-mark"]));

    // The same document, and the browser asked the explorer's own Worker for the data and nobody else: its `.data` URL, for the page's route alone.
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
    const origin = new URL(page.url()).origin;
    expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
    const asked = requests.filter((url) => url.includes(".data"));
    expect(asked.length).toBeGreaterThanOrEqual(1);
    for (const url of asked) expect(url).toMatch(/\/xrpl\/markets\/XRP\/RLUSD\.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De\.data\?.*_routes=routes%2Fnet\.markets\.%24base\.%24counter/);
  });

  test("moves nothing for a visitor who prefers reduced motion: the new row has the quiet highlight and nothing slides", async ({ contextFor }) => {
    const context = await contextFor({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await openBehind(page);
    await watch(page);

    await fixtures.reset();

    await expect(newestRow(page)).toHaveAttribute("data-key", NEW_TRADE, { timeout: 20_000 });
    await expect(priceOf(page)).toHaveText(NEW_PRICE);
    const seen = await seenBy(page);
    expect(seen.entering).toEqual([NEW_TRADE]);
    // No transform on any row: a colour fading out, once, with no slide, no fade-in and no transition.
    expect(seen.moved).toEqual([]);
    expect(new Set(seen.rowAnimations)).toEqual(new Set(["live-flash, row-mark"]));
    expect(new Set(seen.figureAnimations)).toEqual(new Set(["live-flash, value-mark"]));
    expect(await tradesOf(page).locator("[data-key]").nth(1).evaluate((row) => getComputedStyle(row).transitionDuration)).toBe("0s");
  });

  test("has a button that pauses the updates, asks nothing while paused, and asks again at once when resumed", async ({ page }) => {
    await openBehind(page);
    const pause = page.getByRole("button", { name: "Pause live updates" });
    expect((await pause.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(statusOf(page)).toHaveText("");

    await pause.click();
    await expect(statusOf(page)).toHaveText("Live updates paused");
    await expect(page.getByRole("button", { name: "Resume live updates" })).toHaveClass(/is-paused/);
    await expect(page.locator(".hero__dot")).toHaveClass(/is-paused/);

    // The market moves on while the page is paused: more than a beat goes by, and the page asks for nothing.
    const requests = requestsOf(page);
    await fixtures.reset();
    await page.waitForTimeout(6_000);
    expect(requests.filter((url) => PAIR_DATA.test(url))).toEqual([]);
    await expect(newestRow(page)).toHaveAttribute("data-key", BEFORE);

    await page.getByRole("button", { name: "Resume live updates" }).click();
    await expect(statusOf(page)).toHaveText("Live updates resumed");
    await expect(page.locator(".hero__dot")).not.toHaveClass(/is-paused/);
    await expect(newestRow(page)).toHaveAttribute("data-key", NEW_TRADE, { timeout: 20_000 });
  });

  test("holds the updates while the pointer is on the trades, says so, and takes the new trade once it leaves", async ({ page }) => {
    await openBehind(page);
    const HELD = "Paused while you look at the trades";
    await expect(page.getByText(HELD)).toHaveCount(0);

    await tradesOf(page).hover();
    await expect(page.getByText(HELD)).toBeVisible();
    // In the live row, in visible text, and not in the status line, which a screen reader announces.
    await expect(statusOf(page)).toHaveText("");
    await expect(page.locator(".hero__dot")).toHaveClass(/is-paused/);

    // The market moves on while the page is held: more than a beat goes by, and the list stays as it is under the pointer.
    const requests = requestsOf(page);
    await fixtures.reset();
    await page.waitForTimeout(6_000);
    expect(requests.filter((url) => PAIR_DATA.test(url))).toEqual([]);
    await expect(newestRow(page)).toHaveAttribute("data-key", BEFORE);

    await page.mouse.move(2, 2);
    await expect(page.getByText(HELD)).toHaveCount(0);
    await expect(newestRow(page)).toHaveAttribute("data-key", NEW_TRADE, { timeout: 20_000 });
  });
});

// ---- When something fails -----------------------------------------------------------------------------------------------------------------------

test.describe("when the Worker cannot give the page new data", () => {
  // The browser logs each 503 it is given as an error.
  test.use({ allowConsoleErrors: true });

  test("keeps the page as it was, says that the updates are paused after two refusals, and goes on with the new data when the Worker answers again", async ({ page }) => {
    await openBehind(page);
    let refused = 0;
    await page.route(PAIR_DATA, (route) => {
      refused += 1;
      return route.fulfill({ status: 503, contentType: "text/plain", body: "busy" });
    });

    await fixtures.reset();

    // Two refusals, the second 8 s after the first (the pace halves with each failure in a row): then the page says so, quietly, in text.
    await expect(statusOf(page)).toHaveText("Live updates paused, retrying…", { timeout: 30_000 });
    expect(refused).toBeGreaterThanOrEqual(2);
    // And it is the page it was: no error screen, the trades, the price, the book and the chart it had.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("XRP / RLUSD");
    await expect(newestRow(page)).toHaveAttribute("data-key", BEFORE);
    await expect(priceOf(page)).toHaveText(BEFORE_PRICE);
    await expect(page.getByRole("table", { name: "Order book" })).toBeVisible();
    await expect(page.locator(".candle").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toHaveCount(0);

    await page.unroute(PAIR_DATA);
    await expect(newestRow(page)).toHaveAttribute("data-key", NEW_TRADE, { timeout: 40_000 });
    await expect(statusOf(page)).toHaveText("Live updates reconnected");
    // Back to nothing to say.
    await expect(statusOf(page)).toHaveText("", { timeout: 10_000 });
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`when the node cannot give the book, in ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("a fresh load says Live state unavailable in place of the book, keeps the rest of the page, and has no serious or critical violation", async ({ page }) => {
      await fixtures.override(BOOK_FAILS);
      // The Worker keeps the node's book for 2 s, and a stored copy of the page is served for 3: ask until the page says what the node says now.
      await expect.poll(async () => (await page.request.get(PAIR)).text(), { timeout: 15_000 }).toContain("Live state unavailable");
      await page.goto(PAIR);
      await hydrated(page);

      const card = bookCard(page);
      await expect(card.getByText("Live state unavailable")).toBeVisible();
      await expect(card).toContainText("The network node did not answer, so the order book is missing.");
      await expect(card.getByRole("button", { name: "Retry" })).toBeVisible();
      // Never half a book: neither side is shown.
      await expect(page.getByRole("table", { name: "Order book" })).toHaveCount(0);
      // The rest of the page stands on its own: the trades, the price and the chart are the index's.
      await expect(tradesOf(page).locator("[data-key]")).toHaveCount(20);
      await expect(priceOf(page)).toHaveText(NEW_PRICE);
      await expect(page.locator(".candle").first()).toBeVisible();
      // The notice has no role: the live status line is the page's one.
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveCount(1);

      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).colorScheme)).toBe(scheme);
      expect(await seriousViolations(page)).toEqual([]);
    });
  });
}

test.describe("when the node fails under an open page", () => {
  test("a book that was shown is kept through a beat whose book failed, with its ledger", async ({ page }) => {
    // The test before this one failed the book, and the Worker holds a failure for 5 s: start from a page that has it.
    await expect.poll(async () => (await page.request.get(PAIR)).text(), { timeout: 15_000 }).toContain('aria-label="Order book"');
    await page.goto(PAIR);
    await hydrated(page);
    const book = page.getByRole("table", { name: "Order book" });
    await expect(book).toBeVisible();
    const levels = await book.locator(".pair__level").allTextContents();
    const source = await bookCard(page).locator(".chart__source").textContent();
    expect(source).toMatch(/ledger #\s?[\d,]+/);

    // Each beat's answer goes through the test on its way to the page, which writes down whether it has the book failed: the route's data names
    // each part's state once (React Router's stream writes a string once), and the book is the only part the fixture server fails.
    let failedBeats = 0;
    await page.route(PAIR_DATA, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes('"failed"')) failedBeats += 1;
      await route.fulfill({ response, body });
    });
    await fixtures.override(BOOK_FAILS);
    // The node's answers are kept 2 s, and a beat is every 4 s: within a few beats, one has the book failed. And the one after it, so that the
    // page has surely drawn what it kept from the first.
    await expect.poll(() => failedBeats, { timeout: 40_000 }).toBeGreaterThanOrEqual(2);

    // The page has rendered those answers, and kept the book it showed, with the ledger it was read at.
    await expect(book).toBeVisible();
    expect(await book.locator(".pair__level").allTextContents()).toEqual(levels);
    await expect(bookCard(page).locator(".chart__source")).toHaveText(source!);
    await expect(page.getByText("Live state unavailable")).toHaveCount(0);
  });
});

test.describe("when the data API has no markets route", () => {
  // The browser logs the 503 of the markets page.
  test.use({ allowConsoleErrors: true });

  test("the markets page answers 503, a stored copy stands in for it, and the pair page, which does not ask for it, is unaffected", async ({ page }) => {
    // The markets page of the 24 hours in views no other spec opens: each is the same call (#1 of the day), and none has a stored copy. The
    // Worker keeps that call's answer 60 s (class `minute`), and the chromium project asked for it a while ago: a view asked for while the
    // answer is kept is a 200, and stored, and from then on that copy stands in for its 503s (stale-if-error: README, "The Worker entry"). So
    // each view is asked once, 20 s apart, and the last when the answer kept from before the override has surely gone (62 s after it).
    test.setTimeout(150_000);
    await fixtures.override({ [MARKETS_DAY]: null });
    const since = Date.now();
    const views = ["/xrpl/markets?quote=btc", "/xrpl/markets?quote=eur", "/xrpl/markets?quote=usd", "/xrpl/markets?quote=xrp"];
    let refused: string | undefined;
    for (const [at, view] of views.entries()) {
      const askAt = at === views.length - 1 ? 62_000 : at * 20_000;
      await page.waitForTimeout(Math.max(0, since + askAt - Date.now()));
      if ((await page.request.get(view)).status() === 503) {
        refused = view;
        break;
      }
    }
    expect(refused, "a view of the 24 hours that answered 503").toBeDefined();

    // In a browser: the 503 page, not stored (the view still has no copy).
    const markets = await page.goto(refused!);
    expect(markets?.status()).toBe(503);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Temporarily unavailable");
    // The default view, which the chromium project opened: its stored copy, of any age, stands in for the 503 (the 503 itself when this project
    // runs alone, with --no-deps, and nothing has stored it).
    const plain = await page.request.get("/xrpl/markets");
    if (plain.status() === 200) expect(plain.headers()["x-cache"]).toMatch(/^(HIT|STALE)$/);
    else expect(plain.status()).toBe(503);

    const pair = await page.goto(PAIR);
    expect(pair?.status()).toBe(200);
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("XRP / RLUSD");
    await expect(page.getByRole("table", { name: "Order book" })).toBeVisible();
    await expect(tradesOf(page).locator("[data-key]")).toHaveCount(20);
    await expect(page.getByText(/Couldn’t load|couldn’t be loaded|Live state unavailable/)).toHaveCount(0);
  });
});
