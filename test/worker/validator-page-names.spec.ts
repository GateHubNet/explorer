import { describe, expect, it, vi } from "vitest";

import { shortAddress } from "../../app/domain/format";
import type { DomainVerification } from "../../app/server/api-types";
import { ammPoolAccount } from "../support/amm-samples";
import {
  answerNamesAfterTheirEnd,
  dataUrlOf,
  expectAccountsDrawn,
  expectLinkedAccountsNamed,
  failingNames,
  inCalls,
  linkedAccounts,
  MARK_WORDS,
  namedAmong,
  namesCalls,
  namesPartOf,
  namesSpec,
  namesStatuses,
  sorted,
  viewedAmong,
  viewOf,
  watchNamesLog,
  withoutNames,
} from "../support/names";
import { expectDegraded, forgetStored, isStored } from "../support/nft-pages";
import { anchors, pageClient } from "../support/pages";
import { AMENDMENTS, LAST_VALIDATED, SUMMARY, validationsCall, validatorCall } from "../support/validators-calls";
import { fixtureValidator, validationsMarker, validatorCase } from "../support/validators-cases";

// The names of the accounts on a validator's page, `/{net}/validators/{key}` (display names spec 1 and 5), on the real Worker: one names call after the five the page awaits, for the
// accounts a verified domain's toml lists (the page's accounts line), sorted, asking for the failure hold (the page follows the chain); each drawn by what the fixtures say of it; no
// call for a validator that lists none, for a domain that did not verify, or for the page of older validations, which draws no account; and a names call that failed keeps the page
// live (the part is `failed`, the next beat asks again once the hold is over and the browser keeps the names it shows: validator-beat.test.ts) and unstored.
//
// A file of its own, as the names of the live pages are (the hold of a failure is remembered in memory, and a stored page answers a second request for the same URL): each test has
// a validator of its own where it can (the two validators that list accounts are one for each network), a test that says a page is stored or not starts from a cache that holds none
// of it (`forgetStored`), and `namesSpec` takes the subrequest entries away and moves `Date` past the longest hold after each test, so that none needs another to have run, or not.

const { get, page, storedAs } = pageClient("198.51.125");
const { upstream } = namesSpec({ advance: 31_000 });

const ROUTE = "routes/net.validators.$key";
const ACCOUNTS = await validatorCase("xrpl", "with-accounts");
const URI_ACCOUNTS = await validatorCase("xahau", "with-accounts");

/** The accounts a verified validator's toml lists, as D answers them. */
const listedBy = async (net: "xrpl" | "xahau", key: string): Promise<string[]> => {
  const verification = (await fixtureValidator(net, key)).domain_verification;
  return verification?.status === "verified" ? (verification.accounts ?? []) : [];
};

