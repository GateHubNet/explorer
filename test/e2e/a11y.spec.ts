import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { XAHAU_COLLECTION, XAHAU_NFT, XRPL_COLLECTION, XRPL_NFT } from "../support/nft-names";
import { fixtures, RLUSD_ISSUER, unavailable, xahauSaltmarshPage } from "./fixture-control";
import {
  LIVE,
  NEVER_FUNDED,
  NO_SUCH_TRANSACTION,
  SNK_XRP_POOL,
  SWAP_THROUGH_POOL,
  XAHAU_ACCOUNT,
  XAHAU_DELETED,
  XAHAU_LEDGER,
  XAHAU_REMIT,
  XAHAU_SALTMARSH,
  XRP_RLUSD_POOL,
  XRPL_ACCOUNT,
  XRPL_DELETED,
  XRPL_ESCROW,
  XRPL_HEAD_LEDGER,
  XRPL_LEDGER,
  XRPL_PAYMENT,
} from "./fixtures";
import { drawnBy, type NamedPage, namedPagesOn, objectNamedPages, tokenNamedPages } from "./names-pages";
import { type ObjectCase, objectCase, recordedDelegateSet, removedBy } from "./object-pages";
import { expect, hashWords, hydrated, seriousViolations, test, WCAG_TAGS } from "./support";
import { holdersMarker, listOf, tokenCase, transfersMarker } from "./token-pages";
import { listedAmendment, listedValidator, needs, SKIP_OFF, VALIDATORS_OFF, withHistory } from "./validators-pages";

// Spec 12: axe (WCAG 2.2 AA: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) reports no serious or critical violation on the home,
// ledger, transaction (a payment, and a swap through an AMM pool), account, network, markets, market pair, AMM list, AMM pool and 404 pages and
// the account's analytics view, in light and in dark, on a desktop and on a 375 px phone. Dark is reached both ways it can be: the system's (`prefers-color-scheme`) and the visitor's (the theme
// toggle, which wins over the system).

type Theme = "light" | "dark";

interface PageUnderTest {
  name: string;
  path: string;
  /** What shows that the page is whole: the lists a streamed page draws last. */
  ready: (page: Page) => Promise<void>;
  /** What a visitor does to the page before it is looked at: a view they switch on, a control they focus. */
  act?: (page: Page) => Promise<void>;
}

const visible = (name: string) => async (page: Page) => {
  await expect(page.getByRole("table", { name })).toBeVisible();
};

/** The network page is whole when its first chart is drawn and the script has given the plots their sliders. */
const networkReady = async (page: Page) => {
  await expect(page.locator("#network-types-title")).toBeVisible();
  await expect(page.getByRole("slider").first()).toBeAttached();
};

const NETWORK: PageUnderTest = { name: "network", path: "/xrpl/network", ready: networkReady };

// The markets pages (E3), while `MARKETS` is on in the Worker under test: off, they are not found and the header says "soon".
const FEATURES_OFF = featuresOff(process.env);
const MARKETS_ON = !FEATURES_OFF.has("MARKETS");
/** Display names (E9), while `NAMES` is on in the Worker under test: the pages that draw names, and the account's name header, are checked only then. The names are the fixtures' (a real stack has names of its own). */
const NAMES_ON = !FEATURES_OFF.has("NAMES");

/** XRP/RLUSD, the pair of the derived fixtures, in its natural orientation and the other way round. */
const PAIR = `/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}`;
const INVERTED = `/xrpl/markets/RLUSD.${RLUSD_ISSUER}/XRP`;

/** The pair page is whole when its book is drawn and the script has given the candles their slider. */
const pairReady = async (page: Page) => {
  await expect(page.getByRole("table", { name: "Order book" })).toBeVisible();
  await expect(page.getByRole("slider").first()).toBeAttached();
};

const MARKETS: PageUnderTest = { name: "markets", path: "/xrpl/markets", ready: visible("Pairs") };
const MARKET_PAIR: PageUnderTest = { name: "market pair", path: PAIR, ready: pairReady };

/**
 * A Payment that swapped through the XRP/RLUSD pool: while `AMM_PAGES` is on its flow's pool label is a link to the pool's page, over the account link,
 * and each is a target of its own (E5's fix of `.flow__label > a`, WCAG 2.5.8).
 */
const SWAP: PageUnderTest = {
  name: "swap through an AMM pool",
  path: `/xrpl/tx/${SWAP_THROUGH_POOL}`,
  ready: async (page) => void (await expect(page.getByRole("tablist", { name: "Raw data" })).toBeVisible()),
};

// The AMM pages (E5), while `AMM_PAGES` is on in the Worker under test: off, they are not found and the header says "soon".
const AMM_ON = !FEATURES_OFF.has("AMM_PAGES");
const AMM_POOL_PATH = `/xrpl/amm/${XRP_RLUSD_POOL}`;

/** The AMM list is whole when its table is drawn and the script has given the 30-day chart its slider. */
const ammListReady = async (page: Page) => {
  await visible("Pools")(page);
  await expect(page.getByRole("slider").first()).toBeAttached();
};
/** The pool page is whole when its tab's table is drawn and the script has given the charts their sliders. */
const ammPoolReady =
  (table = "Swaps") =>
  async (page: Page) => {
    await visible(table)(page);
    await expect(page.getByRole("slider").first()).toBeAttached();
  };
/** The pool's swap volume card (`ChartCard id="pool-volume"`). */
const poolVolume = (page: Page) => page.locator('section[aria-labelledby="pool-volume-title"]');

const AMM_LIST: PageUnderTest = { name: "AMM list", path: "/xrpl/amm", ready: ammListReady };
const AMM_POOL: PageUnderTest = { name: "AMM pool", path: AMM_POOL_PATH, ready: ammPoolReady() };

/**
 * The account's analytics view is whole when its frame and every part have streamed in (nothing in it is `aria-busy`) and, with the fixtures,
 * whose charts all have data, the script has given its plots their sliders: the view is a lazy chunk, which hydrates after the page.
 */
const analyticsReady = async (page: Page) => {
  await expect(page.getByRole("group", { name: "Analytics filters" }).getByRole("status")).not.toHaveText("Loading analytics…");
  await expect(page.locator(".analytics [aria-busy]")).toHaveCount(0);
  if (!LIVE) await expect(page.locator(".analytics").getByRole("slider").first()).toBeAttached();
};

const ANALYTICS: PageUnderTest = { name: "account analytics", path: `/xrpl/account/${XRPL_ACCOUNT}?tab=analytics`, ready: analyticsReady };

/** The analytics views, while ACCOUNT_ANALYTICS is on in the Worker under test; with it off they are redirects to the account page, which is above. */
const analyticsViews = (pages: PageUnderTest[]): PageUnderTest[] => (FEATURES_OFF.has("ACCOUNT_ANALYTICS") ? [] : pages);

/** A verified name's "How we know", opened as a keyboard does: the summary takes the focus, Enter opens it, and the checks are then in view. */
const openHowWeKnow = async (page: Page) => {
  const summary = page.locator("details.disc > summary");
  await summary.focus();
  await expect(page.locator("details.disc")).not.toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(page.locator("details.disc")).toHaveAttribute("open", "");
  await expect(page.locator("details.disc .disc__checks")).toBeVisible();
};

/** The pages the spec names, and the matrix below runs all of them in every setting. */
const MAIN: PageUnderTest[] = [
  { name: "home", path: "/xrpl", ready: visible("Latest ledgers") },
  { name: "ledger", path: `/xahau/ledger/${XAHAU_LEDGER}`, ready: visible("Transactions") },
  { name: "transaction", path: `/xrpl/tx/${XRPL_PAYMENT}`, ready: async (page) => void (await expect(page.getByRole("tablist", { name: "Raw data" })).toBeVisible()) },
  { name: "account", path: `/xrpl/account/${XRPL_ACCOUNT}`, ready: visible("Transactions") },
  { name: "404", path: "/xrpl/nothing-here", ready: async (page) => void (await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible()) },
  NETWORK,
  ...(MARKETS_ON ? [MARKETS, MARKET_PAIR] : []),
  ...analyticsViews([ANALYTICS]),
  SWAP,
  ...(AMM_ON ? [AMM_LIST, AMM_POOL] : []),
];

