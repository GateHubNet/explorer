import type { Locator, Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { XRPL_ACCOUNT } from "./fixtures";
import { expect, hydrated, test } from "./support";

// The analytics view has its own copy of the chart kit (scripts/analytics-kit-copy.ts), in its lazy chunk; every other page has the kit as it
// is. After the network page, a client-side navigation to an analytics view runs both copies in one document. Each copy's React contexts are
// its own: a plot hands its cursor's tooltip to the slot it provides (`TipSlotContext`), drawn beside the plot's scroll region and not in it,
// and the panels of the balance history share one bucket (`HoverContext`). Were a provider of one copy around a consumer of the other, the
// tooltip would be drawn in the plot and the panels would each keep their own bucket.

const FEATURES_OFF = featuresOff(process.env);

const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);

/** A chart card, by the id of its title. */
const chart = (page: Page, id: string) => page.locator(`section[aria-labelledby="${id}-title"]`);

/** Focuses the first slider of a chart and steps it a bucket back; the tooltip it then shows is drawn in the slot of its plot, not in the plot. */
async function stepBack(page: Page, card: Locator): Promise<void> {
  const slider = card.getByRole("slider").first();
  await slider.focus();
  const newest = Number(await slider.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", String(newest - 1));
  const tip = card.locator(".plot__tip");
  await expect(tip).toBeVisible();
  expect(await tip.evaluate((element) => element.closest(".plot__frame") !== null && element.closest(".plot__scroll") === null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
}

test("the analytics view after the network page, in one document: each copy of the kit draws with its own contexts", async ({ page }) => {
  test.skip(FEATURES_OFF.has("ACCOUNT_ANALYTICS"), "the analytics view is off");
  await page.goto("/xrpl/network");
  await hydrated(page);
  await page.evaluate(() => Object.assign(window, { sameDocument: true }));
  await stepBack(page, chart(page, "network-types"));

  // To the account through the header's search, and to its Analytics tab: both in the same document.
  await page.getByRole("banner").getByRole("searchbox", { name: "Search XRPL" }).fill(XRPL_ACCOUNT);
  await page.getByRole("list", { name: "Matches" }).getByRole("link", { name: new RegExp(XRPL_ACCOUNT) }).click();
  await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}`);
  await page.getByRole("navigation", { name: "Account activity" }).getByRole("link", { name: "Analytics" }).click();
  await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}?tab=analytics`);

  const value = chart(page, "analytics-value");
  await expect(value.getByRole("slider")).toBeVisible();
  await stepBack(page, value);

  // The panels of the balance history: the pointer over one puts every panel on its bucket.
  const plots = chart(page, "analytics-balances").locator(".panel .plot");
  await expect(plots.first()).toBeVisible();
  await plots.first().scrollIntoViewIfNeeded();
  const box = (await plots.first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(plots.first()).toHaveAttribute("data-active", /^\d+$/);
  const bucket = await plots.first().getAttribute("data-active");
  for (const plot of await plots.all()) await expect(plot).toHaveAttribute("data-active", bucket!);
  await page.mouse.move(2, 2);
  expect(await sameDocument(page)).toBe(true);

  // Back to the network page, whose kit is the one it had.
  await page.goBack();
  await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}`);
  await page.goBack();
  await page.waitForURL("**/xrpl/network");
  await stepBack(page, chart(page, "network-types"));
  expect(await sameDocument(page)).toBe(true);
});
