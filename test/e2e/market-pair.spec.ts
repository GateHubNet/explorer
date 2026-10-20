import type { Locator, Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { RLUSD_ISSUER } from "./fixture-control";
import { LIVE } from "./fixtures";
import { expect, hydrated, test } from "./support";

// The market pair page (`/{net}/markets/{base}/{counter}`) in a browser, on XRP/RLUSD: the trades the fixtures derive from the recorded AMM
// ledgers, the recorded books and the derived pool. The views are URLs (the interval, the other way round, the Trades filter, the pages behind a
// marker); the links lead where they say; the chart answers the pointer and the keyboard; the page is whole without JavaScript; the AMM parts
// follow `AMM_DATA`; the order book is drawn inside its rows. What follows the chain, and what the fixture server is made to fail, is in
// market-pair-live.spec.ts.

const FEATURES_OFF = featuresOff(process.env);

/** XRP/RLUSD in its natural orientation (the native code first: the indexable page), and the other way round. */
const PAIR = `/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}`;
const INVERTED = `/xrpl/markets/RLUSD.${RLUSD_ISSUER}/XRP`;

/** The XRP/RLUSD AMM pool: the other side of every swap, which the traders card leaves out. */
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";

/** A trade of the first page whose transaction the fixtures hold: an OfferCreate that crossed the pool, in ledger 107,699,656. */
const RECORDED_TRADE_TX = "5081561D02260B321E16B9C3EF2840D6C5D32E6D62C74DADD7428F40C73D2793";

const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);
const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { sameDocument: true }));

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
/** The price card (`ChartCard id="pair-price"`): its candles, their volume, the readout, the interval links and the table view. */
const priceCard = (page: Page) => page.locator('section[aria-labelledby="pair-price-title"]');
const tradesTable = (page: Page) => page.getByRole("table", { name: "Recent trades" });
const bookTable = (page: Page) => page.getByRole("table", { name: "Order book" });

/** The head of the document as the browser has it now: what a search engine and a link preview would read. */
const head = (page: Page) =>
  page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
    openGraph: document.querySelectorAll('meta[property^="og:"]').length,
  }));

