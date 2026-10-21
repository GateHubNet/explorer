import { afterEach, describe, expect, it } from "vitest";

import { encodeCtid } from "../../app/domain/ctid";
import { formatAmount, shortAddress, shortHash } from "../../app/domain/format";
import { anchors, elementText, hrefs, pageClient, tableRows, textOf } from "../support/pages";
import { recordedHashes } from "../support/ledger-hashes";
import { dataApiError, mockUpstream, type UpstreamMock } from "../support/upstream";

// The transaction page, `/{net}/tx/{hash|ctid}`, on the real Worker against the recorded answers of the data API and the
// nodes (test/fixtures/http/). The transactions used have files there (test/fixtures/http/<net>/data-api/transactions/),
// and so do the `?binary=true` answers and the hashes of their ledgers.
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included, so every scenario that
// overrides an answer asks for a transaction (and a ledger) no other scenario asks for, and the failures come first.

const { page, get, stored, storedAs } = pageClient("192.0.2");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

const files = import.meta.glob("../fixtures/http/*/data-api/transactions/*.json", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

type Net = "xrpl" | "xahau";
interface Recorded {
  hash: string;
  ledger_index: number;
  date: string;
  tx: Record<string, any>;
  meta: Record<string, any>;
}
async function recorded(net: Net, hash: string, binary = false): Promise<Recorded> {
  const load = files[`../fixtures/http/${net}/data-api/transactions/${hash}${binary ? "@binary=true" : ""}.json`];
  if (!load) throw new Error(`no fixture for ${net} ${hash}`);
  return (JSON.parse(await load()) as { transaction: Recorded }).transaction;
}

/** Whether a page is one a search engine is asked to leave out of its index. */
function robots(html: string): string | undefined {
  const tag = [...html.matchAll(/<meta\s[^>]*>/g)].map((m) => m[0]).find((t) => /\bname="robots"/.test(t));
  return tag && /\bcontent="([^"]*)"/.exec(tag)?.[1];
}

/** The upstream keys of the requests a mock has seen. */
const keys = (m: UpstreamMock) => m.requests.map((request) => `${request.net} ${request.key}`);

// XRPL: a plain XRP Payment (ledger 102186243, place 63), a Payment through an AMM pool (107694747, place 0, the first of its
// ledger), the last transaction of the newest recorded ledger (a Batch, 107721455, place 106 of 107), an OfferCreate that failed
// with tecKILLED and has a memo (107721455, place 99). Xahau: a Remit (26540613, place 88).
const PAYMENT = "AACAFCFEBB5C970049A576CBFE6EF544A47EE3ADBA99122FA43234D18D5FFD40";
const SWAP = "52E2AD5B382D4588BECF6A743E7AE5C84D49A5C06968EC7700E8333BF41E1C60";
const LAST_OF_LEDGER = "1A00E4CC5EB143E8BFF4578019BDF45ECEA40C37F113D261ECFB276243858872";
const KILLED = "D05D52934A382E975B131A3E729CDA7CA3C59E94CE9F3DC3DC91A6ADFC5C140F";
const REMIT = "8C50C44787A12B785AA62377D0AFA6C4711E8E07EF68BA6E83DC286F7EE79AAF";

const OWNED = { cls: "immutable", ttl: 31_536_000 };

// An override may be a function or a `Response` value (the mock captures a value's status, headers and body when it is made); this file
// uses functions.

