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

  test("leave the favicon, which has no hash in its name, to the usual revalidation", async ({ request }) => {
    const response = await request.get("/favicon.ico");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"] ?? "").not.toContain("immutable");
  });
});
