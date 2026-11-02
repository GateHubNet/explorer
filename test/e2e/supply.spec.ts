import { featuresOff } from "../../scripts/e2e-env";
import { expect, hydrated, test } from "./support";

// The supply page's off-case in a browser (README "The supply page"). With SUPPLY on in the Worker under test the page itself is not here: it has one URL per network, whose answers the Worker keeps
// 300 s and whose failures it replaces with a stored copy, so no spec of the `chromium` project opens it, and every test that does is supply-live.spec.ts's (the `live` project, one test at a time,
// in an order that keeps the page fresh). Where E2E_FEATURES_OFF lists SUPPLY (a sandbox or production that has the switch off), this runs instead.

const SUPPLY_OFF = featuresOff(process.env).has("SUPPLY");

test.describe("with SUPPLY off", () => {
  test.skip(!SUPPLY_OFF, "SUPPLY is on in the Worker under test: the page is checked in supply-live.spec.ts");

  for (const [path, name] of [
    ["/xrpl/supply", "XRPL"],
    ["/xahau/supply", "Xahau"],
    // A query string is not read: no redirect to the one URL, only the not-found page.
    ["/xrpl/supply?x=1", "XRPL"],
  ] as const) {
    test(`${path} is the not-found page, a 404`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response!.status()).toBe(404);
      await expect(page.getByRole("main")).toContainText(`We couldn’t find the supply page on ${name}.`);
      await expect(page.locator(".supply")).toHaveCount(0);
    });
  }

  test("the Network menu's Supply item reads soon and is not a link, and the others lead on", async ({ page }) => {
    await page.goto("/xrpl/network");
    await hydrated(page);
    const menu = page.getByRole("navigation", { name: "Main" }).locator('details[data-menu="network"]');
    await menu.locator("summary").click();
    const supply = menu.locator(".menu__item", { hasText: /^Supply soon$/ });
    await expect(supply).toBeVisible();
    await expect(supply).toHaveClass(/is-soon/);
    await expect(supply).toHaveAttribute("aria-disabled", "true");
    await expect(menu.locator('a[href$="/supply"]')).toHaveCount(0);
    await expect(menu.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/xrpl/network");
  });
});
