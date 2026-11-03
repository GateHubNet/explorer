import type { Locator, Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { MPT_FEE_PAYMENT_ISSUANCE, MPT_FIXTURE_IDS, MPT_LOCKED_HOLDING, MPT_MINT_ISSUANCE, MPT_RECORDED } from "../support/mpt-case-rules";
import { count, LIVE, XRPL_ACCOUNT } from "./fixtures";
import { holdersOf, issuanceOf, mptListOf, scaled, share, transfersOf } from "./mpt-pages";
import { expect, hydrated, test } from "./support";

// The MPT pages (`/{net}/mpt/{ID}`, its holders and its transfers, README "MPT pages") in a browser, and the places that lead to them, with and without JavaScript: an issuance of the index (its header, six tiles, flags, metadata with its
// links and its raw hex, top holders and "All N holders →", recent transfers and "Older →"), the holders' and the transfers' pages and their pagers, an issuance in each of its other states (every balance locked, destroyed, no metadata, metadata
// that is not JSON), one read from the network, one nobody has, the Xahau page, the issuer's text at 375 and 1280 px, an MPT payment's transaction page, the account's Tokens card, the MPT tab's pills and its longest row, and search by an
// issuance ID. The issuances are the fixtures' (test/support/mpt-case-rules.ts names them; test/e2e/mpt-pages.ts reads their answers back), and every figure of an issuance, its holders and its transfers is worked out from the same files (`scaled`, `share`), never written here; the few that come from the hand-written files (the account's holdings, a transfer fee, the amounts of two
// recorded payments) are written where they are used. The words are the spec's. The answers are D9's, generated around the recordings (test/fixtures/PROVENANCE.md). Everything here reads the fixtures and changes none. The tab's search, pager and Xahau control are tokens.spec.ts's ("the MPT tab" and
// its no-JavaScript case); the tags and the manifest between the routes are client-meta.spec.ts's, the image og.spec.ts's, axe a11y.spec.ts's. Where `E2E_FEATURES_OFF` lists `MPT` the pages are not found, and the off-case is checked instead.

const MPT_OFF = featuresOff(process.env).has("MPT");

test.skip(LIVE, "the pages are drawn from the generated MPT fixtures (test/e2e/mpt-pages.ts), which a real stack does not hold");

const { htf: HTF, nonConforming: HOSTILE, nodeOnly: NODE_ONLY, nowhere: NOWHERE, lockedAll: LOCKED_ALL, destroyed: DESTROYED, noMetadata: BARE, rawMetadata: NOT_JSON } = MPT_FIXTURE_IDS;
const pathOf = (id: string) => `/xrpl/mpt/${id}`;
const HTF_PATH = pathOf(HTF);

const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { sameDocument: true }));
const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);

/** The head of the document as the browser has it now: what a search engine and a link preview would read. */
const head = (page: Page) =>
  page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
    ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
    title: document.title,
  }));

const tableOf = (page: Page, name: string) => page.getByRole("table", { name, exact: true });
/** The rows of a table, its header left out. */
const rowsOf = (page: Page, name: string) => tableOf(page, name).locator('[role="row"]:not(.table__head)');
const pagination = (page: Page) => page.getByRole("navigation", { name: "Pagination" });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
/** A card by its title: the `<section>` the Card is, named by its `<h2>`. */
const card = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true });
/** A figure of the row of six tiles: the tile whose label is `label`. Its parts are separate elements, so each is read by itself. */
const tile = (page: Page, label: string) =>
  page.getByRole("region", { name: "Figures", exact: true }).locator(".stat").filter({ has: page.locator(".stat__label").getByText(label, { exact: true }) });
/** The text of the cells of a row, in order. */
const cellsOf = (row: Locator) => row.locator('[role="cell"]');

/** The time of a transfer as the table's cell writes it (UTC, to the second): the date and the clock are two lines of the kit's cell, which a text read joins. */
const when = (iso: string) => `${iso.slice(0, 10)}${iso.slice(11, 19)}`;

/** The words of the transfers' Kind column (spec 3.3, decision 9) for the kinds the fixtures hold. */
const KINDS: Record<string, string> = { payment: "Transfer", clawback: "Clawback", lock: "Lock", unlock: "Unlock", escrow_create: "Escrow", escrow_finish: "Escrow finished", escrow_cancel: "Escrow cancelled" };

/** The elements of the page's cards that reach past their card's right edge, outside what scrolls (a table's body, a `pre`): text that did not wrap, painted over what is beside it (plan ruling C17). */
const pastTheEdge = (page: Page) =>
  page.evaluate(() => {
    const past: string[] = [];
    for (const card of document.querySelectorAll("main .card")) {
      const edge = card.getBoundingClientRect().right;
      for (const element of card.querySelectorAll("*")) {
        if (element instanceof SVGElement) continue;
        let scrolls = false;
        for (let parent = element.parentElement; parent !== null && parent !== card; parent = parent.parentElement) {
          const overflow = getComputedStyle(parent).overflowX;
          if (overflow === "auto" || overflow === "scroll") scrolls = true;
        }
        if (!scrolls && element.getBoundingClientRect().right > edge + 1) past.push(`${element.tagName.toLowerCase()}.${element.className}: ${(element.textContent ?? "").slice(0, 40)}`);
      }
    }
    return past;
  });
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("with MPT off", () => {
  test.skip(!MPT_OFF, "MPT is on in the Worker under test: its pages are checked below");

  for (const path of [HTF_PATH, `${HTF_PATH}/holders`, `${HTF_PATH}/transfers`, `/xahau/mpt/${HTF}`, pathOf(NOWHERE)]) {
    test(`${path} is the not-found page of the MPT pages, whatever the ID`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByText(/^We couldn’t find the MPT pages on (XRPL|Xahau)\.$/)).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    });
  }

  test("an MPT's link-preview image is not drawn", async ({ request }) => {
    const response = await request.get(`/og/xrpl/mpt/${HTF}.png`);
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).not.toContain("image/png");
  });

  test("the kind=mpt address of the token list goes back to the issued list", async ({ page }) => {
    await page.goto("/xrpl/tokens?kind=mpt");
    await page.waitForURL((url) => url.pathname === "/xrpl/tokens" && url.search === "");
    await expect(heading(page)).toHaveText("Tokens");
  });

  test("48 hex digits are searched as any text is: no hint, and the help page, not an issuance's page", async ({ page }) => {
    await page.goto("/xrpl");
    await hydrated(page);
    const box = page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" });
    await box.fill(HTF);
    await expect(page.getByRole("list", { name: "Matches" })).toHaveCount(0);
    await box.press("Enter");
    await page.waitForURL((url) => url.pathname === "/xrpl/search");
    await expect(page.getByText("An MPT issuance ID (48 hex digits)")).toHaveCount(0);
  });

  test("an MPT payment reads in units, with no link and no lookup, on the transaction page and on the account's Tokens card", async ({ page }) => {
    await page.goto(`/xrpl/tx/${MPT_RECORDED.payment_mint.hash}`);
    await expect(page.locator("p.summary__sentence")).toContainText(/ issued 1\s+units of MPT 064E273A… to /);
    await expect(page.locator('a[href*="/mpt/"]')).toHaveCount(0);
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
    await expect(card(page, "Tokens")).toContainText("MPT 0663EACA…");
    await expect(page.locator('a[href*="/mpt/"]')).toHaveCount(0);
  });
});

