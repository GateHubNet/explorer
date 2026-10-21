import type { Locator, Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { LIVE, NEVER_FUNDED, XRPL_ACCOUNT, XRPL_DELETED } from "./fixtures";
import { expect, hydrated, test } from "./support";

// The account's Analytics tab, `/{net}/account/{address}?tab=analytics[&period=90d|1y|all]` (README "Account analytics"), in a browser: the tab and
// the view it opens, the tiles and the seven cards drawn from the synthetic fixtures (README "Upstream fixtures"), the periods as URLs, the view
// without the bundle, the tooltip and the keys, the deleted and the never-funded account, and the off case. Nothing here changes what the fixture
// server answers: the failing card of account-analytics-live.spec.ts and of a11y.spec.ts are views no test here opens.

const OFF = featuresOff(process.env).has("ACCOUNT_ANALYTICS");
const SWITCHED_OFF = "ACCOUNT_ANALYTICS is off in the Worker under test: the off case is checked instead";
const SYNTHETIC = "reads the synthetic analytics files of the fixtures and the hand-written accounts: a real stack's account has its own figures and days";

const ACCOUNT = `/xrpl/account/${XRPL_ACCOUNT}`;
const VIEW = `${ACCOUNT}?tab=analytics`;

const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);

/** A chart card of the view, by the id of its title (the period changes the title, not the id). */
const chart = (page: Page, id: string) => page.locator(`section[aria-labelledby="${id}-title"]`);
/** A table card of the view, by its title: the card, not the scroll region of its table, which carries the title too. */
const tableCard = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true });
/** A tile of the summary, by its label. */
const tile = (page: Page, label: string) =>
  page.getByRole("region", { name: "Summary" }).locator(".stat").filter({ has: page.locator(".stat__label", { hasText: label }) });
/** The filter row under the tabs, and in it the period note: the view's one status. */
const filters = (page: Page) => page.getByRole("group", { name: "Analytics filters" });
const periodNote = (page: Page) => filters(page).getByRole("status");
/** The one error that stands for the whole view when its frame could not be had (spec 2.8), and the view's tiles otherwise: one or the other. */
const frameError = (page: Page) => page.locator('.analytics > [role="alert"]');
const summaryOrFrameError = (page: Page) => page.getByRole("region", { name: "Summary" }).or(frameError(page));

/** The seven cards (spec 1.5), in the order of the page: the four charts by their ids, the three tables by their titles at 30 days. */
const CHARTS = ["analytics-value", "analytics-sent", "analytics-balances", "analytics-money"] as const;
const TABLES = ["Where balance changes come from, last 30 days", "Top counterparties, by value", "DEX trading, per pair"] as const;
const TILES = ["Account value now", "Transactions sent", "Fees paid", "Counterparties"] as const;

/** Where the pointer is put to show a bucket: a fraction of the way across the plot, at its middle height (the cursor layer is over the whole plot). */
async function pointOver(page: Page, plot: Locator, fraction: number): Promise<void> {
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  if (!box) throw new Error("the plot has no box");
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
}

/** The first column's heading of a chart's table view, which names the bucket: "Day (UTC)", "Week of (UTC)", "Month (UTC)". */
const bucketHeading = (card: Locator) => card.locator(".chart__table [role=columnheader]").first();

