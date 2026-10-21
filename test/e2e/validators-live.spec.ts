import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { fixtures, HEAD, unavailable } from "./fixture-control";
import { LIVE } from "./fixtures";
import { expect, hydrated, seriousViolations, test } from "./support";
import { listedValidator, rowsOf, SKIP_OFF, VALIDATORS_OFF } from "./validators-pages";

// The validators pages follow the chain (spec 2.3) and keep what they show through the beats that fail. These tests change what the fixture server
// answers, and every page the Worker renders meanwhile would show it: they are the `live` project's (playwright.config.ts, `*-live.spec.ts`), which
// runs alone after the others, one test at a time.
//
// The Worker keeps the amendments (A, class `minute`) for 60 s, and a list that loaded them is kept at the edge for 5 s and served stale for 30 more.
// So the test that fails A before the list loads is the first here (no test of this project has asked for A before it), and waits until a render
// has none; the one that fails A under an open list waits until both have run out. The validator page's validations (VV) are kept 2 s, and its page
// 1 s + 2 s: the chain moves under it within a beat or two.

test.skip(LIVE, "changes what the fixture server answers: it needs the fixture server of the stack, not a real stack or a deployed Worker");
test.skip(VALIDATORS_OFF, SKIP_OFF);

// The keys of the data API's calls, as the fixture server names them.
const AMENDMENTS = "GET /v2/network/amendments";
const validationsKey = (key: string) => `GET /v2/network/validators/${key}/validations?limit=20`;

// The inner waits are several beats long (4 s on a validator's page, 10 s on the list), and with the failure test's backoff much longer than the default.
test.beforeEach(() => {
  test.slow();
});

test.afterEach(async () => {
  await fixtures.reset();
});

const statusOf = (page: Page) => page.locator('.hero__live[role="status"]');
const votesYesFor = (page: Page) => page.getByLabel("Votes yes for");
/** The `.data` answers of a page, whatever view: the beats of the list are `/xrpl/validators.data?…`. */
const isListData = (url: string) => new URL(url).pathname === "/xrpl/validators.data";

/**
 * The ledger a page's data was built from (its `anchor`), as the HTML carries it. A page opened while the Worker still keeps the chain of the spec
 * before (network-live.spec.ts moves it a day on, and the Worker keeps `last_validated` 2 s) would draw no beat after: an answer of an older ledger is
 * refused. So a test waits for the recordings' newest (`HEAD`) before it opens one.
 */
const anchorOf = (html: string): number | null => {
  const found = /\\?"lastValidated\\?",(\d+)/.exec(html);
  return found ? Number(found[1]) : null;
};

// ---- The list without its amendments -----------------------------------------------------------------------------------------------------------

