import type { Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { LIVE, XAHAU_ACCOUNT, XRPL_ACCOUNT, XRPL_DELETED } from "./fixtures";
import { expectAccountsDrawn, shortOf } from "./names-pages";
import { delegationsOf, objectCase, recordedDelegateSet, rowValue, transactionOf } from "./object-pages";
import { expect, hydrated, reactOwns, test } from "./support";

// Delegation (README "The account page", "The transaction page"; ledger object pages spec 6) in a browser: the account's Delegation tab on XRPL with both of its lists, the tab that Xahau does not
// have, a delegated payment's and a delegated failed payment's "Sent by" row and sentence, and a `DelegateSet` with permissions, an empty one and a failed one. The lists are read from the
// hand-written delegation files of the fixtures (`delegationsOf`), the transactions are the cases of the fixtures that their names say (test/e2e/object-pages.ts finds them by the rules the
// Worker's specs use: D5's delegated Payment, delegated `tec`, empty `DelegateSet` and failed `DelegateSet` are synthetic, the one `DelegateSet` that gave permissions is the recording's); no ID is
// written here. The "Sent by" row, the "sent it on behalf of" sentence and the `DelegateSet` sentences are the transaction's own words and are there with `DELEGATION` off; only the tab and the links
// into it need the switch. Where `E2E_FEATURES_OFF` lists `DELEGATION` the specs of the tab skip themselves, and the off-case is checked instead.

const OFF = featuresOff(process.env).has("DELEGATION");

const FIXTURES = "the tab is drawn from the hand-written delegation files of the fixtures, and the transactions are the generated ones (test/e2e/object-pages.ts), which a real stack does not hold";

const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { sameDocument: true }));
const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);
/** The account tabs' navigation. */
const tabsOf = (page: Page) => page.getByRole("navigation", { name: "Account activity" });
const tabPath = (address: string) => `/xrpl/account/${address}?tab=delegation`;
/** The names of the permission chips in `scope`, as the chips write them (the words after the name are for a screen reader). */
const chipNames = (scope: ReturnType<Page["locator"]>) => scope.locator(".permchip").evaluateAll((chips) => chips.map((chip) => chip.childNodes[0]?.textContent ?? ""));

// ---- The tab ------------------------------------------------------------------------------------------------------------------------------------------------------------------

