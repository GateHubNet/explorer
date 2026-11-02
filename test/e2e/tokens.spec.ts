import type { Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { count, LIVE, XRPL_ACCOUNT } from "./fixtures";
import { expectAccountsDrawn, namedPagesOn, tokenNamedPages } from "./names-pages";
import { expect, hydrated, test } from "./support";
import { detailOf, holdersOf, listOf, tokenCase, transfersMarker, transfersOf } from "./token-pages";

// The token pages (`/{net}/tokens`, `/{net}/token/{token}`, `/{net}/token/{token}/holders`, README "Tokens") in a browser, on both networks and with and without JavaScript: the header's item,
// the list (its pages, a search through the form, the tokens of fewer than 10 holders, Show all and Hide), a token's page (the toml in each of its states, the issuer's settings, the markets
// and the pools it leads to, the holders and their pages, the transfers' Older and Newer), the spellings of a token that land on its one URL, an LP token that lands on its pool, a token
// the index does not know, Xahau's list and Xahau's EVR, and the search for `CUR.issuer`. Every token is read from the fixtures (test/e2e/token-pages.ts finds them by the rules of
// test/support/token-case-rules.ts) and every figure a page shows is worked out from the same files, never written here: a regeneration of the seeds moves nothing in this file. The
// generated answers are D6's, synthetic around real issuers (test/fixtures/PROVENANCE.md, "Token answers"). Everything here reads the fixtures and changes none; what needs the fixture
// server to change an answer (a holders call that fails) is tokens-live.spec.ts's. Where `E2E_FEATURES_OFF` lists `TOKENS` the pages are not found, and the off-case is checked instead.

const TOKENS_OFF = featuresOff(process.env).has("TOKENS");

test.skip(LIVE, "the pages are drawn from the generated token fixtures (test/e2e/token-pages.ts), which a real stack does not hold");

const RLUSD = tokenCase("xrpl", "rlusd");
const USD = tokenCase("xrpl", "usd");
const LIONS = tokenCase("xrpl", "lions");
const FEW = tokenCase("xrpl", "few-holders");
const LP = tokenCase("xrpl", "lp");
const EVR = tokenCase("xahau", "evr");
const XAHAU_UNLISTED = tokenCase("xahau", "xahau-unlisted");
const RLUSD_PATH = `/xrpl/token/${RLUSD.path}`;
const RLUSD_HOLDERS = `${RLUSD_PATH}/holders`;

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
const navItem = (page: Page) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tokens", exact: true });
/** A card by its title: the `<section>` the Card is, named by its `<h2>`. */
const card = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true });
/** The searchbox of the list, not the header's. */
const tokenSearch = (page: Page) => page.getByRole("searchbox", { name: "Code, name or issuer" });

/** A decimal text as a page writes it: the integer part in groups of three, the fraction as it is. */
const grouped = (text: string): string => {
  const [whole, fraction] = text.split(".");
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`}`;
};

/** A figure of a row of tiles: the tile whose label is `label`, in the region `region`. Its parts are separate elements, so its text is read by part, not as a sentence. */
const tile = (page: Page, region: string, label: string) =>
  page.getByRole("region", { name: region, exact: true }).locator(".stat").filter({ has: page.locator(".stat__label").getByText(label, { exact: true }) });

/** The ranks of a list's table, as the first cells show them. */
const ranks = (page: Page) => rowsOf(page, "Issued tokens").evaluateAll((rows) => rows.map((row) => Number((row.querySelector('[role="cell"]') as HTMLElement).innerText)));

test.describe("the way to the pages", () => {
  test("'Tokens' in the header leads to /xrpl/tokens in the same document, and is the current page", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    const nav = page.getByRole("navigation", { name: "Main" });
    if (TOKENS_OFF) {
      // The switch off: the item is a label with its "soon" tag, and no link (README, "Switches").
      await expect(nav.locator(".nav-item.is-soon", { hasText: "Tokens" })).toHaveText(/^Tokens\s*soon$/);
      await expect(nav.getByRole("link", { name: "Tokens", exact: true })).toHaveCount(0);
      test.skip(true, "TOKENS is off in the Worker under test: its item is the 'soon' label, checked above");
    }
    await markDocument(page);
    await expect(navItem(page)).not.toHaveAttribute("aria-current", /./);

    await navItem(page).click();
    await page.waitForURL("**/xrpl/tokens");
    await expect(heading(page)).toHaveText("Tokens");
    await expect(page).toHaveTitle("Tokens · XRPL · explorer");
    await expect(navItem(page)).toHaveAttribute("aria-current", "page");
    expect(await sameDocument(page)).toBe(true);
  });

  test("a token's page and its holders' are in the section: the item is current as 'true', not as the page", async ({ page }) => {
    test.skip(TOKENS_OFF, "TOKENS is off in the Worker under test: the pages are not found (checked below)");
    for (const path of [RLUSD_PATH, RLUSD_HOLDERS]) {
      await page.goto(path);
      await expect(navItem(page)).toHaveAttribute("aria-current", "true");
    }
  });

  test("Xahau's item leads to Xahau's tokens, in Xahau's words", async ({ page }) => {
    test.skip(TOKENS_OFF, "TOKENS is off in the Worker under test");
    await page.goto("/xahau");
    await hydrated(page);
    await navItem(page).click();
    await page.waitForURL("**/xahau/tokens");
    await expect(page).toHaveTitle("Tokens · Xahau · explorer");
    await expect(page.getByText("Tokens on Xahau, ranked by holders.")).toBeVisible();
  });
});

