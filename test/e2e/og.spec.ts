import { count, NO_SUCH_TRANSACTION, XAHAU_LEDGER, XRPL_ACCOUNT, XRPL_PAYMENT } from "./fixtures";
import { expect, test } from "./support";

// The link-preview images (spec 9): drawn by the Worker (Satori and resvg-wasm), 1200 x 630.

const IMAGES = [
  { kind: "transaction", path: `/og/xrpl/tx/${XRPL_PAYMENT}.png`, page: `/xrpl/tx/${XRPL_PAYMENT}`, cache: /immutable/ },
  { kind: "ledger", path: `/og/xahau/ledger/${XAHAU_LEDGER}.png`, page: `/xahau/ledger/${XAHAU_LEDGER}`, cache: /immutable/ },
  { kind: "account", path: `/og/xrpl/account/${XRPL_ACCOUNT}.png`, page: `/xrpl/account/${XRPL_ACCOUNT}`, cache: /max-age=300/ },
];

test.describe("the Open Graph image", () => {
  for (const image of IMAGES) {
    test(`of a ${image.kind} is a 1200 x 630 PNG that the browser draws, and its page names it`, async ({ page, request }) => {
      const response = await request.get(image.path);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
      expect(response.headers()["cache-control"]).toMatch(image.cache);
      expect(response.headers()["x-robots-tag"]).toBe("noindex");
      const bytes = await response.body();
      // The PNG signature, and the IHDR chunk: width and height.
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(bytes.readUInt32BE(16)).toBe(1200);
      expect(bytes.readUInt32BE(20)).toBe(630);

      // The page's og:image is this image, and a browser loads it at the size it was drawn.
      await page.goto(image.page);
      const url = await page.locator('meta[property="og:image"]').getAttribute("content");
      expect(url).toBe(new URL(image.path, page.url()).href);
      const size = await page.evaluate(
        (src) =>
          new Promise<[number, number]>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
            img.onerror = () => reject(new Error(`${src} did not load as an image`));
            img.src = src;
          }),
        url!,
      );
      expect(size).toEqual([1200, 630]);
      await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
      await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
    });
  }

  test("is not drawn for something that is not there, nor for an id that is not one", async ({ request }) => {
    for (const path of [`/og/xrpl/tx/${NO_SUCH_TRANSACTION}.png`, "/og/xrpl/tx/nothing.png", "/og/nonet/tx/x.png"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect(response.headers()["content-type"], path).not.toContain("image/png");
    }
  });

  test("states the ledger it was drawn for in the page's alt text", async ({ page }) => {
    await page.goto(`/xahau/ledger/${XAHAU_LEDGER}`);
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", new RegExp(count(XAHAU_LEDGER)));
  });
});
