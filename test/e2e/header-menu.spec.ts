import type { Locator, Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { expect, hydrated, test } from "./support";
import { listedAmendment, listedValidator, needs, VALIDATORS_OFF } from "./validators-pages";

// The header's Network menu (supply spec 2 and 12) in a browser: a disclosure of Overview, Validators, Amendments and Supply, opened by the keyboard and by a click, closed by Escape, a click
// outside, focus leaving and a navigation, marking the section and the page it is on, laid out over the page on a wide screen and in the flow in the folded nav of a phone. It works without
// JavaScript too. Everything here reads the fixtures and changes none of them.
//
// The supply page itself is not opened here: its answers are changed by the end-to-end tests that need it fresh, so no spec of the `chromium` project opens it (supply-live.spec.ts holds every test
// that does, and the menu's steps that lead to it). A Supply item that is a link is looked at; one that reads "soon" (E2E_FEATURES_OFF lists SUPPLY) is checked for that.

const SUPPLY_OFF = featuresOff(process.env).has("SUPPLY");

const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);
const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { sameDocument: true }));

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const menu = (page: Page) => nav(page).locator('details[data-menu="network"]');
const summary = (page: Page) => menu(page).locator("summary");
const panel = (page: Page) => menu(page).locator(".menu__panel");
/** An item of the panel by its label, a link or the soon label, hidden or not. */
const item = (page: Page, label: string) => menu(page).locator(".menu__item", { hasText: new RegExp(`^${label}( soon)?$`) });

const open = (page: Page) => expect(menu(page)).toHaveJSProperty("open", true);
const closed = (page: Page) => expect(menu(page)).toHaveJSProperty("open", false);

/** Whether focus is on an element of the menu now. */
const focusInMenu = (page: Page) => menu(page).evaluate((details) => details.contains(document.activeElement));

/** Production's nav as test/e2e/theme.spec.ts draws it, and the sandbox's Testnet badge: the header at its widest, two rows at 1280. After hydration, on the items the menu does not own. */
async function asProductionWithBadge(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const name of ["Tokens", "Markets", "AMM", "NFTs"]) {
      const li = [...document.querySelectorAll('nav[aria-label="Main"] > ul > li')].find((candidate) => new RegExp(`^${name}(soon)?$`).test(candidate.textContent!.trim()))!;
      li.innerHTML = `<span class="nav-item is-soon" aria-disabled="true"><span>${name}</span><span class="soon">soon</span></span>`;
    }
    const badge = document.createElement("span");
    badge.className = "pill pill--testnet";
    badge.textContent = "Testnet";
    document.querySelector(".hdr__brandgroup")!.append(badge);
  });
}

test.describe("the keyboard", () => {
  test("Tab reaches Network, Enter opens it, Tab goes through the items, Escape closes it and focus is on the summary", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    // The link before the menu in the tab order: Tokens while TOKENS is on, Transactions where Tokens is the soon label.
    await menu(page).locator("xpath=ancestor::li[1]/preceding-sibling::li//a").last().focus();
    await page.keyboard.press("Tab");
    await expect(summary(page)).toBeFocused();
    await closed(page);

    await page.keyboard.press("Enter");
    await open(page);
    await expect(panel(page)).toBeVisible();

    // The links in the panel, in order: Overview, then the ones whose switches are on. An item that reads "soon" is no link and no stop.
    const links = panel(page).getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(1);
    await expect(links.first()).toHaveText("Overview");
    for (let i = 0; i < count; i++) {
      await page.keyboard.press("Tab");
      await expect(links.nth(i)).toBeFocused();
    }
    await open(page);

    await page.keyboard.press("Escape");
    await closed(page);
    await expect(summary(page)).toBeFocused();
  });

  test("Escape from the summary closes it too, and Space opens and closes it", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    await summary(page).focus();
    await page.keyboard.press("Space");
    await open(page);
    await page.keyboard.press("Space");
    await closed(page);
    await page.keyboard.press("Enter");
    await open(page);
    await page.keyboard.press("Escape");
    await closed(page);
    await expect(summary(page)).toBeFocused();
  });

  test("Tab out of the last item closes it, and so does Shift+Tab out of the summary", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    await summary(page).focus();
    await page.keyboard.press("Enter");
    await open(page);
    const count = await panel(page).getByRole("link").count();
    for (let i = 0; i < count; i++) await page.keyboard.press("Tab");
    await expect(panel(page).getByRole("link").last()).toBeFocused();
    await open(page);

    await page.keyboard.press("Tab");
    await closed(page);
    expect(await focusInMenu(page)).toBe(false);

    await summary(page).focus();
    await page.keyboard.press("Enter");
    await open(page);
    await page.keyboard.press("Shift+Tab");
    await closed(page);
    expect(await focusInMenu(page)).toBe(false);
  });

  test("a closed menu's links are not in the tab order", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    await summary(page).focus();
    await page.keyboard.press("Tab");
    expect(await focusInMenu(page)).toBe(false);
    await closed(page);
  });
});