// First in the file: a failed call is never stored, but the answers that worked are, so a failing one is asked for before
// anything has been, and for transactions and ledgers that nothing else in the file asks for.
describe("when an upstream fails", () => {
  it("answers 503 when the data API fails, does not ask the node in its place, and stores nothing", async () => {
    const hash = "2C9538843C61FE4120577EDCD885C9B4E6AC6694C9DF3603528B81A2D9FC084A";
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: () => dataApiError(503, "unavailable") });
    const response = await get(`/xrpl/tx/${hash}`);
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
    expect(await stored(`/xrpl/tx/${hash}`)).toBeUndefined();
  });

  it("answers 503 when the data API is limiting us", async () => {
    const hash = "9C4D48A7F44A7A58DEBE2F31525966684E74A51F407BD7A837A41326BB3C9743";
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: () => dataApiError(429, "slow down", { "Retry-After": "7" }) });
    const response = await get(`/xrpl/tx/${hash}`);
    await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it("shows the page with a Binary tab that says it could not be loaded, and stores it short, never immutable", async () => {
    const hash = "52FC2BE167D21568A673B62B98559721C5991FDB4B4654DCD4C955306D3892EB";
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}?binary=true`]: () => dataApiError(500, "boom") });
    const { response, html } = await page(`/xrpl/tx/${hash}`);
    const text = textOf(html);

    expect(text).toContain("Payment");
    expect(text).toContain("The binary form could not be loaded just now.");
    // The rest is all there, and the other tabs are not hurt.
    expect(text).toContain(`Hash ${hash}`);
    expect(text).toContain("Next · #79");
    expect(text).toContain('"TransactionType": "Payment"');
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(await storedAs(`/xrpl/tx/${hash}`)).toEqual({ cls: "short", ttl: 30 });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("shows the Binary tab's note when the binary form is not in the answer at all", async () => {
    const hash = "FDE327991B2702E7BF849A36487CEA0DE9BB307F5110F1621C9B8EEE6696AC5F";
    mock = mockUpstream("xahau", { [`GET /v2/transactions/${hash}?binary=true`]: { result: "success", transaction: { hash, ledger_index: 26541051 } } });
    const { html } = await page(`/xahau/tx/${hash}`);
    expect(textOf(html)).toContain("The binary form could not be loaded just now.");
    expect(await storedAs(`/xahau/tx/${hash}`)).toEqual({ cls: "short", ttl: 30 });
  });

  it("answers 503 when the transactions of its ledger cannot be read: an immutable page must not store a missing neighbour", async () => {
    const hash = "2D66C6FD02977F96126FB352AAD691CA556790DBF71E0CDF3B701E18A49B9427";
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/106084525?transactions=true": () => dataApiError(500, "boom") });
    const response = await get(`/xrpl/tx/${hash}`);
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    expect(mock.unusedOverrides()).toEqual([]);
    expect(await stored(`/xrpl/tx/${hash}`)).toBeUndefined();
  });

  it("answers 503, not 404, when the ledger the transaction is in is 'not found': the API returned the transaction in it", async () => {
    const hash = "EF35220095FC32B7036D130A460CFB31B80BAF973C0C7F7A9812B0665E33701B";
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/107644916?transactions=true": null });
    const response = await get(`/xrpl/tx/${hash}`);
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(html).toContain("Temporarily unavailable");
    expect(html).not.toContain("couldn’t find");
  });

  it("answers 503 when the ledger's list does not hold the transaction at its place", async () => {
    const hash = "B44F14E085567F8C25DD20456FCAD9B0A289BA2EA2AB3469D6F29E582059F63F";
    const list = Array.from({ length: 60 }, (_, i) => (i + 1).toString(16).toUpperCase().padStart(64, "0"));
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/100132150?transactions=true": { result: "success", ledger: { ledger_index: 100132150, transactions: list } },
    });
    const response = await get(`/xrpl/tx/${hash}`);
    await response.text();
    expect(response.status).toBe(503);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers 503 when the answer for the transaction has no transaction in it", async () => {
    const hash = "781C5A2707D3A3E9BB00B483A8719345A6ECF0E5532E0CB5FA4016E1D5D6A832";
    mock = mockUpstream("xrpl", {
      [`GET /v2/transactions/${hash}`]: { result: "success", transaction: { hash, ledger_index: 105257303, date: "2026-10-15T11:19:30+00:00" } },
    });
    const response = await get(`/xrpl/tx/${hash}`);
    await response.text();
    expect(response.status).toBe(503);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers 503 when the index does not have the transaction and the node cannot be asked", async () => {
    const hash = "4F2B0756C721F7DAE0016F3B7481601377241BE63B8C5A1BD90F4ECA732D8CA8";
    mock = mockUpstream("xrpl", {
      [`GET /v2/transactions/${hash}`]: null,
      [`node tx ${hash}`]: () => new Response("down", { status: 500 }),
    });
    const response = await get(`/xrpl/tx/${hash}`);
    await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers 503 when the node's answer for the transaction is not a transaction", async () => {
    const hash = "2D6FF646176D364EAD12395D67CCA6D459E1875F537D035D9B10B7754ACA07A3";
    mock = mockUpstream("xrpl", {
      [`GET /v2/transactions/${hash}`]: null,
      [`node tx ${hash}`]: { status: "success", validated: true, ledger_index: 107711512, date: 845378370, hash },
    });
    const response = await get(`/xrpl/tx/${hash}`);
    await response.text();
    expect(response.status).toBe(503);
  });
});

// A 400 for a hash that is 64 hex digits is the API's fault (the name is one it must take), not a transaction that does not exist.
describe("when the upstream refuses a well-formed hash", () => {
  it("answers 503 for a 400 of the data API, not a 404 that would be stored, and does not ask the node", async () => {
    const hash = "8F2DCA944394B29981E24DDD6C46192C404D90F7F5FC4EAB6813B0AFD7751A2D";
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: () => dataApiError(400, "invalid hash") });
    const response = await get(`/xrpl/tx/${hash}`);
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(html).toContain("Temporarily unavailable");
    expect(html).not.toContain("couldn’t find");
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(mock.unusedOverrides()).toEqual([]);
    expect(await stored(`/xrpl/tx/${hash}`)).toBeUndefined();
  });

  it("answers 503 for a node that finds the hash malformed, after a data API that does not have it", async () => {
    const hash = "B9A146300E7755D109BF92B6B51725B8C45BA1CCFB6683C0E01DA679B2FB0675";
    mock = mockUpstream("xrpl", {
      [`GET /v2/transactions/${hash}`]: null,
      [`node tx ${hash}`]: { status: "error", error: "invalidParams", error_message: "Invalid field 'transaction'." },
    });
    const response = await get(`/xrpl/tx/${hash}`);
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(html).not.toContain("couldn’t find");
    expect(mock.unusedOverrides()).toEqual([]);
    expect(await stored(`/xrpl/tx/${hash}`)).toBeUndefined();
  });
});

// The subrequest cache keeps an answer of the data API for a year (class immutable), so an answer that a page cannot use must never
// get there: the client checks it inside the load the cache runs. Each scenario asks twice for something the first answer spoiled,
// and the second answer, from the fixtures, must be seen. (A page stored short stands for 30 s at the edge, so the second request
// is for the same transaction under another URL, which is another key of the edge cache and the same keys of the subrequest cache.)
describe("a 200 that is not what the API promises is never stored", () => {
  const SPOILT_TX = "7D16D6C749CAB260C906BEC2D9CF9B37F7D1D36F26421873CF838C9BCDF056AD";
  const SPOILT_LIST_TX = "423839F3B288D53874DAECE9AE3ACCE2A23E20E2C16E5DA594F425907D9E2052";
  const JUNK_LIST_TX = "A6D2AB0623B1874F35E0884BC42A82A18389627317EE1A93E61A4CF0B43E915B";
  const SPOILT_BINARY_TX = "A0EE5458F913A115FC3BA022BDC227FBBCE81236DDF4A6B2BEA06BAEFAA8C1CE";

  it("a transaction without its tx is a 503, and the transaction is there when the API answers properly", async () => {
    const date = "2026-10-15T11:19:30+00:00";
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${SPOILT_TX}`]: { result: "success", transaction: { hash: SPOILT_TX, ledger_index: 107671538, date } } });
    const spoilt = await get(`/xrpl/tx/${SPOILT_TX}`);
    await spoilt.text();
    expect(spoilt.status).toBe(503);
    expect(mock.unusedOverrides()).toEqual([]);
    mock.restore();

    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${SPOILT_TX}`);
    expect(html).toMatch(/<h1[^>]*>[^<]*<\/h1>/);
    expect(textOf(html)).toContain(`Hash ${SPOILT_TX}`);
    expect(mock.requests.some((r) => r.key === `GET /v2/transactions/${SPOILT_TX}` && r.source === "fixture")).toBe(true);
    expect(await storedAs(`/xrpl/tx/${SPOILT_TX}`)).toEqual(OWNED);
  });

  it("a ledger answer without its list of transactions is a 503, not an empty ledger, and the neighbours are there afterwards", async () => {
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/107671591?transactions=true": { result: "success", ledger: { ledger_index: 107671591, ledger_hash: "AB".repeat(32) } },
    });
    const spoilt = await get(`/xrpl/tx/${SPOILT_LIST_TX}`);
    await spoilt.text();
    expect(spoilt.status).toBe(503);
    expect(mock.unusedOverrides()).toEqual([]);
    mock.restore();

    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${SPOILT_LIST_TX}`);
    const hashes = await recordedHashes("xrpl", 107671591);
    expect(textOf(html)).toContain(`transaction 50 of ${hashes.length}`);
    expect(anchors(html).find((a) => a.text === "Next · #51")?.attrs).toContain(`href="/xrpl/tx/${hashes[51]}"`);
    expect(await storedAs(`/xrpl/tx/${SPOILT_LIST_TX}`)).toEqual(OWNED);
  });

  it("a ledger's list with something that is not a hash in it is a 503 too, and a good list is read afterwards", async () => {
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/107671607?transactions=true": { result: "success", ledger: { ledger_index: 107671607, transactions: ["../../etc/passwd"] } },
    });
    const spoilt = await get(`/xrpl/tx/${JUNK_LIST_TX}`);
    await spoilt.text();
    expect(spoilt.status).toBe(503);
    mock.restore();

    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${JUNK_LIST_TX}`);
    expect(textOf(html)).toContain("transaction 37 of");
  });

  it("a binary form that is not hex gives the page without it, stored short and with a Binary tab that is true, and the hex is there afterwards", async () => {
    const date = "2026-10-15T11:19:30+00:00";
    mock = mockUpstream("xrpl", {
      [`GET /v2/transactions/${SPOILT_BINARY_TX}?binary=true`]: {
        result: "success",
        transaction: { hash: SPOILT_BINARY_TX, ledger_index: 107671568, date, tx: "this is not hex", meta: "AB" },
      },
    });
    const first = await page(`/xrpl/tx/${SPOILT_BINARY_TX}`);
    const text = textOf(first.html);
    expect(text).toContain("The binary form could not be loaded just now.");
    // What it says is true: asking again can help.
    expect(text).toContain("Try again in a minute.");
    expect(text).not.toContain("Reload");
    expect(await storedAs(`/xrpl/tx/${SPOILT_BINARY_TX}`)).toEqual({ cls: "short", ttl: 30 });
    expect(mock.unusedOverrides()).toEqual([]);
    mock.restore();

    // The same transaction under another URL: another entry of the edge cache, the same of the subrequest cache.
    mock = mockUpstream("xrpl");
    const again = await page(`/xrpl/tx/${SPOILT_BINARY_TX}?again=1`);
    const binary = await recorded("xrpl", SPOILT_BINARY_TX, true);
    expect(textOf(again.html)).toContain(binary.tx as unknown as string);
    expect(textOf(again.html)).not.toContain("could not be loaded");
    expect(await storedAs(`/xrpl/tx/${SPOILT_BINARY_TX}?again=1`)).toEqual(OWNED);
  });

  it("says in a log line why a binary form was not taken", async () => {
    const hash = "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B";
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      mock = mockUpstream("xrpl", {
        [`GET /v2/transactions/${hash}?binary=true`]: { result: "success", transaction: { hash, ledger_index: 107671558, date: "2026-10-15T11:19:30+00:00", tx: "nothex", meta: "AB" } },
      });
      await page(`/xrpl/tx/${hash}`);
    } finally {
      console.error = original;
    }
    const line = errors.find((e) => e.includes("binary"));
    expect(line, errors.join("\n")).toBeDefined();
    expect(line).toContain("binary form");
    expect(line).toMatch(/not hex|unexpected/);
  });

  it("a binary answer in JSON, for a type the API's codec cannot serialize, is a permanent answer: the page is immutable and says there is no binary form", async () => {
    const hash = "92EC1EA8B38B7242F07591AB4BF1AAB5E6B2E3015CE6E15AAAADAC05E6B74046";
    mock = mockUpstream("xrpl", {
      [`GET /v2/transactions/${hash}?binary=true`]: {
        result: "success",
        transaction: {
          hash,
          ledger_index: 107670360,
          date: "2026-10-15T11:19:30+00:00",
          tx: { TransactionType: "EscrowFinish", Account: "rDjzmUuSBDzW4kDGUhkZGxC9m3dnKKBYgC" },
          meta: { TransactionResult: "tesSUCCESS" },
        },
      },
    });
    const { response, html } = await page(`/xrpl/tx/${hash}`);
    const text = textOf(html);

    expect(text).toContain("The index has no binary form for this type of transaction.");
    expect(text).not.toContain("could not be loaded");
    expect(text).not.toContain("Reload");
    expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    expect(await storedAs(`/xrpl/tx/${hash}`)).toEqual(OWNED);
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("a Payment", () => {
  it("shows the title, the result with its code, the summary sentence and the flow", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    const text = textOf(html);

    expect(html).toMatch(/<h1[^>]*>Payment<\/h1>/);
    expect(text).toContain("Success tesSUCCESS");
    expect(elementText(html, "sentence")).toBe(
      `${shortAddress("rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh")} sent 2.306481 XRP to ${shortAddress("rDFDjdFgCEGgYoAxdZVp3AepoErfrPfy48")}.`,
    );
    // The flow: sender, destination, with what moved.
    expect(text).toContain("Sender");
    expect(text).toContain("−2.306481 XRP");
    expect(text).toContain("Destination");
    expect(text).toContain("+2.306481 XRP");
    expect(html).toContain('aria-label="Flow of funds"');
    // The way back: crumbs and the head's time (no age: the page is stored for a year).
    expect(text).toContain(`XRPL / Ledger 102,186,243 / ${shortHash(PAYMENT)}`);
    expect(text).not.toMatch(/\d+ (s|min|h|d) ago/);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("lists the details: hash, the CTID that encodeCtid gives, the ledger and its place, the date, the fee", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    const text = textOf(html);
    const hashes = await recordedHashes("xrpl", 102186243);
    const { tx } = await recorded("xrpl", PAYMENT);

    expect(text).toContain(`Hash ${PAYMENT}`);
    expect(text).toContain(`CTID ${encodeCtid(102186243, 63, 0)}`);
    expect(text).toContain(`Ledger #102,186,243 · transaction 63 of ${hashes.length}`);
    expect(hrefs(html)).toContain("/xrpl/ledger/102186243");
    expect(text).toMatch(/Date \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
    expect(text).toContain("Account rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh");
    expect(text).toContain("Destination rDFDjdFgCEGgYoAxdZVp3AepoErfrPfy48");
    expect(text).toContain("Amount 2.306481 XRP");
    expect(text).toContain("Fee 0.000012 XRP · burned");
    expect(text).toContain(`Sequence ${formatAmount(String(tx.Sequence))}`);
    // The hash and the CTID can be copied.
    expect(html).toContain('aria-label="Copy hash"');
    expect(html).toContain('aria-label="Copy CTID"');
  });

  it("lists the balance changes, the sender's first, with the balance after, and says the fee is in the sender's", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    const rows = tableRows(html, "Balance changes");
    expect(rows).toEqual([
      ["Account", "Currency", "Change", "Balance after"],
      [`${shortAddress("rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh")} sender`, "XRP", "−2.306493", "6.202021"],
      [`${shortAddress("rDFDjdFgCEGgYoAxdZVp3AepoErfrPfy48")} destination`, "XRP", "+2.306481", "6.202034"],
    ]);
    expect(textOf(html)).toContain("the sender’s XRP change includes the fee");
    expect(hrefs(html)).toContain("/xrpl/account/rDFDjdFgCEGgYoAxdZVp3AepoErfrPfy48");
  });

  it("lists the ledger objects it touched", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    const list = /<ul[^>]*aria-label="Ledger objects touched"[^>]*>([\s\S]*?)<\/ul>/.exec(html);
    expect(list).not.toBeNull();
    const items = [...list![1]!.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]!));
    expect(items).toEqual([
      `Modified AccountRoot ${shortAddress("rDFDjdFgCEGgYoAxdZVp3AepoErfrPfy48")}`,
      `Modified AccountRoot ${shortAddress("rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh")}`,
    ]);
  });

  it("links the transactions before and after it in the ledger, by place", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    const hashes = await recordedHashes("xrpl", 102186243);
    const links = anchors(html);

    const previous = links.find((a) => a.text === "Previous · #62");
    const next = links.find((a) => a.text === "Next · #64");
    expect(previous?.attrs).toContain(`href="/xrpl/tx/${hashes[62]}"`);
    expect(next?.attrs).toContain(`href="/xrpl/tx/${hashes[64]}"`);
    expect(textOf(html)).toContain("In ledger #102,186,243");
  });

  it("has the raw Transaction, Metadata and Binary on the page, for a browser without JavaScript", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    const text = textOf(html);
    const binary = await recorded("xrpl", PAYMENT, true);

    expect(html).toContain('id="raw"');
    for (const name of ["Transaction", "Metadata", "Binary"]) expect(html).toContain(`>${name}</h3>`);
    expect(text).toContain('"TransactionType": "Payment"');
    expect(text).toContain('"TransactionResult": "tesSUCCESS"');
    expect(text).toContain(binary.tx);
    expect(text).toContain(binary.meta);
    expect(hrefs(html)).toContain("#raw");
  });

  it("is in the order of the phone, the raw data last, under a heading of its own (the desktop's grid is CSS)", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    const at = (needle: string) => html.indexOf(needle);
    expect(at('aria-labelledby')).toBeGreaterThan(0);
    const order = [">Details</h2>", ">Balance changes</h2>", 'aria-label="Context"', 'id="raw"'].map(at);
    expect(order.every((position) => position > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const raw = html.slice(at('id="raw"'));
    expect(raw.indexOf("<h2")).toBeLessThan(raw.indexOf("<h3"));
    expect(raw).toContain(">Raw data</h2>");
  });

  it("asks for the transaction, its binary form and the transactions of its ledger, side by side, and nothing else", async () => {
    mock = mockUpstream("xrpl");
    // A transaction no other test of the file asks for, so that nothing is in the cache.
    const hash = "CB1B7721CCC2C842B86A178A26BF50160F57CEC9E95291A9C5349071B89C3822";
    await page(`/xrpl/tx/${hash}`);
    expect(keys(mock).sort()).toEqual(
      [
        `xrpl GET /v2/transactions/${hash}`,
        `xrpl GET /v2/transactions/${hash}?binary=true`,
        "xrpl GET /v2/ledgers/107506489?transactions=true",
      ].sort(),
    );
  });

  it("is immutable: stored for a year, and the browser keeps it a minute", async () => {
    mock = mockUpstream("xrpl");
    const { response } = await page(`/xrpl/tx/${PAYMENT}`);
    expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    expect(response.headers.has("X-Cache-Class")).toBe(false);
    expect(await storedAs(`/xrpl/tx/${PAYMENT}`)).toEqual(OWNED);
  });

  it("has a title and a description built from the transaction, and is indexable", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    expect(html).toMatch(/<title>[^<]*Payment[^<]*AACAFC…FD40[^<]*XRPL[^<]*<\/title>/);
    const description = /<meta[^>]*name="description"[^>]*content="([^"]*)"/.exec(html)?.[1];
    expect(description).toBe("Payment of 2.306481 XRP from rBbW6i…W5jh to rDFDjd…fy48 · XRPL ledger 102,186,243");
    expect(robots(html)).toBeUndefined();
  });
});

