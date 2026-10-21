import type { Locator, Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { RLUSD_ISSUER } from "./fixture-control";
import { LIVE, SNK_ISSUER, SNK_XRP_LAST_LEDGER, SNK_XRP_POOL, SWAP_THROUGH_POOL, XRP_RLUSD_POOL } from "./fixtures";
import { expect, hydrated, test } from "./support";

// The AMM pages (`/{net}/amm`, `/{net}/amm/{pool}`, README "AMM pools") in a browser: the header's link to them, the list's pages and its form, the way to
// a pool and its state, the tabs, the pager and the period (URLs, which keep the window where it is), the pair URL, a deleted pool, Xahau, the way in from
// a transaction, the pages without JavaScript, and the volume chart under the pointer and the keyboard. Everything here reads the generated fixtures and
// changes none of them (the pool page with a card that failed is amm-live.spec.ts's). Each page is checked against its own fixtures only.
//
// The XRP/RLUSD pool's 30-day view is left to amm-live.spec.ts, which fails its day rows: the Worker keeps a pool's day rows 300 s, so a view another spec
// opened would show what it kept, not the failure. No test here opens it (nor DVR/XRP's default view, which the fixtures do not have).

const FEATURES_OFF = featuresOff(process.env);
const AMM_OFF = FEATURES_OFF.has("AMM_PAGES");

const LIST = "/xrpl/amm";
const POOL = `/xrpl/amm/${XRP_RLUSD_POOL}`;
const DELETED = `/xrpl/amm/${SNK_XRP_POOL}`;
const RLUSD = `RLUSD.${RLUSD_ISSUER}`;

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

const poolsTable = (page: Page) => page.getByRole("table", { name: "Pools" });
/** The rows of the Pools table, its header left out. */
const rowsOf = (page: Page) => poolsTable(page).locator('[role="row"]:not(.table__head)');
/** The pair of each row as the table writes it ("XRP / RLUSD"), in order. */
const pairNames = (page: Page) => poolsTable(page).locator(".amm__pair").allTextContents();
const assetField = (page: Page) => page.getByRole("searchbox", { name: "Pools with this asset" });
const pager = (page: Page) => page.getByRole("navigation", { name: "Pagination" });
const periods = (page: Page) => page.getByRole("group", { name: "Period" });
const tabs = (page: Page) => page.getByRole("navigation", { name: "Pool activity" });
/** The swap volume card of the pool page (`ChartCard id="pool-volume"`), found by the id of its title, which the period ("per day", "per week") does not change. */
const volumeCard = (page: Page) => page.locator('section[aria-labelledby="pool-volume-title"]');

/** The pool page is whole when its activity table is drawn and the script has given the charts their sliders. */
async function poolReady(page: Page, table = "Swaps"): Promise<void> {
  await hydrated(page);
  await expect(page.getByRole("table", { name: table })).toBeVisible();
  await expect(page.getByRole("slider").first()).toBeAttached();
}

/** Puts the pointer a fraction of the way across `plot`, at its middle height: the cursor layer is over the whole plot. */
async function pointOver(page: Page, plot: Locator, fraction: number): Promise<void> {
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  if (!box) throw new Error("the plot has no box");
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
}

/** Where the window is scrolled to, and the furthest it can be now. */
const scrollOf = (page: Page) =>
  page.evaluate(() => new Promise<{ y: number; max: number }>((resolve) => {
    // After the frame the navigation drew: a reset to the top would have happened by then.
    requestAnimationFrame(() => resolve({ y: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight }));
  }));

/**
 * Brings `target` into view (the window then scrolled down), does `navigate`, which follows a link and waits for what it shows, and checks that the window
 * was not sent to the top (`preventScrollReset`): it is where it was, or as far down as the new page goes when that is shorter.
 */
async function keepsTheWindow(page: Page, target: Locator, navigate: () => Promise<void>): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const before = (await scrollOf(page)).y;
  expect(before, "the window, scrolled to the link").toBeGreaterThan(0);
  await navigate();
  const after = await scrollOf(page);
  expect(after.y, "the window after the navigation").toBeGreaterThan(0);
  expect(Math.abs(after.y - Math.min(before, after.max)), `scrolled to ${after.y} of ${after.max}, from ${before}`).toBeLessThanOrEqual(1);
}

