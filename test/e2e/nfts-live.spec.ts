import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { decodeLoaderData } from "../support/loader-data";
import { XRPL_NFT } from "../support/nft-names";
import { fixtures, unavailable } from "./fixture-control";
import { LIVE, NEVER_FUNDED } from "./fixtures";
import { expect, freshHtml, hydrated, seriousViolations, test } from "./support";

// What of the NFT pages needs the fixture server to change an answer (README "NFTs", "End-to-end tests"): the list with cards that failed, the choice page of a hash that is both a
// transaction and an NFT, and the Objects tab's link to the account's NFTs (no recorded account owns an NFT page). These tests change what the fixture server answers, and every page
// the Worker renders meanwhile would show it: they are in the `live` project (playwright.config.ts, `*-live.spec.ts`), which runs alone after the others, one test at a time. Each
// asks for something no other spec asks for (an issuer, a hash and an address of its own), so what the Worker kept from an earlier test cannot hide the override.

test.skip(LIVE, "changes what the fixture server answers: it needs the fixture server of the stack, not a real stack or a deployed Worker");
test.skip(featuresOff(process.env).has("NFTS"), "NFTS is off in the Worker under test: the NFT pages are not found");

test.afterEach(async () => {
  await fixtures.reset();
});

const VIEWPORTS = [
  { name: "desktop", size: { width: 1280, height: 800 } },
  { name: "375 px", size: { width: 375, height: 812 } },
] as const;

/** How far the page scrolls sideways: none, at any width (the tables and the 30-day charts scroll inside their cards). */
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const recorded = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../fixtures/http/xrpl/data-api/${path}.json`, import.meta.url), "utf8")) as T;

// ---- The list with cards that failed ----------------------------------------------------------------------------------------------------------

// The newest validated ledger (which the chart's window is worked out from), the newest sales and the collections of one issuer: three cards, each failing on its own. The totals and the
// top collections are the live volume's, which the rest of the page stands on. The issuer is one no other spec asks for (so its collections call, which the Worker keeps for a minute,
// is new); the other two calls are kept 2 s and 5 s only.
const ISSUER = NEVER_FUNDED;
const LIST = `/xrpl/nfts?issuer=${ISSUER}`;
const FAILING = {
  "GET /v2/last_validated": unavailable(),
  "GET /v2/nft_sales?descending=true&limit=10": unavailable(),
  [`GET /v2/nft_collections?issuer=${ISSUER}&limit=20&sort=volume`]: unavailable(),
};

/** What each of the three cards says when it failed. */
const FAILED = ["Couldn’t load the sales volume.", "Couldn’t load the recent sales.", "Couldn’t load the collections."];

/** The list with its three cards failed: each says so in its place with a Retry, and the totals, the top collections and the issuer form stand. */
async function openFailing(page: Page): Promise<void> {
  await fixtures.override(FAILING);
  // Until the Worker's kept calls (the newest ledger 2 s, the sales 5 s) have run out, the page shows what it kept of the call that worked: it is asked for until every card says so.
  await expect
    .poll(
      async () => {
        const html = (await (await page.request.get(LIST)).text()).replaceAll("<!-- -->", "");
        return FAILED.every((words) => html.includes(words));
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.goto(LIST);
  await hydrated(page);
  await expect(page.getByRole("alert")).toHaveCount(3);
}

for (const viewport of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`when the list's chart, recent sales and collections cannot be loaded, at ${viewport.name}, in ${scheme}`, () => {
      test.use({ viewport: viewport.size, colorScheme: scheme });

      test("each card says so in its place with a Retry, the rest of the page stands, and it has no serious or critical violation and no sideways scroll", async ({ page }) => {
        await openFailing(page);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("NFTs");
        await expect(page.getByText("Couldn’t load the recent sales.")).toBeVisible();
        await expect(page.getByText("Couldn’t load the collections.")).toBeVisible();
        await expect(page.getByText("Couldn’t load the sales volume.")).toBeVisible();
        for (const alert of await page.getByRole("alert").all()) await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
        // The totals and the issuer form are not the failed cards'.
        await expect(page.getByText("Sales volume, 24 h", { exact: true })).toBeVisible();
        await expect(page.getByRole("searchbox", { name: "Collections of an issuer" })).toHaveValue(ISSUER);
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).colorScheme)).toBe(scheme);
        expect(await seriousViolations(page)).toEqual([]);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });
    });
  }
}

