import { featuresOff } from "../../scripts/e2e-env";
import { MPT_FIXTURE_IDS } from "../support/mpt-case-rules";
import { XAHAU_NFT, XRPL_NFT } from "../support/nft-names";
import { count, LIVE, NO_SUCH_TRANSACTION, XAHAU_LEDGER, XRP_RLUSD_POOL, XRPL_ACCOUNT, XRPL_PAYMENT } from "./fixtures";
import { expect, test } from "./support";
import { tokenCase } from "./token-pages";

// The link-preview images (spec 9): drawn by the Worker (Satori and resvg-wasm), 1200 x 630.

/** The AMM pool's image is there while AMM_PAGES is on; off, it is a 404 (below). */
const AMM_OFF = featuresOff(process.env).has("AMM_PAGES");
const POOL_IMAGE = `/og/xrpl/amm/${XRP_RLUSD_POOL}.png`;
/**
 * An NFT's image (kind `nft`) is there while NFTS is on; off, it is a 404 (below). The ids are the generated fixtures' (test/support/nft-names.ts), which a real stack does not hold:
 * against one, the images of those NFTs are not looked for.
 */
const NFTS_OFF = featuresOff(process.env).has("NFTS");
const NFT_IMAGE = `/og/xrpl/nft/${XRPL_NFT.featured}.png`;

/**
 * A token's image (kind `token`) is there while TOKENS is on; off, it is a 404 (below). The tokens are the generated fixtures' (test/e2e/token-pages.ts), which a real stack does not hold:
 * against one, the images of those tokens are not looked for.
 */
const TOKENS_OFF = featuresOff(process.env).has("TOKENS");
const RLUSD = tokenCase("xrpl", "rlusd");
const EVR = tokenCase("xahau", "evr");
const LP = tokenCase("xrpl", "lp");

/**
 * An MPT issuance's image (kind `mpt`) is there while MPT is on; off, it is a 404 (below). The issuances are the generated fixtures' (test/support/mpt-case-rules.ts), which a real stack does not hold: against one,
 * the images of those issuances are not looked for.
 */
const MPT_OFF = featuresOff(process.env).has("MPT");
const { htf: MPT_HTF, nodeOnly: MPT_NODE_ONLY, nowhere: MPT_NOWHERE } = MPT_FIXTURE_IDS;

