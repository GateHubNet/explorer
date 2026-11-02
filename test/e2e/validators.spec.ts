import { createRequire } from "node:module";

import type { Page } from "@playwright/test";

import { LIVE } from "./fixtures";
import { expect, hydrated, test } from "./support";
import { headOf, listedValidator, needs, rowsOf, SKIP_MAP_OFF, SKIP_OFF, tomlFullKey, tomlLongKey, VALIDATORS_MAP_OFF, VALIDATORS_OFF, validatorsTable, withHistory } from "./validators-pages";

// The validators list (`/{net}/validators`) and a validator's page (`/{net}/validators/{key}`) in a browser: the way from the network page, the views
// (a scope and a filter are URLs), the filter form with and without JavaScript, the versions chart without it, and on a validator's page the copy
// buttons, the slider of its 30 days, its older validations and a key written in hex. Every validator is read from the pages, so the suite runs against
// a real stack too; nothing here changes what the fixture server answers (validators-live.spec.ts does).
//
// Where E2E_FEATURES_OFF lists VALIDATORS (a sandbox or production that has the switch off), the tests of the pages skip themselves and the off-case
// below runs instead. The same for VALIDATORS_MAP (E13): the countries card, the Country select, the place under a row and the validator's toml card are in their own blocks
// ("with VALIDATORS_MAP on" and "with VALIDATORS_MAP off"). The countries and the toml cases are read from the pages and, for the toml cases, from the fixtures' files
// (validators-pages.ts: a real stack has no toml-full to look for, and `needs` skips there).

// The codec as Node loads it (its CommonJS build): Playwright's loader of the specs does not take it as an import.
const { decodeNodePublic } = createRequire(import.meta.url)("ripple-address-codec") as typeof import("ripple-address-codec");

const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);
const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { sameDocument: true }));

/** The card of the network page that counts the validators. */
const validatorsCard = (page: Page) => page.locator(".network__validators");
/** The versions card of the list, found by the id of its title. */
const versionsCard = (page: Page) => page.locator('section[aria-labelledby="validators-versions-title"]');
/** The countries card of the list, found by the id of its title (E13). */
const mapCard = (page: Page) => page.locator('section[aria-labelledby="validators-map-title"]');
/** The card's table: exact, because "Validators" (the list's table) is a substring of it. */
const countryTable = (page: Page) => mapCard(page).getByRole("table", { name: "Validators by country", exact: true });
const circlesOf = (page: Page) => mapCard(page).locator("a.vmap__circle");
/** The list's filter form, where the Country select is. */
const filters = (page: Page) => page.getByRole("main").getByRole("search", { name: "Filter validators" });

/** A row of the countries table: its name, the code its link leads to (`null` for a name with no link), and its counts. */
interface CountryRow {
  name: string;
  code: string | null;
  validators: number;
  unl: number;
}

async function countriesOf(page: Page): Promise<CountryRow[]> {
  await expect(rowsOf(countryTable(page)).first()).toBeVisible();
  return rowsOf(countryTable(page)).evaluateAll((rows) =>
    rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('[role="cell"]'), (cell) => cell.textContent ?? "");
      const href = row.querySelector("a")?.getAttribute("href") ?? null;
      return {
        name: cells[0]!.trim(),
        code: href === null ? null : (new URL(href, "https://explorer.test").searchParams.get("country") ?? null),
        validators: Number(cells[1]!.replace(/\D/g, "")),
        unl: Number(cells[2]!.replace(/\D/g, "")),
      };
    }),
  );
}

/** The countries with a validator on the UNL (the default view shows those) and a link, in the table's order. */
async function onTheUnl(page: Page): Promise<(CountryRow & { code: string })[]> {
  const found = (await countriesOf(page)).filter((row): row is CountryRow & { code: string } => row.code !== null && row.unl > 0);
  needs(found.length >= 2, "two countries with a validator on the UNL (the countries card)");
  return found;
}

/** The places the rows of the list say, `· Germany` without its dot. */
const placesOf = (page: Page) => rowsOf(validatorsTable(page)).locator(".validators__place");

