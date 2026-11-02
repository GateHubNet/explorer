import { readFileSync } from "node:fs";

import { featuresOff } from "../../scripts/e2e-env";
import { BEFORE_HEAD, fixtures, HEAD, unavailable, xahauSaltmarshPage, xrplHomeOneLedgerBehind } from "./fixture-control";
import { count, fixtureEntryOf, LIVE, XAHAU_ACCOUNT, XAHAU_SALTMARSH } from "./fixtures";
import { shortOf } from "./names-pages";
import { expect, hydrated, test } from "./support";

// What display names do when the data API's names call fails, and the one page of the names fixtures that needs answers the recordings lack. They change what the fixture server answers while
// they run, so they are the `live` project's (`*-live.spec.ts`, playwright.config.ts): it runs alone, after the `chromium` project, one test at a time, and each puts the recordings back
// (`afterEach`). The cases that change nothing are names.spec.ts's.

test.skip(featuresOff(process.env).has("NAMES"), "NAMES is off in the Worker under test: names-off.spec.ts and pages-names-off.spec.ts (the Worker's own specs, in the `worker-off` and `worker-names-off` projects) are its off-case");
test.skip(LIVE, "changes what the fixture server answers: it needs the fixture server of the stack, not a real stack or a deployed Worker");

test.afterEach(async () => {
  await fixtures.reset();
});

/** The data API's names call, every call of it: a 503, as the data API answers when it is down. */
const NAMES_DOWN = { "GET /v2/account_names": unavailable() };

/** An XRPL transaction no other spec opens, whose accounts the fixtures name: the names call of its page is the first of the run to ask for them (the Worker keeps an answer a minute). */
const OWN_TRANSACTION = "2D6FF646176D364EAD12395D67CCA6D459E1875F537D035D9B10B7754ACA07A3";

test.describe("a names call that fails", () => {
  // The page with addresses is served and not kept, so a reload is a render again; once the call works the page has its names, and is kept.
  test("a reload after a failed names call is a MISS", async ({ page }) => {
    await fixtures.override(NAMES_DOWN);
    const path = `/xrpl/tx/${OWN_TRANSACTION}`;

    // The page is there, with the addresses, and is served for this visitor only: the browser and the edge keep nothing of it.
    const first = (await page.goto(path))!;
    await hydrated(page);
    expect(first.status()).toBe(200);
    expect(first.headers()["x-cache"]).toBe("MISS");
    expect(first.headers()["cache-control"]).toBe("no-store");
    const accounts = page.locator('main a[href^="/xrpl/account/"]');
    expect(await accounts.count(), "the page links accounts").toBeGreaterThan(0);
    await expect(page.locator(".acct__name")).toHaveCount(0);
    await expect(page.locator(".namemark")).toHaveCount(0);
    for (const text of await accounts.allTextContents()) expect(text.trim()).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}$|^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);

    // A reload while it still fails is a render again: the first was not stored.
    const second = (await page.reload())!;
    await hydrated(page);
    expect(second.headers()["x-cache"]).toBe("MISS");
    expect(second.headers()["cache-control"]).toBe("no-store");

    // The call works again: the next load is a render too (nothing was stored), draws the names, and is kept; the one after it is the stored copy.
    await fixtures.reset();
    const third = (await page.reload())!;
    await hydrated(page);
    expect(third.headers()["x-cache"]).toBe("MISS");
    expect(third.headers()["cache-control"]).not.toBe("no-store");
    expect(await page.locator(".acct__name").count(), "the names are drawn").toBeGreaterThan(0);
    const fourth = (await page.reload())!;
    expect(fourth.headers()["x-cache"]).toBe("HIT");
    expect(await page.locator(".acct__name").count(), "the stored copy has them").toBeGreaterThan(0);
  });
});

// ---- The home page keeps its names ------------------------------------------------------------------------------------------------------------------

/** The newest transactions of the recordings' newest XRPL ledger, as the data API's `transactions?descending=true&limit=8` answers them. */
const recordedHead = JSON.parse(readFileSync(new URL("../fixtures/http/xrpl/data-api/transactions@descending=true&limit=8.json", import.meta.url), "utf8")) as {
  transactions: Array<{ hash: string }>;
};
const TRANSACTIONS = "GET /v2/transactions?descending=true&limit=8";

