import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { encodeCtid } from "../../app/domain/ctid";
import { shortAddress, shortHash } from "../../app/domain/format";
import type { FeeRow, Ledger, TxObject } from "../../app/server/api-types";
import { CACHE_CLASSES } from "../../app/server/cache-class";
import { homePage } from "../../app/server/home-view";
import { collectAddresses } from "../../app/server/names-collect";
import xahauFees from "../fixtures/http/xahau/data-api/network/fees@descending=true&limit=8.json";
import xahauLedger from "../fixtures/http/xahau/data-api/ledgers/26596843.json";
import xahauTransactions from "../fixtures/http/xahau/data-api/transactions@descending=true&limit=8.json";
import xrplFees from "../fixtures/http/xrpl/data-api/network/fees@descending=true&limit=8.json";
import xrplLedger from "../fixtures/http/xrpl/data-api/ledgers/107721455.json";
import xrplTransactions from "../fixtures/http/xrpl/data-api/transactions@descending=true&limit=8.json";
import { expectAccountText, expectNamedLinks, namedAmong, namesCalls, namesStatuses, sorted, viewOf } from "../support/names";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";
import { anchors, hrefs, pageClient, tableRows, textOf } from "../support/pages";

// The home page, `/{net}`, on the real Worker against the recorded answers of the data API (test/fixtures/http/): the hero
// with its search box, four tiles, the latest ledgers (their transaction counts come from /v2/network/fees) and the latest
// transactions. Heads: XRPL 107721455, Xahau 26596843.
//
// Everything a Worker stores in the Cache API stays there for the rest of the file, subrequests included, and an error is
// never stored: so the failing request goes first, before any test has put its answer in the cache, and each test asks for
// its own URL (the query string is part of the edge cache key; the page ignores it).
//
// The page holds a failed call for 5 s (spec 1.7: it polls), so the test that fails `fees` would hold it for the XRPL tests after it. The hold
// reads `Date` only, so `Date` alone is faked here (the Cache API and the streams need the real timers) and moved past the hold after each test.

const { page, get, stored, storedAs } = pageClient("198.51.100");

/** The rows of the XRPL home's transactions table as the loader builds them from the recorded answers: the part the loader collects the addresses of. */
const XRPL_ROWS = homePage({
  network: { id: "xrpl", ctidNetworkId: 0, native: "XRP" },
  ledger: xrplLedger.ledger as unknown as Ledger,
  fees: xrplFees.rows as unknown as FeeRow[],
  transactions: xrplTransactions.transactions as unknown as TxObject[],
}).transactions;

/** What the loader passes to `collectAddresses`: the accounts of the rows (display names spec 1), not the issuers of their amounts, which are only in a title attribute. */
const accountsOf = (rows: readonly { account: string }[]) => collectAddresses(rows.map((row) => row.account));

/** The rows of the Xahau home's transactions table, the same way. */
const XAHAU_ROWS = homePage({
  network: { id: "xahau", ctidNetworkId: 21337, native: "XAH" },
  ledger: xahauLedger.ledger as unknown as Ledger,
  fees: xahauFees.rows as unknown as FeeRow[],
  transactions: xahauTransactions.transactions as unknown as TxObject[],
}).transactions;

let mock: UpstreamMock | undefined;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  mock?.restore();
  mock = undefined;
  vi.setSystemTime(Date.now() + 31_000);
});

afterAll(() => {
  vi.useRealTimers();
});

