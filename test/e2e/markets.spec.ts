import type { Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { RLUSD_ISSUER } from "./fixture-control";
import { LIVE } from "./fixtures";
import { expect, hydrated, test } from "./support";

// The markets page (`/{net}/markets`) in a browser: the header's link to it, the views (a period, a quote and a Trades filter are URLs), what the
// script adds to the table (the text filter, the sort buttons, "Show all"), the table without JavaScript, and the way from a row to the pair's
// page. Everything here reads the recorded and generated fixtures and changes none of them (the markets answer taken away is in
// market-pair-live.spec.ts).
//
// The fixtures' sets (scripts/market-fixtures.ts): the 24 hours list 40 pairs, SOLO/XRP the first; the 30 days 159. XRP/RLUSD, the pair the
// fixtures derive from the recorded AMM ledgers, has fewer than 10 trades in the 24 hours, so it is in the 7-day and 30-day sets only: the tests
// that need it open `?period=30d`.

const FEATURES_OFF = featuresOff(process.env);

const THIRTY_DAYS = "/xrpl/markets?period=30d";
/** XRP/RLUSD in its natural orientation (the native code first), and the other way round, as the rows link to them. */
const XRP_RLUSD = `/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}`;
const RLUSD_XRP = `/xrpl/markets/RLUSD.${RLUSD_ISSUER}/XRP`;

const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);
const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { sameDocument: true }));

/** The head of the document as the browser has it now: what a search engine and a link preview would read. */
const head = (page: Page) =>
  page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
    openGraph: document.querySelectorAll('meta[property^="og:"]').length,
    title: document.title,
  }));

const pairsTable = (page: Page) => page.getByRole("table", { name: "Pairs" });
/** The rows of the Pairs table, its header left out. */
const rowsOf = (page: Page) => pairsTable(page).locator('[role="row"]:not(.table__head)');
/** The count line under the table: the page's one `role="status"`. */
const statusLine = (page: Page) => page.locator('.markets__count[role="status"]');
/** The pair of each row as the table writes it ("SOLO / XRP"), in order. */
const pairNames = (page: Page) => pairsTable(page).locator(".markets__name").allTextContents();