describe("a Payment through an AMM pool", () => {
  it("has the pool among the steps of the flow and in the sentence", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${SWAP}`);
    const text = textOf(html);

    expect(elementText(html, "sentence")).toContain("through the XRP/RLUSD AMM pool");
    const flow = /aria-label="Flow of funds"[\s\S]*?<\/section>/.exec(html)![0];
    // A label's text, a link in it or not (the pool's is one while AMM_PAGES is on).
    const labels = [...flow.matchAll(/class="flow__label">([\s\S]*?)<\/span>/g)].map((m) => textOf(m[1]!));
    expect(labels).toEqual(["Sender", "XRP/RLUSD AMM pool", "Destination"]);
    expect(textOf(flow)).toContain("pays out 179.448166793 RLUSD");
    expect(hrefs(html)).toContain("/xrpl/account/rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3");
    expect(text).toContain("AMM pool");
  });

  it("links the pool page from the sentence and from the flow's label while AMM_PAGES is on, and keeps the flow's account link", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${SWAP}`);
    const pool = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";

    const flow = /aria-label="Flow of funds"[\s\S]*?<\/section>/.exec(html)![0];
    const label = anchors(flow).find((a) => a.text === "XRP/RLUSD AMM pool");
    expect(label?.attrs).toContain(`href="/xrpl/amm/${pool}"`);
    expect(hrefs(flow)).toContain(`/xrpl/account/${pool}`);
    const sentence = anchors(html).find((a) => a.text === "XRP/RLUSD");
    expect(sentence?.attrs).toContain(`href="/xrpl/amm/${pool}"`);
  });

  it("marks the pool's balance changes", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${SWAP}`);
    const rows = tableRows(html, "Balance changes");
    const pool = shortAddress("rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3");
    // An issued currency shows the other side of its trust line under its code: here the issuer, for the pool's holding of it.
    const issuer = shortAddress("rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De");
    expect(rows.filter((row) => row[0] === `${pool} AMM pool`).map((row) => [row[1], row[2]])).toEqual([
      [`RLUSD with ${issuer}`, "−179.448166793"],
      ["XRP", "+134"],
    ]);
    expect(rows[1]![0]).toBe(`${shortAddress("rMsrQGK9fZ6B2164QGLnjLMxBYSCY5xJ4W")} sender`);
    expect(rows[1]!.slice(1)).toEqual(["XRP", "−134.000012", "8.978027"]);
    expect(hrefs(html)).toContain("/xrpl/account/rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De");
  });

  it("is the first of its ledger: no previous, a link to the next", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${SWAP}`);
    const hashes = await recordedHashes("xrpl", 107694747);
    expect(textOf(html)).toContain("Previous · first in ledger");
    expect(html).toMatch(/<span[^>]*aria-disabled="true"[^>]*>[\s\S]*?Previous · first in ledger/);
    expect(anchors(html).some((a) => a.text.startsWith("Previous"))).toBe(false);
    expect(anchors(html).find((a) => a.text === "Next · #1")?.attrs).toContain(`href="/xrpl/tx/${hashes[1]}"`);
  });
});