/** More of what a visitor sees, in light and dark (the system's) only. */
const MORE: PageUnderTest[] = [
  { name: "Xahau home", path: "/xahau", ready: visible("Latest ledgers") },
  { name: "big ledger", path: `/xrpl/ledger/${XRPL_LEDGER}`, ready: visible("Transactions") },
  { name: "Xahau account", path: `/xahau/account/${XAHAU_ACCOUNT}`, ready: visible("Transactions") },
  { name: "account payments", path: `/xrpl/account/${XRPL_ACCOUNT}?tab=payments`, ready: visible("Payments") },
  { name: "account trades", path: `/xrpl/account/${XRPL_ACCOUNT}?tab=trades`, ready: visible("Trades") },
  { name: "account offers", path: `/xrpl/account/${XRPL_ACCOUNT}?tab=offers`, ready: visible("Offers") },
  { name: "account objects", path: `/xrpl/account/${XRPL_ACCOUNT}?tab=objects`, ready: async (page) => void (await expect(page.getByRole("navigation", { name: "Account activity" })).toBeVisible()) },
  // The account's name header (E9): a verified name, on each network, with "How we know" opened with the keyboard (the summary takes the focus and Enter opens it), the deleted
  // account GateHub gave a name and a label, with its banner, and the deleted Xahau account with a label and no name. The account whose domain is not verified needs answers the recordings
  // lack, so it is with the pages whose fixture server answers differently, below. A Xahau transaction draws the accounts of every kind of name. The names are the fixtures' (a real stack has names of its own).
  ...(LIVE || !NAMES_ON
    ? []
    : [
        { name: "account with a verified name, How we know open", path: `/xrpl/account/${XRPL_ACCOUNT}`, ready: visible("Transactions"), act: openHowWeKnow },
        { name: "Xahau account with a verified name, How we know open", path: `/xahau/account/${XAHAU_ACCOUNT}`, ready: visible("Transactions"), act: openHowWeKnow },
        {
          name: "deleted account named by GateHub, with its label's banner",
          path: `/xrpl/account/${XRPL_DELETED}`,
          ready: async (page: Page) => {
            await expect(page.getByRole("heading", { level: 1 })).toContainText("named by GateHub");
            await expect(page.locator(".notice--warning", { hasText: "Labelled advisory by GateHub" })).toBeVisible();
          },
        },
        {
          name: "deleted Xahau account with a scam label and no name",
          path: `/xahau/account/${XAHAU_DELETED}`,
          ready: async (page: Page) => {
            await expect(page.getByRole("heading", { level: 1 })).toContainText("labelled scam by GateHub");
            await expect(page.locator(".notice--warning", { hasText: "Labelled scam by GateHub" })).toBeVisible();
          },
        },
        {
          name: "Xahau transaction with accounts named every way",
          path: `/xahau/tx/${XAHAU_REMIT}`,
          ready: async (page: Page) => void (await expect(page.getByRole("tablist", { name: "Raw data" })).toBeVisible()),
        },
      ]),
  // These are made of what the fixtures hold by hand (the newest ledger, a marker into six transactions, an address nobody funded).
  ...(LIVE
    ? []
    : [
        { name: "newest ledger, whose Next is disabled", path: `/xrpl/ledger/${XRPL_HEAD_LEDGER}`, ready: visible("Transactions") },
        { name: "account behind a marker", path: `/xrpl/account/${XRPL_ACCOUNT}?marker=WzEwNzYxMjU3MywyNV0`, ready: visible("Transactions") },
        { name: "never-activated account", path: `/xrpl/account/${NEVER_FUNDED}`, ready: async (page: Page) => void (await expect(page.getByRole("main")).toContainText("never been activated")) },
      ]),
  { name: "transaction not found", path: `/xrpl/tx/${NO_SUCH_TRANSACTION}`, ready: async (page) => void (await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible()) },
  { name: "search help", path: "/xrpl/search?q=", ready: async (page) => void (await expect(page.getByRole("main")).toBeVisible()) },
  // A text that is no token: with TOKENS on the help page ends in the link "Look for “RLUSD” among tokens →" (E11 spec 5.3), the one suggestion link of a not-found page; with it off, the help it was.
  { name: "search help offering the tokens", path: "/xrpl/search?q=RLUSD", ready: async (page) => void (await expect(page.getByRole("main")).toBeVisible()) },
  // The Network menu open (E12): its panel over the page at a desktop's width, in the flow of the folded nav on a phone (the Menu button first), with the summary and the network page's item marked by
  // `aria-current` and, where a switch is off, an item `aria-disabled`; the colours of its text in both themes are looked at here. The supply pages themselves are in supply-live.spec.ts (no spec of
  // this project opens them: their answers are kept, README "The supply page").
  {
    name: "network, the Network menu open",
    path: "/xrpl/network",
    ready: networkReady,
    act: async (page) => {
      const menuButton = page.getByRole("button", { name: "Menu" });
      if (await menuButton.isVisible()) await menuButton.click();
      await page.locator('details[data-menu="network"] > summary').click();
      await expect(page.locator(".menu__panel")).toBeVisible();
    },
  },
  // The network page in its other forms: a year in USD (weeks, another currency), the other network, every chart as a table, and a slider with
  // its tooltip. (The one with a card that could not be loaded needs the fixture server to fail a call: it is below.)
  { name: "network, a year in USD", path: "/xrpl/network?period=1y&in=usd", ready: networkReady },
  { name: "Xahau network", path: "/xahau/network", ready: networkReady },
  {
    name: "network, every table view",
    path: "/xrpl/network",
    ready: networkReady,
    act: async (page) => {
      for (const radio of await page.getByRole("radio", { name: "Table" }).all()) await radio.check();
      await expect(page.locator(".chart__table").first()).toBeVisible();
    },
  },
  {
    name: "network, a slider focused",
    path: "/xrpl/network",
    ready: networkReady,
    act: async (page) => {
      await page.getByRole("slider").first().focus();
      await expect(page.locator(".plot__tip").first()).toBeVisible();
    },
  },
  // The markets pages in their other forms: the other network (no AMM column, no Trades filter), a period and a quote, the text filter in use,
  // the pair the other way round, a page of older trades, the pair page's 404, and the candles' slider with its tooltip. (The pair with its node
  // failing needs the fixture server to fail a call, which only the `live` project may do: it is in market-pair-live.spec.ts.)
  ...(MARKETS_ON
    ? [
        { name: "Xahau markets", path: "/xahau/markets", ready: visible("Pairs") },
        { name: "markets, 30 days quoted in USD", path: "/xrpl/markets?period=30d&quote=usd", ready: visible("Pairs") },
        {
          name: "markets, the text filter in use",
          path: "/xrpl/markets",
          ready: visible("Pairs"),
          act: async (page: Page) => {
            await page.getByRole("searchbox", { name: "Filter pairs" }).fill("xrp");
            await expect(page.locator('.markets__count[role="status"]')).toHaveText(/^Showing /);
          },
        },
        { name: "market pair, the other way round", path: INVERTED, ready: pairReady },
        {
          // The order-book trades, then Older: a page behind a marker (with AMM_DATA off there is no filter, and Older is the list's).
          name: "market pair, older trades",
          path: FEATURES_OFF.has("AMM_DATA") ? PAIR : `${PAIR}?trades=book`,
          ready: pairReady,
          act: async (page: Page) => {
            await page.getByRole("link", { name: "Older", exact: true }).click();
            await page.waitForURL((url) => url.searchParams.has("marker"));
            await expect(page.getByRole("table", { name: "Recent trades" })).toBeVisible();
            await expect(page.getByRole("table", { name: "Order book" })).toHaveCount(0);
          },
        },
        {
          name: "market pair not found",
          path: "/xrpl/markets/XRP/XRP",
          ready: async (page: Page) => void (await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible()),
        },
        {
          name: "market pair, the candle slider focused",
          path: PAIR,
          ready: pairReady,
          act: async (page: Page) => {
            await page.getByRole("slider", { name: "XRP/RLUSD price, hour by hour" }).focus();
            await expect(page.locator('section[aria-labelledby="pair-price-title"] .plot__tip')).toBeVisible();
          },
        },
      ]
    : []),
  // The AMM pages in their other forms: the list filtered by an asset, with the deleted pools, behind a marker (by "More pools") and with an asset that
  // does not parse; the pool's other tabs, its year (weeks), its older swaps (by Older), every chart as a table and the volume chart's slider with its
  // tooltip; the deleted pool; Xahau's page and its pool 404. (The pool with a card that failed needs the fixture server to fail a call, which only the
  // `live` project may do: it is in amm-live.spec.ts.)
  ...(AMM_ON
    ? [
        { name: "AMM list, filtered by RLUSD", path: `/xrpl/amm?asset=RLUSD.${RLUSD_ISSUER}`, ready: visible("Pools") },
        { name: "AMM list, with the deleted pools", path: "/xrpl/amm?deleted=1", ready: visible("Pools") },
        {
          name: "AMM list, behind a marker",
          path: "/xrpl/amm",
          ready: ammListReady,
          act: async (page: Page) => {
            await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "More pools" }).click();
            await page.waitForURL((url) => url.searchParams.has("marker"));
            await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Previous" })).toBeVisible();
          },
        },
        {
          name: "AMM list, an asset that does not parse",
          path: "/xrpl/amm?asset=nope",
          ready: async (page: Page) => void (await expect(page.getByText("Write an asset as XRP, or as a currency and its issuer: RLUSD.rMxCK…")).toBeVisible()),
        },
        { name: "AMM pool, Liquidity", path: `${AMM_POOL_PATH}?tab=liquidity`, ready: ammPoolReady("Liquidity events") },
        { name: "AMM pool, Votes and bids", path: `${AMM_POOL_PATH}?tab=governance`, ready: ammPoolReady("Votes and bids") },
        { name: "AMM pool, a year", path: `${AMM_POOL_PATH}?period=1y`, ready: ammPoolReady() },
        {
          name: "AMM pool, older swaps",
          path: AMM_POOL_PATH,
          ready: ammPoolReady(),
          act: async (page: Page) => {
            await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Older" }).click();
            await page.waitForURL((url) => url.searchParams.has("marker"));
            await expect(page.getByRole("link", { name: "Back to the pool" })).toBeVisible();
          },
        },
        {
          name: "AMM pool, every table view",
          path: AMM_POOL_PATH,
          ready: ammPoolReady(),
          act: async (page: Page) => {
            for (const radio of await page.getByRole("radio", { name: "Table" }).all()) await radio.check();
            await expect(page.locator(".chart__table").first()).toBeVisible();
            await expect(page.locator(".chart__view").first()).toBeHidden();
          },
        },
        {
          name: "AMM pool, the volume slider focused",
          path: AMM_POOL_PATH,
          ready: ammPoolReady(),
          act: async (page: Page) => {
            await poolVolume(page).getByRole("slider").focus();
            await expect(poolVolume(page).locator(".plot__tip")).toBeVisible();
          },
        },
        {
          name: "deleted AMM pool",
          path: `/xrpl/amm/${SNK_XRP_POOL}`,
          ready: async (page: Page) => {
            await expect(page.getByText("This pool was deleted.")).toBeVisible();
            await visible("Swaps")(page);
          },
        },
        { name: "Xahau AMM", path: "/xahau/amm", ready: async (page: Page) => void (await expect(page.getByRole("heading", { name: "Xahau has no AMM" })).toBeVisible()) },
        {
          name: "AMM pool on Xahau, not found",
          path: `/xahau/amm/${XRP_RLUSD_POOL}`,
          ready: async (page: Page) => void (await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible()),
        },
      ]
    : []),
  // The analytics view in its other forms: a year (weeks), All (months), the other network, a deleted account (made of the fixtures by hand),
  // every chart as a table, and a slider with its tooltip. (The one with a card that failed needs the fixture server to fail a call: it is below.)
  ...analyticsViews([
    { name: "account analytics, a year", path: `${ANALYTICS.path}&period=1y`, ready: analyticsReady },
    { name: "account analytics, all", path: `${ANALYTICS.path}&period=all`, ready: analyticsReady },
    { name: "Xahau account analytics", path: `/xahau/account/${XAHAU_ACCOUNT}?tab=analytics`, ready: analyticsReady },
    ...(LIVE ? [] : [{ name: "deleted account analytics", path: `/xrpl/account/${XRPL_DELETED}?tab=analytics`, ready: analyticsReady }]),
    {
      name: "account analytics, every table view",
      path: ANALYTICS.path,
      ready: analyticsReady,
      act: async (page) => {
        for (const radio of await page.locator(".analytics").getByRole("radio", { name: "Table" }).all()) await radio.check();
        await expect(page.locator(".analytics .chart__table").first()).toBeVisible();
        await expect(page.locator(".analytics .chart__view").first()).toBeHidden();
      },
    },
    {
      name: "account analytics, a slider focused",
      path: ANALYTICS.path,
      ready: analyticsReady,
      act: async (page) => {
        await page.locator(".analytics").getByRole("slider").first().focus();
        await expect(page.locator(".analytics .plot__tip").first()).toBeVisible();
      },
    },
  ]),
];