test.describe("the way to the pages", () => {
  test("'AMM' in the header leads to /xrpl/amm in the same document, and is the current page", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    const nav = page.getByRole("navigation", { name: "Main" });
    if (AMM_OFF) {
      // The switch off: the item is a label with its "soon" tag, and no link (README, "Switches").
      await expect(nav.locator(".nav-item.is-soon", { hasText: "AMM" })).toHaveText(/^AMM\s*soon$/);
      await expect(nav.getByRole("link", { name: "AMM", exact: true })).toHaveCount(0);
      test.skip(true, "AMM_PAGES is off in the Worker under test: its item is the 'soon' label, checked above");
    }
    await markDocument(page);
    const item = nav.getByRole("link", { name: "AMM", exact: true });
    await expect(item).not.toHaveAttribute("aria-current", /./);

    await item.click();
    await page.waitForURL(`**${LIST}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("AMM pools");
    await expect(page).toHaveTitle("AMM pools · XRPL · explorer");
    await expect(item).toHaveAttribute("aria-current", "page");
    await expect(item).toHaveClass(/is-current/);
    expect(await sameDocument(page)).toBe(true);
  });

  test("the swap through the XRP/RLUSD pool links the pool's page from its flow and its sentence", async ({ page }) => {
    await page.goto(`/xrpl/tx/${SWAP_THROUGH_POOL}`);
    await hydrated(page);
    const label = page.locator(".flow__label");
    if (AMM_OFF) {
      // The switch off: the flow's label is text, and every link to the pool is its account page's.
      await expect(label.filter({ hasText: "XRP/RLUSD AMM pool" })).toHaveCount(1);
      await expect(page.locator(`a[href^="/xrpl/amm/"]`)).toHaveCount(0);
      await expect(page.locator(`a[href="/xrpl/account/${XRP_RLUSD_POOL}"]`).first()).toBeAttached();
      test.skip(true, "AMM_PAGES is off in the Worker under test: the pool's links are its account page's, checked above");
    }
    await markDocument(page);
    await expect(page.getByRole("link", { name: "XRP/RLUSD", exact: true })).toHaveAttribute("href", POOL);
    // The flow's pool step: its label is the link, and the account link under it stays.
    const step = label.getByRole("link", { name: "XRP/RLUSD AMM pool" });
    await expect(step).toHaveAttribute("href", POOL);
    await expect(page.locator(`a[href="/xrpl/account/${XRP_RLUSD_POOL}"]`).first()).toBeAttached();

    await step.click();
    await page.waitForURL(`**${POOL}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("XRP / RLUSD pool");
    // The header's AMM is the section the page is in: "true", not "page".
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "AMM", exact: true })).toHaveAttribute("aria-current", "true");
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe("with AMM_PAGES off", () => {
  test.skip(!AMM_OFF, "AMM_PAGES is on in the Worker under test: its pages are checked below");

  for (const [path, network] of [
    [LIST, "XRPL"],
    [POOL, "XRPL"],
    [`/xrpl/amm/XRP/${RLUSD}`, "XRPL"],
    ["/xahau/amm", "Xahau"],
  ] as const) {
    test(`${path} is the not-found page of the AMM pages`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByText(`We couldn’t find the AMM pages on ${network}.`)).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    });
  }
});

