import type { Locator, Page } from "@playwright/test";

import { expect, hydrated, test } from "./support";
import { amendmentsTable, headOf, listedAmendment, needs, rowsOf, SKIP_OFF, VALIDATORS_OFF } from "./validators-pages";

// The amendments list (`/{net}/amendments`) and an amendment's page (`/{net}/amendments/{name}`) in a browser: the status chips, the line of an
// amendment about to activate, the yes-votes chart's keys and table, the other validators' votes, an ID in lower case, the links to a ledger and to an
// EnableAmendment, and the countdowns with and without JavaScript. The amendments are read from the pages (an amendment with a majority, where a real
// stack has none, skips what needs one); nothing here changes what the fixture server answers.
//
// Where E2E_FEATURES_OFF lists VALIDATORS, every test here skips itself (validators.spec.ts checks the off-case).

test.skip(VALIDATORS_OFF, SKIP_OFF);

const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);
const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { sameDocument: true }));

/** The amendment with a majority that the list names first, opened; where there is none, `needs` skips the test (a real stack between votes) or fails it (the fixtures). */
async function openMajority(page: Page): Promise<{ name: string; href: string }> {
  const majority = await listedAmendment(page, "majority");
  needs(majority !== null, "amendment with a majority");
  await page.goto(majority!.href);
  await hydrated(page);
  return majority!;
}

/** The card of the yes votes' chart, found by the id of its title. */
const yesCard = (page: Page) => page.locator('section[aria-labelledby="amendment-yes-title"]');

/** "Oct 16, 2026, 16:37 UTC" (the slider's text of a flag ledger's round), as unix milliseconds. */
function momentOf(text: string): number {
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{2}):(\d{2}) UTC/.exec(text);
  if (!match) throw new Error(`no date and time at the start of "${text}"`);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[1]!);
  return Date.UTC(Number(match[3]), month, Number(match[2]), Number(match[4]), Number(match[5]));
}

const HOUR = 3_600_000;

/** What a countdown says in the browser (`untilText`): "in 3 days", "in ~11 min", "in under a minute". Never in a stored page. */
const COUNTING = /\bin (~?\d+ (min|h|days)|under a minute)\b/;