test.describe("the pointer", () => {
  test("a click opens it, a second closes it, and hovering opens nothing", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    await summary(page).hover();
    await closed(page);

    await summary(page).click();
    await open(page);
    await expect(panel(page)).toBeVisible();
    await summary(page).click();
    await closed(page);
  });

  test("a click outside closes it, and the click does what it was for: focus goes where it was put", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    await summary(page).click();
    await open(page);
    await page.getByRole("heading", { level: 1 }).click();
    await closed(page);

    await summary(page).click();
    await open(page);
    await page.getByRole("banner").getByRole("searchbox").click();
    await closed(page);
    await expect(page.getByRole("banner").getByRole("searchbox")).toBeFocused();
  });

  test("opening it moves nothing: the header and the page keep their boxes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/xrpl/network");
    await hydrated(page);
    const boxes = () => Promise.all([page.getByRole("banner").boundingBox(), page.getByRole("heading", { level: 1 }).boundingBox()]);
    const before = await boxes();
    await summary(page).click();
    await open(page);
    expect(await boxes()).toEqual(before);
    // The panel hangs under the summary, 6 px away, and is at least 230 px wide.
    const panelBox = (await panel(page).boundingBox())!;
    const summaryBox = (await summary(page).boundingBox())!;
    expect(panelBox.x).toBeCloseTo(summaryBox.x, 0);
    expect(panelBox.y).toBeGreaterThanOrEqual(summaryBox.y + summaryBox.height + 5);
    expect(panelBox.width).toBeGreaterThanOrEqual(230);
  });
});

test.describe("what the menu marks", () => {
  test("the network page: the summary is current, and Overview is the page", async ({ page }) => {
    await page.goto("/xrpl/network?period=7d");
    await hydrated(page);
    await expect(summary(page)).toHaveAttribute("aria-current", "true");
    await expect(summary(page)).toHaveClass(/is-current/);
    await expect(item(page, "Overview")).toHaveAttribute("aria-current", "page");
    await expect(menu(page).locator(".menu__item[aria-current]")).toHaveCount(1);
  });

  test("a page of no section marks nothing in the menu", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    await expect(summary(page)).not.toHaveAttribute("aria-current", /./);
    await expect(summary(page)).not.toHaveClass(/is-current/);
    await expect(menu(page).locator("[aria-current]")).toHaveCount(0);
  });

  test("Supply reads soon with SUPPLY off, and leads to the supply page with it on", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    const supply = item(page, "Supply");
    if (SUPPLY_OFF) {
      await expect(supply).toHaveClass(/is-soon/);
      await expect(supply).toHaveAttribute("aria-disabled", "true");
      await expect(supply).toHaveText("Supply soon");
      await expect(supply.locator("a")).toHaveCount(0);
      await expect(menu(page).locator('a[href$="/supply"]')).toHaveCount(0);
    } else {
      await expect(supply).toHaveText("Supply");
      await expect(supply).toHaveAttribute("href", "/xrpl/supply");
      await expect(supply).not.toHaveClass(/is-soon/);
    }
    // Overview never reads soon.
    await expect(item(page, "Overview")).toHaveAttribute("href", "/xrpl/network");
  });

  test.describe("with VALIDATORS on", () => {
    test.skip(VALIDATORS_OFF, "VALIDATORS is off in the Worker under test: Validators and Amendments read soon there");

    test("clicking Amendments goes there in the same document, and the panel is closed on the new page", async ({ page }) => {
      await page.goto("/xrpl/network");
      await hydrated(page);
      await markDocument(page);
      await summary(page).click();
      await item(page, "Amendments").click();
      await page.waitForURL("**/xrpl/amendments");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Amendments");
      await closed(page);
      expect(await sameDocument(page)).toBe(true);
      await expect(summary(page)).toHaveAttribute("aria-current", "true");
      await expect(item(page, "Amendments")).toHaveAttribute("aria-current", "page");
      await expect(item(page, "Overview")).not.toHaveAttribute("aria-current", /./);
      await expect(item(page, "Validators")).not.toHaveAttribute("aria-current", /./);
    });

    test("choosing the page you are on closes the panel and puts focus on the summary, in the same document (Amendments: the supply page is never opened here)", async ({ page }) => {
      await page.goto("/xrpl/amendments");
      await hydrated(page);
      await markDocument(page);
      await summary(page).click();
      await open(page);
      await expect(item(page, "Amendments")).toHaveAttribute("aria-current", "page");

      // No navigation follows, so nothing but the menu's own rule can close the panel; focus was on a link that is hidden now.
      await item(page, "Amendments").click();
      await closed(page);
      await expect(summary(page)).toBeFocused();
      expect(new URL(page.url()).pathname).toBe("/xrpl/amendments");
      expect(await sameDocument(page)).toBe(true);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Amendments");
    });

    test("the validators list is the page under any query, and a validator's page is a page under it", async ({ page }) => {
      const validator = await listedValidator(page, "any", "/xrpl/validators?scope=all");
      await expect(summary(page)).toHaveAttribute("aria-current", "true");
      await expect(item(page, "Validators")).toHaveAttribute("aria-current", "page");

      await page.goto(validator.href);
      await hydrated(page);
      await expect(summary(page)).toHaveAttribute("aria-current", "true");
      await expect(item(page, "Validators")).toHaveAttribute("aria-current", "true");
      await expect(item(page, "Amendments")).not.toHaveAttribute("aria-current", /./);
    });

    test("an amendment's page is a page under Amendments", async ({ page }) => {
      const amendment = await listedAmendment(page, "enabled");
      needs(amendment !== null, "enabled amendment");
      await page.goto(amendment!.href);
      await hydrated(page);
      await expect(summary(page)).toHaveAttribute("aria-current", "true");
      await expect(item(page, "Amendments")).toHaveAttribute("aria-current", "true");
      await expect(item(page, "Validators")).not.toHaveAttribute("aria-current", /./);
    });
  });
});

