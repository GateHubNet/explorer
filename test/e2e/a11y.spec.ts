import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { fixtures, unavailable } from "./fixture-control";
import { LIVE, NEVER_FUNDED, NO_SUCH_TRANSACTION, XAHAU_ACCOUNT, XAHAU_LEDGER, XRPL_ACCOUNT, XRPL_HEAD_LEDGER, XRPL_LEDGER, XRPL_PAYMENT } from "./fixtures";
import { expect, hydrated, seriousViolations, test, WCAG_TAGS } from "./support";
import { listedAmendment, listedValidator, SKIP_OFF, VALIDATORS_OFF, withHistory } from "./validators-pages";

// Spec 12: axe (WCAG 2.2 AA: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) reports no serious or critical violation on the home,
// ledger, transaction, account, network and 404 pages, in light and in dark, on a desktop and on a 375 px phone. Dark is reached both ways it
// can be: the system's (`prefers-color-scheme`) and the visitor's (the theme toggle, which wins over the system).

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

/** The pages the spec names, and the matrix below runs all of them in every setting. */
const MAIN: PageUnderTest[] = [
  { name: "home", path: "/xrpl", ready: visible("Latest ledgers") },
  { name: "ledger", path: `/xahau/ledger/${XAHAU_LEDGER}`, ready: visible("Transactions") },
  { name: "transaction", path: `/xrpl/tx/${XRPL_PAYMENT}`, ready: async (page) => void (await expect(page.getByRole("tablist", { name: "Raw data" })).toBeVisible()) },
  { name: "account", path: `/xrpl/account/${XRPL_ACCOUNT}`, ready: visible("Transactions") },
  { name: "404", path: "/xrpl/nothing-here", ready: async (page) => void (await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible()) },
  NETWORK,
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
  for (const under of [MORE[0]!, ...MAIN.slice(0, 4), NETWORK, ...MORE.filter((page) => page.name.startsWith("newest ledger"))]) {
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

// A network page with a card that could not be loaded: its error, its Retry button and the rest of the page beside it. The fixture server is
// made to fail one call, and what it answers shows in every page the Worker renders meanwhile; these tests run in the `chromium` project with the
// others, so the call is one that no other spec asks for (`stats/type` of the 7 days on XRPL: the other specs open the 30 days, the year and USD,
// and the `live` project runs alone, after them), the four tests of the group run one after another in one worker, and the override is taken away
// when the last of them is done.
const TYPES_SEVEN_DAYS = "GET /v2/stats/type?end=2026-10-17&interval=day&limit=1000&start=2026-10-11";

test.describe("a network page with a card that failed", () => {
  test.skip(LIVE, "fails a call of the fixture server: it needs the fixture server of the stack, not a real stack or a deployed Worker");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await fixtures.override({ [TYPES_SEVEN_DAYS]: unavailable() });
  });
  test.afterAll(async () => {
    await fixtures.reset();
  });

  const failed: PageUnderTest = {
    name: "network, a card that failed",
    path: "/xrpl/network?period=7d",
    ready: async (page) => {
      await expect(page.getByText("Couldn’t load transactions by type")).toBeVisible();
      await expect(page.getByRole("slider").first()).toBeAttached();
    },
  };

  for (const viewport of VIEWPORTS) {
    for (const setting of SETTINGS.filter((candidate) => candidate.toggle === undefined)) {
      test.describe(`${viewport.name}, ${setting.name}`, () => {
        test.use({ viewport: viewport.size, colorScheme: setting.system });
        test(`${failed.name} has no serious or critical violation`, async ({ page }) => {
          await open(page, failed, setting);
          expect(await seriousViolations(page)).toEqual([]);
        });
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
  { name: "an enabled amendment", path: async (page) => (await listedAmendment(page, "enabled"))?.href ?? null, ready: visible("Votes of the UNL validators") },
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

/** The page's path, read from the stack's pages where it is a function; the test is skipped where the stack has no such page. */
async function pathOf(page: Page, under: ValidatorsPageUnderTest): Promise<PageUnderTest> {
  const path = typeof under.path === "string" ? under.path : await under.path(page);
  test.skip(path === null, `the stack under test has no page for "${under.name}"`);
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