const VIEWPORTS = [
  { name: "desktop", size: { width: 1280, height: 800 } },
  { name: "375 px", size: { width: 375, height: 812 } },
] as const;

const SETTINGS: Array<{ name: string; system: Theme; shown: Theme; toggle?: Theme }> = [
  { name: "light", system: "light", shown: "light" },
  { name: "dark", system: "dark", shown: "dark" },
  { name: "dark by the toggle", system: "light", shown: "dark", toggle: "dark" },
  { name: "light by the toggle", system: "dark", shown: "light", toggle: "light" },
];

async function open(page: Page, under: PageUnderTest, setting: (typeof SETTINGS)[number]): Promise<void> {
  await page.goto(under.path);
  await hydrated(page);
  await under.ready(page);
  await under.act?.(page);
  if (setting.toggle) {
    await page.getByRole("button", { name: "Dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", setting.toggle);
  }
  // The page is the theme the setting says (so that "dark" cannot be run as light by a setting that did not take).
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).colorScheme)).toBe(setting.shown);
}

for (const viewport of VIEWPORTS) {
  test.describe(`axe at ${viewport.name}`, () => {
    for (const setting of SETTINGS) {
      test.describe(`${setting.name}`, () => {
        test.use({ viewport: viewport.size, colorScheme: setting.system });
        for (const under of MAIN) {
          test(`${under.name} has no serious or critical violation`, async ({ page }) => {
            await open(page, under, setting);
            expect(await seriousViolations(page)).toEqual([]);
          });
        }
        if (setting.toggle === undefined) {
          for (const under of MORE) {
            test(`${under.name} has no serious or critical violation`, async ({ page }) => {
              await open(page, under, setting);
              expect(await seriousViolations(page)).toEqual([]);
            });
          }
        }
      });
    }
  });
}

