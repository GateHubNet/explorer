import type { Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { accountTitle, fixtureEntryOf, fixtureTomlOf, LIVE, XAHAU_ACCOUNT, XAHAU_DELETED, XAHAU_LEDGER, XAHAU_REMIT, XRPL_ACCOUNT, XRPL_DELETED, XRPL_PAYMENT } from "./fixtures";
import { drawnBy, expectAccountsDrawn, flat, shortOf } from "./names-pages";
import { expect, hydrated, test } from "./support";

// Display names (E9, the display names spec), end to end, on XRPL and on Xahau: what the account page says of a name and how it is known, what a link to an account reads and carries
// elsewhere, and the pages that draw accounts (a transaction, the home page's table). The names are the fixtures' (`account_names.json`, synthetic, test/fixtures/PROVENANCE.md), read here
// and never written by hand: a real stack has names of its own, so the file is for the fixture stack alone. This file changes nothing the fixture server answers (the parallel `chromium`
// project's other specs run beside it): what needs a failing names call or a moving chain is names-live.spec.ts's, in the `live` project.

test.skip(featuresOff(process.env).has("NAMES"), "NAMES is off in the Worker under test: names-off.spec.ts and pages-names-off.spec.ts (the Worker's own specs, in the `worker-off` and `worker-names-off` projects) are its off-case");
test.skip(LIVE, "reads the names of the fixtures: a real stack or a deployed Worker has names of its own");

/** The account page's header region: the picture, the heading, the address and what is said under it. */
const headOf = (page: Page) => page.locator(".account-id");

const NETS = {
  xrpl: { net: "xrpl" as const, account: XRPL_ACCOUNT, seen: `/xrpl/tx/${XRPL_PAYMENT}`, tomlFile: "xrp-ledger.toml" },
  xahau: { net: "xahau" as const, account: XAHAU_ACCOUNT, seen: `/xahau/ledger/${XAHAU_LEDGER}`, tomlFile: "xahau.toml" },
};

for (const { net, account, seen, tomlFile } of Object.values(NETS)) {
  const entry = fixtureEntryOf(net, account)!;
  const name = entry.display_name!.text;
  const domain = entry.domain!;

  test.describe(`${net}: a verified account`, () => {
    test("says its name, that it is verified and by which domain, with the address under it", async ({ page }) => {
      expect(entry.display_name?.kind, "the fixtures give the account a verified name").toBe("verified");
      await page.goto(`/${net}/account/${account}`);
      await hydrated(page);

      // One heading, the name, then the words of its mark, as a reader gets it.
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toHaveCount(1);
      await expect(heading).toHaveText(`${name} verified name`);
      await expect(headOf(page).locator(".account-head__address")).toHaveText(account);
      await expect(page).toHaveTitle(accountTitle(net, account));
      // The breadcrumb ends with the name, not the address.
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(name);
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).not.toContainText(shortOf(account));

      // The domain is a link that follows nobody, to a new tab; the line says what kind of name this is.
      const kind = headOf(page).locator(".account-head__kind");
      await expect(kind).toHaveText(`Verified name · domain ${domain} (opens in a new tab)`);
      const link = kind.getByRole("link", { name: new RegExp(`^${domain.replace(/\./g, "\\.")}`) });
      await expect(link).toHaveAttribute("href", `https://${domain}`);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    });

    test("opens How we know with the keyboard, and it shows the two checks that passed, when the toml was checked and what else it says", async ({ page }) => {
      const toml = fixtureTomlOf(net, domain);
      await page.goto(`/${net}/account/${account}`);
      await hydrated(page);

      const disclosure = page.locator("details.disc");
      const summary = disclosure.locator("summary");
      // Closed to begin with, so that the page is the name first; its words are in the page already (no script is needed to open it).
      await expect(disclosure).not.toHaveAttribute("open", "");
      await expect(disclosure.locator(".disc__checks")).toBeHidden();

      await summary.focus();
      await expect(summary).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(disclosure).toHaveAttribute("open", "");

      // The two checks, each told as passed to a reader who sees no tick.
      const checks = disclosure.locator(".disc__checks li");
      await expect(checks).toHaveCount(2);
      await expect(checks.nth(0)).toHaveText(`Passed: The account's Domain field is ${domain}.`);
      await expect(checks.nth(1)).toHaveText(`Passed: ${domain}/.well-known/${tomlFile} (opens in a new tab) lists this address under [[ACCOUNTS]], and its desc gives the name.`);
      const tomlLink = checks.nth(1).getByRole("link");
      await expect(tomlLink).toHaveAttribute("href", `https://${domain}/.well-known/${tomlFile}`);
      await expect(tomlLink).toHaveAttribute("rel", "noopener noreferrer nofollow");
      await expect(tomlLink).toHaveCSS("text-decoration-line", "underline");
      await expect(disclosure.locator(".disc__checked")).toHaveText(/^Checked [A-Z][a-z]{2} \d{1,2}, 2\d{3}, \d{2}:\d{2} UTC$/);

      // What else the toml says: the principals and the currencies it lists.
      const facts = disclosure.locator(".toml-facts");
      for (const principal of toml.principals ?? []) await expect(facts.locator("div", { hasText: "Principals" })).toContainText(principal);
      for (const { code } of toml.currencies ?? []) await expect(facts.locator("div", { hasText: "Currencies" })).toContainText(code);
      await expect(disclosure).toContainText("What else that toml says");

      // The same key closes it, and Space opens it again: the native disclosure, whatever the script did.
      await page.keyboard.press("Enter");
      await expect(disclosure).not.toHaveAttribute("open", "");
      await expect(disclosure.locator(".disc__checks")).toBeHidden();
      await page.keyboard.press("Space");
      await expect(disclosure).toHaveAttribute("open", "");
    });

    test("is drawn by its name wherever a page links it, with the title that says how it is known, and the link leads to it", async ({ page }) => {
      await page.goto(seen);
      await hydrated(page);

      const link = page.getByRole("main").getByRole("link", { name: `${name} verified name` }).first();
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("title", `Verified by ${domain} · ${account}`);
      await expect(link).toHaveAttribute("href", `/${net}/account/${account}`);

      await link.click();
      await page.waitForURL(`**/${net}/account/${account}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name} verified name`);
    });
  });
}