test.describe("the way to the page", () => {
  test("'Markets' in the header leads to /xrpl/markets in the same document, and is the current page", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    const nav = page.getByRole("navigation", { name: "Main" });
    if (FEATURES_OFF.has("MARKETS")) {
      // The switch off: the item is a label with its "soon" tag, and no link (README, "Switches").
      await expect(nav.locator(".nav-item.is-soon", { hasText: "Markets" })).toHaveText(/^Markets\s*soon$/);
      await expect(nav.getByRole("link", { name: "Markets" })).toHaveCount(0);
      test.skip(true, "MARKETS is off in the Worker under test: its item is the 'soon' label, checked above");
    }
    await markDocument(page);
    const item = nav.getByRole("link", { name: "Markets", exact: true });
    await expect(item).not.toHaveAttribute("aria-current", /./);

    await item.click();
    await page.waitForURL("**/xrpl/markets");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Markets");
    await expect(page).toHaveTitle("XRPL markets · explorer");
    await expect(item).toHaveAttribute("aria-current", "page");
    await expect(item).toHaveClass(/is-current/);
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe("the markets page", () => {
  test.skip(FEATURES_OFF.has("MARKETS"), "MARKETS is off in the Worker under test: its pages are not found (the header's label is checked above)");

  test("'7 days' is ?period=7d, noindex with no canonical link and no Open Graph, and Back restores the page", async ({ page }) => {
    await page.goto("/xrpl/markets");
    await hydrated(page);
    await markDocument(page);
    const period = page.getByRole("group", { name: "Period" });
    await expect(period.getByRole("link", { name: "24 h" })).toHaveAttribute("aria-current", "true");
    const first = await head(page);
    expect(first.canonical).toMatch(/\/xrpl\/markets$/);
    expect(first.robots).toBeNull();
    expect(first.openGraph).toBeGreaterThan(0);

    await period.getByRole("link", { name: "7 days" }).click();
    await page.waitForURL("**/xrpl/markets?period=7d");
    await expect(period.getByRole("link", { name: "7 days" })).toHaveAttribute("aria-current", "true");
    await expect(period.getByRole("link", { name: "24 h" })).not.toHaveAttribute("aria-current", /./);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('meta[property^="og:"]')).toHaveCount(0);
    await expect(page).toHaveTitle("XRPL markets · last 7 days · explorer");
    if (!LIVE) await expect(statusLine(page)).toHaveText("83 pairs, by volume, largest first");

    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/xrpl/markets" && url.search === "");
    await expect(period.getByRole("link", { name: "24 h" })).toHaveAttribute("aria-current", "true");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    expect(await head(page)).toEqual(first);
    if (!LIVE) await expect(statusLine(page)).toHaveText("40 pairs, by volume, largest first");
    expect(await sameDocument(page)).toBe(true);
  });

  test("on 30 days, 'XRP' in Quote turns XRP/RLUSD round: its row is RLUSD / XRP and links to that page", async ({ page }) => {
    test.skip(LIVE, "reads the fixtures' 30-day set, which has XRP/RLUSD");
    await page.goto(THIRTY_DAYS);
    await hydrated(page);
    const table = pairsTable(page);
    await expect(table.getByRole("link", { name: /^XRP \/ RLUSD/ })).toHaveAttribute("href", XRP_RLUSD);
    await expect(table.getByRole("link", { name: /^RLUSD \/ XRP/ })).toHaveCount(0);

    await page.getByRole("group", { name: "Quote" }).getByRole("link", { name: "XRP", exact: true }).click();
    await page.waitForURL("**/xrpl/markets?period=30d&quote=xrp");
    await expect(page.getByRole("group", { name: "Quote" }).getByRole("link", { name: "XRP", exact: true })).toHaveAttribute("aria-current", "true");
    await expect(table.getByRole("link", { name: /^RLUSD \/ XRP/ })).toHaveAttribute("href", RLUSD_XRP);
    await expect(table.getByRole("link", { name: /^XRP \/ RLUSD/ })).toHaveCount(0);
    // Every row is quoted in XRP: the native code is the second of each pair.
    const names = await pairNames(page);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !name.endsWith(" / XRP"))).toEqual([]);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  });

  test("the text filter narrows the rows, and the status line says how many of how many are shown", async ({ page }) => {
    test.skip(LIVE, "counts the rows of the fixtures' 24-hour set");
    await page.goto("/xrpl/markets");
    await hydrated(page);
    const status = statusLine(page);
    await expect(status).toHaveText("40 pairs, by volume, largest first");
    await expect(rowsOf(page)).toHaveCount(40);
    const field = page.getByRole("searchbox", { name: "Filter pairs" });

    await field.fill("solo");
    await expect(status).toHaveText("Showing 2 of 40 pairs, by volume, largest first");
    await expect(rowsOf(page)).toHaveCount(2);
    expect(await pairNames(page)).toEqual(["SOLO / XRP", "MOON / SOLO"]);

    // The case of what is typed does not matter, and an issuer is matched too (the full address, of which the row shows the short form).
    await field.fill("RHI5ON49NAZC2KR4X2WHXEPQNV4GSZRNA");
    await expect(status).toHaveText("Showing 1 of 40 pairs, by volume, largest first");
    expect(await pairNames(page)).toEqual(["SOLO / XRP"]);

    await field.fill("nothing like it");
    await expect(status).toHaveText("Showing 0 of 40 pairs, by volume, largest first");
    await expect(rowsOf(page)).toHaveCount(0);
    await expect(page.getByText("No pairs match “nothing like it”.")).toBeVisible();

    await field.fill("");
    await expect(status).toHaveText("40 pairs, by volume, largest first");
    await expect(rowsOf(page)).toHaveCount(40);
    // The totals are the view's, whatever the filter showed.
    await expect(page.getByRole("region", { name: "Totals" }).locator(".stat", { hasText: "Pairs shown" })).toContainText("40");
  });

  test("a press on a header sorts by it, says so in aria-sort and the status line, and a second press reverses it", async ({ page }) => {
    await page.goto("/xrpl/markets");
    await hydrated(page);
    const table = pairsTable(page);
    const volume = table.getByRole("columnheader", { name: /^Volume/ });
    const trades = table.getByRole("columnheader", { name: "Trades" });
    await expect(volume).toHaveAttribute("aria-sort", "descending");
    await expect(trades).toHaveAttribute("aria-sort", "none");
    const byVolume = await pairNames(page);
    /** The Trades column, as numbers. */
    const counts = async () =>
      (await rowsOf(page).locator('[role="cell"]:nth-child(7)').allTextContents()).map((text) => Number(text.replaceAll(",", "")));

    await table.getByRole("button", { name: "Trades" }).click();
    await expect(trades).toHaveAttribute("aria-sort", "descending");
    await expect(volume).toHaveAttribute("aria-sort", "none");
    await expect(statusLine(page)).toHaveText(/, by trades, largest first$/);
    const down = await counts();
    expect(down).toEqual([...down].sort((a, b) => b - a));
    if (!LIVE) expect(await pairNames(page)).not.toEqual(byVolume);

    await table.getByRole("button", { name: "Trades" }).click();
    await expect(trades).toHaveAttribute("aria-sort", "ascending");
    await expect(statusLine(page)).toHaveText(/, by trades, smallest first$/);
    const up = await counts();
    expect(up).toEqual([...up].sort((a, b) => a - b));

    // Volume again, largest first: the API's own order, the rows as they came.
    await table.getByRole("button", { name: /^Volume/ }).click();
    await expect(volume).toHaveAttribute("aria-sort", "descending");
    await expect(trades).toHaveAttribute("aria-sort", "none");
    expect(await pairNames(page)).toEqual(byVolume);
  });

  test("'Show all' shows the rest of the rows the page was given, without a request, and 'Show first 100' takes them away", async ({ page }) => {
    test.skip(LIVE, "counts the rows of the fixtures' 30-day set (159)");
    await page.goto(THIRTY_DAYS);
    await hydrated(page);
    await expect(rowsOf(page)).toHaveCount(100);
    await expect(statusLine(page)).toHaveText("159 pairs, by volume, largest first");
    const asked: string[] = [];
    page.on("request", (request) => asked.push(request.url()));

    await page.getByRole("button", { name: "Show all 159" }).click();
    await expect(rowsOf(page)).toHaveCount(159);
    await expect(rowsOf(page).last().locator('[role="cell"]').first()).toHaveText("159");
    await page.getByRole("button", { name: "Show first 100" }).click();
    await expect(rowsOf(page)).toHaveCount(100);
    expect(asked).toEqual([]);
  });

  test("without JavaScript the table and its sparklines are there, and no filter field, sort button or Show all is", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(LIVE ? "/xrpl/markets" : THIRTY_DAYS);
    const table = pairsTable(page);
    await expect(table).toBeVisible();
    // The first 100 rows in the HTML, each with its sparkline: a picture with words (`role="img"`).
    const shown = LIVE ? await rowsOf(page).count() : 100;
    if (!LIVE) await expect(rowsOf(page)).toHaveCount(shown);
    expect(shown).toBeGreaterThan(0);
    await expect(table.locator("svg.spark")).toHaveCount(shown);
    await expect(table.getByRole("img").first()).toHaveAttribute("aria-label", /\S/);
    // The headers say the order, in plain text: nothing in the page waits for a script.
    await expect(table.getByRole("columnheader", { name: /^Volume/ })).toHaveAttribute("aria-sort", "descending");
    await expect(table.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("searchbox", { name: "Filter pairs" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Show all/ })).toHaveCount(0);
    // The views are links, and work as they are.
    await page.getByRole("group", { name: "Period" }).getByRole("link", { name: "24 h" }).click();
    await page.waitForURL((url) => url.pathname === "/xrpl/markets" && url.search === "");
    await expect(table).toBeVisible();
  });

  test("on 30 days, the XRP/RLUSD row leads to the pair's page in the same document", async ({ page }) => {
    test.skip(LIVE, "reads the fixtures' 30-day set, which has XRP/RLUSD");
    await page.goto(THIRTY_DAYS);
    await hydrated(page);
    await markDocument(page);

    await pairsTable(page).getByRole("link", { name: /^XRP \/ RLUSD/ }).click();
    await page.waitForURL(`**${XRP_RLUSD}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("XRP / RLUSD");
    await expect(page.getByRole("table", { name: "Recent trades" })).toBeVisible();
    // The header's Markets is the section the page is in: "true", not "page".
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Markets", exact: true })).toHaveAttribute("aria-current", "true");
    expect(await sameDocument(page)).toBe(true);
  });
});
