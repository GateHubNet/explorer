import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PRODUCT_NAME } from "../../app/ui/brand";
import { THEME_SCRIPT } from "../../app/ui/theme-script";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The layout and the network routes on the real Worker (workers/app.ts, React Router, the edge cache): the
// redirect from `/`, the unknown-network and unknown-path 404s, the `/:net` layout with its header, the theme and the
// network cookie, robots.txt.

let visitors = 0;
/** An address of the documentation range (RFC 5737) no other test file uses: the visitor limit is per address. */
const visitor = () => `203.0.113.${++visitors}`;

const get = (path: string, headers: Record<string, string> = {}) =>
  exports.default.fetch(`https://explorer.test${path}`, {
    headers: { "CF-Connecting-IP": visitor(), ...headers },
    redirect: "manual",
  });

/** The anchors of some HTML: their attributes as written and the text inside them. */
function anchors(html: string): Array<{ attrs: string; text: string }> {
  return [...html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    attrs: match[1]!,
    text: match[2]!.replace(/<[^>]*>/g, "").trim(),
  }));
}

/** The HTML of a page; fails with the body when the status is not the expected one. */
async function page(path: string, status = 200, headers: Record<string, string> = {}) {
  const response = await get(path, headers);
  const html = await response.text();
  expect(response.status, html.slice(0, 300)).toBe(status);
  return { response, html };
}

describe("/", () => {
  it("redirects to the XRPL home when there is no cookie, and is never cached", async () => {
    const response = await get("/");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xrpl");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Cache")).toBe("BYPASS");
  });

  it("redirects to the network of the net cookie", async () => {
    const response = await get("/", { Cookie: "theme=dark; net=xahau" });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xahau");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("falls back to XRPL for a cookie that names no network", async () => {
    for (const cookie of ["net=doge", "net=", "net=XAHAU"]) {
      const response = await get("/", { Cookie: cookie });
      expect(response.headers.get("Location"), cookie).toBe("/xrpl");
    }
  });

  it("does not ask for the cookie it reads to be sent (no Set-Cookie)", async () => {
    expect((await get("/")).headers.has("Set-Cookie")).toBe(false);
  });
});

describe("an unknown network or path", () => {
  it("/doge is a 404 page, noindex, with the search box", async () => {
    const { response, html } = await page("/doge", 404);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(html).toMatch(/<meta[^>]*name="robots"[^>]*content="noindex"/);
    expect(html).toContain('action="/xrpl/search"');
    expect(html).toContain("doge");
    expect(html).toContain(`<title>`);
  });

  it("a 404 for an unknown network is class short, so it is stored for 30 s", async () => {
    const path = "/dogecoin";
    const first = await get(path);
    await first.text();
    expect(first.status).toBe(404);
    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect(first.headers.get("Cache-Control")).toBe("max-age=0");
    // The entry stores in waitUntil, behind the answer.
    let second = await get(path);
    for (let tries = 0; tries < 20 && second.headers.get("X-Cache") !== "HIT"; tries += 1) {
      await second.text();
      await new Promise((resolve) => setTimeout(resolve, 25));
      second = await get(path);
    }
    expect(second.status).toBe(404);
    expect(second.headers.get("X-Cache")).toBe("HIT");
  });

  it("the .data URL of a client-side navigation to an unknown network is the same 404 of class short", async () => {
    const response = await get("/dogecoin.data");
    await response.text();
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Remix-Response")).toBe("yes");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(response.headers.has("X-Cache-Class")).toBe(false);
  });

  it("any other path is a 404 page with the search box and a link home", async () => {
    const { html } = await page("/no/such/page", 404);
    expect(html).toMatch(/<meta[^>]*name="robots"[^>]*content="noindex"/);
    expect(html).toContain('action="/xrpl/search"');
    expect(html).toContain("/no/such/page");
    expect(anchors(html).some((a) => a.attrs.includes('href="/xrpl"') && /home/.test(a.text))).toBe(true);
  });

  it("a path under a real network keeps that network's chrome", async () => {
    const { html } = await page("/xahau/no/such/page", 404);
    expect(html).toContain('data-net="xahau"');
    expect(html).toContain('action="/xahau/search"');
  });

  it("is case-sensitive about the network", async () => {
    await page("/XRPL", 404);
  });
});

// `/xrpl` and `/xahau` are the home pages now, which read the data API: the tests that look at the layout around them
// run against the recorded answers.
let upstream: UpstreamMock | undefined;
const withRecordedUpstream = () => {
  beforeEach(() => {
    upstream = mockUpstream("xrpl");
  });
  afterEach(() => {
    upstream?.restore();
    upstream = undefined;
  });
};