// Landmarks of one kind carry names that tell them apart (axe: landmark-unique, a best practice and so not in the WCAG tags above).
// A card is a named region, and so is the scrolling part of a table inside it.
test.describe("landmarks", () => {
  for (const under of [...MAIN, MORE[1]!, MORE[2]!]) {
    test(`${under.name} has no two landmarks of one role and name`, async ({ page }) => {
      await page.goto(under.path);
      await hydrated(page);
      await under.ready(page);
      const results = await new AxeBuilder({ page }).withRules(["landmark-unique"]).analyze();
      expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`)).toEqual([]);
    });
  }
});

// axe reports a name on an element that cannot have one (`aria-label` on a `span` with no role) not as a violation but as "needs review",
// so the gate above does not see it: the controls the pages draw are looked at for it.
test.describe("names", () => {
  for (const under of [
    MORE[0]!,
    ...MAIN.slice(0, 4),
    NETWORK,
    ...MORE.filter((page) => page.name.startsWith("newest ledger")),
    ...(MARKETS_ON ? [MARKETS, MARKET_PAIR] : []),
    ...analyticsViews([ANALYTICS]),
    SWAP,
    ...(AMM_ON ? [AMM_LIST, AMM_POOL] : []),
  ]) {
    test(`${under.name}: nothing is given a name it cannot have`, async ({ page }) => {
      await page.goto(under.path);
      await hydrated(page);
      await under.ready(page);
      const results = await new AxeBuilder({ page }).withRules(["aria-prohibited-attr", "aria-allowed-attr", "aria-allowed-role"]).analyze();
      const found = [...results.violations, ...results.incomplete].map((rule) => `${rule.id}: ${rule.nodes.map((node) => node.target.join(" ")).join(" | ")}`);
      expect(found).toEqual([]);
    });
  }
});

// Display names (E9) are drawn with icons that a reader does not see (the seal, the tag and the label's alert are `aria-hidden`), so how a name is known is said in words beside them.
// axe cannot say that those words are in a link's accessible name, or that "How we know" can be reached and operated with no mouse: these tests do. The pages and the names are the
// fixtures' (a real stack has names of its own), and only while `NAMES` is on in the Worker under test.
test.describe("display names", () => {
  test.skip(LIVE || !NAMES_ON, "reads the names of the fixtures, while NAMES is on in the Worker under test");

  /** The links of a snapshot of the accessibility tree: each one's accessible name and where it leads. */
  const linksOf = (snapshot: string) =>
    [...snapshot.matchAll(/- link "((?:[^"\\]|\\.)*)"[^\n]*:\n\s+- \/url: (\S+)/g)].map((match) => ({ name: match[1]!.replace(/\\(.)/g, "$1"), href: match[2]! }));

  // The pages are `NamedPage`s (test/e2e/names-pages.ts): where its links to accounts are (the page's main, unless the page has others that are no account's name: the home page's examples), the
  // account the page is of (its tabs and its pager are links to the page by their own words), and the kinds of names the links must have among them, with whether one must be an account with a label and no name.
  const NAMED_PAGES: NamedPage[] = [
    { name: "a payment", net: "xrpl", path: `/xrpl/tx/${XRPL_PAYMENT}`, ready: visible("Balance changes"), kinds: ["verified"] },
    { name: "a Xahau Remit", net: "xahau", path: `/xahau/tx/${XAHAU_REMIT}`, ready: visible("Balance changes"), kinds: ["verified", "account", "domain"] },
    {
      name: "the XRPL home page's transactions",
      net: "xrpl",
      path: "/xrpl",
      ready: visible("Latest transactions"),
      scope: (page) => page.getByRole("table", { name: "Latest transactions" }),
      kinds: ["verified", "account", "domain"],
    },
    { name: "a Xahau account's page", net: "xahau", path: `/xahau/account/${XAHAU_ACCOUNT}`, ready: visible("Transactions"), own: XAHAU_ACCOUNT, kinds: ["verified", "account", "domain"] },
    // The account that activated the XRPL account has a label and no name: its link is its address and the words of the label.
    { name: "an XRPL account's page", net: "xrpl", path: `/xrpl/account/${XRPL_ACCOUNT}`, ready: visible("Transactions"), own: XRPL_ACCOUNT, kinds: [], labelled: true },
    // The ledger object pages and the account's Delegation tab (E10), those the Worker under test has: the three kinds of names are among them (names-pages.ts says which).
    ...namedPagesOn(objectNamedPages(), FEATURES_OFF),
    // The token pages (E11), those the Worker under test has: the list, a token's page, its holders and a Xahau token's page (names-pages.ts says which kinds of names each has).
    ...namedPagesOn(tokenNamedPages(), FEATURES_OFF),
  ];

  for (const under of NAMED_PAGES) {
    test(`${under.name}: the accessible name of each link to an account has the words of its marks`, async ({ page }) => {
      await page.goto(under.path);
      await hydrated(page);
      await under.ready(page);
      const scope = under.scope?.(page) ?? page.getByRole("main");
      const accounts = linksOf(await scope.ariaSnapshot()).filter((link) => link.href.startsWith(`/${under.net}/account/`));
      expect(accounts.length, "the page links accounts").toBeGreaterThan(0);

      const kinds = new Set<string>();
      let labelled = 0;
      for (const link of accounts) {
        const address = link.href.slice(`/${under.net}/account/`.length).split(/[?#]/)[0]!;
        if (address === under.own) continue;
        // A page may draw an account both ways (a sentence's short link and a detail's whole one): the link says which.
        const expected = drawnBy(under.net, address, { full: link.name.includes(address) });
        expect(link.name, `the link to ${address}`).toBe(expected.text);
        if (expected.kind) kinds.add(expected.kind);
        if (!expected.named && expected.text.includes("labelled")) labelled += 1;
      }
      expect([...kinds].sort()).toEqual(expect.arrayContaining(under.kinds.slice().sort()));
      if (under.labelled) expect(labelled, "a link to an account with a label and no name").toBeGreaterThan(0);
    });
  }

  for (const net of ["xrpl", "xahau"] as const) {
    test(`${net}: How we know is reached with Tab, opened and closed with Enter and Space, and what is in it is in the tab order only while it is open`, async ({ page }) => {
      await page.goto(`/${net}/account/${net === "xrpl" ? XRPL_ACCOUNT : XAHAU_ACCOUNT}`);
      await hydrated(page);
      const disclosure = page.locator("details.disc");
      const summary = disclosure.locator("summary");
      const focusIn = (locator: Locator) => locator.evaluate((element) => element.contains(document.activeElement));

      // Reached by Tab, from the top of the page, in a handful of presses (it is under the header and the name, before the tabs of the list).
      let presses = 0;
      while (!(await focusIn(summary)) && presses < 60) {
        await page.keyboard.press("Tab");
        presses += 1;
      }
      await expect(summary).toBeFocused();
      expect(presses, "Tab presses from the top of the page").toBeLessThan(40);
      // It shows where the focus is (the page's ring: 2 px), and it is a target of 44 px.
      await expect(summary).toHaveCSS("outline-style", "solid");
      await expect(summary).toHaveCSS("outline-width", "2px");
      expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      // Closed: its link is not in the tab order, so Tab leaves it for what follows.
      await expect(disclosure).not.toHaveAttribute("open", "");
      await page.keyboard.press("Tab");
      expect(await focusIn(disclosure), "the focus left the closed disclosure").toBe(false);
      await page.keyboard.press("Shift+Tab");
      await expect(summary).toBeFocused();

      // Enter opens it, and the next Tab is the first link inside; Shift+Tab is back on the summary, and Space closes it.
      await page.keyboard.press("Enter");
      await expect(disclosure).toHaveAttribute("open", "");
      await page.keyboard.press("Tab");
      expect(await focusIn(disclosure.locator(".disc__checks a").first()), "the focus is on the first link of the checks").toBe(true);
      await page.keyboard.press("Shift+Tab");
      await expect(summary).toBeFocused();
      await page.keyboard.press("Space");
      await expect(disclosure).not.toHaveAttribute("open", "");
      await expect(disclosure.locator(".disc__checks")).toBeHidden();
      await expect(summary).toBeFocused();
    });
  }
});

// axe cannot decide the contrast of the first amount in the account's table ("needs review": "overlapped by another element"). What overlaps it
// is the line below, `+1 more`: that line's hit-test box starts under 1 px above its own layout box, inside the bottom of the amount's, and
// axe, finding another element on top at that point, gives up. It has no background, so nothing about the amount's colours is in doubt: they
// are checked here as axe would, against the first background behind them, for every amount in the table.
for (const scheme of ["light", "dark"] as const) {
  test.describe(`amounts in ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("meet 4.5:1 on the card they are in, whatever axe makes of the line under the first", async ({ page }) => {
      await page.goto(`/xrpl/account/${XRPL_ACCOUNT}`);
      await hydrated(page);
      await visible("Transactions")(page);
      const ratios = await page.evaluate(() => {
        const channel = (value: number) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const rgb = (text: string): number[] => text.match(/[\d.]+/g)!.map(Number);
        const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
        const backgroundBehind = (element: Element): number[] => {
          for (let node: Element | null = element; node; node = node.parentElement) {
            const color = rgb(getComputedStyle(node).backgroundColor);
            if ((color[3] ?? 1) > 0) return color;
          }
          return [255, 255, 255];
        };
        return [...document.querySelectorAll(".amt--pos, .amt--neg")].map((element) => {
          const own = luminance(rgb(getComputedStyle(element).color));
          const behind = luminance(backgroundBehind(element));
          const [light, dark] = own > behind ? [own, behind] : [behind, own];
          return { text: element.textContent, ratio: (light + 0.05) / (dark + 0.05) };
        });
      });
      expect(ratios.length).toBeGreaterThan(0);
      expect(ratios.filter((amount) => amount.ratio < 4.5)).toEqual([]);
    });
  });
}

test.describe("the gate", () => {
  test("runs the rules of WCAG 2.2 AA, 2.5.3 (label in name) among them", async ({ page }) => {
    await page.goto(`/xahau/ledger/${XAHAU_LEDGER}`);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const ran = [...results.passes, ...results.violations, ...results.incomplete, ...results.inapplicable].map((rule) => rule.id);
    for (const id of ["color-contrast", "label-content-name-mismatch", "target-size", "scrollable-region-focusable"]) expect(ran).toContain(id);
  });
});

// A network page and an analytics view with a card that could not be loaded: its error, its Retry button and the rest of the page beside it. The
// fixture server is made to fail one call of each, and what it answers shows in every page the Worker renders meanwhile; these tests run in the
// `chromium` project with the others, so each call is one that no other spec asks for (`stats/type` of the 7 days on XRPL: the other specs open the
// 30 days, the year and USD; `stats/transactions` of the Xahau account's 90 days: the other specs open its default view, and the `live` project,
// which runs alone after them, its year), the tests of the group run one after another in one worker, and the override is taken away when the
// last of them is done. Both calls are in the one override: a `PUT` replaces the overrides before it. The Xahau account whose domain is not verified (E9) is in the group
// for the same reason: its page renders only with answers the recordings lack (`xahauSaltmarshPage`), which no other spec of the project asks for, and they are in the same override.
const TYPES_SEVEN_DAYS = "GET /v2/stats/type?end=2026-10-17&interval=day&limit=1000&start=2026-10-11";
const XAHAU_SENT_NINETY_DAYS = `xahau GET /v2/accounts/${XAHAU_ACCOUNT}/stats/transactions?interval=day&limit=1000&start=2026-07-20`;

test.describe("pages the fixture server answers differently: a card that failed, an account the recordings lack", () => {
  test.skip(LIVE, "fails a call of the fixture server: it needs the fixture server of the stack, not a real stack or a deployed Worker");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await fixtures.override({ [TYPES_SEVEN_DAYS]: unavailable(), [XAHAU_SENT_NINETY_DAYS]: unavailable(), ...xahauSaltmarshPage() });
  });
  test.afterAll(async () => {
    await fixtures.reset();
  });

  const answered: PageUnderTest[] = [
    {
      name: "network, a card that failed",
      path: "/xrpl/network?period=7d",
      ready: async (page) => {
        await expect(page.getByText("Couldn’t load transactions by type")).toBeVisible();
        await expect(page.getByRole("slider").first()).toBeAttached();
      },
    },
    ...analyticsViews([
      {
        name: "account analytics, a card that failed",
        path: `/xahau/account/${XAHAU_ACCOUNT}?tab=analytics&period=90d`,
        ready: async (page) => {
          await analyticsReady(page);
          await expect(page.locator('section[aria-labelledby="analytics-sent-title"]').getByRole("alert")).toContainText("Couldn’t load the transactions sent.");
        },
      },
    ]),
    // An account whose names entry has a domain that is not verified (its toml's check failed): its heading's visible words, and the sentence that says why, in text.
    ...(NAMES_ON
      ? [
          {
            name: "Xahau account whose domain is not verified",
            path: `/xahau/account/${XAHAU_SALTMARSH}`,
            ready: async (page: Page) => {
              await expect(page.getByRole("heading", { level: 1 })).toHaveText("saltmarsh.example not verified");
              await expect(page.locator(".account-head__kind")).toContainText("its xahau.toml could not be read");
            },
          },
        ]
      : []),
  ];

  for (const viewport of VIEWPORTS) {
    for (const setting of SETTINGS.filter((candidate) => candidate.toggle === undefined)) {
      test.describe(`${viewport.name}, ${setting.name}`, () => {
        test.use({ viewport: viewport.size, colorScheme: setting.system });
        for (const under of answered) {
          test(`${under.name} has no serious or critical violation`, async ({ page }) => {
            await open(page, under, setting);
            expect(await seriousViolations(page)).toEqual([]);
          });
        }
      });
    }
  }
});

