import { count, XAHAU_LEDGER, XAHAU_LEDGER_NEXT } from "./fixtures";
import { expect, hydrated, test } from "./support";

test.describe("the ledger page", () => {
  test("goes to the next ledger and back to the previous one, in the page", async ({ page }) => {
    await page.goto(`/xahau/ledger/${XAHAU_LEDGER}`);
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Ledger #${count(XAHAU_LEDGER)}`);
    // Not a new document: this mark is gone if the browser reloads the page.
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));

    // The links are named by the number they show first (WCAG 2.5.3), then say what they are.
    const next = page.getByRole("link", { name: `${count(XAHAU_LEDGER_NEXT)}, next ledger` });
    await expect(next).toHaveText(count(XAHAU_LEDGER_NEXT));
    await next.click();
    await page.waitForURL(`**/xahau/ledger/${XAHAU_LEDGER_NEXT}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Ledger #${count(XAHAU_LEDGER_NEXT)}`);
    await expect(page.getByRole("region", { name: "Transactions in this ledger" })).toBeVisible();

    const previous = page.getByRole("link", { name: `${count(XAHAU_LEDGER)}, previous ledger` });
    await expect(previous).toHaveText(count(XAHAU_LEDGER));
    await previous.click();
    await page.waitForURL(`**/xahau/ledger/${XAHAU_LEDGER}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Ledger #${count(XAHAU_LEDGER)}`);

    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
  });

  test("shows the transactions of the ledger and filters them by type", async ({ page }) => {
    await page.goto(`/xahau/ledger/${XAHAU_LEDGER}`);
    await hydrated(page);
    const table = page.getByRole("table", { name: "Transactions" });
    await expect(table.getByRole("row")).toHaveCount(17); // 16 transactions and the header
    await page.getByRole("button", { name: /^Payment 14$/ }).click();
    await expect(table.getByRole("row")).toHaveCount(15);
    await expect(page.getByRole("button", { name: /^Payment 14$/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^All 16$/ }).click();
    await expect(table.getByRole("row")).toHaveCount(17);
  });
});
