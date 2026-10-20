import { featuresOff } from "../../scripts/e2e-env";
import { LIVE, XRPL_ACCOUNT } from "./fixtures";
import { expect, hydrated, test } from "./support";

const FEATURES_OFF = featuresOff(process.env);

const rowsOf = (page: import("@playwright/test").Page, name: string) => page.getByRole("table", { name }).getByRole("row");

const HAND_WRITTEN = "reads the hand-written account files of the fixtures: their numbers are not an account's today";

test.describe("the account page", () => {
  test("goes through the tabs, each a URL of its own", async ({ page }) => {
    // Always what the tabs are; the numbers of rows only with the fixtures.
    const rows = (name: string, expected: number) => (LIVE ? expect(page.getByRole("table", { name })).toBeVisible() : expect(rowsOf(page, name)).toHaveCount(expected));
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
    await hydrated(page);
    const tabs = page.getByRole("navigation", { name: "Account activity" });
    await expect(tabs.getByRole("link", { name: "Transactions" })).toHaveAttribute("aria-current", "page");
    await rows("Transactions", 5); // four transactions and the header

    await tabs.getByRole("link", { name: "Payments" }).click();
    await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}?tab=payments`);
    await expect(tabs.getByRole("link", { name: "Payments" })).toHaveAttribute("aria-current", "page");
    await rows("Payments", 2); // one payment and the header

    await tabs.getByRole("link", { name: "Trades" }).click();
    await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}?tab=trades`);
    await rows("Trades", 3);

    await tabs.getByRole("link", { name: "Offers" }).click();
    await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}?tab=offers`);
    await expect(tabs.getByRole("link", { name: "Offers" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: "Offers, scrollable table" })).toBeVisible();

    await tabs.getByRole("link", { name: "Objects" }).click();
    await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}?tab=objects`);
    await expect(tabs.getByRole("link", { name: "Objects" })).toHaveAttribute("aria-current", "page");

    // Analytics is a link to the analytics view while ACCOUNT_ANALYTICS is on, kept from crawlers; with it off, the "soon" label of before.
    if (FEATURES_OFF.has("ACCOUNT_ANALYTICS")) {
      await expect(tabs.getByRole("link", { name: /Analytics/ })).toHaveCount(0);
      await expect(tabs).toContainText("Analyticssoon");
    } else {
      const analytics = tabs.getByRole("link", { name: "Analytics" });
      await expect(analytics).toHaveAttribute("href", `/xrpl/account/${XRPL_ACCOUNT}?tab=analytics`);
      await expect(analytics).toHaveAttribute("rel", "nofollow");
      await expect(analytics).not.toHaveAttribute("aria-current", "page");
    }
  });

  test("pages back through the history with Older and returns with Newer", async ({ page }) => {
    test.skip(LIVE, HAND_WRITTEN);
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
    await hydrated(page);
    await expect(rowsOf(page, "Transactions")).toHaveCount(5);
    const pagination = page.getByRole("navigation", { name: "Pagination" });
    await expect(pagination.getByRole("link", { name: "Newer" })).toHaveCount(0);

    await pagination.getByRole("link", { name: "Older" }).click();
    await page.waitForURL(/\/xrpl\/account\/[^?]+\?marker=[\w-]+$/);
    await expect(rowsOf(page, "Transactions")).toHaveCount(3); // the last two transactions and the header
    // The oldest page has nothing older.
    await expect(pagination.getByRole("link", { name: "Older" })).toHaveCount(0);
    // A page behind a marker is the list alone (it is kept for an hour or more, so it holds no live state).
    await expect(page.getByRole("main")).toContainText("does not show the balance or the live state");

    await pagination.getByRole("link", { name: "Newer" }).click();
    await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}`);
    await expect(rowsOf(page, "Transactions")).toHaveCount(5);
    await expect(page.getByRole("heading", { name: "Tokens" })).toBeVisible();
  });

  test("pages the payments tab as well, and keeps the tab", async ({ page }) => {
    test.skip(LIVE, HAND_WRITTEN);
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}?tab=payments`);
    await hydrated(page);
    await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Older" }).click();
    await page.waitForURL(/\?tab=payments&marker=[\w-]+$/);
    await expect(rowsOf(page, "Payments")).toHaveCount(2);
    await expect(page.getByRole("navigation", { name: "Account activity" }).getByRole("link", { name: "Payments" })).toHaveAttribute("aria-current", "page");
  });

  test("shows the balance, the token and the reserve read from the node", async ({ page }) => {
    test.skip(LIVE, HAND_WRITTEN);
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
    await expect(page.getByRole("region", { name: "Account" })).toContainText(/XRP balance\s*10\.001625/);
    await expect(page.getByRole("region", { name: "Tokens" })).toContainText("LIONS");
    await expect(page.getByRole("region", { name: "Account" })).toContainText("Reserve 1.2 XRP = 1 base + 1 object × 0.2");
  });
});