describe("when the data API fails", () => {
  it("answers 503 with Retry-After and stores nothing, rather than a page with holes", async () => {
    mock = mockUpstream("xrpl", { "GET /v2/network/fees?descending=true&limit=8": dataApiError(503, "unavailable") });
    const response = await get("/xrpl?case=fail");
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(response.headers.get("X-Cache")).toBe("MISS");
    expect(html).toContain("Temporarily unavailable");
    // The Worker was given the 503 itself, not a failure to connect.
    expect(statusesOf(mock, "GET /v2/network/fees?descending=true&limit=8")).toEqual([503]);
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

// The names call of a polled page asks for the failure hold (README "The failure hold"), and a page whose names call failed is served with its addresses and is not
// stored. First in the file, with the data API's failures: an answer of the names call that worked is kept for a minute, and a failure is asked for before one has been.
describe("when the names call fails", () => {
  it("shows the addresses, does not store the page, and holds the failure: the next render within 5 s does not make the call again", async () => {
    mock = mockUpstream("xrpl", { "GET /v2/account_names": dataApiError(503, "unavailable") });
    const first = await get("/xrpl?case=names-failed-1");
    const html = await first.text();

    expect(first.status).toBe(200);
    expect(first.headers.get("X-Cache")).toBe("MISS");
    // Every account of the table is its short address, as before names.
    const accounts = tableRows(html, "Latest transactions")
      .slice(1)
      .map((row) => row[2]);
    expect(accounts).toEqual(XRPL_ROWS.map((row) => shortAddress(row.account)));
    expect(await stored("/xrpl?case=names-failed-1")).toBeUndefined();
    expect(namesCalls(mock)).toEqual([sorted(accountsOf(XRPL_ROWS))]);
    expect(namesStatuses(mock)).toEqual([503]);

    // Another URL, so another page of the edge cache, a second later: the held failure answers, the data API is not asked.
    vi.setSystemTime(Date.now() + 1_000);
    const second = await get("/xrpl?case=names-failed-2");
    await second.text();
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Cache")).toBe("MISS");
    expect(namesCalls(mock)).toHaveLength(1);
    expect(mock.unusedOverrides()).toEqual([]);

    // Past the hold the call is made again.
    vi.setSystemTime(Date.now() + 5_000);
    const third = await get("/xrpl?case=names-failed-3");
    await third.text();
    expect(third.status).toBe(200);
    expect(namesCalls(mock)).toHaveLength(2);
  });
});

describe("when the data API lacks what the home page needs", () => {
  it("answers 503, not a 404 page that would be stored as the home page, when the newest ledger it named is missing", async () => {
    // The Xahau home is asked for first, before its success test has put the ledger in the cache.
    mock = mockUpstream("xahau", { "GET /v2/ledgers/26596843": null });
    const response = await get("/xahau?case=missing");
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    expect(html).not.toContain("couldn’t find");
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("the XRPL home", () => {
  // The first success of the file: the Worker keeps the answer of a names call a minute, and this is the test that sees the call.
  it("makes one names call, for the addresses of the rows sorted, and draws the names of the table", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl?case=names");

    // `collectAddresses` of the accounts of the rows the loader passes: not the issuers of the amounts, not the examples.
    expect(namesCalls(mock)).toEqual([sorted(accountsOf(XRPL_ROWS))]);
    expect(mock.requests.find((request) => request.url.includes("/v2/account_names"))?.status).toBe(200);

    // Every account of the table that the fixtures name is drawn by its name and the title of how it is known; there is a verified one among them.
    const named = await namedAmong("xrpl", XRPL_ROWS.map((row) => row.account));
    const views = await Promise.all(named.map((address) => viewOf("xrpl", address)));
    expect(views.some((view) => view?.name?.kind === "verified")).toBe(true);
    for (const address of named) await expectNamedLinks(html, "xrpl", address, shortAddress(address), { ignore: /class="example"/ });
  });

  it("shows the hero, the latest ledger, four tiles, 8 ledgers and 8 transactions", async () => {
    mock = mockUpstream("xrpl");
    const { response, html } = await page("/xrpl?case=content");
    const text = textOf(html);

    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(text).toContain("Explore the XRP Ledger");
    expect(text).toContain("XRPL mainnet");
    expect(text).toMatch(/ledger #107,721,455 validated/);

    // The tiles: label, figure, note.
    for (const label of ["Latest validated ledger", "Transactions per ledger", "Fees burned, last ledger", "Total supply"]) {
      expect(text, label).toContain(label);
    }
    expect(text).toContain("#107,721,455");
    expect(text).toContain("0.012135 XRP");
    // The supply tile keeps to whole units; every digit is on hover (and on the ledger page).
    expect(text).toContain("99,985,590,034 XRP");
    expect(html).toContain('title="99,985,590,034.332636 XRP"');
    expect(text).toContain("average 78 over the last 8");
    expect(text).toContain("average 0.000113 · max 0.01 per transaction");

    // Latest ledgers: the index, the transactions of /v2/network/fees and the close time (UTC).
    const ledgers = tableRows(html, "Latest ledgers");
    expect(ledgers[0]).toEqual(["Ledger", "Txs", "Closed (UTC)", "Age"]);
    expect(ledgers.slice(1).map((row) => row.slice(0, 3))).toEqual([
      ["#107,721,455", "107", "17:01:12"],
      ["#107,720,688", "66", "16:11:02"],
      ["#107,720,549", "50", "16:02:02"],
      ["#107,720,115", "77", "15:34:10"],
      ["#107,713,744", "62", "08:42:50"],
      ["#107,711,512", "65", "06:18:50"],
      ["#107,703,707", "53", "21:57:22"],
      ["#107,699,656", "141", "17:34:11"],
    ]);

    // Latest transactions: type, hash, account, amount, result.
    const txs = tableRows(html, "Latest transactions");
    expect(txs[0]).toEqual(["Type", "Hash", "Account", "Amount", "Result", "Age"]);
    expect(txs).toHaveLength(9);
    // The account of a row is its short address, or the name the fixtures give it (the account column is drawn by what `account_names.json` says: see the names test above).
    const account = (row: string[]) => ({ cell: row[2]!, row: row.filter((_, i) => i !== 2) });
    expect(account(txs[1]!).row.slice(0, 4)).toEqual([
      "Batch",
      shortHash("1A00E4CC5EB143E8BFF4578019BDF45ECEA40C37F113D261ECFB276243858872"),
      "—",
      "Success",
    ]);
    await expectAccountText(txs[1]![2]!, "xrpl", "raBkGGTqmGJE2vQENXhkDsAm2BEXZSQpmj", shortAddress("raBkGGTqmGJE2vQENXhkDsAm2BEXZSQpmj"));
    // A payment shows what arrived; an offer what it sells; a failure its result code.
    expect(account(txs[3]!).row.slice(0, 4)).toEqual([
      "Payment",
      shortHash("BEBFD0CF8A38EB95E140FC284D8020F96C207F55D7CECB6EFE28CDDF5433C744"),
      "17.296124 XRP",
      "Success",
    ]);
    await expectAccountText(txs[3]![2]!, "xrpl", "rhvuBvd6FhmkLSRdVvw6WoagX7drwXq4NT", shortAddress("rhvuBvd6FhmkLSRdVvw6WoagX7drwXq4NT"));
    expect(txs[5]![3]).toBe("417.138606 XRP");
    expect(account(txs[8]!).row.slice(0, 4)).toEqual([
      "OfferCreate",
      shortHash("D05D52934A382E975B131A3E729CDA7CA3C59E94CE9F3DC3DC91A6ADFC5C140F"),
      "280.556208 XRP",
      "tecKILLED",
    ]);
    await expectAccountText(txs[8]![2]!, "xrpl", "rsjsfxKNcgkcGLndpkdLr5CKLvQ8Nntsf1", shortAddress("rsjsfxKNcgkcGLndpkdLr5CKLvQ8Nntsf1"));

    // Links to the pages the rest of the explorer serves.
    const links = hrefs(html);
    expect(links).toContain("/xrpl/ledger/107721455");
    expect(links).toContain("/xrpl/tx/1A00E4CC5EB143E8BFF4578019BDF45ECEA40C37F113D261ECFB276243858872");
    expect(links).toContain("/xrpl/account/raBkGGTqmGJE2vQENXhkDsAm2BEXZSQpmj");
    expect(links).toContain("/xrpl/ledger/107720688");
    expect(anchors(html).some((a) => a.text === "All in ledger #107,721,455 →")).toBe(true);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("does not print anything that depends on the clock, so the stored page is the same for everyone", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl?case=clock");
    // Ages ("3 s ago") are worked out in the browser; the server prints the close times.
    expect(textOf(html)).not.toMatch(/\d+ (s|min|h|d) ago/);
  });

  it("is stored as class live-home (1 s fresh, then 2 s of stale copy), and the browser must revalidate it", async () => {
    mock = mockUpstream("xrpl");
    const { response } = await page("/xrpl?case=class");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(response.headers.has("X-Cache-Class")).toBe(false);
    expect(await storedAs("/xrpl?case=class")).toEqual({ cls: "live-home", ttl: 1 });
    // The stale window belongs to the class, not to the copy: it is what a reload may be served while one render refreshes it.
    expect(CACHE_CLASSES["live-home"]).toMatchObject({ edgeTtl: 1, swr: 2 });
  });

  it("has the hero search box and no second one in the header", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl?case=search");
    expect(html.match(/role="search"/g)).toHaveLength(1);
    expect(html).toContain("search--hero");
    expect(html).not.toContain("search--header");
    expect(html).toContain('action="/xrpl/search"');
    // NFTS and LEDGER_OBJECTS are on in this project (nfts-off.spec.ts has the words of before): the hero's box names the NFT id and the object id.
    expect(html).toContain("Address, transaction hash, ledger index, CTID, NFT id or object id");
  });

  it("puts the ids the header links to on the two cards", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl?case=anchors");
    expect(html).toMatch(/<section[^>]*id="latest-ledgers"/);
    expect(html).toMatch(/<section[^>]*id="latest-transactions"/);
    expect(hrefs(html)).toContain("/xrpl#latest-ledgers");
    expect(hrefs(html)).toContain("/xrpl#latest-transactions");
  });

  it("suggests searches made of what is on the page, each leading to a page of the explorer", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl?case=examples");
    const links = hrefs(html);
    const ctid = encodeCtid(107721455, 106, 0);
    expect(textOf(html)).toContain("Try");
    expect(links).toContain("/xrpl/tx/1A00E4CC5EB143E8BFF4578019BDF45ECEA40C37F113D261ECFB276243858872");
    expect(links).toContain(`/xrpl/tx/${ctid}`);
    // (The chips are the links of class `example`: a name's title may hold a `.example` domain.)
    expect(anchors(html).filter((a) => /class="example"/.test(a.attrs))).toHaveLength(4);
  });

  it("sets the title and description from the network", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl?case=meta");
    expect(html).toMatch(/<title>[^<]*XRP Ledger[^<]*<\/title>/);
    expect(html).toMatch(/<meta[^>]*name="description"/);
    expect(html).not.toMatch(/name="robots"[^>]*noindex/);
  });
});

describe("the Xahau home", () => {
  // The first success on Xahau in this file (the other asks for the ledger the API lacks and fails first): the test that sees the names call. The fixed cases of the names fixtures
  // are among the newest rows here: a verified account and one whose domain is not verified.
  it("makes one names call, and draws the verified account and the one whose domain is not verified by their names", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau?case=names");
    expect(namesCalls(mock)).toEqual([sorted(accountsOf(XAHAU_ROWS))]);
    // An issuer of an amount is only in a title attribute, never drawn as a name: it is not asked. Some row of these has an issuer that is no row's account, so the check can tell.
    const issuers = XAHAU_ROWS.flatMap((row) => row.amount?.issuer ?? []).filter((issuer) => !accountsOf(XAHAU_ROWS).includes(issuer));
    expect(issuers.length).toBeGreaterThan(0);
    for (const issuer of issuers) expect(namesCalls(mock).flat(), `${issuer} is not asked`).not.toContain(issuer);

    const shown = XAHAU_ROWS.map((row) => row.account);
    const verified = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";
    const unverified = "rJ5mvuNKjbjdghjCn5AGXXJFhJGgqdg9Q5";
    expect(shown).toContain(verified);
    expect(shown).toContain(unverified);
    expect((await viewOf("xahau", verified))?.name?.kind).toBe("verified");
    expect((await viewOf("xahau", unverified))?.name?.kind).toBe("domain");
    // (The search hints are the links of class `example`: the Account hint keeps the short address, spec 5.)
    const hint = /class="example"/;
    for (const address of await namedAmong("xahau", shown)) await expectNamedLinks(html, "xahau", address, shortAddress(address), { ignore: hint });
    const newest = XAHAU_ROWS[0]!.account;
    expect((await viewOf("xahau", newest))?.name, "the newest row's account is named in the fixtures, so that the hint tells").toBeDefined();
    expect(anchors(html).find((a) => hint.test(a.attrs) && a.attrs.includes(`href="/xahau/account/${newest}"`))?.text).toBe(`Account ${shortAddress(newest)}`);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("is the same page for the other network, in its currency and accent", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau?case=content");
    const text = textOf(html);

    expect(html).toContain('data-net="xahau"');
    expect(text).toContain("Explore Xahau");
    expect(text).toMatch(/Xahau mainnet/);
    expect(text).toMatch(/ledger #26,596,843 validated/);
    expect(text).toContain("0.599145 XAH");
    expect(text).toContain("656,916,534 XAH");
    expect(html).toContain('title="656,916,534.912954 XAH"');

    const ledgers = tableRows(html, "Latest ledgers");
    expect(ledgers.slice(1).map((row) => row.slice(0, 3))).toEqual([
      ["#26,596,843", "9", "17:47:11"],
      ["#26,541,060", "16", "10:37:20"],
      ["#26,541,051", "7", "10:36:50"],
      ["#26,540,711", "167", "10:17:01"],
      ["#26,540,613", "154", "10:10:41"],
      ["#26,540,188", "4", "09:45:31"],
      ["#26,540,187", "16", "09:45:30"],
    ]);
    // Seven ledgers in the recordings, so seven rows.
    const txs = tableRows(html, "Latest transactions");
    expect(txs).toHaveLength(9);
    expect(txs[1]!.slice(0, 2)).toEqual(["Invoke", shortHash("FCBFAF21B0CFA8C1712E358C5B413D346EFC69FF6346DF0A390FF23E22AEF2DD")]);
    // An issued amount keeps its currency.
    expect(txs[6]![3]).toBe("1.432450858916131 EVR");
    expect(hrefs(html)).toContain("/xahau/ledger/26596843");
    expect(hrefs(html)).toContain("/xahau/tx/FCBFAF21B0CFA8C1712E358C5B413D346EFC69FF6346DF0A390FF23E22AEF2DD");
    expect(mock.unusedOverrides()).toEqual([]);
  });
});
