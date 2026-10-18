import { afterEach, describe, expect, it } from "vitest";

import { encodeCtid } from "../../app/domain/ctid";
import { shortHash } from "../../app/domain/format";
import { recordedHashes } from "../support/ledger-hashes";
import { anchors, hrefs, pageClient, textOf } from "../support/pages";
import { dataApiError, mockUpstream, type UpstreamMock } from "../support/upstream";

// `/{net}/search?q=...` (spec 6) on the real Worker against the recorded answers of the data API and the nodes
// (test/fixtures/http/): the redirects, the choice page, the help text, the not-found pages and the CTIDs.
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included, so every scenario that
// overrides an answer asks for a hash or a ledger no other test asks for, and the tests of failing upstreams come first.

const { page, get, storedAs } = pageClient("192.0.2");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

// Recorded XRPL: an AccountDelete (ledger 107671593), a Payment, and ledger 107720688, whose hash is below. Recorded Xahau: a Remit.
const XRPL_TX = "8F2DCA944394B29981E24DDD6C46192C404D90F7F5FC4EAB6813B0AFD7751A2D";
const XRPL_LEDGER_HASH = "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02";
const XRPL_PAYMENT = "AACAFCFEBB5C970049A576CBFE6EF544A47EE3ADBA99122FA43234D18D5FFD40";
const XAHAU_TX = "8C50C44787A12B785AA62377D0AFA6C4711E8E07EF68BA6E83DC286F7EE79AAF";
const ADDRESS = "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x";
const X_ADDRESS_WITH_TAG = "XVMgJSRJAMekfCw3mHHsRUbqYqWuZ2qXW7DhMWWpGmjhqyr";
const X_ADDRESS_NO_TAG = "XVMgJSRJAMekfCw3mHHsRUbqYqWuZ26KqXMt3GKX2eENgJ9";

const search = (q: string) => `/xrpl/search?q=${encodeURIComponent(q)}`;

/** The `<meta name="robots">` of a page. */
function robots(html: string): string | undefined {
  const tag = [...html.matchAll(/<meta\s[^>]*>/g)].map((m) => m[0]).find((t) => /\bname="robots"/.test(t));
  return tag && /\bcontent="([^"]*)"/.exec(tag)?.[1];
}

/** Whether a page is one a search engine is asked to leave out of its index but to follow the links of. */
const isNoindexFollow = (html: string) => robots(html) === "noindex, follow";

/** The upstream keys of the requests a mock has seen. */
const keys = (m: UpstreamMock) => m.requests.map((request) => `${request.net} ${request.key}`);

/** A transaction and a ledger the data API answers for `hash`, for the page that offers a choice. */
function bothAnswered(hash: string, ledgerIndex: number) {
  return {
    [`GET /v2/transactions/${hash}`]: {
      result: "success",
      transaction: {
        hash,
        ledger_index: ledgerIndex,
        date: "2026-10-17T16:11:02+00:00",
        tx: { TransactionType: "OfferCreate" },
        meta: { TransactionResult: "tesSUCCESS" },
      },
    },
    [`GET /v2/ledgers/${hash}`]: { result: "success", ledger: { ledger_index: ledgerIndex + 1, close_time: 1792253462 } },
  };
}

