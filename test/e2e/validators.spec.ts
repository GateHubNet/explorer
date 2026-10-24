import { createRequire } from "node:module";

import type { Page } from "@playwright/test";

import { LIVE } from "./fixtures";
import { expect, hydrated, test } from "./support";
import { headOf, listedValidator, needs, rowsOf, SKIP_OFF, VALIDATORS_OFF, validatorsTable, withHistory } from "./validators-pages";

// The validators list (`/{net}/validators`) and a validator's page (`/{net}/validators/{key}`) in a browser: the way from the network page, the views
// (a scope and a filter are URLs), the filter form with and without JavaScript, the versions chart without it, and on a validator's page the copy
// buttons, the slider of its 30 days, its older validations and a key written in hex. Every validator is read from the pages, so the suite runs against
// a real stack too; nothing here changes what the fixture server answers (validators-live.spec.ts does).
//
// Where E2E_FEATURES_OFF lists VALIDATORS (a sandbox or production that has the switch off), the tests of the pages skip themselves and the off-case
// below runs instead.

// The codec as Node loads it (its CommonJS build): Playwright's loader of the specs does not take it as an import.
const { decodeNodePublic } = createRequire(import.meta.url)("ripple-address-codec") as typeof import("ripple-address-codec");

const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);
const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { sameDocument: true }));

/** The card of the network page that counts the validators. */
const validatorsCard = (page: Page) => page.locator(".network__validators");
/** The versions card of the list, found by the id of its title. */
const versionsCard = (page: Page) => page.locator('section[aria-labelledby="validators-versions-title"]');

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
      // The header's Network item is the section's: inside it, not its index.
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Network", exact: true })).toHaveAttribute("aria-current", "true");

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
