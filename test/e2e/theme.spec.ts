import type { BrowserContext, Page } from "@playwright/test";

import { expect, hydrated, test } from "./support";

// Light by default, dark when the system is dark, unless the visitor chose with the toggle (stored in localStorage). The page is
// stored once for everybody, so the server cannot name a theme: a script in <head> puts the stored choice on <html data-theme> before
// the stylesheet is applied. "No flash" means the first frame already has the theme the visitor chose.

const stored = (baseURL: string, theme: "light" | "dark") => ({
  cookies: [],
  origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: "theme", value: theme }] }],
});

const dataTheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** The page with no script of its own running: React cannot set anything, only what is in the HTML can. */
async function withoutScripts(context: BrowserContext): Promise<void> {
  await context.route("**/assets/*.js", (route) => route.abort());
}

test.describe("the theme", () => {
  test("is not in the stored HTML, and the script that applies the choice comes before the stylesheet and blocks parsing", async ({ request }) => {
    const html = await (await request.get("/xrpl")).text();
    // One page for everybody: <html> has no theme.
    expect(html).toMatch(/<html lang="en"[^>]*>/);
    expect(html.match(/<html[^>]*>/)![0]).not.toContain("data-theme");

    const stylesheet = html.search(/<link rel="stylesheet"/);
    const script = html.search(/<script>try\{var t=localStorage\.getItem\("theme"\)/);
    expect(stylesheet).toBeGreaterThan(0);
    expect(script, "the theme script is in the head as a plain inline script (not async, deferred or a module)").toBeGreaterThan(0);
    expect(script).toBeLessThan(stylesheet);
    expect(script).toBeLessThan(html.indexOf("<body"));
    expect(html.slice(script, html.indexOf("</script>", script))).toContain("document.documentElement.dataset.theme=t");
  });

  test.describe("before any script of the page has run", () => {
    test.use({ allowConsoleErrors: true });

    test("a stored dark choice is on <html> in the first frame, and paints as the system's dark does", async ({ browser, baseURL }) => {
      const chosen = await browser.newContext({ baseURL, colorScheme: "light", storageState: stored(baseURL!, "dark") });
      await withoutScripts(chosen);
      const chosenPage = await chosen.newPage();
      await chosenPage.goto("/xrpl");
      expect(await dataTheme(chosenPage)).toBe("dark");
      const darkByChoice = await background(chosenPage);
      await chosen.close();

      // The system is dark and nobody has chosen: what a dark first frame looks like.
      const system = await browser.newContext({ baseURL, colorScheme: "dark" });
      await withoutScripts(system);
      const systemPage = await system.newPage();
      await systemPage.goto("/xrpl");
      expect(await dataTheme(systemPage)).toBeNull();
      const darkBySystem = await background(systemPage);
      await system.close();

      // The system is light and nobody has chosen.
      const plain = await browser.newContext({ baseURL, colorScheme: "light" });
      await withoutScripts(plain);
      const plainPage = await plain.newPage();
      await plainPage.goto("/xrpl");
      const light = await background(plainPage);
      await plain.close();

      expect(darkByChoice).toBe(darkBySystem);
      expect(light).not.toBe(darkBySystem);
    });

    test("a stored light choice beats a dark system, in the first frame too", async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, colorScheme: "dark", storageState: stored(baseURL!, "light") });
      await withoutScripts(context);
      const page = await context.newPage();
      await page.goto("/xrpl");
      expect(await dataTheme(page)).toBe("light");

      const plain = await browser.newContext({ baseURL, colorScheme: "light" });
      await withoutScripts(plain);
      const plainPage = await plain.newPage();
      await plainPage.goto("/xrpl");
      expect(await background(page)).toBe(await background(plainPage));
      await context.close();
      await plain.close();
    });

    test("a first paint that comes before the stylesheet has the theme: it is recorded when the browser paints", async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, colorScheme: "light", storageState: stored(baseURL!, "dark") });
      await withoutScripts(context);
      // Runs before the page's own scripts, in every document: notes the theme at the first paint and the first contentful paint.
      await context.addInitScript(() => {
        const seen: Record<string, string> = {};
        Object.assign(window, { themeAtPaint: seen });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) seen[entry.name] = document.documentElement.getAttribute("data-theme") ?? "none";
        }).observe({ type: "paint", buffered: true });
      });
      const page = await context.newPage();
      await page.goto("/xrpl");
      await expect
        .poll(() => page.evaluate(() => Object.keys((window as unknown as { themeAtPaint: object }).themeAtPaint).length))
        .toBeGreaterThan(0);
      const seen = await page.evaluate(() => (window as unknown as { themeAtPaint: Record<string, string> }).themeAtPaint);
      expect(Object.values(seen).every((theme) => theme === "dark")).toBe(true);
      await context.close();
    });
  });

  test("is followed from the system until the visitor chooses", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/xrpl");
    await hydrated(page);
    const toggle = page.getByRole("button", { name: "Dark theme" });
    expect(await dataTheme(page)).toBeNull();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await page.emulateMedia({ colorScheme: "light" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("is chosen with the toggle, kept for the next page and the next visit, and chosen back", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/xrpl");
    await hydrated(page);
    const toggle = page.getByRole("button", { name: "Dark theme" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    const lightBackground = await background(page);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await dataTheme(page)).toBe("dark");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
    const darkBackground = await background(page);
    expect(darkBackground).not.toBe(lightBackground);

    // To another page in the page, and to a new document.
    await page.getByRole("banner").getByRole("link", { name: "Xahau" }).click();
    await page.waitForURL("**/xahau");
    expect(await dataTheme(page)).toBe("dark");
    expect(await background(page)).toBe(darkBackground);
    await page.reload();
    await hydrated(page);
    expect(await dataTheme(page)).toBe("dark");
    await expect(page.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Dark theme" }).click();
    expect(await dataTheme(page)).toBe("light");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
    expect(await background(page)).toBe(lightBackground);
  });

  test("is chosen even where the browser keeps nothing", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, colorScheme: "light" });
    // Storage that throws, as in a private window with site data off.
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    const page = await context.newPage();
    await page.goto("/xrpl");
    await hydrated(page);
    await page.getByRole("button", { name: "Dark theme" }).click();
    expect(await dataTheme(page)).toBe("dark");
    await context.close();
  });
});