test.describe("with VALIDATORS on", () => {
  test.skip(VALIDATORS_OFF, SKIP_OFF);

  test.describe("from the network page", () => {
    test("'All validators' lands on /xrpl/validators?scope=all, and a first-seen key on its validator's page", async ({ page }) => {
      await page.goto("/xrpl/network");
      await hydrated(page);
      await markDocument(page);
      const card = validatorsCard(page);
      await card.getByRole("link", { name: "All validators" }).click();
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === "?scope=all");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Validators");
      await expect(page.getByRole("group", { name: "Which validators" }).getByRole("link", { name: /^All\b/ })).toHaveAttribute("aria-current", "true");
      // The header's Network menu is the section's (its summary: inside it, not its index), and its Validators item the page, whatever the query.
      const menu = page.getByRole("navigation", { name: "Main" }).locator('details[data-menu="network"]');
      await expect(menu.locator("summary")).toHaveAttribute("aria-current", "true");
      await expect(menu.getByRole("link", { name: "Validators", includeHidden: true })).toHaveAttribute("aria-current", "page");

      await page.goBack();
      await page.waitForURL("**/xrpl/network");
      const first = card.locator(".network__first a").first();
      await expect(card.locator(".network__first a")).toHaveCount(5);
      const href = (await first.getAttribute("href"))!;
      expect(href).toMatch(/^\/xrpl\/validators\/n[1-9A-HJ-NP-Za-km-z]+$/);
      await first.click();
      // The validations name master keys, as the fixtures do; on a real stack a signing key there would be redirected to its master's page.
      await page.waitForURL((url) => (LIVE ? url.pathname.startsWith("/xrpl/validators/n") : url.pathname === href));
      await expect(page.locator(".validator__master")).toContainText(LIVE ? /^n/ : href.slice(href.lastIndexOf("/") + 1));
      await expect(page.getByText("Live · updates every ledger")).toBeVisible();
      expect(await sameDocument(page)).toBe(true);
    });
  });

  test.describe("the list", () => {
    test("is the UNL by default: the table, the scope links with their counts, the live row, a canonical link and no noindex", async ({ page }) => {
      await page.goto("/xrpl/validators");
      await hydrated(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Validators");
      await expect(page).toHaveTitle("Validators · XRPL · explorer");
      const scopes = page.getByRole("group", { name: "Which validators" });
      await expect(scopes.getByRole("link")).toHaveText([/^UNL \d[\d,]*$/, /^All \d[\d,]*$/]);
      await expect(scopes.getByRole("link", { name: /^UNL/ })).toHaveAttribute("aria-current", "true");
      const unl = Number((await scopes.getByRole("link", { name: /^UNL/ }).textContent())!.replace(/\D/g, ""));
      await expect(rowsOf(validatorsTable(page))).toHaveCount(unl);
      await expect(page.getByText("Live · updates every 10 s")).toBeVisible();
      await expect(page.getByRole("button", { name: "Pause live updates" })).toBeVisible();
      const head = await headOf(page);
      expect(head.canonical).toMatch(/\/xrpl\/validators$/);
      expect(head.robots).toBeNull();
      // The filters are a search landmark of their own, beside the header's.
      await expect(page.getByRole("search", { name: "Filter validators" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Amendments →" })).toHaveAttribute("href", "/xrpl/amendments");
    });

    test("'All' is ?scope=all with noindex and no canonical link, and Back restores the page", async ({ page }) => {
      await page.goto("/xrpl/validators");
      await hydrated(page);
      await markDocument(page);
      const first = await headOf(page);
      const scopes = page.getByRole("group", { name: "Which validators" });
      const all = Number((await scopes.getByRole("link", { name: /^All/ }).textContent())!.replace(/\D/g, ""));

      await scopes.getByRole("link", { name: /^All/ }).click();
      await page.waitForURL((url) => url.search === "?scope=all");
      await expect(scopes.getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "true");
      await expect(rowsOf(validatorsTable(page))).toHaveCount(all);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

      await page.goBack();
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === "");
      await expect(scopes.getByRole("link", { name: /^UNL/ })).toHaveAttribute("aria-current", "true");
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
      expect(await headOf(page)).toEqual(first);
      expect(await sameDocument(page)).toBe(true);
    });

    test("searches through the form with JavaScript: Apply goes straight to the canonical address, with no redirect asked for", async ({ page }) => {
      const { name } = await listedValidator(page, "verified");
      await markDocument(page);
      const asked: string[] = [];
      const redirects: string[] = [];
      page.on("request", (request) => asked.push(request.url()));
      page.on("response", (response) => {
        if (response.status() >= 300 && response.status() < 400) redirects.push(response.url());
      });

      await page.getByRole("searchbox", { name: "Search validators by domain or key" }).fill(`  ${name}  `);
      await page.getByRole("button", { name: "Apply" }).click();
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === `?q=${encodeURIComponent(name)}`);
      // Retrying assertions, not a loop over `rows.all()`: the URL changes before the filtered list is drawn, and the validator was picked
      // from the unfiltered one, whose first row may be it. The old rows would be taken, then go away under the loop.
      const rows = rowsOf(validatorsTable(page));
      await expect(rows.first()).toContainText(name);
      await expect(rows.filter({ hasNotText: name })).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");

      expect(redirects).toEqual([]);
      // The page's own `.data`, for the canonical query and nothing else: the empty fields and the spaces never reached the Worker.
      const data = asked.filter((url) => new URL(url).pathname === "/xrpl/validators.data");
      expect(data.length).toBeGreaterThanOrEqual(1);
      for (const url of data) expect([...new URL(url).searchParams.keys()].filter((key) => key !== "_routes")).toEqual(["q"]);
      expect(await sameDocument(page)).toBe(true);
    });

    test("searches through the form without JavaScript: the Worker's redirect tidies the empty fields away", async ({ contextFor }) => {
      const context = await contextFor({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto("/xrpl/validators");
      const name = (await rowsOf(validatorsTable(page)).locator("a.validators__name").first().textContent())!.trim();

      await page.getByRole("searchbox", { name: "Search validators by domain or key" }).fill(name);
      const [response] = await Promise.all([
        page.waitForResponse((answer) => answer.request().resourceType() === "document" && answer.status() === 200),
        page.getByRole("button", { name: "Apply" }).click(),
      ]);
      expect(new URL(page.url()).search).toBe(`?q=${encodeURIComponent(name)}`);
      // The form sent every field, the empty selects as well; the Worker answered that with a 302 to the canonical form.
      const sent = new URL(response.request().redirectedFrom()!.url());
      expect(sent.searchParams.get("q")).toBe(name);
      expect([...sent.searchParams.entries()].filter(([, value]) => value === "").length).toBeGreaterThanOrEqual(1);
      await expect(rowsOf(validatorsTable(page)).first()).toContainText(name);
    });

    test("filters by 'Votes yes for' and 'Listed by' on XRPL, and Clear filters goes back to the scope", async ({ page }) => {
      await page.goto("/xrpl/validators");
      await hydrated(page);
      const before = await rowsOf(validatorsTable(page)).count();

      const votes = page.getByLabel("Votes yes for");
      // "any amendment", then the ones being voted on: a stack between votes may have none.
      needs((await votes.locator("option").count()) >= 2, `amendment being voted on ("Votes yes for" and its options)`);
      const amendment = (await votes.locator("option").nth(1).getAttribute("value"))!;
      await votes.selectOption(amendment);
      await page.getByRole("button", { name: "Apply" }).click();
      await page.waitForURL((url) => url.searchParams.get("amendment") === amendment && [...url.searchParams.keys()].length === 1);
      // The URL changes before the filtered list is drawn, and the form takes its values from the page it draws: a choice made before
      // then would be put back to the URL's and lost. "Clear filters" is only on a filtered list.
      await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
      await expect(votes).toHaveValue(amendment);
      expect(await rowsOf(validatorsTable(page)).count()).toBeLessThanOrEqual(before);

      const listedBy = page.getByLabel("Listed by");
      const publisher = (await listedBy.locator("option").nth(1).getAttribute("value"))!;
      await listedBy.selectOption(publisher);
      await page.getByRole("button", { name: "Apply" }).click();
      // In the canonical order: the publisher, then the amendment.
      await page.waitForURL((url) => url.search === `?publisher=${encodeURIComponent(publisher)}&amendment=${encodeURIComponent(amendment)}`);
      await expect(listedBy).toHaveValue(publisher);
      // Retrying (see the search test): the list may still be the one before Apply. A row of the publisher first, so that an empty table
      // (which has no row without it either) does not pass.
      await expect(rowsOf(validatorsTable(page)).first()).toContainText(publisher);
      await expect(rowsOf(validatorsTable(page)).filter({ hasNotText: publisher })).toHaveCount(0);

      await page.getByRole("link", { name: "Clear filters" }).click();
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === "");
      await expect(rowsOf(validatorsTable(page))).toHaveCount(before);
      await expect(page.getByRole("link", { name: "Clear filters" })).toHaveCount(0);
      await expect(listedBy).toHaveValue("");
    });

    test("has no 'Listed by' on Xahau, which publishes no list of its own here", async ({ page }) => {
      await page.goto("/xahau/validators");
      await hydrated(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Validators");
      await expect(page.getByRole("search", { name: "Filter validators" })).toBeVisible();
      await expect(page.getByLabel("Listed by")).toHaveCount(0);
    });

    test("leads from a row to the validator's page", async ({ page }) => {
      const { name, href } = await listedValidator(page);
      await markDocument(page);
      await rowsOf(validatorsTable(page)).locator("a.validators__name").first().click();
      await page.waitForURL((url) => url.pathname === href);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
      await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Validators" })).toHaveAttribute("href", "/xrpl/validators");
      expect(await sameDocument(page)).toBe(true);
    });

    test("swaps the versions chart for its table with the Table radio, without JavaScript", async ({ contextFor }) => {
      const context = await contextFor({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto("/xrpl/validators");
      const card = versionsCard(page);
      await expect(card.locator(".chart__view")).toBeVisible();
      await expect(card.locator(".chart__table")).toBeHidden();
      await expect(card.getByRole("radio", { name: "Chart" })).toBeChecked();

      await card.getByRole("radio", { name: "Table" }).check();
      await expect(card.locator(".chart__view")).toBeHidden();
      await expect(card.locator(".chart__table")).toBeVisible();
      expect(await rowsOf(card.getByRole("table", { name: "Validator software versions" })).count()).toBeGreaterThanOrEqual(1);
      // Nothing here is scripted: the share bar's slider is the script's.
      await expect(page.getByRole("slider")).toHaveCount(0);
    });
  });

  test.describe("a validator's page", () => {
    test("copies the master key and the signing key, and says so", async ({ contextFor }) => {
      const context = await contextFor({ permissions: ["clipboard-read", "clipboard-write"] });
      const page = await context.newPage();
      const { key } = await listedValidator(page, "verified");
      await page.goto(`/xrpl/validators/${key}`);
      await hydrated(page);

      const master = page.locator(".validator__master");
      await master.getByRole("button", { name: "Copy master public key" }).click();
      await expect(master.getByRole("status")).toHaveText("Copied");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);

      const signing = page.locator(".validator__fact", { hasText: "Current signing key" });
      const signingKey = (await signing.locator(".mono").getAttribute("title"))!;
      await signing.getByRole("button", { name: "Copy signing key" }).click();
      await expect(signing.getByRole("status")).toHaveText("Copied");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(signingKey);
    });

    test("moves the agreement chart's slider with the arrow keys, and says the day it is on", async ({ page }) => {
      const { key } = await listedValidator(page, "verified");
      await page.goto(`/xrpl/validators/${key}`);
      await hydrated(page);
      const slider = page.getByRole("slider", { name: "Daily agreement with validated ledgers, last 30 days, day by day" });
      await slider.focus();
      // It starts on the newest day.
      const newest = Number(await slider.getAttribute("aria-valuemax"));
      await expect(slider).toHaveAttribute("aria-valuenow", String(newest));
      const said = (await slider.getAttribute("aria-valuetext"))!;
      expect(said).toMatch(/Agreement/);

      await page.keyboard.press("ArrowLeft");
      await expect(slider).toHaveAttribute("aria-valuenow", String(newest - 1));
      await expect(slider).not.toHaveAttribute("aria-valuetext", said);
      await page.keyboard.press("ArrowRight");
      await expect(slider).toHaveAttribute("aria-valuetext", said);
    });

    test("pages to its older validations and back: Older keeps the key with a marker, has no live row and is noindex; Newer is the live page", async ({ page }) => {
      const key = await withHistory(page);
      await page.goto(`/xrpl/validators/${key}`);
      await hydrated(page);
      const table = page.getByRole("table", { name: "Recent validations" });
      const rows = rowsOf(table);
      await expect(rows.first()).toBeVisible();
      const oldestHere = (await rows.last().locator("a").first().textContent())!;
      const pager = page.getByRole("navigation", { name: "Pagination" });

      await pager.getByRole("link", { name: "Older" }).click();
      await page.waitForURL((url) => url.pathname === `/xrpl/validators/${key}` && url.searchParams.has("marker"));
      // The URL changes before the older page is drawn, and the live page's first row already lacks its oldest ledger: wait for what
      // only the older page has (it is kept out of the index), then compare, retrying.
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
      await expect(rows.first()).not.toContainText(oldestHere);
      const ledgerOf = (text: string) => Number(text.replace(/\D/g, ""));
      // A ledger link in the first row, so that a missing one (no number, 0) cannot pass as "older".
      const olderLedger = rows.first().locator("a").first();
      await expect(olderLedger).toHaveText(/\d/);
      await expect.poll(async () => ledgerOf((await olderLedger.textContent())!)).toBeLessThan(ledgerOf(oldestHere));
      await expect(page.getByText("Live · updates every ledger")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Pause live updates" })).toHaveCount(0);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

      await pager.getByRole("link", { name: "Newer" }).click();
      await page.waitForURL((url) => url.pathname === `/xrpl/validators/${key}` && url.search === "");
      await expect(page.getByText("Live · updates every ledger")).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    });

    test("lands on the base58 URL from the key written in hex", async ({ page }) => {
      const { key } = await listedValidator(page, "verified");
      const hex = Buffer.from(decodeNodePublic(key)).toString("hex");
      expect(hex).toHaveLength(66);
      const response = await page.goto(`/xrpl/validators/${hex}`);
      expect(response!.status()).toBe(200);
      expect(response!.request().redirectedFrom()?.url()).toMatch(new RegExp(`/xrpl/validators/${hex}$`));
      expect(new URL(page.url()).pathname).toBe(`/xrpl/validators/${key}`);
      await expect(page.locator(".validator__master")).toContainText(key);
    });
  });
});

test.describe("with VALIDATORS_MAP on", () => {
  test.skip(VALIDATORS_OFF || VALIDATORS_MAP_OFF, SKIP_MAP_OFF);

  test.describe("the countries card", () => {
    test("draws the map, and serves its asset as svg kept a year", async ({ page }) => {
      const assets: { url: string; status: number }[] = [];
      page.on("response", (response) => {
        if (/world-dots/.test(response.url())) assets.push({ url: response.url(), status: response.status() });
      });
      await page.goto("/xrpl/validators");
      await hydrated(page);
      const card = mapCard(page);
      await expect(card.getByRole("heading", { level: 2, name: "Where validators are" })).toBeVisible();
      await expect(card.getByRole("group", { name: "Map of validators by country" })).toBeVisible();
      needs((await circlesOf(page).count()) > 0, "validator whose toml gives a server country (a circle)");
      await expect(card.locator(".fchip")).toContainText("Unknown location:");
      await expect(card.locator(".vmapcard__attribution")).toContainText("verified xrp-ledger.toml");

      // The dots are a file of the build, drawn with <use>: the page asked for it and the Worker answers it as the build's files are answered.
      const href = await card.locator("svg.vmap__dots use").getAttribute("href");
      const asset = new URL(href!, page.url());
      expect(asset.hash).toBe("#dots");
      expect(asset.pathname).toMatch(/^\/assets\/world-dots-[\w-]+\.svg$/);
      const response = await page.request.get(asset.pathname);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/svg+xml");
      expect(response.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(await response.text()).toContain('<path id="dots"');
      expect(assets.length).toBeGreaterThanOrEqual(1);
      expect(assets.every((seen) => seen.status === 200)).toBe(true);
    });

    test("narrows the list by a circle, a table link, the chip and the select", async ({ page }) => {
      await page.goto("/xrpl/validators");
      await hydrated(page);
      await markDocument(page);
      const card = mapCard(page);
      const everyone = await rowsOf(validatorsTable(page)).count();
      const [first, second] = await onTheUnl(page);
      // The circle's name is `Germany: 6 validators, 3 on the UNL`; the table's link is the name alone.
      const circle = (row: CountryRow) => card.getByRole("link", { name: new RegExp(`^${row.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: `) });
      const link = (row: CountryRow) => countryTable(page).getByRole("link", { name: row.name, exact: true });
      const lead = (row: CountryRow & { code: string }) => page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === `?country=${row.code}`);

      // A circle: the list is that country's (the default view shows the UNL's), circle and row are current, and the card says what it shows.
      await circle(first!).click();
      await lead(first!);
      await expect(rowsOf(validatorsTable(page))).toHaveCount(first!.unl);
      await expect(placesOf(page)).toHaveCount(first!.unl);
      await expect(placesOf(page).filter({ hasNotText: `· ${first!.name}` })).toHaveCount(0);
      await expect(circle(first!)).toHaveAttribute("aria-current", "true");
      await expect(link(first!)).toHaveAttribute("aria-current", "true");
      await expect(rowsOf(countryTable(page)).filter({ has: page.getByRole("link", { name: first!.name, exact: true }) })).toHaveClass(/is-current/);
      await expect(card.locator(".vmapcard__chosen strong")).toHaveText(first!.name);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      // The select shows the view it is on.
      await expect(filters(page).getByLabel("Country", { exact: true })).toHaveValue(first!.code);

      // "Clear country" is back to the view without it.
      await card.getByRole("link", { name: "Clear country", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === "");
      await expect(rowsOf(validatorsTable(page))).toHaveCount(everyone);
      await expect(card.getByRole("link", { name: "Clear country", exact: true })).toHaveCount(0);

      // A name in the table, and the same link again, which is "show every country".
      await link(second!).click();
      await lead(second!);
      await expect(rowsOf(validatorsTable(page))).toHaveCount(second!.unl);
      await expect(placesOf(page).filter({ hasNotText: `· ${second!.name}` })).toHaveCount(0);
      await expect(link(second!)).toHaveAttribute("aria-current", "true");
      await link(second!).click();
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === "");
      await expect(rowsOf(validatorsTable(page))).toHaveCount(everyone);

      // The chip: the validators whose location is unknown, which the list shows with no place under them.
      const chip = card.getByRole("link", { name: /^Unknown location:/ });
      needs((await chip.count()) === 1, "validator of unknown location (the chip)");
      await chip.click();
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === "?country=unknown");
      await expect(card.locator(".vmapcard__chosen strong")).toHaveText("Unknown location");
      await expect(filters(page).getByLabel("Country", { exact: true })).toHaveValue("unknown");
      await expect(rowsOf(validatorsTable(page)).first()).toBeVisible();
      await expect(placesOf(page)).toHaveCount(0);
      await card.getByRole("link", { name: "Clear country", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === "");

      // The select, with Apply: the same view as the circle's, with no redirect asked for.
      const asked: string[] = [];
      page.on("response", (response) => {
        if (response.status() >= 300 && response.status() < 400) asked.push(response.url());
      });
      await filters(page).getByLabel("Country", { exact: true }).selectOption(first!.code);
      await filters(page).getByRole("button", { name: "Apply" }).click();
      await lead(first!);
      await expect(rowsOf(validatorsTable(page))).toHaveCount(first!.unl);
      await expect(placesOf(page).filter({ hasNotText: `· ${first!.name}` })).toHaveCount(0);
      await expect(circle(first!)).toHaveAttribute("aria-current", "true");
      expect(asked).toEqual([]);
      expect(await sameDocument(page)).toBe(true);
    });

    test("moves through the circles with the keyboard", async ({ page }) => {
      await page.goto("/xrpl/validators");
      await hydrated(page);
      const card = mapCard(page);
      needs((await circlesOf(page).count()) >= 3, "three countries on the map");
      // One circle is the Tab stop, the others are reached with the arrow keys.
      const stop = card.locator('a.vmap__circle[tabindex="0"]');
      await expect(stop).toHaveCount(1);
      const focused = page.locator("a.vmap__circle:focus");

      // Start from a control inside the page: the header's menus (and their hidden links) come first in the tab order.
      await page.getByRole("button", { name: "Pause live updates" }).focus();
      for (let tabs = 0; tabs < 30 && (await focused.count()) === 0; tabs += 1) await page.keyboard.press("Tab");
      await expect(stop).toBeFocused();
      // The tooltip is the circle's words, shown on focus, and the card is as wide as it needs to be for one.
      const nameOf = async () => ((await focused.getAttribute("aria-label")) ?? "").split(":")[0]!;
      await expect(card.locator(".vmap__tip strong")).toHaveText(await nameOf());
      await page.keyboard.press("Tab");
      await expect(focused).toHaveCount(0);
      await page.keyboard.press("Shift+Tab");
      await expect(stop).toBeFocused();

      // West to east: the points of the circles, as the page wrote them.
      const west = await circlesOf(page).evaluateAll((circles) =>
        circles
          .map((circle) => ({ name: (circle.getAttribute("aria-label") ?? "").split(":")[0]!, left: parseFloat((circle as HTMLElement).style.left), top: parseFloat((circle as HTMLElement).style.top) }))
          .sort((a, b) => a.left - b.left || a.top - b.top)
          .map((circle) => circle.name),
      );
      await page.keyboard.press("Home");
      expect(await nameOf()).toBe(west[0]);
      await expect(card.locator(".vmap__tip strong")).toHaveText(west[0]!);
      await page.keyboard.press("ArrowRight");
      expect(await nameOf()).toBe(west[1]);
      await expect(card.locator(".vmap__tip strong")).toHaveText(west[1]!);
      // The Tab stop moved with the arrow key: Shift+Tab leaves the map (it does not land on the first stop), and Tab comes back to the circle it left.
      await expect(stop).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(focused).toHaveCount(0);
      await page.keyboard.press("Tab");
      await expect(stop).toBeFocused();
      expect(await nameOf()).toBe(west[1]);
      await page.keyboard.press("ArrowDown");
      expect(await nameOf()).toBe(west[2]);
      await page.keyboard.press("ArrowLeft");
      expect(await nameOf()).toBe(west[1]);
      await page.keyboard.press("End");
      expect(await nameOf()).toBe(west.at(-1));
      // The last one stays where it is, and Escape puts the tooltip away without moving the focus.
      await page.keyboard.press("ArrowRight");
      expect(await nameOf()).toBe(west.at(-1));
      await page.keyboard.press("Escape");
      await expect(card.locator(".vmap__tip")).toHaveCount(0);
      expect(await nameOf()).toBe(west.at(-1));

      // Enter follows the link.
      const code = await focused.getAttribute("data-code");
      await page.keyboard.press("Enter");
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === `?country=${code}`);
      await expect(card.locator(`a.vmap__circle[data-code="${code}"]`)).toHaveAttribute("aria-current", "true");
    });

    test("works without JavaScript: a circle and a name in the table are links, and the select is a form", async ({ contextFor }) => {
      const context = await contextFor({ javaScriptEnabled: false });
      const page = await context.newPage();
      const assets: number[] = [];
      page.on("response", (response) => {
        if (/world-dots/.test(response.url())) assets.push(response.status());
      });
      await page.goto("/xrpl/validators");
      const card = mapCard(page);
      const [first, second] = await onTheUnl(page);
      const everyone = await rowsOf(validatorsTable(page)).count();
      const circle = (row: CountryRow) => card.getByRole("link", { name: new RegExp(`^${row.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: `) });

      // The circle is a link: a new document, with the country's rows.
      await circle(first!).click();
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === `?country=${first!.code}`);
      await expect(rowsOf(validatorsTable(page))).toHaveCount(first!.unl);
      await expect(placesOf(page).filter({ hasNotText: `· ${first!.name}` })).toHaveCount(0);
      await expect(circle(first!)).toHaveAttribute("aria-current", "true");

      // A name in the table, then Clear country.
      await countryTable(page).getByRole("link", { name: second!.name, exact: true }).click();
      await page.waitForURL((url) => url.search === `?country=${second!.code}`);
      await expect(rowsOf(validatorsTable(page))).toHaveCount(second!.unl);
      await card.getByRole("link", { name: "Clear country", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === "");
      await expect(rowsOf(validatorsTable(page))).toHaveCount(everyone);

      // The select and Apply: the form sends every field, and the Worker's redirect tidies the empty ones away.
      await filters(page).getByLabel("Country", { exact: true }).selectOption(first!.code);
      await filters(page).getByRole("button", { name: "Apply" }).click();
      await page.waitForURL((url) => url.pathname === "/xrpl/validators" && url.search === `?country=${first!.code}`);
      await expect(rowsOf(validatorsTable(page))).toHaveCount(first!.unl);
      // The dots came all the same: the page draws them with a <use>, and the browser fetched the file without a script.
      expect(assets.length).toBeGreaterThanOrEqual(1);
      expect(assets.every((status) => status === 200)).toBe(true);
    });
  });

  test.describe("a validator's toml card", () => {
    test("shows the validator's toml card, its View toml link and its account names", async ({ page }) => {
      const full = tomlFullKey("xrpl");
      needs(full !== null, "validator whose toml D8 has read in full (the fixtures' toml-full)");
      await page.goto(`/xrpl/validators/${full!.key}`);
      await hydrated(page);
      const main = page.getByRole("main");
      const card = main.getByRole("region", { name: `From ${full!.domain}'s toml` });
      await expect(card).toBeVisible();

      // The link to the file: the domain's own address, to another site, with the file's name for a screen reader.
      const view = card.getByRole("link", { name: /^View toml/ });
      await expect(view).toHaveAttribute("href", `https://${full!.domain}/.well-known/xrp-ledger.toml`);
      await expect(view).toHaveAttribute("target", "_blank");
      await expect(view).toHaveAttribute("rel", /\bnofollow\b/);
      await expect(view.locator(".sr", { hasText: ", xrp-ledger.toml" })).toBeAttached();

      // The two checks and the facts.
      await expect(card.getByText("Domain, verified both ways")).toBeVisible();
      await expect(card.getByRole("listitem")).toHaveCount(2);
      await expect(card.getByText(`The validator's manifest names ${full!.domain}.`)).toBeVisible();
      for (const label of ["Server country", "Network", "On a UNL, says the toml", "Principals", "Last modified"]) await expect(card.getByText(label, { exact: true })).toBeVisible();
      await expect(card.getByText("Mara Lindqvist and Tomas Okafor")).toBeVisible();

      // The accounts the domain lists are the card's now, each with the name E9's names give it (the short address is the link's text when nobody names it).
      await expect(main.getByText(`Accounts ${full!.domain} lists`)).toHaveCount(0);
      const accounts = card.getByRole("group", { name: "Accounts [[ACCOUNTS]]" });
      const links = accounts.getByRole("link");
      expect(await links.count()).toBeGreaterThanOrEqual(1);
      await expect(accounts).toContainText("listed:");
      await expect(accounts).toContainText("more");
      for (const name of await links.allTextContents()) expect(name).not.toMatch(/^r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}$/);
      // ... and the currencies: a link to the token page for the one with an issuer.
      const currencies = card.getByRole("group", { name: "Currencies [[CURRENCIES]]" });
      await expect(currencies.getByRole("link", { name: "USD", exact: true })).toHaveAttribute("href", /^\/xrpl\/token\/USD\.r/);

      // Between the identity and the agreement tiles.
      const [identity, box, tiles] = await Promise.all([
        main.getByRole("region", { name: "Validator", exact: true }).boundingBox(),
        card.boundingBox(),
        main.getByRole("region", { name: "Agreement", exact: true }).boundingBox(),
      ]);
      expect(identity!.y + identity!.height).toBeLessThanOrEqual(box!.y);
      expect(box!.y + box!.height).toBeLessThanOrEqual(tiles!.y);
    });

    test("is Xahau's on Xahau: its own file", async ({ page }) => {
      const full = tomlFullKey("xahau");
      needs(full !== null, "Xahau validator whose toml D8 has read in full");
      await page.goto(`/xahau/validators/${full!.key}`);
      await hydrated(page);
      const card = page.getByRole("main").getByRole("region", { name: `From ${full!.domain}'s toml` });
      await expect(card.getByRole("link", { name: /^View toml/ })).toHaveAttribute("href", `https://${full!.domain}/.well-known/xahau.toml`);
      await expect(card.getByText(`${full!.domain}'s xahau.toml includes this master key.`)).toBeVisible();
    });

    test("draws no card on a page of older validations", async ({ page }) => {
      const key = await withHistory(page);
      await page.goto(`/xrpl/validators/${key}`);
      await hydrated(page);
      await expect(page.getByRole("table", { name: "Recent validations" })).toBeVisible();
      // The live page of this validator has its card where the fixtures have read its file; a real stack may not have.
      if (!LIVE) await expect(page.getByRole("main").getByRole("region", { name: /'s toml$/ })).toBeVisible();

      await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Older" }).click();
      await page.waitForURL((url) => url.pathname === `/xrpl/validators/${key}` && url.searchParams.has("marker"));
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
      await expect(page.getByRole("main").getByRole("region", { name: /'s toml$/ })).toHaveCount(0);
      await expect(page.getByText("View toml")).toHaveCount(0);
    });
  });

  // The longest texts the data API keeps (E13 ruling C8, E11's I1: a defect no test saw): a server in the longest-named country, a 100-character principal, a 32-character network, a
  // 200-character host and a 40-digit code. No page scrolls sideways, and no cell, fact or list is wider than its box.
  for (const width of [375, 1280]) {
    test.describe(`the longest texts at ${width} px`, () => {
      test.use({ viewport: { width, height: 900 }, colorScheme: "light" });

      /** What is wider than its box in `scope`: a cell of a table, a fact of the toml card, a list of it. (The other cards' tables scroll inside their own boxes, as they always did.) */
      const overflowing = (page: Page, scope: string) =>
        page.evaluate(
          (within) =>
            Array.from(
              document.querySelectorAll<HTMLElement>(
                [`${within} [role="cell"]`, `${within} [role="columnheader"]`, `${within} .validator__value`, `${within} .validator__sub`, `${within} .validator__checks li`, `${within} .validator__tomlitems`].join(", "),
              ),
            )
              .filter((element) => element.scrollWidth > element.clientWidth)
              .map((element) => `${element.className || element.getAttribute("role")} ${element.scrollWidth} > ${element.clientWidth}: ${element.textContent?.slice(0, 50)}`),
          scope,
        );
      const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

      test("the toml card of a validator that says everything at the length D8 keeps", async ({ page }) => {
        const long = tomlLongKey("xrpl");
        needs(long !== null, "validator whose toml says everything at its longest (the fixtures' toml-long)");
        await page.goto(`/xrpl/validators/${long!.key}`);
        await hydrated(page);
        await expect(page.getByRole("main").getByRole("region", { name: `From ${long!.domain}'s toml` })).toBeVisible();
        await expect(page.getByText("LongPrincipalName", { exact: false })).toBeVisible();
        expect(await overflowing(page, ".validator__toml")).toEqual([]);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });

      test("the list of a country with the longest name", async ({ page }) => {
        const long = tomlLongKey("xrpl");
        needs(long !== null, "validator whose toml says everything at its longest (the fixtures' toml-long)");
        await page.goto("/xrpl/validators?scope=all&country=GS");
        await hydrated(page);
        await expect(rowsOf(validatorsTable(page)).first()).toBeVisible();
        await expect(placesOf(page).first()).toContainText("South Georgia");
        await expect(mapCard(page).locator(".vmapcard__chosen strong")).toContainText("South Georgia");
        expect(await overflowing(page, "main")).toEqual([]);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });
    });
  }
});

test.describe("with VALIDATORS_MAP off", () => {
  test.skip(VALIDATORS_OFF || !VALIDATORS_MAP_OFF, "VALIDATORS_MAP is on in the Worker under test: the map and the card are checked above");

  test("the list has no countries card, no Country select and no place under a row", async ({ page }) => {
    await page.goto("/xrpl/validators");
    await hydrated(page);
    await expect(rowsOf(validatorsTable(page)).first()).toBeVisible();
    await expect(mapCard(page)).toHaveCount(0);
    await expect(page.getByRole("main").getByText("Where validators are", { exact: true })).toHaveCount(0);
    await expect(filters(page).getByLabel("Country", { exact: true })).toHaveCount(0);
    await expect(filters(page).getByLabel("Votes yes for")).toBeVisible();
    await expect(placesOf(page)).toHaveCount(0);
  });

  test("a country is an unknown parameter: ?country=DE is a redirect to the list without it", async ({ page }) => {
    const response = await page.goto("/xrpl/validators?scope=all&country=DE");
    expect(response!.request().redirectedFrom()?.url()).toMatch(/\/xrpl\/validators\?scope=all&country=DE$/);
    expect(new URL(page.url()).search).toBe("?scope=all");
    await hydrated(page);
    await expect(mapCard(page)).toHaveCount(0);
  });

  test("a verified validator's page has no toml card and keeps the accounts line", async ({ page }) => {
    const full = tomlFullKey("xrpl");
    needs(full !== null, "validator whose toml D8 has read in full (the fixtures' toml-full)");
    await page.goto(`/xrpl/validators/${full!.key}`);
    await hydrated(page);
    const main = page.getByRole("main");
    await expect(main.getByRole("region", { name: "Validator", exact: true })).toBeVisible();
    await expect(main.getByRole("region", { name: /toml$/ })).toHaveCount(0);
    await expect(main.getByText("View toml")).toHaveCount(0);
    const line = main.locator(".validator__fact", { has: page.getByText(`Accounts ${full!.domain} lists`, { exact: true }) });
    await expect(line.getByRole("link").first()).toBeVisible();
  });
});

test.describe("with VALIDATORS off", () => {
  test.skip(!VALIDATORS_OFF, "VALIDATORS is on in the Worker under test: the pages are checked above");

  // A key in hex, which the page would redirect: with the switch off nothing reads the key, and it is the switch's 404.
  const KEY = "ED".padEnd(66, "0");

  for (const path of ["/xrpl/validators", `/xrpl/validators/${KEY}`, "/xrpl/amendments", "/xrpl/amendments/AMM"]) {
    test(`${path} is the not-found page, a 404`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response!.status()).toBe(404);
      await expect(page.getByRole("main")).toContainText("We couldn’t find the");
    });
  }

  test("the network page's 'All validators' is 'soon' and its five first-seen keys are text", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    const card = validatorsCard(page);
    await expect(card.getByRole("link", { name: "All validators" })).toHaveCount(0);
    await expect(card.locator(".nav-item.is-soon")).toHaveText("All validators soon");
    await expect(card.locator(".network__first a")).toHaveCount(0);
    await expect(card.locator(".network__first li .mono")).toHaveCount(5);
  });
});
