import { afterEach, describe, expect, it } from "vitest";
import { encodeAccountID } from "ripple-address-codec";

import { shortAddress, shortHash } from "../../app/domain/format";
import { plainNameOf } from "../../app/domain/names";
import type { AccountListPageData } from "../../app/server/account-view";
import type { Delegation, DelegationsPage } from "../../app/server/api-types";
import { loadAccountPage } from "../support/account-loader";
import { isStored } from "../support/nft-pages";
import { viewOf, withoutNamesOrTomls } from "../support/names";
import { DELEGATE, DELEGATOR, delegationsSample, objectCoverageSample } from "../support/object-samples";
import { anchors, hrefs as rawHrefs, pageClient, tableRows, textOf } from "../support/pages";
import { dataApiError, mockUpstream, statusesOf, type Overrides, type UpstreamMock } from "../support/upstream";

// The account page's Delegation tab, `/{net}/account/{address}?tab=delegation` (ledger object pages spec 6.1), on the real Worker against the recorded delegations of the active XRPL
// account (three given, two held: the board's) and, where a test needs what the recordings do not hold (a call that fails, an account of its own, a coverage that starts late), answers
// of its own. The names of the accounts it draws are account-names.spec.ts's; the tab with its switch off, and Xahau's lack of it, are delegation-off.spec.ts's (and Xahau's here).
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included (and an error is never stored), so: the tests of failing upstreams come first,
// and each of them asks for an account nobody else asks for (`account(n)` makes one from a number: a valid address, funded in no recording, whose every answer the test gives).

const { page, get, storedAs } = pageClient("198.18.92");

let mock: UpstreamMock | undefined;
afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  expect(unused ?? []).toEqual([]);
});

// The recorded accounts (test/fixtures/http, README "Upstream fixtures").
const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const XAHAU_ACTIVE = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";
/** Deleted, with a name and a label, and no delegation: the index answers both lists empty and whole. */
const DELETED = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";
const MARKER = "WzEwNzYxMjU3MywyNV0";

const LIVE = { cls: "live", ttl: 5 };
const SHORT = { cls: "short", ttl: 30 };

/** A valid address that no recording has: 20 bytes of `n`. */
const account = (n: number) => encodeAccountID(new Uint8Array(20).fill(n));

/** The `href`s of a page as a browser reads them (`&amp;` is `&`). */
const hrefs = (html: string) => rawHrefs(html).map((href) => href.replace(/&amp;/g, "&"));

const given = (a: string) => `GET /v2/accounts/${a}/delegations?direction=given&limit=200`;
const held = (a: string) => `GET /v2/accounts/${a}/delegations?direction=held&limit=200`;

/** The answers of an active account of `address` on the XRP Ledger that owns nothing and has no history; the delegations are the test's (the index answers an account it has none of with empty lists). */
function active(address: string, ledger: number): Overrides {
  return {
    [`GET /v2/accounts/${address}`]: {
      result: "success",
      account_data: { account: address, parent: "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ", initial_balance: "25", inception: "2025-07-15T18:30:43Z", ledger_index: 97500000, tx_hash: "9B".repeat(32) },
    },
    [`GET /v2/accounts/${address}/balances`]: { result: "success", ledger_index: 107721455, limit: 200, balances: [{ currency: "XRP", value: "25" }] },
    [`node account_info ${address}`]: {
      account_data: { Account: address, Balance: "25000000", Flags: 0, LedgerEntryType: "AccountRoot", OwnerCount: 0, PreviousTxnLgrSeq: ledger, Sequence: 12 },
      ledger_index: 107721455,
      validated: true,
    },
    [`node account_objects ${address}`]: { account: address, account_objects: [], ledger_index: 107721455, validated: true },
    [`GET /v2/ledgers/${ledger}`]: { result: "success", ledger: { ledger_index: ledger, close_time: 1792253462 } },
  };
}

/** A delegation `owner` gave `delegate`: the sample's, with these permissions and its own ID. */
function delegation(owner: string, delegate: string, id: string, permissions: Delegation["permissions"]): Delegation {
  return { ...delegationsSample().delegations[0]!, delegation_id: id, account: owner, authorize: delegate, permissions };
}
const ID = (n: number) => n.toString(16).toUpperCase().padStart(64, "0");

