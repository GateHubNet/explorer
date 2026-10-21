import type { Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { fixtures, unavailable } from "./fixture-control";
import { LIVE, XRP_RLUSD_POOL } from "./fixtures";
import { expect, hydrated, seriousViolations, test } from "./support";

// The AMM pool page with a card that failed (README "AMM pools"): the pool's day rows (#4) answer 503, and the four charts that read them say so in their
// place, with a Retry, while the rest of the page stands; once the fixture server answers again, Retry brings them back. These tests change what the
// fixture server answers, and every page the Worker renders meanwhile would show it: they are in the `live` project (playwright.config.ts,
// `*-live.spec.ts`), which runs alone after the others, one test at a time.
//
// The view is XRP/RLUSD's 30 days, which no other spec opens: the Worker keeps a pool's day rows 300 s (`PERIOD_CALL_TTL_SECONDS`), so the day rows of a
// view the `chromium` project opened (the 90 days, the year) would still be kept, and the page would show them and not the failure.

test.skip(LIVE, "changes what the fixture server answers: it needs the fixture server of the stack, not a real stack or a deployed Worker");
test.skip(featuresOff(process.env).has("AMM_PAGES"), "AMM_PAGES is off in the Worker under test: the AMM pages are not found");

const VIEW = `/xrpl/amm/${XRP_RLUSD_POOL}?period=30d`;

/** #4 of the 30 days: the pool's day rows of the window (W₀ = Sep 18 to T = Oct 17, 2026), the call the four charts of the day rows read. */
const DAYS_30 = `GET /v2/amm/pools/${XRP_RLUSD_POOL}/history?end=2026-10-17&interval=day&limit=1000&start=2026-09-18`;

/** What each of the four cards that read the day rows says when they failed, and the volume card's note: it is drawn from the candles, without its fees. */
const FAILED = ["Couldn’t load the pool value.", "Couldn’t load the pool price.", "Couldn’t load the trading fee.", "Couldn’t load the reserves."];
const NO_FEES = "The fee estimates couldn't be loaded.";

const card = (page: Page, id: string) => page.locator(`section[aria-labelledby="${id}-title"]`);

test.afterEach(async () => {
  await fixtures.reset();
});

/** Opens the view with the day rows failing: the override in, and the page asked for until the Worker renders what the fixture server says now. */
async function openFailing(page: Page): Promise<void> {
  await fixtures.override({ [DAYS_30]: unavailable() });
  // The server's HTML has a comment between a text and the value written into it ("Couldn’t load <!-- -->the pool value"): it is taken out.
  await expect.poll(async () => (await (await page.request.get(VIEW)).text()).replaceAll("<!-- -->", ""), { timeout: 15_000 }).toContain("Couldn’t load the pool value.");
  await page.goto(VIEW);
  await hydrated(page);
  await expect(page.getByRole("table", { name: "Swaps" })).toBeVisible();
}

/** The four cards' errors, each in its card with its title and source line kept, the volume card drawn without its fees, and the rest of the page there. */
async function expectFailedCards(page: Page): Promise<void> {
  const ids = ["pool-value", "pool-price", "pool-fee", "pool-reserves"];
  for (const [at, id] of ids.entries()) {
    await expect(card(page, id).getByRole("alert")).toHaveText(new RegExp(`^${FAILED[at]}\\s*Retry$`));
    await expect(card(page, id).locator(".chart__source")).toHaveText(`/v2/amm/pools/rhWTXC…tcS3/history?interval=day`);
  }
  await expect(page.getByRole("alert")).toHaveCount(4);
  const volume = card(page, "pool-volume");
  await expect(volume.locator(".col")).toHaveCount(30);
  await expect(volume).toContainText(NO_FEES);
  // The rest of the page is the node's, the other calls' and the tab's.
  await expect(page.getByRole("region", { name: "Pool state" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fee votes" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("XRP / RLUSD pool");
}

// In the two system themes (a11y.spec.ts's matrix for a page with a card that failed), at both of its widths.
for (const viewport of [
  { name: "desktop", size: { width: 1280, height: 800 } },
  { name: "375 px", size: { width: 375, height: 812 } },
]) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`when the pool's day rows cannot be loaded, at ${viewport.name}, in ${scheme}`, () => {
      test.use({ viewport: viewport.size, colorScheme: scheme });

      test("the four charts of the day rows say so in their place, the rest of the page stands, and it has no serious or critical violation", async ({ page }) => {
        await openFailing(page);
        await expectFailedCards(page);
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).colorScheme)).toBe(scheme);
        expect(await seriousViolations(page)).toEqual([]);
      });
    });
  }
}

test.describe("when the day rows answer again", () => {
  test("Retry brings the four charts back, and the volume card's fees, in the same document", async ({ page }) => {
    await openFailing(page);
    await expectFailedCards(page);
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));
    const asked: string[] = [];
    page.on("request", (request) => asked.push(request.url()));

    await fixtures.reset();
    await card(page, "pool-value").getByRole("button", { name: "Retry" }).click();

    await expect(page.getByRole("alert")).toHaveCount(0);
    for (const id of ["pool-value", "pool-price", "pool-fee", "pool-reserves"]) await expect(card(page, id).getByRole("slider").first()).toBeAttached();
    await expect(card(page, "pool-value").locator(".plot").first()).toBeVisible();
    await expect(card(page, "pool-volume")).not.toContainText(NO_FEES);
    // The fees are the volume card's extras again: they are in what its slider says.
    await expect(card(page, "pool-volume").getByRole("slider")).toHaveAttribute("aria-valuetext", /Fees, est\., XRP /);
    // Retry asked the explorer's own Worker for the route's data, and nobody else.
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
    const origin = new URL(page.url()).origin;
    expect(asked.filter((url) => !url.startsWith(origin))).toEqual([]);
    expect(asked.filter((url) => url.includes(".data")).length).toBeGreaterThan(0);
  });
});