describe("the names call of the live page", () => {
  it("is one, after the five calls of the page, for the accounts the domain lists sorted, and the accounts line draws each by what the fixtures say", async () => {
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/validators/${ACCOUNTS.key}`);

    const listed = await listedBy("xrpl", ACCOUNTS.key);
    expect(listed.length).toBeGreaterThan(1);
    expect(namesCalls(mock)).toEqual(inCalls(listed));
    expect(namesStatuses(mock)).toEqual([200]);
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");
    // The anchor, the validator, its validations, the summary and the amendments: the five, and nothing else.
    expect(withoutNames(mock.requests)).toHaveLength(5);

    // Every account the page links is asked for, and every account asked for is linked.
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xrpl")));
    // The fixtures give these accounts the name of their domain, which is not verified: a name with the "not verified" word.
    const { named } = await expectAccountsDrawn(html, "xrpl");
    expect(named.sort()).toEqual(sorted(listed));
    // ... and the mark that says how the name is known, in the link's own words.
    for (const address of listed) {
      const link = anchors(html).find((a) => a.attrs.includes(`href="/xrpl/account/${address}"`))!;
      expect(link.text).toContain(MARK_WORDS[(await viewOf("xrpl", address))!.name!.kind]);
    }
  });

  it("is Xahau's the same way", async () => {
    const mock = upstream("xahau");
    const { html } = await page(`/xahau/validators/${URI_ACCOUNTS.key}`);

    const listed = await listedBy("xahau", URI_ACCOUNTS.key);
    expect(namesCalls(mock)).toEqual(inCalls(listed));
    expect([...namesCalls(mock).flat()].sort()).toEqual(sorted(linkedAccounts(html, "xahau")));
    // The fixtures name some of the accounts a validator lists and not others (here: the ones they name, as they name them).
    expect((await expectAccountsDrawn(html, "xahau")).named.sort()).toEqual(sorted(await namedAmong("xahau", listed)));
  });

  it("carries the names the call gave in the page's data, and the page is stored as live-home", async () => {
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const path = `/xrpl/validators/${ACCOUNTS.key}.data`;
    await forgetStored(path);
    const body = await (await get(dataUrlOf(path, ROUTE))).text();
    const part = namesPartOf(body, ROUTE);

    expect(part.state).toBe("ok");
    expect(Object.keys(part.map).sort()).toEqual(sorted(namesCalls(mock).flat()));
    expect(await storedAs(dataUrlOf(path, ROUTE))).toEqual({ cls: "live-home", ttl: 1 });
  });

  it("draws each account it lists by the name the data API gives it", async () => {
    const mock = upstream("xrpl", { "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page(`/xrpl/validators/${ACCOUNTS.key}`);
    expectLinkedAccountsNamed(mock, html, "xrpl");
  });

  it("asks for no address that the page does not draw as an account: not an address that is none, not what a domain that did not verify lists", async () => {
    const [first, second] = [ammPoolAccount(781), ammPoolAccount(782)];
    const detail = await fixtureValidator("xrpl", ACCOUNTS.key);
    const toml_url = "https://northpeak.example/.well-known/xrp-ledger.toml";
    const verified: DomainVerification = { status: "verified", toml_url, accounts: [second, "rNotAnAddressAtAll", first] };
    const mock = upstream("xrpl", { [validatorCall(ACCOUNTS.key)]: { ...detail, domain_verification: verified } });
    const { html } = await page(`/xrpl/validators/${ACCOUNTS.key}`);

    expect(namesCalls(mock)).toEqual([sorted([first, second])]);
    expect(linkedAccounts(html, "xrpl")).toEqual([second, first]);

    // A validator whose domain did not verify has no accounts line, whatever D1 sent: no call.
    const other = await validatorCase("xrpl", "unverified");
    const unverified = await fixtureValidator("xrpl", other.key);
    const quiet = upstream("xrpl", { [validatorCall(other.key)]: { ...unverified, domain_verification: { status: "unverified", reason: "not_listed", toml_url, accounts: [first] } } });
    const view = await page(`/xrpl/validators/${other.key}`);
    expect(namesCalls(quiet)).toEqual([]);
    expect(linkedAccounts(view.html, "xrpl")).toEqual([]);
  });

  it("makes no call for a validator that lists no account, and its data says there was nothing to name", async () => {
    const withNone = await validatorCase("xrpl", "verified-unl");
    const mock = upstream("xrpl");
    const path = `/xrpl/validators/${withNone.key}`;
    const { html } = await page(path);

    expect(namesCalls(mock)).toEqual([]);
    expect(linkedAccounts(html, "xrpl")).toEqual([]);
    expect(withoutNames(mock.requests)).toHaveLength(5);
    const body = await (await get(dataUrlOf(`${path}.data`, ROUTE))).text();
    expect(namesPartOf(body, ROUTE)).toEqual({ state: "ok", map: {} });
  });
});

describe("when the names call fails", () => {
  it("serves the live page with the short addresses, unstored, with the part failed, and logs it once", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = `/xrpl/validators/${ACCOUNTS.key}`;
    await forgetStored(path);
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    // The page is whole, as before names: the accounts line is their short addresses, with the whole address on hover.
    const listed = await listedBy("xrpl", ACCOUNTS.key);
    const links = anchors(html).filter((a) => /href="\/xrpl\/account\/r/.test(a.attrs));
    expect(links.map((a) => a.text)).toEqual(listed.map(shortAddress));
    for (const [at, link] of links.entries()) expect(link.attrs).toContain(`title="${listed[at]}"`);
    expect(html).toContain("Live · updates every ledger");
    expect(logged()).toBe(1);
  });

  it("asks for the failure hold: the next beat for the same accounts, a second later, does not make the call again until the hold is over, and then the names arrive and the page is stored", async () => {
    // The beat of the open page: the route's own `.data` request, for the same accounts and so the same key of the names call.
    watchNamesLog();
    const failing = upstream("xrpl", failingNames());
    const beat = dataUrlOf(`/xrpl/validators/${ACCOUNTS.key}.data`, ROUTE);
    await forgetStored(beat);
    const first = await get(beat);
    expect(namesPartOf(await first.text(), ROUTE)).toEqual({ state: "failed", map: {} });
    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect(namesStatuses(failing)).toEqual([503]);

    // A second later: the held failure answers, and the data API is not asked. The answer is not stored either.
    vi.setSystemTime(Date.now() + 1_000);
    const second = await get(beat);
    expect(namesPartOf(await second.text(), ROUTE).state).toBe("failed");
    expect(namesCalls(failing)).toHaveLength(1);
    expect(await isStored(beat)).toBe(false);

    // Past the hold, with the data API answering: the part is ok with the accounts' names, and the answer is stored.
    vi.setSystemTime(Date.now() + 31_000);
    const mock = upstream("xrpl");
    const third = await get(beat);
    const part = namesPartOf(await third.text(), ROUTE);
    expect(part.state).toBe("ok");
    expect(namesCalls(mock)).toHaveLength(1);
    expect(Object.keys(part.map).sort()).toEqual(sorted(await viewedAmong("xrpl", namesCalls(mock)[0]!)));
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
    expect(await storedAs(beat)).toEqual({ cls: "live-home", ttl: 1 });
  });
});

describe("a page of older validations", () => {
  it("draws no account and makes no names call", async () => {
    const { key, marker } = await validationsMarker("xrpl");
    const mock = upstream("xrpl");
    const { html } = await page(`/xrpl/validators/${key}?marker=${marker}`);

    expect(namesCalls(mock)).toEqual([]);
    expect(linkedAccounts(html, "xrpl")).toEqual([]);
    expect(withoutNames(mock.requests).map((request) => request.key).sort()).toEqual([validatorCall(key), validationsCall(key, marker)].sort());
    // (The five calls of the live page are not made: the keys the anchor, the summary and the amendments have.)
    expect(mock.requests.some((request) => [LAST_VALIDATED, SUMMARY, AMENDMENTS].includes(request.key))).toBe(false);
  });
});
