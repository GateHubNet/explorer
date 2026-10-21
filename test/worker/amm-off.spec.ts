import { afterEach, describe, expect, it } from "vitest";
import { encodeAccountID } from "ripple-address-codec";

import { shortAddress } from "../../app/domain/format";
import { anchors, hrefs, pageClient, textOf } from "../support/pages";
import { mockUpstream, type Overrides, type UpstreamMock } from "../support/upstream";

// The AMM pages with every switch "off" (the `worker-off` project, README "Switches"), as production has them until the owner turns `AMM_PAGES`
// on (AMM spec 1.4 and 10, Review Focus 1 of the plan). `AMM_PAGES` is page-level: every view of the list, of a pool and of a pair, and the pool's
// link-preview image, is a 404 of class `short` made before any call (neither the path nor the query is read: no redirect, no "not a pool"); the
// header's AMM is the "soon" label; and every link to a pool (a sentence, a flow, an LP token) leads to the pool's account page, which says
// nothing of a pool page. The `worker` project's cases, with the switch on, are amm-list.spec.ts, amm-pool.spec.ts and og.spec.ts.

const { get, page, storedAs } = pageClient("198.18.52");

/** The featured pool of the fixtures: XRP/RLUSD (stored RLUSD/XRP). */
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const RLUSD = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
/** A recorded Payment that swaps through the pool: its sentence and its flow name it. */
const SWAP = "52E2AD5B382D4588BECF6A743E7AE5C84D49A5C06968EC7700E8333BF41E1C60";

const SHORT = { cls: "short", ttl: 30 };
const IMMUTABLE = { cls: "immutable", ttl: 31_536_000 };

let mock: UpstreamMock | undefined;
afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  expect(unused ?? []).toEqual([]);
});