// A name is not mono, so the face no longer tells a link from the words around it, and `--link` against muted text is near 1:1 (WCAG 1.4.1); axe does not count an inline-flex
// link as one in a block of text, so it cannot say it. A named link's name is underlined; the h1's name is no link, and is not.
test.describe("xahau: a named account in the activation line", () => {
  test("is underlined in its sentence, so that more than its colour tells it from the words around it, and the h1's name is not", async ({ page }) => {
    await page.goto(`/xahau/account/${XAHAU_ACCOUNT}`);
    await hydrated(page);

    const parent = headOf(page).locator(".account-id__meta a.acct");
    await expect(parent).toHaveCount(1);
    const address = (await parent.getAttribute("href"))!.slice("/xahau/account/".length);
    const drawn = drawnBy("xahau", address);
    expect(drawn.named, "the fixtures name the account that activated it").toBe(true);
    await expect(parent).toHaveText(drawn.text);
    await expect(parent.locator(".acct__name")).toHaveCSS("text-decoration-line", "underline");
    await expect(headOf(page).locator("h1")).toHaveCSS("text-decoration-line", "none");
  });
});

test.describe("xrpl: the deleted account GateHub named, with an advisory label", () => {
  test("says its name as GateHub's, with the label's banner, its source and details, and the help for a name that is wrong", async ({ page }) => {
    const entry = fixtureEntryOf("xrpl", XRPL_DELETED)!;
    const label = entry.labels!.advisory!;
    expect(entry.display_name?.kind, "the fixtures name it as GateHub's").toBe("account");
    await page.goto(`/xrpl/account/${XRPL_DELETED}`);
    await hydrated(page);

    // The name, its account network name, the words of how it is known and of the label; the address under it.
    const shown = `${entry.display_name!.text} · ${entry.account_network_name!}`;
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${shown} named by GateHub labelled advisory by GateHub`);
    await expect(headOf(page).locator(".account-head__address")).toHaveText(XRPL_DELETED);
    // No domain is given a deleted account: the line says so, and the page still says it is deleted.
    await expect(headOf(page).locator(".account-head__kind").first()).toHaveText("Named by GateHub · no domain set");
    await expect(headOf(page).locator(".account-head__help")).toContainText("GateHub names accounts that have no verified name, such as an exchange's hot wallet.");
    await expect(page.getByText("This account was deleted from the ledger")).toBeVisible();

    // The banner: its title, GateHub's description and where it comes from, and a link to the details that follows nobody.
    const banner = page.locator(".notice--warning", { hasText: "Labelled advisory by GateHub" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(label.description!);
    await expect(banner).toContainText("Source: GateHub");
    const details = banner.getByRole("link", { name: /^Details/ });
    await expect(details).toHaveAttribute("href", label.url!);
    await expect(details).toHaveAttribute("target", "_blank");
    await expect(details).toHaveAttribute("rel", "noopener noreferrer nofollow");
    // It comes after the breadcrumb and before the account's card.
    const order = await page.evaluate(() => {
      const index = (element: Element | null) => (element ? [...document.querySelectorAll("*")].indexOf(element) : -1);
      return {
        breadcrumb: index(document.querySelector('nav[aria-label="Breadcrumb"]')),
        banner: index([...document.querySelectorAll(".notice--warning")].find((notice) => notice.textContent?.includes("Labelled advisory by GateHub")) ?? null),
        card: index(document.querySelector(".account-card")),
      };
    });
    expect(order.breadcrumb).toBeGreaterThan(-1);
    expect(order.banner).toBeGreaterThan(order.breadcrumb);
    expect(order.card).toBeGreaterThan(order.banner);
    // A name that carries a label is not in the title: a title may say a verified name or GateHub's, and only an unlabelled one.
    await expect(page).toHaveTitle(`Account ${shortOf(XRPL_DELETED)} · XRPL · explorer`);
  });
});

test.describe("xahau: the deleted account with a scam label and no name", () => {
  test("is its address with the label's mark, the label's banner, and no domain line to say", async ({ page }) => {
    const address = XAHAU_DELETED;
    const entry = fixtureEntryOf("xahau", address)!;
    expect(Object.keys(entry.labels ?? {}), "the fixtures give it the scam label").toEqual(["scam"]);
    expect(entry.display_name, "and no name").toBeUndefined();
    expect(entry.domain, "and no domain").toBeUndefined();
    await page.goto(`/xahau/account/${address}`);
    await hydrated(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${address} labelled scam by GateHub`);
    const banner = page.locator(".notice--warning", { hasText: "Labelled scam by GateHub" });
    await expect(banner).toContainText(entry.labels!.scam!.description!);
    // The label gave no source and no link: the banner has neither, and the header no domain line at all (a deleted account has no domain).
    await expect(banner).not.toContainText("Source:");
    await expect(banner.getByRole("link")).toHaveCount(0);
    await expect(headOf(page).locator(".account-head__kind")).toHaveCount(0);
    await expect(headOf(page)).not.toContainText("domain");
    await expect(page.locator("details.disc")).toHaveCount(0);
    await expect(page).toHaveTitle(`Account ${shortOf(address)} · Xahau · explorer`);
  });
});

