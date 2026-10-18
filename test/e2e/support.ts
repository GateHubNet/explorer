import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

export { expect };

let visitors = 0;

/**
 * `test` with two things added to what every test gets:
 *
 * - a visitor address of its own. The Worker limits a visitor to 60 renders in 10 s (spec 4); without an address every request of the
 *   suite is the same "unknown" visitor, and a fast run would be refused for being busy. `CF-Connecting-IP` is what Cloudflare's edge
 *   puts on a request, and the local runtime takes it as it comes. Against a deployed Worker the edge sets it itself, so the suite
 *   then shares the machine's address (run it with E2E_WORKERS=1).
 * - a check at the end that the browser's console had no error and the page no uncaught exception: a hydration mismatch, a script that
 *   throws, a request that fails. A test that means to cause one says `test.use({ allowConsoleErrors: true })`.
 */
export const test = base.extend<{ allowConsoleErrors: boolean; consoleErrors: void }>({
  allowConsoleErrors: [false, { option: true }],
  extraHTTPHeaders: async ({}, use, testInfo) => {
    visitors += 1;
    await use({ "CF-Connecting-IP": `2001:db8:${testInfo.workerIndex.toString(16)}::${visitors.toString(16)}` });
  },
  consoleErrors: [
    async ({ page, allowConsoleErrors }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`uncaught: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        // The browser logs every response with an error status. A page that answers 404 (a thing that is not there) or 503 says so in
        // its own tests; a file of the build that is missing is not a page, and is an error.
        const failed = /^Failed to load resource/.test(message.text());
        if (failed && !new URL(message.location().url || "about:blank", "http://x").pathname.startsWith("/assets/")) return;
        errors.push(`console.error: ${message.text()} ${message.location().url}`.trim());
      });
      await use();
      if (!allowConsoleErrors) expect(errors, "what the browser's console said").toEqual([]);
    },
    { auto: true },
  ],
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