test.describe("the home page that follows the chain", () => {
  // A beat whose names call failed keeps the names the page shows, and draws the rows that are new by their addresses; a later beat, with the call working, names them.
  test("the home page keeps its names through a failed beat", async ({ page }) => {
    // The beats are 4 s apart, and the failure hold and the stored copies take a few more.
    test.slow();

    // The chain is one ledger behind the recordings: the page names the accounts of those rows (the fixtures name at least one).
    const behind = xrplHomeOneLedgerBehind();
    await fixtures.override(behind);
    const path = "/xrpl?names-live=1";
    await expect.poll(async () => (await page.request.get(path)).text(), { timeout: 15_000 }).toContain(`#${count(BEFORE_HEAD)}`);
    await page.goto(path);
    await hydrated(page);
    const table = page.getByRole("table", { name: "Latest transactions" });
    const ledgerTile = page.locator(".stat", { hasText: "Latest validated ledger" }).locator(".stat__value");
    await expect(ledgerTile).toHaveText(`#${count(BEFORE_HEAD)}`);

    const namedLinks = () => table.locator("a.acct").evaluateAll((links) => links.map((link) => ({ href: link.getAttribute("href")!, text: (link.textContent ?? "").replace(/\s+/g, " ").trim() })));
    const before = await namedLinks();
    expect(before.length, "the table names an account").toBeGreaterThan(0);

    // The next beat finds the chain on, and its names call failing. Its rows are the new transaction at the top (an account the fixtures name, which the call would have named) and the
    // rows the page has: of the seven that stay, the beat's names are the page's own.
    const newRow = recordedHead.transactions[1]!;
    const rows = (behind[TRANSACTIONS] as { transactions: unknown[] }).transactions;
    await fixtures.override({
      ...NAMES_DOWN,
      [TRANSACTIONS]: { ...(behind[TRANSACTIONS] as object), transactions: [newRow, ...rows.slice(0, 7)], count: 8 },
    });

    await expect(ledgerTile).toHaveText(`#${count(HEAD)}`, { timeout: 20_000 });
    const entered = table.locator(`[data-key="${newRow.hash}"]`);
    await expect(entered).toBeVisible();
    // The row that is new has the address of its account: the beat could not name it.
    await expect(entered.locator("a.acct")).toHaveCount(0);
    await expect(entered.locator('a[href^="/xrpl/account/"]')).toHaveText(/^r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}$/);
    // The rows the page had keep their names, as they were drawn.
    const kept = (await namedLinks()).filter((link) => before.some((was) => was.href === link.href));
    expect(kept.length, "an account named before the beat is still named").toBeGreaterThan(0);
    for (const link of kept) expect(link.text).toBe(before.find((was) => was.href === link.href)!.text);
    // It is the same document, still following the chain.
    await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toHaveCount(0);

    // The call works again: a later beat names the new row too.
    await fixtures.reset();
    await expect(entered.locator("a.acct")).toBeVisible({ timeout: 40_000 });
    const entry = fixtureEntryOf("xrpl", (await entered.locator("a.acct").getAttribute("href"))!.split("/").pop()!);
    expect(entry?.display_name, "the fixtures name the account of the new row").toBeDefined();
    await expect(entered.locator("a.acct")).toContainText(entry!.display_name!.text);
  });
});

// ---- A domain that is not verified ------------------------------------------------------------------------------------------------------------------

test.describe("xahau: an account whose domain is not verified", () => {
  test("is its domain with the visible words, the sentence that says why its toml could not be read, and no link to the domain, and a link from where it is met leads to it", async ({ page }) => {
    const entry = fixtureEntryOf("xahau", XAHAU_SALTMARSH)!;
    expect(entry.display_name, "the fixtures name it by its domain").toEqual({ text: "saltmarsh.example", kind: "domain" });
    await fixtures.override(xahauSaltmarshPage());

    // It is met on the page of an account that has dealt with it: a link by its domain, with the words "not verified" in view, and a title that says it is not.
    await page.goto(`/xahau/account/${XAHAU_ACCOUNT}`);
    await hydrated(page);
    const link = page.getByRole("main").getByRole("link", { name: "saltmarsh.example not verified" }).first();
    await expect(link).toHaveAttribute("title", `Domain not verified · ${XAHAU_SALTMARSH}`);
    await expect(link.locator(".unv")).toBeVisible();
    await link.click();
    await page.waitForURL(`**/xahau/account/${XAHAU_SALTMARSH}`);

    // Its heading is the domain and the words; the address is under it, and its title says no more than the address.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("saltmarsh.example not verified");
    await expect(page.locator(".account-head__address")).toHaveText(XAHAU_SALTMARSH);
    await expect(page).toHaveTitle(`Account ${shortOf(XAHAU_SALTMARSH)} · Xahau · explorer`);
    // The sentence, as text, and the domain is not a link: the explorer shows it without vouching for it.
    const head = page.locator(".account-id");
    await expect(head.locator(".account-head__kind")).toHaveText(
      "This account names saltmarsh.example in its Domain field, but its xahau.toml could not be read: the server answered HTTP 404. The explorer shows the domain, without vouching for it.",
    );
    await expect(page.locator('a[href*="saltmarsh"]')).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 }).getByRole("link")).toHaveCount(0);
    await expect(head.locator("details.disc")).toHaveCount(0);
    await expect(page.locator(".notice--warning")).toHaveCount(0);
  });
});
