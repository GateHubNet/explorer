import { encodeAccountID } from "ripple-address-codec";
import { afterEach, describe, expect, it } from "vitest";

import { shortAddress, shortHash } from "../../app/domain/format";
import type { LedgerExpanded } from "../../app/server/api-types";
import { NAMED_PAGE_TTL_SECONDS } from "../../app/server/cache-class";
import { ledgerPage, sourceFromIndex } from "../../app/server/ledger-view";
import { MAX_ACCOUNTS_LISTED } from "../../app/ui/pages/LedgerPage";
import { NAMES_MAX_ADDRESSES } from "../../app/server/names-load";
import { collectAddresses } from "../../app/server/names-collect";
import { answerNamesAfterTheirEnd, expectAccountText, expectLinkedAccountsNamed, expectNamedLinks, inCalls, namedAmong, namesCalls, sorted } from "../support/names";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";
import { anchors, elementText, hrefs, pageClient, tableRows, textOf } from "../support/pages";

// The ledger page, `/{net}/ledger/{index|hash}`, on the real Worker against the recorded answers of the data API and the
// nodes (test/fixtures/http/). Recorded in full: XRPL 107720688 (66 transactions, two accounts created, 3 failed) and
// 107721455 (the head, 107); Xahau 26540187 and 26540188 (consecutive), 26596843 (the head).
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included, so every scenario that
// overrides an answer asks for a ledger no other test asks for.

const { page, get, head, stored, storedAs } = pageClient("192.0.2");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

/** A closed ledger's page while the names are on: kept an hour, not a year (display names decision 2). */
const NAMED = { cls: "immutable", ttl: NAMED_PAGE_TTL_SECONDS };
/** What an `immutable` redirect is stored as: it shows no name. */
const YEAR = { cls: "immutable", ttl: 31_536_000 };

const XRPL_LEDGER = {
  index: 107720688,
  hash: "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02",
  parentHash: "1B116BF6AAB5938BFCF58E5F64DA46B691E3420D6EBEEA25EAE1017766147200",
  accountHash: "CD13165529B32B4151F059707674853F484467D0E06EC6C4A9DF658C32D68B4B",
  transactionHash: "C70DCCA6D031A318EEAD867B202F7AC8BD463FDA3A865C924882561785EF6694",
};

/** The expanded ledger fixtures, to make synthetic ledgers from. */
const rawFixtures = import.meta.glob("../fixtures/http/xrpl/data-api/ledgers/107720688@expand=true&transactions=true.json", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

/** A data API answer for `GET /v2/ledgers/{index}?expand=true&transactions=true` with `count` transactions. */
async function syntheticLedger(index: number, count: number) {
  const [load] = Object.values(rawFixtures);
  const recorded = JSON.parse(await load!()) as { ledger: Record<string, any>; result: string };
  const source = recorded.ledger.transactions as Array<Record<string, any>>;
  const hashOf = (i: number) => (i + 1).toString(16).toUpperCase().padStart(64, "0");
  const transactions = Array.from({ length: count }, (_, i) => {
    const from = source[i % source.length]!;
    return { ...from, hash: hashOf(i), ledger_index: index, meta: { ...from.meta, TransactionIndex: i } };
  });
  const ledgerHash = index.toString(16).toUpperCase().padStart(64, "A");
  return {
    body: { ...recorded, ledger: { ...recorded.ledger, ledger_index: index, ledger_hash: ledgerHash, hash: ledgerHash, transactions } },
    hashOf,
  };
}

/** The page data the loader makes of a data API ledger answer (`body` as `syntheticLedger` and the fixtures have it), for the addresses it collects. */
function pageOf(body: { ledger: unknown }, hasNext = true) {
  return ledgerPage(sourceFromIndex(body.ledger as LedgerExpanded), { native: "XRP", hasNext });
}

/** `collectAddresses` of the parts the loader passes: the rows, and the accounts created that the page lists (the first `MAX_ACCOUNTS_LISTED`; the rest it counts). */
const askedOf = (data: ReturnType<typeof pageOf>) => collectAddresses(data.rows, data.accountsCreated.slice(0, MAX_ACCOUNTS_LISTED));

/** `n` valid addresses, each once, in no order that sorts them. */
function sendersOf(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const bytes = new Uint8Array(20);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, Math.imul(i + 1, 2654435761) >>> 0);
    view.setUint32(16, i + 1);
    return encodeAccountID(bytes);
  });
}

