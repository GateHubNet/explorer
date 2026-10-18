import { XRPL_LEDGER } from "./fixtures";
import { expect, hydrated, test } from "./support";

test.describe("the network switch", () => {
  test("goes to the other network's home, changes the accent, and is remembered for `/`", async ({ page, context }) => {
    await page.goto(`/xrpl/ledger/${XRPL_LEDGER}`);
    await hydrated(page);
    const shell = page.locator(".shell");
    await expect(shell).toHaveAttribute("data-net", "xrpl");
    const switcher = page.getByRole("group", { name: "Network" });
    await expect(switcher.getByRole("link", { name: "XRPL" })).toHaveAttribute("aria-current", "true");

    await switcher.getByRole("link", { name: "Xahau" }).click();
    // The other network's home, not the same page there (spec 2).
    await page.waitForURL("**/xahau");
    await expect(shell).toHaveAttribute("data-net", "xahau");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore Xahau");
    await expect(page).toHaveTitle("Explore Xahau · explorer");
    await expect(switcher.getByRole("link", { name: "Xahau" })).toHaveAttribute("aria-current", "true");
    await expect(switcher.getByRole("link", { name: "XRPL" })).not.toHaveAttribute("aria-current", /./);

    // The browser wrote the choice down...
    await expect.poll(async () => (await context.cookies()).find((cookie) => cookie.name === "net")?.value).toBe("xahau");
    // ...and `/` reads it.
    await page.goto("/");
    await page.waitForURL("**/xahau");
    await expect(shell).toHaveAttribute("data-net", "xahau");
  });

  test("starts on the XRP Ledger when nobody has chosen", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/xrpl");
    await expect(page.locator(".shell")).toHaveAttribute("data-net", "xrpl");
  });

  test("answers an unknown network with the not-found page", async ({ page }) => {
    const response = await page.goto("/nonet/ledger/1");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Network not found");
    await expect(page.getByRole("main")).toContainText("nonet");
  });
});