/** A page of the delegations of `a`, `delegations` over the sample's page. */
const pageOf = (delegations: Delegation[], over: Partial<DelegationsPage> = {}): DelegationsPage => delegationsSample({ delegations, count: delegations.length, ...over });

/** The chips of each row of the table `label`, in the order drawn: name, kind and tooltip. */
function chipsOf(html: string, label: string): Array<Array<[string, string, string]>> {
  const start = html.indexOf(`role="table" aria-label="${label}"`);
  expect(start, `a table named ${label}`).toBeGreaterThanOrEqual(0);
  const end = html.indexOf('role="table"', start + 10);
  return (html.slice(start, end < 0 ? undefined : end).split('<div role="row"').slice(2)).map((row) =>
    [...row.matchAll(/<span class="permchip(?: permchip--(\w+))?" title="([^"]*)">([^<]*)<span class="sr">/g)].map((chip): [string, string, string] => [chip[3]!, chip[1] ?? "transaction", chip[2]!]),
  );
}

/** The tab bar's HTML. */
const nav = (html: string) => /<nav class="tabs" aria-label="Account activity">([\s\S]*?)<\/nav>/.exec(html)![1]!;

// ---------------------------------------------------------------------------------------------------------------------------
// When an upstream fails. First in the file.

describe("when a list of the tab cannot be loaded", () => {
  it("says Couldn’t load delegations when the held call fails, with a Retry, and does not store the page; the next good render is stored", async () => {
    const a = account(31);
    let calls = 0;
    mock = mockUpstream("xrpl", {
      ...active(a, 107700731),
      [given(a)]: pageOf([delegation(a, DELEGATE, ID(1), [{ permission: "Payment", kind: "transaction" }])]),
      [held(a)]: () => (++calls === 1 ? dataApiError(503, "unavailable") : Response.json(pageOf([delegation(DELEGATOR, a, ID(2), [{ permission: "TrustSet", kind: "transaction" }])]))),
    });

    const first = await get(`/xrpl/account/${a}?tab=delegation`);
    const html = await first.text();
    const text = textOf(html);
    expect(first.status).toBe(200);
    // The header is the page's own, and the list is the section that failed, whole: neither list is drawn, though the given call answered.
    expect(text).toContain(a);
    expect(text).toContain("XRP balance 25");
    expect(text).toContain("Couldn’t load delegations");
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(tableRows(html, "Permissions given")).toEqual([]);
    expect(tableRows(html, "Permissions held")).toEqual([]);
    expect(statusesOf(mock, held(a))).toEqual([503]);
    expect(await isStored(`/xrpl/account/${a}?tab=delegation`)).toBe(false);

    const second = await get(`/xrpl/account/${a}?tab=delegation`);
    const again = await second.text();
    expect(second.headers.get("X-Cache")).toBe("MISS");
    expect(textOf(again)).not.toContain("Couldn’t load");
    expect(tableRows(again, "Permissions given")).toHaveLength(2);
    expect(tableRows(again, "Permissions held")).toHaveLength(2);
    expect(await storedAs(`/xrpl/account/${a}?tab=delegation`)).toEqual(LIVE);
  });

  it("says the same when the given call fails, in the data the page is drawn from, and marks the page degraded", async () => {
    const a = account(32);
    mock = mockUpstream("xrpl", { ...active(a, 107700732), [given(a)]: () => dataApiError(500, "boom"), [held(a)]: pageOf([]) });

    const { data, marks } = await loadAccountPage<AccountListPageData>(`/xrpl/account/${a}?tab=delegation`);
    expect(data.tab).toBe("delegation");
    expect(await data.list).toEqual({ state: "failed", what: "delegations" });
    expect(marks).toEqual(["delegation could not be loaded"]);
    expect(statusesOf(mock, given(a))).toEqual([500]);
  });

  it("says it of a list that takes longer than 4.5 s, before the framework stops streaming at 5 s, and does not store the page", async () => {
    const a = account(33);
    mock = mockUpstream("xrpl", { ...active(a, 107700733), [given(a)]: pageOf([]), [held(a)]: () => new Promise<Response>(() => {}) });
    const started = Date.now();
    const response = await get(`/xrpl/account/${a}?tab=delegation`);
    const html = await response.text();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(textOf(html)).toContain("Couldn’t load delegations");
    expect(await isStored(`/xrpl/account/${a}?tab=delegation`)).toBe(false);
  }, 15_000);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The tab

describe("the Delegation tab", () => {
  it("xrpl: asks both directions with limit 200 and stores the page as live, its canonical URL naming ?tab=delegation", async () => {
    // A made-up account, so that nothing it asks for is in the subrequest cache already and every request reaches the mock.
    const a = account(34);
    mock = mockUpstream("xrpl", {
      ...active(a, 107700734),
      [given(a)]: pageOf([delegation(a, DELEGATE, ID(3), [{ permission: "OfferCreate", kind: "transaction" }])]),
      [held(a)]: pageOf([]),
    });
    const path = `/xrpl/account/${a}?tab=delegation`;
    const { html } = await page(path);

    // The two calls of the tab, in the order of its lists, beside the page's own; nothing else (the names calls are account-names.spec.ts's, the transactions are not asked for).
    expect(
      withoutNamesOrTomls(mock.requests)
        .filter((r) => r.key !== "node server_state")
        .map((r) => r.key)
        .sort(),
    ).toEqual(
      [
        `GET /v2/accounts/${a}`,
        `GET /v2/accounts/${a}/balances`,
        given(a),
        held(a),
        "GET /v2/ledgers/107700734",
        `node account_info account=${a}&ledger_index=validated`,
        `node account_objects account=${a}&ledger_index=validated&limit=400`,
      ].sort(),
    );
    expect(mock.requests.every((r) => r.status === 200)).toBe(true);
    expect(await storedAs(path)).toEqual(LIVE);

    // The tab is its own page: the canonical URL names it, and it is indexable.
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="[^"]*/xrpl/account/${a}\\?tab=delegation"`));
    expect(html).not.toMatch(/<meta name="robots"/);
    expect(html).toContain(`<title>Account ${shortAddress(a)} · XRPL · explorer</title>`);
  });

  it("has the Delegation tab between NFTs and Analytics, a link, the current one on its own page; the other tabs lead on as before", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?tab=delegation`);
    const tabs = anchors(nav(html)).map((a) => [a.text, /href="([^"]*)"/.exec(a.attrs)![1], a.attrs.includes('aria-current="page"'), /rel="([^"]*)"/.exec(a.attrs)?.[1] ?? null]);
    expect(tabs).toEqual([
      ["Transactions", `/xrpl/account/${ACTIVE}`, false, null],
      ["Payments", `/xrpl/account/${ACTIVE}?tab=payments`, false, null],
      ["Trades", `/xrpl/account/${ACTIVE}?tab=trades`, false, null],
      ["Offers", `/xrpl/account/${ACTIVE}?tab=offers`, false, null],
      ["Objects", `/xrpl/account/${ACTIVE}?tab=objects`, false, null],
      ["NFTs", `/xrpl/account/${ACTIVE}?tab=nfts`, false, null],
      ["Delegation", `/xrpl/account/${ACTIVE}?tab=delegation`, true, null],
      ["Analytics", `/xrpl/account/${ACTIVE}?tab=analytics`, false, "nofollow"],
    ]);
    // The account's holdings stay beside the tab, as for every list tab.
    expect(textOf(html)).toContain("Owned objects");
  });

  it("draws three given and two held as the board does", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?tab=delegation`);
    const text = textOf(html);

    // What a delegation is, with the legend of the two kinds of chip.
    expect(text).toContain(
      "A delegation lets another account, the delegate, send some kinds of transaction on this account’s behalf. Each permission is a transaction type or one narrower right, and a delegation grants up to 10.",
    );
    expect(text).toMatch(/transaction type .*narrower right/);

    // Permissions given: the delegate, the chips and how many of the most there can be, the transaction that last set it, and when.
    const rows = tableRows(html, "Permissions given");
    expect(rows[0]).toEqual(["Delegate", "Permissions", "Granted in", "Date (UTC)"]);
    expect(rows.slice(1).map(([who, , granted, when]) => [who, granted, when])).toEqual([
      [shortAddress("rGCMDQCMGueT8HTcKL3j7cA9aJ7qfX92GW"), shortHash("3E76B7DF382BBD6B33DC0874F69F796C3360FCDBED6FE43FB8C5A39269A33FD4"), "2026-10-14 16:03:22"],
      [shortAddress("rneMZ5XxbdDi9oaNFNsR6ZQPEyugUjn4VY"), shortHash("688E69AD9F8DC7E6ABEB29BEE7CC166BE1BD41064E027158958989013A4A255D"), "2026-09-02 11:27:40"],
      [shortAddress("r43VwKWSW5mAVAxJpSk4UNUkRwx7HVt3Yn"), shortHash("F982592FBF9617B9D4B9C70F7B95C953E9270886C65782DF88FAB0372E73737C"), "2026-07-21 08:14:51"],
    ]);
    expect(rows.slice(1).map((row) => row[1]!.match(/\d+ of 10$/)?.[0])).toEqual(["3 of 10", "8 of 10", "3 of 10"]);
    const givenChips = chipsOf(html, "Permissions given");
    expect(givenChips.map((chips) => chips.map(([name, kind]) => [name, kind]))).toEqual([
      [["Payment", "transaction"], ["TrustlineAuthorize", "granular"], ["TrustlineFreeze", "granular"]],
      [
        ["Payment", "transaction"],
        ["PaymentMint", "granular"],
        ["PaymentBurn", "granular"],
        ["TrustSet", "transaction"],
        ["OfferCreate", "transaction"],
        ["OfferCancel", "transaction"],
        ["AccountDomainSet", "granular"],
        ["AccountTransferRateSet", "granular"],
      ],
      [["TrustlineUnfreeze", "granular"], ["MPTokenIssuanceLock", "granular"], ["MPTokenIssuanceUnlock", "granular"]],
    ]);
    // What a chip allows is its tooltip.
    expect(givenChips[0]![1]![2]).toBe("Narrower right. Only authorizing trust lines, within TrustSet");
    expect(givenChips[0]![0]![2]).toBe("Transaction type. Any Payment transaction");

    // The note under the given list: each is a Delegate object the account owns, so they count toward its reserve.
    // `{name}` is the account's plain name, which the fixtures give this one (account-names.spec.ts says it for every sentence).
    const name = plainNameOf((await viewOf("xrpl", ACTIVE))!);
    expect(name).not.toBeNull();
    expect(text).toContain(`Each delegation given is a Delegate object ${name} owns, so these 3 count toward its reserve. A new DelegateSet for the same delegate replaces its whole list.`);

    // Permissions held: whose behalf, the chips, the transaction and the day.
    const heldRows = tableRows(html, "Permissions held");
    expect(heldRows[0]).toEqual(["On behalf of", "Permissions", "Granted in", "Date (UTC)"]);
    expect(heldRows.slice(1).map(([who, , granted, when]) => [who, granted, when])).toEqual([
      [shortAddress("rwzUz9i822B3MGRnogyQkJFu3zWc6HYek1"), shortHash("B073266F590704168475EFAA7CC9D45D33DCA49B76CC6C3913FF8CAF83686E94"), "2026-08-30 19:42:10"],
      [shortAddress("r4CxvmYahDYfTjxCo5YNu6YsLUo6eTFzbX"), shortHash("3BD2DC6A58404CA60E0EA2F7A67B8CC807CEEA24EE1C17283EAC1385F8F5F82D"), "2026-06-11 05:36:02"],
    ]);
    expect(chipsOf(html, "Permissions held").map((chips) => chips.map(([name]) => name))).toEqual([["Payment"], ["TrustSet", "OfferCreate", "OfferCancel"]]);
    expect(heldRows.slice(1).map((row) => row[1]!.match(/\d+ of 10$/)?.[0])).toEqual(["1 of 10", "3 of 10"]);

    // Every account is a link to its page, and the transaction that granted it a link to the transaction.
    const links = hrefs(html);
    expect(links).toEqual(expect.arrayContaining(["rGCMDQCMGueT8HTcKL3j7cA9aJ7qfX92GW", "rneMZ5XxbdDi9oaNFNsR6ZQPEyugUjn4VY", "rwzUz9i822B3MGRnogyQkJFu3zWc6HYek1"].map((who) => `/xrpl/account/${who}`)));
    expect(links).toContain("/xrpl/tx/3E76B7DF382BBD6B33DC0874F69F796C3360FCDBED6FE43FB8C5A39269A33FD4");
    expect(links).toContain("/xrpl/tx/B073266F590704168475EFAA7CC9D45D33DCA49B76CC6C3913FF8CAF83686E94");
    // Complete and short: nothing is said of coverage or of more.
    expect(html).not.toContain('role="note"');
    expect(text).not.toContain("Showing the first");
  });

  it("gives the data the page is drawn from: the two lists, the tab, and the names of the accounts in them", async () => {
    mock = mockUpstream("xrpl");
    const { data } = await loadAccountPage<AccountListPageData>(`/xrpl/account/${ACTIVE}?tab=delegation`);
    expect(data).toMatchObject({ tab: "delegation", mode: "live", delegationTab: "link" });
    const list = await data.list;
    expect(list).toMatchObject({ state: "ok", tab: "delegation", names: { state: "ok" } });
    if (list.state !== "ok" || list.tab !== "delegation") throw new Error("not the delegation list");
    expect(list.given.rows.map((row) => row.permissions.length)).toEqual([3, 8, 3]);
    expect(list.held.rows).toHaveLength(2);
    expect(list.given).toMatchObject({ more: false, coverage: null });
    // The page holds strings and unix seconds, never the API's JSON: no ISO time, no delegation ID's other half.
    expect(JSON.stringify(list)).not.toContain("T16:03:22Z");
    expect(list.given.rows[0]).toMatchObject({ time: Date.UTC(2026, 9, 14, 16, 3, 22) / 1000, ledger: 107652633 });
  });

  it("draws both empty sentences for an account with none, and nothing else under the lists", async () => {
    const a = account(35);
    // The index answers an account it holds no delegation of with empty lists (D5), which the mock does for any account without a file.
    mock = mockUpstream("xrpl", active(a, 107700735));
    const { html } = await page(`/xrpl/account/${a}?tab=delegation`);
    const text = textOf(html);

    expect(text).toContain(`No account may send transactions on ${shortAddress(a)}’s behalf.`);
    expect(text).toContain(`${shortAddress(a)} may not send transactions on any other account’s behalf.`);
    expect(tableRows(html, "Permissions given")).toHaveLength(1);
    expect(tableRows(html, "Permissions held")).toHaveLength(1);
    // The reserve note is about delegations there are; and an answer that is whole needs no note.
    expect(text).not.toContain("count toward its reserve");
    expect(html).not.toContain('role="note"');
    expect(await storedAs(`/xrpl/account/${a}?tab=delegation`)).toEqual(LIVE);
  });

  it("writes the short address in the empty sentences of an account that has a name but also a label: only a plain name is put in a sentence", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${DELETED}?tab=delegation`);
    const text = textOf(html);
    expect(text).toContain("Deleted");
    expect(text).toContain(`No account may send transactions on ${shortAddress(DELETED)}’s behalf.`);
    expect(text).toContain(`${shortAddress(DELETED)} may not send transactions on any other account’s behalf.`);
  });

  it("draws the coverage note under each list for an account whose answer is not complete, with the ledger it starts at as a link", async () => {
    const a = account(36);
    const late = { coverage: objectCoverageSample({ complete: false, from_ledger_index: 102145584 }) };
    mock = mockUpstream("xrpl", {
      ...active(a, 107700736),
      [given(a)]: pageOf([delegation(a, DELEGATE, ID(4), [{ permission: "Payment", kind: "transaction" }])], late),
      [held(a)]: pageOf([], late),
    });
    const { html } = await page(`/xrpl/account/${a}?tab=delegation`);

    const notes = [...html.matchAll(/<p class="coverage-note" role="note">([\s\S]*?)<\/p>/g)].map((note) => textOf(note[1]!));
    expect(notes).toEqual(Array(2).fill("Covers ledger #102,145,584 onwards: earlier delegations are not in the index yet."));
    expect(hrefs(html).filter((href) => href === "/xrpl/ledger/102145584")).toHaveLength(2);
    // Under the list it is about: the given list's note is between the two tables, the held list's after the second.
    const order = [html.indexOf('aria-label="Permissions given"'), html.indexOf('role="note"'), html.indexOf('aria-label="Permissions held"'), html.lastIndexOf('role="note"')];
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("says Showing the first 200 under a list the API cut, and not under the other", async () => {
    const a = account(37);
    mock = mockUpstream("xrpl", {
      ...active(a, 107700737),
      [given(a)]: pageOf([delegation(a, DELEGATE, ID(5), [{ permission: "Payment", kind: "transaction" }])], { marker: MARKER }),
      [held(a)]: pageOf([]),
    });
    const { html } = await page(`/xrpl/account/${a}?tab=delegation`);
    expect(textOf(html).match(/Showing the first 200/g)).toHaveLength(1);
    const given200 = html.indexOf("Showing the first 200");
    expect(given200).toBeGreaterThan(html.indexOf('aria-label="Permissions given"'));
    expect(given200).toBeLessThan(html.indexOf('aria-label="Permissions held"'));
  });

  it("shows an unknown permission as Permission 70001, an outlined chip", async () => {
    const a = account(38);
    mock = mockUpstream("xrpl", {
      ...active(a, 107700738),
      [given(a)]: pageOf([delegation(a, DELEGATE, ID(6), [{ permission: "70001", kind: "unknown" }, { permission: "Payment", kind: "transaction" }])]),
      [held(a)]: pageOf([]),
    });
    const { html } = await page(`/xrpl/account/${a}?tab=delegation`);
    expect(chipsOf(html, "Permissions given")).toEqual([
      [
        ["Permission 70001", "unknown", "A permission this explorer does not know (value 70001)"],
        ["Payment", "transaction", "Transaction type. Any Payment transaction"],
      ],
    ]);
    expect(tableRows(html, "Permissions given")[1]![1]).toMatch(/2 of 10$/);
  });

  it("counts one delegation as one", async () => {
    const a = account(39);
    mock = mockUpstream("xrpl", {
      ...active(a, 107700739),
      [given(a)]: pageOf([delegation(a, DELEGATE, ID(7), [{ permission: "Payment", kind: "transaction" }])]),
      [held(a)]: pageOf([]),
    });
    const { html } = await page(`/xrpl/account/${a}?tab=delegation`);
    expect(textOf(html)).toContain(`Each delegation given is a Delegate object ${shortAddress(a)} owns, so this one counts toward its reserve.`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// What the tab does not have

describe("what has no Delegation tab", () => {
  it("redirects a marker on the tab to the URL without it: the tab has no pages, and no call is made", async () => {
    mock = mockUpstream("xrpl");
    for (const query of [`tab=delegation&marker=${MARKER}`, `tab=delegation&marker=${MARKER}&back=M1.M2`, "tab=delegation&marker=%25"]) {
      const path = `/xrpl/account/${ACTIVE}?${query}`;
      const response = await get(path);
      await response.text();
      expect(response.status, query).toBe(302);
      expect(response.headers.get("Location"), query).toBe(`/xrpl/account/${ACTIVE}?tab=delegation`);
      expect(await storedAs(path)).toEqual(SHORT);
    }
    expect(mock.requests).toEqual([]);
  });

  it("Xahau: no tab, and ?tab=delegation is a 302 to the account page without a call", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/account/${XAHAU_ACTIVE}`);
    // Neither a link nor a "soon" label: Xahau has no delegation, so there is no tab to wait for.
    expect(anchors(nav(html)).map((a) => a.text)).toEqual(["Transactions", "Payments", "Trades", "Offers", "Objects", "URITokens", "Analytics"]);
    expect(nav(html)).not.toContain("Delegation");
    expect(html).not.toContain("tab=delegation");
    expect(mock.requests.some((r) => r.key.includes("/delegations"))).toBe(false);

    const asked = mock.requests.length;
    for (const query of ["tab=delegation", `tab=delegation&marker=${MARKER}`, "tag=7&tab=delegation"]) {
      const path = `/xahau/account/${XAHAU_ACTIVE}?${query}`;
      const response = await get(path);
      await response.text();
      expect(response.status, query).toBe(302);
      expect(response.headers.get("Location"), query).toBe(`/xahau/account/${XAHAU_ACTIVE}`);
      expect(await storedAs(path)).toEqual(SHORT);
    }
    expect(mock.requests.length).toBe(asked);
  });

  it("tidies the .data URL of the tab on Xahau (a client-side navigation) the same way, and asks nothing", async () => {
    mock = mockUpstream("xahau");
    const response = await get(`/xahau/account/${XAHAU_ACTIVE}.data?tab=delegation&_routes=routes%2Fnet.account.%24address`);
    const body = await response.text();
    expect(response.status).toBe(202);
    expect(body).toContain("SingleFetchRedirect");
    expect(body).toContain(`/xahau/account/${XAHAU_ACTIVE}`);
    expect(body).not.toContain("tab=delegation");
    expect(mock.requests).toEqual([]);
  });
});