test.describe("the validators list without the amendments", () => {
  const VIEW = "/xrpl/validators?scope=all";

  test("has no 'Votes yes for' while they cannot be loaded, and gets it by itself once they can (the hold, then a beat)", async ({ page }) => {
    test.setTimeout(150_000);
    await fixtures.override({ [AMENDMENTS]: unavailable() });
    // What the Worker kept of them (60 s) and a stored copy of the list (5 + 30 s) may still be served: ask until a render has no amendments, and
    // is of the recordings' newest ledger.
    const rendered = async () => {
      const html = await (await page.request.get(VIEW)).text();
      return { votesYesFor: html.includes("Votes yes for"), anchor: anchorOf(html) };
    };
    await expect.poll(rendered, { timeout: 100_000, intervals: [1_000, 2_000, 5_000] }).toEqual({ votesYesFor: false, anchor: HEAD });
    await page.goto(VIEW);
    await hydrated(page);
    await expect(votesYesFor(page)).toHaveCount(0);
    // The rest of the page is the page: the table, the search and "Listed by", and no card says it failed (the filter is all A feeds).
    await expect(rowsOf(page.getByRole("table", { name: "Validators" })).first()).toBeVisible();
    await expect(page.getByLabel("Listed by")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    await fixtures.reset();
    // The failure is held 5 s, and the list asks every 10 s.
    await expect(votesYesFor(page)).toBeVisible({ timeout: 30_000 });
    expect(await votesYesFor(page).locator("option").count()).toBeGreaterThan(1);
    await expect(statusOf(page)).toHaveText("");
  });

  test("keeps 'Votes yes for' through a beat whose amendments failed", async ({ page }) => {
    // The amendments the Worker has were loaded by the test before: a beat fails once they and the stored list have run out (60 s, then 35 s).
    test.setTimeout(240_000);
    await page.goto(VIEW);
    await hydrated(page);
    await expect(votesYesFor(page)).toBeVisible();
    const options = await votesYesFor(page).locator("option").allTextContents();

    await fixtures.override({ [AMENDMENTS]: unavailable() });
    // A degraded answer (a part failed) is `no-store`; the next beat after it shows that the page has taken it in.
    const degraded = (url: string, headers: Record<string, string>) => isListData(url) && /no-store/.test(headers["cache-control"] ?? "");
    await page.waitForResponse((response) => degraded(response.url(), response.headers()), { timeout: 200_000 });
    await page.waitForResponse((response) => degraded(response.url(), response.headers()), { timeout: 30_000 });

    await expect(votesYesFor(page)).toBeVisible();
    expect(await votesYesFor(page).locator("option").allTextContents()).toEqual(options);
    await expect(page.getByRole("alert")).toHaveCount(0);
    // A degraded page is an answer, not a failure: the live line has nothing to say.
    await expect(statusOf(page)).toHaveText("");
  });
});

// ---- A validator's page follows the chain -------------------------------------------------------------------------------------------------------

/** The validator's newest validations as the fixtures hold them. */
interface Validations {
  count: number;
  validations: Array<{ ledger_index: number; ledger_hash: string }>;
  [field: string]: unknown;
}

const recordedValidations = (key: string): Validations =>
  JSON.parse(readFileSync(new URL(`../fixtures/http/xrpl/data-api/network/validators/${key}/validations@limit=20.json`, import.meta.url), "utf8")) as Validations;

/** The `data-key` of a row of the recent validations: its ledger and its hash. */
const rowKey = (validation: Validations["validations"][number]) => `${validation.ledger_index}:${validation.ledger_hash}`;

/**
 * Opens a validator's page with its newest validation held back (the fixture server answers VV without its first row), and gives what to look at.
 * `fixtures.reset()` then lets the row in, as the next ledger would.
 */
async function openBehind(page: Page) {
  const { key } = await listedValidator(page, "verified");
  const recorded = recordedValidations(key);
  const [newest, before] = recorded.validations;
  await fixtures.override({ [validationsKey(key)]: { ...recorded, count: recorded.count - 1, validations: recorded.validations.slice(1) } });
  const path = `/xrpl/validators/${key}`;
  // VV is kept 2 s and the page 1 s + 2 s: ask until the page says what the fixture server says now, at the recordings' newest ledger.
  const rendered = async () => {
    const html = await (await page.request.get(path)).text();
    return { newest: html.includes(`data-key="${rowKey(newest!)}"`), anchor: anchorOf(html) };
  };
  await expect.poll(rendered, { timeout: 15_000 }).toEqual({ newest: false, anchor: HEAD });
  await page.goto(path);
  await hydrated(page);
  const rows = rowsOf(page.getByRole("table", { name: "Recent validations" }));
  await expect(rows.first()).toHaveAttribute("data-key", rowKey(before!));
  return { key, path, rows, newest: rowKey(newest!), before: rowKey(before!) };
}

/** What the page did to its rows since `watch` was called, written down by a MutationObserver of the page itself. */
interface Seen {
  entering: string[];
  moved: string[];
  /** The `animation-name` of each row at the moment it was added: the next beat renders the page again and must not be a race. */
  rowAnimations: string[];
}

async function watch(page: Page) {
  await page.evaluate(() => {
    const seen = { entering: [] as string[], moved: [] as string[], rowAnimations: [] as string[] };
    Object.assign(window, { seen, sameDocument: true });
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement && node.classList.contains("is-entering") && node.dataset.key) {
              seen.entering.push(node.dataset.key);
              seen.rowAnimations.push(getComputedStyle(node).animationName);
            }
          }
        } else if (record.target instanceof HTMLElement && record.target.dataset.key && record.target.style.transform) {
          seen.moved.push(record.target.dataset.key);
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
  });
}

const seenBy = (page: Page) => page.evaluate(() => (window as unknown as { seen: Seen }).seen);

