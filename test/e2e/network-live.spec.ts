import type { Page } from "@playwright/test";

import { BEFORE_HEAD, fixtures, HEAD, unavailable, xrplHomeOneLedgerBehind, xrplNextDay } from "./fixture-control";
import { count, LIVE } from "./fixtures";
import { expect, hydrated, test } from "./support";

// The network page follows the chain (README, "Live updates") and keeps what it shows through the beats that fail. These tests change what the
// fixture server answers, and every page the Worker renders meanwhile would show it: they are a project of their own (playwright.config.ts,
// `*-live.spec.ts`) that runs alone after the others, one test at a time.
//
// The views are the ones no other spec opens, in the order that keeps it so: the Worker keeps a period's answers for 300 s (a call over a
// period asks the same key from every visitor), so a test that takes one of them away has to be the first of the run to ask. `stats/type` of the
// 90 days is taken away by the first test, and every later test that opens a 90-day view only reads what it kept. The AMM answer of the 7 days
// in USD is the second test's alone. The chain, which has no key of a period, moves under any view.

test.skip(LIVE, "changes what the fixture server answers: it needs the fixture server of the stack, not a real stack or a deployed Worker");

/** The view of the failing `stats/type`, and of the chain tests that follow it. */
const NINETY = "/xrpl/network?period=90d";
const NINETY_USD = "/xrpl/network?period=90d&in=usd";
/** The view whose AMM answer is taken away. */
const SEVEN_USD = "/xrpl/network?period=7d&in=usd";

// The keys of the data API's calls, as the fixture server names them (the query sorted by name; the dates of the recordings' index day).
const USD = "exchange_currency=USD&exchange_issuer=rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const AMM_SEVEN_USD = `GET /v2/network/amm_volume?end=2026-10-17&${USD}&interval=day&limit=1000&start=2026-10-11`;
const TYPES_NINETY = "GET /v2/stats/type?end=2026-10-17&interval=day&limit=1000&start=2026-07-20";

// The inner waits are several beats (4 s) long, and with the failure test's backoff (4, 8, 16 s) much longer than the default.
test.beforeEach(() => {
  test.slow();
});

test.afterEach(async () => {
  await fixtures.reset();
});

const typesCard = (page: Page) => page.locator('section[aria-labelledby="network-types-title"]');
const volumeCard = (page: Page) => page.locator('section[aria-labelledby="network-volume-title"]');
const statusOf = (page: Page) => page.locator('.hero__live[role="status"]');
const chipsOf = (page: Page) => page.locator(".network__chips li");

/** The newest ledger on the strip of the page the Worker would give now, as the HTML says it: the `data-key` of its first chip. */
async function newestOnStrip(page: Page, path: string): Promise<string | undefined> {
  return /<li data-key="(\d+)"/.exec(await (await page.request.get(path)).text())?.[1];
}

/** Opens the page with the chain one ledger behind (`xrplHomeOneLedgerBehind`), and returns what to look at. */
async function openBehind(page: Page, path: string) {
  await fixtures.override(xrplHomeOneLedgerBehind());
  // The Worker keeps what the data API said for a second or two, and a stored copy of the page is served for three: ask until the page says what
  // the fixture server says now, so that the test starts from the ledger it means to. (A query string of its own would be a redirect.)
  await expect.poll(() => newestOnStrip(page, path), { timeout: 15_000 }).toBe(String(BEFORE_HEAD));
  await page.goto(path);
  await hydrated(page);
  const chips = chipsOf(page);
  await expect(chips.first()).toContainText(`#${count(BEFORE_HEAD)}`);
  await expect(page.locator(".network__validators")).toContainText(`#${count(BEFORE_HEAD)}`);
  return { chips };
}

/** What the page did to its chips and figures since `watch` was called, written down by a MutationObserver of the page itself. */
interface Seen {
  entering: string[];
  changed: number;
  moved: string[];
  /** The `animation-name` of each chip, and of its link, at the moment it was added: the next beat renders the page again and must not be a race. */
  chipAnimations: string[];
  linkAnimations: string[];
}