test.describe("the list", () => {
  test("filters by status with the chips: a chip is ?status=…, noindex and no canonical link, its rows its count; All is the default view", async ({ page }) => {
    await page.goto("/xrpl/amendments");
    await hydrated(page);
    await markDocument(page);
    const chips = page.getByRole("group", { name: "Filter by status" });
    const all = chips.getByRole("link", { name: /^All \d/ });
    await expect(all).toHaveAttribute("aria-current", "true");
    await expect(rowsOf(amendmentsTable(page))).toHaveCount(Number((await all.textContent())!.replace(/\D/g, "")));
    expect((await headOf(page)).canonical).toMatch(/\/xrpl\/amendments$/);

    // The chips say D1's words as the board's ("Activating", "Voting", "Activated", "Obsolete", "Unknown"); the URL says D1's.
    const voting = chips.getByRole("link", { name: /^Voting \d/ });
    const count = Number((await voting.textContent())!.replace(/\D/g, ""));
    await voting.click();
    await page.waitForURL((url) => url.search === "?status=voting");
    await expect(voting).toHaveAttribute("aria-current", "true");
    await expect(all).not.toHaveAttribute("aria-current", /./);
    await expect(rowsOf(amendmentsTable(page))).toHaveCount(count);
    await expect(rowsOf(amendmentsTable(page)).filter({ hasNotText: "Voting" })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

    await chips.getByRole("link", { name: /^Activated \d/ }).click();
    await page.waitForURL((url) => url.search === "?status=enabled");
    // Retrying, not a loop over `.all()`: the URL changes before the list is drawn, and the "Voting" rows would be taken, then go away.
    await expect(rowsOf(amendmentsTable(page)).first()).toContainText("Activated");
    await expect(rowsOf(amendmentsTable(page)).filter({ hasNotText: "Activated" })).toHaveCount(0);

    await all.click();
    await page.waitForURL((url) => url.pathname === "/xrpl/amendments" && url.search === "");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    expect(await sameDocument(page)).toBe(true);
  });

  test("leads from the line of an amendment activating soon to its page", async ({ page }) => {
    await page.goto("/xrpl/amendments");
    await hydrated(page);
    const soon = page.getByRole("region", { name: "Activating soon" });
    needs((await soon.count()) > 0, `amendment activating soon (the "Activating soon" card)`);
    const line = soon.getByRole("listitem").first();
    const name = (await line.locator("a.amendments__soonname").textContent())!.trim();
    await expect(line).toContainText("more than 80%");
    await line.getByRole("link", { name: `Votes and history of ${name} →` }).click();
    await page.waitForURL((url) => url.pathname === `/xrpl/amendments/${name}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByText("Live · updates every minute")).toBeVisible();
  });
});

test.describe("an amendment's page", () => {
  test("moves the yes-votes chart's slider a day with Page Down and Page Up, a flag ledger with the arrows", async ({ page }) => {
    await openMajority(page);
    const slider = yesCard(page).getByRole("slider", { name: "Yes votes per flag ledger, % of the UNL, last 30 days, flag ledger by flag ledger" });
    await expect(slider).toHaveAttribute("aria-keyshortcuts", "PageUp PageDown");
    await slider.focus();
    const newest = Number(await slider.getAttribute("aria-valuemax"));
    await expect(slider).toHaveAttribute("aria-valuenow", String(newest));
    const said = (await slider.getAttribute("aria-valuetext"))!;

    // A flag ledger is about 15 minutes: an arrow moves one.
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", String(newest - 1));
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuetext", said);

    // Page Down moves the rounds of a day back (the newest day's count, `pageStep`), and Page Up as many forward.
    await page.keyboard.press("PageDown");
    await expect(slider).not.toHaveAttribute("aria-valuenow", String(newest));
    const back = Number(await slider.getAttribute("aria-valuenow"));
    expect(newest - back).toBeGreaterThan(1);
    const dayEarlier = momentOf(said) - momentOf((await slider.getAttribute("aria-valuetext"))!);
    expect(dayEarlier).toBeGreaterThan(23 * HOUR);
    expect(dayEarlier).toBeLessThan(25 * HOUR);
    await page.keyboard.press("PageUp");
    await expect(slider).toHaveAttribute("aria-valuenow", String(newest));
    await expect(slider).toHaveAttribute("aria-valuetext", said);
  });

  test("shows the changes-only table of the yes votes with the Table radio", async ({ page }) => {
    await openMajority(page);
    const card = yesCard(page);
    await expect(card.locator(".chart__view")).toBeVisible();
    await expect(card.locator(".chart__table")).toBeHidden();
    const rounds = Number(await card.getByRole("slider").getAttribute("aria-valuemax")) + 1;

    await card.getByRole("radio", { name: "Table" }).check();
    await expect(card.locator(".chart__view")).toBeHidden();
    const table = card.getByRole("table", { name: "Yes votes per flag ledger, changes only" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText(["From flag ledger", "Date (UTC)", "Yes", "Share", "Majority"]);
    // One row per change of the count, newest first, each from its flag ledger: far fewer than the rounds the chart has.
    const rows = await rowsOf(table).count();
    expect(rows).toBeGreaterThanOrEqual(1);
    expect(rows).toBeLessThan(rounds);
    await expect(rowsOf(table).first().getByRole("link")).toHaveAttribute("href", /^\/xrpl\/ledger\/\d+$/);
  });

  test("opens the votes of the other validators in their disclosure", async ({ page }) => {
    await openMajority(page);
    const others = page.locator("details.amendment__others");
    await expect(others).not.toHaveAttribute("open", /.*/);
    await expect(page.getByRole("table", { name: "Votes of other validators" })).toBeHidden();

    await others.locator("summary").click();
    await expect(others).toHaveAttribute("open", "");
    await expect(page.getByRole("table", { name: "Votes of other validators" })).toBeVisible();
    await expect(others.getByRole("link", { name: "All validators →" })).toHaveAttribute("href", "/xrpl/validators?scope=all");
  });

  test("has a note in the votes' place for an enabled and an obsolete amendment, which are no longer voted on: no vote table, no count of no votes", async ({ page }) => {
    for (const [status, note] of [
      ["enabled", "An enabled amendment is no longer voted on."],
      ["obsolete", "Current software can no longer vote for it, so no votes are shown."],
    ] as const) {
      const listed = await listedAmendment(page, status);
      needs(listed !== null, `${status} amendment`);
      await page.goto(listed!.href);
      await hydrated(page);
      await expect(page.getByRole("region", { name: "Votes" }).locator(".amendment__novotes")).toHaveText(note);
      await expect(page.getByRole("table", { name: "Votes of the UNL validators" })).toHaveCount(0);
      await expect(page.locator("details.amendment__others")).toHaveCount(0);
      await expect(page.getByRole("main")).not.toContainText(/\d+ yes · \d+ no/);
    }
  });

  test("lands on the name's URL from the ID in lower case", async ({ page }) => {
    const { name } = await openMajority(page);
    const id = (await page.locator(".amendment__id").textContent())!.trim();
    expect(id).toMatch(/^[0-9A-F]{64}$/);
    const response = await page.goto(`/xrpl/amendments/${id.toLowerCase()}`);
    expect(response!.status()).toBe(200);
    expect(response!.request().redirectedFrom()?.url()).toMatch(new RegExp(`/xrpl/amendments/${id.toLowerCase()}$`));
    expect(new URL(page.url()).pathname).toBe(`/xrpl/amendments/${name}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  });

  test("leads to a ledger and to an EnableAmendment: each link lands on its page", async ({ page }) => {
    const { href } = await openMajority(page);
    await markDocument(page);
    const event = page.locator(".amendment__event", { has: page.locator("a.amendment__tx") }).first();
    needs((await event.count()) > 0, "EnableAmendment of the amendment in the indexed history");

    // Under the fixtures a ledger and a transaction of the history are made up, and the explorer's own not-found page of their kind answers: the link
    // is what is checked, it lands on the route of its kind.
    const ledger = event.locator(".amendment__when a");
    const ledgerHref = (await ledger.getAttribute("href"))!;
    expect(ledgerHref).toMatch(/^\/xrpl\/ledger\/\d+$/);
    await ledger.click();
    await page.waitForURL((url) => url.pathname === ledgerHref);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goBack();
    await page.waitForURL((url) => url.pathname === href);
    const tx = page.locator(".amendment__event a.amendment__tx").first();
    const txHref = (await tx.getAttribute("href"))!;
    expect(txHref).toMatch(/^\/xrpl\/tx\/[0-9A-F]{64}$/);
    await expect(tx).toHaveText(/^EnableAmendment [0-9A-F]{6}…[0-9A-F]{4}$/);
    await tx.click();
    await page.waitForURL((url) => url.pathname === txHref);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe("the countdowns", () => {
  /** The countdown in the status pill of the amendment's identity: the moment it activates, `dateTime`. */
  const pillTime = (page: Page): Locator => page.locator(".amendment__identity .amendment__marks time");

  test("are the absolute time with JavaScript off", async ({ page, contextFor }) => {
    const { href } = await openMajority(page);
    const context = await contextFor({ javaScriptEnabled: false });
    const off = await context.newPage();
    await off.goto(href);
    // The pill says the day ("expected Oct 21"), the moment in full is its title and its `dateTime`.
    const time = pillTime(off);
    await expect(time).toHaveText(/^expected [A-Z][a-z]{2} \d{1,2}$/);
    await expect(time).toHaveAttribute("title", /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2} UTC$/);
    expect(await time.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
    // Nothing on the page counts down: no "in 3 days" was stored.
    await expect(off.getByRole("main")).not.toContainText(COUNTING);

    // The list's line of it says the moment in its words; the countdown after them is the browser's alone.
    await off.goto("/xrpl/amendments");
    await expect(off.getByRole("region", { name: "Activating soon" }).getByRole("listitem").first()).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2} UTC/);
    await expect(off.getByRole("main")).not.toContainText(COUNTING);
  });

  test("tick in the browser with JavaScript on", async ({ page, contextFor }) => {
    const { href } = await openMajority(page);
    const at = Date.parse((await pillTime(page).getAttribute("datetime"))!);
    // A browser whose clock is half an hour and half a minute before the moment, then a minute later, then past it.
    const context = await contextFor();
    await context.clock.install({ time: at - 30.5 * 60_000 });
    const clocked = await context.newPage();
    await clocked.goto(href);
    await hydrated(clocked);
    await expect(pillTime(clocked)).toHaveText("in 31 min");
    await context.clock.fastForward("01:00");
    await expect(pillTime(clocked)).toHaveText("in 30 min");
    await context.clock.fastForward("31:00");
    await expect(pillTime(clocked)).not.toHaveText(/^in /);
  });
});
