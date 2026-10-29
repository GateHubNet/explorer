import { expect, test } from "./support";

// public/_headers, applied by the static assets of the Worker: the files of /assets/ are named by a hash of their content.

test.describe("the built assets", () => {
  test("are kept by the browser for a year, immutable", async ({ page, request }) => {
    await page.goto("/xrpl");
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"], link[rel="modulepreload"], link[rel="preload"]')].map((link) => link.href),
    );
    const assets = hrefs.filter((href) => new URL(href).pathname.startsWith("/assets/"));
    // A stylesheet, scripts and a font.
    expect(assets.some((href) => href.endsWith(".css"))).toBe(true);
    expect(assets.some((href) => href.endsWith(".js"))).toBe(true);
    expect(assets.some((href) => href.endsWith(".woff2"))).toBe(true);
    for (const href of assets) {
      const response = await request.get(href);
      expect(response.status(), href).toBe(200);
      expect(response.headers()["cache-control"], href).toBe("public, max-age=31536000, immutable");
    }
  });

  test("do not make the pages immutable: a page has the headers of its cache class", async ({ request }) => {
    const response = await request.get("/xrpl");
    expect(response.headers()["cache-control"]).not.toContain("immutable");
  });

  test("leave the favicons, which have no hash in their names, to the usual revalidation", async ({ request }) => {
    for (const [path, type] of [
      ["/favicon.ico", "image/vnd.microsoft.icon"],
      ["/favicon.svg", "image/svg+xml"],
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toContain(type);
      expect(response.headers()["cache-control"] ?? "", path).not.toContain("immutable");
    }
  });

  test("have a favicon that follows the browser's theme: the logo's dark, and white when the browser is dark", async ({ contextFor }) => {
    // The SVG opened by itself in each scheme: the colour its own style gives the mark.
    for (const [scheme, colour] of [
      ["light", "rgb(43, 48, 64)"],
      ["dark", "rgb(255, 255, 255)"],
    ] as const) {
      const context = await contextFor({ colorScheme: scheme });
      const page = await context.newPage();
      await page.goto("/favicon.svg");
      const fill = await page.evaluate(() => getComputedStyle(document.querySelector("path")!).fill);
      expect(fill, scheme).toBe(colour);
    }
  });
});