test.describe("when the calls answer again", () => {
  // The chart card is the one card of two calls in a chain (the newest ledger, then its 30 days), raced against the loader's deadline; in a live run the 30 days are never kept
  // yet, so under load the chain alone could be late and the card fail again on Retry. So the list is asked for, fresh, until no card says it failed (which also keeps the
  // answers the Retry reads), and only then is Retry pressed. If the cards do not come back, the test says why: what the Retry's answer said of the chart, and the line the
  // stack's Worker wrote for that request (find it by its id in the stack's output, with E2E_VERBOSE=1).
  test("Retry brings the cards back, in the same document", async ({ page }, testInfo) => {
    await openFailing(page);
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));
    const asked: string[] = [];
    page.on("request", (request) => asked.push(request.url()));

    await fixtures.reset();
    await expect
      .poll(
        async () => {
          const html = (await freshHtml(page, LIST))?.replaceAll("<!-- -->", "");
          return html !== undefined && FAILED.every((words) => !html.includes(words));
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const [answer] = await Promise.all([
      page.waitForResponse(/nfts\.data/),
      page.getByRole("alert").filter({ hasText: "the recent sales" }).getByRole("button", { name: "Retry" }).click(),
    ]);

    try {
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("table", { name: "Recent sales", exact: true })).toBeVisible();
    } catch (error) {
      const body = await answer.text().catch(() => "");
      let chart: unknown = "(the answer could not be decoded)";
      try {
        const routes = decodeLoaderData(body) as Record<string, { data?: { failures?: { chart?: string } } }>;
        chart = routes["routes/net.nfts._index"]?.data?.failures?.chart ?? null;
      } catch {
        // An answer that is not route data: the body is attached as it is.
      }
      const headers = answer.headers();
      const line = { id: headers["x-request-id"], method: answer.request().method(), path: new URL(answer.url()).pathname, status: answer.status(), cache: headers["x-cache"] ?? "NONE" };
      await testInfo.attach("failures.chart of the Retry's answer", { body: JSON.stringify(chart), contentType: "application/json" });
      await testInfo.attach("the stack's log line of the Retry's request", { body: JSON.stringify(line), contentType: "application/json" });
      if (chart === "(the answer could not be decoded)") await testInfo.attach("the Retry's answer", { body, contentType: "text/plain" });
      throw error;
    }
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
    // Retry asked the explorer's own Worker for the route's data, and nobody else.
    const origin = new URL(page.url()).origin;
    expect(asked.filter((url) => !url.startsWith(origin))).toEqual([]);
    expect(asked.filter((url) => url.includes(".data")).length).toBeGreaterThan(0);
  });
});

// ---- A hash that is a transaction and an NFT -------------------------------------------------------------------------------------------------

// A hash of its own, which the data API answers as a transaction and as the featured NFT (the recorded answer, with this id): the search page offers the choice, both in a row of its own.
const BOTH = "5C".repeat(32);
const asBoth = (): Record<string, unknown> => {
  const answer = recorded<{ coverage: unknown; nft: Record<string, unknown> }>(`nfts/${XRPL_NFT.featured}`);
  return {
    [`GET /v2/transactions/${BOTH}`]: {
      result: "success",
      transaction: {
        hash: BOTH,
        ledger_index: 107600150,
        date: "2026-10-17T16:11:02+00:00",
        tx: { TransactionType: "OfferCreate", Account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh" },
        meta: { TransactionIndex: 3, TransactionResult: "tesSUCCESS", AffectedNodes: [] },
      },
    },
    [`GET /v2/nfts/${BOTH}`]: { ...answer, nft: { ...answer.nft, nft_id: BOTH } },
  };
};

for (const viewport of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`a hash that is a transaction and an NFT, at ${viewport.name}, in ${scheme}`, () => {
      test.use({ viewport: viewport.size, colorScheme: scheme });

      test("is the choice page, a row for each, with no serious or critical violation and no sideways scroll", async ({ page }) => {
        await fixtures.override(asBoth());
        await page.goto(`/xrpl/search?q=${BOTH}`);
        await hydrated(page);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Transaction or NFT?");
        const rows = page.getByRole("list", { name: "Matches" }).getByRole("link");
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0)).toHaveAttribute("href", `/xrpl/tx/${BOTH}`);
        await expect(rows.nth(1)).toHaveAttribute("href", `/xrpl/nft/${BOTH}`);
        await expect(rows.nth(1)).toContainText("NFT");
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).colorScheme)).toBe(scheme);
        expect(await seriousViolations(page)).toEqual([]);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });
    });
  }
}