test.describe("the pools list", () => {
  test.skip(AMM_OFF, "AMM_PAGES is off in the Worker under test: its pages are not found (checked above)");

  test("has 20 pools; 'More pools' is the next 20, noindex with no canonical link, and 'Previous' is the first page again", async ({ page, baseURL }) => {
    await page.goto(LIST);
    await hydrated(page);
    await markDocument(page);
    const first = await head(page);
    expect(first.canonical).toBe(`${new URL(baseURL!).origin}${LIST}`);
    expect(first.robots).toBeNull();
    expect(first.openGraph).toBeGreaterThan(0);
    await expect(rowsOf(page)).toHaveCount(20);
    const names = await pairNames(page);
    if (!LIVE) expect(names[0]).toBe("XRP / RLUSD");

    await pager(page).getByRole("link", { name: "More pools" }).click();
    await page.waitForURL((url) => url.pathname === LIST && url.searchParams.has("marker"));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('meta[property^="og:"]')).toHaveCount(0);
    await expect(page).toHaveTitle("More AMM pools · XRPL · explorer");
    await expect(rowsOf(page)).toHaveCount(20);
    expect(await pairNames(page)).not.toEqual(names);

    await pager(page).getByRole("link", { name: "Previous" }).click();
    await page.waitForURL((url) => url.pathname === LIST && url.search === "");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    expect(await head(page)).toEqual(first);
    expect(await pairNames(page)).toEqual(names);
    expect(await sameDocument(page)).toBe(true);
  });

  test("the asset form: XRP and RLUSD.rMxCK… list the pools that hold it, and a word that is no asset says how to write one", async ({ page }) => {
    await page.goto(LIST);
    await hydrated(page);
    await markDocument(page);
    const field = assetField(page);
    const show = page.getByRole("button", { name: "Show pools" });

    await field.fill("XRP");
    await show.click();
    await page.waitForURL(`**${LIST}?asset=XRP`);
    await expect(page).toHaveTitle("AMM pools with XRP · XRPL · explorer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(rowsOf(page)).toHaveCount(20);
    expect((await pairNames(page)).filter((name) => !name.split(" / ").includes("XRP"))).toEqual([]);
    await expect(field).toHaveValue("XRP");

    await field.fill(RLUSD);
    await show.click();
    await page.waitForURL(`**${LIST}?asset=${RLUSD}`);
    await expect(page).toHaveTitle("AMM pools with RLUSD · XRPL · explorer");
    const rlusd = await pairNames(page);
    expect(rlusd.length).toBeGreaterThan(0);
    if (!LIVE) expect(rlusd).toHaveLength(4);
    expect(rlusd.filter((name) => !name.split(" / ").includes("RLUSD"))).toEqual([]);

    await field.fill("nope");
    await show.click();
    await page.waitForURL(`**${LIST}?asset=nope`);
    const message = page.getByText("Write an asset as XRP, or as a currency and its issuer: RLUSD.rMxCK…");
    await expect(message).toBeVisible();
    // The field says it is wrong, and which words say why; no pools are asked for, so no table.
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAttribute("aria-describedby", (await message.getAttribute("id"))!);
    await expect(field).toHaveValue("nope");
    await expect(poolsTable(page)).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    expect(await sameDocument(page)).toBe(true);
  });

  test("'Include deleted pools' with the SNK filter shows the deleted SNK/XRP pool with its 'Deleted' tag", async ({ page }) => {
    await page.goto(LIST);
    await hydrated(page);
    await expect(poolsTable(page).locator(".tag", { hasText: "Deleted" })).toHaveCount(0);

    await assetField(page).fill(`SNK.${SNK_ISSUER}`);
    await page.getByRole("checkbox", { name: "Include deleted pools" }).check();
    await page.getByRole("button", { name: "Show pools" }).click();
    await page.waitForURL(`**${LIST}?asset=SNK.${SNK_ISSUER}&deleted=1`);
    await expect(page).toHaveTitle("AMM pools with SNK (deleted included) · XRPL · explorer");
    await expect(page.getByRole("checkbox", { name: "Include deleted pools" })).toBeChecked();
    const row = rowsOf(page).filter({ has: page.getByRole("link", { name: "SNK / XRP", exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator(".tag", { hasText: /^Deleted$/ })).toBeVisible();
    await expect(row.getByRole("link", { name: "SNK / XRP", exact: true })).toHaveAttribute("href", DELETED);
    // A deleted pool has no value and no auction slot to speak of: a dash in each (the columns Pool, Value, Reserves, Fee, Volume 24 h, Auction slot, Created).
    const cells = row.locator('[role="cell"]');
    await expect(cells.nth(1)).toHaveText("—");
    await expect(cells.nth(5)).toHaveText("—");
  });

  test("a pool's link leads to its page in the same document, whose state card holds the pool's amm_info", async ({ page }) => {
    test.skip(LIVE, "reads the figures of the fixtures' amm_info of XRP/RLUSD");
    await page.goto(LIST);
    await hydrated(page);
    await markDocument(page);

    await poolsTable(page).getByRole("link", { name: "XRP / RLUSD", exact: true }).click();
    await page.waitForURL(`**${POOL}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("XRP / RLUSD pool");
    await expect(page).toHaveTitle("XRP/RLUSD AMM pool · XRPL · explorer");
    const state = page.getByRole("region", { name: "Pool state" });
    /** The stat of the state card under that label: its value, then its sub. */
    const stat = (label: string) => state.locator(".stat").filter({ has: page.locator(".stat__label", { hasText: new RegExp(`^${label}$`) }) });
    // The node's answer (node/amm_info/rhWTXC….json): the reserves, exact, in the display order; the fee and its votes; the LP tokens; the ledger.
    await expect(stat("Reserves").locator(".stat__value")).toHaveText("1,847,691.034536 XRP2,417,282.053464318 RLUSD");
    await expect(stat("Value")).toContainText("3.7M XRP");
    await expect(stat("Value").locator(".stat__sub")).toHaveText("twice the XRP reserve");
    await expect(stat("Pool price").locator(".stat__value")).toHaveText("1.3082718");
    await expect(stat("Pool price").locator(".stat__sub")).toHaveText("RLUSD per XRP, from the reserves");
    await expect(stat("Trading fee").locator(".stat__value")).toHaveText("0.205%");
    await expect(stat("Trading fee").locator(".stat__sub")).toHaveText("set by 8 votes");
    await expect(stat("LP tokens").locator(".stat__value")).toHaveText("1,791,055,986.845366");
    await expect(state.getByText("Live from the network at ledger #107,721,455")).toBeVisible();
    await expect(state.getByRole("link", { name: "#107,721,455" })).toHaveAttribute("href", "/xrpl/ledger/107721455");
    // The slot and the votes are the node's too.
    await expect(page.getByText("Weighted result 0.205%, the pool's trading fee.")).toBeVisible();
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe("the pool page", () => {
  test.skip(AMM_OFF, "AMM_PAGES is off in the Worker under test: its pages are not found (checked above)");

  test("the tabs are ?tab= links: Liquidity, Votes and bids, and Swaps again", async ({ page }) => {
    await page.goto(POOL);
    await poolReady(page);
    await markDocument(page);
    const swaps = tabs(page).getByRole("link", { name: "Swaps" });
    await expect(swaps).toHaveAttribute("aria-current", "page");

    await tabs(page).getByRole("link", { name: "Liquidity" }).click();
    await page.waitForURL(`**${POOL}?tab=liquidity`);
    await expect(tabs(page).getByRole("link", { name: "Liquidity" })).toHaveAttribute("aria-current", "page");
    await expect(swaps).not.toHaveAttribute("aria-current", /./);
    await expect(page.getByRole("table", { name: "Liquidity events" })).toBeVisible();
    await expect(page).toHaveTitle("XRP/RLUSD AMM pool · liquidity · XRPL · explorer");

    await tabs(page).getByRole("link", { name: "Votes and bids" }).click();
    await page.waitForURL(`**${POOL}?tab=governance`);
    await expect(page.getByRole("table", { name: "Votes and bids" })).toBeVisible();
    await expect(page).toHaveTitle("XRP/RLUSD AMM pool · votes and bids · XRPL · explorer");

    await swaps.click();
    await page.waitForURL((url) => url.pathname === POOL && url.search === "");
    await expect(page.getByRole("table", { name: "Swaps" })).toBeVisible();
    expect(await sameDocument(page)).toBe(true);
  });

  test("Older on Swaps is a page of older swaps behind a marker, with no state or charts, and Newer is the first page again", async ({ page }) => {
    await page.goto(POOL);
    await poolReady(page);
    await markDocument(page);
    const rows = page.getByRole("table", { name: "Swaps" }).locator('[role="row"]:not(.table__head)');
    const firstRows = await rows.allTextContents();

    await pager(page).getByRole("link", { name: "Older" }).click();
    await page.waitForURL((url) => url.pathname === POOL && url.searchParams.has("marker") && !url.searchParams.has("tab"));
    await expect(page.getByRole("link", { name: "Back to the pool" })).toHaveAttribute("href", POOL);
    await expect(page.getByRole("table", { name: "Swaps" })).toBeVisible();
    if (!LIVE) await expect(rows).toHaveCount(2);
    expect(await rows.allTextContents()).not.toEqual(firstRows);
    // Old history: nothing that would be as old as the stored page.
    await expect(page.getByRole("region", { name: "Pool state" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Period" })).toHaveCount(0);
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page).toHaveTitle("Older swaps of the XRP/RLUSD AMM pool · XRPL · explorer");

    await pager(page).getByRole("link", { name: "Newer" }).click();
    await page.waitForURL((url) => url.pathname === POOL && url.search === "");
    await expect(page.getByRole("region", { name: "Pool state" })).toBeVisible();
    expect(await rows.allTextContents()).toEqual(firstRows);
    expect(await sameDocument(page)).toBe(true);
  });

  test("'1 year' is ?period=1y: weeks, noindex with no canonical link, and Back restores the page", async ({ page, baseURL }) => {
    await page.goto(POOL);
    await poolReady(page);
    await markDocument(page);
    const columns = volumeCard(page).locator(".col");
    await expect(columns).toHaveCount(90);
    await expect(periods(page).getByRole("link", { name: "90 days" })).toHaveAttribute("aria-current", "true");
    const first = await head(page);
    expect(first.canonical).toBe(`${new URL(baseURL!).origin}${POOL}`);
    expect(first.robots).toBeNull();
    expect(first.openGraph).toBeGreaterThan(0);

    await periods(page).getByRole("link", { name: "1 year" }).click();
    await page.waitForURL(`**${POOL}?period=1y`);
    await expect(periods(page).getByRole("link", { name: "1 year" })).toHaveAttribute("aria-current", "true");
    await expect(periods(page).getByRole("link", { name: "90 days" })).not.toHaveAttribute("aria-current", /./);
    // 52 weeks from Monday, the running one "so far".
    await expect(columns).toHaveCount(52);
    await expect(page.getByRole("heading", { name: "Swap volume per week, in XRP" })).toBeVisible();
    await expect(page.getByText(/^Charts cover the 52 weeks from the week of .+, this week so far$/)).toBeVisible();
    await expect(volumeCard(page).getByRole("slider")).toHaveAttribute("aria-label", "Swap volume per week, in XRP, week by week");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('meta[property^="og:"]')).toHaveCount(0);
    await expect(page).toHaveTitle("XRP/RLUSD AMM pool · last year · XRPL · explorer");

    await page.goBack();
    await page.waitForURL((url) => url.pathname === POOL && url.search === "");
    await expect(columns).toHaveCount(90);
    await expect(periods(page).getByRole("link", { name: "90 days" })).toHaveAttribute("aria-current", "true");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    expect(await head(page)).toEqual(first);
    expect(await sameDocument(page)).toBe(true);
  });

  test("the pair's URL leads to its pool, either way round", async ({ page }) => {
    for (const pair of [`/xrpl/amm/XRP/${RLUSD}`, `/xrpl/amm/${RLUSD}/XRP`]) {
      await page.goto(pair);
      expect(new URL(page.url()).pathname, pair).toBe(POOL);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("XRP / RLUSD pool");
    }
  });

  test("the deleted pool says so, with the last ledger that touched it, and has its history and no state, slot or votes", async ({ page }) => {
    await page.goto(DELETED);
    // Its charts have no data in the 90 days (it was deleted before them), so no slider: the page is whole with its activity.
    await hydrated(page);
    await expect(page.getByRole("table", { name: "Swaps" })).toBeVisible();
    // No part of it failed: its banner is a notice, not an error.
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("SNK / XRP pool");
    await expect(page).toHaveTitle("SNK/XRP AMM pool (deleted) · XRPL · explorer");
    const banner = page.locator(".notice", { hasText: "This pool was deleted." });
    await expect(banner).toBeVisible();
    if (!LIVE) {
      await expect(banner).toHaveText(`This pool was deleted. The last ledger that touched it is #${SNK_XRP_LAST_LEDGER.toLocaleString("en-US")}`);
      await expect(banner.getByRole("link")).toHaveAttribute("href", `/xrpl/ledger/${SNK_XRP_LAST_LEDGER}`);
    }
    await expect(page.getByRole("region", { name: "Pool state" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Auction slot" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Fee votes" })).toHaveCount(0);
    // Its history: the period, the charts and the activity.
    await expect(periods(page)).toBeVisible();
    await expect(volumeCard(page)).toBeVisible();
  });
});

test.describe("Xahau", () => {
  test.skip(AMM_OFF, "AMM_PAGES is off in the Worker under test: its pages are not found (checked above)");

  test("/xahau/amm says Xahau has no AMM, and leads to the XRPL pools", async ({ page }) => {
    await page.goto("/xahau/amm");
    await hydrated(page);
    await markDocument(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("AMM pools");
    await expect(page.getByRole("heading", { name: "Xahau has no AMM" })).toBeVisible();
    await expect(page).toHaveTitle("AMM pools · Xahau · explorer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    if (!FEATURES_OFF.has("MARKETS")) await expect(page.getByRole("link", { name: "See Xahau markets →" })).toHaveAttribute("href", "/xahau/markets");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "AMM", exact: true })).toHaveAttribute("aria-current", "page");

    await page.getByRole("link", { name: "Switch to XRPL pools" }).click();
    await page.waitForURL(`**${LIST}`);
    await expect(poolsTable(page)).toBeVisible();
    expect(await sameDocument(page)).toBe(true);
  });

  test("a pool on Xahau is not found, says why, and offers it on XRPL", async ({ page }) => {
    const response = await page.goto(`/xahau/amm/${XRP_RLUSD_POOL}`);
    expect(response?.status()).toBe(404);
    await hydrated(page);
    await expect(page.getByText("We couldn’t find AMM pool rhWTXC…tcS3 on Xahau.")).toBeVisible();
    await expect(page.getByText("Xahau has no AMM, so this pool exists only on the XRP Ledger.")).toBeVisible();

    await page.getByRole("link", { name: "Open it on XRPL" }).click();
    await page.waitForURL(`**${POOL}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("XRP / RLUSD pool");
  });
});

test.describe("the window stays where it is", () => {
  test.skip(AMM_OFF, "AMM_PAGES is off in the Worker under test: its pages are not found (checked above)");
  // A short window, so that a page of older swaps (no state, no charts) can still be scrolled.
  test.use({ viewport: { width: 1280, height: 480 } });

  test("for 'More pools' on the list", async ({ page }) => {
    await page.goto(LIST);
    await hydrated(page);
    const more = pager(page).getByRole("link", { name: "More pools" });
    await keepsTheWindow(page, more, async () => {
      await more.click();
      await page.waitForURL((url) => url.searchParams.has("marker"));
      await expect(pager(page).getByRole("link", { name: "Previous" })).toBeVisible();
    });
  });

  test("for a tab, a period, Older and Newer on the pool page", async ({ page }) => {
    await page.goto(POOL);
    await poolReady(page);

    const liquidity = tabs(page).getByRole("link", { name: "Liquidity" });
    await keepsTheWindow(page, liquidity, async () => {
      await liquidity.click();
      await page.waitForURL(`**${POOL}?tab=liquidity`);
      await expect(page.getByRole("table", { name: "Liquidity events" })).toBeVisible();
    });

    const year = periods(page).getByRole("link", { name: "1 year" });
    await keepsTheWindow(page, year, async () => {
      await year.click();
      await page.waitForURL(`**${POOL}?period=1y&tab=liquidity`);
      await expect(volumeCard(page).locator(".col")).toHaveCount(52);
    });

    await page.goto(POOL);
    await poolReady(page);
    const older = pager(page).getByRole("link", { name: "Older" });
    await keepsTheWindow(page, older, async () => {
      await older.click();
      await page.waitForURL((url) => url.searchParams.has("marker"));
      await expect(page.getByRole("link", { name: "Back to the pool" })).toBeVisible();
    });

    const newer = pager(page).getByRole("link", { name: "Newer" });
    await keepsTheWindow(page, newer, async () => {
      await newer.click();
      await page.waitForURL((url) => url.pathname === POOL && url.search === "");
      await expect(page.getByRole("region", { name: "Pool state" })).toBeVisible();
    });
  });
});

test.describe("without JavaScript", () => {
  test.skip(AMM_OFF, "AMM_PAGES is off in the Worker under test: its pages are not found (checked above)");

  test("the pool page's tabs and period are links, and a chart's Table radio shows its rows", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(POOL);
    // Nothing here is scripted: no slider (the cursor is the script's).
    await expect(page.getByRole("table", { name: "Swaps" })).toBeVisible();
    await expect(page.getByRole("slider")).toHaveCount(0);

    await tabs(page).getByRole("link", { name: "Liquidity" }).click();
    await page.waitForURL(`**${POOL}?tab=liquidity`);
    await expect(page.getByRole("table", { name: "Liquidity events" })).toBeVisible();

    await periods(page).getByRole("link", { name: "1 year" }).click();
    await page.waitForURL(`**${POOL}?period=1y&tab=liquidity`);
    const card = volumeCard(page);
    await expect(card.locator(".col")).toHaveCount(52);
    await expect(card.locator(".chart__table")).toBeHidden();
    await card.getByRole("radio", { name: "Table" }).check();
    await expect(card.locator(".chart__view")).toBeHidden();
    // A row a week, under the header.
    await expect(card.locator(".chart__table").getByRole("row")).toHaveCount(53);
  });

  test("the list's form is a GET form that filters by its asset", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(LIST);
    await expect(poolsTable(page)).toBeVisible();

    await assetField(page).fill(RLUSD);
    await page.getByRole("button", { name: "Show pools" }).click();
    await page.waitForURL(`**${LIST}?asset=${RLUSD}`);
    const names = await pairNames(page);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !name.split(" / ").includes("RLUSD"))).toEqual([]);
    await expect(assetField(page)).toHaveValue(RLUSD);
  });
});

test.describe("the volume chart", () => {
  test.skip(AMM_OFF, "AMM_PAGES is off in the Worker under test: its pages are not found (checked above)");

  test("a pointer over it shows the day in a tooltip with its swaps, which goes when the pointer does", async ({ page }) => {
    await page.goto(POOL);
    await poolReady(page);
    const card = volumeCard(page);
    const tip = card.locator(".plot__tip");
    await expect(tip).toHaveCount(0);

    await pointOver(page, card.locator(".plot").first(), 0.5);
    await expect(tip).toBeVisible();
    await expect(tip.locator(".plot__tip-date")).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, 20\d\d$/);
    // The extra of the swap volume (E4's `extras`, "Swaps"): the day's swaps, the count strong and the label after it, lowered.
    const swaps = tip.locator(".plot__tip-row").filter({ has: page.locator(".plot__tip-name", { hasText: /^swaps$/ }) });
    await expect(swaps).toHaveCount(1);
    await expect(swaps.locator("b")).toHaveText(/^[\d,]+$/);
    const date = await tip.locator(".plot__tip-date").textContent();
    await pointOver(page, card.locator(".plot").first(), 0.1);
    await expect(tip.locator(".plot__tip-date")).not.toHaveText(date!);

    await page.mouse.move(2, 2);
    await expect(tip).toHaveCount(0);
  });

  test("Tab to its slider and Arrow Left changes what it says, swaps included", async ({ page }) => {
    await page.goto(POOL);
    await poolReady(page);
    const card = volumeCard(page);
    const slider = card.getByRole("slider", { name: "Swap volume per day, in XRP, day by day" });

    // The plot's scroll region is the stop before its slider.
    await card.getByRole("region", { name: "Swap volume per day, in XRP, scrollable chart" }).focus();
    await page.keyboard.press("Tab");
    await expect(slider).toBeFocused();
    // It starts on the newest day, the running one.
    await expect(slider).toHaveAttribute("aria-valuenow", "89");
    const said = (await slider.getAttribute("aria-valuetext"))!;
    expect(said).toContain("Swaps");

    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", "88");
    await expect(slider).not.toHaveAttribute("aria-valuetext", said);
    await expect(slider).toHaveAttribute("aria-valuetext", /Swaps \d/);
    await expect(card.locator(".plot__tip")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(card.locator(".plot__tip")).toHaveCount(0);
  });
});
