import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import accountTransactions from "../fixtures/http/xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/transactions@descending=true&limit=20.json";
import accountPayments3 from "../fixtures/http/xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/payments@descending=true&limit=20&marker=WzEwMjE4NjI0Myw2M10.json";
import xrplTransactions from "../fixtures/http/xrpl/data-api/transactions@descending=true&limit=8.json";
import feePayment from "../fixtures/http/xrpl/data-api/transactions/80C74925827B059CA14F2C7C4E01F8DE37C5502648CE20DE90B35827E73D503E.json";
import mintTransaction from "../fixtures/http/xrpl/data-api/transactions/4D9BB2A0B0289D36A995B10AB17D5BE9B19E961B777AFDE29D84CC59384E74F6.json";
import { healthy } from "../support/account-loader";
import { MPT_FEE_PAYMENT_ISSUANCE, MPT_FIXTURE_IDS, MPT_LOCKED_HOLDING, MPT_MINT_ISSUANCE, MPT_RECORDED } from "../support/mpt-case-rules";
import { anchors, elementText, pageClient, tableRows, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The MPT amounts of the pages with every switch "off" (the `worker-off` project, README "Switches"), as production has them until the owner turns `MPT` on (E14 spec 7): the pages draw what they drew
// before E14 — an MPT amount in units and the start of its issuance's ID, with no link to a page that is not there — and make no lookup (spec 2.4). The `worker` project's cases, with the switch on,
// are transaction-mpt.spec.ts, account-mpt.spec.ts and their likes. The token list's MPT tab with `MPT` off is not here: this project has `TOKENS` off too, so `/xrpl/tokens` is a 404 of its own (tokens-off.spec.ts); the redirect of `?kind=mpt` and the tab's "soon" are tokens.spec.ts's, with a load context whose `TOKENS` is on.

const { get, page, storedAs } = pageClient("198.18.116");

const IMMUTABLE = { cls: "immutable", ttl: 31_536_000 };

let mock: UpstreamMock | undefined;
afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  expect(unused ?? []).toEqual([]);
});

/** The `/v2/mpt` requests a mock saw: the lookup, and any other call of the MPT routes. */
const mptCalls = (seen: UpstreamMock) => seen.requests.filter((request) => new URL(request.url).pathname.startsWith("/v2/mpt")).map((request) => request.key);

describe("the project", () => {
  it("is the one with MPT off", () => {
    expect((env as unknown as Record<string, string>).MPT).toBe("off");
  });
});