test.describe("with TOKENS off", () => {
  test.skip(!TOKENS_OFF, "TOKENS is on in the Worker under test: its pages are checked below");

  for (const [path, network] of [
    ["/xrpl/tokens", "XRPL"],
    ["/xrpl/tokens?q=USD&all=1", "XRPL"],
    [RLUSD_PATH, "XRPL"],
    [RLUSD_HOLDERS, "XRPL"],
    ["/xahau/tokens", "Xahau"],
    [`/xahau/token/${EVR.path}`, "Xahau"],
  ] as const) {
    test(`${path} is the not-found page of the token pages`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByText(`We couldn’t find the token pages on ${network}.`)).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    });
  }

  test("a token's link-preview image is not drawn", async ({ request }) => {
    const response = await request.get(`/og/xrpl/token/${RLUSD.path}.png`);
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).not.toContain("image/png");
  });

  test("a token's code on the account page is text, not a link", async ({ page }) => {
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
    await expect(page.getByRole("main")).toContainText("LIONS");
    await expect(page.locator('a[href*="/token/"]')).toHaveCount(0);
  });

  test("a search for CUR.issuer asks no token question: the help page, with no link to the tokens", async ({ page }) => {
    await page.goto(`/xrpl/search?q=${USD.path}`);
    await expect(page).toHaveURL(new RegExp(`/xrpl/search\\?q=${USD.path}$`));
    await expect(page.getByRole("link", { name: /among tokens/ })).toHaveCount(0);
  });
});