const IMAGES = [
  { kind: "transaction", path: `/og/xrpl/tx/${XRPL_PAYMENT}.png`, page: `/xrpl/tx/${XRPL_PAYMENT}`, cache: /immutable/ },
  { kind: "ledger", path: `/og/xahau/ledger/${XAHAU_LEDGER}.png`, page: `/xahau/ledger/${XAHAU_LEDGER}`, cache: /immutable/ },
  { kind: "account", path: `/og/xrpl/account/${XRPL_ACCOUNT}.png`, page: `/xrpl/account/${XRPL_ACCOUNT}`, cache: /max-age=300/ },
  // An AMM pool (kind `amm`): class `slow`, as an account's, since its value changes.
  ...(AMM_OFF ? [] : [{ kind: "pool", path: POOL_IMAGE, page: `/xrpl/amm/${XRP_RLUSD_POOL}`, cache: /max-age=300/ }]),
  // An NFT (kind `nft`): class `slow`, as an account's, since its owner changes; a URIToken's the same on Xahau. The page's og:image is the image.
  ...(NFTS_OFF || LIVE
    ? []
    : [
        { kind: "NFT", path: NFT_IMAGE, page: `/xrpl/nft/${XRPL_NFT.featured}`, cache: /max-age=300/ },
        { kind: "URIToken", path: `/og/xahau/nft/${XAHAU_NFT.featured}.png`, page: `/xahau/nft/${XAHAU_NFT.featured}`, cache: /max-age=300/ },
      ]),
  // A token (kind `token`): class `slow`, as an account's, since its holders and its price change. The page's og:image is the image; the holders' page and the list share none.
  ...(TOKENS_OFF || LIVE
    ? []
    : [
        { kind: "token", path: `/og/xrpl/token/${RLUSD.path}.png`, page: `/xrpl/token/${RLUSD.path}`, cache: /max-age=300/ },
        { kind: "Xahau token", path: `/og/xahau/token/${EVR.path}.png`, page: `/xahau/token/${EVR.path}`, cache: /max-age=300/ },
      ]),
  // An MPT issuance (kind `mpt`): class `slow`, as an account's, since its holders change. The page's og:image is the image; the holders' and transfers' pages and the tab share none.
  ...(MPT_OFF || LIVE ? [] : [{ kind: "MPT", path: `/og/xrpl/mpt/${MPT_HTF}.png`, page: `/xrpl/mpt/${MPT_HTF}`, cache: /max-age=300/ }]),
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
    // An AMM pool by something that is not an address, a pool on Xahau (which has no AMM) and, with AMM_PAGES off, every pool's.
    const pools = ["/og/xrpl/amm/nothing.png", `/og/xahau/amm/${XRP_RLUSD_POOL}.png`, ...(AMM_OFF ? [POOL_IMAGE] : [])];
    // An NFT by something that is no id, an id nobody has (neither the index nor the node), a URIToken's id on XRPL, and with NFTS off every NFT's.
    const nfts = ["/og/xrpl/nft/nothing.png", ...(LIVE ? [] : [`/og/xrpl/nft/${XRPL_NFT.missing}.png`, `/og/xrpl/nft/${XAHAU_NFT.featured}.png`]), ...(NFTS_OFF ? [NFT_IMAGE] : [])];
    // A token by something that is no token, the native currency, an LP token (its page is its pool's), a token the index does not know, a Xahau token on XRPL, and with TOKENS off every token's.
    const tokens = [
      "/og/xrpl/token/nothing.png",
      `/og/xrpl/token/XRP.png`,
      ...(LIVE ? [] : [`/og/xrpl/token/${LP.path}.png`, `/og/xrpl/token/QQQ.${RLUSD.issuer}.png`, `/og/xrpl/token/${EVR.path}.png`]),
      ...(TOKENS_OFF ? [`/og/xrpl/token/${RLUSD.path}.png`] : []),
    ];
    // An MPT by something that is no issuance ID, an ID of 48 digits on Xahau (which has no MPT: a plain 404, no page to send it to), an issuance neither the index nor the node has, and with MPT off every issuance's.
    const mpts = [
      "/og/xrpl/mpt/nothing.png",
      `/og/xahau/mpt/${MPT_HTF}.png`,
      ...(LIVE ? [] : [`/og/xrpl/mpt/${MPT_NOWHERE}.png`]),
      ...(MPT_OFF ? [`/og/xrpl/mpt/${MPT_HTF}.png`] : []),
    ];
    for (const path of [`/og/xrpl/tx/${NO_SUCH_TRANSACTION}.png`, "/og/xrpl/tx/nothing.png", "/og/nonet/tx/x.png", ...pools, ...nfts, ...tokens, ...mpts]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect(response.headers()["content-type"], path).not.toContain("image/png");
    }
  });

  test("of an NFT only the network has is drawn too, kept for a minute at most, and the card of a burned NFT is drawn", async ({ request }) => {
    test.skip(NFTS_OFF, "NFTS is off in the Worker under test: no NFT image is drawn (checked above)");
    test.skip(LIVE, "the NFTs are the generated fixtures' (test/support/nft-names.ts), which a real stack does not hold");
    for (const [id, cache] of [
      [XRPL_NFT.network, /max-age=0/],
      [XRPL_NFT.burned, /max-age=300/],
    ] as const) {
      const response = await request.get(`/og/xrpl/nft/${id}.png`);
      expect(response.status(), id).toBe(200);
      expect(response.headers()["content-type"], id).toBe("image/png");
      expect(response.headers()["cache-control"], id).toMatch(cache);
    }
  });

  test("of a token spelt another way (its code in hex) is a redirect to the one URL", async ({ request }) => {
    test.skip(TOKENS_OFF, "TOKENS is off in the Worker under test: no token image is drawn (checked above)");
    test.skip(LIVE, "the tokens are the generated fixtures' (test/e2e/token-pages.ts), which a real stack does not hold");
    const response = await request.get(`/og/xrpl/token/${RLUSD.currency}.${RLUSD.issuer}.png`, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe(`/og/xrpl/token/${RLUSD.path}.png`);
  });

  test("of an MPT only the network has is drawn too, kept for a minute at most, and its page names none", async ({ page, request }) => {
    test.skip(MPT_OFF, "MPT is off in the Worker under test: no MPT image is drawn (checked above)");
    test.skip(LIVE, "the issuances are the generated fixtures' (test/support/mpt-case-rules.ts), which a real stack does not hold");
    const response = await request.get(`/og/xrpl/mpt/${MPT_NODE_ONLY}.png`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    expect(response.headers()["cache-control"]).toMatch(/max-age=0/);
    // Its page is not indexed and has no picture to share: the card shows what the index would, a minute from now.
    await page.goto(`/xrpl/mpt/${MPT_NODE_ONLY}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
  });

  test("of an MPT spelt in lower case is a redirect to the one URL", async ({ request }) => {
    test.skip(MPT_OFF, "MPT is off in the Worker under test: no MPT image is drawn (checked above)");
    const response = await request.get(`/og/xrpl/mpt/${MPT_HTF.toLowerCase()}.png`, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe(`/og/xrpl/mpt/${MPT_HTF}.png`);
  });

  test("states the ledger it was drawn for in the page's alt text", async ({ page }) => {
    await page.goto(`/xahau/ledger/${XAHAU_LEDGER}`);
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", new RegExp(count(XAHAU_LEDGER)));
  });
});