// ---- The validators and amendments pages ------------------------------------------------------------------------------------------------------
// Their spec's "Accessibility": the four XRPL pages at both widths in the four settings, and more of them in the two system themes (Xahau, a search
// with no match, a validator with no domain, a page of older validations, an enabled and an unknown amendment, every table view, the yes votes'
// slider with its tooltip, the other validators' votes open). The validators and amendments are read from the pages (`path` is then a function of
// the page; `null` where the stack under test has none). At 375 px no page scrolls sideways: the tables and the 30-day charts scroll inside their
// cards. The page with a card that failed is validators-live.spec.ts's: it fails a call of the fixture server, which only the `live` project does.
// Where E2E_FEATURES_OFF lists VALIDATORS, the pages are not there and the block skips itself.

interface ValidatorsPageUnderTest extends Omit<PageUnderTest, "path"> {
  path: string | ((page: Page) => Promise<string | null>);
}

const slidersReady = async (page: Page) => void (await expect(page.getByRole("slider").first()).toBeAttached());
const validatorsListReady = async (page: Page) => {
  await visible("Validators")(page);
  await slidersReady(page);
};
const validatorReady = async (page: Page) => {
  await visible("Recent validations")(page);
  await slidersReady(page);
};
const amendmentReady = async (page: Page) => {
  await visible("Votes of the UNL validators")(page);
  await slidersReady(page);
};
/** An enabled amendment is no longer voted on: its page is whole when the note in the votes card's place is drawn. */
const enabledAmendmentReady = async (page: Page) => {
  await expect(page.getByRole("region", { name: "Votes" }).getByText("An enabled amendment is no longer voted on.")).toBeVisible();
};
const checkEveryTable = async (page: Page) => {
  for (const radio of await page.getByRole("radio", { name: "Table" }).all()) await radio.check();
  await expect(page.locator(".chart__table").first()).toBeVisible();
};

const VERIFIED_VALIDATOR = async (page: Page) => (await listedValidator(page, "verified")).href;
const MAJORITY_AMENDMENT = async (page: Page) => (await listedAmendment(page, "majority"))?.href ?? null;

const VALIDATORS_MAIN: ValidatorsPageUnderTest[] = [
  { name: "validators", path: "/xrpl/validators", ready: validatorsListReady },
  { name: "a verified UNL validator", path: VERIFIED_VALIDATOR, ready: validatorReady },
  { name: "amendments", path: "/xrpl/amendments", ready: visible("Amendments") },
  { name: "the amendment with a majority", path: MAJORITY_AMENDMENT, ready: amendmentReady },
];

const VALIDATORS_MORE: ValidatorsPageUnderTest[] = [
  { name: "Xahau validators", path: "/xahau/validators", ready: validatorsListReady },
  {
    name: "validators, all, a search with no match",
    path: "/xrpl/validators?scope=all&q=no-such-validator",
    ready: async (page) => void (await expect(page.getByText("No validators match these filters.")).toBeVisible()),
  },
  // The first with no domain is one the data API has never seen: no day of agreement, so no chart.
  { name: "a validator with no domain", path: async (page) => (await listedValidator(page, "no domain")).href, ready: visible("Recent validations") },
  {
    name: "a validator's older validations",
    path: async (page) => {
      await page.goto(`/xrpl/validators/${await withHistory(page)}`);
      return page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Older" }).getAttribute("href");
    },
    ready: visible("Recent validations"),
  },
  { name: "Xahau amendments", path: "/xahau/amendments", ready: visible("Amendments") },
  { name: "an enabled amendment", path: async (page) => (await listedAmendment(page, "enabled"))?.href ?? null, ready: enabledAmendmentReady },
  { name: "an amendment of no known name", path: async (page) => (await listedAmendment(page, "unknown"))?.href ?? null, ready: visible("Votes of the UNL validators") },
  { name: "validators, every table view", path: "/xrpl/validators", ready: validatorsListReady, act: checkEveryTable },
  { name: "a validator, every table view", path: VERIFIED_VALIDATOR, ready: validatorReady, act: checkEveryTable },
  { name: "the amendment, every table view", path: MAJORITY_AMENDMENT, ready: amendmentReady, act: checkEveryTable },
  {
    name: "the amendment, its slider focused",
    path: MAJORITY_AMENDMENT,
    ready: amendmentReady,
    act: async (page) => {
      await page.getByRole("slider").first().focus();
      await expect(page.locator(".plot__tip").first()).toBeVisible();
    },
  },
  {
    name: "the amendment, the other validators' votes open",
    path: MAJORITY_AMENDMENT,
    ready: amendmentReady,
    act: async (page) => {
      await page.locator("details.amendment__others summary").click();
      await expect(page.getByRole("table", { name: "Votes of other validators" })).toBeVisible();
    },
  },
];

/** The page's path, read from the stack's pages where it is a function; where the stack has no such page, `needs` skips the test (a real stack) or fails it (the fixtures). */
async function pathOf(page: Page, under: ValidatorsPageUnderTest): Promise<PageUnderTest> {
  const path = typeof under.path === "string" ? under.path : await under.path(page);
  needs(path !== null, `page for "${under.name}"`);
  return { ...under, path: path! };
}