describe("/:net", () => {
  withRecordedUpstream();

  it("puts the network's accent on the page: the wrapper of the header carries data-net", async () => {
    const { html } = await page("/xahau");
    const wrapper = html.indexOf('data-net="xahau"');
    expect(wrapper).toBeGreaterThan(-1);
    expect(html.indexOf("<header")).toBeGreaterThan(wrapper);
    expect(html).not.toContain('data-net="xrpl"');
  });

  it("links the network switch to the other network's home and marks the current one", async () => {
    const { html } = await page("/xahau");
    const group = /<div[^>]*aria-label="Network"[^>]*>([\s\S]*?)<\/div>/.exec(html)![1]!;
    const [first, second] = anchors(group);
    expect(first!.text).toBe("XRPL");
    expect(first!.attrs).toContain('href="/xrpl"');
    expect(first!.attrs).not.toContain("aria-current");
    expect(second!.text).toBe("Xahau");
    expect(second!.attrs).toContain('href="/xahau"');
    expect(second!.attrs).toContain('aria-current="true"');
  });

  it("has the header search: GET /xahau/search, name q", async () => {
    const { html } = await page("/xahau");
    const form = /<form[^>]*role="search"[^>]*>/.exec(html)?.[0] ?? "";
    expect(form).toContain('action="/xahau/search"');
    expect(form).toContain('method="get"');
    expect(html).toMatch(/<input[^>]*name="q"/);
  });

  it("remembers the network in the browser, not in a Set-Cookie (a cookie would keep the page out of the edge cache)", async () => {
    const { response, html } = await page("/xahau");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(html).toContain('document.cookie="net=xahau; Path=/; Max-Age=31536000; SameSite=Lax"');
    const xrpl = await page("/xrpl");
    expect(xrpl.html).toContain('document.cookie="net=xrpl; Path=/; Max-Age=31536000; SameSite=Lax"');
    expect(xrpl.html).not.toContain("net=xahau");
  });

  it("does not send the data API or node URLs to the browser, in the document or in the data of a client navigation", async () => {
    const { html } = await page("/xahau");
    const data = await (await get("/xahau.data")).text();
    for (const body of [html, data]) {
      expect(body).not.toContain("example.invalid");
      expect(body).not.toContain("xahau.network");
      expect(body).not.toContain("ripple.com");
    }
  });

  it("is the same document for every visitor: no per-visitor markup from the cookie or the theme", async () => {
    const plain = (await page("/xrpl")).html;
    const withCookies = (await page("/xrpl", 200, { Cookie: "net=xahau; theme=dark" })).html;
    expect(withCookies).toBe(plain);
  });
});

describe("the document shell", () => {
  withRecordedUpstream();

  it("leaves data-theme to the inline script: <html> has none, and the script is in <head> before the stylesheet", async () => {
    const { html } = await page("/xrpl");
    const htmlTag = /<html[^>]*>/.exec(html)![0];
    expect(htmlTag).not.toContain("data-theme");
    expect(htmlTag).toContain('lang="en"');

    const script = html.indexOf(THEME_SCRIPT);
    const stylesheet = html.indexOf('rel="stylesheet"');
    const headEnd = html.indexOf("</head>");
    expect(script, "the theme script is inlined").toBeGreaterThan(-1);
    expect(stylesheet, "the stylesheet is linked").toBeGreaterThan(-1);
    expect(script).toBeLessThan(stylesheet);
    expect(script).toBeLessThan(headEnd);
  });

  it("self-hosts the fonts: preloaded from this site, none from Google", async () => {
    const { html } = await page("/xrpl");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
    const preloads = [...html.matchAll(/<link[^>]*rel="preload"[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes("font"));
    expect(preloads.length).toBeGreaterThanOrEqual(1);
    for (const tag of preloads) {
      expect(tag).toContain(".woff2");
      expect(tag).toContain("crossorigin");
      expect(tag).not.toMatch(/https?:\/\//);
    }
  });

  it("has a title, a viewport and both colour schemes", async () => {
    const { html } = await page("/xrpl");
    expect(html).toMatch(new RegExp(`<title>[^<]*${PRODUCT_NAME}[^<]*</title>`));
    expect(html).toContain('name="viewport"');
    expect(html).toContain('name="color-scheme" content="light dark"');
  });

  it("has a skip link, one main landmark, and the footer credit", async () => {
    const { html } = await page("/xrpl");
    expect(html).toMatch(/<a[^>]*class="skip-link"[^>]*href="#main"|<a[^>]*href="#main"[^>]*class="skip-link"/);
    expect(html.match(/<main[\s>]/g)).toHaveLength(1);
    expect(html).toContain("by GateHub");
  });
});

describe("/robots.txt", () => {
  it("allows everything but the search pages, the payments CSVs and the analytics views", async () => {
    const response = await get("/robots.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /*/search");
    // Each crawl of a CSV costs an upstream CSV of up to 1000 rows (cached 30 s), and the file is no page to index.
    expect(body).toContain("Disallow: /*/account/*/payments.csv");
    // The analytics views are six aggregate reads of an account nobody else is looking at, and the rule matches either query order.
    expect(body).toContain("\nDisallow: /*/account/*tab=analytics\n");
    expect(body.match(/^Disallow:/gm)).toHaveLength(3);
    expect(body).not.toMatch(/^Disallow: \/?$/m);
  });

  it("is stored under the build id like a page", async () => {
    const response = await get("/robots.txt");
    await response.text();
    expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    expect(response.headers.has("X-Cache-Class")).toBe(false);
  });
});