// First in the file: the subrequest cache keeps the answers that worked, so the failing ones are asked for first and for
// hashes and ledgers that nothing else in the file asks for.
describe("when an upstream fails", () => {
  it("answers 503 when the data API fails and the hash is nowhere else, and does not ask the node in its place", async () => {
    const hash = "1A".repeat(32);
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: dataApiError(503, "unavailable") });
    const response = await get(search(hash));
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers 503 when the data API has nothing and the node fails: it cannot tell", async () => {
    const hash = "1B".repeat(32);
    mock = mockUpstream("xrpl", { [`node tx ${hash}`]: () => new Response("down", { status: 500 }) });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers 503 when the data API cannot read the ledger of a CTID", async () => {
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/107600101?transactions=true": dataApiError(500, "boom") });
    const response = await get(search(encodeCtid(107600101, 4, 0)));
    await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("still redirects to what was found when the other question failed", async () => {
    const hash = "1C".repeat(32);
    mock = mockUpstream("xrpl", {
      [`GET /v2/ledgers/${hash}`]: dataApiError(500, "boom"),
      [`GET /v2/transactions/${hash}`]: bothAnswered(hash, 107600150)[`GET /v2/transactions/${hash}`],
    });
    const response = await get(search(hash));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${hash}`);
  });
});

describe("a ledger index", () => {
  it("redirects to the ledger, without asking anyone", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search("107695660"));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xrpl/ledger/107695660");
    expect(mock.requests).toEqual([]);
  });

  it("reads an index grouped by thousands, the way the explorer shows it", async () => {
    mock = mockUpstream("xrpl");
    for (const q of ["107,695,660", "107 695 660"]) {
      const response = await get(search(q));
      await response.text();
      expect(response.status, q).toBe(302);
      expect(response.headers.get("Location"), q).toBe("/xrpl/ledger/107695660");
    }
    // A form submitted without JavaScript puts a plus sign where the space was.
    const plus = await get("/xrpl/search?q=107+695+660");
    await plus.text();
    expect(plus.headers.get("Location")).toBe("/xrpl/ledger/107695660");
  });

  it("keeps the network it was asked on", async () => {
    mock = mockUpstream("xahau");
    const response = await get("/xahau/search?q=26540187");
    await response.text();
    expect(response.headers.get("Location")).toBe("/xahau/ledger/26540187");
  });

  it("is stored for the short class, and the browser is not given the internal headers", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search("107695661"));
    await response.text();

    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(response.headers.has("X-Cache-Class")).toBe(false);
    expect(response.headers.has("X-Cache-Ttl")).toBe(false);
    expect(await storedAs(search("107695661"))).toEqual({ cls: "short", ttl: 30 });
  });
});

describe("a 64-digit hash", () => {
  it("redirects a transaction hash to the transaction", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search(XRPL_TX));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${XRPL_TX}`);
    expect(keys(mock).sort()).toEqual([`xrpl GET /v2/ledgers/${XRPL_TX}`, `xrpl GET /v2/transactions/${XRPL_TX}`]);
    expect(await storedAs(search(XRPL_TX))).toEqual({ cls: "short", ttl: 30 });
  });

  it("redirects a ledger hash to the ledger", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search(XRPL_LEDGER_HASH));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/ledger/${XRPL_LEDGER_HASH}`);
    expect(await storedAs(search(XRPL_LEDGER_HASH))).toEqual({ cls: "short", ttl: 30 });
  });

  it("sends the hash on in upper case, whatever was typed, with or without 0x and spaces", async () => {
    mock = mockUpstream("xrpl");
    for (const q of [XRPL_TX.toLowerCase(), `0x${XRPL_TX}`, `  ${XRPL_TX.toLowerCase()} `]) {
      const response = await get(search(q));
      await response.text();
      expect(response.headers.get("Location"), q).toBe(`/xrpl/tx/${XRPL_TX}`);
    }
  });

  it("shows both when the hash is a transaction and a ledger", async () => {
    const hash = "2A".repeat(32);
    mock = mockUpstream("xrpl", bothAnswered(hash, 107600200));
    const { response, html } = await page(search(hash));
    const text = textOf(html);

    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(hrefs(html)).toContain(`/xrpl/tx/${hash}`);
    expect(hrefs(html)).toContain(`/xrpl/ledger/${hash}`);
    // What each one is, so that the choice can be made.
    expect(text).toContain("OfferCreate in ledger #107,600,200");
    expect(text).toContain("#107,600,201, closed 2026-10-17 16:11:02 UTC");
    expect(text).toContain(hash);
    expect(isNoindexFollow(html)).toBe(true);
    expect(await storedAs(search(hash))).toEqual({ cls: "short", ttl: 30 });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("finds a transaction the data API has not indexed in the node (spec 10)", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${XRPL_PAYMENT}`]: null });
    const response = await get(search(XRPL_PAYMENT));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${XRPL_PAYMENT}`);
    expect(mock.requests.filter((r) => r.kind === "node").length).toBeGreaterThan(0);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  describe("that nothing has", () => {
    const UNKNOWN = "3B".repeat(32);

    it("is a 404 page that offers the same search on the other network", async () => {
      mock = mockUpstream("xrpl");
      const { response, html } = await page(search(UNKNOWN), 404);
      const text = textOf(html);

      expect(text).toContain(`We couldn’t find transaction or ledger ${shortHash(UNKNOWN)} on XRPL.`);
      const link = anchors(html).find((a) => a.text === "Search on Xahau");
      expect(link?.attrs).toContain(`href="/xahau/search?q=${UNKNOWN}"`);
      // The box keeps what was typed, and the way home is there.
      expect(html).toContain(`value="${UNKNOWN}"`);
      expect(hrefs(html)).toContain("/xrpl");
      expect(response.headers.get("Cache-Control")).toBe("max-age=0");
      expect(isNoindexFollow(html)).toBe(true);
      expect(await storedAs(search(UNKNOWN))).toEqual({ cls: "short", ttl: 30 });
    });

    it("asked the data API for both and then the node for both", async () => {
      const hash = "3C".repeat(32);
      mock = mockUpstream("xrpl");
      await page(search(hash), 404);
      expect(keys(mock).sort()).toEqual(
        [
          `xrpl GET /v2/ledgers/${hash}`,
          `xrpl GET /v2/transactions/${hash}`,
          `xrpl node ledger ledger_hash=${hash}`,
          `xrpl node tx transaction=${hash}`,
        ].sort(),
      );
    });

    it("offers XRPL from Xahau, with the hash in upper case", async () => {
      const hash = "3D".repeat(32);
      mock = mockUpstream("xahau");
      const { html } = await page(`/xahau/search?q=${hash.toLowerCase()}`, 404);
      const link = anchors(html).find((a) => a.text === "Search on XRPL");
      expect(link?.attrs).toContain(`href="/xrpl/search?q=${hash}"`);
    });

    it("leads to the transaction when the other network has it", async () => {
      mock = mockUpstream("xrpl");
      // A Xahau transaction is not on XRPL ...
      const { html } = await page(search(XAHAU_TX), 404);
      const href = /href="([^"]*)"[^>]*>Search on Xahau</.exec(html)?.[1];
      expect(href).toBe(`/xahau/search?q=${XAHAU_TX}`);

      // ... and the link finds it there.
      const there = await get(href!);
      await there.text();
      expect(there.status).toBe(302);
      expect(there.headers.get("Location")).toBe(`/xahau/tx/${XAHAU_TX}`);
    });
  });
});

describe("an address", () => {
  it("redirects to the account, without asking anyone", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search(ADDRESS));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/account/${ADDRESS}`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(search(ADDRESS))).toEqual({ cls: "short", ttl: 30 });
  });

  it("redirects an X-address to the classic address with the tag", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(search(X_ADDRESS_WITH_TAG));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/account/${ADDRESS}?tag=104882`);
  });

  it("leaves the tag out when the X-address has none", async () => {
    mock = mockUpstream("xahau");
    const response = await get(`/xahau/search?q=${X_ADDRESS_NO_TAG}`);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xahau/account/${ADDRESS}`);
  });

  it("does not take an address with a wrong checksum for one", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(search(`${ADDRESS.slice(0, -1)}y`));
    expect(textOf(html)).toContain("Nothing on XRPL looks like");
  });
});

