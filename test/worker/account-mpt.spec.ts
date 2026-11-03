import { describe, expect, it, vi } from "vitest";

import { mptIssuerOf } from "../../app/domain/mpt-id";
import accountTransactions from "../fixtures/http/xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/transactions@descending=true&limit=20.json";
import feePayment from "../fixtures/http/xrpl/data-api/transactions/80C74925827B059CA14F2C7C4E01F8DE37C5502648CE20DE90B35827E73D503E.json";
import accountPayments3 from "../fixtures/http/xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/payments@descending=true&limit=20&marker=WzEwMjE4NjI0Myw2M10.json";
import mptLookupTable from "../fixtures/http/xrpl/data-api/mpt_lookup.json";
import { healthy } from "../support/account-loader";
import { MPT_FEE_PAYMENT_ISSUANCE, MPT_FIXTURE_IDS, MPT_LOCKED_HOLDING } from "../support/mpt-case-rules";
import { namesSpec } from "../support/names";
import { expectDegraded, forgetStored, keysOf } from "../support/nft-pages";
import { objectCase } from "../support/object-cases";
import { anchors, elementText, pageClient, tableRows, textOf } from "../support/pages";
import { dataApiError } from "../support/upstream";

// The MPTs of the account page, `/{net}/account/{address}` (E14 spec 5.4, Task 8), on the real Worker against the recorded answers of the data API and the node (test/fixtures/http/) and the lookup the mock
// composes from `xrpl/data-api/mpt_lookup.json`. The active account holds two MPTs (`account_objects`: XAU, and the issuance an issuer locked its balance of) and issued a third, which the index does not
// know. On a live first page the lookups are two (ruling C12): the header's, over the Tokens card and the Objects tab's rows, and the list's, in the list's promise; a page behind a marker makes one. A
// failed lookup leaves units and the page unstored. The off-case is mpt-off.spec.ts, the names of the MPT issuers account-names.spec.ts.
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock: the tests that fail the lookup come first, and `namesSpec` takes the subrequest entries away before each test
// and moves `Date` past the longest keep after it.

const { get, page, storedAs } = pageClient("198.51.130");
const { upstream } = namesSpec({ advance: 301_000 });

const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
/** E10's escrow of an MPT: its issuance is made up and the lookup's table does not hold it. */
const ESCROW = await objectCase("xrpl", "escrow-mpt");
const { htf: XAU, nodeOnly: NODE_ONLY } = MPT_FIXTURE_IDS;
const LIVE = { cls: "live", ttl: 5 };
const MARKER_PAGE = { cls: "slow", ttl: 3_600 };

/** The key the mock gives a request of the lookup for these IDs, sorted. */
const LOOKUP = (...ids: string[]) => `GET /v2/mpt?ids=${[...ids].sort().join(",")}`;
/** The same as an override names it: the separator is written as the request escapes it (`ids=A%2CB`). */
const LOOKUP_OVERRIDE = (...ids: string[]) => LOOKUP(...ids).replaceAll(",", "%2C");
/** The lookup calls a mock saw, in order. */
const lookupsOf = (mock: { requests: Parameters<typeof keysOf>[0] }) => keysOf(mock.requests).filter((key) => key.startsWith("GET /v2/mpt"));

/** The HTML of the Tokens card, up to the next card. */
const tokensCardOf = (html: string) => html.slice(html.indexOf(">Tokens</h2>"), html.indexOf(">Owned objects</h2>"));
/** The rows of the Tokens card that are an MPT's (those that link an MPT page): their text, and the MPT page they lead to. */
const mptRowsOf = (html: string) =>
  tokensCardOf(html)
    .split('<div class="token ')
    .slice(1)
    .filter((row) => row.includes('href="/xrpl/mpt/'))
    .map((row) => ({ text: textOf(row), mpt: /href="\/xrpl\/mpt\/([0-9A-F]{48})"/.exec(row)![1]! }));

describe("when the lookup fails", () => {
  it("shows the Tokens card in units, the holdings' links still there, logs one line, and does not store the page", async () => {
    const path = `/xrpl/account/${ACTIVE}`;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const mock = upstream("xrpl", { [LOOKUP_OVERRIDE(XAU, MPT_LOCKED_HOLDING)]: dataApiError(503, "unavailable") });
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(lookupsOf(mock)).toEqual([LOOKUP(XAU, MPT_LOCKED_HOLDING)]);
    const rows = mptRowsOf(html);
    expect(rows).toEqual([
      { mpt: XAU, text: expect.stringContaining("MPT 03F907F2… rBEERd…fg6q 3,000,000 units") },
      { mpt: MPT_LOCKED_HOLDING, text: expect.stringContaining("MPT 0663EACA… rJgwiV…UqfS · Locked 45,000,000 units") },
    ]);
    expect(logged.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("MPT amounts could not be loaded"))).toHaveLength(1);
  });
});

