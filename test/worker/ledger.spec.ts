import { afterEach, describe, expect, it } from "vitest";

import { shortAddress, shortHash } from "../../app/domain/format";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";
import { anchors, elementText, hrefs, pageClient, tableRows, textOf } from "../support/pages";

// The ledger page, `/{net}/ledger/{index|hash}`, on the real Worker against the recorded answers of the data API and the
// nodes (test/fixtures/http/). Recorded in full: XRPL 107720688 (66 transactions, two accounts created, 3 failed) and
// 107721455 (the head, 107); Xahau 26540187 and 26540188 (consecutive), 26596843 (the head).
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included, so every scenario that
// overrides an answer asks for a ledger no other test asks for.

const { page, get, storedAs } = pageClient("192.0.2");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

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

  it("is immutable: stored for a year, and the browser keeps it a minute", async () => {
    mock = mockUpstream("xrpl");
    const { response } = await page("/xrpl/ledger/107720688");
    expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    expect(response.headers.has("X-Cache-Class")).toBe(false);
    expect(await storedAs("/xrpl/ledger/107720688")).toEqual({ cls: "immutable", ttl: 31_536_000 });
  });

  it("asks the data API for the ledger and for the newest ledger, and nothing else", async () => {
    // The head of Xahau: no other test has asked for it, so nothing is in the cache.
    mock = mockUpstream("xahau");
    await page("/xahau/ledger/26596843");
    expect(mock.requests.map((r) => `${r.net} ${r.key}`).sort()).toEqual([
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

describe("a ledger by hash", () => {
  it("renders the same page, with previous and next by index, and is immutable", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/ledger/${XRPL_LEDGER.hash}`;
    const { html } = await page(path);
    const text = textOf(html);
    expect(text).toContain("Ledger #107,720,688");
    expect(text).toContain(`Ledger hash ${XRPL_LEDGER.hash}`);
    expect(hrefs(html)).toContain("/xrpl/ledger/107720687");
    expect(hrefs(html)).toContain("/xrpl/ledger/107720689");
    expect(await storedAs(path)).toEqual({ cls: "immutable", ttl: 31_536_000 });
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
    expect(await storedAs(path)).toEqual({ cls: "immutable", ttl: 31_536_000 });
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
    expect(await storedAs("/xahau/ledger/26540187")).toEqual({ cls: "immutable", ttl: 31_536_000 });
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
    mock = mockUpstream("xahau", { "GET /v2/ledgers/26540188?expand=true&transactions=true": null });
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
