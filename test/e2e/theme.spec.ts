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

/**
 * The page with no script of its own running: React cannot set anything, only what is in the HTML can. The browser logs each of the
 * requests that were refused as an error, so a test that uses this says `test.use({ allowConsoleErrors: true })`.
 */
async function withoutScripts(context: BrowserContext): Promise<void> {
  await context.route("**/assets/*.js", (route) => route.abort());
}

/** What `watchTheme` saw, in the page. Times are `performance.now()`, the clock of the paint timings. */
interface ThemeWatch {
  /** When `data-theme` first appeared on any element (in practice <html>), as the observer was told: in the microtask after the script. */
  setAt: number | null;
  /** The first time the stylesheet's <link> was seen entering the document, and what <html> had then. */
  atStylesheet: { at: number; theme: string | null } | null;
  /** The first tick of the observer at all, and what <html> had then. */
  firstTick: { at: number; theme: string | null } | null;
}

/** Installs, before any script of the page, a MutationObserver on the whole document that notes when the theme is put on <html>. */
async function watchTheme(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const seen: ThemeWatch = { setAt: null, atStylesheet: null, firstTick: null };
    Object.assign(window, { themeWatch: seen });
    new MutationObserver((records) => {
      const at = performance.now();
      const theme = document.documentElement.getAttribute("data-theme");
      seen.firstTick ??= { at, theme };
      for (const record of records) {
        if (record.type === "attributes") seen.setAt ??= at;
        for (const node of record.addedNodes) {
          if (node instanceof HTMLLinkElement && node.rel === "stylesheet") seen.atStylesheet ??= { at, theme };
        }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-theme"] });
  });
}

/** The time of the browser's first paint, once it has painted. */
async function firstPaint(page: Page): Promise<number> {
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("first-paint").length)).toBeGreaterThan(0);
  return page.evaluate(() => performance.getEntriesByName("first-paint")[0]!.startTime);
}

const themeWatch = (page: Page) => page.evaluate(() => (window as unknown as { themeWatch: ThemeWatch }).themeWatch);

