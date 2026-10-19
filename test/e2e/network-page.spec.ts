import type { Locator, Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { LIVE } from "./fixtures";
import { expect, hydrated, test } from "./support";

// The network dashboard (`/{net}/network`) in a browser: the header's link to it, the views (a period and a currency are URLs), the charts with and
// without JavaScript, the tooltip and the keys, and the running day. What it shows changes with the chain, so a figure is never asserted, only
// what the page is made of. Everything here reads the recorded and generated fixtures and changes none of them (the tests that do are in
// network-live.spec.ts).

const FEATURES_OFF = featuresOff(process.env);

const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);

/**
 * The card of the chart of the transactions by type, and the card of the volume: the card, and not the scroll regions of its plot and table,
 * which carry its title too. Found by the id of its title, which the period ("per day", "per week") and the currency do not change.
 */
const typesCard = (page: Page) => page.locator('section[aria-labelledby="network-types-title"]');
const volumeCard = (page: Page) => page.locator('section[aria-labelledby="network-volume-title"]');

/** The head of the document as the browser has it now: what a search engine and a link preview would read. */
const head = (page: Page) =>
  page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
    title: document.title,
  }));

/** Where the pointer is put to show a bucket: a fraction of the way across the plot, at its middle height. The cursor layer is over the whole plot. */
async function pointOver(page: Page, plot: Locator, fraction: number): Promise<void> {
  // The mouse is moved in the viewport's coordinates: the plot has to be in it.
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  if (!box) throw new Error("the plot has no box");
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
}

test.describe("the way to the page", () => {
  test("'Network' in the header leads to /xrpl/network in the same document, and is the current item", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));
    const item = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Network", exact: true });
    await expect(item).not.toHaveAttribute("aria-current", /./);

    await item.click();
    await page.waitForURL("**/xrpl/network");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("XRPL network");
    await expect(page).toHaveTitle("XRPL network · explorer");
    await expect(item).toHaveAttribute("aria-current", "page");
    await expect(item).toHaveClass(/is-current/);
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe("without JavaScript", () => {
  test("the columns are there, and checking Table hides the chart and shows the rows", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/xrpl/network");

    const card = typesCard(page);
    // The chart: 30 columns of the window, drawn by the server.
    await expect(card.locator(".chart__view")).toBeVisible();
    await expect(card.locator(".col")).toHaveCount(30);
    await expect(card.locator(".col__bar").last()).toBeVisible();
    await expect(card.locator(".chart__table")).toBeHidden();
    await expect(card.getByRole("radio", { name: "Chart" })).toBeChecked();

    await card.getByRole("radio", { name: "Table" }).check();
    await expect(card.locator(".chart__view")).toBeHidden();
    await expect(card.locator(".chart__table")).toBeVisible();
    // The head and a row for each of the 30 days, in the table the radio showed.
    await expect(card.locator(".chart__table").getByRole("row")).toHaveCount(31);

    // The other card's toggle is its own.
    await expect(volumeCard(page).locator(".chart__view")).toBeVisible();
    await expect(volumeCard(page).locator("path.line").first()).toBeAttached();
    // Nothing here is scripted: no slider, since the cursor is the script's.
    await expect(page.getByRole("slider")).toHaveCount(0);
  });
});

test.describe("the views are URLs", () => {
  test("'1 year' is ?period=1y with 52 weeks, noindex and no canonical link, and Back restores the page", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));
    const columns = typesCard(page).locator(".col");
    await expect(columns).toHaveCount(30);
    const first = await head(page);
    expect(first.canonical).toMatch(/\/xrpl\/network$/);
    expect(first.robots).toBeNull();

    await page.getByRole("group", { name: "Period" }).getByRole("link", { name: "1 year" }).click();
    await page.waitForURL("**/xrpl/network?period=1y");
    await expect(columns).toHaveCount(52);
    await expect(page.getByRole("group", { name: "Period" }).getByRole("link", { name: "1 year" })).toHaveAttribute("aria-current", "true");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page).toHaveTitle("XRPL network · last 52 weeks · explorer");
    await expect(typesCard(page).getByRole("heading", { name: "Transactions by type, per week" })).toBeVisible();

    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/xrpl/network" && url.search === "");
    await expect(columns).toHaveCount(30);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    expect(await head(page)).toEqual(first);
    expect(await sameDocument(page)).toBe(true);
  });

  test("'USD' sets in=usd, and Xahau has no 'Amounts in'", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    const amounts = page.getByRole("group", { name: "Amounts in" });
    await expect(amounts.getByRole("link", { name: "XRP" })).toHaveAttribute("aria-current", "true");

    await amounts.getByRole("link", { name: "USD" }).click();
    await page.waitForURL("**/xrpl/network?in=usd");
    await expect(amounts.getByRole("link", { name: "USD" })).toHaveAttribute("aria-current", "true");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.getByRole("heading", { name: "Volume per day, in USD" })).toBeVisible();

    await page.goto("/xahau/network");
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Xahau network");
    await expect(page.getByRole("group", { name: "Period" })).toBeVisible();
    await expect(page.getByText("Amounts in")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Amounts in" })).toHaveCount(0);
  });
});