test.describe("the list", () => {
  test.skip(TOKENS_OFF, "TOKENS is off in the Worker under test: its pages are not found (checked above)");

  test("is 20 tokens ranked from 1, with the totals, the tabs and the coverage; Previous is disabled and More tokens leads on", async ({ page, baseURL }) => {
    const first = listOf("xrpl");
    const { totals } = first;
    expect(first.tokens, "the fixtures' first page of tokens").toHaveLength(20);
    expect(first.marker, "and a second page").toBeDefined();

    await page.goto("/xrpl/tokens");
    await hydrated(page);
    await expect(heading(page)).toHaveText("Tokens");
    expect(await ranks(page)).toEqual(Array.from({ length: 20 }, (_, at) => at + 1));
    await expect(rowsOf(page, "Issued tokens")).toHaveCount(first.tokens.length);

    // The three tiles are the answer's totals; the "fewer than 10 holders" is the rest of the tokens.
    await expect(tile(page, "Totals", "Tokens with 10+ holders").locator(".stat__value")).toHaveText(count(totals!.tokens_with_10_holders));
    await expect(tile(page, "Totals", "Tokens with 10+ holders").locator(".stat__sub")).toHaveText(`${count(totals!.tokens - totals!.tokens_with_10_holders)} more have fewer than 10 holders`);
    await expect(tile(page, "Totals", "Holders").locator(".stat__value")).toHaveText(count(totals!.holders!));
    await expect(page.getByText(`Showing 1–20 of ${count(first.total!)} tokens with 10 or more holders`)).toBeVisible();

    // The tabs: Issued tokens is the view, and MPT says why it cannot be chosen yet.
    const tabs = page.getByRole("group", { name: "Kind of token" });
    await expect(tabs.getByRole("link", { name: "Issued tokens" })).toHaveAttribute("aria-current", "true");
    await expect(tabs.getByRole("link", { name: /MPT/ })).toHaveCount(0);
    await expect(tabs.locator(".netswitch__item.is-disabled")).toHaveText(/^MPT\s*soon$/);

    // The coverage is not complete in the fixtures, so the note says from which ledger the trust lines are in the index.
    await expect(page.getByRole("note").filter({ hasText: "earlier trust lines are not in the index yet" })).toContainText(`#${count(first.coverage.from_ledger_index!)}`);

    // The first page: indexable, with the canonical URL, and no image of its own.
    const origin = new URL(baseURL!).origin;
    expect(await head(page)).toEqual({ canonical: `${origin}/xrpl/tokens`, robots: null, ogImage: null, title: "Tokens · XRPL · explorer" });
    await expect(pagination(page).locator(".is-disabled")).toHaveText("Previous");
    await expect(pagination(page).getByRole("link", { name: "More tokens" })).toBeVisible();
    // Every issuer is a link to the account page, and a token's code a link to its page.
    await expect(tableOf(page, "Issued tokens").locator(`a[href="/xrpl/account/${RLUSD.issuer}"]`)).toHaveCount(1);
    await expect(tableOf(page, "Issued tokens").locator(`a[href="${RLUSD_PATH}"]`)).toHaveCount(1);
  });

  test("More tokens and Previous page through the list in one document; a page behind a marker is kept from a search engine", async ({ page }) => {
    await page.goto("/xrpl/tokens");
    await hydrated(page);
    await markDocument(page);

    await pagination(page).getByRole("link", { name: "More tokens" }).click();
    await page.waitForURL((url) => url.pathname === "/xrpl/tokens" && url.searchParams.has("marker"));
    // The URL can change before the new rows are drawn (a CI runner read the old page's ranks): each read waits for them.
    await expect.poll(() => ranks(page)).toEqual(Array.from({ length: 20 }, (_, at) => at + 21));
    await expect(page.getByText(/^Showing 21–40 of /)).toBeVisible();
    await expect.poll(async () => (await head(page)).robots).toBe("noindex, follow");
    expect(await head(page)).toMatchObject({ canonical: null, ogImage: null, title: "More tokens · XRPL · explorer" });

    // The third page keeps the way back: Previous is the second page, then the first.
    await pagination(page).getByRole("link", { name: "More tokens" }).click();
    await page.waitForURL((url) => url.searchParams.has("back"));
    await expect.poll(async () => (await ranks(page))[0]).toBe(41);
    await pagination(page).getByRole("link", { name: "Previous" }).click();
    await page.waitForURL((url) => url.searchParams.has("marker") && !url.searchParams.has("back"));
    await expect.poll(async () => (await ranks(page))[0]).toBe(21);
    await pagination(page).getByRole("link", { name: "Previous" }).click();
    await page.waitForURL((url) => url.pathname === "/xrpl/tokens" && url.search === "");
    await expect.poll(async () => (await ranks(page))[0]).toBe(1);
    await expect.poll(async () => (await head(page)).robots).toBeNull();
    expect(await sameDocument(page)).toBe(true);
  });

  test("a search through the form lists the tokens it finds, offers the ones with fewer than 10 holders, and Show all and Hide are links to the views", async ({ page }) => {
    const found = listOf("xrpl", { q: "USD" });
    const withBelow = listOf("xrpl", { q: "USD", all: true });
    expect(found.tokens.length, "the fixtures' search for USD").toBeGreaterThan(1);
    expect(withBelow.tokens.length, "and the same with the tokens of fewer than 10 holders").toBeGreaterThan(found.tokens.length);

    await page.goto("/xrpl/tokens");
    await hydrated(page);
    await markDocument(page);
    await tokenSearch(page).fill("USD");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/xrpl/tokens" && url.search === "?q=USD");
    await expect(page).toHaveTitle("Tokens matching “USD” · XRPL · explorer");
    await expect(rowsOf(page, "Issued tokens")).toHaveCount(found.tokens.length);
    await expect(tokenSearch(page)).toHaveValue("USD");
    // A search is a view of its own: kept from a search engine, with no canonical URL.
    expect(await head(page)).toMatchObject({ canonical: null, robots: "noindex, follow" });
    await expect(page.getByText(`${found.tokens.length} matches`)).toBeVisible();

    // "N more among tokens with fewer than 10 holders" is the same search with all of them.
    const more = page.getByRole("link", { name: `${found.total_below} more among tokens with fewer than 10 holders` });
    await expect(more).toHaveAttribute("href", "/xrpl/tokens?q=USD&all=1");
    await more.click();
    await page.waitForURL((url) => url.search === "?q=USD&all=1");
    await expect(rowsOf(page, "Issued tokens")).toHaveCount(withBelow.tokens.length);
    await expect(tokenSearch(page)).toHaveValue("USD");
    // The tokens with fewer than 10 holders are shown, so the offer is Hide, and the search stays.
    await expect(page.getByRole("link", { name: /more among tokens/ })).toHaveCount(0);
    const hide = page.getByRole("link", { name: "Hide tokens with fewer than 10 holders" });
    await expect(hide).toHaveAttribute("href", "/xrpl/tokens?q=USD");
    await hide.click();
    await page.waitForURL((url) => url.search === "?q=USD");
    await expect(rowsOf(page, "Issued tokens")).toHaveCount(found.tokens.length);
    expect(await sameDocument(page)).toBe(true);
  });

  test("Show all adds the tokens with fewer than 10 holders, keeps them while the form searches, and Hide takes them away", async ({ page }) => {
    const { totals } = listOf("xrpl");
    const hidden = totals!.tokens - totals!.tokens_with_10_holders;
    expect(hidden, "the fixtures have tokens of fewer than 10 holders").toBeGreaterThan(0);

    await page.goto("/xrpl/tokens");
    await hydrated(page);
    await markDocument(page);
    const showAll = page.getByRole("link", { name: `Show all (${hidden} hidden)` });
    await expect(showAll).toHaveAttribute("href", "/xrpl/tokens?all=1");
    await showAll.click();
    await page.waitForURL((url) => url.search === "?all=1");
    await expect(page).toHaveTitle("All tokens · XRPL · explorer");
    await expect(page.getByText(`Showing 1–20 of ${count(totals!.tokens)} tokens`, { exact: true })).toBeVisible();
    expect(await head(page)).toMatchObject({ canonical: null, robots: "noindex, follow" });

    // The form keeps `all` when it searches (a hidden field after the text).
    await tokenSearch(page).fill("USD");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForURL((url) => url.search === "?q=USD&all=1");
    await expect(rowsOf(page, "Issued tokens")).toHaveCount(listOf("xrpl", { q: "USD", all: true }).tokens.length);

    await page.getByRole("link", { name: "Hide tokens with fewer than 10 holders" }).click();
    await page.waitForURL((url) => url.search === "?q=USD");
    expect(await sameDocument(page)).toBe(true);
  });

  test("a search of more than 64 characters is not asked: the field says so, tied to its message, and the list is gone", async ({ page }) => {
    await page.goto("/xrpl/tokens");
    await hydrated(page);
    await tokenSearch(page).fill("x".repeat(65));
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get("q") === "x".repeat(65));
    const error = page.getByRole("alert").filter({ hasText: "Search for at most 64 characters" });
    await expect(error).toBeVisible();
    await expect(tokenSearch(page)).toHaveAttribute("aria-invalid", "true");
    await expect(tokenSearch(page)).toHaveAttribute("aria-describedby", (await error.getAttribute("id"))!);
    await expect(tableOf(page, "Issued tokens")).toHaveCount(0);
    expect((await head(page)).robots).toBe("noindex, follow");
  });

  test("a token's code leads to its page in the same document", async ({ page }) => {
    await page.goto("/xrpl/tokens");
    await hydrated(page);
    await markDocument(page);
    const detail = detailOf("xrpl", "rlusd");
    await tableOf(page, "Issued tokens").locator(`a[href="${RLUSD_PATH}"]`).click();
    await page.waitForURL(`**${RLUSD_PATH}`);
    await expect(heading(page)).toHaveText(detail.toml!.name!);
    await expect(page).toHaveTitle(`${detail.toml!.name!} (RLUSD) · XRPL · explorer`);
    expect(await sameDocument(page)).toBe(true);
  });

  test("the account page's Tokens card leads to a token's page", async ({ page }) => {
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
    await hydrated(page);
    await markDocument(page);
    await page.locator(`a[href="/xrpl/token/${LIONS.path}"]`).click();
    await page.waitForURL(`**/xrpl/token/${LIONS.path}`);
    await expect(page).toHaveTitle(/^LIONS by rGHtf1…AuzS · XRPL · explorer$/);
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe("a token's page", () => {
  test.skip(TOKENS_OFF, "TOKENS is off in the Worker under test: its pages are not found (checked above)");

  test("shows the token, its figures, the toml, the issuer's settings, the markets, the pools, the top holders and the transfers", async ({ page, baseURL }) => {
    const detail = detailOf("xrpl", "rlusd");
    const transfers = transfersOf("xrpl", "rlusd");
    await page.goto(RLUSD_PATH);
    await hydrated(page);

    // The header: the toml's name, the code (a text code, its hex said to a screen reader and copyable), the issuer in full and the two buttons.
    await expect(heading(page)).toHaveText(detail.toml!.name!);
    await expect(page.locator(".token-page__code")).toContainText(`RLUSD, currency code ${RLUSD.currency}`);
    await expect(page.getByRole("button", { name: "Copy hex" })).toBeVisible();
    await expect(page.getByText("Issued token", { exact: true })).toBeVisible();
    await expect(page.locator("p.token-page__issuer").getByRole("link")).toHaveAttribute("href", `/xrpl/account/${RLUSD.issuer}`);
    await expect(page.getByRole("link", { name: "Issuer account" })).toHaveAttribute("href", `/xrpl/account/${RLUSD.issuer}`);
    const tomlFile = page.getByRole("link", { name: "xrp-ledger.toml (opens in a new tab)", exact: true });
    await expect(tomlFile).toHaveAttribute("href", detail.toml_url!);
    await expect(tomlFile).toHaveAttribute("target", "_blank");
    await expect(tomlFile).toHaveAttribute("rel", /noopener/);

    // The figures are the answer's, exact.
    const figure = (label: string) => tile(page, "Figures", label);
    await expect(figure("Supply").locator(".stat__value")).toHaveText(grouped(detail.supply));
    await expect(figure("Supply").locator(".stat__sub")).toHaveText("RLUSD, the sum of all holders' balances");
    await expect(figure("Holders").locator(".stat__value")).toHaveText(count(detail.holders));
    await expect(figure("Trust lines").locator(".stat__value")).toHaveText(count(detail.trust_lines));
    await expect(figure("Trust lines").locator(".stat__sub")).toHaveText(`${count(detail.trust_lines - detail.holders)} of them with a zero balance`);
    await expect(figure("Price").locator(".stat__value")).toHaveText(`${detail.price} XRP`);
    // The volume is compact (`compactNumber`): 7,307.43 under ten thousand, 12.3K above it; what is not worked out here is its digits.
    await expect(figure("Volume, 24 h").locator(".stat__value")).toHaveText(/^[\d,.]+[KMB]? XRP$/);
    await expect(figure("Volume, 24 h").locator(".stat__sub")).toContainText(`${count(detail.trades!)} trades`);

    // The toml: the entry the issuer's toml lists, and the code in hex with its sentence.
    const toml = card(page, "From ripple.com's toml");
    await expect(toml).toContainText("The [[CURRENCIES]] entry for RLUSD in");
    await expect(toml.locator("dt", { hasText: /^name$/ }).locator("xpath=following-sibling::dd[1]")).toHaveText(detail.toml!.name!);
    await expect(toml.locator("dt", { hasText: /^Currency code in hex$/ }).locator("xpath=following-sibling::dd[1]")).toContainText(RLUSD.currency);

    // The issuer's settings, from D6's answer; each row is a name, a state and a sentence.
    const settings = card(page, "Issuer settings");
    const row = (name: string) => settings.getByRole("listitem").filter({ hasText: new RegExp(`^${name}`) });
    await expect(row("Clawback")).toContainText(detail.issuer_settings!.allow_trust_line_clawback ? "Allowed" : "Not allowed");
    await expect(row("Require auth")).toContainText(detail.issuer_settings!.require_auth ? "On" : "Off");
    await expect(row("Default ripple")).toContainText(detail.issuer_settings!.default_ripple ? "On" : "Off");
    await expect(settings.getByRole("listitem")).toHaveCount(6);
    await expect(settings.getByText("Read live from the network")).toHaveCount(0);

    // One row to a market, a pool and a holder, and a page of transfers.
    await expect(rowsOf(page, "Markets")).toHaveCount(detail.markets.length);
    await expect(rowsOf(page, "Top holders")).toHaveCount(10);
    await expect(rowsOf(page, "Recent transfers")).toHaveCount(transfers.transfers.length);
    await expect(page.getByText(`The top 10 hold `)).toBeVisible();

    // The first page of a token is indexable, with the canonical URL and the token's image.
    const origin = new URL(baseURL!).origin;
    expect(await head(page)).toEqual({
      canonical: `${origin}${RLUSD_PATH}`,
      robots: null,
      ogImage: `${origin}/og/xrpl/token/${RLUSD.path}.png`,
      title: `${detail.toml!.name!} (RLUSD) · XRPL · explorer`,
    });
  });

  test("a market leads to its pair's page, a pool to its page, in the same document", async ({ page }) => {
    const detail = detailOf("xrpl", "rlusd");
    await page.goto(RLUSD_PATH);
    await hydrated(page);
    await markDocument(page);

    // The first market is against the native currency: its pair page is XRP/RLUSD.
    const nativeMarket = detail.markets.find((market) => market.counter_issuer === undefined)!;
    expect(nativeMarket.counter_currency).toBe("XRP");
    await tableOf(page, "Markets").getByRole("link", { name: "RLUSD / XRP" }).click();
    await page.waitForURL(`**/xrpl/markets/XRP/${RLUSD.path}`);
    await expect(heading(page)).toHaveText("XRP / RLUSD");

    await page.goBack();
    await page.waitForURL(`**${RLUSD_PATH}`);
    // The pools are the AMM list's (the XRP/RLUSD pool first); a pool is its account.
    const pool = tableOf(page, "AMM pools").getByRole("link", { name: "XRP / RLUSD" });
    const href = await pool.getAttribute("href");
    expect(href).toMatch(/^\/xrpl\/amm\/r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
    await pool.click();
    await page.waitForURL(`**${href!}`);
    await expect(heading(page)).toHaveText("XRP / RLUSD pool");
    expect(await sameDocument(page)).toBe(true);
  });

  test("'All N holders' leads to the holders page, which pages through every holder: 50 a page, More holders, Previous, and the way back", async ({ page, baseURL }) => {
    const detail = detailOf("xrpl", "rlusd");
    const first = holdersOf("xrpl", "rlusd");
    expect(first.marker, "RLUSD has more than 50 holders").toBeDefined();
    await page.goto(RLUSD_PATH);
    await hydrated(page);
    await markDocument(page);

    await page.getByRole("link", { name: `All ${count(detail.holders)} holders →` }).click();
    await page.waitForURL(`**${RLUSD_HOLDERS}`);
    await expect(heading(page)).toHaveText("Holders of RLUSD");
    await expect(page.getByText(`${count(detail.holders)} accounts hold ${grouped(detail.supply)} RLUSD`)).toBeVisible();
    await expect(rowsOf(page, "Holders")).toHaveCount(first.holders.length);
    await expect(page).toHaveTitle("Holders of RLUSD · XRPL · explorer");
    // Largest balance first: the ranks, then the frozen line the fixtures put second.
    await expect(rowsOf(page, "Holders").first().locator('[role="cell"]').first()).toHaveText("1");
    await expect(tableOf(page, "Holders").getByText("Frozen")).toBeVisible();
    const origin = new URL(baseURL!).origin;
    expect(await head(page)).toMatchObject({ canonical: `${origin}${RLUSD_HOLDERS}`, robots: null });

    // The next 50 are behind a marker: kept from a search engine; Previous is the first page again.
    await pagination(page).getByRole("link", { name: "More holders" }).click();
    await page.waitForURL((url) => url.pathname === RLUSD_HOLDERS && url.searchParams.has("marker"));
    await expect(rowsOf(page, "Holders").first().locator('[role="cell"]').first()).toHaveText("51");
    await expect.poll(async () => (await head(page)).robots).toBe("noindex, follow");
    expect((await head(page)).canonical).toBeNull();
    await pagination(page).getByRole("link", { name: "Previous" }).click();
    await page.waitForURL((url) => url.pathname === RLUSD_HOLDERS && url.search === "");

    // Back to the token.
    await page.getByRole("link", { name: "Back to RLUSD" }).click();
    await page.waitForURL(`**${RLUSD_PATH}`);
    expect(await sameDocument(page)).toBe(true);
  });

  test("the transfers go back with Older and forward with Newer, in one document; a page behind a marker is kept from a search engine", async ({ page }) => {
    const found = transfersMarker("xrpl");
    expect(found.token).toBe(RLUSD.path);
    await page.goto(RLUSD_PATH);
    await hydrated(page);
    await markDocument(page);
    await expect(pagination(page).locator(".is-disabled")).toHaveText("Newer");
    const first = await rowsOf(page, "Recent transfers").first().innerText();

    await pagination(page).getByRole("link", { name: "Older" }).click();
    await page.waitForURL(`**${RLUSD_PATH}?marker=${found.marker}`);
    await expect(page).toHaveTitle(/^Older transfers of RLUSD · XRPL · explorer$/);
    expect(await head(page)).toMatchObject({ canonical: null, ogImage: null, robots: "noindex, follow" });
    // Behind a marker the page is the header, the way back to the first page and the transfers.
    await expect(tableOf(page, "Older transfers")).toBeVisible();
    await expect(tableOf(page, "Markets")).toHaveCount(0);
    expect(await rowsOf(page, "Older transfers").first().innerText()).not.toBe(first);

    await pagination(page).getByRole("link", { name: "Newer" }).click();
    await page.waitForURL((url) => url.pathname === RLUSD_PATH && url.search === "");
    await expect(tableOf(page, "Markets")).toBeVisible();
    expect(await rowsOf(page, "Recent transfers").first().innerText()).toBe(first);
    expect(await sameDocument(page)).toBe(true);
  });

  test("a token with no domain says so; one whose domain's toml does not list it says that; the settings of a token the index has none of are read from the network", async ({ page }) => {
    await page.goto(`/xrpl/token/${LIONS.path}`);
    await expect(card(page, "The issuer's toml")).toContainText("The issuer's account names no domain, so no toml describes LIONS.");
    await expect(card(page, "Issuer settings").getByText("Read live from the network")).toBeVisible();
    await expect(card(page, "Issuer settings").getByRole("listitem")).toHaveCount(6);

    const usd = detailOf("xrpl", "usd");
    await page.goto(`/xrpl/token/${USD.path}`);
    await expect(card(page, `From ${usd.domain}'s toml`)).toContainText(`${usd.domain}'s toml has no [[CURRENCIES]] entry for USD by this issuer.`);
    // A transfer fee is a percentage and a sentence.
    await expect(card(page, "Issuer settings").getByRole("listitem").filter({ hasText: /^Transfer fee/ })).toContainText(`${usd.issuer_settings!.transfer_fee}%`);
  });

  test("a token with few holders and no trades says so in each card", async ({ page }) => {
    const few = detailOf("xrpl", "few-holders");
    await page.goto(`/xrpl/token/${FEW.path}`);
    await expect(card(page, "Markets")).toContainText(`${FEW.currency} had no trades in the last 24 hours.`);
    await expect(card(page, "AMM pools")).toContainText(`No AMM pool holds ${FEW.currency}.`);
    await expect(page.getByRole("link", { name: `All ${few.holders} holders →` })).toBeVisible();
    await expect(rowsOf(page, "Top holders")).toHaveCount(few.holders);
    await expect(page.getByText(`The top ${few.holders} hold 100.00% of the supply.`)).toBeVisible();
  });
});

test.describe("the spellings of a token", () => {
  test.skip(TOKENS_OFF, "TOKENS is off in the Worker under test: its pages are not found (checked above)");

  test("a code in lower case and the code in hex land on the token's one URL, in the browser", async ({ page }) => {
    for (const [asked, canonical] of [
      [`/xrpl/token/${USD.currency.toLowerCase()}.${USD.issuer}`, `/xrpl/token/${USD.path}`],
      [`/xrpl/token/${RLUSD.currency}.${RLUSD.issuer}`, `/xrpl/token/${RLUSD.path}`],
      // A standard code in its hex form, which is how the ledger holds it.
      [`/xrpl/token/0000000000000000000000005553440000000000.${USD.issuer}`, `/xrpl/token/${USD.path}`],
      [`/xrpl/token/${RLUSD.currency}.${RLUSD.issuer}/holders`, RLUSD_HOLDERS],
    ] as const) {
      await page.goto(asked);
      await expect(page, asked).toHaveURL(new RegExp(`${canonical}$`));
      await expect(heading(page)).toBeVisible();
    }
  });

  test("an LP token lands on its pool's page", async ({ page }) => {
    await page.goto(`/xrpl/token/${LP.path}`);
    await page.waitForURL(`**/xrpl/amm/${LP.issuer}`);
    await expect(heading(page)).toHaveText("XRP / RLUSD pool");
  });

  test("a token the index does not know is a 404 that says so, with the coverage note and the issuer's account", async ({ page }) => {
    const response = await page.goto(`/xrpl/token/QQQ.${USD.issuer}`);
    expect(response?.status()).toBe(404);
    await expect(heading(page)).toHaveText("Not found");
    await expect(page.getByText(`We couldn’t find QQQ issued by ${USD.issuer.slice(0, 6)}…${USD.issuer.slice(-4)} on XRPL.`)).toBeVisible();
    await expect(page.getByRole("main")).toContainText(`Covers ledger #${count(listOf("xrpl").coverage.from_ledger_index!)} onwards: earlier trust lines are not in the index yet.`);
    await expect(page.getByRole("link", { name: "Open the issuer's account" })).toHaveAttribute("href", `/xrpl/account/${USD.issuer}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  test("a path that is no token is the not-found page", async ({ page }) => {
    for (const path of ["/xrpl/token/RLUSD", "/xrpl/token/RLUSD.nothing", "/xrpl/token/XRP.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(heading(page)).toHaveText("Not found");
    }
  });
});

test.describe("Xahau", () => {
  test.skip(TOKENS_OFF, "TOKENS is off in the Worker under test: its pages are not found (checked above)");

  test("the list is in XAH and DEX trades, and the MPT tab says that Xahau has no MPT", async ({ page }) => {
    await page.goto("/xahau/tokens");
    await hydrated(page);
    await expect(heading(page)).toHaveText("Tokens");
    await expect(page).toHaveTitle("Tokens · Xahau · explorer");
    const totals = listOf("xahau").totals!;
    await expect(tile(page, "Totals", "Tokens with 10+ holders").locator(".stat__value")).toHaveText(count(totals.tokens_with_10_holders));
    await expect(tile(page, "Totals", "Volume, 24 h").locator(".stat__value")).toHaveText(/ XAH$/);
    await expect(tile(page, "Totals", "Volume, 24 h").locator(".stat__sub")).toHaveText("DEX trades of every pair");
    await expect(page.getByRole("columnheader", { name: /^Price \(XAH\)/ })).toBeVisible();
    await expect(page.getByText("Price: the last trade against XAH.")).toBeVisible();
    const mpt = page.getByRole("group", { name: "Kind of token" }).locator(".netswitch__item.is-disabled");
    await expect(mpt).toHaveText("MPT");
    await expect(mpt).toHaveAccessibleDescription("MPT isn't enabled on Xahau.");
    await expect(page.getByText("MPT isn't enabled on Xahau.")).toBeVisible();
  });

  test("EVR's page prices in XAH, says that Xahau has no AMM, draws the toml's icon as text, and names the toml file by the network's", async ({ page }) => {
    const detail = detailOf("xahau", "evr");
    await page.goto("/xahau/token/" + EVR.path);
    await hydrated(page);
    await expect(heading(page)).toHaveText(detail.toml!.name!);
    await expect(tile(page, "Figures", "Price").locator(".stat__value")).toHaveText(`${detail.price} XAH`);
    await expect(card(page, "AMM pools")).toContainText(`Xahau has no AMM, so EVR trades only on the order book here.`);
    await expect(tableOf(page, "AMM pools")).toHaveCount(0);
    await expect(tableOf(page, "Markets")).toBeVisible();
    await expect(page.getByRole("link", { name: "xahau.toml (opens in a new tab)", exact: true })).toHaveAttribute("href", detail.toml_url!);

    // The toml's icon is an ipfs:// address, which is neither an https link nor an image: it is text, and no image is on the page from the issuer.
    const toml = card(page, `From ${detail.domain}'s toml`);
    const icon = toml.locator("dt", { hasText: /^icon$/ }).locator("xpath=following-sibling::dd[1]");
    await expect(icon).toHaveText(detail.toml!.icon!);
    await expect(icon.getByRole("link")).toHaveCount(0);
    await expect(toml.locator("img")).toHaveCount(0);
    await expect(page.locator('main img[src*="ipfs"]')).toHaveCount(0);
  });

  test("a token that is not listed has its holders page, with its limit and status columns, and a second page of holders", async ({ page }) => {
    const first = holdersOf("xahau", "xahau-unlisted");
    expect(first.marker, "the fixtures' token has more than 50 holders").toBeDefined();
    await page.goto(`/xahau/token/${XAHAU_UNLISTED.path}/holders`);
    await expect(heading(page)).toHaveText(`Holders of ${XAHAU_UNLISTED.currency}`);
    await expect(rowsOf(page, "Holders")).toHaveCount(first.holders.length);
    await expect(tableOf(page, "Holders").getByRole("columnheader", { name: "Limit" })).toBeVisible();
    await expect(tableOf(page, "Holders").getByRole("columnheader", { name: "Status" })).toBeVisible();
    // The fixtures' token requires authorization: its holders' lines are authorized, said in words.
    await expect(tableOf(page, "Holders").getByText("Authorized").first()).toBeVisible();
    await pagination(page).getByRole("link", { name: "More holders" }).click();
    await page.waitForURL((url) => url.searchParams.has("marker"));
    await expect(rowsOf(page, "Holders").first().locator('[role="cell"]').first()).toHaveText("51");
  });
});

test.describe("search for a token", () => {
  test.skip(TOKENS_OFF, "TOKENS is off in the Worker under test: the search asks no token question (checked above)");

  test("CUR.issuer in the header's box leads to the token's page, in one document", async ({ page }) => {
    await page.goto("/xrpl/tokens");
    await hydrated(page);
    await markDocument(page);
    const box = page.getByRole("banner").getByRole("searchbox", { name: "Search XRPL" });
    await box.fill(`USD.${USD.issuer}`);
    await box.press("Enter");
    await page.waitForURL(`**/xrpl/token/${USD.path}`);
    await expect(page).toHaveTitle(`USD by ${USD.issuer.slice(0, 6)}…${USD.issuer.slice(-4)} · XRPL · explorer`);
    expect(await sameDocument(page)).toBe(true);
  });

  test("another spelling of it (a plus, a code in lower case) is read the same way", async ({ page }) => {
    for (const text of [`usd+${USD.issuer}`, `USD ${USD.issuer}`]) {
      await page.goto(`/xrpl/search?q=${encodeURIComponent(text)}`);
      await expect(page, text).toHaveURL(new RegExp(`/xrpl/token/${USD.path}$`));
    }
  });

  test("a text that is no token offers the tokens whose names hold it, and the link leads to the list searched", async ({ page }) => {
    await page.goto("/xrpl/search?q=USD");
    const offer = page.getByRole("link", { name: "Look for “USD” among tokens →" });
    await expect(offer).toHaveAttribute("href", "/xrpl/tokens?q=USD");
    await offer.click();
    await page.waitForURL((url) => url.pathname === "/xrpl/tokens" && url.search === "?q=USD");
    await expect(tokenSearch(page)).toHaveValue("USD");
    await expect(tableOf(page, "Issued tokens").locator(`a[href="/xrpl/token/${USD.path}"]`)).toBeVisible();
  });

  test("an LP token's text leads to its pool", async ({ page }) => {
    await page.goto(`/xrpl/search?q=${encodeURIComponent(LP.path)}`);
    await expect(page).toHaveURL(new RegExp(`/xrpl/amm/${LP.issuer}$`));
  });
});

test.describe("without JavaScript", () => {
  test.skip(TOKENS_OFF, "TOKENS is off in the Worker under test: its pages are not found (checked above)");

  test("the list's form is a GET form that keeps `all`, Show all and the pager are links", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/xrpl/tokens");
    await expect(rowsOf(page, "Issued tokens")).toHaveCount(20);

    await page.getByRole("link", { name: /^Show all/ }).click();
    await page.waitForURL((url) => url.search === "?all=1");
    await tokenSearch(page).fill("USD");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForURL((url) => url.search === "?q=USD&all=1");
    await expect(rowsOf(page, "Issued tokens")).toHaveCount(listOf("xrpl", { q: "USD", all: true }).tokens.length);
    await expect(tokenSearch(page)).toHaveValue("USD");

    await page.getByRole("link", { name: "Hide tokens with fewer than 10 holders" }).click();
    await page.waitForURL((url) => url.search === "?q=USD");
    await page.getByRole("link", { name: /more among tokens with fewer than 10 holders/ }).click();
    await page.waitForURL((url) => url.search === "?q=USD&all=1");

    await page.goto("/xrpl/tokens");
    await pagination(page).getByRole("link", { name: "More tokens" }).click();
    await page.waitForURL((url) => url.searchParams.has("marker"));
    await expect.poll(async () => (await ranks(page))[0]).toBe(21);
    await pagination(page).getByRole("link", { name: "Previous" }).click();
    await page.waitForURL((url) => url.pathname === "/xrpl/tokens" && url.search === "");
    await expect.poll(async () => (await ranks(page))[0]).toBe(1);

    // A token's code is a link, too.
    await tableOf(page, "Issued tokens").locator(`a[href="${RLUSD_PATH}"]`).click();
    await page.waitForURL(`**${RLUSD_PATH}`);
  });

  test("a token's page and its holders: every card is the server's, the links and the pagers work", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    const detail = detailOf("xrpl", "rlusd");
    await page.goto(RLUSD_PATH);
    // Nothing on the page needs a script: every card is the server's.
    await expect(rowsOf(page, "Markets")).toHaveCount(detail.markets.length);
    await tableOf(page, "Markets").getByRole("link", { name: "RLUSD / XRP" }).click();
    await page.waitForURL(`**/xrpl/markets/XRP/${RLUSD.path}`);

    await page.goto(RLUSD_PATH);
    await pagination(page).getByRole("link", { name: "Older" }).click();
    await page.waitForURL((url) => url.searchParams.has("marker"));
    await pagination(page).getByRole("link", { name: "Newer" }).click();
    await page.waitForURL((url) => url.pathname === RLUSD_PATH && url.search === "");

    await page.getByRole("link", { name: `All ${count(detail.holders)} holders →` }).click();
    await page.waitForURL(`**${RLUSD_HOLDERS}`);
    await pagination(page).getByRole("link", { name: "More holders" }).click();
    await page.waitForURL((url) => url.searchParams.has("marker"));
    await pagination(page).getByRole("link", { name: "Previous" }).click();
    await page.waitForURL((url) => url.pathname === RLUSD_HOLDERS && url.search === "");
    await page.getByRole("link", { name: "Back to RLUSD" }).click();
    await page.waitForURL(`**${RLUSD_PATH}`);
  });
});

test.describe("the accounts on the pages", () => {
  test.skip(TOKENS_OFF, "TOKENS is off in the Worker under test: its pages are not found (checked above)");
  test.skip(featuresOff(process.env).has("NAMES"), "NAMES is off in the Worker under test: its off-case is the Worker specs' (pages-names-off.spec.ts)");

  // Every address is an `AccountLink` (E9): drawn by the name the fixtures give it, with the words of its marks and the title that says how it is known, or by its address. The pages are
  // those of `tokenNamedPages` (test/e2e/names-pages.ts), which a11y.spec.ts checks the accessible names of; between them the three kinds of names and a label are drawn.
  for (const under of namedPagesOn(tokenNamedPages(), featuresOff(process.env))) {
    test(`${under.name}: each link to an account is drawn by what the fixtures say, with the kinds of names the page has`, async ({ page }) => {
      await page.goto(under.path);
      await hydrated(page);
      await under.ready(page);
      const drawn = await expectAccountsDrawn(page.getByRole("main"), under.net, { full: "either", ...(under.own !== undefined && { except: under.own }) });
      expect([...drawn.kinds].sort()).toEqual(expect.arrayContaining(under.kinds.slice().sort()));
      // The token's page names its issuer in full, apart from the button: the link under "Issued by" is the issuer, drawn as the fixtures say.
      if (under.own !== undefined) await expectAccountsDrawn(page.locator("p.token-page__issuer"), under.net, { full: true });
    });
  }
});