describe("the last transaction of a ledger", () => {
  it("has a previous, and no next to link", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${LAST_OF_LEDGER}`);
    const hashes = await recordedHashes("xrpl", 107721455);
    expect(hashes).toHaveLength(107);
    expect(textOf(html)).toContain("transaction 106 of 107");
    expect(textOf(html)).toContain("Next · last in ledger");
    expect(anchors(html).some((a) => a.text.startsWith("Next"))).toBe(false);
    expect(anchors(html).find((a) => a.text === "Previous · #105")?.attrs).toContain(`href="/xrpl/tx/${hashes[105]}"`);
    expect(await storedAs(`/xrpl/tx/${LAST_OF_LEDGER}`)).toEqual(OWNED);
  });
});

describe("a transaction that failed", () => {
  it("says it failed with an icon and the code, reads 'tried to', and has no flow", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${KILLED}`);
    const text = textOf(html);

    expect(html).toMatch(/<span class="pill pill--bad mono"[^>]*>\s*<svg[\s\S]*?<\/svg>tecKILLED<\/span>/);
    expect(text).not.toContain("Success");
    expect(elementText(html, "sentence")).toContain("tried to offer to buy");
    expect(elementText(html, "sentence")).toContain("The offer could not be filled as its flags required, so nothing was traded.");
    expect(html).not.toContain('aria-label="Flow of funds"');
    // Its fee was still burned, and the page says what the result means.
    expect(text).toContain("Fee 0.00001 XRP · burned");
    expect(tableRows(html, "Balance changes")).toHaveLength(2);
    expect(text).toContain("Result tecKILLED");
  });

  it("shows the memo", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${KILLED}`);
    expect(textOf(html)).toContain("Memo 34CA34DF1108F4BA");
  });
});

describe("a Xahau transaction", () => {
  it("is in the network's currency and accent, and its CTID has Xahau's network id", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/tx/${REMIT}`);
    const text = textOf(html);
    const hashes = await recordedHashes("xahau", 26540613);

    expect(html).toContain('data-net="xahau"');
    expect(html).toMatch(/<h1[^>]*>Remit<\/h1>/);
    expect(text).toContain(`CTID ${encodeCtid(26540613, 88, 21337)}`);
    expect(text).toContain(`Ledger #26,540,613 · transaction 88 of ${hashes.length}`);
    expect(text).toContain("XAH");
    expect(text).not.toMatch(/\bXRP\b/);
    expect(hrefs(html)).toContain("/xahau/ledger/26540613");
    expect(hrefs(html)).toContain(`/xahau/tx/${hashes[87]}`);
    expect(text).toContain("Xahau / Ledger 26,540,613");
    expect(await storedAs(`/xahau/tx/${REMIT}`)).toEqual(OWNED);
  });
});