test.describe("an issuance of the index", () => {
  test.skip(MPT_OFF, "MPT is off in the Worker under test: its pages are not found (checked above)");

  const issuance = issuanceOf(HTF);
  const ticker = issuance.ticker!;
  const name = issuance.metadata!.name!;
  const scale = issuance.asset_scale;

  test("is headed by the issuer's name and ticker, the issuer, and the issuance ID in full with a button that copies it", async ({ contextFor, baseURL }) => {
    const context = await contextFor({ permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    await page.goto(HTF_PATH);
    await hydrated(page);
    await expect(heading(page)).toHaveText(name);
    await expect(page).toHaveTitle(`${ticker} · ${name} · MPT · XRPL · explorer`);
    const origin = new URL(baseURL!).origin;
    expect(await head(page)).toMatchObject({ canonical: `${origin}${HTF_PATH}`, robots: null, ogImage: `${origin}/og/xrpl/mpt/${HTF}.png` });

    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Tokens" })).toHaveAttribute("href", "/xrpl/tokens?kind=mpt");
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText(ticker);
    const header = page.locator("section.token-page__card");
    await expect(header.locator(".token-page__code")).toHaveText(ticker);
    await expect(header.locator(".tag", { hasText: /^MPT$/ })).toBeVisible();
    await expect(header.locator("p.token-page__issuer")).toContainText(`Issued by ${issuance.issuer}`);
    await expect(header.locator("p.token-page__issuer")).toContainText("name and ticker from the issuance's metadata");
    await expect(header.getByRole("link", { name: "Issuer account" })).toHaveAttribute("href", `/xrpl/account/${issuance.issuer}`);
    await expect(header.locator(".mpt__idtext")).toHaveText(HTF);
    await expect(header.getByText(`/v2/mpt/${HTF}`, { exact: true })).toBeVisible();

    await header.getByRole("button", { name: "Copy issuance ID" }).click();
    await expect(header.getByRole("status")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(HTF);
  });

  test("shows the six figures in the board's order, scaled by the issuance's own scale, each with its line", async ({ page }) => {
    await page.goto(HTF_PATH);
    await expect(page.getByRole("region", { name: "Figures", exact: true }).locator(".stat__label")).toHaveText(["Outstanding", "Max amount", "Locked", "Holders", "Transfer fee", "Asset scale"]);
    const percent = (Number((BigInt(issuance.outstanding_amount) * 1000n) / BigInt(issuance.maximum_amount!)) / 10).toFixed(1);
    const figure = async (label: string, value: string, line: string | RegExp) => {
      await expect(tile(page, label).locator(".stat__value"), label).toHaveText(value);
      await expect(tile(page, label).locator(".stat__sub"), label).toHaveText(line);
    };
    await figure("Outstanding", scaled(issuance.outstanding_amount, scale), `${ticker} held by holders, ${percent}% of the max amount`);
    await figure("Max amount", scaled(issuance.maximum_amount!, scale), `${ticker}, fixed when the issuance was created`);
    // What the issuer has locked, and, added to its line, what is in escrow.
    await figure("Locked", scaled(issuance.locked_amount, scale), `${ticker} in ${issuance.locked_holders} holder balance the issuer has locked; ${scaled(issuance.escrowed_amount, scale)} ${ticker} in escrow`);
    await figure("Holders", count(issuance.holders), `accounts holding ${ticker}`);
    await figure("Transfer fee", "0.192%", `charged when holders send ${ticker} to each other`);
    await figure("Asset scale", String(scale), `Amounts are integers scaled by 10⁻⁴: 1 ${ticker} is 10,000 on the ledger.`);
  });

  test("says what the issuer allows in six rows of Yes or No in words, with the ticker in each line", async ({ page }) => {
    await page.goto(HTF_PATH);
    const flags = card(page, "Flags");
    await expect(flags.getByText("What the issuer allows, as the issuance says now.")).toBeVisible();
    await expect(flags.locator(".mptflags__label")).toHaveText(["Can lock", "Require auth", "Can escrow", "Can trade", "Can transfer", "Can clawback"]);
    // The issuance allows all six; the `locked` flag is no row, it is a notice above the figures (and this issuance is not locked).
    await expect(flags.locator(".pill")).toHaveText(["Yes", "Yes", "Yes", "Yes", "Yes", "Yes"]);
    await expect(flags.locator(".mptflags__line")).toHaveText([
      `The issuer can lock one holder's balance, or all of ${ticker}, so it cannot move.`,
      `An account needs the issuer's approval before it can hold ${ticker}.`,
      `${ticker} can be held in escrows.`,
      `The issuer allows ${ticker} on the DEX. MPT trading isn't enabled on XRPL yet.`,
      `Holders can send ${ticker} to each other, not only back to the issuer.`,
      `The issuer can take ${ticker} back from a holder.`,
    ]);
  });

  test("shows the metadata decoded, its links to another site in a new tab without handing the page over, and the raw hex in a disclosure that names its size", async ({ page }) => {
    await page.goto(HTF_PATH);
    const metadata = card(page, "Metadata");
    await expect(metadata.getByText("What the issuer wrote into the issuance, decoded. Nothing here is checked against the issuer's domain.")).toBeVisible();
    await expect(metadata.locator("dt")).toHaveText(["ticker", "name", "desc", "icon", "asset_class", "asset_subclass", "issuer_name", "uris", "uris", "additional_info"]);
    await expect(metadata.locator("dd").nth(0)).toHaveText(ticker);
    await expect(metadata.locator("dd").nth(4)).toHaveText("rwa (real-world asset)");
    // The additional information is code, an object as indented JSON.
    await expect(metadata.locator('pre[aria-label="additional_info"]')).toContainText('"purity": "999.9"');
    await expect(metadata.getByText("This metadata doesn't follow XLS-89")).toHaveCount(0);

    // The icon and each URI are links: https only, to another site, a new tab, nothing handed over, and for a search engine nothing to follow; the URI's category is its title.
    const [website, docs] = issuance.metadata!.uris!;
    const links = metadata.locator("dd a");
    await expect(links).toHaveCount(3);
    await expect(links.nth(0)).toHaveAttribute("href", issuance.metadata!.icon!);
    await expect(links.nth(1)).toHaveAttribute("href", website!.uri);
    await expect(links.nth(1)).toHaveAttribute("title", website!.category!);
    await expect(links.nth(2)).toHaveAttribute("href", docs!.uri);
    for (const at of [0, 1, 2]) {
      await expect(links.nth(at)).toHaveAttribute("target", "_blank");
      await expect(links.nth(at)).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
      await expect(links.nth(at).locator(".sr")).toHaveText("(opens a new tab)");
    }
    await expect(links.nth(1)).toContainText(`${website!.title} · helveticmetals.ch/xau`);
    // The icon is a link, never loaded: no picture comes from the issuer.
    await expect(page.locator("main img")).toHaveCount(0);

    // The raw hex: a disclosure that says its size, closed until it is opened, holding exactly what the issuer wrote.
    const raw = metadata.locator("details.mpt__hex");
    await expect(raw.locator("summary")).toHaveText(`Raw metadata, as hex (${issuance.metadata_hex!.length / 2} bytes)`);
    await expect(raw).not.toHaveAttribute("open", /.*/);
    await expect(raw.locator("pre")).toBeHidden();
    await raw.locator("summary").click();
    await expect(raw.locator("pre")).toHaveText(issuance.metadata_hex!);
  });

  test("lists its top ten holders by balance with their shares, a locked balance in words, and the way to all of them", async ({ page }) => {
    const top = holdersOf(HTF, { limit: 10 });
    expect(top.holders, "the fixtures' top ten").toHaveLength(10);
    await page.goto(HTF_PATH);
    await hydrated(page);
    await expect(tableOf(page, "Top holders").locator('[role="columnheader"]')).toHaveText(["#", "Holder", `Balance (${ticker})`, "Share of outstanding", "Balance state"]);
    const rows = rowsOf(page, "Top holders");
    await expect(rows).toHaveCount(10);
    let sum = 0n;
    for (const [at, holder] of top.holders.entries()) {
      // A holder's balance is what it holds and what of it is in escrow, and the share is that over what is outstanding.
      const balance = (BigInt(holder.amount) + BigInt(holder.escrowed_amount)).toString();
      sum += BigInt(balance);
      const cells = cellsOf(rows.nth(at));
      await expect(cells.nth(0)).toHaveText(String(at + 1));
      await expect(cells.nth(1).locator("a")).toHaveAttribute("href", `/xrpl/account/${holder.holder}`);
      await expect(cells.nth(2), holder.holder).toContainText(scaled(balance, scale));
      if (holder.escrowed_amount !== "0") await expect(cells.nth(2)).toContainText(`incl. ${scaled(holder.escrowed_amount, scale)} in escrow`);
      await expect(cells.nth(3).locator(".num")).toHaveText(share(balance, issuance.outstanding_amount));
      await expect(cells.nth(4)).toHaveText(holder.locked ? "Locked" : "Can move");
    }
    expect(top.holders.some((holder) => holder.locked), "a locked balance among the ten").toBe(true);
    // The meter beside a share is decoration: its percent is in the text.
    await expect(tableOf(page, "Top holders").locator(".token-page__meter [role]")).toHaveCount(0);
    await expect(page.getByText(`The top 10 hold ${share(sum.toString(), issuance.outstanding_amount)} of the outstanding ${ticker}.`)).toBeVisible();
    await expect(page.getByRole("link", { name: `All ${issuance.holders} holders →` })).toHaveAttribute("href", `${HTF_PATH}/holders`);
  });

  test("lists its eight latest transfers with their kinds in words, a lock's amount muted, and Older → leads to the page of the next ones", async ({ page }) => {
    const latest = transfersOf(HTF, { limit: 8 });
    expect(latest.transfers, "the fixtures' latest eight").toHaveLength(8);
    expect(latest.marker, "and a page behind them").toBeDefined();
    await page.goto(HTF_PATH);
    await expect(tableOf(page, "Recent transfers").locator('[role="columnheader"]')).toHaveText(["Time (UTC)", "Kind", "From", "To", `Amount (${ticker})`, "Transaction"]);
    const rows = rowsOf(page, "Recent transfers");
    await expect(rows).toHaveCount(8);
    for (const [at, transfer] of latest.transfers.entries()) {
      const cells = cellsOf(rows.nth(at));
      await expect(cells.nth(0), transfer.tx_hash).toHaveText(when(transfer.executed_time));
      await expect(cells.nth(1)).toHaveText(KINDS[transfer.kind]!);
      await expect(cells.nth(2).locator("a")).toHaveAttribute("href", `/xrpl/account/${transfer.source}`);
      await expect(cells.nth(3).locator("a")).toHaveAttribute("href", `/xrpl/account/${transfer.destination}`);
      await expect(cells.nth(4)).toHaveText(scaled(transfer.amount, scale));
      await expect(cells.nth(5).locator("a")).toHaveAttribute("href", `/xrpl/tx/${transfer.tx_hash}`);
    }
    // A lock's amount is the balance locked, and is muted (the board's colour; the kind says it in words).
    const lock = latest.transfers.findIndex((transfer) => transfer.kind === "lock");
    expect(lock, "a lock among the eight").toBeGreaterThanOrEqual(0);
    await expect(cellsOf(rows.nth(lock)).nth(4).locator(".muted")).toHaveCount(1);
    await expect(page.getByText(/^Newest first\. A transfer from .+ issues new .+\. A clawback takes .+ back\. A lock stops a balance from moving; its amount is the balance locked\.$/)).toBeVisible();
    const older = page.getByRole("link", { name: "Older →" });
    await expect(older).toHaveAttribute("href", `${HTF_PATH}/transfers?marker=${latest.marker!}`);

    // And it is followed (the whole-branch review's M7): the transfers' page behind the marker of the eight, whose first row is the ninth transfer. D9's marker is a key, so it serves a page of twenty as it
    // served the eight; the fixtures hold that page (rows 9 to 28, scripts/mpt-fixtures.ts).
    const behind = transfersOf(HTF, { limit: 20, marker: latest.marker });
    expect(behind.transfers[0]!.tx_hash, "the ninth transfer").toBe(transfersOf(HTF, { limit: 20 }).transfers[8]!.tx_hash);
    await hydrated(page);
    await older.click();
    await page.waitForURL((url) => url.pathname === `${HTF_PATH}/transfers` && url.searchParams.get("marker") === latest.marker);
    await expect(heading(page)).toHaveText(`Transfers of ${ticker}`);
    const behindRows = rowsOf(page, "Transfers");
    await expect(behindRows).toHaveCount(behind.transfers.length);
    await expect(cellsOf(behindRows.nth(0)).nth(5).locator("a")).toHaveAttribute("href", `/xrpl/tx/${behind.transfers[0]!.tx_hash}`);
    await expect(cellsOf(behindRows.nth(0)).nth(0)).toHaveText(when(behind.transfers[0]!.executed_time));
  });
});

test.describe("the holders' and the transfers' pages", () => {
  test.skip(MPT_OFF, "MPT is off in the Worker under test: its pages are not found (checked above)");

  const issuance = issuanceOf(HTF);
  const ticker = issuance.ticker!;
  const scale = issuance.asset_scale;
  const first = holdersOf(HTF, { limit: 50 });
  const second = holdersOf(HTF, { limit: 50, marker: first.marker });
  const newest = transfersOf(HTF, { limit: 20 });
  const older = transfersOf(HTF, { limit: 20, marker: newest.marker });

  test("'All N holders →' opens all of them, 50 to a page, in one document; Older and Newer page through, a page behind a marker has no rank and is kept from a search engine, and 'Back to' returns", async ({ page, baseURL }) => {
    expect(first.holders, "the fixtures' first page of holders").toHaveLength(50);
    await page.goto(HTF_PATH);
    await hydrated(page);
    await markDocument(page);
    await page.getByRole("link", { name: `All ${issuance.holders} holders →` }).click();
    await page.waitForURL((url) => url.pathname === `${HTF_PATH}/holders` && url.search === "");
    await expect(heading(page)).toHaveText(`Holders of ${ticker}`);
    await expect(page).toHaveTitle(`Holders of ${ticker} · XRPL · explorer`);
    await expect(page.getByText(`${issuance.holders} accounts hold ${scaled(issuance.outstanding_amount, scale)} ${ticker}`)).toBeVisible();
    const origin = new URL(baseURL!).origin;
    expect(await head(page)).toMatchObject({ canonical: `${origin}${HTF_PATH}/holders`, robots: null, ogImage: null });
    // The page's own head is a line that leads back to the issuance's page, and the breadcrumb says where it is.
    await expect(page.locator("a.mpt__headlink")).toHaveAttribute("href", HTF_PATH);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).locator('[aria-current="page"]')).toHaveText("Holders");

    const rows = rowsOf(page, "Holders");
    await expect(rows).toHaveCount(50);
    await expect(tableOf(page, "Holders").locator('[role="columnheader"]')).toHaveText(["#", "Holder", `Balance (${ticker})`, "Share of outstanding", "Balance state"]);
    await expect(cellsOf(rows.nth(0)).nth(0)).toHaveText("1");
    await expect(cellsOf(rows.nth(49)).nth(0)).toHaveText("50");
    await expect(cellsOf(rows.nth(0)).nth(1).locator("a")).toHaveAttribute("href", `/xrpl/account/${first.holders[0]!.holder}`);

    // Newer is disabled on the first page; Older leads to the 13 behind the marker: no rank column there (the API gives none), `noindex, follow`, no canonical URL.
    await expect(pagination(page).locator(".is-disabled")).toHaveText("Newer");
    await pagination(page).getByRole("link", { name: "Older" }).click();
    await page.waitForURL((url) => url.searchParams.get("marker") === first.marker);
    await expect(rows).toHaveCount(second.holders.length);
    await expect(tableOf(page, "Holders").locator('[role="columnheader"]')).toHaveText(["Holder", `Balance (${ticker})`, "Share of outstanding", "Balance state"]);
    await expect(cellsOf(rows.nth(0)).nth(0).locator("a")).toHaveAttribute("href", `/xrpl/account/${second.holders[0]!.holder}`);
    await expect.poll(async () => (await head(page)).robots).toBe("noindex, follow");
    expect((await head(page)).canonical).toBeNull();
    await expect(pagination(page).locator(".is-disabled")).toHaveText("Older");

    await pagination(page).getByRole("link", { name: "Newer" }).click();
    await page.waitForURL((url) => url.pathname === `${HTF_PATH}/holders` && url.search === "");
    await expect(rows).toHaveCount(50);
    await expect.poll(async () => (await head(page)).robots).toBeNull();

    await page.getByRole("link", { name: `Back to ${ticker}` }).click();
    await page.waitForURL(`**${HTF_PATH}`);
    await expect(heading(page)).toHaveText(issuance.metadata!.name!);
    expect(await sameDocument(page)).toBe(true);
  });

  test("its transfers, 20 to a page: Older and Newer page through in one document, and a page behind a marker is kept from a search engine", async ({ page, baseURL }) => {
    expect(newest.transfers, "the fixtures' first page of transfers").toHaveLength(20);
    // The issuance's page leads here with the marker of its own call of eight (a marker is a key, whatever the size of the page); the way in is followed on the issuance's page (above), and the page from its
    // own address here.
    await page.goto(`${HTF_PATH}/transfers`);
    await hydrated(page);
    await markDocument(page);
    await expect(heading(page)).toHaveText(`Transfers of ${ticker}`);
    await expect(page).toHaveTitle(`Transfers of ${ticker} · XRPL · explorer`);
    const origin = new URL(baseURL!).origin;
    expect(await head(page)).toMatchObject({ canonical: `${origin}${HTF_PATH}/transfers`, robots: null, ogImage: null });
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).locator('[aria-current="page"]')).toHaveText("Transfers");
    const rows = rowsOf(page, "Transfers");
    await expect(rows).toHaveCount(20);
    await expect(cellsOf(rows.nth(0)).nth(0)).toHaveText(when(newest.transfers[0]!.executed_time));
    await expect(cellsOf(rows.nth(19)).nth(5).locator("a")).toHaveAttribute("href", `/xrpl/tx/${newest.transfers[19]!.tx_hash}`);
    await expect(pagination(page).locator(".is-disabled")).toHaveText("Newer");

    await pagination(page).getByRole("link", { name: "Older" }).click();
    await page.waitForURL((url) => url.searchParams.get("marker") === newest.marker);
    await expect(rows).toHaveCount(older.transfers.length);
    await expect(cellsOf(rows.nth(0)).nth(5).locator("a")).toHaveAttribute("href", `/xrpl/tx/${older.transfers[0]!.tx_hash}`);
    await expect.poll(async () => (await head(page)).robots).toBe("noindex, follow");
    expect((await head(page)).canonical).toBeNull();
    await pagination(page).getByRole("link", { name: "Newer" }).click();
    await page.waitForURL((url) => url.pathname === `${HTF_PATH}/transfers` && url.search === "");
    await expect(rows).toHaveCount(20);
    await page.getByRole("link", { name: `Back to ${ticker}` }).click();
    await page.waitForURL(`**${HTF_PATH}`);
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe("an issuance in each of its other states", () => {
  test.skip(MPT_OFF, "MPT is off in the Worker under test: its pages are not found (checked above)");

  test("every balance locked says so in a notice above the figures, and its Locked tile says it", async ({ page }) => {
    const issuance = issuanceOf(LOCKED_ALL);
    await page.goto(pathOf(LOCKED_ALL));
    await expect(page.locator(".notice")).toHaveText(`The issuer has locked every ${issuance.ticker} balance.`);
    await expect(tile(page, "Locked").locator(".stat__sub")).toHaveText("Every balance is locked");
    // The lock is a notice, not a row of the Flags card: the six rows are what the issuer allows.
    await expect(card(page, "Flags").locator(".mptflags__row")).toHaveCount(6);
  });

  test("a destroyed issuance says in which ledger, linked, and its holders and transfers say what the index has", async ({ page }) => {
    const issuance = issuanceOf(DESTROYED);
    await page.goto(pathOf(DESTROYED));
    const notice = page.locator(".notice");
    await expect(notice).toContainText(`This issuance was destroyed in ledger #${count(issuance.last_ledger)}.`);
    await expect(notice.getByRole("link")).toHaveAttribute("href", `/xrpl/ledger/${issuance.last_ledger}`);
    await expect(tile(page, "Holders").locator(".stat__value")).toHaveText("0");
    await expect(card(page, "Top holders")).toContainText(`Nobody holds ${issuance.ticker}`);
  });

  test("an issuance with no metadata is headed by its short ID with a '?' coin, says the issuer wrote none, and counts in units", async ({ page }) => {
    await page.goto(pathOf(BARE));
    await expect(heading(page)).toHaveText(`MPT ${BARE.slice(0, 8)}…${BARE.slice(-4)}`);
    await expect(page.locator(".token-page__coin")).toHaveText("?");
    await expect(page).toHaveTitle(`MPT ${BARE.slice(0, 8)}…${BARE.slice(-4)} · XRPL · explorer`);
    await expect(card(page, "Metadata").getByText("The issuer wrote no metadata.")).toBeVisible();
    await expect(page.locator("section.token-page__card .token-page__code")).toHaveCount(0);
    await expect(tile(page, "Outstanding").locator(".stat__sub")).toContainText("units held by holders");
    await expect(page.locator("section.token-page__card").getByText("name and ticker from the issuance's metadata")).toHaveCount(0);
  });

  test("metadata that is not JSON says so, shows its text as text, and the hex it came from", async ({ page }) => {
    await page.goto(pathOf(NOT_JSON));
    const metadata = card(page, "Metadata");
    await expect(metadata.getByText("The metadata isn't JSON.")).toBeVisible();
    await expect(metadata.locator("pre").first()).toHaveAttribute("aria-label", "The metadata as text");
    await expect(metadata.locator("details.mpt__hex summary")).toContainText("Raw metadata, as hex (");
    await expect(metadata.locator("dl")).toHaveCount(0);
  });

  test("an issuance only the network has is shown from the network: its tiles but the holders, its metadata as written, and holders and transfers that say the index lacks them", async ({ page }) => {
    await page.goto(pathOf(NODE_ONLY));
    await expect(page.locator(".notice")).toContainText("Not in the index yet, shown from the network");
    await expect(heading(page)).toHaveText(`MPT ${NODE_ONLY.slice(0, 8)}…${NODE_ONLY.slice(-4)}`);
    // The issuer of this one is the active account, which the names fixtures give a verified name.
    await expect(page.locator("p.token-page__issuer a")).toHaveAttribute("href", `/xrpl/account/${XRPL_ACCOUNT}`);
    await expect(page.getByRole("region", { name: "Figures", exact: true }).locator(".stat__label")).toHaveText(["Outstanding", "Max amount", "Locked", "Holders", "Transfer fee", "Asset scale"]);
    await expect(tile(page, "Holders").locator(".stat__value")).toHaveText("—");
    await expect(tile(page, "Holders").locator(".stat__sub")).toHaveText("not in the index yet");
    await expect(tile(page, "Locked").locator(".stat__value")).toHaveText("—");
    await expect(tile(page, "Outstanding").locator(".stat__sub")).toContainText("units held by holders");
    const metadata = card(page, "Metadata");
    await expect(metadata.getByText("Read from the network as written; the index decodes it once it holds this issuance.")).toBeVisible();
    await expect(metadata.locator("pre").first()).toHaveAttribute("aria-label", "The metadata as text");
    await expect(metadata.locator("details.mpt__hex summary")).toContainText("Raw metadata, as hex (");
    await expect(card(page, "Top holders").getByText("Not in the index yet.")).toBeVisible();
    await expect(card(page, "Recent transfers").getByText("Not in the index yet.")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("an issuance nobody has is a 404 that says so, with the search box", async ({ page }) => {
    const response = await page.goto(pathOf(NOWHERE));
    expect(response?.status()).toBe(404);
    await expect(heading(page)).toHaveText("Not found");
    await expect(page.getByText("We couldn’t find this MPT on XRPL.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" })).toBeVisible();
  });

  test("text that is not an issuance ID is a 404, and an ID in lower case is one redirect to the upper-case URL", async ({ page, request }) => {
    const bad = await page.goto("/xrpl/mpt/not-an-id");
    expect(bad?.status()).toBe(404);
    await expect(page.getByText('We couldn’t find MPT "not-an-id" on XRPL.')).toBeVisible();
    const redirect = await request.get(HTF_PATH.toLowerCase(), { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers().location).toBe(HTF_PATH);
    await page.goto(`/xrpl/mpt/${HTF.toLowerCase()}`);
    await expect(page).toHaveURL(new RegExp(`${HTF_PATH}$`));
  });
});

test.describe("the issuer's text", () => {
  test.skip(MPT_OFF, "MPT is off in the Worker under test: its pages are not found (checked above)");

  // An issuer writes the name, the ticker, the description and the titles of its links as it likes (the fixtures' `nonConforming` issuance: a name of 128 letters with no space, a description of 200, a title of 100, a
  // link that is not one). Plan ruling C17: at 375 and at 1280 px, in the light theme, the page does not scroll sideways and no text of a card is painted past it.
  for (const viewport of [
    { name: "1280 px", size: { width: 1280, height: 800 } },
    { name: "375 px", size: { width: 375, height: 812 } },
  ]) {
    test.describe(viewport.name, () => {
      test.use({ viewport: viewport.size, colorScheme: "light" });

      test("on the issuance's page is wrapped at the edge of its cell, and what is not a safe link is text", async ({ page }) => {
        const issuance = issuanceOf(HOSTILE);
        await page.goto(pathOf(HOSTILE));
        await hydrated(page);
        await expect(heading(page)).toHaveText(issuance.name!);
        expect(issuance.name!.length, "the longest name an issuer can write").toBe(128);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        expect(await pastTheEdge(page)).toEqual([]);
        const title = heading(page);
        expect(await title.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);

        // A link whose scheme is not https, and one with credentials or no host, is text: only the two https ones are links, and the picture the icon names is not loaded.
        const metadata = card(page, "Metadata");
        await expect(metadata.getByText("This metadata doesn't follow XLS-89, so some of it may be missing here.")).toBeVisible();
        await expect(metadata.locator("dd a")).toHaveCount(2);
        await expect(metadata.getByText("javascript:alert(1)")).toBeVisible();
        await expect(metadata.locator('a[href^="javascript"]')).toHaveCount(0);
        await expect(metadata.locator("dd", { hasText: "ipfs://" }).locator("a")).toHaveCount(0);
        await expect(page.locator("main img")).toHaveCount(0);
      });

      test("in a row of the MPT tab is wrapped in its Token cell, and the table stays in its card", async ({ page }) => {
        const listed = mptListOf().tokens.find((row) => row.mpt_issuance_id === HOSTILE);
        expect(listed, "the longest row on the first page of the tab").toBeDefined();
        await page.goto("/xrpl/tokens?kind=mpt");
        await hydrated(page);
        const row = rowsOf(page, "MPTs").filter({ has: page.locator(`a[href="${pathOf(HOSTILE)}"]`) });
        await expect(row).toHaveCount(1);
        await expect(row.locator(".mpttab__name")).toHaveText(listed!.name!);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        // The cell is as wide as its track and no wider: the name wrapped rather than painting over the next column.
        const cell = cellsOf(row).nth(1);
        expect(await cell.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
        expect(await row.locator(".mpttab__name").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
        expect(await pastTheEdge(page)).toEqual([]);
      });
    });
  }
});

test.describe("the MPT tab's rows", () => {
  test.skip(MPT_OFF, "MPT is off in the Worker under test: the tab is the 'soon' control (tokens.spec.ts checks that)");

  test("show the abilities as pills in the board's order, each with its title (Trade's says MPT trading is not enabled yet), 'none' when there are none, and 'No metadata' with the short ID when there is no ticker", async ({ page }) => {
    const rows = mptListOf().tokens;
    const all = rows.find((row) => row.mpt_issuance_id === HTF)!;
    const none = rows.find((row) => !Object.values(row.flags).includes(true))!;
    expect(none, "an issuance on the first page that allows nothing").toBeDefined();
    const bare = rows.find((row) => row.ticker === undefined)!;
    await page.goto("/xrpl/tokens?kind=mpt");
    await hydrated(page);
    const rowOf = (id: string) => rowsOf(page, "MPTs").filter({ has: page.locator(`a[href="${pathOf(id)}"]`) });

    // Every ability the issuance has, in the board's order, each in a span with its title (the kit's pill has none).
    const flags = rowOf(all.mpt_issuance_id).locator(".mpttab__flags > span");
    await expect(flags).toHaveText(["Transfer", "Trade", "Lock", "Clawback", "Escrow", "Auth"]);
    await expect(flags.nth(0)).toHaveAttribute("title", "Holders can send it to each other");
    await expect(flags.nth(1)).toHaveAttribute("title", "The issuer allows it on the DEX. MPT trading isn't enabled on XRPL yet.");
    await expect(flags.nth(2)).toHaveAttribute("title", "The issuer can lock balances");
    await expect(flags.nth(3)).toHaveAttribute("title", "The issuer can take it back");
    await expect(flags.nth(4)).toHaveAttribute("title", "It can be held in escrows");
    await expect(flags.nth(5)).toHaveAttribute("title", "Holders need the issuer's approval");
    // An issuance that has none says "none"; the footnote under the table says what each pill means.
    await expect(rowOf(none.mpt_issuance_id).locator(".mpttab__flags")).toHaveCount(0);
    await expect(rowOf(none.mpt_issuance_id)).toContainText("none");
    await expect(page.getByText(/^Flags: Transfer, holders can send it to each other · Trade, the issuer allows it on the DEX \(MPT trading isn't enabled on XRPL yet\)/)).toBeVisible();

    // No ticker: "No metadata" and the start and end of the ID, with the whole ID as the title.
    const unnamed = rowOf(bare.mpt_issuance_id);
    await expect(unnamed.locator(".mpttab__code")).toHaveText("No metadata");
    await expect(unnamed.locator(".mpttab__id")).toHaveText(`${bare.mpt_issuance_id.slice(0, 8)}…${bare.mpt_issuance_id.slice(-4)}`);
    await expect(unnamed.locator(".mpttab__id")).toHaveAttribute("title", `Issuance ID ${bare.mpt_issuance_id}`);
  });
});

test.describe("an MPT payment's transaction page", () => {
  test.skip(MPT_OFF, "MPT is off in the Worker under test: the amounts read in units with no link (checked above)");

  /** The value of a row of the details list. */
  const detail = (page: Page, label: string) => page.locator(".kv").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");

  test("shows an amount scaled and in its ticker, a link to the issuance's page, in the sentence, the flow and the details", async ({ page }) => {
    const issuance = MPT_MINT_ISSUANCE;
    await page.goto(`/xrpl/tx/${MPT_RECORDED.payment_mint.hash}`);
    await hydrated(page);
    // The issuer sends, so the sentence says "issued"; the issuance has a ticker (USDPEND) and a scale of 0, so the amount is 1 USDPEND.
    const sentence = page.locator("p.summary__sentence");
    await expect(sentence).toContainText(/ issued 1\s+USDPEND to /);
    // The sentence, the sender's side and the destination's of the flow, and the Amount of the details.
    await expect(sentence.locator(".mptamount a")).toHaveAttribute("href", pathOf(issuance));
    await expect(page.locator(".flow__amount .mptamount")).toHaveText([/^1\s+USDPEND$/, /^1\s+USDPEND$/]);
    await expect(detail(page, "Amount").locator(".mptamount")).toHaveText(/^1\s+USDPEND$/);
    // Whole on hover: which issuance it is and who issued it. Every link of an amount leads to this issuance, and to nothing else (the fixtures hold no page for it: the lookup of the page knows it, the index does not).
    for (const amount of await sentence.locator(".mptamount").all()) await expect(amount).toHaveAttribute("title", `MPT ${issuance} issued by rwA8orrVtNPuBykRvQdDJzRDQbe7CuxCiR`);
    for (const amount of await page.locator(".flow__amount .mptamount").all()) await expect(amount).toHaveAttribute("title", `MPT ${issuance} issued by rwA8orrVtNPuBykRvQdDJzRDQbe7CuxCiR`);
    await expect(page.locator('main a[href*="/mpt/"]:not([href$="' + issuance + '"])')).toHaveCount(0);
  });

  test("shows an amount of an issuance without a ticker as units, scaled, with the same link, and the issuer's row of the balance changes", async ({ page }) => {
    await page.goto(`/xrpl/tx/${MPT_RECORDED.payment_transfer_fee.hash}`);
    await hydrated(page);
    // The issuance (a transfer fee of 0.589%) has no ticker: 1.000000 units at its scale of 6.
    const sentence = page.locator("p.summary__sentence");
    await expect(sentence).toContainText(/ sent 1\.000000\s+units to /);
    await expect(sentence.locator(".mptamount a")).toHaveAttribute("href", pathOf(MPT_FEE_PAYMENT_ISSUANCE));
    await expect(sentence.locator(".mptamount a")).toHaveText("units");
    await expect(detail(page, "Send max").locator(".mptamount")).toHaveText(/^1\.062500\s+units$/);
    // The balance changes: the sender pays the amount and the transfer fee (1.005890), the destination gets the amount, and the issuer's row, tagged "Issuer", is what the fee leaves outstanding (0.005890). The
    // issuance is a link in the Currency column, with the issuer named under it, and the change is in the same units, scaled.
    const rows = rowsOf(page, "Balance changes");
    await expect(rows).toHaveCount(4);
    const mpt = [rows.nth(1), rows.nth(2), rows.nth(3)];
    await expect(cellsOf(mpt[0]!).nth(0).locator(".type")).toHaveText("sender");
    await expect(cellsOf(mpt[1]!).nth(0).locator(".type")).toHaveText("Issuer");
    await expect(cellsOf(mpt[2]!).nth(0).locator(".type")).toHaveText("destination");
    for (const row of mpt) await expect(cellsOf(row).nth(1).locator("a.mptlink")).toHaveAttribute("href", pathOf(MPT_FEE_PAYMENT_ISSUANCE));
    await expect(cellsOf(mpt[0]!).nth(2)).toHaveText("−1.005890 units");
    await expect(cellsOf(mpt[1]!).nth(2)).toHaveText("+0.005890 units");
    await expect(cellsOf(mpt[2]!).nth(2)).toHaveText("+1.000000 units");
  });

  test("shows a reference to an issuance as a link too: the lock of one holder's balance names the issuance", async ({ page }) => {
    await page.goto(`/xrpl/tx/${MPT_RECORDED.issuance_set_lock_holder.hash}`);
    const sentence = page.locator("p.summary__sentence");
    await expect(sentence).toContainText(/ locked .+'s balance of MPT 0663EACA…/);
    await expect(sentence.locator(`a[href="${pathOf(MPT_LOCKED_HOLDING)}"]`)).toHaveText(/^MPT 0663EACA…$/);
  });
});

test.describe("the account's Tokens card", () => {
  test.skip(MPT_OFF, "MPT is off in the Worker under test: the rows read in units with no link (checked above)");

  test("lists what the account holds of MPTs after its trust lines: the ticker is a link, the issuer and the amount are scaled, a locked holding says so, and the owned counts say MPT holdings and issuances", async ({ page }) => {
    const issuance = issuanceOf(HTF);
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
    await hydrated(page);
    await markDocument(page);
    const tokens = card(page, "Tokens");
    // The two `MPToken` entries of the account's objects, after its one trust line: the holding of the issuance the index knows (300.0000 at a scale of 4), and the locked holding of one it lists with no ticker.
    const rows = tokens.locator(".token");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator(".token__name a").first()).toHaveAttribute("href", /\/xrpl\/token\//);
    const known = rows.nth(1);
    await expect(known.locator(".token__name a").first()).toHaveAttribute("href", HTF_PATH);
    await expect(known.locator(".token__name a").first()).toHaveText(issuance.ticker!);
    await expect(known.locator(".token__name a").first()).toHaveAttribute("title", `MPT ${HTF}`);
    await expect(known.locator(".token__issuer a")).toHaveAttribute("href", `/xrpl/account/${issuance.issuer}`);
    await expect(known.locator(".amt")).toHaveText("300.0000");
    await expect(known.locator(".token__badge")).toHaveText(issuance.ticker!);
    const locked = rows.nth(2);
    await expect(locked.locator(".token__name a").first()).toHaveAttribute("href", pathOf(MPT_LOCKED_HOLDING));
    await expect(locked.locator(".token__name a").first()).toHaveText(`MPT ${MPT_LOCKED_HOLDING.slice(0, 8)}…`);
    await expect(locked).toContainText("Locked");
    await expect(locked.locator(".amt")).toHaveText("45,000,000");
    // The Owned objects card counts the holdings and the issuance the account owns, in words.
    await expect(card(page, "Owned objects")).toContainText(/2\s*MPT holdings/);
    await expect(card(page, "Owned objects")).toContainText(/1\s*MPT issuance/);

    await known.locator(".token__name a").first().click();
    await page.waitForURL(`**${HTF_PATH}`);
    await expect(heading(page)).toHaveText(issuance.metadata!.name!);
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe("the Xahau page", () => {
  test("says MPT isn't enabled there, as a 404 that is kept from a search engine, with the ID, the way back and 'Open it on XRPL'", async ({ page }) => {
    test.skip(MPT_OFF, "MPT is off in the Worker under test: the page is the not-found page of the MPT pages (checked above)");
    const response = await page.goto(`/xahau/mpt/${HTF}`);
    expect(response?.status()).toBe(404);
    await expect(heading(page)).toHaveText("MPT isn't enabled on Xahau");
    await expect(page.getByText("MPTs exist only on XRPL, so there is nothing at this issuance ID on Xahau.")).toBeVisible();
    await expect(page.locator(".mpt__idtext")).toHaveText(HTF);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).locator('[aria-current="page"]')).toHaveText("MPT");
    await expect(page.getByRole("link", { name: "← Back to tokens" })).toHaveAttribute("href", "/xahau/tokens");
    await page.getByRole("link", { name: "Open it on XRPL" }).click();
    await page.waitForURL(`**${HTF_PATH}`);
    await expect(heading(page)).toHaveText(issuanceOf(HTF).metadata!.name!);
  });

  test("answers an ID in lower case with the same page and the ID in capitals, and the other pages of the issuance the same way", async ({ page }) => {
    test.skip(MPT_OFF, "MPT is off in the Worker under test: the page is the not-found page of the MPT pages (checked above)");
    for (const suffix of ["", "/holders", "/transfers"]) {
      const response = await page.goto(`/xahau/mpt/${HTF.toLowerCase()}${suffix}`);
      expect(response?.status(), suffix).toBe(404);
      await expect(page.locator(".mpt__idtext")).toHaveText(HTF);
    }
  });
});

test.describe("search by an issuance ID", () => {
  test.skip(MPT_OFF, "MPT is off in the Worker under test: 48 hex digits are searched as any text is (checked above)");

  test("a lower-case ID in the header's box is hinted as an MPT issuance ID and leads to the issuance's page in capitals", async ({ page }) => {
    await page.goto("/xrpl/tokens");
    await hydrated(page);
    await markDocument(page);
    const box = page.getByRole("banner").getByRole("searchbox", { name: "Search XRPL" });
    await box.fill(HTF.toLowerCase());
    const hints = page.getByRole("list", { name: "Matches" });
    await expect(hints).toContainText("MPT issuance ID");
    await expect(hints.getByRole("link", { name: /MPT issuance ID/ })).toHaveAttribute("href", HTF_PATH);
    await box.press("Enter");
    await page.waitForURL(`**${HTF_PATH}`);
    await expect(heading(page)).toHaveText(issuanceOf(HTF).metadata!.name!);
    expect(await sameDocument(page)).toBe(true);
  });

  test("the same on Xahau leads to the page that says MPT is not there, and its help lists the ID among what can be searched", async ({ page }) => {
    await page.goto("/xahau");
    await hydrated(page);
    await page.getByRole("main").getByRole("searchbox", { name: "Search Xahau" }).fill(HTF);
    await page.getByRole("main").getByRole("button", { name: "Search" }).click();
    await page.waitForURL(`**/xahau/mpt/${HTF}`);
    await expect(heading(page)).toHaveText("MPT isn't enabled on Xahau");

    await page.goto("/xrpl/search?q=not+anything");
    await expect(page.getByText("An MPT issuance ID (48 hex digits)")).toBeVisible();
  });
});

test.describe("without JavaScript", () => {
  test.skip(MPT_OFF, "MPT is off in the Worker under test: its pages are not found (checked above)");

  test("the pages are the server's: the links of the holders and the transfers, their pagers, the raw hex and the box all work", async ({ contextFor }) => {
    const issuance = issuanceOf(HTF);
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(HTF_PATH);
    // Everything is the server's: both tables, the metadata and the flags are drawn.
    await expect(rowsOf(page, "Top holders")).toHaveCount(10);
    await expect(rowsOf(page, "Recent transfers")).toHaveCount(8);
    await expect(card(page, "Flags").locator(".mptflags__row")).toHaveCount(6);
    // The raw metadata opens without a script: a disclosure is the browser's own.
    const raw = page.locator("details.mpt__hex");
    await raw.locator("summary").click();
    await expect(raw.locator("pre")).toHaveText(issuance.metadata_hex!);

    await page.getByRole("link", { name: `All ${issuance.holders} holders →` }).click();
    await page.waitForURL(`**${HTF_PATH}/holders`);
    await expect(rowsOf(page, "Holders")).toHaveCount(50);
    await pagination(page).getByRole("link", { name: "Older" }).click();
    await page.waitForURL((url) => url.searchParams.has("marker"));
    await expect(rowsOf(page, "Holders")).toHaveCount(holdersOf(HTF, { limit: 50, marker: holdersOf(HTF, { limit: 50 }).marker }).holders.length);
    await pagination(page).getByRole("link", { name: "Newer" }).click();
    await page.waitForURL((url) => url.pathname === `${HTF_PATH}/holders` && url.search === "");
    await page.getByRole("link", { name: `Back to ${issuance.ticker}` }).click();
    await page.waitForURL(`**${HTF_PATH}`);

    // "Older →" is a link to the transfers' page behind the marker of the eight (the fixtures hold no page of twenty behind it: see the transfers' pages above), whose own pager is links too.
    await expect(page.getByRole("link", { name: "Older →" })).toHaveAttribute("href", /^\/xrpl\/mpt\/[0-9A-F]{48}\/transfers\?marker=/);
    await page.goto(`${HTF_PATH}/transfers`);
    await expect(rowsOf(page, "Transfers")).toHaveCount(20);
    await pagination(page).getByRole("link", { name: "Older" }).click();
    await page.waitForURL((url) => url.pathname === `${HTF_PATH}/transfers` && url.searchParams.has("marker"));
    await expect(rowsOf(page, "Transfers")).toHaveCount(transfersOf(HTF, { limit: 20, marker: transfersOf(HTF, { limit: 20 }).marker }).transfers.length);
    await pagination(page).getByRole("link", { name: "Newer" }).click();
    await page.waitForURL((url) => url.pathname === `${HTF_PATH}/transfers` && url.search === "");
    await expect(rowsOf(page, "Transfers")).toHaveCount(20);
  });

  test("a search of the header's box for an issuance ID in lower case is a form that sends it to the issuance's page", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/xrpl");
    await page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" }).fill(HTF.toLowerCase());
    await page.getByRole("main").getByRole("button", { name: "Search" }).click();
    await page.waitForURL(`**${HTF_PATH}`);
    await expect(heading(page)).toHaveText(issuanceOf(HTF).metadata!.name!);
  });
});