describe("the escrow page of an MPT", () => {
  const PATH = `/xrpl/escrows/${ESCROW.id}`;
  /** The issuance of the escrow's amount: E10's made-up ID, which the lookup's table does not hold. */
  const ID = "0000012AB5F762798A53D543A014CAF8B297CFF8F2F937E8";
  const known = { ...(mptLookupTable as Record<string, object>)[XAU]!, mpt_issuance_id: ID, issuer: mptIssuerOf(ID), ticker: "HTF", asset_scale: 2 };
  const amountOf = (html: string) => /<dt[^>]*>Amount<\/dt><dd[^>]*>([\s\S]*?)<\/dd>/.exec(html)![1]!;

  it("serves a failed lookup in units, with the issuance still a link, and does not store the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mock = upstream("xrpl", { [LOOKUP_OVERRIDE(ID)]: dataApiError(503, "unavailable") });
    const response = await get(PATH);
    const html = await response.text();

    await expectDegraded(PATH, response);
    expect(lookupsOf(mock)).toEqual([LOOKUP(ID)]);
    expect(textOf(amountOf(html))).toBe("250 units of MPT 0000012A…");
  });

  it("asks once, for the escrow's own issuance, and scales its Amount row and every sentence: the ticker a link to the issuance's page, the page live", async () => {
    await forgetStored(PATH);
    const mock = upstream("xrpl", { [LOOKUP_OVERRIDE(ID)]: { count: 1, issuances: [known] } });
    const { html } = await page(PATH);

    expect(lookupsOf(mock)).toEqual([LOOKUP(ID)]);
    expect(textOf(amountOf(html))).toBe("2.50 HTF");
    expect(anchors(amountOf(html)).map((a) => [a.text, /href="([^"]*)"/.exec(a.attrs)![1]])).toEqual([["HTF", `/xrpl/mpt/${ID}`]]);
    expect(elementText(html, "object-page__summary")).toMatch(/ locked 2\.50 HTF for /);
    expect(textOf(html)).not.toContain("units of MPT");
    expect(await storedAs(PATH)).toEqual(LIVE);
  });

  it("leaves the units in the page, still live and stored, when the index has no state for the issuance (answered bare)", async () => {
    await forgetStored(PATH);
    const mock = upstream("xrpl", { [LOOKUP_OVERRIDE(ID)]: { count: 1, issuances: [{ mpt_issuance_id: ID }] } });
    const { html } = await page(PATH);

    expect(lookupsOf(mock)).toEqual([LOOKUP(ID)]);
    expect(textOf(amountOf(html))).toBe("250 units of MPT 0000012A…");
    expect(await storedAs(PATH)).toEqual(LIVE);
  });
});

describe("when the list's lookup fails", () => {
  it("draws the list in units, marks the page degraded, and keeps the header's scaled: the two lookups are the page's own", async () => {
    const path = `/xrpl/account/${ACTIVE}?tab=payments&mpt=list-fails`;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const mock = upstream("xrpl", {
      [`GET /v2/accounts/${ACTIVE}/payments?descending=true&limit=20`]: accountPayments3,
      [LOOKUP_OVERRIDE(MPT_FEE_PAYMENT_ISSUANCE)]: dataApiError(503, "unavailable"),
    });
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect([...lookupsOf(mock)].sort()).toEqual([LOOKUP(MPT_FEE_PAYMENT_ISSUANCE), LOOKUP(XAU, MPT_LOCKED_HOLDING)].sort());
    // The header's was answered: the card is scaled. The list's was not: the payment is in units, with its link.
    expect(mptRowsOf(html)[0]!.text).toContain("XAU rBEERd…fg6q 300.0000");
    const payments = html.slice(html.indexOf('aria-label="Payments"'));
    expect(textOf(payments)).toContain("+1,000,000 units of MPT 0598F6E0…");
    expect(logged.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("MPT amounts could not be loaded"))).toHaveLength(1);
  });
});