test.describe("a hash that is a transaction and an NFT", () => {
  test("is the choice page with and without JavaScript, and the box of the header says what it can be", async ({ page, contextFor }) => {
    await fixtures.override(asBoth());
    await page.goto("/xrpl");
    await hydrated(page);
    await page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" }).fill(BOTH);
    await page.getByRole("main").getByRole("button", { name: "Search" }).click();
    await page.waitForURL(`**/xrpl/search?q=${BOTH}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Transaction or NFT?");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");

    const context = await contextFor({ javaScriptEnabled: false });
    const plain = await context.newPage();
    await plain.goto(`/xrpl/search?q=${BOTH}`);
    await expect(plain.getByRole("heading", { level: 1 })).toHaveText("Transaction or NFT?");
    await plain.getByRole("list", { name: "Matches" }).getByRole("link").nth(1).click();
    await plain.waitForURL(`**/xrpl/nft/${BOTH}`);
  });
});

// ---- The Objects tab's link to the NFTs ------------------------------------------------------------------------------------------------------

// An account of its own that owns an NFT page (32 NFTs) and an NFT offer: its Objects tab says "See the account’s NFTs" on the page's row, and the offer's NFT is a link.
// (the address of twenty bytes of 91, which the worker specs make with `encodeAccountID`: the address codec does not load in Playwright's runtime)
const OWNER = "r9LsAs7YtmgwGLSBDfBXAwRHWdbgseJBNa";
const LEDGER = 107721455;
const owning = (): Record<string, unknown> => ({
  [`GET /v2/accounts/${OWNER}`]: {
    result: "success",
    account_data: { account: OWNER, parent: "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ", initial_balance: "25", inception: "2025-07-15T18:30:43Z", ledger_index: 97500000, tx_hash: "9B".repeat(32) },
  },
  [`GET /v2/accounts/${OWNER}/balances`]: { result: "success", ledger_index: LEDGER, limit: 200, balances: [{ currency: "XRP", value: "25" }] },
  [`node account_info ${OWNER}`]: {
    account_data: { Account: OWNER, Balance: "25000000", Flags: 0, LedgerEntryType: "AccountRoot", OwnerCount: 2, Sequence: 12 },
    ledger_index: LEDGER,
    validated: true,
  },
  [`node account_objects ${OWNER}`]: {
    account: OWNER,
    account_objects: [
      { LedgerEntryType: "NFTokenPage", index: "A".repeat(64), NFTokens: Array.from({ length: 32 }, () => ({})), PreviousTxnID: "AB".repeat(32) },
      { LedgerEntryType: "NFTokenOffer", index: "F".repeat(64), NFTokenID: XRPL_NFT.featured, Flags: 1, Amount: "25000000", PreviousTxnID: "CD".repeat(32) },
    ],
    ledger_index: LEDGER,
    validated: true,
  },
});

for (const viewport of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`the Objects tab of an account that owns NFTs, at ${viewport.name}, in ${scheme}`, () => {
      test.use({ viewport: viewport.size, colorScheme: scheme });

      test("links the NFT page's row to the account's NFTs and the offer's NFT to its page, with no serious or critical violation and no sideways scroll", async ({ page }) => {
        await fixtures.override(owning());
        await page.goto(`/xrpl/account/${OWNER}?tab=objects`);
        await hydrated(page);
        const link = page.getByRole("link", { name: "See the account’s NFTs" });
        await expect(link).toHaveAttribute("href", `/xrpl/account/${OWNER}?tab=nfts`);
        await expect(page.locator(`a[href="/xrpl/nft/${XRPL_NFT.featured}"]`).first()).toBeVisible();
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).colorScheme)).toBe(scheme);
        expect(await seriousViolations(page)).toEqual([]);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });
    });
  }
}

test.describe("the Objects tab of an account that owns NFTs", () => {
  test("'See the account’s NFTs' opens the NFTs tab in the same document", async ({ page }) => {
    await fixtures.override(owning());
    await page.goto(`/xrpl/account/${OWNER}?tab=objects`);
    await hydrated(page);
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));
    await page.getByRole("link", { name: "See the account’s NFTs" }).click();
    await page.waitForURL(`**/xrpl/account/${OWNER}?tab=nfts`);
    await expect(page.getByRole("navigation", { name: "Account activity" }).getByRole("link", { name: "NFTs" })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
  });
});