test.describe("without JavaScript", () => {
  test("the summary opens the menu and its links lead to the pages", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/xrpl");
    await expect(menu(page)).toHaveJSProperty("open", false);
    await expect(panel(page)).toBeHidden();

    await summary(page).click();
    await expect(menu(page)).toHaveJSProperty("open", true);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/xrpl/network");
    await panel(page).getByRole("link", { name: "Overview" }).click();
    await page.waitForURL("**/xrpl/network");
    // A new document: the menu is closed again, and the page marks its place.
    await expect(menu(page)).toHaveJSProperty("open", false);
    await expect(summary(page)).toHaveAttribute("aria-current", "true");
    await expect(item(page, "Overview")).toHaveAttribute("aria-current", "page");
  });
});

test.describe("the layout", () => {
  test("on a header of two rows the open panel is over the search box and under its hints, and inside the viewport from 721 px up", async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/xrpl/network");
    await hydrated(page);
    await asProductionWithBadge(page);
    const header = (await page.getByRole("banner").boundingBox())!;
    // Two rows: the nav's row, and the box and the toggle under it.
    expect(header.height).toBeGreaterThan(100);

    await summary(page).click();
    await open(page);
    const geometry = await page.evaluate(() => {
      const panelEl = document.querySelector(".menu__panel")!;
      const box = document.querySelector(".hdr .search--header")!;
      const hints = document.querySelector(".hdr .search--header .search__hints")!;
      const p = panelEl.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const left = Math.max(p.left, b.left);
      const right = Math.min(p.right, b.right);
      const top = Math.max(p.top, b.top);
      const bottom = Math.min(p.bottom, b.bottom);
      const overlaps = left < right && top < bottom;
      const topmost = overlaps ? document.elementFromPoint((left + right) / 2, (top + bottom) / 2) : null;
      return {
        overlaps,
        panelOnTop: topmost !== null && panelEl.contains(topmost),
        panelZ: Number(getComputedStyle(panelEl).zIndex),
        hintsZ: Number(getComputedStyle(hints).zIndex),
      };
    });
    expect(geometry.overlaps, "the panel hangs over the box on row 2").toBe(true);
    expect(geometry.panelOnTop, "the panel is what is seen there").toBe(true);
    expect(geometry.panelZ).toBeLessThan(geometry.hintsZ);

    // Open all the way down from 1300 to 721 px: the panel never leaves the viewport.
    const outside: number[] = [];
    for (let width = 1300; width >= 721; width -= 20) {
      await page.setViewportSize({ width, height: 800 });
      const box = (await panel(page).boundingBox())!;
      if (box.x < 0 || box.x + box.width > width) outside.push(width);
    }
    await page.setViewportSize({ width: 721, height: 800 });
    const box = (await panel(page).boundingBox())!;
    if (box.x < 0 || box.x + box.width > 721) outside.push(721);
    expect(outside, "the widths at which the panel is not inside the viewport").toEqual([]);
  });

  test("at 375 px the folded nav shows the panel in the flow, indented, with 44 px items", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/xrpl/network");
    await hydrated(page);
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(nav(page)).toBeVisible();
    await summary(page).click();
    await open(page);

    await expect(panel(page)).toHaveCSS("position", "static");
    const summaryBox = (await summary(page).boundingBox())!;
    const panelBox = (await panel(page).boundingBox())!;
    const navBox = (await nav(page).boundingBox())!;
    expect(panelBox.x - summaryBox.x).toBeGreaterThanOrEqual(11);
    expect(panelBox.x - summaryBox.x).toBeLessThanOrEqual(13);
    expect(panelBox.y).toBeGreaterThanOrEqual(summaryBox.y + summaryBox.height);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(navBox.x + navBox.width + 0.5);

    // Every item is 44 px high and as wide as the panel's inside (6 px of padding and a 1 px border each side).
    const items = panel(page).locator(".menu__item");
    const count = await items.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i++) {
      const box = (await items.nth(i).boundingBox())!;
      expect(box.height, `item ${i}`).toBeGreaterThanOrEqual(44);
      expect(box.width, `item ${i}`).toBeGreaterThanOrEqual(panelBox.width - 14 - 1);
    }

    // In the flow: the item after the menu starts below the panel, and the page does not scroll sideways.
    const next = (await nav(page).locator(":scope > ul > li").nth(4).boundingBox())!;
    expect(next.y).toBeGreaterThanOrEqual(panelBox.y + panelBox.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
