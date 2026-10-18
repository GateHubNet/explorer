import type { Page } from "@playwright/test";

import { count, XAHAU_LEDGER, XAHAU_LEDGER_NEXT, XRPL_ACCOUNT } from "./fixtures";
import { expect, hydrated, test } from "./support";

// The tags of a page are made by its `meta` export, which the browser runs too when a visitor follows a link inside the page: no new
// document, so nothing the server renders for it. The Worker's own tests (test/worker/meta.spec.ts) see only the server-rendered tags.

interface Head {
  title: string;
  canonical: string | null;
  robots: string | null;
  ogTitle: string | null;
  ogUrl: string | null;
  ogImage: string | null;
  twitterCard: string | null;
}

const head = (page: Page): Promise<Head> =>
  page.evaluate(() => {
    const content = (selector: string) => document.querySelector(selector)?.getAttribute("content") ?? null;
    return {
      title: document.title,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
      robots: content('meta[name="robots"]'),
      ogTitle: content('meta[property="og:title"]'),
      ogUrl: content('meta[property="og:url"]'),
      ogImage: content('meta[property="og:image"]'),
      twitterCard: content('meta[name="twitter:card"]'),
    };
  });

const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);

test.describe("the tags of a page reached by a link in the page", () => {
  test("follow the ledger, the transaction and the way back", async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await page.goto(`/xahau/ledger/${XAHAU_LEDGER}`);
    await hydrated(page);
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));

    // As the server rendered it.
    const first = await head(page);
    expect(first.title).toBe(`Ledger #${count(XAHAU_LEDGER)} · Xahau · explorer`);
    expect(first.canonical).toBe(`${origin}/xahau/ledger/${XAHAU_LEDGER}`);
    expect(first.ogUrl).toBe(first.canonical);
    expect(first.ogImage).toBe(`${origin}/og/xahau/ledger/${XAHAU_LEDGER}.png`);
    expect(first.twitterCard).toBe("summary_large_image");

    // The next ledger: a link in the page.
    await page.getByRole("link", { name: /next ledger/ }).click();
    await page.waitForURL(`**/xahau/ledger/${XAHAU_LEDGER_NEXT}`);
    await expect(page).toHaveTitle(`Ledger #${count(XAHAU_LEDGER_NEXT)} · Xahau · explorer`);
    const next = await head(page);
    expect(next.canonical).toBe(`${origin}/xahau/ledger/${XAHAU_LEDGER_NEXT}`);
    expect(next.ogUrl).toBe(next.canonical);
    expect(next.ogTitle).toBe(next.title);
    expect(next.ogImage).toBe(`${origin}/og/xahau/ledger/${XAHAU_LEDGER_NEXT}.png`);

    // A transaction of that ledger.
    const link = page.locator('a[href^="/xahau/tx/"]').first();
    const hash = (await link.getAttribute("href"))!.split("/").pop()!;
    await link.click();
    await page.waitForURL(`**/xahau/tx/${hash}`);
    const type = await page.getByRole("heading", { level: 1 }).innerText();
    await expect(page).toHaveTitle(`${type} ${hash.slice(0, 6)}…${hash.slice(-4)} · Xahau · explorer`);
    const tx = await head(page);
    expect(tx.canonical).toBe(`${origin}/xahau/tx/${hash}`);
    expect(tx.ogUrl).toBe(tx.canonical);
    expect(tx.ogImage).toBe(`${origin}/og/xahau/tx/${hash}.png`);

    // Back with the browser's button: the ledger's tags again, and still the same document.
    await page.goBack();
    await page.waitForURL(`**/xahau/ledger/${XAHAU_LEDGER_NEXT}`);
    await expect(page).toHaveTitle(next.title);
    expect((await head(page)).canonical).toBe(next.canonical);
    expect(await sameDocument(page)).toBe(true);
  });

  // With lazy route discovery (React Router's default) a link coming into view makes the browser ask `/__manifest?paths=...`, a request the Worker
  // cannot store and the visitor limit counts. `routeDiscovery: { mode: "initial" }` (react-router.config.ts) puts every route in the first page.
  test("ask for no route manifest while moving between the routes", async ({ page }) => {
    const manifests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/__manifest") manifests.push(request.url());
    });
    await page.goto("/xahau");
    await hydrated(page);
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));

    const ledger = page.locator('a[href^="/xahau/ledger/"]').first();
    const ledgerHref = (await ledger.getAttribute("href"))!;
    await ledger.hover();
    await ledger.click();
    await page.waitForURL(`**${ledgerHref}`);
    const tx = page.locator('a[href^="/xahau/tx/"]').first();
    const txHref = (await tx.getAttribute("href"))!;
    await tx.click();
    await page.waitForURL(`**${txHref}`);
    await page.getByRole("group", { name: "Network" }).getByRole("link", { name: "XRPL" }).click();
    await page.waitForURL("**/xrpl");

    expect(await sameDocument(page)).toBe(true);
    expect(manifests).toEqual([]);
  });

  test("lose the canonical link and gain `noindex` on a page behind a marker, and get them back", async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
    await hydrated(page);
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));
    const first = await head(page);
    expect(first.title).toBe("Account rBbW6i…W5jh · XRPL · explorer");
    expect(first.canonical).toBe(`${origin}/xrpl/account/${XRPL_ACCOUNT}`);
    expect(first.robots).toBeNull();
    expect(first.ogImage).toBe(`${origin}/og/xrpl/account/${XRPL_ACCOUNT}.png`);

    await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Older" }).click();
    await page.waitForURL(/\?marker=/);
    await expect.poll(async () => (await head(page)).robots).toBe("noindex, follow");
    const behind = await head(page);
    expect(behind.canonical).toBeNull();
    expect(behind.ogTitle).toBeNull();
    expect(behind.ogImage).toBeNull();

    await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Newer" }).click();
    await page.waitForURL(`**/xrpl/account/${XRPL_ACCOUNT}`);
    await expect.poll(async () => (await head(page)).canonical).toBe(first.canonical);
    expect((await head(page)).robots).toBeNull();
    expect(await sameDocument(page)).toBe(true);
  });

  test("name the network of the page the network switch leads to", async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await page.goto("/xrpl");
    await hydrated(page);
    expect((await head(page)).canonical).toBe(`${origin}/xrpl`);
    await page.getByRole("group", { name: "Network" }).getByRole("link", { name: "Xahau" }).click();
    await page.waitForURL("**/xahau");
    await expect(page).toHaveTitle("Explore Xahau · explorer");
    expect((await head(page)).canonical).toBe(`${origin}/xahau`);
  });
});
