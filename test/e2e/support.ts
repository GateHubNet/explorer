import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type BrowserContextOptions, expect, test as base, type Page } from "@playwright/test";

import { isExpectedConsoleError } from "../../scripts/e2e-env";

export { expect };

let visitors = 0;

/** Listens to a page for what the console logged as an error and for exceptions nobody caught, into `errors`. */
function watch(page: Page, errors: string[]): void {
  page.on("pageerror", (error) => errors.push(`uncaught: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const { url } = message.location();
    if (isExpectedConsoleError({ text: message.text(), url })) return;
    errors.push(`console.error: ${message.text()} ${url}`.trim());
  });
}

/**
 * `test` with these added to what every test gets:
 *
 * - a visitor address of its own. The Worker limits a visitor to 60 renders in 10 s (spec 4); without an address every request of the
 *   suite is the same "unknown" visitor, and a fast run would be refused for being busy. `CF-Connecting-IP` is what Cloudflare's edge
 *   puts on a request, and the local runtime takes it as it comes. Against a deployed Worker the edge sets it itself, so the suite
 *   then shares the machine's address (run it with E2E_WORKERS=1).
 * - a check at the end that the browser's console had no error and no page an uncaught exception: a hydration mismatch, a script that
 *   throws, a request that fails, a file of the build that is missing, a page that answers 5xx. The one answer that is let through is a
 *   404 for a page that is not there (`isExpectedConsoleError`). A test that means to cause an error says
 *   `test.use({ allowConsoleErrors: true })`.
 * - `contextFor(options)`: a browser context for a test that needs one of its own (a stored theme, scripts off, a storage that throws),
 *   with the test's visitor address, the same base URL and the same check on every page it opens. It is closed with the test. A test
 *   does not call `browser.newContext()`, which has neither.
 */
export const test = base.extend<{
  allowConsoleErrors: boolean;
  browserErrors: string[];
  consoleErrors: void;
  contextFor: (options?: BrowserContextOptions) => Promise<BrowserContext>;
}>({
  allowConsoleErrors: [false, { option: true }],
  extraHTTPHeaders: async ({}, use, testInfo) => {
    visitors += 1;
    await use({ "CF-Connecting-IP": `2001:db8:${testInfo.workerIndex.toString(16)}::${visitors.toString(16)}` });
  },
  browserErrors: async ({}, use) => {
    await use([]);
  },
  consoleErrors: [
    async ({ page, browserErrors, allowConsoleErrors }, use) => {
      watch(page, browserErrors);
      await use();
      if (!allowConsoleErrors) expect(browserErrors, "what the browser's console said").toEqual([]);
    },
    { auto: true },
  ],
  contextFor: async ({ browser, baseURL, extraHTTPHeaders, browserErrors }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({ baseURL, extraHTTPHeaders, ...options });
      context.on("page", (page) => watch(page, browserErrors));
      contexts.push(context);
      return context;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

/** Waits for the page to be live: React Router has hydrated it (the theme toggle sets `aria-pressed` in an effect). */
export async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", /^(true|false)$/);
}

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The accessibility violations of the page as it is, with axe's WCAG 2.2 AA rules, worse than "moderate", one line each. */
export async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.impact} ${violation.id}: ${violation.help} -> ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`);
}