test.describe("a transaction", () => {
  test("names the accounts in its sentence, its flow, its details and its balance changes, each with the title that says how its name is known", async ({ page }) => {
    await page.goto(`/xrpl/tx/${XRPL_PAYMENT}`);
    await hydrated(page);
    await expect(page.getByRole("tablist", { name: "Raw data" })).toBeVisible();

    // The sender is a verified name in the fixtures and the recipient is a short address: each place says both, as the fixtures say them.
    const sentence = await expectAccountsDrawn(page.locator("p.summary__sentence"), "xrpl");
    expect(sentence.kinds).toEqual(new Set(["verified"]));
    expect(sentence.plain).toBe(1);
    const flow = await expectAccountsDrawn(page.getByRole("group", { name: "Flow of funds" }), "xrpl");
    expect(flow.kinds).toEqual(new Set(["verified"]));
    expect(flow.plain).toBe(1);
    // The details give the whole address after a name, and of an account with none the whole address alone.
    const details = await expectAccountsDrawn(page.locator("dl.kv-list"), "xrpl", { full: true });
    expect(details.kinds).toEqual(new Set(["verified"]));
    expect(details.plain).toBe(1);
    const balances = await expectAccountsDrawn(page.getByRole("table", { name: "Balance changes" }), "xrpl");
    expect(balances.kinds).toEqual(new Set(["verified"]));
    expect(balances.plain).toBe(1);

    // The sentence reads as a sentence to a reader: the name and its words where the sender was.
    const text = flat(await page.locator("p.summary__sentence").textContent());
    expect(text).toMatch(new RegExp(`^${drawnBy("xrpl", XRPL_ACCOUNT).text} sent .+ XRP to r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}\\.$`));
  });

  test("names a Xahau Remit's accounts of every kind: verified, GateHub's and a domain that is not verified", async ({ page }) => {
    await page.goto(`/xahau/tx/${XAHAU_REMIT}`);
    await hydrated(page);
    await expect(page.getByRole("tablist", { name: "Raw data" })).toBeVisible();

    const drawn = await expectAccountsDrawn(page.getByRole("main"), "xahau", { full: "either" });
    expect(drawn.kinds).toEqual(new Set(["verified", "account", "domain"]));
    // The domain's name carries the visible words, not a mark that only a reader hears.
    await expect(page.getByRole("main").locator(".unv").first()).toHaveText("not verified");
  });
});

test.describe("the home page's table of transactions", () => {
  for (const { net, path } of [
    { net: "xrpl" as const, path: "/xrpl" },
    { net: "xahau" as const, path: "/xahau" },
  ]) {
    test(`${net}: draws each account by what the fixtures say, the three ways a name is known among them`, async ({ page }) => {
      await page.goto(path);
      await hydrated(page);

      const table = page.getByRole("table", { name: "Latest transactions" });
      await expect(table).toBeVisible();
      const drawn = await expectAccountsDrawn(table, net);
      expect(drawn.plain, "an account with no name is its short address").toBeGreaterThan(0);
      // The recordings' newest transactions have accounts named every way the fixtures name one, so the table shows each of the three marks.
      expect([...drawn.kinds].sort(), "the kinds of names in the table").toEqual(["account", "domain", "verified"]);
    });
  }
});
