import type { Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { NFT_ACCEPT_OFFER, NFT_ACCEPTED, XAHAU_COLLECTION, XAHAU_NFT, XRPL_COLLECTION, XRPL_NFT } from "../support/nft-names";
import { LIVE, XAHAU_ACCOUNT, XRPL_ACCOUNT } from "./fixtures";
import { expect, hashHint, hashWords, hydrated, test } from "./support";

// The NFT pages (`/{net}/nfts`, `/{net}/nfts/sales`, a collection, `/{net}/nft/{ID}`, README "NFTs") in a browser, on both networks and with and without JavaScript: the header's link to
// them, the list (the period, the sort both ways, the issuer filter and its error, the older sales, more collections), a collection (the measure, the three tabs, the owner filter,
// burned), an NFT in each of its modes (indexed, burned, from the network, the offer events, the history's Older), search by an NFT id, the account's NFTs tab and the transaction page's
// NFT link. Everything here reads the generated fixtures (test/support/nft-names.ts names them) and changes none of them; what needs the fixture server to change an answer (a hash
// that is a transaction and an NFT, the Objects tab's link) is nfts-live.spec.ts's. Where `E2E_FEATURES_OFF` lists `NFTS` the pages are not found, and the off-case is checked instead.

const NFTS_OFF = featuresOff(process.env).has("NFTS");
/** The hero's placeholder with `NFTS` on: the NFT id, and the object id while `LEDGER_OBJECTS` is on. */
const HERO_PLACEHOLDER = featuresOff(process.env).has("LEDGER_OBJECTS")
  ? "Address, transaction hash, ledger index, CTID or NFT id"
  : "Address, transaction hash, ledger index, CTID, NFT id or object id";
const FEATURED = XRPL_COLLECTION.featured;
const XRPL_FEATURED_PATH = `/xrpl/nfts/${FEATURED.issuer}/${FEATURED.taxon}`;
const XAHAU_FEATURED_PATH = `/xahau/nfts/${XAHAU_COLLECTION.featured.issuer}`;

const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { sameDocument: true }));
const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);

/** The head of the document as the browser has it now: what a search engine and a link preview would read. */
const head = (page: Page) =>
  page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
    ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
    title: document.title,
  }));

const tableOf = (page: Page, name: string) => page.getByRole("table", { name, exact: true });
/** The rows of a table, its header left out. */
const rowsOf = (page: Page, name: string) => tableOf(page, name).locator('[role="row"]:not(.table__head)');
const pagination = (page: Page) => page.getByRole("navigation", { name: "Pagination" });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

/** A number as a table writes it ("1,234"), for comparing the rows of a sort. */
const numberOf = (text: string) => Number(text.replaceAll(",", ""));

/** The cells of one column of a table, by its header's text. */
async function column(page: Page, table: string, header: RegExp): Promise<string[]> {
  const names = await tableOf(page, table).locator('[role="columnheader"]').allInnerTexts();
  const at = names.findIndex((name) => header.test(name.trim()));
  expect(at, `a column named ${header} in ${names.join(" | ")}`).toBeGreaterThanOrEqual(0);
  return rowsOf(page, table).evaluateAll((rows, index) => rows.map((row) => (row.querySelectorAll('[role="cell"]')[index] as HTMLElement).innerText.trim()), at);
}

test.describe("the way to the pages", () => {
  test("'NFTs' in the header leads to /xrpl/nfts in the same document, and is the current page", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    const nav = page.getByRole("navigation", { name: "Main" });
    if (NFTS_OFF) {
      // The switch off: the item is a label with its "soon" tag, and no link (README, "Switches").
      await expect(nav.locator(".nav-item.is-soon", { hasText: "NFTs" })).toHaveText(/^NFTs\s*soon$/);
      await expect(nav.getByRole("link", { name: "NFTs", exact: true })).toHaveCount(0);
      test.skip(true, "NFTS is off in the Worker under test: its item is the 'soon' label, checked above");
    }
    await markDocument(page);
    const item = nav.getByRole("link", { name: "NFTs", exact: true });
    await expect(item).not.toHaveAttribute("aria-current", /./);

    await item.click();
    await page.waitForURL("**/xrpl/nfts");
    await expect(heading(page)).toHaveText("NFTs");
    await expect(page).toHaveTitle("NFTs · XRPL · explorer");
    await expect(item).toHaveAttribute("aria-current", "page");
    expect(await sameDocument(page)).toBe(true);
  });

  test("Xahau's item leads to its URITokens, in Xahau's words", async ({ page }) => {
    test.skip(NFTS_OFF, "NFTS is off in the Worker under test");
    await page.goto("/xahau");
    await hydrated(page);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "NFTs", exact: true }).click();
    await page.waitForURL("**/xahau/nfts");
    await expect(heading(page)).toHaveText("URITokens");
    await expect(page).toHaveTitle("URITokens · Xahau · explorer");
    await expect(page.getByText("URITokens, the non-fungible tokens of Xahau")).toBeVisible();
  });
});