describe("a hash that is not in its canonical form", () => {
  it("redirects a lower-case hash to the upper-case URL, as an immutable redirect, without asking anyone", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/tx/${PAYMENT.toLowerCase()}`;
    const response = await get(path);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${PAYMENT}`);
    expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    expect(response.headers.has("X-Cache-Class")).toBe(false);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(OWNED);
  });

  it("redirects a mixed-case hash too", async () => {
    mock = mockUpstream("xrpl");
    const mixed = `${PAYMENT.slice(0, 32)}${PAYMENT.slice(32).toLowerCase()}`;
    const response = await get(`/xrpl/tx/${mixed}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${PAYMENT}`);
    expect(mock.requests).toEqual([]);
  });

  it("keeps the network on a Xahau redirect", async () => {
    mock = mockUpstream("xahau");
    const response = await get(`/xahau/tx/${REMIT.toLowerCase()}`);
    expect(response.headers.get("Location")).toBe(`/xahau/tx/${REMIT}`);
  });
});

describe("a CTID", () => {
  it("of this network redirects to the transaction's hash, as an immutable redirect", async () => {
    mock = mockUpstream("xrpl");
    const hashes = await recordedHashes("xrpl", 93663334);
    const ctid = encodeCtid(93663334, 111, 0);
    const response = await get(`/xrpl/tx/${ctid}`);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${hashes[111]}`);
    expect(hashes[111]).toBe("6C6B9070EF68F9BC7777C018DC85596B40C531DBB29FA0E9C49B5964DF75B96B");
    expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    expect(await storedAs(`/xrpl/tx/${ctid}`)).toEqual(OWNED);
    // Only the ledger's list is read: not the transaction.
    expect(keys(mock)).toEqual(["xrpl GET /v2/ledgers/93663334?transactions=true"]);
  });

  it("is read in lower case, and the redirect leads to a page", async () => {
    mock = mockUpstream("xahau");
    const hashes = await recordedHashes("xahau", 26541060);
    const ctid = encodeCtid(26541060, 14, 21337);
    const response = await get(`/xahau/tx/${ctid.toLowerCase()}`);
    await response.text();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xahau/tx/${hashes[14]}`);

    const { html } = await page(response.headers.get("Location")!);
    expect(textOf(html)).toContain(`CTID ${ctid}`);
  });

  it("of the other network is a page that offers the transaction there, and asks nobody", async () => {
    mock = mockUpstream("xrpl");
    const ctid = encodeCtid(26540187, 3, 21337);
    const { response, html } = await page(`/xrpl/tx/${ctid}`);
    const text = textOf(html);

    expect(text).toContain("That CTID is on Xahau");
    expect(text).toContain(`${ctid} belongs to Xahau, so it is not a transaction on XRPL.`);
    expect(anchors(html).find((a) => a.text === "Open the transaction on Xahau")?.attrs).toContain(`href="/xahau/tx/${ctid}"`);
    expect(robots(html)).toBe("noindex, follow");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(await storedAs(`/xrpl/tx/${ctid}`)).toEqual({ cls: "short", ttl: 30 });
    expect(mock.requests).toEqual([]);
  });

  it("that names no transaction is a 404, stored for 30 s", async () => {
    mock = mockUpstream("xrpl");
    const ctid = encodeCtid(107506489, 500, 0);
    const { response, html } = await page(`/xrpl/tx/${ctid}`, 404);
    expect(textOf(html)).toContain(`We couldn’t find transaction ${ctid} on XRPL`);
    expect(robots(html)).toBe("noindex");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(await storedAs(`/xrpl/tx/${ctid}`)).toEqual({ cls: "short", ttl: 30 });
  });

  it("of a ledger the index does not have is a 404", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${encodeCtid(107500001, 0, 0)}`, 404);
    expect(textOf(html)).toContain("We couldn’t find transaction");
  });

  it("of a network the explorer does not cover is a 404 that says so, and asks nobody", async () => {
    mock = mockUpstream("xrpl");
    const ctid = encodeCtid(107506489, 22, 1);
    const { html } = await page(`/xrpl/tx/${ctid}`, 404);
    expect(textOf(html)).toContain(`${ctid} is for network id 1, which this explorer does not cover.`);
    expect(mock.requests).toEqual([]);
  });

  it("answers 503 when the ledger of the CTID cannot be read", async () => {
    mock = mockUpstream("xrpl", { "GET /v2/ledgers/107506490?transactions=true": () => dataApiError(500, "boom") });
    const response = await get(`/xrpl/tx/${encodeCtid(107506490, 0, 0)}`);
    await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers 503 when the ledger lists something that is not a hash at the CTID's place", async () => {
    mock = mockUpstream("xrpl", {
      "GET /v2/ledgers/107506491?transactions=true": { result: "success", ledger: { ledger_index: 107506491, transactions: ["../../etc/passwd"] } },
    });
    const response = await get(`/xrpl/tx/${encodeCtid(107506491, 0, 0)}`);
    await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("Location")).toBeNull();
  });
});

describe("an id that is neither a hash nor a CTID", () => {
  it.each(["abc", "0x" + PAYMENT, PAYMENT.slice(1), PAYMENT + "A", "C66B4E2C000C000", "C66B4E2C000C00000", "D66B4E2C000C0000", "..%2F..%2Fetc", "1A00E4CC5EB143E8BFF4578019BDF45ECEA40C37F113D261ECFB27624385887G"])(
    "is a 404 for %s, without asking anyone",
    async (id) => {
      mock = mockUpstream("xrpl");
      const path = `/xrpl/tx/${id}`;
      const { response, html } = await page(path, 404);
      expect(textOf(html)).toContain("We couldn’t find transaction");
      expect(robots(html)).toBe("noindex");
      expect(response.headers.get("Cache-Control")).toBe("max-age=0");
      expect(mock.requests).toEqual([]);
    },
  );

  it("is stored for 30 s", async () => {
    mock = mockUpstream("xrpl");
    await page("/xrpl/tx/not-a-transaction", 404);
    expect(await storedAs("/xrpl/tx/not-a-transaction")).toEqual({ cls: "short", ttl: 30 });
  });

  it("is a 404 for a network that does not exist", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/doge/tx/${PAYMENT}`, 404);
    expect(textOf(html)).toContain("There is no network called “doge”");
    expect(mock.requests).toEqual([]);
  });
});