/** Starts writing down what is added to the page and what is moved: chips that enter, figures that change, chips that are sent back to slide. */
async function watch(page: Page) {
  await page.evaluate(() => {
    const seen = { entering: [] as string[], changed: 0, moved: [] as string[], chipAnimations: [] as string[], linkAnimations: [] as string[] };
    Object.assign(window, { seen, sameDocument: true });
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.classList.contains("is-entering") && node.dataset.key) {
              seen.entering.push(node.dataset.key);
              seen.chipAnimations.push(getComputedStyle(node).animationName);
              seen.linkAnimations.push(getComputedStyle(node.querySelector(".chip__link") ?? node).animationName);
            }
            seen.changed += node.matches(".is-changed") ? 1 : node.querySelectorAll(".is-changed").length;
          }
        } else if (record.target instanceof HTMLElement && record.target.dataset.key && record.target.style.transform) {
          seen.moved.push(record.target.dataset.key);
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
  });
}

const seenBy = (page: Page) => page.evaluate(() => (window as unknown as { seen: Seen }).seen);

/** Every request the page makes from now on, by URL: the test looks for the route's own `.data`, which is all it should ask the Worker for. */
function dataRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

// ---- A card that cannot be loaded ------------------------------------------------------------------------------------------------------------

test.describe("a card that cannot be loaded", () => {
  test("says so in its place, and comes back by itself once the data API answers (the hold, then a beat)", async ({ page }) => {
    await fixtures.override({ [TYPES_NINETY]: unavailable() });
    await page.goto(NINETY_USD);
    await hydrated(page);

    const card = typesCard(page);
    await expect(card.getByText("Couldn’t load transactions by type")).toBeVisible();
    await expect(card.getByRole("button", { name: "Retry" })).toBeVisible();
    // The card is in its place with its title and its source, and the rest of the page is the page: the other cards stand on their own.
    await expect(card.getByRole("heading", { name: "Transactions by type, per day" })).toBeVisible();
    await expect(card.locator(".col")).toHaveCount(0);
    await expect(volumeCard(page).locator("path.line").first()).toBeAttached();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("XRPL network");
    await expect(page.getByRole("alert")).toHaveCount(1);

    await fixtures.reset();
    // The hold keeps the call from being asked for 5 s, and a beat is every 4 s.
    await expect(card.locator(".col")).toHaveCount(90, { timeout: 10_000 });
    await expect(card.getByText("Couldn’t load")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("is the AMM line's when the API has no route for it: the card says so with a Retry, and the line comes back when it does", async ({ page }) => {
    await fixtures.override({ [AMM_SEVEN_USD]: null });
    await page.goto(SEVEN_USD);
    await hydrated(page);

    const card = volumeCard(page);
    await expect(card.getByText("AMM swaps couldn’t be loaded.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Retry" })).toBeVisible();
    // The chart is the payments and the DEX trades; the line that is missing is told in words, once.
    await expect(card.locator("path.line")).toHaveCount(2);
    await expect(card.getByRole("list", { name: "Legend" }).getByRole("listitem")).toHaveText(["Payments", "DEX trades, tracked markets, AMM swaps included"]);
    await expect(page.getByRole("alert")).toHaveCount(1);

    await fixtures.reset();
    await expect(card.locator('path.line[data-slot="3"]')).toHaveCount(1, { timeout: 15_000 });
    await expect(card.getByText("AMM swaps couldn’t be loaded.")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

// ---- The page follows the chain ---------------------------------------------------------------------------------------------------------------

test.describe("the network page follows the chain", () => {
  test("shows the next ledger without a reload: its chip enters, the chips that were there slide, and the route's .data is all it asks for", async ({ page }) => {
    const { chips } = await openBehind(page, NINETY);
    await watch(page);
    const requests = dataRequests(page);

    await fixtures.reset();

    // Within a few beats of 4 s, and the stored copies of 1 to 3 s.
    await expect(chips.first()).toContainText(`#${count(HEAD)}`, { timeout: 20_000 });
    await expect(chips).toHaveCount(6);
    await expect(page.locator(".network__validators")).toContainText(`#${count(HEAD)}`);

    const seen = await seenBy(page);
    // The new ledger entered; the one that was the newest did not, and slid with the others.
    expect(seen.entering).toContain(String(HEAD));
    expect(seen.entering).not.toContain(String(BEFORE_HEAD));
    expect(new Set(seen.moved)).toContain(String(BEFORE_HEAD));
    expect(seen.moved).not.toContain(String(HEAD));
    // The validators' ledger, their count and their list ticked in.
    expect(seen.changed).toBeGreaterThanOrEqual(1);
    // What the stylesheet does with the chip, in the browser that runs it, as it was added: the slide, and on its link a wash and a mark.
    expect(new Set(seen.chipAnimations)).toEqual(new Set(["chip-enter"]));
    expect(new Set(seen.linkAnimations)).toEqual(new Set(["live-flash, row-mark"]));

    // The same document, and the browser asked the explorer's own Worker for the data and nobody else: its `.data` URL, for the page's route alone.
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
    const origin = new URL(page.url()).origin;
    expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
    const asked = requests.filter((url) => url.includes(".data"));
    expect(asked.length).toBeGreaterThanOrEqual(1);
    for (const url of asked) expect(url).toMatch(/\/xrpl\/network\.data\?.*_routes=routes%2Fnet\.network/);
  });

  test("moves nothing for a visitor who prefers reduced motion: the new chip has the quiet highlight and nothing slides", async ({ contextFor }) => {
    const context = await contextFor({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const { chips } = await openBehind(page, NINETY);
    await watch(page);

    await fixtures.reset();

    await expect(chips.first()).toContainText(`#${count(HEAD)}`, { timeout: 20_000 });
    const seen = await seenBy(page);
    expect(seen.entering).toContain(String(HEAD));
    // No transform on any chip, and the new one does not slide in; its link keeps the colours, a wash and a mark fading out, once.
    expect(seen.moved).toEqual([]);
    expect(new Set(seen.chipAnimations)).toEqual(new Set(["none"]));
    expect(new Set(seen.linkAnimations)).toEqual(new Set(["live-flash, row-mark"]));
    expect(await chips.nth(1).evaluate((chip) => getComputedStyle(chip).transitionDuration)).toBe("0s");
  });

  test("animates nothing when the page is first opened", async ({ page }) => {
    await openBehind(page, NINETY);
    await expect(page.locator(".is-entering, .is-changed")).toHaveCount(0);
    expect(await page.locator("[data-key]").evaluateAll((items) => items.filter((item) => (item as HTMLElement).style.transform !== "").length)).toBe(0);
  });

  test("has a button that pauses and resumes the updates, says what it did, keeps the choice for the tab, and asks again when resumed", async ({ page }) => {
    const { chips } = await openBehind(page, NINETY);
    const pause = page.getByRole("button", { name: "Pause live updates" });
    // Its label says what it will do; it is not also a pressed toggle.
    expect(await pause.getAttribute("aria-pressed")).toBeNull();
    // A target of 44 px, as the stylesheet says.
    expect((await pause.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(statusOf(page)).toHaveText("");

    await pause.click();
    const resume = page.getByRole("button", { name: "Resume live updates" });
    await expect(resume).toHaveClass(/is-paused/);
    expect(await resume.getAttribute("aria-pressed")).toBeNull();
    await expect(statusOf(page)).toHaveText("Live updates paused");
    await expect(page.locator(".hero__dot")).toHaveClass(/is-paused/);

    // The choice is the tab's, and it is the home page's too: one key.
    await page.reload();
    await hydrated(page);
    await expect(page.getByRole("button", { name: "Resume live updates" })).toHaveClass(/is-paused/);
    await expect(statusOf(page)).toHaveText("");

    // The chain moves on while the page is paused; resuming asks at once.
    await fixtures.reset();
    await page.getByRole("button", { name: "Resume live updates" }).click();
    await expect(statusOf(page)).toHaveText("Live updates resumed");
    await expect(page.getByRole("button", { name: "Pause live updates" })).not.toHaveClass(/is-paused/);
    await expect(page.locator(".hero__dot")).not.toHaveClass(/is-paused/);
    await expect(chips.first()).toContainText(`#${count(HEAD)}`, { timeout: 20_000 });
  });

  test("holds the updates while the mouse is over the ledgers, and says so", async ({ page }) => {
    await openBehind(page, NINETY);
    const HELD = "Paused while you look at the ledgers";
    await expect(page.getByText(HELD)).toHaveCount(0);

    await page.locator(".network__chips").hover();
    await expect(page.getByText(HELD)).toBeVisible();
    // In the row, in visible text, and not in the status line, which a screen reader announces.
    await expect(statusOf(page)).toHaveText("");

    await page.mouse.move(2, 2);
    await expect(page.getByText(HELD)).toHaveCount(0);
  });
});

test.describe("when the Worker cannot give the page new data", () => {
  // The browser logs each 503 it is given as an error.
  test.use({ allowConsoleErrors: true });

  test("keeps the page as it was, says that the updates are paused after two refusals, and goes on with the new data when the Worker answers again", async ({ page }) => {
    const { chips } = await openBehind(page, NINETY);
    let refused = 0;
    await page.route(/\/xrpl\/network\.data\?/, (route) => {
      refused += 1;
      return route.fulfill({ status: 503, contentType: "text/plain", body: "busy" });
    });

    await fixtures.reset();

    // Two refusals, the second 8 s after the first (the pace halves with each failure in a row): then the page says so, quietly, in text.
    await expect(statusOf(page)).toHaveText("Live updates paused, retrying…", { timeout: 30_000 });
    expect(refused).toBeGreaterThanOrEqual(2);
    // And it is the page it was: no error screen, the ledgers and the cards it had.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("XRPL network");
    await expect(chips.first()).toContainText(`#${count(BEFORE_HEAD)}`);
    await expect(typesCard(page).locator(".col")).toHaveCount(90);
    await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toHaveCount(0);

    await page.unroute(/\/xrpl\/network\.data\?/);
    await expect(chips.first()).toContainText(`#${count(HEAD)}`, { timeout: 40_000 });
    await expect(statusOf(page)).toHaveText("Live updates reconnected");
    // Back to nothing to say.
    await expect(statusOf(page)).toHaveText("", { timeout: 10_000 });
  });
});

test.describe("when the day turns under an open page", () => {
  test("every part of the next answers failed, and the page keeps the AMM line and every card it had", async ({ page }) => {
    await page.goto(NINETY);
    await hydrated(page);
    const volume = volumeCard(page);
    const filters = page.getByRole("group", { name: "Filters" });
    await expect(volume.locator('path.line[data-slot="3"]')).toHaveCount(1);
    await expect(typesCard(page).locator(".col")).toHaveCount(90);
    await expect(filters).toContainText("to Oct 17, 2026");

    // The chain crosses midnight: the newest ledger closed at 00:00:05 on Oct 18, so the index day is Oct 18 and every call over a period of that
    // day is one the fixture server has no answer for. The window's own words are not a part that can fail (they come from the anchor), so the
    // page saying "to Oct 18" is the proof that a beat of the new day was taken, with each part of it failed.
    await fixtures.override(xrplNextDay());
    await expect(filters).toContainText("to Oct 18, 2026", { timeout: 30_000 });

    // Two beats more, and it is still the page it was.
    for (let beat = 0; beat < 2; beat += 1) {
      await page.waitForResponse((response) => /\/xrpl\/network\.data\?/.test(response.url()), { timeout: 20_000 });
    }
    await expect(volume.locator('path.line[data-slot="3"]')).toHaveCount(1);
    await expect(volume.getByRole("list", { name: "Legend" }).getByRole("listitem")).toHaveCount(3);
    await expect(typesCard(page).locator(".col")).toHaveCount(90);
    await expect(page.locator('section[aria-labelledby="network-fees-title"] path.line')).toHaveCount(1);
    await expect(page.locator('section[aria-labelledby="network-currencies-title"] .barlist')).toBeVisible();
    await expect(page.locator(".network__validators .network__count")).not.toHaveText("");
    await expect(page.locator(".network__open")).toContainText("Open ledger fee");
    // No card says it could not be loaded, and nothing is an alert.
    await expect(page.getByText(/Couldn’t load|couldn’t be loaded/)).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    // The answers were pages, not failures: the line of the live updates has nothing to say.
    await expect(statusOf(page)).toHaveText("");
  });
});
