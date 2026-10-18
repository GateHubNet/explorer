import { XAHAU_LEDGER } from "./fixtures";
import { expect, hydrated, test } from "./support";

// The check at the end of every test (support.ts) is a thing to be sure of too. A test marked `test.fail()` passes only when it fails.

test.describe("the check of the browser's console", () => {
  test("fails a test whose client-side navigation was answered with a 5xx", async ({ page }) => {
    test.fail();
    await page.route("**/xahau/ledger/*.data*", (route) => route.fulfill({ status: 503, contentType: "text/plain", body: "busy" }));
    await page.goto(`/xahau/ledger/${XAHAU_LEDGER}`);
    await hydrated(page);
    const logged = page.waitForEvent("console", { predicate: (message) => message.type() === "error" });
    await page.getByRole("link", { name: /next ledger/ }).click();
    await logged;
  });

  // The browser asks for no `/__manifest` (`routeDiscovery: { mode: "initial" }`, react-router.config.ts: the manifest of every route is in the
  // page). What a client-side navigation to another route fetches is that route's module, a file of the build.
  test("fails a test for the module of a route that is missing from the build", async ({ page }) => {
    test.fail();
    await page.route("**/assets/net.tx._id-*.js", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "no" }));
    await page.goto(`/xahau/ledger/${XAHAU_LEDGER}`);
    await hydrated(page);
    const logged = page.waitForEvent("console", { predicate: (message) => message.type() === "error" });
    await page.locator('a[href^="/xahau/tx/"]').first().click();
    await logged;
  });

  test("fails a test for a file of the build that is missing", async ({ page }) => {
    test.fail();
    await page.route("**/assets/styles-*.css", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "no" }));
    await page.goto("/xrpl");
    await hydrated(page);
  });

  test("fails a test whose page threw, in a context of its own too", async ({ contextFor }) => {
    test.fail();
    const context = await contextFor();
    const page = await context.newPage();
    await page.goto("/xrpl/nothing-here");
    const thrown = page.waitForEvent("pageerror");
    await page.evaluate(() => void setTimeout(() => { throw new Error("t15b: thrown on purpose"); }, 0));
    await thrown;
  });

  test("lets a 404 for a page that is not there through, as a document and as a client-side navigation", async ({ page }) => {
    const response = await page.goto("/xrpl/tx/" + "0".repeat(64));
    expect(response?.status()).toBe(404);
    await hydrated(page);
    await page.getByRole("main").getByRole("searchbox", { name: "Search XRPL" }).fill("1".repeat(64));
    await page.getByRole("main").getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("main")).toContainText("We couldn’t find");
  });

  test.describe("when the test allows errors", () => {
    test.use({ allowConsoleErrors: true });

    test("does not fail a test whose page threw, in a context of its own either", async ({ contextFor }) => {
      const context = await contextFor();
      const page = await context.newPage();
      await page.goto("/xrpl/nothing-here");
      const thrown = page.waitForEvent("pageerror");
      await page.evaluate(() => void setTimeout(() => { throw new Error("t15b: thrown on purpose"); }, 0));
      await thrown;
    });
  });
});

test.describe("a context of a test's own", () => {
  test("has the visitor address of the test, as the test's page has", async ({ page, contextFor }) => {
    const own = await (await contextFor()).newPage();
    const [ownRequest] = await Promise.all([own.waitForRequest("**/robots.txt"), own.goto("/robots.txt")]);
    const [request] = await Promise.all([page.waitForRequest("**/robots.txt"), page.goto("/robots.txt")]);
    const address = (await request.allHeaders())["cf-connecting-ip"];
    expect(address).toMatch(/^2001:db8:/);
    expect((await ownRequest.allHeaders())["cf-connecting-ip"]).toBe(address);
  });

  test("takes the options it is given", async ({ contextFor }) => {
    const page = await (await contextFor({ viewport: { width: 375, height: 700 }, colorScheme: "dark" })).newPage();
    await page.goto("/xrpl");
    expect(await page.evaluate(() => [window.innerWidth, matchMedia("(prefers-color-scheme: dark)").matches])).toEqual([375, true]);
  });
});