describe("a transaction nobody has", () => {
  const UNKNOWN = "0D".repeat(32);

  it("is a 404 page that names it and offers the same search on the other network", async () => {
    mock = mockUpstream("xrpl");
    const { response, html } = await page(`/xrpl/tx/${UNKNOWN}`, 404);
    const text = textOf(html);

    expect(text).toContain(`We couldn’t find transaction ${shortHash(UNKNOWN)} on XRPL.`);
    expect(anchors(html).find((a) => a.text === "Search on Xahau")?.attrs).toContain(`href="/xahau/search?q=${UNKNOWN}"`);
    expect(html).toContain('action="/xrpl/search"');
    expect(html).toContain(`value="${UNKNOWN}"`);
    expect(hrefs(html)).toContain("/xrpl");
    expect(robots(html)).toBe("noindex");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(await storedAs(`/xrpl/tx/${UNKNOWN}`)).toEqual({ cls: "short", ttl: 30 });
  });

  it("asked the data API and then the node", async () => {
    const hash = "0C".repeat(32);
    mock = mockUpstream("xrpl");
    await page(`/xrpl/tx/${hash}`, 404);
    expect(mock.requests.filter((r) => r.kind === "data-api").every((r) => r.status === 404)).toBe(true);
    expect(mock.requests.filter((r) => r.kind === "node").map((r) => r.key.split(" ").slice(0, 2).join(" "))).toEqual(["node tx"]);
  });

  it("offers Xahau's search from XRPL and XRPL's from Xahau, and following the offer finds a transaction there", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/tx/${PAYMENT}`, 404);
    const offer = anchors(html).find((a) => a.text === "Search on XRPL");
    expect(offer?.attrs).toContain(`href="/xrpl/search?q=${PAYMENT}"`);

    const followed = await get(`/xrpl/search?q=${PAYMENT}`);
    await followed.text();
    expect(followed.headers.get("Location")).toBe(`/xrpl/tx/${PAYMENT}`);
  });

  it("is a 404 when the node has a transaction but not in a validated ledger", async () => {
    const hash = "0E".repeat(32);
    mock = mockUpstream("xrpl", {
      [`node tx ${hash}`]: { status: "success", validated: false, ledger_index: 107700000, date: 845378370, hash, TransactionType: "Payment" },
    });
    const { html } = await page(`/xrpl/tx/${hash}`, 404);
    expect(textOf(html)).toContain("We couldn’t find transaction");
    expect(mock.unusedOverrides()).toEqual([]);
  });
});

describe("a transaction the index does not have yet", () => {
  // The data API has none (the override), the node has validated it (its fixture): Xahau's Payment of ledger 26541060.
  const HASH = "D437E9B6486965D1E97D3737FD00A4B0C9615DFFF3ECC813EF6A3A6CB44B945F";

  it("is shown from the node, with a note, and stored for 60 s as short", async () => {
    mock = mockUpstream("xahau", { [`GET /v2/transactions/${HASH}`]: null });
    const { response, html } = await page(`/xahau/tx/${HASH}`);
    const text = textOf(html);

    expect(text).toContain("Not in the index yet, shown from the network");
    expect(html).toMatch(/<h1[^>]*>Payment<\/h1>/);
    expect(text).toContain(`Hash ${HASH}`);
    expect(text).toContain(`CTID ${encodeCtid(26541060, 15, 21337)}`);
    expect(text).toContain("Ledger #26,541,060 · transaction 15");
    expect(text).toMatch(/Date \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
    expect(tableRows(html, "Balance changes").length).toBeGreaterThan(1);
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(await storedAs(`/xahau/tx/${HASH}`)).toEqual({ cls: "short", ttl: 60 });
    expect(mock.requests.filter((r) => r.kind === "node").map((r) => r.key.split(" ").slice(0, 2).join(" "))).toEqual(["node tx"]);
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("has no previous and next and no binary form, and says they appear once the transaction is indexed", async () => {
    const hash = "9C647CBA92C7C8610F302237A360B547FE6827F45ECD0C75443C90611DD325A6";
    mock = mockUpstream("xahau", { [`GET /v2/transactions/${hash}`]: null });
    const { html } = await page(`/xahau/tx/${hash}`);
    const text = textOf(html);

    expect(text).toContain("Previous and next transactions appear once the transaction is indexed.");
    expect(anchors(html).some((a) => /^(Previous|Next) ·/.test(a.text))).toBe(false);
    expect(text).toContain("The binary form appears once the transaction is indexed.");
    // The ledger's list is not read for a page that is replaced within a minute.
    expect(mock.requests.some((r) => r.key.startsWith("GET /v2/ledgers/"))).toBe(false);
    // The raw tabs still hold the node's JSON.
    expect(text).toContain('"TransactionType": "Payment"');
  });

  it("is not shown with the note once the index has it", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/tx/${REMIT}`);
    expect(textOf(html)).not.toContain("Not in the index yet");
  });
});