test.describe("the Delegation tab", () => {
  test.skip(OFF, "DELEGATION is off in the Worker under test: the tab is the 'soon' label (checked below)");
  test.skip(LIVE, FIXTURES);

  test("is a tab of its own between NFTs and Analytics, the current one on its page, and the page's canonical link names it", async ({ page }) => {
    await page.goto(tabPath(XRPL_ACCOUNT));
    await hydrated(page);
    const tabs = tabsOf(page);
    // The tabs in their order: Delegation between NFTs and Analytics (an item whose switch is off is a label with "soon", and is there all the same).
    expect((await tabs.locator(".tabs__item").allInnerTexts()).map((text) => text.replace(/\s*soon$/, ""))).toEqual([
      "Transactions",
      "Payments",
      "Trades",
      "Offers",
      "Objects",
      "NFTs",
      "Delegation",
      "Analytics",
    ]);
    const delegation = tabs.getByRole("link", { name: "Delegation", exact: true });
    await expect(delegation).toHaveAttribute("href", tabPath(XRPL_ACCOUNT));
    await expect(delegation).toHaveAttribute("aria-current", "page");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/xrpl/account/${XRPL_ACCOUNT}\\?tab=delegation$`));
    // A tab that leads on: Transactions is the account's own URL again, in the same document.
    await markDocument(page);
    await tabs.getByRole("link", { name: "Transactions" }).click();
    await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}`);
    expect(await sameDocument(page)).toBe(true);
  });

  test("draws the permissions given and the permissions held, each delegation as its row of the files says it", async ({ page }) => {
    await page.goto(tabPath(XRPL_ACCOUNT));
    await hydrated(page);
    // What a delegation is, with the two kinds of chip as a legend.
    await expect(page.locator(".delegation__intro")).toContainText("A delegation lets another account, the delegate, send some kinds of transaction on this account’s behalf.");
    await expect(page.locator(".delegation__legend .permchip")).toHaveCount(2);

    for (const [direction, title, other] of [
      ["given", "Permissions given", "authorize"],
      ["held", "Permissions held", "account"],
    ] as const) {
      const list = delegationsOf(XRPL_ACCOUNT, direction);
      const table = page.getByRole("table", { name: title });
      await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
      await expect(table).toBeVisible();
      const rows = table.locator('[role="row"]:not(.table__head)');
      expect(list.delegations.length, `the files have ${direction} delegations`).toBeGreaterThan(0);
      await expect(rows).toHaveCount(list.delegations.length);

      for (const [at, delegation] of list.delegations.entries()) {
        const row = rows.nth(at);
        // The delegate (given) or the delegator (held), a link to the account; the permissions, each a chip, and how many of the most a delegation holds; the transaction that granted them and its date.
        await expect(row.getByRole("cell").nth(0).getByRole("link")).toHaveAttribute("href", `/xrpl/account/${delegation[other]}`);
        expect(await chipNames(row), `${direction} delegation ${at}`).toEqual(delegation.permissions.map((permission) => permission.permission));
        await expect(row.locator(".delegation__count")).toHaveText(`${delegation.permissions.length} of 10`);
        await expect(row.getByRole("link", { name: `Transaction ${shortOf(delegation.updated.tx_hash)}` })).toHaveAttribute("href", `/xrpl/tx/${delegation.updated.tx_hash}`);
        await expect(row.locator(".when > span").nth(0)).toHaveText(delegation.updated.time.slice(0, 10));
        await expect(row.locator(".when > span").nth(1)).toHaveText(delegation.updated.time.slice(11, 19));
      }
    }

    // The note under the given list says what the delegations cost the account: one Delegate object each, in its reserve.
    const given = delegationsOf(XRPL_ACCOUNT, "given").delegations.length;
    await expect(page.locator(".delegation__section").first()).toContainText(`so these ${given} count toward its reserve. A new DelegateSet for the same delegate replaces its whole list.`);
    // The coverage of the fixtures is complete: no note under either list.
    await expect(page.getByRole("note")).toHaveCount(0);
  });

  test("names the accounts in both lists as the fixtures say, the delegate or the delegator among them", async ({ page }) => {
    await page.goto(tabPath(XRPL_ACCOUNT));
    await hydrated(page);
    await expect(page.getByRole("table", { name: "Permissions held" })).toBeVisible();
    const drawn = await expectAccountsDrawn(page.locator(".delegation__section"), "xrpl");
    const expected = delegationsOf(XRPL_ACCOUNT, "given").delegations.length + delegationsOf(XRPL_ACCOUNT, "held").delegations.length;
    expect(drawn.links, "a link to an account in each row").toBeGreaterThanOrEqual(expected);
  });

  test("is opened from the Objects tab's 'View delegation →' in the same document", async ({ page }) => {
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}?tab=objects`);
    await hydrated(page);
    await markDocument(page);
    const open = page.getByRole("link", { name: "View delegation →" });
    await expect(open).toHaveAttribute("href", tabPath(XRPL_ACCOUNT));
    // The Objects tab's list is the lazy panels' chunk's: its links are the router's once React has hydrated them (`reactOwns`).
    await reactOwns(open);
    await open.click();
    await page.waitForURL(`**${tabPath(XRPL_ACCOUNT)}`);
    await expect(page.getByRole("table", { name: "Permissions given" })).toBeVisible();
    expect(await sameDocument(page)).toBe(true);
  });

  test("says in words that an account has no delegations, on both lists", async ({ page }) => {
    // The deleted account: the fixtures give it two empty lists.
    expect(delegationsOf(XRPL_DELETED, "given").delegations).toEqual([]);
    expect(delegationsOf(XRPL_DELETED, "held").delegations).toEqual([]);
    await page.goto(tabPath(XRPL_DELETED));
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 2, name: "Permissions given" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Permissions held" })).toBeVisible();
    // Each list has its header and no row, and says in a sentence of its own what is so; with nothing to say about the coverage there is no note.
    await expect(page.locator('.delegation__section [role="table"] [role="row"]:not(.table__head)')).toHaveCount(0);
    await expect(page.locator(".delegation__section .table__empty")).toHaveText([/^No account may send transactions on .+’s behalf\.$/, /^.+ may not send transactions on any other account’s behalf\.$/]);
    await expect(page.getByRole("note")).toHaveCount(0);
  });
});

// ---- Xahau has no delegation -----------------------------------------------------------------------------------------------------------------------------------------------------

test.describe("on Xahau", () => {
  test("an account has no Delegation tab, and its URL is the account page", async ({ page, request }) => {
    await page.goto(`/xahau/account/${XAHAU_ACCOUNT}`);
    await hydrated(page);
    const tabs = tabsOf(page);
    await expect(tabs.getByRole("link", { name: "Objects" })).toBeVisible();
    await expect(tabs).not.toContainText("Delegation");
    await expect(page.locator('a[href*="tab=delegation"]')).toHaveCount(0);

    // The URL of the tab is a 302 to the account (a made-up tab is no page), whatever the switch says.
    const redirect = await request.get(`/xahau/account/${XAHAU_ACCOUNT}?tab=delegation`, { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers().location).toBe(`/xahau/account/${XAHAU_ACCOUNT}`);
    await page.goto(`/xahau/account/${XAHAU_ACCOUNT}?tab=delegation`);
    await page.waitForURL(`**/xahau/account/${XAHAU_ACCOUNT}`);
    await expect(tabs.getByRole("link", { name: "Transactions" })).toHaveAttribute("aria-current", "page");
  });
});

// ---- A transaction a delegate sent -----------------------------------------------------------------------------------------------------------------------------------------

test.describe("a transaction a delegate sent", () => {
  test.skip(LIVE, FIXTURES);

  for (const [which, what] of [
    ["delegated-payment", "a payment"],
    ["delegated-tec", "a payment that failed"],
  ] as const) {
    test(`${what} says who sent it in its sentence and in its Sent by row, and who paid its fee`, async ({ page }) => {
      const { id, owner } = objectCase("xrpl", which);
      const delegate = String(transactionOf("xrpl", id).tx.Delegate);
      expect(delegate, "a delegate that is not the sender").not.toBe(owner);
      await page.goto(`/xrpl/tx/${id}`);
      await hydrated(page);

      // The sentence says it after the account's own words, in the same paragraph, with the two accounts as links: the delegate, then the account it sent it for.
      const sentence = page.locator("p.summary__sentence");
      await expect(sentence).toContainText(" sent it on behalf of ");
      const accounts = await sentence.locator('a[href^="/xrpl/account/"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      expect(accounts.slice(-2)).toEqual([`/xrpl/account/${delegate}`, `/xrpl/account/${owner}`]);
      // The Account row is the sender, and the Sent by row comes right after it with the delegate in full, and a transaction type's own detail list has no generic Delegate row.
      const labels = await page.locator("dl.kv-list dt").allInnerTexts();
      expect(labels.indexOf("Sent by"), "Sent by follows Account").toBe(labels.indexOf("Account") + 1);
      expect(labels).not.toContain("Delegate");
      const sentBy = rowValue(page, "Sent by");
      await expect(sentBy.getByRole("link").first()).toHaveAttribute("href", `/xrpl/account/${delegate}`);
      await expect(sentBy.getByRole("link").first()).toContainText(delegate);
      await expect(sentBy).toContainText("The delegate signed this transaction and paid its fee, using a permission");
      // The fee was the delegate's: the Fee row says so, and so does the balance changes' note.
      await expect(rowValue(page, "Fee")).toContainText("paid by the delegate");
      await expect(page.getByRole("table", { name: "Balance changes" })).toBeVisible();
      await expect(page.getByText("the delegate’s XRP change includes the fee")).toBeVisible();
    });
  }

  test("a payment's Sent by row leads to the delegation, the tab of the account it was sent for", async ({ page }) => {
    test.skip(OFF, "DELEGATION is off in the Worker under test: the row has no link into the tab (checked below)");
    const { id, owner } = objectCase("xrpl", "delegated-payment");
    await page.goto(`/xrpl/tx/${id}`);
    await expect(rowValue(page, "Sent by").getByRole("link", { name: "View the delegation" })).toHaveAttribute("href", tabPath(owner));
  });

  test("names every account of a failed one as the fixtures say, the sentence and the details", async ({ page }) => {
    const { id } = objectCase("xrpl", "delegated-tec");
    await page.goto(`/xrpl/tx/${id}`);
    await hydrated(page);
    expect((await expectAccountsDrawn(page.locator("p.summary__sentence"), "xrpl")).links).toBeGreaterThanOrEqual(2);
    // (The Sent by row's "View the delegation" is a link to an account's tab, in words of its own.)
    expect((await expectAccountsDrawn(page.locator("dl.kv-list dd:not(:has(.sentby__why))"), "xrpl", { full: "either" })).links).toBeGreaterThanOrEqual(2);
  });
});

// ---- DelegateSet -----------------------------------------------------------------------------------------------------------------------------------------------------------------

test.describe("a DelegateSet", () => {
  test.skip(LIVE, FIXTURES);

  test("that gave permissions says them as chips in its sentence and its details, with the note that it replaces the delegation", async ({ page }) => {
    const { id, owner } = recordedDelegateSet();
    const { tx } = transactionOf("xrpl", id);
    const names = (tx.Permissions as Array<{ Permission: { PermissionValue: string } }>).map((entry) => entry.Permission.PermissionValue);
    await page.goto(`/xrpl/tx/${id}`);
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Delegation");
    await expect(page.locator(".page-head__title .type")).toHaveText("DelegateSet");

    const sentence = page.locator("p.summary__sentence");
    await expect(sentence).toContainText(" let ");
    await expect(sentence).toContainText(" on its behalf.");
    await expect(sentence.locator('a[href^="/xrpl/account/"]').first()).toHaveAttribute("href", `/xrpl/account/${owner}`);
    await expect(sentence.locator('a[href^="/xrpl/account/"]').nth(1)).toHaveAttribute("href", `/xrpl/account/${String(tx.Authorize)}`);
    expect(await chipNames(sentence), "the permissions in the sentence").toEqual(names);
    await expect(page.locator("p.summary__note")).toContainText(/^This replaces any permissions .+ had given .+ before; it does not add to them\.$/);

    // The details: the delegate as a link, and the permissions, each a chip, with how many of the most a delegation holds. The sentence's chips are named for a screen reader, by their words.
    await expect(rowValue(page, "Delegate").getByRole("link")).toHaveAttribute("href", `/xrpl/account/${String(tx.Authorize)}`);
    expect(await chipNames(rowValue(page, "Permissions"))).toEqual(names);
    await expect(rowValue(page, "Permissions")).toContainText(`${names.length} of 10`);
    await expect(sentence.locator(".permchip .sr").first()).toHaveText(/^: Any \w+ transaction$/);
    // It was not sent by a delegate: no row for that.
    await expect(page.locator("dl.kv-list dt", { hasText: /^Sent by$/ })).toHaveCount(0);
  });

  test("that removed every permission says so, with no permission to list and no note", async ({ page }) => {
    const { id, owner } = objectCase("xrpl", "delegate-set-empty");
    const { tx } = transactionOf("xrpl", id);
    await page.goto(`/xrpl/tx/${id}`);
    await hydrated(page);
    const sentence = page.locator("p.summary__sentence");
    await expect(sentence).toContainText(" removed every permission it had given ");
    await expect(sentence.locator('a[href^="/xrpl/account/"]').first()).toHaveAttribute("href", `/xrpl/account/${owner}`);
    await expect(sentence.locator('a[href^="/xrpl/account/"]').nth(1)).toHaveAttribute("href", `/xrpl/account/${String(tx.Authorize)}`);
    await expect(sentence.locator(".permchip")).toHaveCount(0);
    await expect(page.locator("p.summary__note")).toHaveCount(0);
    await expect(rowValue(page, "Permissions")).toHaveText("0 of 10");
  });

  test("that failed says it tried, with the permissions it tried to give and the result's words", async ({ page }) => {
    const { id } = objectCase("xrpl", "delegate-set-failed");
    const { tx, meta } = transactionOf("xrpl", id);
    const names = (tx.Permissions as Array<{ Permission: { PermissionValue: string } }>).map((entry) => entry.Permission.PermissionValue);
    await page.goto(`/xrpl/tx/${id}`);
    await hydrated(page);
    const sentence = page.locator("p.summary__sentence");
    await expect(sentence).toContainText(" tried to let ");
    expect(await chipNames(sentence)).toEqual(names);
    await expect(page.locator(".page-head__title .pill")).toContainText(meta.TransactionResult);
    await expect(rowValue(page, "Permissions")).toContainText(`${names.length} of 10`);
  });
});

// ---- With DELEGATION off ----------------------------------------------------------------------------------------------------------------------------------------------------------

test.describe("with DELEGATION off", () => {
  test.skip(!OFF, "DELEGATION is on in the Worker under test: the tab is checked above");

  test("the tab is the 'soon' label, not a link, and its URL is the account page", async ({ page, request }) => {
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
    const tabs = tabsOf(page);
    await expect(tabs.locator(".tabs__item.is-soon", { hasText: "Delegation" })).toHaveText(/^Delegation\s*soon$/);
    await expect(tabs.getByRole("link", { name: "Delegation" })).toHaveCount(0);

    const redirect = await request.get(tabPath(XRPL_ACCOUNT), { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers().location).toBe(`/xrpl/account/${XRPL_ACCOUNT}`);
    await page.goto(tabPath(XRPL_ACCOUNT));
    await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}`);
  });

  test.describe("what the transactions and the Objects tab say without it", () => {
    test.skip(LIVE, FIXTURES);

    test("the Objects tab keeps the delegation's fields and has no link to the tab", async ({ page }) => {
      await page.goto(`/xrpl/account/${XRPL_ACCOUNT}?tab=objects`);
      await expect(page.getByRole("main")).toContainText("Delegate");
      await expect(page.getByRole("main")).toContainText("On behalf of");
      await expect(page.getByRole("main")).toContainText(/Permissions\s*\d+ of 10/);
      await expect(page.getByRole("link", { name: "View delegation →" })).toHaveCount(0);
      await expect(page.locator('a[href*="tab=delegation"]').and(page.locator(".tabs__item"))).toHaveCount(0);
    });

    test("a delegated payment still says who sent it, in its sentence and its Sent by row, and links no delegation", async ({ page }) => {
      const { id, owner } = objectCase("xrpl", "delegated-payment");
      const delegate = String(transactionOf("xrpl", id).tx.Delegate);
      await page.goto(`/xrpl/tx/${id}`);
      await expect(page.locator("p.summary__sentence")).toContainText(" sent it on behalf of ");
      await expect(rowValue(page, "Sent by").getByRole("link").first()).toHaveAttribute("href", `/xrpl/account/${delegate}`);
      await expect(rowValue(page, "Sent by")).toContainText("The delegate signed this transaction and paid its fee");
      await expect(page.getByRole("link", { name: "View the delegation" })).toHaveCount(0);
      await expect(page.locator(`a[href="${tabPath(owner)}"]`)).toHaveCount(0);
    });

    test("a DelegateSet is still described, with its permissions", async ({ page }) => {
      const { id } = recordedDelegateSet();
      await page.goto(`/xrpl/tx/${id}`);
      await expect(page.locator("p.summary__sentence")).toContainText(" on its behalf.");
      await expect(page.locator("p.summary__sentence .permchip")).not.toHaveCount(0);
    });
  });
});