/** How far the page scrolls sideways: none, at any width (the tables and charts scroll inside their cards). */
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("the validators and amendments pages", () => {
  test.skip(VALIDATORS_OFF, SKIP_OFF);

  for (const viewport of VIEWPORTS) {
    test.describe(`axe at ${viewport.name}`, () => {
      for (const setting of SETTINGS) {
        test.describe(`${setting.name}`, () => {
          test.use({ viewport: viewport.size, colorScheme: setting.system });
          for (const under of [...VALIDATORS_MAIN, ...(setting.toggle === undefined ? VALIDATORS_MORE : [])]) {
            test(`${under.name} has no serious or critical violation${viewport.size.width === 375 ? ", and does not scroll sideways" : ""}`, async ({ page }) => {
              await open(page, await pathOf(page, under), setting);
              expect(await seriousViolations(page)).toEqual([]);
              if (viewport.size.width === 375) expect(await sideways(page)).toBeLessThanOrEqual(0);
            });
          }
        });
      }
    });
  }

  // The filter form is a search landmark of its own ("Filter validators"), beside the header's.
  test.describe("landmarks", () => {
    for (const under of VALIDATORS_MAIN) {
      test(`${under.name} has no two landmarks of one role and name`, async ({ page }) => {
        const resolved = await pathOf(page, under);
        await page.goto(resolved.path);
        await hydrated(page);
        await resolved.ready(page);
        const results = await new AxeBuilder({ page }).withRules(["landmark-unique"]).analyze();
        expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`)).toEqual([]);
      });
    }
  });
});

// ---- The NFT pages -------------------------------------------------------------------------------------------------------------------------
// Their spec's "Accessibility" (README "NFTs"): the list (with an issuer error, a page of more collections), the older sales, the featured XRPL collection and Xahau's with the
// day whose only sale no rate converts, an NFT in each of its modes, the account's NFTs tab and a hash's hints, on both networks, at both widths in the two system themes, and
// the four main ones in the four settings. At 375 px no page scrolls sideways (the tables and the 30-day charts scroll inside their cards). The pages with a card that failed,
// the choice between a transaction and an NFT and the Objects tab's link to the NFTs need the fixture server to change an answer, which only the `live` project may do: they are in
// nfts-live.spec.ts. Where E2E_FEATURES_OFF lists NFTS the pages are not found and the block skips itself; against a real stack, which has none of the generated NFTs, too.

const NFTS_ON = !FEATURES_OFF.has("NFTS");
const FEATURED_COLLECTION = `/xrpl/nfts/${XRPL_COLLECTION.featured.issuer}/${XRPL_COLLECTION.featured.taxon}`;
const XAHAU_OTHER_COLLECTION = `/xahau/nfts/${XAHAU_COLLECTION.other.issuer}`;

const nftListReady = async (page: Page) => {
  await visible("Collections")(page);
  await expect(page.getByRole("table", { name: "Recent sales", exact: true })).toBeVisible();
  await slidersReady(page);
};
const nftCollectionReady =
  (table = "Sales") =>
  async (page: Page) => {
    await visible(table)(page);
    await slidersReady(page);
  };
const nftReady = async (page: Page) => void (await expect(page.getByRole("table", { name: "History", exact: true })).toBeVisible());
const fromTheNetwork = async (page: Page) => void (await expect(page.getByText("Not in the index yet, shown from the network.")).toBeVisible());
const NFT_NOT_FOUND = async (page: Page) => void (await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible());

/** The hints of a hash typed into a box: the row that says what the hash can be, kept open (a click on the theme toggle would close it, so this is for the system themes). */
const hashHints = (box: (page: Page) => ReturnType<Page["getByRole"]>) => async (page: Page) => {
  await box(page).fill(XAHAU_NFT.missing);
  await expect(page.getByRole("list", { name: "Matches" }).getByRole("link")).toBeVisible();
};

const NFT_MAIN: PageUnderTest[] = [
  { name: "NFT list", path: "/xrpl/nfts", ready: nftListReady },
  {
    // The sales behind the marker of the list's "Older sales" link (nfts.spec.ts follows the link): the URL itself, so that the landmarks and names checks below, which do not run `act`, see this page.
    name: "older NFT sales",
    path: "/xrpl/nfts/sales?marker=WzEwNzg4NjE2Myw4MywxXQ",
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: "NFT sales" })).toBeVisible();
      await visible("Sales")(page);
    },
  },
  { name: "featured NFT collection", path: FEATURED_COLLECTION, ready: nftCollectionReady() },
  { name: "featured NFT", path: `/xrpl/nft/${XRPL_NFT.featured}`, ready: nftReady },
];

const NFT_MORE: PageUnderTest[] = [
  { name: "NFT list with an issuer that is no address", path: "/xrpl/nfts?issuer=nope", ready: async (page) => void (await expect(page.getByText("Write a classic address (r…).")).toBeVisible()) },
  {
    // Show on an issuer that is no address, in the page: the message is an alert and the field keeps the focus.
    name: "NFT list, an issuer that is no address shown with Enter",
    path: "/xrpl/nfts",
    ready: nftListReady,
    act: async (page) => {
      const field = page.getByRole("searchbox", { name: "Collections of an issuer" });
      await field.fill("nope");
      await field.press("Enter");
      await expect(page.getByRole("alert").filter({ hasText: "Write a classic address (r…)." })).toBeVisible();
      await expect(field).toBeFocused();
    },
  },
  { name: "NFT list for 30 days", path: "/xrpl/nfts?period=30day", ready: nftListReady },
  { name: "NFT list sorted by holders, smallest first", path: "/xrpl/nfts?sort=holders&order=asc", ready: nftListReady },
  {
    name: "NFT list, more collections",
    path: "/xrpl/nfts",
    ready: nftListReady,
    act: async (page) => {
      await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "More collections" }).click();
      await page.waitForURL((url) => url.pathname === "/xrpl/nfts" && url.searchParams.has("marker"));
      await expect(page.getByRole("heading", { level: 1, name: "More NFT collections" })).toBeVisible();
      await visible("Collections")(page);
    },
  },
  { name: "Xahau URIToken list", path: "/xahau/nfts", ready: nftListReady },
  { name: "NFT list, every table view", path: "/xrpl/nfts", ready: nftListReady, act: checkEveryTable },
  {
    name: "NFT list, the volume slider focused",
    path: "/xrpl/nfts",
    ready: nftListReady,
    act: async (page) => {
      await page.locator('section[aria-labelledby="nft-volume-title"]').getByRole("slider").focus();
      await expect(page.locator('section[aria-labelledby="nft-volume-title"] .plot__tip')).toBeVisible();
    },
  },
  { name: "NFT collection, Sales measure", path: `${FEATURED_COLLECTION}?measure=sales`, ready: nftCollectionReady() },
  { name: "NFT collection, NFTs", path: `${FEATURED_COLLECTION}?tab=nfts`, ready: nftCollectionReady("NFTs") },
  { name: "NFT collection, NFTs held by one account, burned included", path: `${FEATURED_COLLECTION}?tab=nfts&burned=1`, ready: nftCollectionReady("NFTs") },
  { name: "NFT collection, Holders", path: `${FEATURED_COLLECTION}?tab=holders`, ready: nftCollectionReady("Holders") },
  {
    name: "NFT collection, an owner that is no address",
    path: `${FEATURED_COLLECTION}?tab=nfts&owner=nope`,
    ready: async (page) => void (await expect(page.getByText("Write a classic address (r…).")).toBeVisible()),
  },
  {
    // Show on an owner that is no address, in the page: the message is an alert and the button keeps the focus.
    name: "NFT collection, an owner that is no address shown with the button",
    path: `${FEATURED_COLLECTION}?tab=nfts`,
    ready: nftCollectionReady("NFTs"),
    act: async (page) => {
      await page.getByRole("searchbox", { name: "Held by an account" }).fill("nope");
      await page.getByRole("button", { name: "Show" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Write a classic address (r…)." })).toBeVisible();
      await expect(page.getByRole("button", { name: "Show" })).toBeFocused();
    },
  },
  {
    name: "NFT collection, older sales",
    path: FEATURED_COLLECTION,
    ready: nftCollectionReady(),
    act: async (page) => {
      await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Older" }).click();
      await page.waitForURL((url) => url.pathname === FEATURED_COLLECTION && url.searchParams.has("marker"));
      await expect(page.getByRole("link", { name: "Back to the collection" })).toBeVisible();
    },
  },
  { name: "NFT collection, every table view", path: FEATURED_COLLECTION, ready: nftCollectionReady(), act: checkEveryTable },
  { name: "Xahau URIToken collection whose only sale no rate converts", path: XAHAU_OTHER_COLLECTION, ready: nftCollectionReady() },
  { name: "Xahau URIToken collection", path: `/xahau/nfts/${XAHAU_COLLECTION.featured.issuer}?tab=nfts`, ready: nftCollectionReady("URITokens") },
  { name: "NFT collection that does not exist", path: `/xrpl/nfts/${XRPL_COLLECTION.quiet.issuer}/4294967295`, ready: NFT_NOT_FOUND },
  {
    name: "NFT with its offer events",
    path: `/xrpl/nft/${XRPL_NFT.featured}?offers=1`,
    ready: nftReady,
  },
  {
    name: "NFT, older history",
    path: `/xrpl/nft/${XRPL_NFT.featured}?offers=1`,
    ready: nftReady,
    act: async (page) => {
      await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Older" }).click();
      await page.waitForURL((url) => url.searchParams.has("marker"));
      await expect(page.getByRole("link", { name: "Back to the NFT" })).toBeVisible();
    },
  },
  { name: "burned NFT", path: `/xrpl/nft/${XRPL_NFT.burned}`, ready: nftReady },
  { name: "NFT whose owner the network says", path: `/xrpl/nft/${XRPL_NFT.unowned}`, ready: nftReady },
  { name: "NFT only the network has", path: `/xrpl/nft/${XRPL_NFT.network}`, ready: fromTheNetwork },
  { name: "burned NFT only the network has", path: `/xrpl/nft/${XRPL_NFT.networkBurned}`, ready: fromTheNetwork },
  { name: "NFT nobody has", path: `/xrpl/nft/${XRPL_NFT.missing}`, ready: NFT_NOT_FOUND },
  { name: "Xahau URIToken", path: `/xahau/nft/${XAHAU_NFT.featured}`, ready: nftReady },
  { name: "Xahau URIToken only the network has", path: `/xahau/nft/${XAHAU_NFT.network}`, ready: fromTheNetwork },
  { name: "Xahau URIToken nobody has", path: `/xahau/nft/${XAHAU_NFT.missing}`, ready: NFT_NOT_FOUND },
  {
    name: "account's NFTs",
    path: `/xrpl/account/${XRPL_ACCOUNT}?tab=nfts`,
    ready: async (page) => void (await expect(page.getByRole("table", { name: "NFTs", exact: true })).toBeVisible()),
  },
  {
    name: "Xahau account's URITokens",
    path: `/xahau/account/${XAHAU_ACCOUNT}?tab=nfts`,
    ready: async (page) => void (await expect(page.getByRole("table", { name: "URITokens", exact: true })).toBeVisible()),
  },
  {
    // The header's box on a page, with the hash of an NFT typed into it: the row of the hint says what a hash can be, over the page.
    name: "hash hint in the header, XRPL",
    path: "/xrpl/nfts",
    ready: nftListReady,
    act: hashHints((page) => page.getByRole("banner").getByRole("searchbox", { name: "Search XRPL" })),
  },
  {
    name: "hash hint in the hero, Xahau",
    path: "/xahau",
    ready: visible("Latest ledgers"),
    act: hashHints((page) => page.getByRole("main").getByRole("searchbox", { name: "Search Xahau" })),
  },
  {
    name: "search help with NFTs on",
    path: "/xahau/search?q=",
    ready: async (page) => void (await expect(page.getByText(`Enter an address, a ${hashWords("xahau", true)} hash, a ledger index or a CTID.`)).toBeVisible()),
  },
  {
    name: "search for a hash nothing has",
    path: `/xrpl/search?q=${XRPL_NFT.missing}`,
    ready: async (page) => void (await expect(page.getByRole("main")).toContainText(hashWords("xrpl", true))),
  },
];

test.describe("the NFT pages", () => {
  test.skip(!NFTS_ON, "NFTS is off in the Worker under test: its pages are not found (nfts.spec.ts checks that)");
  test.skip(LIVE, "the pages are drawn from the generated NFT fixtures, which a real stack does not hold");

  for (const viewport of VIEWPORTS) {
    test.describe(`axe at ${viewport.name}`, () => {
      for (const setting of SETTINGS) {
        test.describe(`${setting.name}`, () => {
          test.use({ viewport: viewport.size, colorScheme: setting.system });
          for (const under of [...NFT_MAIN, ...(setting.toggle === undefined ? NFT_MORE : [])]) {
            test(`${under.name} has no serious or critical violation${viewport.size.width === 375 ? ", and does not scroll sideways" : ""}`, async ({ page }) => {
              await open(page, under, setting);
              expect(await seriousViolations(page)).toEqual([]);
              if (viewport.size.width === 375) expect(await sideways(page)).toBeLessThanOrEqual(0);
            });
          }
        });
      }
    });
  }

  // The rows of a hint wrap rather than overflow (components.css, `.search__hints .hit`): the hash of the longest tag ("Transaction, ledger or URIToken") has room at the narrowest
  // phone, and the hint sits inside the viewport.
  for (const width of [375, 320]) {
    test(`a hint of a hash fits a ${width} px phone on both networks, in the header and in the hero`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      for (const [path, banner, network] of [
        ["/xrpl/nfts", true, "XRPL"],
        ["/xrpl", false, "XRPL"],
        ["/xahau/nfts", true, "Xahau"],
        ["/xahau", false, "Xahau"],
      ] as const) {
        await page.goto(path);
        await hydrated(page);
        await page.getByRole(banner ? "banner" : "main").getByRole("searchbox", { name: `Search ${network}` }).fill(XAHAU_NFT.missing);
        await expect(page.getByRole("list", { name: "Matches" }).getByRole("link")).toBeVisible();
        const fit = await page.evaluate(() => {
          const row = document.querySelector(".search__hints .hit") as HTMLElement;
          const box = row.getBoundingClientRect();
          return {
            page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            row: row.scrollWidth - row.clientWidth,
            outside: [...row.children].filter((child) => child.getBoundingClientRect().right > box.right + 0.5).length,
            detail: (row.querySelector(".hit__detail") as HTMLElement).clientWidth,
            right: box.right,
          };
        });
        expect(fit.page, `${network} ${path}: the page scrolls sideways`).toBeLessThanOrEqual(0);
        expect(fit.row, `${network} ${path}: the hint's row is wider than itself`).toBeLessThanOrEqual(0);
        expect(fit.outside, `${network} ${path}: a part of the hint is outside it`).toBe(0);
        expect(fit.right, `${network} ${path}: the hint is outside the viewport`).toBeLessThanOrEqual(width);
        expect(fit.detail, `${network} ${path}: the hash is cut to ${fit.detail}px`).toBeGreaterThanOrEqual(128);
      }
    });
  }

  test.describe("landmarks", () => {
    for (const under of NFT_MAIN) {
      test(`${under.name} has no two landmarks of one role and name`, async ({ page }) => {
        await page.goto(under.path);
        await hydrated(page);
        await under.ready(page);
        const results = await new AxeBuilder({ page }).withRules(["landmark-unique"]).analyze();
        expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`)).toEqual([]);
      });
    }
  });

  test.describe("names", () => {
    for (const under of NFT_MAIN) {
      test(`${under.name}: nothing is given a name it cannot have`, async ({ page }) => {
        await page.goto(under.path);
        await hydrated(page);
        await under.ready(page);
        const results = await new AxeBuilder({ page }).withRules(["aria-prohibited-attr", "aria-allowed-attr", "aria-allowed-role"]).analyze();
        const found = [...results.violations, ...results.incomplete].map((rule) => `${rule.id}: ${rule.nodes.map((node) => node.target.join(" ")).join(" | ")}`);
        expect(found).toEqual([]);
      });
    }
  });
});

// ---- The ledger object pages and the Delegation tab ------------------------------------------------------------------------------------------
// An escrow's page (ledger object pages spec 4.1 and 4.2): one that can be cancelled, whose Pending window is an hour on a bar of two weeks, so that axe's target-size runs on the window
// bar's narrowest button (24 px, 44 px on a phone), the same with a window's tooltip shown, and a finished one with the removed banner and its links. A check's page (4.3): one that expired
// and is still in the ledger, with its banner and its flow, and a cashed one, removed, whose history the index starts late. A channel's page (4.4): one that is closing, with its deposit bar,
// a closed one, removed, and the long one's second page of events (its Newer and Older). The account's Delegation tab (6.1) with its two lists. Each at both widths, in the two system
// themes (the objects are the fixtures' cases, test/e2e/object-pages.ts); at 375 px no page scrolls sideways. Where E2E_FEATURES_OFF lists LEDGER_OBJECTS the pages are not found, and where it
// lists DELEGATION the tab is the "soon" label: each block skips itself (the specs of the pages check that); against a real stack, which has none of the generated objects, too.

const LEDGER_OBJECTS_ON = !FEATURES_OFF.has("LEDGER_OBJECTS");
const DELEGATION_ON = !FEATURES_OFF.has("DELEGATION");
const windowBar = (page: Page) => page.getByRole("group", { name: "When the escrow can be finished or cancelled" });
const escrowReady = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1, name: "Escrow" })).toBeVisible();
  await expect(windowBar(page)).toBeVisible();
};
/** A check's or a channel's page is whole when its `<h1>` and its figure (the flow, the deposit bar) are drawn. */
const figureReady = (title: string, figure: string) => async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("group", { name: figure })).toBeVisible();
};
const objectPath = (segment: string, which: ObjectCase) => `/xrpl/${segment}/${objectCase("xrpl", which).id}`;

const ESCROW_PAGES: PageUnderTest[] = [
  { name: "escrow that can be cancelled", path: `/xrpl/escrows/${XRPL_ESCROW.cancellable}`, ready: escrowReady },
  {
    name: "escrow that can be cancelled, its shortest window focused",
    path: `/xrpl/escrows/${XRPL_ESCROW.cancellable}`,
    ready: escrowReady,
    act: async (page) => {
      await windowBar(page).getByRole("button", { name: /^Pending: / }).focus();
      await expect(windowBar(page).locator(".wbar__tip")).toBeVisible();
    },
  },
  {
    name: "finished escrow",
    path: `/xrpl/escrows/${XRPL_ESCROW.finished}`,
    ready: async (page) => {
      await escrowReady(page);
      await expect(page.getByText(/^Removed from the ledger in ledger/)).toBeVisible();
    },
  },
];

const CHECK_PAGES: PageUnderTest[] = [
  {
    name: "check that expired and is still in the ledger",
    path: objectPath("checks", "check-expired"),
    ready: async (page) => {
      await figureReady("Check", "Flow of the check")(page);
      await expect(page.getByText("Expired, but still in the ledger")).toBeVisible();
    },
  },
  {
    name: "cashed check",
    path: objectPath("checks", "check-cashed"),
    ready: async (page) => {
      await figureReady("Check", "Flow of the check")(page);
      await expect(page.getByText(/^Removed from the ledger in ledger/)).toBeVisible();
    },
  },
];

const CHANNEL_PAGES: PageUnderTest[] = [
  { name: "channel that is closing", path: objectPath("payment-channels", "channel-closing"), ready: figureReady("Payment channel", "Deposit paid out and left") },
  {
    name: "closed channel",
    path: objectPath("payment-channels", "channel-closed"),
    ready: async (page) => {
      await figureReady("Payment channel", "Deposit paid out and left")(page);
      await expect(page.getByText(/^Removed from the ledger in ledger/)).toBeVisible();
    },
  },
  {
    name: "channel's second page of events",
    path: `${objectPath("payment-channels", "channel-long")}?marker=${objectCase("xrpl", "channel-long").markers![0]}`,
    ready: figureReady("Payment channel", "Deposit paid out and left"),
  },
];

/** The Delegation tab is whole when its two lists have streamed in (nothing in it is `aria-busy` and both tables are drawn). */
const DELEGATION_TAB: PageUnderTest[] = [
  {
    name: "account's Delegation tab",
    path: `/xrpl/account/${XRPL_ACCOUNT}?tab=delegation`,
    ready: async (page) => {
      await expect(page.getByRole("table", { name: "Permissions given" })).toBeVisible();
      await expect(page.getByRole("table", { name: "Permissions held" })).toBeVisible();
      await expect(page.locator(".delegation__section [aria-busy]")).toHaveCount(0);
    },
  },
];

/** A transaction's page is whole when its raw data's tabs are drawn. */
const rawReady = async (page: Page) => void (await expect(page.getByRole("tablist", { name: "Raw data" })).toBeVisible());

/**
 * The transactions with a link in their words (ledger object pages spec 6.2 and 7): the escrow an EscrowFinish released, in its sentence; "View the delegation" in a delegated Payment's Sent by
 * row; a DelegateSet's permission chips, its Delegate and its note. A link in words is told from them by more than its colour (WCAG 1.4.1), which the plain payment of `MAIN` cannot show.
 */
const TRANSACTION_PAGES: PageUnderTest[] = [
  { name: "EscrowFinish", path: `/xrpl/tx/${removedBy("xrpl", "escrow-finished")!.hash}`, ready: rawReady },
  { name: "delegated Payment", path: `/xrpl/tx/${objectCase("xrpl", "delegated-payment").id}`, ready: rawReady },
  { name: "DelegateSet", path: `/xrpl/tx/${recordedDelegateSet().id}`, ready: rawReady },
];

/**
 * Axe at both widths in the two system themes (a phone's page not scrolling sideways), the landmarks of one role and name, and the names nothing is given that it cannot have, for `pages`.
 * With `toggles` the two themes chosen with the toggle are run too (the pages the spec names in the four settings).
 */
function matrixOf(pages: PageUnderTest[], { toggles = false }: { toggles?: boolean } = {}): void {
  for (const viewport of VIEWPORTS) {
    test.describe(`axe at ${viewport.name}`, () => {
      for (const setting of SETTINGS.filter((candidate) => toggles || candidate.toggle === undefined)) {
        test.describe(`${setting.name}`, () => {
          test.use({ viewport: viewport.size, colorScheme: setting.system });
          for (const under of pages) {
            test(`${under.name} has no serious or critical violation${viewport.size.width === 375 ? ", and does not scroll sideways" : ""}`, async ({ page }) => {
              await open(page, under, setting);
              expect(await seriousViolations(page)).toEqual([]);
              if (viewport.size.width === 375) expect(await sideways(page)).toBeLessThanOrEqual(0);
            });
          }
        });
      }
    });
  }

  test.describe("landmarks", () => {
    for (const under of pages) {
      test(`${under.name} has no two landmarks of one role and name`, async ({ page }) => {
        await page.goto(under.path);
        await hydrated(page);
        await under.ready(page);
        const results = await new AxeBuilder({ page }).withRules(["landmark-unique"]).analyze();
        expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`)).toEqual([]);
      });
    }
  });

  // axe reports a name on an element that cannot have one (a permission chip's `title` is no name; a bar's buttons have theirs) not as a violation but as "needs review".
  test.describe("names", () => {
    for (const under of pages) {
      test(`${under.name}: nothing is given a name it cannot have`, async ({ page }) => {
        await page.goto(under.path);
        await hydrated(page);
        await under.ready(page);
        const results = await new AxeBuilder({ page }).withRules(["aria-prohibited-attr", "aria-allowed-attr", "aria-allowed-role"]).analyze();
        const found = [...results.violations, ...results.incomplete].map((rule) => `${rule.id}: ${rule.nodes.map((node) => node.target.join(" ")).join(" | ")}`);
        expect(found).toEqual([]);
      });
    }
  });
}