test.describe("a validator's page follows the chain", () => {
  test("shows a new validation without a reload: its row enters, the rows that were there slide, and the route's .data is all it asks for", async ({ page }) => {
    const { key, rows, newest, before } = await openBehind(page);
    await watch(page);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await fixtures.reset();

    // Within a beat or two of 4 s, and the stored copies of 1 to 3 s.
    await expect(rows.first()).toHaveAttribute("data-key", newest, { timeout: 20_000 });
    await expect(rows.nth(1)).toHaveAttribute("data-key", before);
    const seen = await seenBy(page);
    expect(seen.entering).toContain(newest);
    expect(seen.entering).not.toContain(before);
    expect(new Set(seen.moved)).toContain(before);
    expect(seen.moved).not.toContain(newest);
    expect(new Set(seen.rowAnimations)).toEqual(new Set(["row-enter, live-flash, row-mark"]));

    // The same document, and the browser asked the explorer's own Worker for the data and nobody else: its `.data` URL, for the page's route alone.
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
    const origin = new URL(page.url()).origin;
    expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
    const asked = requests.filter((url) => url.includes(".data"));
    expect(asked.length).toBeGreaterThanOrEqual(1);
    for (const url of asked) expect(url).toMatch(new RegExp(`/xrpl/validators/${key}\\.data\\?.*_routes=routes%2Fnet\\.validators\\.%24key`));
  });

  test("moves nothing for a visitor who prefers reduced motion: the new row has the quiet highlight and nothing slides", async ({ contextFor }) => {
    const context = await contextFor({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const { rows, newest } = await openBehind(page);
    await watch(page);

    await fixtures.reset();

    await expect(rows.first()).toHaveAttribute("data-key", newest, { timeout: 20_000 });
    const seen = await seenBy(page);
    expect(seen.entering).toContain(newest);
    expect(seen.moved).toEqual([]);
    expect(new Set(seen.rowAnimations)).toEqual(new Set(["live-flash, row-mark"]));
    expect(await rows.nth(1).evaluate((row) => getComputedStyle(row).transitionDuration)).toBe("0s");
  });

  test("has a button that pauses and resumes the updates, keeps the choice for the tab, and asks again when resumed", async ({ page }) => {
    const { rows, newest } = await openBehind(page);
    const pause = page.getByRole("button", { name: "Pause live updates" });
    expect((await pause.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(statusOf(page)).toHaveText("");

    await pause.click();
    await expect(page.getByRole("button", { name: "Resume live updates" })).toHaveClass(/is-paused/);
    await expect(statusOf(page)).toHaveText("Live updates paused");
    await expect(page.locator(".hero__dot")).toHaveClass(/is-paused/);

    // The choice is the tab's, one key for every live page.
    await page.reload();
    await hydrated(page);
    await expect(page.getByRole("button", { name: "Resume live updates" })).toHaveClass(/is-paused/);

    // The chain moves on while the page is paused; resuming asks at once.
    await fixtures.reset();
    await page.getByRole("button", { name: "Resume live updates" }).click();
    await expect(statusOf(page)).toHaveText("Live updates resumed");
    await expect(page.locator(".hero__dot")).not.toHaveClass(/is-paused/);
    await expect(rows.first()).toHaveAttribute("data-key", newest, { timeout: 20_000 });
  });

  test("holds the updates while the mouse is over the validations, and says so in the row, not in the status line", async ({ page }) => {
    await openBehind(page);
    const HELD = "Paused while you look at the table";
    await expect(page.getByText(HELD)).toHaveCount(0);

    await page.getByRole("table", { name: "Recent validations" }).hover();
    await expect(page.getByText(HELD)).toBeVisible();
    await expect(page.locator(".hero__dot")).toHaveClass(/is-paused/);
    await expect(statusOf(page)).toHaveText("");

    await page.mouse.move(2, 2);
    await expect(page.getByText(HELD)).toHaveCount(0);
  });

  test.describe("when the Worker cannot give the page new data", () => {
    // The browser logs each 503 it is given as an error.
    test.use({ allowConsoleErrors: true });

    test("keeps the page, says the updates are paused after two refusals, and goes on when the Worker answers again", async ({ page }) => {
      const { key, rows, newest, before } = await openBehind(page);
      const data = new RegExp(`/xrpl/validators/${key}\\.data\\?`);
      let refused = 0;
      await page.route(data, (route) => {
        refused += 1;
        return route.fulfill({ status: 503, contentType: "text/plain", body: "busy" });
      });

      await fixtures.reset();

      // Two refusals, the second a doubled beat after the first: then the page says so, quietly, in text.
      await expect(statusOf(page)).toHaveText("Live updates paused, retrying…", { timeout: 30_000 });
      expect(refused).toBeGreaterThanOrEqual(2);
      await expect(page.locator(".validator__master")).toContainText(key);
      await expect(rows.first()).toHaveAttribute("data-key", before);
      await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toHaveCount(0);

      await page.unroute(data);
      await expect(rows.first()).toHaveAttribute("data-key", newest, { timeout: 40_000 });
      await expect(statusOf(page)).toHaveText("Live updates reconnected");
      await expect(statusOf(page)).toHaveText("", { timeout: 10_000 });
    });
  });
});

// ---- A card that failed, for axe -----------------------------------------------------------------------------------------------------------------
// a11y.spec.ts's matrix asks for a page with a card that failed: it fails a call of the fixture server, so it is here, where nothing else runs meanwhile.

test.describe("a validator's page with a card that failed", () => {
  const FAILED = "Couldn’t load the recent validations.";

  for (const viewport of [
    { name: "desktop", size: { width: 1280, height: 800 } },
    { name: "375 px", size: { width: 375, height: 812 } },
  ]) {
    for (const scheme of ["light", "dark"] as const) {
      test.describe(`${viewport.name}, ${scheme}`, () => {
        test.use({ viewport: viewport.size, colorScheme: scheme });

        test(`has no serious or critical violation${viewport.size.width === 375 ? ", and does not scroll sideways" : ""}`, async ({ page }) => {
          const { key } = await listedValidator(page, "verified");
          const path = `/xrpl/validators/${key}`;
          await fixtures.override({ [validationsKey(key)]: unavailable() });
          // VV is kept 2 s and the page 1 s + 2 s: ask until the page says it could not load them (a degraded page is never stored). React puts a
          // comment between the words of the message and what they name.
          const said = async () => (await (await page.request.get(path)).text()).replaceAll("<!-- -->", "");
          await expect.poll(said, { timeout: 15_000 }).toContain(FAILED);
          await page.goto(path);
          await hydrated(page);
          await expect(page.getByText(FAILED)).toBeVisible();
          await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
          await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).colorScheme)).toBe(scheme);

          expect(await seriousViolations(page)).toEqual([]);
          if (viewport.size.width === 375) {
            expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
          }
        });
      });
    }
  }
});
