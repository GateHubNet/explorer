import { describe, expect, it } from "vitest";

import { shortAddress } from "../../app/domain/format";
import type { AmmPool } from "../../app/server/api-types";
import { collectAddresses } from "../../app/server/names-collect";
import firstPageOfPools from "../fixtures/http/xrpl/data-api/amm/pools@limit=20.json";
import {
  answerNamesAfterTheirEnd,
  expectLinkedAccountsNamed,
  failingNames,
  inCalls,
  issuerTextOf,
  linkedAccounts,
  namedAmong,
  namesCalls,
  namesPartOf,
  namesSpec,
  namesStatuses,
  watchNamesLog,
} from "../support/names";
import { expectDegraded } from "../support/nft-pages";
import { pageClient, tableRows } from "../support/pages";

// The names on the AMM pools list, `/{net}/amm` (display names spec 1 and 5), on the real Worker: one names call after the four, for the issuers of the rows of the table and the holders
// of the slots it links, sorted; each issuer verified or named by GateHub written by its name, a holder's link by its name; no call for an address the table does not draw (a pool, a
// creator, the holder of a slot it shows as Open); none for an asset that does not parse; a failed call leaves the short addresses and the page unstored.
//
// A file of its own, as the names of the live pages are (a stored page answers a second request for the same URL, and the Worker keeps the answer of a names call a minute), each test
// a view of its own, and `namesSpec` takes the subrequest entries away: no test needs another to have run, or not. The page does not poll, so no call asks for the failure hold.

const { get, page } = pageClient("198.51.120");
const { upstream } = namesSpec({ advance: 301_000 });

const ROUTE = "routes/net.amm._index";

/** The pools of the recorded first page, as the data API wrote them. */
const POOLS_OF_PAGE = firstPageOfPools.pools as unknown as AmmPool[];
/** The issuers the table draws, row by row (the stored base's first), once each in the order met: what the loader asks the names of. */
const ISSUERS = collectAddresses(POOLS_OF_PAGE.flatMap((pool) => [pool.base_issuer, pool.counter_issuer]));
/** What the table does not draw as an account: the pool's own account, the creator, and the holder of a slot that has run out (the recorded page's three are: the table says Open). */
const UNSHOWN = collectAddresses(POOLS_OF_PAGE.flatMap((pool) => [pool.amm_account, pool.auction_slot?.holder, pool.created_by])).filter((address) => !ISSUERS.includes(address));

/** The "Pool" cell of each row of the table: the pair, the short account and the issuers' words. */
const cells = (html: string) => tableRows(html, "Pools").slice(1).map((row) => row[0]!);

describe("the names call of the page", () => {
  it("is one, after the four, for the issuers of the rows sorted, and writes each issuer verified or named by GateHub by its name", async () => {
    const mock = upstream("xrpl");
    const { html } = await page("/xrpl/amm");

    expect(namesCalls(mock)).toEqual(inCalls(ISSUERS));
    expect(namesStatuses(mock)).toEqual([200]);
    // After the four calls of the render: it is the last request.
    expect(mock.requests.at(-1)!.url).toContain("/v2/account_names");

    const pools = cells(html);
    expect(pools).toHaveLength(POOLS_OF_PAGE.length);
    let named = 0;
    for (const [at, pool] of POOLS_OF_PAGE.entries()) {
      for (const issuer of [pool.base_issuer, pool.counter_issuer]) {
        if (issuer === undefined) continue;
        const text = await issuerTextOf("xrpl", issuer);
        expect(pools[at], `the row of ${pool.amm_account}`).toContain(text);
        if (text !== shortAddress(issuer)) {
          named += 1;
          expect(pools[at], `the row of ${pool.amm_account}`).not.toContain(shortAddress(issuer));
        }
      }
      // The pool's own account is the short address always.
      expect(pools[at]).toContain(shortAddress(pool.amm_account));
    }
    // The fixtures name some of these issuers, verified and GateHub's, so that the test sees both texts.
    expect(named).toBeGreaterThan(0);
    expect((await namedAmong("xrpl", ISSUERS)).length).toBeGreaterThan(0);
  });

  it("asks for no address that the table does not draw: not the pools, the creators nor the holders of the slots it shows as Open; and carries the names in the page's data", async () => {
    const mock = upstream("xrpl");
    const body = await (await get("/xrpl/amm.data?_routes=routes%2Fnet.amm._index")).text();
    const asked = namesCalls(mock).flat();

    expect(UNSHOWN.length).toBeGreaterThan(0);
    for (const address of UNSHOWN) expect(asked, address).not.toContain(address);
    expect([...asked].sort()).toEqual([...ISSUERS].sort());
    const part = namesPartOf(body, ROUTE);
    expect(part.state).toBe("ok");
    expect(Object.keys(part.map).length).toBeGreaterThan(0);
  });

  // The holder of a slot the table links is an account drawn as a link (`AccountLink`), so it is named with the issuers, and its link reads its name. The recorded first page with
  // its first slot held past the data's "now" (the live set's end), in a view no other test asks for.
  it("asks for the holder of a slot it links, with the issuers, and draws the holder's link by its name", async () => {
    const [first, ...rest] = POOLS_OF_PAGE;
    const holder = first!.auction_slot!.holder!;
    const held = { ...firstPageOfPools, pools: [{ ...first!, auction_slot: { ...first!.auction_slot!, expiration: "2027-01-01T00:00:00Z" } }, ...rest] };
    const mock = upstream("xrpl", { "GET /v2/amm/pools?include_deleted=true&limit=20": held, "GET /v2/account_names": answerNamesAfterTheirEnd() });
    const { html } = await page("/xrpl/amm?deleted=1");

    expect(ISSUERS).not.toContain(holder);
    expect(namesCalls(mock)).toEqual(inCalls([...ISSUERS, holder]));
    // The one account the table links is the holder; it is drawn by the name the call gave it, with the title that says how it is known.
    expect(linkedAccounts(html, "xrpl")).toEqual([holder]);
    expectLinkedAccountsNamed(mock, html, "xrpl");
  });

  it("is none for an asset that does not parse: no pools were asked for, so there is no issuer", async () => {
    const mock = upstream("xrpl");
    await page("/xrpl/amm?asset=nope");
    expect(namesCalls(mock)).toEqual([]);
  });
});

describe("when the names call fails", () => {
  it("leaves the issuers as short addresses, serves the page and does not store it", async () => {
    const logged = watchNamesLog();
    const mock = upstream("xrpl", failingNames());
    const path = "/xrpl/amm?asset=XRP";
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(namesStatuses(mock)).toEqual([503]);
    const pools = cells(html);
    expect(pools.length).toBeGreaterThan(0);
    // Every issuer the call asked for is its short address in the table, as before names.
    const asked = namesCalls(mock).flat();
    expect(asked.length).toBeGreaterThan(0);
    for (const issuer of asked) expect(pools.some((cell) => cell.includes(shortAddress(issuer))), issuer).toBe(true);
    expect(logged()).toBe(1);
  });

  it("marks the data of that page failed, with no names", async () => {
    watchNamesLog();
    upstream("xrpl", failingNames());
    const body = await (await get("/xrpl/amm.data?deleted=1&_routes=routes%2Fnet.amm._index")).text();
    expect(namesPartOf(body, ROUTE)).toEqual({ state: "failed", map: {} });
  });
});