describe("the page as loader data for a client-side navigation", () => {
  it("does not hand the browser the transaction as data: its JSON is in it as the text of the raw tabs, and as nothing else", async () => {
    mock = mockUpstream("xrpl");
    const hash = "10CEF6273B6C4476E86169B7BB1723BF3CD2CFD948B1A732450543B2270AD87E";
    const response = await get(`/xrpl/tx/${hash}.data`);
    const body = await response.text();
    expect(response.status).toBe(200);

    // The loader data of a client-side navigation is a flat list (turbo-stream): every key and every string of the data is an element
    // of it. A transaction as an object would put its field names there, as elements of their own.
    const flat = JSON.parse(body) as unknown[];
    const strings = new Set(flat.filter((item): item is string => typeof item === "string"));
    for (const field of ["AffectedNodes", "TransactionType", "TransactionResult", "TxnSignature", "SigningPubKey", "FinalFields", "LedgerEntryType", "Fee", "Account", "Sequence"]) {
      expect(strings.has(field), field).toBe(false);
    }
    // The check can tell: the page's own keys are elements, and the JSON text is one string.
    for (const key of ["kind", "title", "changes", "objects", "raw"]) expect(strings.has(key), key).toBe(true);
    expect([...strings].some((item) => item.includes('"TransactionType"') && item.includes('"AffectedNodes"') === false)).toBe(true);
    expect([...strings].some((item) => item.includes('"AffectedNodes"'))).toBe(true);
  });

  it("is the same class as the page of that URL", async () => {
    mock = mockUpstream("xahau");
    const hash = "3A1F25CDF0E2E4466AA0B019EA3039A6E5F87C01FBDD69CBDC474DAC32D8E64C";
    const response = await get(`/xahau/tx/${hash}.data`);
    await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    expect(await storedAs(`/xahau/tx/${hash}.data`)).toEqual(OWNED);
  });
});
