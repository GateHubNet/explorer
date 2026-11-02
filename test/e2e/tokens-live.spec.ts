import type { Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { fixtures, unavailable } from "./fixture-control";
import { LIVE } from "./fixtures";
import { expect, freshHtml, hydrated, seriousViolations, test } from "./support";
import { listOf, tokenCase } from "./token-pages";

// What of the token pages needs the fixture server to change an answer (README "Tokens", "End-to-end tests"): a card whose call fails and its Retry. These tests change what the fixture
// server answers, and every page the Worker renders meanwhile would show it: they are in the `live` project (playwright.config.ts, `*-live.spec.ts`), which runs alone after the others, one
// test at a time. The token is one no other spec opens the page of (Xahau's token that is not listed: tokens.spec.ts opens its holders page, whose call is another key), so what the Worker kept
// from an earlier test cannot hide the override: a token's holders are kept a minute, and the page of a token 5 s.

test.skip(LIVE, "changes what the fixture server answers: it needs the fixture server of the stack, not a real stack or a deployed Worker");
test.skip(featuresOff(process.env).has("TOKENS"), "TOKENS is off in the Worker under test: the token pages are not found");

test.afterEach(async () => {
  await fixtures.reset();
});

const VIEWPORTS = [
  { name: "desktop", size: { width: 1280, height: 800 } },
  { name: "375 px", size: { width: 375, height: 812 } },
] as const;

/** How far the page scrolls sideways: none, at any width (the tables scroll inside their cards). */
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const NOD = tokenCase("xahau", "xahau-unlisted");
const PAGE = `/xahau/token/${NOD.path}`;
/** The token page's second call: its ten top holders (README "Tokens", the calls). The network's prefix is how an override names a call of Xahau's data API. */
const HOLDERS = `xahau GET /v2/tokens/${NOD.currency}.${NOD.issuer}/holders?limit=10`;
const FAILED = "Couldn’t load the top holders.";

const tableOf = (page: Page, name: string) => page.getByRole("table", { name, exact: true });
/** The holders card of the page: the section named by its title. */
const holdersCard = (page: Page) => page.getByRole("region", { name: "Top holders", exact: true });

/** The page with its holders call failed: asked for until it says so (a call kept from before the override runs out first), then opened. */
async function openFailing(page: Page): Promise<void> {
  await fixtures.override({ [HOLDERS]: unavailable() });
  await expect
    .poll(async () => ((await (await page.request.get(PAGE)).text()).replaceAll("<!-- -->", "")).includes(FAILED), { timeout: 15_000 })
    .toBe(true);
  await page.goto(PAGE);
  await hydrated(page);
  await expect(holdersCard(page).getByRole("alert")).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`when the holders cannot be loaded, at ${viewport.name}, in ${scheme}`, () => {
      test.use({ viewport: viewport.size, colorScheme: scheme });

      test("the card says so in its place with a Retry, the rest of the page stands, and it has no serious or critical violation and no sideways scroll", async ({ page }) => {
        await openFailing(page);
        // The card keeps its title and its place, and says what failed; the other cards are the page's own.
        await expect(holdersCard(page).getByRole("heading", { name: "Top holders" })).toBeVisible();
        await expect(holdersCard(page).getByRole("alert")).toContainText(FAILED);
        await expect(holdersCard(page).getByRole("button", { name: "Retry" })).toBeVisible();
        await expect(tableOf(page, "Top holders")).toHaveCount(0);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(tableOf(page, "Markets")).toBeVisible();
        await expect(tableOf(page, "Recent transfers")).toBeVisible();
        // It is the only alert: a failed card does not fail the page.
        await expect(page.getByRole("alert")).toHaveCount(1);
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).colorScheme)).toBe(scheme);
        expect(await seriousViolations(page)).toEqual([]);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });
    });
  }
}

test.describe("when the holders call fails", () => {
  test("the page is served and not stored: a second look is a miss, not a copy of the failure", async ({ page }) => {
    await fixtures.override({ [HOLDERS]: unavailable() });
    await expect
      .poll(async () => (await (await page.request.get(PAGE)).text()).replaceAll("<!-- -->", "").includes(FAILED), { timeout: 15_000 })
      .toBe(true);
    const again = await page.request.get(PAGE);
    expect(again.status()).toBe(200);
    expect(again.headers()["cache-control"]).toContain("no-store");
    expect(again.headers()["x-cache"]).toBe("MISS");
  });
});

test.describe("when the call answers again", () => {
  // The failure of a call is held for a few seconds (E2's hold), and the page's own copy is kept 5 s; so the page is asked for, fresh, until no card says it failed (which also keeps the
  // answers Retry reads), and only then is Retry pressed.
  test("Retry brings the holders back, in the same document", async ({ page }) => {
    await openFailing(page);
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));

    await fixtures.reset();
    await expect
      .poll(
        async () => {
          const html = (await freshHtml(page, PAGE))?.replaceAll("<!-- -->", "");
          return html !== undefined && !html.includes(FAILED);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await holdersCard(page).getByRole("button", { name: "Retry" }).click();

    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(tableOf(page, "Top holders")).toBeVisible();
    await expect(tableOf(page, "Top holders").locator('[role="row"]:not(.table__head)')).toHaveCount(10);
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true)).toBe(true);
  });
});

// The list with names no fixture has: a toml name is the issuer's text, as long as the issuer likes, and its ellipsis must keep it inside its cell (final review I1: a rule of the table's
// links made the link a box that sizes to its content, and a long name was drawn over the Issuer column). The search is one no other spec makes, so nothing the Worker kept for the
// list can hide the override; the rows are the fixtures' own for USD, with long names on the first three.
const LONG_SEARCH = "LONGNAMES";
const LONG_NAMES = [36, 40, 95].map((length) => "Reserve Notes of the Example Issuer ".repeat(4).slice(0, length).trim());
const LONG_LIST = `GET /v2/tokens?kind=issued&limit=20&min_holders=10&q=${LONG_SEARCH}`;

for (const viewport of VIEWPORTS) {
  test.describe(`when a toml name is very long, at ${viewport.name}`, () => {
    test.use({ viewport: viewport.size });

    test("the name is cut by its ellipsis inside the Token cell, short of the issuer's column, and the page has no sideways scroll", async ({ page }) => {
      const base = listOf("xrpl", { q: "USD" });
      const tokens = base.tokens.map((token, i) => (i < LONG_NAMES.length ? { ...token, name: LONG_NAMES[i] } : token));
      await fixtures.override({ [LONG_LIST]: { ...base, tokens } });
      await page.goto(`/xrpl/tokens?q=${LONG_SEARCH}`);
      await hydrated(page);
      const names = page.locator(".tokens__name");
      await expect(names).toHaveCount(tokens.filter((token) => token.name !== undefined).length);
      const drawn = await names.evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.textContent ?? "",
          right: element.getBoundingClientRect().right,
          cellRight: element.closest('[role="cell"]')!.getBoundingClientRect().right,
          clipped: element.scrollWidth > element.clientWidth,
        })),
      );
      for (const name of LONG_NAMES) {
        const one = drawn.find((entry) => entry.text === name);
        expect(one, name).toBeDefined();
        // Inside its cell (half a pixel for the rounding), and cut: the text is wider than the box that shows it.
        expect(one!.right, `the right edge of "${name}" against its cell's`).toBeLessThanOrEqual(one!.cellRight + 0.5);
        expect(one!.clipped, `"${name}" is cut`).toBe(true);
      }
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  });
}