test.describe("the ledger object pages", () => {
  test.skip(!LEDGER_OBJECTS_ON, "LEDGER_OBJECTS is off in the Worker under test: its pages are not found (ledger-objects.spec.ts checks that)");
  test.skip(LIVE, "the pages are drawn from the generated object fixtures, which a real stack does not hold");
  matrixOf([...ESCROW_PAGES, ...CHECK_PAGES, ...CHANNEL_PAGES]);
});

test.describe("the transactions with a link in their words", () => {
  test.skip(LIVE, "the delegated Payment is synthetic, and the others are found in the fixtures' files");
  matrixOf(TRANSACTION_PAGES);
});

test.describe("the account's Delegation tab", () => {
  test.skip(!DELEGATION_ON, "DELEGATION is off in the Worker under test: the tab is the 'soon' label (delegation.spec.ts checks that)");
  test.skip(LIVE, "the tab is drawn from the hand-written delegation files of the fixtures, which a real stack does not hold");
  matrixOf(DELEGATION_TAB);
});

// ---- The token pages -----------------------------------------------------------------------------------------------------------------------------------------
// The token list and a token's page (E11 spec "Accessibility"): the list and RLUSD's page at both widths in the four settings of the theme, no sideways scroll at 375 px; then, in the two system
// themes at both widths, the list searched, with all its tokens, behind a marker, with a search too long to ask, and Xahau's; a token's page in each of its states (the toml that does not list
// the token, no domain with the settings read from the network, few holders and empty cards, the transfers behind a marker, Xahau's EVR); the holders page (a first page with a frozen line, a
// page behind a marker, a Xahau token's with the Authorized lines); and the not-found page. The tokens are the fixtures' cases (test/e2e/token-pages.ts). Where E2E_FEATURES_OFF lists TOKENS
// the pages are not found, and against a real stack, which has none of the generated tokens, the block skips itself.

