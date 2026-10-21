import type { Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { fixtures, unavailable } from "./fixture-control";
import { LIVE, XAHAU_ACCOUNT } from "./fixtures";
import { expect, hydrated, test } from "./support";

// A card of the account's analytics view whose call fails (README "Account analytics"): the fixture server answers 503 for it, and every page the
// Worker renders meanwhile would show it, so this is a test of the `live` project (playwright.config.ts, `*-live.spec.ts`), which runs alone after
// the others, one test at a time.
//
// The Worker keeps an analytics call's answer for 60 s (class `minute`), so the view is one no other spec opens: the Xahau active account over the
// year. (The other specs open the XRPL accounts' views and Xahau's default one; a11y.spec.ts fails a call of Xahau's 90 days.)

test.skip(LIVE, "changes what the fixture server answers: it needs the fixture server of the stack, not a real stack or a deployed Worker");
test.skip(featuresOff(process.env).has("ACCOUNT_ANALYTICS"), "ACCOUNT_ANALYTICS is off in the Worker under test");

const VIEW = `/xahau/account/${XAHAU_ACCOUNT}?tab=analytics&period=1y`;
/** Call 2 of that view, as the fixture server names it: the Xahau data API's, the query sorted by name, `start` the Monday 51 weeks before T's. */
const SENT = `xahau GET /v2/accounts/${XAHAU_ACCOUNT}/stats/transactions?interval=week&limit=1000&start=2025-10-20`;

test.afterEach(async () => {
  await fixtures.reset();
});

const chart = (page: Page, id: string) => page.locator(`section[aria-labelledby="${id}-title"]`);
const sentTile = (page: Page) =>
  page.getByRole("region", { name: "Summary" }).locator(".stat").filter({ has: page.locator(".stat__label", { hasText: "Transactions sent" }) });

test("a card whose call fails says so in its place, and Retry brings it back once the call answers and its hold is over", async ({ page }) => {
  // The hold (5 s) and the Retries after it are longer than the default waits.
  test.slow();
  await fixtures.override({ [SENT]: unavailable() });
  await page.goto(VIEW);
  await hydrated(page);

  const card = chart(page, "analytics-sent");
  await expect(card.getByRole("alert")).toContainText("Couldn’t load the transactions sent.");
  await expect(card.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  // The card keeps its title and its source, with no chart, no table and no toggle; its tile says it too.
  await expect(card.getByRole("heading", { name: "Transactions sent per week, by type" })).toBeVisible();
  await expect(card.locator(".chart__source")).toHaveText("/v2/accounts/{a}/stats/transactions?interval=week");
  await expect(card.locator(".col")).toHaveCount(0);
  await expect(card.getByRole("radio")).toHaveCount(0);
  await expect(sentTile(page).locator(".stat__value")).toHaveText("—");
  await expect(sentTile(page).locator(".stat__sub")).toHaveText("Couldn’t load");
  // The rest of the view stands on its own: the other cards are drawn, and this is the one error.
  await expect(chart(page, "analytics-value").locator("path.line")).toHaveCount(1);
  await expect(chart(page, "analytics-money").locator(".col")).toHaveCount(52);
  await expect(page.getByRole("alert")).toHaveCount(1);

  await fixtures.reset();

  // The Worker holds the failure for 5 s (`holdFailure`): a Retry within the hold is given it again, and the first after it asks the data API, which
  // answers now. Retry, as a visitor would, until the card is back; each press is a render of the view's own `.data` URL.
  await expect(async () => {
    const retry = card.getByRole("button", { name: "Retry", exact: true });
    if ((await retry.count()) > 0) await retry.click();
    await expect(card.locator(".col")).toHaveCount(52, { timeout: 1_500 });
  }).toPass({ timeout: 25_000, intervals: [500] });
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(card.getByRole("radio", { name: "Chart" })).toBeChecked();
  await expect(sentTile(page).locator(".stat__value")).toHaveText(/^\d[\d,]*$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