test.describe("with NFTS off", () => {
  test.skip(!NFTS_OFF, "NFTS is on in the Worker under test: its pages are checked below");

  for (const [path, word, network] of [
    ["/xrpl/nfts", "NFT", "XRPL"],
    ["/xrpl/nfts/sales", "NFT", "XRPL"],
    [XRPL_FEATURED_PATH, "NFT", "XRPL"],
    [`/xrpl/nft/${XRPL_NFT.featured}`, "NFT", "XRPL"],
    ["/xahau/nfts", "URIToken", "Xahau"],
    [`/xahau/nft/${XAHAU_NFT.featured}`, "URIToken", "Xahau"],
  ] as const) {
    test(`${path} is the not-found page of the ${word} pages`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByText(`We couldn’t find the ${word} pages on ${network}.`)).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    });
  }

  test("an NFT's link-preview image is not drawn", async ({ request }) => {
    const response = await request.get(`/og/xrpl/nft/${XRPL_NFT.featured}.png`);
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).not.toContain("image/png");
  });

  test("the account's NFTs tab is the 'soon' label, its URL leads to the account page, and the NFT's id is text", async ({ page }) => {
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
    const tabs = page.getByRole("navigation", { name: "Account activity" });
    await expect(tabs.locator(".tabs__item.is-soon", { hasText: "NFTs" })).toHaveText(/^NFTs\s*soon$/);
    await expect(tabs.getByRole("link", { name: "NFTs" })).toHaveCount(0);

    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}?tab=nfts`);
    await expect(page).toHaveURL(new RegExp(`/xrpl/account/${XRPL_ACCOUNT}$`));
  });

  test("the NFT of a transaction is its id as text, with the whole id as the title", async ({ page }) => {
    await page.goto(`/xrpl/tx/${NFT_ACCEPT_OFFER}`);
    await expect(page.locator('a[href*="/nft/"]')).toHaveCount(0);
    await expect(page.locator(`span.mono[title="${NFT_ACCEPTED}"]`).first()).toHaveText("00081388…E6D8");
  });

  test("a search for an NFT's id asks no NFT question, and says what it asked", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    await page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" }).fill(XRPL_NFT.featured);
    await expect(page.getByRole("list", { name: "Matches" })).toContainText(hashHint("xrpl", false));
    await page.getByRole("main").getByRole("button", { name: "Search" }).click();
    await expect(heading(page)).toHaveText("Not found");
    await expect(page.getByRole("main")).toContainText(`We couldn’t find ${hashWords("xrpl", false)} ${XRPL_NFT.featured.slice(0, 6)}…${XRPL_NFT.featured.slice(-4)} on XRPL.`);
  });
});

test.describe("the list", () => {
  test.skip(NFTS_OFF, "NFTS is off in the Worker under test: its pages are not found (checked above)");
  test.skip(LIVE, "the pages are drawn from the generated NFT fixtures (test/support/nft-names.ts), which a real stack does not hold");

  test("shows the totals, the thirty days, the top collections, ten recent sales and twenty collections, with its tags for a search engine", async ({ page, baseURL }) => {
    await page.goto("/xrpl/nfts");
    await hydrated(page);
    await expect(heading(page)).toHaveText("NFTs");
    await expect(page.getByRole("group", { name: "Period" }).getByRole("link", { name: "24 h" })).toHaveAttribute("aria-current", "true");
    for (const label of ["Sales volume, 24 h", "Sales, 24 h", "Collections traded, 24 h", "Average sale, 24 h"]) await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByRole("slider").first()).toBeAttached();
    await expect(rowsOf(page, "Recent sales")).toHaveCount(10);
    await expect(rowsOf(page, "Collections")).toHaveCount(20);
    const tags = await head(page);
    expect(tags.title).toBe("NFTs · XRPL · explorer");
    expect(tags.canonical).toBe(`${new URL(baseURL!).origin}/xrpl/nfts`);
    expect(tags.robots).toBeNull();
  });

  test("a period is a link: 7 days sets the tiles and the top collections, in the same document, and the URL keeps it", async ({ page }) => {
    await page.goto("/xrpl/nfts");
    await hydrated(page);
    await markDocument(page);

    await page.getByRole("group", { name: "Period" }).getByRole("link", { name: "7 days" }).click();
    await page.waitForURL("**/xrpl/nfts?period=7day");
    await expect(page.getByText("Sales volume, 7 days", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Period" }).getByRole("link", { name: "7 days" })).toHaveAttribute("aria-current", "true");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    expect(await sameDocument(page)).toBe(true);
  });

  test("sorts the collections by supply, largest first, then smallest first by the same header, and says it in aria-sort", async ({ page }) => {
    await page.goto("/xrpl/nfts");
    await hydrated(page);
    await markDocument(page);
    const volume = page.getByRole("columnheader", { name: /^Volume \(XRP\)/ });
    await expect(volume).toHaveAttribute("aria-sort", "descending");

    await page.getByRole("columnheader", { name: /^Supply/ }).getByRole("link").click();
    await page.waitForURL("**/xrpl/nfts?sort=supply");
    const supply = page.getByRole("columnheader", { name: /^Supply/ });
    await expect(supply).toHaveAttribute("aria-sort", "descending");
    await expect(volume).toHaveAttribute("aria-sort", "none");
    const down = (await column(page, "Collections", /^Supply/)).map(numberOf);
    expect(down).toEqual([...down].sort((a, b) => b - a));

    await supply.getByRole("link").click();
    await page.waitForURL("**/xrpl/nfts?sort=supply&order=asc");
    await expect(supply).toHaveAttribute("aria-sort", "ascending");
    const up = (await column(page, "Collections", /^Supply/)).map(numberOf);
    expect(up).toEqual([...up].sort((a, b) => a - b));
    expect(up[0]!).toBeLessThanOrEqual(down[0]!);
    expect(await sameDocument(page)).toBe(true);
  });

  test("the issuer form lists one issuer's collections, keeps the period, and says what is wrong with an address that is none", async ({ page }) => {
    await page.goto("/xrpl/nfts?period=7day");
    await hydrated(page);
    await markDocument(page);
    const field = page.getByRole("searchbox", { name: "Collections of an issuer" });

    await field.fill(FEATURED.issuer);
    await page.getByRole("button", { name: "Show" }).click();
    await page.waitForURL(`**/xrpl/nfts?period=7day&issuer=${FEATURED.issuer}`);
    const names = await rowsOf(page, "Collections").locator(".nfts__issuer").allInnerTexts();
    expect(names.length).toBeGreaterThan(0);
    expect([...new Set(names)]).toEqual(["rLxc1b…rwMy"]);
    await expect(field).toHaveValue(FEATURED.issuer);

    await field.fill("nope");
    await page.getByRole("button", { name: "Show" }).click();
    await page.waitForURL("**/xrpl/nfts?period=7day&issuer=nope");
    // The message is an alert, which a screen reader reads; the form stays, and the focus with it.
    const error = page.getByRole("alert").filter({ hasText: "Write a classic address (r…)." });
    await expect(error).toBeVisible();
    await expect(page.getByRole("button", { name: "Show" })).toBeFocused();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAttribute("aria-describedby", (await error.getAttribute("id"))!);
    await expect(tableOf(page, "Collections")).toHaveCount(0);
    // Enter in the field: the field keeps the focus.
    await field.fill("rNope");
    await field.press("Enter");
    await page.waitForURL("**/xrpl/nfts?period=7day&issuer=rNope");
    await expect(error).toBeVisible();
    await expect(field).toBeFocused();
    expect(await sameDocument(page)).toBe(true);
  });

  test("works before the script has run: a period and a sort are links, and the issuer form is a GET form that keeps them", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/xrpl/nfts");
    await page.getByRole("group", { name: "Period" }).getByRole("link", { name: "30 days" }).click();
    await page.waitForURL("**/xrpl/nfts?period=30day");
    await page.getByRole("columnheader", { name: /^Holders/ }).getByRole("link").click();
    await page.waitForURL("**/xrpl/nfts?period=30day&sort=holders");
    await expect(page.getByRole("columnheader", { name: /^Holders/ })).toHaveAttribute("aria-sort", "descending");

    await page.getByRole("searchbox", { name: "Collections of an issuer" }).fill(FEATURED.issuer);
    await page.getByRole("button", { name: "Show" }).click();
    await page.waitForURL(`**/xrpl/nfts?period=30day&issuer=${FEATURED.issuer}&sort=holders`);
    expect(await rowsOf(page, "Collections").count()).toBeGreaterThan(0);
    await expect(page.getByText("Sales volume, 30 days", { exact: true })).toBeVisible();
  });

  test("'Older sales' is the sales of the network behind a marker, and its pager goes both ways", async ({ page }) => {
    await page.goto("/xrpl/nfts");
    await hydrated(page);
    await markDocument(page);
    await page.getByRole("link", { name: "Older sales" }).click();
    await page.waitForURL((url) => url.pathname === "/xrpl/nfts/sales" && url.searchParams.has("marker"));
    await expect(heading(page)).toHaveText("NFT sales");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    // The header's item is the section's current one, "true" and not "page" on a page that is not the list.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "NFTs", exact: true })).toHaveAttribute("aria-current", "true");
    const rows = await rowsOf(page, "Sales").count();
    expect(rows).toBeGreaterThan(0);

    // Newer leads back to the first page of the sales, which is the list's own table at its full length.
    await pagination(page).getByRole("link", { name: "Newer" }).click();
    await page.waitForURL((url) => url.pathname === "/xrpl/nfts/sales" && !url.searchParams.has("marker"));
    await expect(rowsOf(page, "Sales")).toHaveCount(20);
    expect(await sameDocument(page)).toBe(true);
  });

  test("'More collections' is the next collections behind a marker, noindex with no canonical link, and 'Newer' is the first page again", async ({ page }) => {
    await page.goto("/xrpl/nfts");
    await hydrated(page);
    await markDocument(page);
    const first = await column(page, "Collections", /^Collection$/);

    await pagination(page).getByRole("link", { name: "More collections" }).click();
    await page.waitForURL((url) => url.pathname === "/xrpl/nfts" && url.searchParams.has("marker"));
    await expect(heading(page)).toHaveText("More NFT collections");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(rowsOf(page, "Collections").first()).toBeVisible();
    expect(await column(page, "Collections", /^Collection$/)).not.toEqual(first);
    // Only the collections: the totals, the charts and the sales belong to the first page.
    await expect(page.getByRole("slider")).toHaveCount(0);

    await pagination(page).getByRole("link", { name: "Newer" }).click();
    await page.waitForURL((url) => url.pathname === "/xrpl/nfts" && url.search === "");
    await expect(heading(page)).toHaveText("NFTs");
    expect(await column(page, "Collections", /^Collection$/)).toEqual(first);
    expect(await sameDocument(page)).toBe(true);
  });

  test("Xahau's list is in URITokens and XAH: its tiles, its collections and its issuer form", async ({ page }) => {
    await page.goto("/xahau/nfts");
    await hydrated(page);
    await expect(heading(page)).toHaveText("URITokens");
    await expect(page.getByText("Sales volume, 24 h", { exact: true })).toBeVisible();
    await expect(page.getByText("XAH").first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /^Volume \(XAH\)/ })).toHaveAttribute("aria-sort", "descending");
    await expect(rowsOf(page, "Collections").first()).toBeVisible();

    await page.getByRole("searchbox", { name: "Collections of an issuer" }).fill(XAHAU_COLLECTION.featured.issuer);
    await page.getByRole("button", { name: "Show" }).click();
    await page.waitForURL(`**/xahau/nfts?issuer=${XAHAU_COLLECTION.featured.issuer}`);
    await expect(rowsOf(page, "Collections")).toHaveCount(1);
    await page.getByRole("link", { name: "rodinG…zKyb", exact: true }).first().click();
    await page.waitForURL(`**${XAHAU_FEATURED_PATH}`);
    await expect(heading(page)).toHaveText("URITokens of rodinG…zKyb");
  });
});

test.describe("a collection", () => {
  test.skip(NFTS_OFF, "NFTS is off in the Worker under test: its pages are not found (checked above)");
  test.skip(LIVE, "the pages are drawn from the generated NFT fixtures (test/support/nft-names.ts), which a real stack does not hold");

  test("is reached from the list's table, in the same document, and its header, stats and chart are drawn", async ({ page, baseURL }) => {
    await page.goto("/xrpl/nfts");
    await hydrated(page);
    await markDocument(page);
    await rowsOf(page, "Collections").locator(`a[href="${XRPL_FEATURED_PATH}"]`).click();
    await page.waitForURL(`**${XRPL_FEATURED_PATH}`);
    await expect(heading(page)).toHaveText("Collection rLxc1b…rwMy · taxon 0");
    await expect(page).toHaveTitle("Collection rLxc1b…rwMy · taxon 0 · XRPL · explorer");
    // In the page, not the header: the Network menu has a "Supply" item of its own.
    for (const stat of ["Supply", "Holders", "Sales", "Volume", "Average sale, 30 days", "Lowest sale, 30 days"]) await expect(page.getByRole("main").getByText(stat, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("slider").first()).toBeAttached();
    await expect(page.getByRole("group", { name: "Measure" }).getByRole("link", { name: "Volume" })).toHaveAttribute("aria-current", "true");
    const tags = await head(page);
    expect(tags.canonical).toBe(`${new URL(baseURL!).origin}${XRPL_FEATURED_PATH}`);
    expect(tags.robots).toBeNull();
    expect(await sameDocument(page)).toBe(true);
  });

  test("switches the measure, which the chart's title and the URL say", async ({ page }) => {
    await page.goto(XRPL_FEATURED_PATH);
    await hydrated(page);
    await markDocument(page);
    const measure = page.getByRole("group", { name: "Measure" });
    for (const [name, query] of [
      ["Sales", "sales"],
      ["Average price", "avg"],
      ["Lowest price", "low"],
    ] as const) {
      await measure.getByRole("link", { name }).click();
      await page.waitForURL(`**${XRPL_FEATURED_PATH}?measure=${query}`);
      await expect(measure.getByRole("link", { name })).toHaveAttribute("aria-current", "true");
      await expect(page.locator("#nft-collection-chart-title")).not.toHaveText("Sales volume per day, in XRP, last 30 days");
    }
    await measure.getByRole("link", { name: "Volume" }).click();
    await page.waitForURL((url) => url.pathname === XRPL_FEATURED_PATH && url.search === "");
    expect(await sameDocument(page)).toBe(true);
  });

  test("has three tabs: Sales (the default), NFTs and Holders, links that keep the window where it is", async ({ page }) => {
    await page.goto(XRPL_FEATURED_PATH);
    await hydrated(page);
    await markDocument(page);
    const tabs = page.getByRole("navigation", { name: "Collection lists" });
    await expect(tabs.getByRole("link", { name: "Sales" })).toHaveAttribute("aria-current", "page");
    await expect(rowsOf(page, "Sales")).toHaveCount(20);

    await tabs.getByRole("link", { name: "NFTs" }).click();
    await page.waitForURL(`**${XRPL_FEATURED_PATH}?tab=nfts`);
    await expect(tabs.getByRole("link", { name: "NFTs" })).toHaveAttribute("aria-current", "page");
    await expect(rowsOf(page, "NFTs").first()).toBeVisible();
    // The featured collection holds 14, one burned: only what is held is listed until the burned are asked for.
    await expect(rowsOf(page, "NFTs").locator(".tag", { hasText: /^burned$/ })).toHaveCount(0);

    await tabs.getByRole("link", { name: "Holders" }).click();
    await page.waitForURL(`**${XRPL_FEATURED_PATH}?tab=holders`);
    await expect(tabs.getByRole("link", { name: "Holders" })).toHaveAttribute("aria-current", "page");
    await expect(rowsOf(page, "Holders").first()).toBeVisible();
    expect(await column(page, "Holders", /^Share of supply/)).not.toEqual([]);
    expect(await sameDocument(page)).toBe(true);
  });

  test("the NFTs tab's owner filter lists what one account holds, and says what is wrong with an address that is none", async ({ page }) => {
    await page.goto(`${XRPL_FEATURED_PATH}?tab=nfts`);
    await hydrated(page);
    await markDocument(page);
    const all = await rowsOf(page, "NFTs").count();
    const field = page.getByRole("searchbox", { name: "Held by an account" });
    // The first holder of the Holders tab.
    await page.getByRole("navigation", { name: "Collection lists" }).getByRole("link", { name: "Holders" }).click();
    await page.waitForURL(`**${XRPL_FEATURED_PATH}?tab=holders`);
    const holder = (await rowsOf(page, "Holders").first().locator('a[href^="/xrpl/account/"]').getAttribute("href"))!.split("/").pop()!;
    await page.getByRole("navigation", { name: "Collection lists" }).getByRole("link", { name: "NFTs" }).click();
    await page.waitForURL(`**${XRPL_FEATURED_PATH}?tab=nfts`);

    await field.fill(holder);
    await page.getByRole("button", { name: "Show" }).click();
    await page.waitForURL(`**${XRPL_FEATURED_PATH}?tab=nfts&owner=${holder}`);
    const owned = await rowsOf(page, "NFTs").count();
    expect(owned).toBeGreaterThan(0);
    expect(owned).toBeLessThanOrEqual(all);
    await expect(field).toHaveValue(holder);

    await field.fill("nope");
    await page.getByRole("button", { name: "Show" }).click();
    await page.waitForURL(`**${XRPL_FEATURED_PATH}?tab=nfts&owner=nope`);
    // The message is an alert, which a screen reader reads; the form stays, and the focus with it.
    await expect(page.getByRole("alert").filter({ hasText: "Write a classic address (r…)." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show" })).toBeFocused();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    // Enter in the field: the field keeps the focus.
    await field.fill("rNope");
    await field.press("Enter");
    await page.waitForURL(`**${XRPL_FEATURED_PATH}?tab=nfts&owner=rNope`);
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("rNope");
    expect(await sameDocument(page)).toBe(true);
  });

  test("'Include burned' adds the NFTs that were burned, each tagged 'burned' and with no owner", async ({ page }) => {
    await page.goto(`${XRPL_FEATURED_PATH}?tab=nfts`);
    await hydrated(page);
    const held = await rowsOf(page, "NFTs").count();
    await page.getByRole("checkbox", { name: "Include burned" }).check();
    await page.getByRole("button", { name: "Show" }).click();
    await page.waitForURL(`**${XRPL_FEATURED_PATH}?tab=nfts&burned=1`);
    expect(await rowsOf(page, "NFTs").count()).toBeGreaterThan(held);
    const burned = rowsOf(page, "NFTs").filter({ has: page.locator(".tag", { hasText: /^burned$/ }) });
    expect(await burned.count()).toBeGreaterThan(0);
    await expect(page.getByRole("checkbox", { name: "Include burned" })).toBeChecked();
  });

  test("a tab's rows, and the older sales behind a marker, go on with 'Older' and back with 'Back to the collection'", async ({ page }) => {
    await page.goto(XRPL_FEATURED_PATH);
    await hydrated(page);
    await markDocument(page);
    await pagination(page).getByRole("link", { name: "Older" }).click();
    await page.waitForURL((url) => url.pathname === XRPL_FEATURED_PATH && url.searchParams.has("marker"));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(rowsOf(page, "Sales").first()).toBeVisible();

    await page.getByRole("link", { name: "Back to the collection" }).click();
    await page.waitForURL((url) => url.pathname === XRPL_FEATURED_PATH && url.search === "");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    expect(await sameDocument(page)).toBe(true);
  });

  test("works without JavaScript: the tabs, the measure and the owner form are links and a GET form", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(XRPL_FEATURED_PATH);
    await page.getByRole("group", { name: "Measure" }).getByRole("link", { name: "Sales" }).click();
    await page.waitForURL(`**${XRPL_FEATURED_PATH}?measure=sales`);
    await page.getByRole("navigation", { name: "Collection lists" }).getByRole("link", { name: "NFTs" }).click();
    await page.waitForURL(`**${XRPL_FEATURED_PATH}?measure=sales&tab=nfts`);
    await page.getByRole("checkbox", { name: "Include burned" }).check();
    await page.getByRole("button", { name: "Show" }).click();
    await page.waitForURL(`**${XRPL_FEATURED_PATH}?measure=sales&tab=nfts&burned=1`);
    await expect(rowsOf(page, "NFTs").locator(".tag", { hasText: /^burned$/ }).first()).toBeVisible();
  });

  test("the Xahau collection whose only sale no rate converts says so, in URITokens", async ({ page }) => {
    const other = `/xahau/nfts/${XAHAU_COLLECTION.other.issuer}`;
    await page.goto(other);
    await hydrated(page);
    await expect(heading(page)).toHaveText("URITokens of rNk6oe…tPGV");
    await expect(page.getByText("1 sale, none with a daily XAH rate")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Collection lists" }).getByRole("link", { name: "URITokens" })).toBeVisible();
    await page.getByRole("navigation", { name: "Collection lists" }).getByRole("link", { name: "URITokens" }).click();
    await page.waitForURL(`**${other}?tab=nfts`);
    await expect(rowsOf(page, "URITokens").first()).toBeVisible();
  });

  test("a key that is no collection is a 404 of its own, and a taxon in the wrong form is tidied", async ({ page }) => {
    const missing = await page.goto(`/xrpl/nfts/${XRPL_COLLECTION.quiet.issuer}/4294967295`);
    expect(missing?.status()).toBe(404);
    await expect(heading(page)).toHaveText("Not found");

    await page.goto(`/xrpl/nfts/${FEATURED.issuer}/00`);
    await expect(page).toHaveURL(new RegExp(`${XRPL_FEATURED_PATH}$`));
  });
});

test.describe("an NFT", () => {
  test.skip(NFTS_OFF, "NFTS is off in the Worker under test: its pages are not found (checked above)");
  test.skip(LIVE, "the pages are drawn from the generated NFT fixtures (test/support/nft-names.ts), which a real stack does not hold");

  test("the featured one is its page: owner, last sale, details, the id decoded, the open offers and its history", async ({ page, baseURL }) => {
    await page.goto(`/xrpl/nft/${XRPL_NFT.featured}`);
    await hydrated(page);
    await expect(page).toHaveTitle("NFT #107,604,335 of rLxc1b…rwMy · taxon 0 · XRPL · explorer");
    await expect(heading(page)).toHaveText("NFT #107,604,335");
    await expect(page.getByText(XRPL_NFT.featured, { exact: true }).first()).toBeVisible();
    for (const card of ["Details", "The id, decoded", "Open offers", "History"]) await expect(page.getByRole("heading", { name: card })).toBeVisible();
    await expect(rowsOf(page, "Open offers")).toHaveCount(2);
    await expect(rowsOf(page, "History").first()).toBeVisible();
    await expect(page.getByText("Not in the index yet, shown from the network.")).toHaveCount(0);
    // The URI is text: nothing in the page links to it.
    await expect(page.locator('a[href^="ipfs:"], a[href^="javascript:"], a[href^="http"]:not([href^="http://127.0.0.1"])')).toHaveCount(0);
    const tags = await head(page);
    expect(tags.canonical).toBe(`${new URL(baseURL!).origin}/xrpl/nft/${XRPL_NFT.featured}`);
    expect(tags.ogImage).toBe(`${new URL(baseURL!).origin}/og/xrpl/nft/${XRPL_NFT.featured}.png`);
    expect(tags.robots).toBeNull();
  });

  test("the offer events are a link that shows them in the history and hides them again, and the history's Older and Newer page through it", async ({ page }) => {
    await page.goto(`/xrpl/nft/${XRPL_NFT.featured}`);
    await hydrated(page);
    await markDocument(page);
    const events = async () => rowsOf(page, "History").locator(".tag").allInnerTexts();
    const without = await events();
    expect(without.filter((event) => event.startsWith("offer"))).toEqual([]);

    await page.getByRole("link", { name: "Show offer events" }).click();
    await page.waitForURL(`**/xrpl/nft/${XRPL_NFT.featured}?offers=1`);
    const link = page.getByRole("link", { name: "Hide offer events" });
    await expect(link).toBeVisible();
    expect((await events()).some((event) => event.startsWith("offer"))).toBe(true);

    await link.click();
    await page.waitForURL((url) => url.pathname === `/xrpl/nft/${XRPL_NFT.featured}` && url.search === "");
    expect((await events()).some((event) => event.startsWith("offer"))).toBe(false);

    // Two pages of history: the featured NFT has more events than a page holds, with the offer events shown.
    await page.getByRole("link", { name: "Show offer events" }).click();
    await page.waitForURL("**?offers=1");
    await pagination(page).getByRole("link", { name: "Older" }).click();
    await page.waitForURL((url) => url.searchParams.has("marker"));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to the NFT" })).toBeVisible();
    await expect(rowsOf(page, "History").first()).toBeVisible();
    await page.getByRole("link", { name: "Back to the NFT" }).click();
    await page.waitForURL((url) => url.pathname === `/xrpl/nft/${XRPL_NFT.featured}` && !url.searchParams.has("marker"));
    expect(await sameDocument(page)).toBe(true);
  });

  test("a burned NFT says who burned it and when, and has no owner", async ({ page }) => {
    await page.goto(`/xrpl/nft/${XRPL_NFT.burned}`);
    await hydrated(page);
    await expect(page.getByRole("main").getByText("burned", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Burned", { exact: true })).toBeVisible();
    await expect(page.getByText("Owner", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Never sold")).toBeVisible();
    await expect(page).toHaveTitle(/ \(burned\)/);
  });

  test("an NFT the index has no owner for reads it from the network", async ({ page }) => {
    await page.goto(`/xrpl/nft/${XRPL_NFT.unowned}`);
    await hydrated(page);
    await expect(page.getByText(/read from the network at ledger #/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  });

  test("an NFT only the network has is shown from the network, with no history and its URI as text", async ({ page }) => {
    await page.goto(`/xrpl/nft/${XRPL_NFT.network}`);
    await hydrated(page);
    await expect(page.getByText("Not in the index yet, shown from the network.")).toBeVisible();
    await expect(page.getByText("ipfs://QmWSFkp41z3CoggYTTWzLDueSsBSMd82T1Vmzm2jr7Ywo6")).toBeVisible();
    await expect(page.locator('a[href^="ipfs:"]')).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "History" })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  test("a burned NFT only the network knows says it is burned", async ({ page }) => {
    await page.goto(`/xrpl/nft/${XRPL_NFT.networkBurned}`);
    await hydrated(page);
    await expect(page.getByText("Not in the index yet, shown from the network.")).toBeVisible();
    await expect(page.getByRole("main").getByText("burned", { exact: true }).first()).toBeVisible();
  });

  test("an id nobody has is the not-found page of an NFT, offering the same search on Xahau", async ({ page }) => {
    const response = await page.goto(`/xrpl/nft/${XRPL_NFT.missing}`);
    expect(response?.status()).toBe(404);
    await expect(heading(page)).toHaveText("Not found");
    await expect(page.getByText(`We couldn’t find NFT ${XRPL_NFT.missing.slice(0, 8)}…${XRPL_NFT.missing.slice(-4)} on XRPL.`)).toBeVisible();
    await page.getByRole("link", { name: "Search on Xahau" }).click();
    await page.waitForURL(`**/xahau/search?q=${XRPL_NFT.missing}`);
  });

  test("an id in lower case is the one URL, and a query to tidy is dropped", async ({ page }) => {
    await page.goto(`/xrpl/nft/${XRPL_NFT.featured.toLowerCase()}?x=1`);
    await expect(page).toHaveURL(new RegExp(`/xrpl/nft/${XRPL_NFT.featured}$`));
  });

  test("a URIToken of Xahau is in Xahau's words: its collection is its issuer's, and it has no serial", async ({ page }) => {
    await page.goto(`/xahau/nft/${XAHAU_NFT.featured}`);
    await hydrated(page);
    await expect(page).toHaveTitle("URIToken 96133366… of rodinG…zKyb · Xahau · explorer");
    await expect(heading(page)).toHaveText("URIToken 96133366…");
    await expect(page.getByRole("heading", { name: "The id" })).toBeVisible();
    await expect(page.getByRole("link", { name: "rodinG…zKyb" }).first()).toHaveAttribute("href", XAHAU_FEATURED_PATH);
    await page.getByRole("link", { name: "rodinG…zKyb" }).first().click();
    await page.waitForURL(`**${XAHAU_FEATURED_PATH}`);
  });

  test("a URIToken only the network has is shown from it, the way an NFT is", async ({ page }) => {
    await page.goto(`/xahau/nft/${XAHAU_NFT.network}`);
    await hydrated(page);
    await expect(page.getByText("Not in the index yet, shown from the network.")).toBeVisible();
  });

  test("works without JavaScript: the offer events and the history's pages are links", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`/xrpl/nft/${XRPL_NFT.featured}`);
    await page.getByRole("link", { name: "Show offer events" }).click();
    await page.waitForURL("**?offers=1");
    await pagination(page).getByRole("link", { name: "Older" }).click();
    await page.waitForURL((url) => url.searchParams.has("marker"));
    await expect(page.getByRole("link", { name: "Back to the NFT" })).toBeVisible();
  });

  test("an NFT's link-preview image is named by the page and is not drawn for an id that is none", async ({ request }) => {
    const image = await request.get(`/og/xrpl/nft/${XRPL_NFT.featured}.png`);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
    const none = await request.get("/og/xrpl/nft/nothing.png");
    expect(none.status()).toBe(404);
  });
});

test.describe("search by an NFT's id", () => {
  test.skip(NFTS_OFF, "NFTS is off in the Worker under test: a search asks no NFT question (checked above)");
  test.skip(LIVE, "the pages are drawn from the generated NFT fixtures (test/support/nft-names.ts), which a real stack does not hold");

  test("an id the index has leads to its page, the box saying what a 64-digit id can be on each network", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    const box = page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" });
    await expect(box).toHaveAttribute("placeholder", HERO_PLACEHOLDER);
    await box.fill(XRPL_NFT.featured.toLowerCase());
    await expect(page.getByRole("list", { name: "Matches" })).toContainText(hashHint("xrpl", true));
    await box.press("Enter");
    await page.waitForURL(`**/xrpl/nft/${XRPL_NFT.featured}`);
    await expect(heading(page)).toHaveText("NFT #107,604,335");
  });

  test("an id only the network has leads to its page too, shown from the network", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    await page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" }).fill(XRPL_NFT.network);
    await page.getByRole("main").getByRole("button", { name: "Search" }).click();
    await page.waitForURL(`**/xrpl/nft/${XRPL_NFT.network}`);
    await expect(page.getByText("Not in the index yet, shown from the network.")).toBeVisible();
  });

  test("a URIToken's id on Xahau says 'URIToken', and leads to its page, without JavaScript too", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/xahau");
    await page.getByRole("main").getByRole("searchbox", { name: "Search Xahau" }).fill(XAHAU_NFT.featured);
    await page.getByRole("main").getByRole("button", { name: "Search" }).click();
    await page.waitForURL(`**/xahau/nft/${XAHAU_NFT.featured}`);
    await expect(heading(page)).toHaveText("URIToken 96133366…");
  });

  test("the header's box names it on Xahau, and an id nobody has is a 404 that says what was looked for", async ({ page }) => {
    await page.goto("/xahau/nfts");
    await hydrated(page);
    const box = page.getByRole("banner").getByRole("searchbox", { name: "Search Xahau" });
    await box.fill(XAHAU_NFT.missing);
    await expect(page.getByRole("list", { name: "Matches" })).toContainText(hashHint("xahau", true));
    await box.press("Enter");
    await expect(heading(page)).toHaveText("Not found");
    await expect(page.getByRole("main")).toContainText(`We couldn’t find ${hashWords("xahau", true)} ${XAHAU_NFT.missing.slice(0, 6)}…${XAHAU_NFT.missing.slice(-4)} on Xahau.`);
  });
});

test.describe("the account's NFTs", () => {
  test.skip(NFTS_OFF, "NFTS is off in the Worker under test: the tab is the 'soon' label (checked above)");
  test.skip(LIVE, "the active account's holdings are what the fixtures hold by hand: three NFTs on XRPL, in two pages of the table");

  test("the tab lists what the account holds, each NFT and collection a link, and the tab is current", async ({ page }) => {
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
    await hydrated(page);
    await markDocument(page);
    const tabs = page.getByRole("navigation", { name: "Account activity" });
    await tabs.getByRole("link", { name: "NFTs" }).click();
    await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}?tab=nfts`);
    await expect(tabs.getByRole("link", { name: "NFTs" })).toHaveAttribute("aria-current", "page");
    await expect(rowsOf(page, "NFTs")).toHaveCount(3);
    await expect(page.getByText("Showing 3 NFTs", { exact: true })).toBeVisible();
    await expect(page.locator('a[href^="/xrpl/nft/"]')).toHaveCount(3);
    await expect(page.locator('a[href^="/xrpl/nfts/"]').first()).toBeVisible();

    await page.locator('a[href^="/xrpl/nft/"]').first().click();
    await page.waitForURL("**/xrpl/nft/**");
    expect(await sameDocument(page)).toBe(true);
  });

  test("on Xahau it is the account's URITokens", async ({ page }) => {
    await page.goto(`/xahau/account/${XAHAU_ACCOUNT}?tab=nfts`);
    await hydrated(page);
    await expect(page.getByRole("navigation", { name: "Account activity" }).getByRole("link", { name: "URITokens" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("URITokens this account holds now")).toBeVisible();
    await expect(tableOf(page, "URITokens")).toBeVisible();
  });
});

test.describe("the transaction page", () => {
  test.skip(NFTS_OFF, "NFTS is off in the Worker under test: the NFT's id is text (checked above)");
  test.skip(LIVE, "the NFT of the recorded transaction is one no NFT file holds: on a real stack its page may be there");

  test("leads from the NFT of a transaction to the NFT's page, in the same document", async ({ page }) => {
    await page.goto(`/xrpl/tx/${NFT_ACCEPT_OFFER}`);
    await hydrated(page);
    await markDocument(page);
    const link = page.locator(`a[href="/xrpl/nft/${NFT_ACCEPTED}"]`).first();
    await expect(link).toHaveText("00081388…E6D8");
    await link.click();
    await page.waitForURL(`**/xrpl/nft/${NFT_ACCEPTED}`);
    // No file holds this NFT: its page is the 404 of an NFT nobody has.
    await expect(heading(page)).toHaveText("Not found");
    expect(await sameDocument(page)).toBe(true);
  });
});
