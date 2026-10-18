import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { LIVE, NEVER_FUNDED, NO_SUCH_TRANSACTION, XAHAU_ACCOUNT, XAHAU_LEDGER, XRPL_ACCOUNT, XRPL_HEAD_LEDGER, XRPL_LEDGER, XRPL_PAYMENT } from "./fixtures";
import { expect, hydrated, seriousViolations, test, WCAG_TAGS } from "./support";

// Spec 12: axe (WCAG 2.2 AA: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) reports no serious or critical violation on the home,
// ledger, transaction, account and 404 pages, in light and in dark, on a desktop and on a 375 px phone. Dark is reached both ways it
// can be: the system's (`prefers-color-scheme`) and the visitor's (the theme toggle, which wins over the system).

type Theme = "light" | "dark";

interface PageUnderTest {
  name: string;
  path: string;
  /** What shows that the page is whole: the lists a streamed page draws last. */
  ready: (page: Page) => Promise<void>;
}

const visible = (name: string) => async (page: Page) => {
  await expect(page.getByRole("table", { name })).toBeVisible();
};

/** The pages the spec names, and the matrix below runs all of them in every setting. */
const MAIN: PageUnderTest[] = [
  { name: "home", path: "/xrpl", ready: visible("Latest ledgers") },
  { name: "ledger", path: `/xahau/ledger/${XAHAU_LEDGER}`, ready: visible("Transactions") },
  { name: "transaction", path: `/xrpl/tx/${XRPL_PAYMENT}`, ready: async (page) => void (await expect(page.getByRole("tablist", { name: "Raw data" })).toBeVisible()) },
  { name: "account", path: `/xrpl/account/${XRPL_ACCOUNT}`, ready: visible("Transactions") },
  { name: "404", path: "/xrpl/nothing-here", ready: async (page) => void (await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible()) },
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
  for (const under of [MORE[0]!, ...MAIN.slice(0, 4), ...MORE.filter((page) => page.name.startsWith("newest ledger"))]) {
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