const TOKENS_ON = !FEATURES_OFF.has("TOKENS");
const TOKEN_ISSUED = visible("Issued tokens");
/** A token's page is whole when its `<h1>` and its transfers are drawn (every card is the server's: nothing streams in). */
const tokenReady = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await visible("Recent transfers")(page);
};
const tokenPath = (net: "xrpl" | "xahau", which: Parameters<typeof tokenCase>[1]) => `/${net}/token/${tokenCase(net, which).path}`;

const TOKEN_MAIN: PageUnderTest[] = [
  { name: "token list", path: "/xrpl/tokens", ready: TOKEN_ISSUED },
  { name: "token (RLUSD)", path: tokenPath("xrpl", "rlusd"), ready: tokenReady },
];

const TOKEN_MORE: PageUnderTest[] = [
  { name: "token list, a search", path: "/xrpl/tokens?q=USD", ready: TOKEN_ISSUED },
  { name: "token list, all the tokens", path: "/xrpl/tokens?all=1", ready: TOKEN_ISSUED },
  { name: "token list, behind a marker", path: `/xrpl/tokens?marker=${listOf("xrpl").marker!}`, ready: TOKEN_ISSUED },
  {
    // A search of more than 64 characters is not asked: the field and its message are the page.
    name: "token list, a search too long to ask",
    path: `/xrpl/tokens?q=${"x".repeat(65)}`,
    ready: async (page) => void (await expect(page.getByRole("alert").filter({ hasText: "Search for at most 64 characters" })).toBeVisible()),
  },
  { name: "Xahau token list", path: "/xahau/tokens", ready: TOKEN_ISSUED },
  { name: "token whose domain's toml does not list it (USD)", path: tokenPath("xrpl", "usd"), ready: tokenReady },
  { name: "token with no domain, its settings read from the network (LIONS)", path: tokenPath("xrpl", "lions"), ready: tokenReady },
  { name: "token with few holders and empty cards (TIN)", path: tokenPath("xrpl", "few-holders"), ready: tokenReady },
  {
    // The transfers behind a marker: the header, the way back and the transfers.
    name: "token, older transfers",
    path: `/xrpl/token/${transfersMarker("xrpl").token}?marker=${transfersMarker("xrpl").marker}`,
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await visible("Older transfers")(page);
    },
  },
  { name: "Xahau token (EVR)", path: tokenPath("xahau", "evr"), ready: tokenReady },
  { name: "holders of a token, with a frozen line", path: `${tokenPath("xrpl", "rlusd")}/holders`, ready: visible("Holders") },
  { name: "holders of a token, behind a marker", path: `/xrpl/token/${holdersMarker("xrpl").token}/holders?marker=${holdersMarker("xrpl").marker}`, ready: visible("Holders") },
  { name: "holders of a Xahau token, with Authorized lines", path: `${tokenPath("xahau", "xahau-unlisted")}/holders`, ready: visible("Holders") },
  {
    name: "token the index does not know",
    path: `/xrpl/token/QQQ.${tokenCase("xrpl", "usd").issuer}`,
    ready: async (page) => void (await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible()),
  },
];

test.describe("the token pages", () => {
  test.skip(!TOKENS_ON, "TOKENS is off in the Worker under test: its pages are not found (tokens.spec.ts checks that)");
  test.skip(LIVE, "the pages are drawn from the generated token fixtures, which a real stack does not hold");
  matrixOf(TOKEN_MAIN, { toggles: true });
  matrixOf(TOKEN_MORE);
});