describe("the AMM pages with AMM_PAGES off", () => {
  it.each([
    ["/xrpl/amm", "XRPL"],
    ["/xrpl/amm?asset=XRP", "XRPL"],
    // A view that the list would redirect, one behind a marker, and one with an asset that does not parse: none of them is read.
    ["/xrpl/amm?deleted=1&asset=rlusd", "XRPL"],
    ["/xrpl/amm?marker=WzEwNzY3MTU5MSwxNCwxXQ", "XRPL"],
    ["/xrpl/amm?asset=%E2%82%AC%E2%82%AC", "XRPL"],
    [`/xrpl/amm/${POOL}`, "XRPL"],
    [`/xrpl/amm/${POOL}?period=1y&tab=liquidity`, "XRPL"],
    [`/xrpl/amm/${POOL}?marker=WzEwNzY3MDM2MCw1XQ`, "XRPL"],
    // An id that is no address, and a pair: the switch is read before either.
    ["/xrpl/amm/nope", "XRPL"],
    [`/xrpl/amm/XRP/RLUSD.${RLUSD}`, "XRPL"],
    [`/xrpl/amm/RLUSD.${RLUSD}/XRP`, "XRPL"],
    [`/xrpl/amm/xrp/RLUSD+${RLUSD}`, "XRPL"],
    // Xahau, whose page explains that it has no AMM while the switch is on.
    ["/xahau/amm", "Xahau"],
    ["/xahau/amm?asset=XAH", "Xahau"],
    [`/xahau/amm/${POOL}`, "Xahau"],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path, name) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    const html = await response.text();

    expect(response.status, html.slice(0, 400)).toBe(404);
    expect(textOf(html)).toContain(`We couldn’t find the AMM pages on ${name}.`);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it.each([
    ["the list", "/xrpl/amm.data?_routes=routes%2Fnet.amm._index"],
    ["a pool", `/xrpl/amm/${POOL}.data?_routes=routes%2Fnet.amm.%24pool`],
    ["a pair", `/xrpl/amm/XRP/RLUSD.${RLUSD}.data?_routes=routes%2Fnet.amm.%24base.%24counter`],
  ])("answers the .data URL of %s (a client-side navigation) with a 404 too, and no call", async (_what, path) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    await response.text();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });

  it("answers the pool's link-preview image with a 404 of class short, asks nothing and draws nothing", async () => {
    mock = mockUpstream("xrpl");
    const path = `/og/xrpl/amm/${POOL}.png`;
    const response = await get(path);
    await response.arrayBuffer();

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("sends an image URL with a query to the bare path first (the image routes' own rule, before the switch is read), which is the 404", async () => {
    mock = mockUpstream("xrpl");
    const bare = `/og/xrpl/amm/${POOL}.png`;
    const redirect = await get(`${bare}?utm_source=chat`);
    await redirect.arrayBuffer();
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe(bare);
    expect(await storedAs(`${bare}?utm_source=chat`)).toEqual(IMMUTABLE);

    const target = await get(bare);
    await target.arrayBuffer();
    expect(target.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });

  it("answers the image of a pool on Xahau with the same 404, and no call", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/og/xahau/amm/${POOL}.png`);
    await response.arrayBuffer();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });
});

describe("the header with AMM_PAGES off", () => {
  it.each(["/xrpl", "/xahau"])("shows AMM on %s as 'soon', a label and not a link", async (path) => {
    mock = mockUpstream(path === "/xrpl" ? "xrpl" : "xahau");
    const { html } = await page(path);

    expect(html).toContain('<span class="nav-item is-soon" aria-disabled="true"><span>AMM</span><span class="soon">soon</span></span>');
    expect(html).not.toMatch(/href="\/(xrpl|xahau)\/amm"/);
    expect(anchors(html).map((a) => a.text)).not.toContain("AMM");
  });
});

describe("the links to a pool with AMM_PAGES off", () => {
  it("lead from a transaction through the pool (its sentence and its flow) to the pool's account page, and nowhere under /amm/", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${SWAP}`);

    expect(hrefs(html)).toContain(`/xrpl/account/${POOL}`);
    expect(html).not.toContain("/xrpl/amm/");
    expect(hrefs(html).filter((href) => href.includes("/amm"))).toEqual([]);
    // The flow's label is text: no link in it.
    const flow = /aria-label="Flow of funds"[\s\S]*?<\/section>/.exec(html)![0];
    expect(flow).toMatch(/class="flow__label">XRP\/RLUSD AMM pool<\/span>/);
    // The sentence's pool is the pair, linked to the account.
    const pool = anchors(html).find((a) => a.text === "XRP/RLUSD")!;
    expect(pool.attrs).toContain(`href="/xrpl/account/${POOL}"`);
  });

  // Answers of their own: no recording holds an LP token's holder or the pool's own account page. The holder is a valid address of 20 bytes of 0xA5.
  const HOLDER = encodeAccountID(new Uint8Array(20).fill(0xa5));
  const LP = `03${"5A".repeat(19)}`;

  /** A funded account with no history, whose `account_info` has `flags` and whose balances are XRP and `tokens`. */
  const accountAnswers = (address: string, flags: number, tokens: Array<Record<string, unknown>> = []): Overrides => ({
    [`GET /v2/accounts/${address}`]: {
      result: "success",
      account_data: { account: address, parent: "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ", initial_balance: "25", inception: "2025-07-15T18:30:43Z", ledger_index: 97500000, tx_hash: "9B".repeat(32) },
    },
    [`GET /v2/accounts/${address}/balances`]: { result: "success", ledger_index: 107721455, limit: 200, balances: [{ currency: "XRP", value: "25" }, ...tokens] },
    [`GET /v2/accounts/${address}/transactions?descending=true&limit=20`]: { result: "success", count: 0, transactions: [] },
    [`node account_info ${address}`]: {
      account_data: {
        Account: address,
        Balance: "25000000",
        Flags: flags,
        LedgerEntryType: "AccountRoot",
        OwnerCount: 0,
        PreviousTxnID: "C7FE6468BA25CE904C41722C0892316954133B000339C644073A88CACD8A9143",
        PreviousTxnLgrSeq: 107720688,
        Sequence: 12,
      },
      ledger_index: 107721455,
      validated: true,
    },
    [`node account_objects ${address}`]: { account: address, account_objects: [], ledger_index: 107721455, validated: true },
  });

  it("lead from an LP token on its holder's page to the pool's account page", async () => {
    mock = mockUpstream("xrpl", accountAnswers(HOLDER, 0, [{ currency: LP, counterparty: POOL, value: "1042.77" }]));
    const { html } = await page(`/xrpl/account/${HOLDER}`);

    expect(textOf(html)).toContain(`LP token AMM pool ${shortAddress(POOL)} 1,042.77`);
    expect(hrefs(html)).toContain(`/xrpl/account/${POOL}`);
    expect(html).not.toContain("/xrpl/amm/");
  });

  it("leave the pool's own account page without a line to the pool page: it shows the flag, as it did", async () => {
    mock = mockUpstream("xrpl", accountAnswers(POOL, 0x02000000));
    const { html } = await page(`/xrpl/account/${POOL}`);
    const text = textOf(html);

    expect(text).toContain("AMM pool account");
    expect(text).not.toContain("This account is an AMM pool");
    expect(text).not.toContain("See the pool");
    expect(html).not.toContain("/xrpl/amm/");
  });
});