test.describe("hover and keyboard", () => {
  test("a pointer over the stacked chart shows a tooltip with the date and the total", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    const card = typesCard(page);
    const tip = card.locator(".plot__tip");
    await expect(tip).toHaveCount(0);

    await pointOver(page, card.locator(".plot"), 0.5);
    await expect(tip).toBeVisible();
    await expect(tip.locator(".plot__tip-date")).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, 2026$/);
    await expect(tip.locator(".plot__tip-total")).toContainText("total");
    // It follows the bucket: another place, another date.
    const date = await tip.locator(".plot__tip-date").textContent();
    await pointOver(page, card.locator(".plot"), 0.1);
    await expect(tip.locator(".plot__tip-date")).not.toHaveText(date!);

    // And goes when the pointer does.
    await page.mouse.move(2, 2);
    await expect(tip).toHaveCount(0);
  });

  test("Tab to the slider and Arrow Left changes what it says", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    const card = typesCard(page);
    const slider = card.getByRole("slider");
    await expect(slider).toHaveAttribute("aria-label", "Transactions by type per day, day by day");

    // The plot's scroll region is the stop before its slider.
    await card.getByRole("region", { name: "Transactions by type per day, scrollable chart" }).focus();
    await page.keyboard.press("Tab");
    await expect(slider).toBeFocused();
    // It starts on the newest bucket, and shows its tooltip.
    const newest = Number(await slider.getAttribute("aria-valuenow"));
    expect(newest).toBe(Number(await slider.getAttribute("aria-valuemax")));
    const said = await slider.getAttribute("aria-valuetext");
    await expect(card.locator(".plot__tip")).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", String(newest - 1));
    await expect(slider).not.toHaveAttribute("aria-valuetext", said!);

    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await page.keyboard.press("Escape");
    await expect(card.locator(".plot__tip")).toHaveCount(0);
  });
});

test.describe("the AMM line", () => {
  test("is drawn, and named in the legend, while AMM_DATA is on", async ({ page }) => {
    test.skip(FEATURES_OFF.has("AMM_DATA"), "AMM_DATA is off in the Worker under test: the off wording is checked below");
    await page.goto("/xrpl/network");
    await hydrated(page);
    const card = volumeCard(page);
    await expect(card.getByRole("list", { name: "Legend" }).getByRole("listitem")).toHaveText([
      "Payments",
      "DEX trades, tracked markets, AMM swaps included",
      "AMM swaps, all pools",
    ]);
    await expect(card.locator('path.line[data-slot="3"]')).toHaveCount(1);
    await expect(page.locator(".stat", { hasText: "DEX volume" })).toContainText("AMM swaps");
    await expect(card).toContainText("AMM swaps count every pool, so the lines are not parts of one total.");
    await expect(page.getByText("couldn’t be loaded")).toHaveCount(0);
  });

  test("is left out, and the wording says what the DEX line is, while AMM_DATA is off", async ({ page }) => {
    test.skip(!FEATURES_OFF.has("AMM_DATA"), "AMM_DATA is on in the Worker under test: the line is checked above");
    await page.goto("/xrpl/network");
    await hydrated(page);
    const card = volumeCard(page);
    await expect(card.getByRole("list", { name: "Legend" }).getByRole("listitem")).toHaveText(["Payments", "DEX trades, tracked markets"]);
    await expect(card.locator('path.line[data-slot="3"]')).toHaveCount(0);
    await expect(page.locator(".stat", { hasText: "DEX volume" })).toContainText("tracked markets");
    await expect(page.locator(".stat", { hasText: "DEX volume" })).not.toContainText("AMM swaps");
    await expect(card).toContainText("DEX trades count the trades of the markets the data API tracks.");
  });
});

test.describe("the running day", () => {
  test.skip(LIVE, "reads the day the fixtures stand at (Oct 17, 2026): a real stack's is today");

  test("is 'so far' in the tooltip of its column, and the volume card says it is not computed yet", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    const card = typesCard(page);

    // The last column: the window ends with the index day, which is still going.
    await pointOver(page, card.locator(".plot"), 0.995);
    await expect(card.locator(".plot__tip .plot__tip-date")).toHaveText("Oct 17, 2026, so far");
    // The axis says the date and no more.
    await expect(card.locator(".plot__x--wide span").last()).toHaveText("Oct 17");

    await expect(volumeCard(page).locator(".chart__notes")).toContainText("Oct 17 is not computed yet.");
    await expect(page.getByRole("group", { name: "Filters" })).toContainText("today so far");
  });
});