// First in the file: the subrequest cache keeps the answers that worked (the newest ledger for 5 s), so a failing
// /v2/last_validated has to be asked for before any other test has had its answer.
describe("when an upstream fails", () => {
  it("answers 503 when it cannot tell whether the ledger is the newest", async () => {
    const { body } = await syntheticLedger(107700006, 3);
    mock = mockUpstream("xrpl", {
      "GET /v2/last_validated": dataApiError(500, "boom"),
      "GET /v2/ledgers/107700006?expand=true&transactions=true": body,
    });
    const response = await get("/xrpl/ledger/107700006");
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    // The Worker was given the 500 itself, not a failure to connect.
    expect(statusesOf(mock, "GET /v2/last_validated")).toEqual([500]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  // A names call that fails never fails the page: it shows the addresses and is served, not stored, so that the next visitor asks again. The ledger is one no other test asks for.
  it("a failed names call: the addresses, and the page is not stored", async () => {
    const { body } = await syntheticLedger(107700030, 3);
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/107700030?expand=true&transactions=true": body,
      "GET /v2/account_names": dataApiError(503, "unavailable"),
    });
    const first = await get("/xrpl/ledger/107700030");
    const html = await first.text();

    expect(first.status).toBe(200);
    expect(first.headers.get("X-Cache")).toBe("MISS");
    const data = pageOf(body);
    expect(tableRows(html, "Transactions").slice(1).map((row) => row[3])).toEqual(data.rows.map((row) => shortAddress(row.account)));
    expect(namesCalls(mock)).toEqual(inCalls(askedOf(data)));
    expect(await stored("/xrpl/ledger/107700030")).toBeUndefined();

    // Not stored, so the second request is a render too, and asks the names again (a page that is not polled does not hold the failure).
    const second = await get("/xrpl/ledger/107700030");
    await second.text();
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Cache")).toBe("MISS");
    expect(namesCalls(mock)).toHaveLength(2 * inCalls(askedOf(data)).length);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers 503 when the data API fails, and does not ask the node in its place", async () => {
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/107700004?expand=true&transactions=true": dataApiError(503, "unavailable") });
    const response = await get("/xrpl/ledger/107700004");
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    expect(statusesOf(mock, "GET /v2/ledgers/107700004?expand=true&transactions=true")).toEqual([503]);
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  // A 400 for an index or a hash the page has checked is the API's fault, not a missing ledger: a 503 that is not stored, like the transaction
  // page's, and not a 404 that would be stored for 30 s. The node is not asked in its place.
  it.each([
    ["an index", "107700008"],
    ["a hash", "AB00000000000000000000000000000000000000000000000000000000000008"],
  ])("answers 503, not 404, for a 400 of the data API for %s, stores nothing and does not ask the node", async (_what, id) => {
    const key = `GET /v2/ledgers/${id}?expand=true&transactions=true`;
    mock = mockUpstream("xrpl", { [key]: () => dataApiError(400, "invalid ledger identifier") });
    const response = await get(`/xrpl/ledger/${id}`);
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    expect(html).not.toContain("couldn’t find");
    expect(statusesOf(mock, key)).toEqual([400]);
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(await stored(`/xrpl/ledger/${id}`)).toBeUndefined();
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers 503 when the index does not have the ledger and the node cannot be asked", async () => {
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/107700005?expand=true&transactions=true": null,
      "node ledger 107700005": () => new Response("down", { status: 500 }),
    });
    const response = await get("/xrpl/ledger/107700005");
    await response.text();
    expect(response.status).toBe(503);
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("a ledger by index", () => {
  // The first success for this ledger: the Worker keeps the answer of a names call a minute, and this is the test that sees the call.
  it("makes one names call for the accounts of the rows and the accounts created, sorted, and draws the names of the accounts it has them for", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/ledger/107720688");

    const [load] = Object.values(rawFixtures);
    const data = pageOf(JSON.parse(await load!()) as { ledger: unknown });
    // `collectAddresses` of the rows and the accounts created, which the loader passes (not the raw header): in calls of 100, sorted.
    const addresses = askedOf(data);
    expect(namesCalls(mock)).toEqual(inCalls(addresses));
    expect(namesCalls(mock).flat().sort()).toEqual(sorted(addresses));

    // The table's accounts and the accounts created are drawn by what the fixtures say of them: at least one is named.
    const shown = [...new Set([...data.rows.map((row) => row.account), ...data.accountsCreated])];
    const named = await namedAmong("xrpl", shown);
    expect(named.length).toBeGreaterThan(0);
    for (const address of named) await expectNamedLinks(html, "xrpl", address, shortAddress(address));
    for (const row of tableRows(html, "Transactions").slice(1)) {
      const account = data.rows.find((candidate) => String(candidate.index) === row[0])!.account;
      await expectAccountText(row[3]!, "xrpl", account, shortAddress(account));
    }
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("shows the header, the counts, the accounts created and the transactions", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/ledger/107720688");
    const text = textOf(html);

    expect(text).toContain("Ledger #107,720,688");
    expect(text).toContain("Validated");
    expect(text).toContain("XRPL / Ledgers / 107,720,688");

    // Header fields.
    expect(text).toContain("Closed 2026-10-17 16:11:02 UTC");
    expect(text).toContain(`Ledger hash ${XRPL_LEDGER.hash}`);
    expect(text).toContain(`Parent hash ${XRPL_LEDGER.parentHash}`);
    expect(text).toContain("Total supply 99,985,590,049.656326 XRP");
    // The fees of the 66 transactions: 6,252 drops, the dearest 5,000, the cheapest 10.
    expect(text).toContain("Fees burned 0.006252 XRP · min 0.00001 · max 0.005");
    expect(text).toContain("Close time resolution 10 s");
    expect(text).toContain(`Transaction tree hash ${XRPL_LEDGER.transactionHash}`);
    expect(text).toContain(`Account state hash ${XRPL_LEDGER.accountHash}`);
    expect(hrefs(html)).toContain(`/xrpl/ledger/${XRPL_LEDGER.parentHash}`);

    // Counts by result and by type.
    expect(text).toMatch(/Transactions 66/);
    expect(elementText(html, "result__sub")).toBe("63 succeeded · 3 failed (tecPATH_DRY ×3)");
    const chips = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textOf(m[2]!));
    expect(chips).toEqual([
      "All 66",
      "OfferCreate 48",
      "Payment 11",
      "OfferCancel 3",
      "AccountSet 2",
      "EscrowCreate 1",
      "NFTokenCreateOffer 1",
    ]);

    // Accounts created: the count, and the accounts.
    expect(text).toMatch(/Accounts created 2/);
    expect(hrefs(html)).toContain("/xrpl/account/rNdr5eedoze9geAQJPRLa9sKRekEdCFZ71");
    expect(hrefs(html)).toContain("/xrpl/account/rBd2s7CkFMpyiWyEcFLTuvEjXiyqnjvxEf");

    // The transactions, in ledger order: all 66 are under the 100 shown.
    const rows = tableRows(html, "Transactions");
    expect(rows[0]).toEqual(["#", "Type", "Hash", "Account", "What happened", "Result", "Fee (XRP)"]);
    expect(rows).toHaveLength(67);
    expect(rows[1]!.slice(0, 3)).toEqual(["0", "Payment", shortHash("CAD1D63C59541B382D9A4E3B8E26689932B18338F6746D27BB1ED56BEC718181")]);
    expect(rows[1]![3]).toBe(shortAddress("rggDqcUQ1E2CriaMg4YHzkD4YDid26wMe"));
    expect(rows[1]![4]).toMatch(/^Sent .+ to /);
    expect(rows[1]!.slice(5)).toEqual(["Success", "0.00001"]);
    expect(rows[2]![1]).toBe("AccountSet");
    expect(rows[2]![6]).toBe("0.000012");
    expect(rows.map((row) => row[0]).slice(1)).toEqual(Array.from({ length: 66 }, (_, i) => String(i)));
    // A failure shows its code, and its sentence says what was attempted.
    const failed = rows.find((row) => row[5] === "tecPATH_DRY")!;
    expect(failed[0]).toBe("63");
    expect(failed[4]).toMatch(/^Tried to /);
    expect(hrefs(html)).toContain("/xrpl/tx/CAD1D63C59541B382D9A4E3B8E26689932B18338F6746D27BB1ED56BEC718181");
    expect(hrefs(html)).toContain("/xrpl/account/rggDqcUQ1E2CriaMg4YHzkD4YDid26wMe");
    expect(text).toContain("Showing 66 of 66, in ledger order");
    expect(text).not.toContain("Show all");

    // The raw header.
    expect(text).toContain("Raw ledger header");
    expect(html).toContain(`&quot;ledger_hash&quot;: &quot;${XRPL_LEDGER.hash}&quot;`);
    expect(html).toContain('&quot;total_coins&quot;: &quot;99985590049656326&quot;');
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("links to the previous and the next ledger", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/ledger/107720688");
    const links = anchors(html);
    const previous = links.find((a) => a.attrs.includes('aria-label="107,720,687, previous ledger"'));
    const next = links.find((a) => a.attrs.includes('aria-label="107,720,689, next ledger"'));
    expect(previous?.attrs).toContain('href="/xrpl/ledger/107720687"');
    expect(previous?.text).toBe("107,720,687");
    expect(next?.attrs).toContain('href="/xrpl/ledger/107720689"');
    expect(next?.text).toBe("107,720,689");
  });

  it("is immutable: stored for an hour while it shows names (not a year), and the browser keeps it a minute", async () => {
    mock = mockUpstream("xrpl");
    const { response } = await page("/xrpl/ledger/107720688");
    expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    expect(response.headers.has("X-Cache-Class")).toBe(false);
    expect(await storedAs("/xrpl/ledger/107720688")).toEqual(NAMED);
  });

  it("asks the data API for the ledger, for the newest ledger and for the names, and nothing else", async () => {
    // The head of Xahau: no other test has asked for it, so nothing is in the cache.
    mock = mockUpstream("xahau");
    await page("/xahau/ledger/26596843");
    const names = mock.requests.filter((r) => r.url.includes("/v2/account_names"));
    expect(names.length).toBeGreaterThan(0);
    expect(mock.requests.filter((r) => !names.includes(r)).map((r) => `${r.net} ${r.key}`).sort()).toEqual([
      "xahau GET /v2/last_validated",
      "xahau GET /v2/ledgers/26596843?expand=true&transactions=true",
    ]);
  });

  it("sets a title with the ledger and the network, and is indexable", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/ledger/107720688");
    expect(html).toMatch(/<title>[^<]*Ledger #107,720,688[^<]*XRPL[^<]*<\/title>/);
    expect(html).toMatch(/<meta[^>]*name="description"[^>]*content="[^"]*107,720,688[^"]*66 transactions/);
    expect(html).not.toMatch(/name="robots"[^>]*noindex/);
  });

  it("does not print anything that depends on the clock", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/ledger/107720688");
    expect(textOf(html)).not.toMatch(/\d+ (s|min|h|d) ago/);
  });
});

// A HEAD is the GET without the body: the loaders run once for it, on a miss, and never for a hit.
describe("HEAD", () => {
  it("runs the loader once, answers without a body, and leaves the page that a GET and a second HEAD are served from", async () => {
    const { body } = await syntheticLedger(107700020, 3);
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/107700020?expand=true&transactions=true": body });
    const first = await head("/xrpl/ledger/107700020");
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect(first.headers.get("Content-Type")).toContain("text/html");
    expect(first.headers.get("Cache-Control")).toBe("max-age=60");
    expect((await first.arrayBuffer()).byteLength).toBe(0);
    const asked = mock.requests.map((r) => r.key);
    expect(asked.filter((key) => key === "GET /v2/ledgers/107700020?expand=true&transactions=true")).toHaveLength(1);
    expect(await storedAs("/xrpl/ledger/107700020")).toEqual(NAMED);

    const full = await page("/xrpl/ledger/107700020");
    expect(full.response.headers.get("X-Cache")).toBe("HIT");
    expect(textOf(full.html)).toContain("Ledger #107,700,020");
    const second = await head("/xrpl/ledger/107700020");
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect((await second.arrayBuffer()).byteLength).toBe(0);
    expect(mock.requests.map((r) => r.key)).toEqual(asked);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("is a 404 without a body for a ledger nobody has, and a redirect without one for an index with leading zeros", async () => {
    mock = mockUpstream("xrpl");
    const missing = await head("/xrpl/ledger/99999997");
    expect(missing.status).toBe(404);
    expect((await missing.arrayBuffer()).byteLength).toBe(0);
    const moved = await head("/xrpl/ledger/0107720688");
    expect(moved.status).toBe(302);
    expect(moved.headers.get("Location")).toBe("/xrpl/ledger/107720688");
    expect((await moved.arrayBuffer()).byteLength).toBe(0);
  });
});

describe("a ledger by hash", () => {
  it("renders the same page, with previous and next by index, and is immutable (an hour, with names)", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/ledger/${XRPL_LEDGER.hash}`;
    const { html } = await page(path);
    const text = textOf(html);
    expect(text).toContain("Ledger #107,720,688");
    expect(text).toContain(`Ledger hash ${XRPL_LEDGER.hash}`);
    expect(hrefs(html)).toContain("/xrpl/ledger/107720687");
    expect(hrefs(html)).toContain("/xrpl/ledger/107720689");
    expect(await storedAs(path)).toEqual(NAMED);
  });

  it("redirects a lower-case hash to the upper-case URL, as an immutable redirect, without asking the API", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/ledger/${XRPL_LEDGER.hash.toLowerCase()}`;
    const response = await get(path);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/ledger/${XRPL_LEDGER.hash}`);
    expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    expect(response.headers.has("X-Cache-Class")).toBe(false);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(YEAR);
  });

  it("redirects a mixed-case hash too", async () => {
    mock = mockUpstream("xrpl");
    const mixed = `${XRPL_LEDGER.hash.slice(0, 32)}${XRPL_LEDGER.hash.slice(32).toLowerCase()}`;
    const response = await get(`/xrpl/ledger/${mixed}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/ledger/${XRPL_LEDGER.hash}`);
  });

  it("redirects an index with leading zeros to the plain one", async () => {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl/ledger/0107720688");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/xrpl/ledger/107720688");
    expect(mock.requests).toEqual([]);
  });
});

describe("the newest ledger", () => {
  it("has no next ledger, and is live: stored for 5 s, revalidated by the browser", async () => {
    mock = mockUpstream("xrpl");
    const { response, html } = await page("/xrpl/ledger/107721455");
    const text = textOf(html);
    expect(text).toContain("Ledger #107,721,455");
    expect(text).toMatch(/Transactions 107/);
    expect(elementText(html, "result__sub")).toBe("91 succeeded · 16 failed (tecKILLED ×16)");

    // Previous is a link; next is there, disabled, and leads nowhere.
    const links = anchors(html);
    expect(links.find((a) => a.attrs.includes('aria-label="107,721,454, previous ledger"'))?.attrs).toContain('href="/xrpl/ledger/107721454"');
    expect(links.some((a) => a.attrs.includes("next ledger"))).toBe(false);
    expect(hrefs(html)).not.toContain("/xrpl/ledger/107721456");
    expect(html).toMatch(/<span[^>]*aria-disabled="true"[^>]*>[\s\S]*?107,721,456/);

    expect(response.headers.get("Cache-Control")).toBe("max-age=0, must-revalidate");
    expect(await storedAs("/xrpl/ledger/107721455")).toEqual({ cls: "live", ttl: 5 });
  });

  it("shows the 'Other' filter when more than seven types were used", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/ledger/107721455");
    const chips = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textOf(m[2]!));
    // 9 types: All, the 7 commonest, and the 2 rarest together.
    expect(chips).toEqual([
      "All 107",
      "OfferCreate 46",
      "Batch 22",
      "OfferCancel 22",
      "Payment 6",
      "NFTokenAcceptOffer 5",
      "AccountSet 2",
      "NFTokenCreateOffer 2",
      "Other 2",
    ]);
  });
});

describe("a Xahau ledger", () => {
  it("is in the network's currency and accent, with its neighbours", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/ledger/26540187");
    const text = textOf(html);
    expect(html).toContain('data-net="xahau"');
    expect(text).toContain("Ledger #26,540,187");
    expect(text).toContain("Total supply 656,795,720.772722 XAH");
    expect(text).toContain("Fees burned 0.107424 XAH · min 0.00001 · max 0.00863");
    expect(tableRows(html, "Transactions")[0]![6]).toBe("Fee (XAH)");
    expect(tableRows(html, "Transactions")).toHaveLength(17);
    expect(hrefs(html)).toContain("/xahau/ledger/26540186");
    expect(hrefs(html)).toContain("/xahau/ledger/26540188");
    expect(hrefs(html)).toContain("/xahau/tx/4994AD06C32ED4EE31BF87F9FE9BC8EC7F7BDF1AA3B440272558EAE07B6A9383");
    expect(text).toContain("Payment 14");
    expect(await storedAs("/xahau/ledger/26540187")).toEqual(NAMED);
  });
});

describe("a ledger with a great many transactions", () => {
  it("renders 100 rows and a 'Show all 1,500' control; the other rows are already in the page", async () => {
    const { body, hashOf } = await syntheticLedger(107700001, 1500);
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/107700001?expand=true&transactions=true": body });
    const { html } = await page("/xrpl/ledger/107700001");
    const text = textOf(html);

    expect(text).toMatch(/Transactions 1,500/);
    expect(tableRows(html, "Transactions")).toHaveLength(101);
    expect(text).toContain("Showing 100 of 1,500, in ledger order");
    const button = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textOf(m[1]!)).find((t) => t.startsWith("Show all"));
    expect(button).toBe("Show all 1,500");

    // Showing the rest asks for nothing: the loader's data carries every row (the last one's hash is in the page, once
    // as data and not as a row).
    expect(html).toContain(hashOf(1499));
    expect(html).toContain(hashOf(100));
    expect(hrefs(html)).not.toContain(`/xrpl/tx/${hashOf(1499)}`);
    expect(hrefs(html)).toContain(`/xrpl/tx/${hashOf(99)}`);
    expect(hrefs(html)).not.toContain(`/xrpl/tx/${hashOf(100)}`);
    // (The newest ledger may be in the cache from an earlier test.)
    expect(mock.requests.map((r) => r.key).filter((key) => key !== "GET /v2/last_validated")).toEqual([
      "GET /v2/ledgers/107700001?expand=true&transactions=true",
    ]);
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("a ledger of 450 accounts", () => {
  // Past `NAMES_MAX_ADDRESSES` (400) the first ones collected are named, in calls of 100, and the page still shows the others as they are.
  it("a ledger of 450 accounts: four calls of 100, sorted", async () => {
    const { body } = await syntheticLedger(107700040, 450);
    const senders = sendersOf(450);
    const ledger = body.ledger as unknown as { transactions: Array<{ tx: Record<string, unknown> }> };
    ledger.transactions.forEach((entry, i) => {
      entry.tx = { ...entry.tx, Account: senders[i] };
    });
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/107700040?expand=true&transactions=true": body });
    const { response, html } = await page("/xrpl/ledger/107700040");

    // The first 400 addresses `collectAddresses` meets, sorted, in four calls of 100 (the calls are made side by side, so they arrive in no order).
    const data = pageOf(body);
    const first = askedOf(data);
    expect(first.length).toBeGreaterThan(NAMES_MAX_ADDRESSES);
    const calls = namesCalls(mock).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
    expect(calls.map((call) => call.length)).toEqual([100, 100, 100, 100]);
    expect(calls).toEqual(inCalls(first.slice(0, NAMES_MAX_ADDRESSES)));
    for (const call of calls) expect(call).toEqual(sorted(call));
    // The addresses past the limit are not asked for, and the page is whole.
    const skipped = first.slice(NAMES_MAX_ADDRESSES);
    expect(namesCalls(mock).flat()).not.toContain(skipped[0]);
    expect(tableRows(html, "Transactions")).toHaveLength(101);
    expect(response.headers.get("X-Cache")).toBe("MISS");
    expect(await storedAs("/xrpl/ledger/107700040")).toEqual(NAMED);
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("a ledger that created more accounts than it lists", () => {
  // The page lists the first `MAX_ACCOUNTS_LISTED` accounts created and counts the rest ("and 2 more"): only the listed ones are on the screen, so only they are named.
  it("asks the names of the accounts created that the page lists, not of the ones it only counts", async () => {
    const { body } = await syntheticLedger(107700050, 3);
    const created = sendersOf(MAX_ACCOUNTS_LISTED + 2);
    const nodes = created.map((account, i) => ({
      CreatedNode: { LedgerEntryType: "AccountRoot", LedgerIndex: (i + 1).toString(16).toUpperCase().padStart(64, "0"), NewFields: { Account: account, Balance: "20000000", Sequence: 1 } },
    }));
    const ledger = body.ledger as unknown as { transactions: Array<{ meta: { AffectedNodes: unknown[] } }> };
    ledger.transactions[0]!.meta.AffectedNodes.push(...nodes);
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/107700050?expand=true&transactions=true": body });
    const { html } = await page("/xrpl/ledger/107700050");

    // (The copies of recorded transactions the synthetic ledger is made of create an account too, which is first: the page lists five of all of them and counts the rest.)
    const data = pageOf(body);
    const listed = data.accountsCreated.slice(0, MAX_ACCOUNTS_LISTED);
    const counted = data.accountsCreated.slice(MAX_ACCOUNTS_LISTED);
    expect(data.accountsCreated).toEqual(expect.arrayContaining(created));
    expect(counted.length).toBeGreaterThanOrEqual(2);
    expect(textOf(html)).toContain(`and ${counted.length} more`);
    // None of the counted is in a row (the check can tell the listed from the counted), and the page links the listed.
    const inRows = collectAddresses(data.rows);
    for (const account of counted) {
      expect(inRows).not.toContain(account);
      expect(hrefs(html)).not.toContain(`/xrpl/account/${account}`);
    }
    for (const account of listed) expect(hrefs(html)).toContain(`/xrpl/account/${account}`);

    const asked = namesCalls(mock).flat();
    expect(namesCalls(mock)).toEqual(inCalls(askedOf(data)));
    for (const account of listed) expect(asked).toContain(account);
    for (const account of counted) expect(asked).not.toContain(account);
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("a ledger without transactions", () => {
  it("says so, and still has its header", async () => {
    const { body } = await syntheticLedger(107700003, 0);
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/107700003?expand=true&transactions=true": body });
    const { html } = await page("/xrpl/ledger/107700003");
    const text = textOf(html);
    expect(text).toContain("Ledger #107,700,003");
    expect(text).toMatch(/Transactions 0/);
    expect(text).toContain("No transactions in this ledger.");
    expect(text).toContain("Fees burned 0 XRP");
    expect(text).toMatch(/Accounts created 0/);
    expect(tableRows(html, "Transactions")).toHaveLength(1);
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("a ledger the index does not have yet", () => {
  it("is shown from the node, with a note, and kept for 60 s", async () => {
    // The data API has no such ledger (the override), the node has validated it (its fixture).
    // The page from the node is named too. The names are the test's own (each account asked for is named after its end), so that the test does not depend on which of the
    // ledger's accounts the fixtures name.
    mock = mockUpstream("xahau", {
      "GET /v2/ledgers/26540188?expand=true&transactions=true": null,
      "GET /v2/account_names": answerNamesAfterTheirEnd(),
    });
    const { response, html } = await page("/xahau/ledger/26540188");
    const text = textOf(html);

    expect(text).toContain("Not in the index yet, shown from the network");
    expect(text).toContain("Ledger #26,540,188");
    expect(text).toContain("Ledger hash CC657D821B26FF8B9B3A95FA460C1731AD4350C9A206503C1C32E0421D9E9845");
    // The node counts time from 2000: the page shows the real date.
    expect(text).toContain("Closed 2026-10-15 09:45:31 UTC");
    expect(text).toContain("Total supply 656,795,736.625711 XAH");
    expect(text).toContain("Close time resolution 10 s");
    expect(tableRows(html, "Transactions")).toHaveLength(5);
    expect(text).toContain("Fees burned 0.014122 XAH · min 0 · max 0.007056");
    expect(hrefs(html)).toContain("/xahau/ledger/26540187");
    expect(hrefs(html)).toContain("/xahau/ledger/26540189");

    expect(mock.requests.some((r) => r.kind === "node" && r.key.startsWith("node ledger"))).toBe(true);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(await storedAs("/xahau/ledger/26540188")).toEqual({ cls: "short", ttl: 60 });

    // Its accounts are named: the page asked for the ones it links, and draws each by its name and the title of how it is known.
    expectLinkedAccountsNamed(mock, html, "xahau");
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("does not show the note for a ledger the index has", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/ledger/26540187");
    expect(textOf(html)).not.toContain("Not in the index yet");
  });
});

describe("a ledger that does not exist", () => {
  it("is a 404 page when neither the index nor the node has it, stored for 30 s", async () => {
    mock = mockUpstream("xrpl");
    const { response, html } = await page("/xrpl/ledger/99999999", 404);
    expect(textOf(html)).toContain("We couldn’t find ledger 99999999 on XRPL");
    expect(html).toMatch(/<meta[^>]*name="robots"[^>]*content="noindex"/);
    expect(html).toContain('action="/xrpl/search"');
    // It asked the index, then the node.
    expect(mock.requests.some((r) => r.kind === "data-api" && r.status === 404)).toBe(true);
    expect(mock.requests.some((r) => r.kind === "node")).toBe(true);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(await storedAs("/xrpl/ledger/99999999")).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 for a hash nobody has", async () => {
    mock = mockUpstream("xrpl");
    const hash = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";
    const { html } = await page(`/xrpl/ledger/${hash}`, 404);
    expect(textOf(html)).toContain(`We couldn’t find ledger ${shortHash(hash)} on XRPL`);
  });

  // The transaction page offers the same search on the other network, and so does the ledger page for a hash: a hash that is no ledger here
  // may be one there. An index is a number on every network, so it gets no offer.
  it("offers the same search on the other network for a hash, as the transaction page does", async () => {
    mock = mockUpstream("xrpl");
    const hash = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456780";
    const { response, html } = await page(`/xrpl/ledger/${hash}`, 404);
    expect(anchors(html).find((a) => a.text === "Search on Xahau")?.attrs).toContain(`href="/xahau/search?q=${hash}"`);
    expect(html).toContain('action="/xrpl/search"');
    expect(hrefs(html)).toContain("/xrpl");
    expect(await storedAs(`/xrpl/ledger/${hash}`)).toEqual({ cls: "short", ttl: 30 });
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
  });

  it("offers XRPL's search from Xahau", async () => {
    mock = mockUpstream("xahau");
    const hash = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456781";
    const { html } = await page(`/xahau/ledger/${hash}`, 404);
    expect(anchors(html).find((a) => a.text === "Search on XRPL")?.attrs).toContain(`href="/xrpl/search?q=${hash}"`);
  });

  it("offers nothing for an index, which is a number on both networks", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/ledger/99999998", 404);
    expect(textOf(html)).toContain("We couldn’t find ledger 99999998 on XRPL");
    expect(textOf(html)).not.toContain("Search on");
    expect(anchors(html).map((a) => a.text)).not.toContain("Search on Xahau");
  });

  it("offers nothing for an id that is neither (no hash to search for)", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/ledger/not-a-ledger", 404);
    expect(textOf(html)).not.toContain("Search on");
  });

  it("offers the search on the client-side navigation to it too, in the loader data", async () => {
    mock = mockUpstream("xrpl");
    const hash = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456782";
    const response = await get(`/xrpl/ledger/${hash}.data`);
    const body = await response.text();
    expect(response.status).toBe(404);
    expect(body).toContain(`/xahau/search?q=${hash}`);
    expect(body).toContain("Search on Xahau");
  });

  it.each(["abc", "12345678901", "0x1F", "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC0", "-5"])(
    "is a 404 for %s, without asking anyone",
    async (id) => {
      mock = mockUpstream("xrpl");
      const { html } = await page(`/xrpl/ledger/${encodeURIComponent(id)}`, 404);
      expect(textOf(html)).toContain("We couldn’t find ledger");
      expect(mock.requests).toEqual([]);
    },
  );
});