test.describe("the theme", () => {
  test("is not in the stored HTML, and the script that applies the choice is a plain script before the stylesheet that sets it at once", async ({ page, request }) => {
    const html = await (await request.get("/xrpl")).text();
    // Parsed as a browser parses it (a DOMParser runs no script): the order of the head and the attributes of its elements.
    const head = await page.evaluate((source) => {
      const doc = new DOMParser().parseFromString(source, "text/html");
      return {
        htmlAttributes: doc.documentElement.getAttributeNames(),
        children: [...doc.head.children].map((element) => ({
          tag: element.tagName,
          attributes: element.getAttributeNames(),
          rel: element.getAttribute("rel"),
          text: element.tagName === "SCRIPT" ? element.textContent : null,
        })),
        bodyFollowsHead: doc.head.nextElementSibling === doc.body,
      };
    }, html);

    // One page for everybody: <html> has no theme.
    expect(head.htmlAttributes).not.toContain("data-theme");
    expect(head.bodyFollowsHead).toBe(true);

    const scripts = head.children.filter((child) => child.tag === "SCRIPT" && child.text?.includes("dataset.theme"));
    expect(scripts, "one script in <head> puts the stored theme on <html>").toHaveLength(1);
    const script = scripts[0]!;
    // Plain: no src, async, defer, type="module" or nomodule, so the parser runs it where it finds it and waits for it.
    expect(script.attributes).toEqual([]);

    const stylesheet = head.children.findIndex((child) => child.tag === "LINK" && child.rel?.split(/\s+/).includes("stylesheet"));
    expect(stylesheet).toBeGreaterThan(0);
    expect(head.children.indexOf(script)).toBeLessThan(stylesheet);
    // Nothing that is not the script's own is ahead of it that could keep it waiting: only <meta>, <title> and <link> elements.
    expect(head.children.slice(0, head.children.indexOf(script)).every((child) => !["SCRIPT", "STYLE"].includes(child.tag))).toBe(true);

    // It sets the attribute when it runs, and does not put that off to an event, a timer or a promise.
    const body = script.text!;
    expect(body).toContain("document.documentElement.dataset.theme=");
    expect(body).not.toMatch(/addEventListener|DOMContentLoaded|\bload\b|readystatechange|setTimeout|setInterval|requestAnimationFrame|requestIdleCallback|queueMicrotask|Promise|\basync\b|\bawait\b|MutationObserver/);
  });

  test.describe("before any script of the page has run", () => {
    test.use({ allowConsoleErrors: true });

    test("a stored dark choice is on <html> in the first frame, and paints as the system's dark does", async ({ contextFor, baseURL }) => {
      const chosen = await contextFor({ colorScheme: "light", storageState: stored(baseURL!, "dark") });
      await withoutScripts(chosen);
      const chosenPage = await chosen.newPage();
      await chosenPage.goto("/xrpl");
      expect(await dataTheme(chosenPage)).toBe("dark");
      const darkByChoice = await background(chosenPage);

      // The system is dark and nobody has chosen: what a dark first frame looks like.
      const system = await contextFor({ colorScheme: "dark" });
      await withoutScripts(system);
      const systemPage = await system.newPage();
      await systemPage.goto("/xrpl");
      expect(await dataTheme(systemPage)).toBeNull();
      const darkBySystem = await background(systemPage);

      // The system is light and nobody has chosen.
      const plain = await contextFor({ colorScheme: "light" });
      await withoutScripts(plain);
      const plainPage = await plain.newPage();
      await plainPage.goto("/xrpl");
      const light = await background(plainPage);

      expect(darkByChoice).toBe(darkBySystem);
      expect(light).not.toBe(darkBySystem);
    });

    test("a stored light choice beats a dark system, in the first frame too", async ({ contextFor, baseURL }) => {
      const context = await contextFor({ colorScheme: "dark", storageState: stored(baseURL!, "light") });
      await withoutScripts(context);
      const page = await context.newPage();
      await page.goto("/xrpl");
      expect(await dataTheme(page)).toBe("light");

      const plain = await contextFor({ colorScheme: "light" });
      await withoutScripts(plain);
      const plainPage = await plain.newPage();
      await plainPage.goto("/xrpl");
      expect(await background(page)).toBe(await background(plainPage));
    });

    for (const [chosen, system] of [
      ["dark", "light"],
      ["light", "dark"],
    ] as const) {
      test(`a stored ${chosen} choice was on <html> before the stylesheet entered the document, and before the first paint`, async ({ contextFor, baseURL }) => {
        const context = await contextFor({ colorScheme: system, storageState: stored(baseURL!, chosen) });
        await withoutScripts(context);
        await watchTheme(context);
        const page = await context.newPage();
        await page.goto("/xrpl");
        const paint = await firstPaint(page);
        const seen = await themeWatch(page);

        // The stylesheet's <link> reached the document with the choice already on <html>: the script ran first.
        expect(seen.atStylesheet, "the observer saw the stylesheet's <link> enter the document").not.toBeNull();
        expect(seen.atStylesheet!.theme).toBe(chosen);
        // It was set, and the observer was told, before the browser first painted anything.
        expect(seen.setAt, "the observer saw data-theme set").not.toBeNull();
        expect(seen.setAt!).toBeLessThanOrEqual(paint);
        expect(seen.atStylesheet!.at).toBeLessThanOrEqual(paint);
        // (The first tick of the observer is before the script: the attribute is not there yet, and was not there to begin with.)
        expect(seen.firstTick!.theme).toBeNull();
        expect(await dataTheme(page)).toBe(chosen);
      });
    }

    test("with nothing stored, nothing is put on <html>", async ({ contextFor }) => {
      const context = await contextFor({ colorScheme: "dark" });
      await withoutScripts(context);
      await watchTheme(context);
      const page = await context.newPage();
      await page.goto("/xrpl");
      await firstPaint(page);
      expect((await themeWatch(page)).setAt).toBeNull();
      expect(await dataTheme(page)).toBeNull();
    });

    // The HTML has both logos (Header.tsx): what is seen is the stylesheet's choice alone.
    for (const [system, chosen, shown] of [
      ["light", undefined, "dark"],
      ["dark", undefined, "white"],
      ["light", "dark", "white"],
      ["dark", "light", "dark"],
    ] as const) {
      test(`the header shows the ${shown} logo, alone and drawn, when the system is ${system} and ${chosen ? `${chosen} is stored` : "nothing is"}`, async ({ contextFor, baseURL }) => {
        const context = await contextFor({ colorScheme: system, ...(chosen && { storageState: stored(baseURL!, chosen) }) });
        await withoutScripts(context);
        const page = await context.newPage();
        await page.goto("/xrpl");
        const logo = page.locator(".hdr__logo:visible");
        await expect(logo).toHaveCount(1);
        await expect(logo).toHaveAttribute("src", new RegExp(`gatehub-explorer-${shown}.*\\.svg$`));
        await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      });
    }
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

  test("is chosen even where the browser keeps nothing", async ({ contextFor }) => {
    const context = await contextFor({ colorScheme: "light" });
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
  });
});
