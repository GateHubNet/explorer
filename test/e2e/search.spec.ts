import { LIVE, NEVER_FUNDED, NO_SUCH_TRANSACTION, XAHAU_REMIT, XRPL_ACCOUNT, XRPL_LEDGER, XRPL_PAYMENT } from "./fixtures";
import { expect, hydrated, test } from "./support";

test.describe("search", () => {
  test("a pasted transaction hash, with the noise a paste brings, leads to the transaction", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    const box = page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" });

    // Lower case, a 0x prefix, spaces around it: the box says what it is before anything is sent.
    await box.fill(`  0x${XRPL_PAYMENT.toLowerCase()}  `);
    const hints = page.getByRole("list", { name: "Matches" });
    await expect(hints).toContainText("Transaction or ledger");
    await expect(hints).toContainText(XRPL_PAYMENT);

    await box.press("Enter");
    await page.waitForURL(`**/xrpl/tx/${XRPL_PAYMENT}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payment");
    await expect(page).toHaveTitle("Payment AACAFC…FD40 · XRPL · explorer");
    await expect(page.getByRole("region", { name: "Details" })).toContainText(XRPL_PAYMENT);
    await expect(page.getByRole("region", { name: "Summary" })).toContainText("rBbW6i…W5jh sent 2.306481 XRP to rDFDjd…fy48");
  });

  test("a hint leads straight to an account, and `/` puts the cursor in the header's box", async ({ page }) => {
    await page.goto(`/xrpl/ledger/${XRPL_LEDGER}`);
    await hydrated(page);
    const box = page.getByRole("banner").getByRole("searchbox", { name: "Search XRPL" });
    await expect(box).not.toBeFocused();
    await page.keyboard.press("/");
    await expect(box).toBeFocused();

    await box.fill(XRPL_ACCOUNT);
    await page.getByRole("list", { name: "Matches" }).getByRole("link", { name: new RegExp(XRPL_ACCOUNT) }).click();
    await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(XRPL_ACCOUNT);
  });

  test("a ledger index, grouped as the pages show it, leads to the ledger", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    await page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" }).fill("107,720,688");
    await page.getByRole("main").getByRole("button", { name: "Search" }).click();
    await page.waitForURL(`**/xrpl/ledger/${XRPL_LEDGER}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ledger #107,720,688");
  });

  test("works before the script has run: the box is a form", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/xrpl");
    await page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" }).fill(XRPL_PAYMENT);
    await page.getByRole("main").getByRole("button", { name: "Search" }).click();
    await page.waitForURL(`**/xrpl/tx/${XRPL_PAYMENT}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payment");
  });

  test("a hash that is on the other network says so and the offer leads there", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    await page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" }).fill(XAHAU_REMIT);
    await page.getByRole("main").getByRole("button", { name: "Search" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");
    await expect(page.getByRole("main")).toContainText("We couldn’t find");
    await page.getByRole("link", { name: "Search on Xahau" }).click();
    await page.waitForURL(`**/xahau/tx/${XAHAU_REMIT}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Remit");
    await expect(page).toHaveTitle(/ · Xahau · explorer$/);
  });

  test("an address that was never activated, and a hash nothing has, are told so", async ({ page }) => {
    test.skip(LIVE, "the address is one nobody funded in the fixtures; on a network somebody may have");
    await page.goto(`/xrpl/account/${NEVER_FUNDED}`);
    await expect(page.getByRole("main")).toContainText("never been activated");
    await page.goto(`/xrpl/tx/${NO_SUCH_TRANSACTION}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");
  });
});