/** Puts the pointer on the middle of `target`, in the viewport's coordinates: the cursor layer is over the whole plot, so the target is a place. */
async function pointAt(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("the target has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

test.skip(FEATURES_OFF.has("MARKETS"), "MARKETS is off in the Worker under test: the pair pages are not found");

test.describe("the views are URLs", () => {
  test("'4 h' is ?interval=4h: the chart is the 4-hour candles, the page is not indexed, and it is the same document", async ({ page }) => {
    await page.goto(PAIR);
    await hydrated(page);
    await markDocument(page);
    const card = priceCard(page);
    const interval = card.getByRole("group", { name: "Candle interval" });
    await expect(interval.getByRole("link", { name: "1 h" })).toHaveAttribute("aria-current", "true");
    const time = card.locator(".candles__readout .candles__time");
    const slider = card.getByRole("slider").first();
    if (!LIVE) await expect(time).toHaveText("Oct 17, 2026, 17:00 UTC · so far");
    const hourly = await slider.getAttribute("aria-valuetext");
    await expect(slider).toHaveAttribute("aria-label", "XRP/RLUSD price, hour by hour");

    await interval.getByRole("link", { name: "4 h" }).click();
    await page.waitForURL(`**${PAIR}?interval=4h`);
    await expect(interval.getByRole("link", { name: "4 h" })).toHaveAttribute("aria-current", "true");
    await expect(interval.getByRole("link", { name: "1 h" })).not.toHaveAttribute("aria-current", /./);
    // The newest bucket is the 4 hours that hold the newest ledger (16:00 to 20:00 UTC on the fixtures' index day), still forming.
    if (!LIVE) await expect(time).toHaveText("Oct 17, 2026, 16:00 UTC · so far");
    await expect(slider).not.toHaveAttribute("aria-valuetext", hourly!);
    // An Arrow press moves a 4-hour bucket, and the slider's name says so.
    await expect(slider).toHaveAttribute("aria-label", "XRP/RLUSD price, 4 hours by 4 hours");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page).toHaveTitle(/ · XRPL market · 4 h candles · explorer$/);
    expect(await sameDocument(page)).toBe(true);
  });

  test("'Show RLUSD/XRP' goes to the pair the other way round, which is not indexed and links back", async ({ page }) => {
    await page.goto(PAIR);
    await hydrated(page);
    const natural = await head(page);
    expect(natural.canonical).toMatch(new RegExp(`${PAIR.replaceAll(".", "\\.")}$`));
    expect(natural.robots).toBeNull();
    expect(natural.openGraph).toBeGreaterThan(0);

    await page.getByRole("link", { name: "Show RLUSD/XRP" }).click();
    await page.waitForURL(`**${INVERTED}`);
    await expect(heading(page)).toHaveText("RLUSD / XRP");
    await expect(page.getByRole("link", { name: "Show XRP/RLUSD" })).toHaveAttribute("href", PAIR);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('meta[property^="og:"]')).toHaveCount(0);
    await expect(page).toHaveTitle(/^RLUSD\/XRP · RLUSD rMxCKb…m5De · XRPL market · explorer$/);
    // The book is the same answers seen from the other side: the base of the inverted page is RLUSD.
    await expect(bookTable(page).getByRole("columnheader", { name: "RLUSD" })).toBeVisible();
  });

  test("on ?trades=book, Older and Newer keep the filter, and the page behind the marker has no live row", async ({ page }) => {
    test.skip(FEATURES_OFF.has("AMM_DATA"), "AMM_DATA is off in the Worker under test: there is no Trades filter (checked below)");
    await page.goto(`${PAIR}?trades=book`);
    await hydrated(page);
    await expect(page.getByRole("button", { name: "Pause live updates" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Trades" }).getByRole("link", { name: "Order book" })).toHaveAttribute("aria-current", "true");

    await page.getByRole("link", { name: "Older", exact: true }).click();
    await page.waitForURL((url) => url.pathname === PAIR && url.searchParams.get("trades") === "book" && url.searchParams.has("marker"));
    await expect(tradesTable(page)).toBeVisible();
    await expect(page.getByText("Older trades of XRP/RLUSD.")).toBeVisible();
    // Old history: no live row, no button to pause it, no status line, and no price, chart or book.
    await expect(page.getByText("Live · updates every ledger")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /live updates/ })).toHaveCount(0);
    await expect(page.locator(".hero__live")).toHaveCount(0);
    await expect(priceCard(page)).toHaveCount(0);
    await expect(bookTable(page)).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");

    await page.getByRole("link", { name: "Newer", exact: true }).click();
    await page.waitForURL((url) => url.pathname === PAIR && url.search === "?trades=book");
    await expect(page.getByRole("button", { name: "Pause live updates" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Trades" }).getByRole("link", { name: "Order book" })).toHaveAttribute("aria-current", "true");
  });
});

test.describe("the links", () => {
  test("a trade's time leads to its transaction", async ({ page }) => {
    test.skip(LIVE, "reads a trade of the fixtures' first page whose transaction they hold");
    await page.goto(PAIR);
    await hydrated(page);
    // The time is the link; its name ends with the short hash, for a screen reader.
    await tradesTable(page).getByRole("link", { name: /, transaction 508156…2793$/ }).click();
    await page.waitForURL(`**/xrpl/tx/${RECORDED_TRADE_TX}`);
    await expect(heading(page)).toHaveText("Offer");
    await expect(page).toHaveTitle("Offer 508156…2793 · XRPL · explorer");
  });

  test.describe("an issuer", () => {
    // The fixtures do not hold the RLUSD issuer's account (no index record, no node answer, no history): there its page answers 503, which the
    // browser logs. The test looks at where the link leads, and that this 503 is the only thing the console said.
    test.use({ allowConsoleErrors: true });

    test("leads to its account page", async ({ page, browserErrors }) => {
      await page.goto(PAIR);
      await hydrated(page);
      const asked: string[] = [];
      page.on("request", (request) => asked.push(request.url()));
      const issuer = page.locator(".pair__issuers").getByRole("link", { name: RLUSD_ISSUER });
      await expect(page.locator(".pair__issuers")).toHaveText(`RLUSD issued by ${RLUSD_ISSUER} · XRP is native`);

      await issuer.click();
      await page.waitForURL(`**/xrpl/account/${RLUSD_ISSUER}`);
      // A client-side navigation: the browser asked for the account route's data.
      await expect.poll(() => asked.filter((url) => url.includes(`/xrpl/account/${RLUSD_ISSUER}.data`)).length).toBeGreaterThan(0);
      if (LIVE) {
        await expect(heading(page)).not.toHaveText("Temporarily unavailable");
        expect(browserErrors).toEqual([]);
      } else {
        await expect(heading(page)).toHaveText("Temporarily unavailable");
        expect(browserErrors.filter((line) => !(line.includes("status of 503") && line.includes(`/xrpl/account/${RLUSD_ISSUER}.data`)))).toEqual([]);
        // One line: the account route's data, asked for once.
        expect(browserErrors).toHaveLength(1);
      }
    });
  });
});

test.describe("the chart", () => {
  test("the pointer on a candle shows it in the readout and in a tooltip, and the readout goes back to the newest when it leaves", async ({ page }) => {
    await page.goto(PAIR);
    await hydrated(page);
    const card = priceCard(page);
    const time = card.locator(".candles__readout .candles__time");
    const newest = await time.textContent();
    expect(newest).toMatch(/ UTC · so far$/);
    const tip = card.locator(".plot__tip");
    await expect(tip).toHaveCount(0);

    // The oldest candle of the window: a bucket that has one.
    await pointAt(page, card.locator(".plot").first().locator(".col:has(.candle)").first());
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("open");
    await expect(time).not.toHaveText(newest!);
    const shown = (await time.textContent())!;
    // The readout and the tooltip are the same bucket: its date and time, which the readout says in UTC.
    await expect(tip.locator(".plot__tip-date")).toHaveText(shown.replace(/ UTC$/, ""));
    await expect(card.locator(".candles__readout")).toContainText(/O .+H .+L .+C /);

    await page.mouse.move(2, 2);
    await expect(tip).toHaveCount(0);
    await expect(time).toHaveText(newest!);
  });

  test("Tab to the slider and Arrow Left changes what it says, and the readout follows", async ({ page }) => {
    await page.goto(PAIR);
    await hydrated(page);
    const card = priceCard(page);
    const slider = card.getByRole("slider", { name: "XRP/RLUSD price, hour by hour" });

    // The plot's scroll region is the stop before its slider.
    await card.getByRole("region", { name: "XRP/RLUSD price, scrollable chart" }).focus();
    await page.keyboard.press("Tab");
    await expect(slider).toBeFocused();
    // It starts on the newest bucket, the forming one.
    await expect(slider).toHaveAttribute("aria-valuenow", "59");
    await expect(slider).toHaveAttribute("aria-valuetext", /, so far: /);
    const said = (await slider.getAttribute("aria-valuetext"))!;

    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", "58");
    await expect(slider).not.toHaveAttribute("aria-valuetext", said);
    await expect(slider).not.toHaveAttribute("aria-valuetext", /so far/);
    await expect(card.locator(".plot__tip")).toBeVisible();
    await expect(card.locator(".candles__readout .candles__time")).not.toHaveText(/so far/);

    await page.keyboard.press("Escape");
    await expect(card.locator(".plot__tip")).toHaveCount(0);
  });
});

test.describe("without JavaScript", () => {
  test("the chart, the book and the trades are there, and the chart's Table view works", async ({ contextFor }) => {
    const context = await contextFor({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(PAIR);

    const card = priceCard(page);
    await expect(card.locator(".candle").first()).toBeVisible();
    if (!LIVE) await expect(card.locator(".candle")).toHaveCount(8);
    await expect(card.locator(".col__bar--volume").first()).toBeAttached();
    await expect(card.locator(".candles__readout")).toContainText("so far");
    await expect(card.locator(".chart__table")).toBeHidden();
    await card.getByRole("radio", { name: "Table" }).check();
    await expect(card.locator(".chart__view")).toBeHidden();
    await expect(card.locator(".chart__table").getByRole("row")).toHaveCount(61);

    // Ten levels a side, and the middle row with the last price.
    const book = bookTable(page);
    await expect(book).toBeVisible();
    if (!LIVE) await expect(book.locator(".pair__level")).toHaveCount(20);
    await expect(book.locator(".pair__book-mid")).toContainText("spread");
    await expect(tradesTable(page).getByRole("row")).toHaveCount(21);
    // Nothing here is scripted: no slider (the cursor is the script's), no button to pause what does not move.
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /live updates/ })).toHaveCount(0);
  });
});

test.describe("the AMM parts", () => {
  test("the trades say how each was made (Via), and the Trades filter is there, while AMM_DATA is on", async ({ page }) => {
    await page.goto(PAIR);
    await hydrated(page);
    const trades = tradesTable(page);
    if (FEATURES_OFF.has("AMM_DATA")) {
      // The off-case: no Via column, no Trades filter (and no share in the pool card).
      await expect(trades.getByRole("columnheader", { name: "Via" })).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Trades" })).toHaveCount(0);
      await expect(page.getByText("Share of pair volume, 24 h")).toHaveCount(0);
      test.skip(true, "AMM_DATA is off in the Worker under test: the Via column and the Trades filter are absent, checked above");
    }
    await expect(trades.getByRole("columnheader", { name: "Via" })).toBeVisible();
    // The first page has both kinds: trades against offers and swaps against the pool.
    if (!LIVE) {
      await expect(trades.locator(".tag", { hasText: /^Book$/ }).first()).toBeVisible();
      await expect(trades.locator(".tag", { hasText: /^AMM$/ }).first()).toBeVisible();
    }
    const filter = page.getByRole("group", { name: "Trades" });
    await expect(filter.getByRole("link")).toHaveText(["All", "Order book", "AMM"]);
    await expect(filter.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "true");
    await expect(page.getByText("Applies to the chart, the 24 h figures and the trade list.")).toBeVisible();
    await expect(page.getByText("Share of pair volume, 24 h")).toBeVisible();
  });

  test("the most active traders leave out the XRP/RLUSD pool, the other side of every swap, and say so", async ({ page }) => {
    await page.goto(PAIR);
    await hydrated(page);
    const card = page.locator("section", { has: page.getByRole("heading", { name: "Most active traders, 24 h" }) });
    const links = card.getByRole("link");
    if (!LIVE) await expect(links).toHaveCount(5);
    for (const href of await links.evaluateAll((all) => all.map((link) => link.getAttribute("href")))) expect(href).not.toContain(POOL);
    await expect(card).not.toContainText("rhWTXC");
    if (!FEATURES_OFF.has("AMM_DATA") && !LIVE) await expect(card).toContainText("The XRP/RLUSD AMM pool, the other side of every swap, is left out.");
  });
});

test.describe("the traders card", () => {
  test("makes each trader's link a target of 24 px and more (WCAG 2.5.8): 12 px above and below its line's middle is the link, on rows 24 px and more apart", async ({ page }) => {
    await page.goto(PAIR);
    await hydrated(page);
    const card = page.locator("section", { has: page.getByRole("heading", { name: "Most active traders, 24 h" }) });
    await card.scrollIntoViewIfNeeded();
    // What the pointer hits at the start of each link's label, 12 px above and below the middle of its line (a span of 24 px, the stylesheet's
    // `::after` around it): the link itself, every time. The pitch of the list, from two consecutive links, is at least that span. (Measured in
    // E3's final fix wave: a line of 15.6 px, an `::after` of 27.6 px, rows 28 px apart. The areas of neighbours meet at the row boundary within
    // the browser's pixel snapping, so a probe closer to it than ±12 px, such as ±13.5 px, finds the next row's link and checks nothing more.)
    const { pitch, hits } = await card.locator(".barlist__link").evaluateAll((links) => {
      const boxes = links.map((link) => link.getBoundingClientRect());
      const middles = boxes.map((box) => box.top + box.height / 2);
      const owner = (box: DOMRect, y: number) => {
        const hit = document.elementFromPoint(box.left + 2, y);
        return hit === null ? -1 : links.findIndex((other) => other === hit || other.contains(hit));
      };
      return {
        pitch: middles[1]! - middles[0]!,
        hits: boxes.map((box, at) => ({ above: owner(box, middles[at]! - 12), below: owner(box, middles[at]! + 12) })),
      };
    });
    expect(hits.length).toBeGreaterThan(1);
    expect(pitch).toBeGreaterThanOrEqual(24);
    expect(hits).toEqual(hits.map((_, at) => ({ above: at, below: at })));
  });
});

test.describe("the order book", () => {
  // Task 15's ruling: the book is an ARIA table over rows of `div`s, each `position: relative` with its depth bar as the first child. In a
  // `<table>`, WebKit draws a bar of a `<tr>` against the page (bug 240961): this checks that each bar lies in its own row.
  for (const viewport of [
    { name: "desktop", size: { width: 1280, height: 800 } },
    { name: "375 px", size: { width: 375, height: 812 } },
  ]) {
    test(`draws each depth bar inside its own row (${viewport.name})`, async ({ page }) => {
      await page.setViewportSize(viewport.size);
      await page.goto(PAIR);
      await hydrated(page);
      const levels = bookTable(page).locator(".pair__level");
      await expect(levels.first()).toBeVisible();
      if (!LIVE) await expect(levels).toHaveCount(20);
      const boxes = await levels.evaluateAll((rows) =>
        rows.map((row) => {
          const own = row.getBoundingClientRect();
          const bar = row.querySelector(".inline-bar")!.getBoundingClientRect();
          return { row: [own.left, own.top, own.right, own.bottom], bar: [bar.left, bar.top, bar.right, bar.bottom], width: bar.width };
        }),
      );
      // Within half a pixel (subpixel layout), and every bar is drawn: each level has a size, so a depth above 0.
      const outside = boxes.filter(
        ({ row, bar }) => bar[0]! < row[0]! - 0.5 || bar[1]! < row[1]! - 0.5 || bar[2]! > row[2]! + 0.5 || bar[3]! > row[3]! + 0.5,
      );
      expect(outside).toEqual([]);
      expect(boxes.filter((box) => box.width <= 0)).toEqual([]);
    });
  }
});