describe("the transaction page with MPT off", () => {
  it("makes no lookup while MPT is off: the amount in units, with no link, the class immutable", async () => {
    const path = `/xrpl/tx/${MPT_RECORDED.payment_transfer_fee.hash}`;
    mock = mockUpstream("xrpl");
    const { html } = await page(path);

    expect(mptCalls(mock)).toEqual([]);
    expect(elementText(html, "summary__sentence")).toMatch(/ sent 1,000,000 units of MPT 0598F6E0… to /);
    // Nothing on the page leads to an MPT page: not the amount, not the balance changes' currency, not the touched objects.
    expect(anchors(html).filter((a) => /href="[^"]*\/mpt\//.test(a.attrs))).toEqual([]);
    const rows = tableRows(html, "Balance changes").slice(1).filter((cells) => cells[1]!.startsWith("MPT 0598F6E0…"));
    expect(rows.map((cells) => cells[2]!.replace(/^\+ /, "+"))).toEqual(["−1,005,890 units of MPT 0598F6E0…", "+5,890 units of MPT 0598F6E0…", "+1,000,000 units of MPT 0598F6E0…"]);
    expect(await storedAs(path)).toEqual(IMMUTABLE);
  });

  it("names an issuance a transaction created by 'MPT' and the start of its ID, with no link", async () => {
    const path = `/xrpl/tx/${MPT_RECORDED.issuance_create.hash}`;
    mock = mockUpstream("xrpl");
    const { html } = await page(path);

    expect(mptCalls(mock)).toEqual([]);
    expect(elementText(html, "summary__sentence")).toMatch(/ created the MPT MPT 03F907F2…\.$/);
    expect(anchors(html).filter((a) => /href="[^"]*\/mpt\//.test(a.attrs))).toEqual([]);
    expect(await storedAs(path)).toEqual(IMMUTABLE);
  });
});

describe("the home page with MPT off", () => {
  it("lists an MPT amount in units with no link, and makes no lookup", async () => {
    const listed = { ...xrplTransactions, transactions: [mintTransaction.transaction, ...xrplTransactions.transactions.slice(1)] };
    mock = mockUpstream("xrpl", { "GET /v2/transactions?descending=true&limit=8": listed });
    const { html } = await page("/xrpl?mpt-off-home");

    expect(tableRows(html, "Latest transactions").slice(1).map((cells) => cells[3])).toContain("1 units of MPT 064E273A…");
    expect(anchors(html).filter((a) => a.attrs.includes(`/mpt/${MPT_MINT_ISSUANCE}`))).toEqual([]);
    expect(mptCalls(mock)).toEqual([]);
  });
});

describe("the account page with MPT off", () => {
  it("lists the MPTs the account holds in units with no link, counts them among its objects, draws the Objects tab's MPT rows in units, and makes no lookup", async () => {
    const active = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${active}`);

    expect(mptCalls(mock)).toEqual([]);
    const card = html.slice(html.indexOf(">Tokens</h2>"), html.indexOf(">Owned objects</h2>"));
    const rows = card.split(/<div class="token(?: [^"]*)?">/).slice(1).map((row) => textOf(row));
    expect(rows.slice(1)).toEqual([
      expect.stringContaining("MPT 03F907F2… rBEERd…fg6q 3,000,000 units"),
      expect.stringContaining("MPT 0663EACA… rJgwiV…UqfS · Locked 45,000,000 units"),
    ]);
    expect(anchors(html).filter((a) => /href="[^"]*\/mpt\//.test(a.attrs))).toEqual([]);
    const owned = html.slice(html.indexOf(">Owned objects</h2>"));
    expect(textOf(owned.slice(0, owned.indexOf("</section>")))).toMatch(/2\s*MPT holdings\s*1\s*MPT issuance/);
    expect(await storedAs(`/xrpl/account/${active}`)).toEqual({ cls: "live", ttl: 5 });

    // The Objects tab: the references and the amounts of its MPT rows are text, in units.
    mock.restore();
    mock = mockUpstream("xrpl");
    const objects = await page(`/xrpl/account/${active}?tab=objects`);
    expect(mptCalls(mock)).toEqual([]);
    const list = textOf(objects.html.slice(objects.html.indexOf('class="objectlist"')));
    expect(list).toContain(`MPT ${MPT_FIXTURE_IDS.htf.slice(0, 8)}… Balance 2,500,000 units of MPT ${MPT_FIXTURE_IDS.htf.slice(0, 8)}… In escrow 500,000 units of MPT ${MPT_FIXTURE_IDS.htf.slice(0, 8)}… Locked No Authorized Yes`);
    expect(list).toContain(`MPT ${MPT_LOCKED_HOLDING.slice(0, 8)}…`);
    expect(anchors(objects.html).filter((a) => /href="[^"]*\/mpt\//.test(a.attrs))).toEqual([]);
  });
});

// Review of Tasks 7 and 8, M7: the account's lists draw an MPT row through `MptCell` (AccountListPanels.tsx), whose link is `mptLink`'s, and `MptAmount` has no link for a null `href` (a component test): the
// glue between them is these two, with a recorded MPT payment in each tab.
describe("the account's Transactions and Payments tabs with MPT off", () => {
  const active = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
  const noLinkToAnMpt = (html: string) => anchors(html).filter((a) => /href="[^"]*\/mpt\//.test(a.attrs));

  it("draws a transaction's sentence and change in units with no link, and makes no lookup", async () => {
    // The recorded payment's receiver, which holds nothing of the recordings but this payment.
    const receiver = "rKSg2VZbw9gRRuSwBjBFAfBoGC5Vs1FmFn";
    mock = mockUpstream("xrpl", {
      ...healthy(receiver),
      [`GET /v2/accounts/${receiver}/transactions?descending=true&limit=20`]: { ...accountTransactions, transactions: [feePayment.transaction], marker: undefined },
    });
    const { html } = await page(`/xrpl/account/${receiver}`);

    expect(mptCalls(mock)).toEqual([]);
    const row = tableRows(html, "Transactions")[1]!;
    expect(row[2]).toContain("sent 1,000,000 units of MPT 0598F6E0… to");
    expect(row[3]).toBe("+1,000,000 units of MPT 0598F6E0…");
    expect(noLinkToAnMpt(html)).toEqual([]);
  });

  it("draws a payment's amount signed from the account's side, in units with no link, and makes no lookup", async () => {
    mock = mockUpstream("xrpl", { [`GET /v2/accounts/${active}/payments?descending=true&limit=20`]: accountPayments3 });
    const { html } = await page(`/xrpl/account/${active}?tab=payments`);

    expect(accountPayments3.payments[0]!.mpt_issuance_id).toBe(MPT_FEE_PAYMENT_ISSUANCE);
    expect(mptCalls(mock)).toEqual([]);
    expect(tableRows(html, "Payments")[1]!.slice(1, 4)).toEqual(["Received", "rMPTej…6MCR", "+1,000,000 units of MPT 0598F6E0…"]);
    expect(noLinkToAnMpt(html.slice(html.indexOf('aria-label="Payments"')))).toEqual([]);
  });
});

// E14 spec 1.3 and 7: while `MPT` is off every route of the MPT pages is the 404 of "the MPT pages", of class `short`, before any call and whatever the ID is (the switch is the first check): the page,
// its holders' and its transfers', on either network, in any case, and for text that is no ID at all.
describe("the MPT pages with MPT off", () => {
  it.each(
    ["", "/holders", "/transfers"].flatMap((tail) => [
      [`an ID in capitals${tail}`, "xrpl", MPT_FIXTURE_IDS.htf, tail],
      [`an ID in lower case${tail}`, "xrpl", MPT_FIXTURE_IDS.htf.toLowerCase(), tail],
      [`text that is no ID${tail}`, "xrpl", "xyz", tail],
      [`an ID on Xahau${tail}`, "xahau", MPT_FIXTURE_IDS.htf, tail],
      [`an ID on Xahau in lower case${tail}`, "xahau", MPT_FIXTURE_IDS.htf.toLowerCase(), tail],
    ]) as Array<[string, "xrpl" | "xahau", string, string]>,
  )("answers %s with the 404 of the MPT pages, class short, and makes no request", async (_what, net, id, tail) => {
    mock = mockUpstream(net);
    const path = `/${net}/mpt/${id}${tail}`;
    const response = await get(path);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(textOf(html)).toContain(`We couldn’t find the MPT pages on ${net === "xrpl" ? "XRPL" : "Xahau"}.`);
    expect(textOf(html)).not.toContain("MPT isn't enabled");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });

  it("does not redirect a made-up query, a bad marker or a lower case ID: the switch is checked first", async () => {
    mock = mockUpstream("xrpl");
    for (const path of [`/xrpl/mpt/${MPT_FIXTURE_IDS.htf.toLowerCase()}?x=1`, `/xrpl/mpt/${MPT_FIXTURE_IDS.htf}/holders?marker=***`, `/xrpl/mpt/${MPT_FIXTURE_IDS.htf.toLowerCase()}/transfers?marker=`]) {
      const response = await get(path);
      await response.text();
      expect(response.status, path).toBe(404);
    }
    expect(mock.requests).toEqual([]);
  });
});

// E14 spec 8: with `MPT` off, 48 hex digits are what they were before E14 — no issuance ID, no redirect, no hint in the help text: the help page, a 200 of class `short` that asks nobody. (This project has `TOKENS`
// off too, so there is no offer of the list of tokens; search.spec.ts runs the loader with `TOKENS` on beside it.)
describe("the search with MPT off", () => {
  it.each(["xrpl", "xahau"] as const)("answers 48 hex digits on %s with the help page, class short, no redirect and no request", async (net) => {
    mock = mockUpstream(net);
    const path = `/${net}/search?q=${MPT_FIXTURE_IDS.htf.toLowerCase()}`;
    const { response, html } = await page(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(textOf(html)).toContain("No match");
    expect(textOf(html)).not.toContain("MPT issuance ID");
    expect(anchors(html).filter((a) => /href="[^"]*\/mpt\//.test(a.attrs))).toEqual([]);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });
});