test.describe("the tab", () => {
  test.skip(OFF, SWITCHED_OFF);

  test("is a nofollow link that opens the view in the same document, with the filter row and no holdings", async ({ page }) => {
    await page.goto(ACCOUNT);
    await hydrated(page);
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));
    const tabs = page.getByRole("navigation", { name: "Account activity" });
    const analytics = tabs.getByRole("link", { name: "Analytics" });
    await expect(analytics).toHaveAttribute("rel", "nofollow");
    await expect(analytics).toHaveAttribute("href", VIEW);

    await analytics.click();
    await page.waitForURL(`**${VIEW}`);
    await expect(analytics).toHaveAttribute("aria-current", "page");
    // The period's segmented links, each a view kept from crawlers, the default one current.
    const periods = filters(page).getByRole("group", { name: "Period" }).getByRole("link");
    await expect(periods).toHaveText(["30 days", "90 days", "1 year", "All"]);
    for (const link of await periods.all()) await expect(link).toHaveAttribute("rel", "nofollow");
    await expect(periods.first()).toHaveAttribute("aria-current", "true");
    // The view is there: its summary, or (on a stack whose frame failed) the one error that stands for it.
    await expect(summaryOrFrameError(page)).toBeVisible();
    // No Holdings margin on this view (spec 1.5).
    await expect(page.getByRole("heading", { name: "Tokens", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Owned objects", exact: true })).toHaveCount(0);
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe("the view", () => {
  test.skip(OFF, SWITCHED_OFF);

  // Everywhere, a real stack included: what each part is made of, never a figure.
  test("draws every tile and card as its data, its empty state or its error", async ({ page }) => {
    await page.goto(VIEW);
    await hydrated(page);
    await expect(summaryOrFrameError(page)).toBeVisible();
    if ((await frameError(page).count()) > 0) {
      // The frame could not be had: one error in place of the tiles and cards (spec 2.8), and the period note says nothing.
      await expect(frameError(page)).toContainText(/Couldn’t load the analytics\.|Still working on the analytics\./);
      await expect(periodNote(page)).toHaveText("");
      return;
    }
    await expect(periodNote(page)).toHaveText(/^.+ is counted up to now\./);
    for (const label of TILES) {
      const one = tile(page, label);
      await expect(one).not.toHaveAttribute("aria-busy", "true");
      await expect(one.locator(".stat__value")).not.toBeEmpty();
      await expect(one.locator(".stat__source")).toContainText("/v2/accounts/{a}/");
    }
    for (const id of CHARTS) {
      const card = chart(page, id);
      await expect(card).not.toHaveAttribute("aria-busy", "true");
      // The chart and its table (an empty state is drawn in the plot), or the card's error with its Retry.
      await expect(card.locator(".chart__view").or(card.getByRole("alert"))).toBeVisible();
    }
    for (const title of TABLES) {
      const card = tableCard(page, title);
      await expect(card.locator(".analytics__table-loading")).toHaveCount(0);
      await expect(card.getByRole("table", { name: title }).or(card.locator(".analytics__empty")).or(card.getByRole("alert"))).toBeVisible();
    }
  });

  test("has the four tiles and the seven cards of the fixtures", async ({ page }) => {
    test.skip(LIVE, SYNTHETIC);
    await page.goto(VIEW);
    await hydrated(page);
    await expect(periodNote(page)).toHaveText("The 30 days from Sep 18 to Oct 17, 2026 (UTC), per day. The last day is counted up to now.");

    // The tiles: the last day's value and its change over the window, the transactions sent and how many failed, the fees, the counterparties.
    await expect(page.getByRole("region", { name: "Summary" }).locator(".stat")).toHaveCount(4);
    await expect(tile(page, "Account value now").locator(".stat__value")).toHaveText("17.54 XRP");
    await expect(tile(page, "Account value now").locator(".stat__delta")).toHaveText("−12.4% over the last 30 days");
    await expect(tile(page, "Transactions sent").locator(".stat__value")).toHaveText("17");
    await expect(tile(page, "Transactions sent").locator(".stat__sub")).toHaveText("2 failed, fee still paid");
    await expect(tile(page, "Fees paid").locator(".stat__value")).toHaveText(/^\d[\d.,]* XRP$/);
    await expect(tile(page, "Fees paid").locator(".stat__sub")).toHaveText(/^\d[\d,]* drops, burned$/);
    await expect(tile(page, "Counterparties").locator(".stat__value")).toHaveText("2");
    await expect(tile(page, "Counterparties").locator(".stat__sub")).toHaveText("accounts it paid or was paid by");

    // The four charts, each with its plot and its table: a line of 30 days, the 30 stacked columns, a panel for each of the three lines, and the
    // 30 diverging columns.
    await expect(chart(page, "analytics-value").getByRole("heading", { name: "Account value, in XRP" })).toBeVisible();
    await expect(chart(page, "analytics-value").locator("path.line")).toHaveCount(1);
    const sent = chart(page, "analytics-sent");
    await expect(sent.getByRole("heading", { name: "Transactions sent per day, by type" })).toBeVisible();
    await expect(sent.locator(".col")).toHaveCount(30);
    await expect(sent.getByRole("list", { name: "Legend" })).toContainText("× has a failed transaction");
    const balances = chart(page, "analytics-balances");
    await expect(balances.getByRole("heading", { name: "Balance history, per currency" })).toBeVisible();
    await expect(balances.locator(".panel")).toHaveCount(3);
    const money = chart(page, "analytics-money");
    await expect(money.getByRole("heading", { name: "Money in and out per day, in XRP" })).toBeVisible();
    await expect(money.locator(".col")).toHaveCount(30);
    await expect(money.locator(".chart__summary")).toContainText(/^Received .+ · sent .+ · net .+ XRP$/);

    // The three tables: the seven named causes and the head, the two counterparties of the window, the three pairs.
    const sources = tableCard(page, "Where balance changes come from, last 30 days");
    await expect(sources.getByRole("table").getByRole("row")).toHaveCount(8);
    for (const cause of ["Fees", "DEX trades", "Payments in", "Payments out", "Passed through", "Escrow", "Payment channels"]) {
      await expect(sources.getByRole("row").filter({ has: page.getByText(cause, { exact: true }) })).toHaveCount(1);
    }
    const counterparties = tableCard(page, "Top counterparties, by value");
    await expect(counterparties.getByRole("table").getByRole("row")).toHaveCount(3);
    await expect(counterparties.getByRole("link", { name: /^rq5QXr/ })).toHaveAttribute("href", "/xrpl/account/rq5QXrArpavMCfE5dRuR3uG55iV1rG8mj");
    await expect(counterparties).toContainText("All 2 counterparties, largest first.");
    const pairs = tableCard(page, "DEX trading, per pair");
    await expect(pairs.getByRole("table").getByRole("row")).toHaveCount(4);
    await expect(pairs).toContainText("Bought and sold are of each pair's base as shown.");

    // No part failed or came too late.
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("is another URL for each period, keeps the scroll position, and Back restores each view", async ({ page }) => {
    test.skip(LIVE, SYNTHETIC);
    await page.goto(VIEW);
    await hydrated(page);
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));
    const sent = chart(page, "analytics-sent");
    const columns = sent.locator(".col");
    const periods = filters(page).getByRole("group", { name: "Period" });
    await expect(columns).toHaveCount(30);
    await expect(bucketHeading(sent)).toHaveText("Day (UTC)");

    // The window is moved down so that the period links are at its top: a change of period leaves it there (`preventScrollReset`).
    await periods.evaluate((group) => group.scrollIntoView({ block: "start" }));
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeGreaterThan(0);

    const steps = [
      { label: "90 days", query: "&period=90d", columns: 90, heading: "Day (UTC)", title: "Transactions sent per day, by type", last: "Oct 17" },
      { label: "1 year", query: "&period=1y", columns: 52, heading: "Week of (UTC)", title: "Transactions sent per week, by type", last: "Oct 12" },
      { label: "All", query: "&period=all", columns: 16, heading: "Month (UTC)", title: "Transactions sent per month, by type", last: "Oct 2026" },
    ];
    for (const step of steps) {
      await periods.getByRole("link", { name: step.label }).click();
      await page.waitForURL((url) => url.pathname === ACCOUNT && url.search === `?tab=analytics${step.query}`);
      await expect(periods.getByRole("link", { name: step.label })).toHaveAttribute("aria-current", "true");
      await expect(columns).toHaveCount(step.columns);
      await expect(sent.getByRole("heading", { name: step.title })).toBeVisible();
      // The buckets are named for their unit: on the axis (a week by its Monday, a month by its name) and in the table's first column.
      await expect(bucketHeading(sent)).toHaveText(step.heading);
      await expect(sent.locator(".plot__x--wide span").last()).toHaveText(step.last);
      expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    }
    await expect(periodNote(page)).toHaveText("Since Jul 2025, the month it was activated, per month (UTC). The last month is counted up to now.");

    // Back through the views, each as it was: the year in weeks, the 90 days, the default.
    await page.goBack();
    await page.waitForURL((url) => url.search === "?tab=analytics&period=1y");
    await expect(columns).toHaveCount(52);
    await expect(bucketHeading(sent)).toHaveText("Week of (UTC)");
    await expect(periodNote(page)).toHaveText(
      "The 52 weeks from Oct 20, 2025 to the week of Oct 12, 2026 (UTC, weeks from Monday), per week. The last week is counted up to now.",
    );
    await page.goBack();
    await page.waitForURL((url) => url.search === "?tab=analytics&period=90d");
    await expect(columns).toHaveCount(90);
    await expect(periodNote(page)).toHaveText("The 90 days from Jul 20 to Oct 17, 2026 (UTC), per day. The last day is counted up to now.");
    await page.goBack();
    await page.waitForURL((url) => url.search === "?tab=analytics");
    await expect(columns).toHaveCount(30);
    await expect(periods.getByRole("link", { name: "30 days" })).toHaveAttribute("aria-current", "true");
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe("without the bundle", () => {
  test.skip(OFF, SWITCHED_OFF);
  // The browser logs each script that was refused as an error.
  test.use({ allowConsoleErrors: true });

  test("the streamed cards are drawn, and checking Table shows a card's table instead of its chart", async ({ contextFor }) => {
    test.skip(LIVE, SYNTHETIC);
    const context = await contextFor();
    // No script of the build runs: React cannot hydrate anything, and the cards are in the page only because React's inline stream scripts put
    // each one in its place as it streamed in.
    await context.route("**/assets/*.js", (route) => route.abort());
    const page = await context.newPage();
    await page.goto(VIEW);

    await expect(periodNote(page)).toHaveText("The 30 days from Sep 18 to Oct 17, 2026 (UTC), per day. The last day is counted up to now.");
    await expect(tile(page, "Account value now").locator(".stat__value")).toHaveText("17.54 XRP");
    const sent = chart(page, "analytics-sent");
    await expect(sent.locator(".chart__view")).toBeVisible();
    await expect(sent.locator(".col")).toHaveCount(30);
    await expect(sent.locator(".chart__table")).toBeHidden();
    await expect(tableCard(page, "Top counterparties, by value").getByRole("table").getByRole("row")).toHaveCount(3);
    await expect(page.locator(".analytics [aria-busy]")).toHaveCount(0);

    await sent.getByRole("radio", { name: "Table" }).check();
    await expect(sent.locator(".chart__view")).toBeHidden();
    await expect(sent.locator(".chart__table")).toBeVisible();
    await expect(sent.locator(".chart__table").getByRole("row")).toHaveCount(31);
    // The other cards keep their charts; and nothing is scripted, so there is no slider.
    await expect(chart(page, "analytics-money").locator(".chart__view")).toBeVisible();
    await expect(page.getByRole("slider")).toHaveCount(0);
  });
});

test.describe("hover and keyboard", () => {
  test.skip(OFF, SWITCHED_OFF);
  test.skip(LIVE, SYNTHETIC);

  test("a pointer over the transactions sent shows a tooltip with the date, the total and the failed ones", async ({ page }) => {
    await page.goto(VIEW);
    await hydrated(page);
    const sent = chart(page, "analytics-sent");
    const plot = sent.locator(".plot");
    const tip = sent.locator(".plot__tip");
    await expect(plot.getByRole("slider")).toBeAttached();
    await expect(tip).toHaveCount(0);

    await pointOver(page, plot, 0.5);
    await expect(tip).toBeVisible();
    await expect(tip.locator(".plot__tip-date")).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, 2026$/);
    await expect(tip.locator(".plot__tip-total")).toHaveText(/^\d+ total$/);
    await expect(tip.locator(".plot__tip-row").filter({ hasText: "failed" })).toHaveText(/^\d+ failed$/);

    // The running day, the newest column: "so far".
    await pointOver(page, plot, 0.995);
    await expect(tip.locator(".plot__tip-date")).toHaveText("Oct 17, 2026, so far");

    await page.mouse.move(2, 2);
    await expect(tip).toHaveCount(0);
  });

  test("Tab to a slider and Arrow Left changes what it says", async ({ page }) => {
    await page.goto(VIEW);
    await hydrated(page);
    const sent = chart(page, "analytics-sent");
    const slider = sent.getByRole("slider");
    await expect(slider).toHaveAttribute("aria-label", "Transactions sent per day, by type, day by day");

    // The plot's scroll region is the stop before its slider.
    await sent.getByRole("region", { name: "Transactions sent per day, by type, scrollable chart" }).focus();
    await page.keyboard.press("Tab");
    await expect(slider).toBeFocused();
    // It starts on the newest bucket and reads its failed count after the groups.
    const newest = Number(await slider.getAttribute("aria-valuenow"));
    expect(newest).toBe(Number(await slider.getAttribute("aria-valuemax")));
    await expect(slider).toHaveAttribute("aria-valuetext", /^Oct 17, 2026, so far: .*; Failed \d+/);
    const said = await slider.getAttribute("aria-valuetext");

    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", String(newest - 1));
    await expect(slider).not.toHaveAttribute("aria-valuetext", said!);
    await expect(slider).toHaveAttribute("aria-valuetext", /^Oct 16, 2026: /);
    await expect(sent.locator(".plot__tip")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sent.locator(".plot__tip")).toHaveCount(0);
  });
});

test.describe("the accounts that are not active", () => {
  test.skip(OFF, SWITCHED_OFF);
  test.skip(LIVE, SYNTHETIC);

  test("a deleted account's value is a dash, and the period note says it was deleted", async ({ page }) => {
    await page.goto(`/xrpl/account/${XRPL_DELETED}?tab=analytics`);
    await hydrated(page);
    await expect(page.getByRole("main")).toContainText("Deleted");
    const value = tile(page, "Account value now");
    await expect(value.locator(".stat__value")).toHaveText("—");
    await expect(value.locator(".stat__sub")).toHaveText("Deleted accounts hold nothing");
    await expect(periodNote(page)).toContainText("This account was deleted; All covers its whole history.");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("an address never activated is the 404 page, with no analytics", async ({ page }) => {
    const response = await page.goto(`/xrpl/account/${NEVER_FUNDED}?tab=analytics`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("main")).toContainText("This address has never been activated");
    await expect(page.getByRole("group", { name: "Analytics filters" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Summary" })).toHaveCount(0);
  });
});

test.describe("with ACCOUNT_ANALYTICS off", () => {
  test.skip(!OFF, "ACCOUNT_ANALYTICS is on in the Worker under test: the view is checked above");

  test("the tab is the 'soon' label, and every analytics URL is redirected to the account page", async ({ page }) => {
    // A 302 of the Worker's: the document that comes is the account page's.
    for (const query of ["?tab=analytics", "?tab=analytics&period=1y"]) {
      await page.goto(`${ACCOUNT}${query}`);
      await expect(page).toHaveURL((url) => url.pathname === ACCOUNT && url.search === "");
    }
    await hydrated(page);
    const tabs = page.getByRole("navigation", { name: "Account activity" });
    await expect(tabs.getByRole("link", { name: /Analytics/ })).toHaveCount(0);
    await expect(tabs).toContainText("Analyticssoon");
    await expect(page.getByRole("group", { name: "Analytics filters" })).toHaveCount(0);
  });
});