describe("the first page", () => {
  it("asks the lookup once with its sorted IDs and draws the Tokens card scaled, each holding a link, and is stored live", async () => {
    const path = `/xrpl/account/${ACTIVE}?mpt=card`;
    await forgetStored(path);
    const mock = upstream("xrpl");
    const { html } = await page(path);

    // The transactions of the active account hold no MPT amount, so the list asks nothing: the header's call is the page's only one.
    expect(lookupsOf(mock)).toEqual([LOOKUP(XAU, MPT_LOCKED_HOLDING)]);
    // XAU is the ticker of the recorded issuance (scale 4): 2,500,000 units held and 500,000 in escrow are 300.0000; the other has no ticker and scale 0.
    expect(mptRowsOf(html)).toEqual([
      { mpt: XAU, text: expect.stringContaining("XAU rBEERd…fg6q 300.0000") },
      { mpt: MPT_LOCKED_HOLDING, text: expect.stringContaining("MPT 0663EACA… rJgwiV…UqfS · Locked 45,000,000") },
    ]);
    expect(mptRowsOf(html).map((row) => row.text)).not.toContain(expect.stringContaining("units"));
    expect(await storedAs(path)).toEqual(LIVE);
  });

  it("counts the MPT entries among the owned objects", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?mpt=owned`);
    const owned = html.slice(html.indexOf(">Owned objects</h2>"));
    expect(textOf(owned.slice(0, owned.indexOf("</section>")))).toMatch(/2\s*MPT holdings\s*1\s*MPT issuance/);
    expect(lookupsOf(mock)).toHaveLength(1);
  });

  it("asks the Objects tab's lookup with the card's and the rows' IDs together, once, and draws the rows scaled: the issuance the index lacks stays in units", async () => {
    const path = `/xrpl/account/${ACTIVE}?tab=objects`;
    await forgetStored(path);
    const mock = upstream("xrpl");
    const { html } = await page(path);

    expect(lookupsOf(mock)).toEqual([LOOKUP(XAU, MPT_LOCKED_HOLDING, NODE_ONLY)]);
    const list = html.slice(html.indexOf('class="objectlist"'));
    const text = textOf(list);
    // An MPToken: the MPT (a reference), its balance and what is in escrow as MPT amounts, and the issuer's flags in words.
    expect(text).toContain("MPT XAU Balance 250.0000 XAU In escrow 50.0000 XAU Locked No Authorized Yes");
    // The issuance the account made, known to the node alone: its units, as the ledger holds them.
    expect(text).toContain(`Outstanding 12,500,000 units of MPT 05F2B259… Max amount 1,000,000,000,000 units of MPT 05F2B259… Asset scale 4 Transfer fee 0.192%`);
    expect(anchors(list).filter((a) => a.text === "XAU").map((a) => /href="([^"]*)"/.exec(a.attrs)![1])).toEqual(Array(3).fill(`/xrpl/mpt/${XAU}`));
    expect(await storedAs(path)).toEqual(LIVE);
  });
});

describe("the list of a live page", () => {
  it("makes two lookups on a live first page whose list has an MPT of its own: the header's (the card) and the list's (the payment), each once, and draws both scaled", async () => {
    const path = `/xrpl/account/${ACTIVE}?tab=payments&mpt=two`;
    await forgetStored(path);
    const mock = upstream("xrpl", { [`GET /v2/accounts/${ACTIVE}/payments?descending=true&limit=20`]: accountPayments3 });
    const { html } = await page(path);

    expect([...lookupsOf(mock)].sort()).toEqual([LOOKUP(MPT_FEE_PAYMENT_ISSUANCE), LOOKUP(XAU, MPT_LOCKED_HOLDING)].sort());
    expect(mptRowsOf(html)[0]!.text).toContain("XAU rBEERd…fg6q 300.0000");
    const row = tableRows(html, "Payments")[1]!;
    expect(row.slice(1, 4)).toEqual(["Received", "rMPTej…6MCR", "+1.000000 units"]);
    expect(anchors(html.slice(html.indexOf('aria-label="Payments"'))).filter((a) => a.text === "units").map((a) => /href="([^"]*)"/.exec(a.attrs)![1])).toEqual([`/xrpl/mpt/${MPT_FEE_PAYMENT_ISSUANCE}`]);
    expect(await storedAs(path)).toEqual(LIVE);
  });

  it("asks nothing in the header for an account that holds no MPT: the transactions' lookup is the page's only one, and the row's sentence and change are scaled", async () => {
    // The recorded payment's receiver, which holds nothing of the recordings but this payment: its page is made of the answers a healthy account has and its one transaction.
    const receiver = "rKSg2VZbw9gRRuSwBjBFAfBoGC5Vs1FmFn";
    const path = `/xrpl/account/${receiver}`;
    const mock = upstream("xrpl", {
      ...healthy(receiver),
      [`GET /v2/accounts/${receiver}/transactions?descending=true&limit=20`]: { ...accountTransactions, transactions: [feePayment.transaction], marker: undefined },
    });
    const { html } = await page(path);

    expect(lookupsOf(mock)).toEqual([LOOKUP(MPT_FEE_PAYMENT_ISSUANCE)]);
    const row = tableRows(html, "Transactions")[1]!;
    expect(row[2]).toContain("sent 1.000000 units to");
    expect(row[3]).toBe("+1.000000 units");
  });
});

describe("a page behind a marker", () => {
  const MARKER = "WzEwMjE4NjI0Myw2M10";

  it("asks one lookup, for the amounts of its rows, and draws an MPT payment scaled, signed from the account's side", async () => {
    const path = `/xrpl/account/${ACTIVE}?tab=payments&marker=${MARKER}`;
    await forgetStored(path);
    const mock = upstream("xrpl");
    const { html } = await page(path);

    expect(accountPayments3.payments[0]!.mpt_issuance_id).toBe(MPT_FEE_PAYMENT_ISSUANCE);
    expect(lookupsOf(mock)).toEqual([LOOKUP(MPT_FEE_PAYMENT_ISSUANCE)]);
    const row = tableRows(html, "Payments")[1]!;
    // The recorded payment moved 1,000,000 units of an issuance with scale 6 and no ticker to this account.
    expect(row).toEqual(["2025-10-02 16:27:51", "Received", "rMPTej…6MCR", "+1.000000 units", ""]);
    expect(await storedAs(path)).toEqual(MARKER_PAGE);
  });
});