describe("a CTID", () => {
  it("redirects a CTID of the network to the transaction at its place in the ledger", async () => {
    mock = mockUpstream("xrpl");
    const hashes = await recordedHashes("xrpl", 107720688);
    const ctid = encodeCtid(107720688, 17, 0);
    const response = await get(search(ctid));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${hashes[17]}`);
    expect(keys(mock)).toEqual(["xrpl GET /v2/ledgers/107720688?transactions=true"]);
    expect(await storedAs(search(ctid))).toEqual({ cls: "short", ttl: 30 });
  });

  it("takes a CTID in lower case", async () => {
    mock = mockUpstream("xrpl");
    const hashes = await recordedHashes("xrpl", 107720688);
    const response = await get(search(encodeCtid(107720688, 3, 0).toLowerCase()));
    await response.text();
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${hashes[3]}`);
  });

  it("redirects a Xahau CTID on Xahau", async () => {
    mock = mockUpstream("xahau");
    const hashes = await recordedHashes("xahau", 26540187);
    const response = await get(`/xahau/search?q=${encodeCtid(26540187, 5, 21337)}`);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xahau/tx/${hashes[5]}`);
  });

  it("offers the transaction on the other network when the CTID belongs there, and asks nobody", async () => {
    mock = mockUpstream("xrpl");
    const ctid = encodeCtid(26540187, 5, 21337);
    const { response, html } = await page(search(ctid));
    const text = textOf(html);

    expect(text).toContain("That CTID is on Xahau");
    expect(text).toContain(`${ctid} belongs to Xahau, so it is not a transaction on XRPL.`);
    const link = anchors(html).find((a) => a.attrs.includes(`href="/xahau/tx/${ctid}"`));
    expect(link?.text).toBe("Open the transaction on Xahau");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(isNoindexFollow(html)).toBe(true);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(search(ctid))).toEqual({ cls: "short", ttl: 30 });
  });

  it("offers the transaction on XRPL when an XRPL CTID is searched on Xahau", async () => {
    mock = mockUpstream("xahau");
    const ctid = encodeCtid(107720688, 5, 0);
    const { html } = await page(`/xahau/search?q=${ctid}`);
    expect(hrefs(html)).toContain(`/xrpl/tx/${ctid}`);
    expect(textOf(html)).toContain("That CTID is on XRPL");
  });

  it("is a 404 for a ledger the data API does not have, and for an index past the end of the ledger", async () => {
    mock = mockUpstream("xrpl");
    for (const ctid of [encodeCtid(107600301, 0, 0), encodeCtid(107720688, 66, 0)]) {
      const { response, html } = await page(search(ctid), 404);
      expect(textOf(html), ctid).toContain(`We couldn’t find transaction ${ctid} on XRPL.`);
      // The network id in a CTID is its network's: there is nothing to look for on the other one.
      expect(textOf(html), ctid).not.toContain("Search on Xahau");
      expect(isNoindexFollow(html), ctid).toBe(true);
      expect(response.headers.get("Cache-Control"), ctid).toBe("max-age=0");
    }
    expect(await storedAs(search(encodeCtid(107600301, 0, 0)))).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 for a network id that is neither XRPL's nor Xahau's, on either network, and asks nobody", async () => {
    mock = mockUpstream("xrpl");
    const ctid = encodeCtid(107720688, 5, 1);
    for (const net of ["xrpl", "xahau"]) {
      const { html } = await page(`/${net}/search?q=${ctid}`, 404);
      const text = textOf(html);
      expect(text).toContain(`${ctid} is for network id 1, which this explorer does not cover.`);
      expect(hrefs(html).filter((href) => href.includes("/tx/"))).toEqual([]);
      expect(text).not.toContain("Search on");
    }
    expect(mock.requests).toEqual([]);
  });
});

describe("anything else", () => {
  it("shows what can be searched for, with the box holding what was typed", async () => {
    mock = mockUpstream("xrpl");
    const { response, html } = await page(search("hello"));
    const text = textOf(html);

    expect(text).toContain("No match");
    expect(text).toContain("Nothing on XRPL looks like “hello”.");
    expect(text).toContain("An account address");
    expect(text).toContain("A transaction or ledger hash: 64 hexadecimal characters");
    expect(text).toContain("A ledger index");
    expect(text).toContain("A CTID: C followed by 15 hexadecimal characters");
    expect(html).toContain('value="hello"');
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(isNoindexFollow(html)).toBe(true);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(search("hello"))).toEqual({ cls: "short", ttl: 30 });
  });

  it("is the same page for an empty box, and for no box at all", async () => {
    mock = mockUpstream("xrpl");
    for (const path of ["/xrpl/search?q=", "/xrpl/search?q=%20%20", "/xrpl/search"]) {
      const { html } = await page(path);
      expect(textOf(html), path).toContain("Search XRPL");
      expect(textOf(html), path).toContain("A CTID: C followed by 15 hexadecimal characters");
      expect(isNoindexFollow(html), path).toBe(true);
    }
  });

  it("shows a long or hostile input as text, cut short", async () => {
    mock = mockUpstream("xrpl");
    const hostile = `<script>alert(1)</script>${"x".repeat(500)}`;
    const { html } = await page(search(hostile));

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("x".repeat(300));
  });

  it("is on Xahau what it is on XRPL", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/search?q=hello");
    expect(textOf(html)).toContain("Nothing on Xahau looks like “hello”.");
    expect(html).toContain('data-net="xahau"');
  });
});

describe("the route", () => {
  it("sets a title that names the search and the network", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(search("hello"));
    expect(html).toMatch(/<title>[^<]*Search[^<]*XRPL[^<]*<\/title>/);
  });

  // What a search from the box does once JavaScript has loaded: React Router asks for the `.data` URL and follows the redirect.
  it("redirects in the `.data` response a client-side navigation reads", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl/search.data?q=107695660");
    const body = await response.text();

    expect(response.status).toBe(202);
    expect(body).toContain("/xrpl/ledger/107695660");
    expect(body).toContain("SingleFetchRedirect");
  });

  it("answers the `.data` URL of a page with the page's data, stored for the short class", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl/search.data?q=hello+there");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("hello there");
    expect(await storedAs("/xrpl/search.data?q=hello+there")).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 of class short on a network that does not exist", async () => {
    const response = await get("/doge/search?q=1");
    await response.text();
    expect(response.status).toBe(404);
    expect(await storedAs("/doge/search?q=1")).toEqual({ cls: "short", ttl: 30 });
  });
});
