import { afterEach, describe, expect, it, vi } from "vitest";

import { nodeFile } from "../test/support/upstream-core";
import { AMM_INFO_POOLS, ammInfoFixtures, ammInfoResult, ammInfoResultByPair, type AmmInfoPool } from "./amm-info-fixtures";
import { fixtureText, readLedgers } from "./http-fixtures";

// The derived `amm_info` files, read by the client that will read them: createNodeRpc of app/server/node-rpc.ts, with its own `ammInfo` and `ammInfoByPair`
// and its strict checks (the pool is the one asked for, `lp_token` issued by the pool, at most 8 votes and 4 authorised accounts, `validated: true`, amounts
// in the node's form). `fetch` answers from the files the way the upstream mock does (test/support/upstream-core.ts: `nodeFile` names the file a request
// finds), so a file found by a request, the answer in it and the reader are checked together.
//
// node-rpc.ts is Worker code that tsconfig.node.json cannot hold: it imports the Worker's types (networks.ts, env.ts), so TypeScript would want all of them
// in this project. Its imports at run time are Node-safe (types are erased, upstream.ts is plain), so the test loads it by a path TypeScript does not follow
// and types the little of it that it uses. (test/worker/node-rpc.spec.ts runs the same reader in the Workers runtime.)

interface Amount {
  currency: string;
  issuer?: string;
  value: string;
}
interface Pool {
  account: string;
  amount: Amount;
  amount2: Amount;
  lp_token: Amount;
  trading_fee: number;
  vote_slots: unknown[];
  auction_slot?: { account?: string; auth_accounts: string[]; discounted_fee: number; expiration: number; price: Amount; time_interval: number };
  ledger_index: number;
}
interface Asset {
  currency: string;
  issuer?: string;
}
interface Reader {
  ammInfo(pool: string): Promise<Pool>;
  ammInfoByPair(asset: Asset, asset2: Asset): Promise<Pool>;
}

const READER = "../app/server/node-rpc.ts";
const { createNodeRpc } = (await import(/* @vite-ignore */ READER)) as { createNodeRpc(net: unknown, cache: unknown): Reader };

/** What the client reads of a network (networks.ts): the node's URL and the native currency. */
const xrpl = { id: "xrpl", name: "XRPL", native: "XRP", ctidNetworkId: 0, dataApiUrl: "https://xrpl.data.example.invalid", nodeUrl: "https://s1.ripple.com:51234/", other: "xahau", hasAmm: true };
const passThrough = { json: <T>(_key: string, _cls: string, load: () => Promise<T>) => load() };
const reader = (): Reader => createNodeRpc(xrpl, passThrough);

const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const XRP: Asset = { currency: "XRP" };
const RLUSD: Asset = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };

const ledgers = readLedgers("xrpl");

/** `fetch` answering a node request from `files` (by path below test/fixtures/http/), as a node answers, and writing the files it found down. */
function nodeFrom(files: ReadonlyMap<string, string>): string[] {
  const found: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: [Record<string, unknown>] };
    const path = nodeFile("xrpl", method, params[0]!);
    const text = path === undefined ? undefined : files.get(path);
    if (path === undefined || text === undefined) throw new Error(`no fixture file for ${method} ${JSON.stringify(params[0])}`);
    found.push(path);
    return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return found;
}

afterEach(() => vi.restoreAllMocks());

describe("the derived amm_info files, read by the node client", () => {
  const files = ammInfoFixtures();

  it("gives the XRP/RLUSD pool by its account, from the pool's file", async () => {
    const found = nodeFrom(files);
    const pool = await reader().ammInfo(POOL);
    expect(found).toEqual([`xrpl/node/amm_info/${POOL}.json`]);
    // A pool, and the one asked for: what the reader checks and what the explorer shows of it.
    expect(pool.account).toBe(POOL);
    expect(pool.amount).toEqual({ currency: "XRP", value: "1847691.034536" });
    expect(pool.amount2).toEqual({ currency: RLUSD.currency, issuer: RLUSD.issuer, value: "2417282.053464318" });
    expect(pool.lp_token.issuer).toBe(POOL);
    expect(pool.lp_token.value).toBe("1791055986.845366");
    expect(pool.trading_fee).toBe(205);
    expect(pool.vote_slots).toHaveLength(8);
    expect(pool.ledger_index).toBe(107721455);
    // The slot: the node's ISO text read as unix seconds (2026-03-02T17:05:00Z), four authorised accounts, expired.
    expect(pool.auction_slot).toMatchObject({ account: "r4uKh2rHuarMZdAgSBYqqicX7MxPBegttw", discounted_fee: 20, expiration: 1772471100, time_interval: 20 });
    expect(pool.auction_slot?.auth_accounts).toHaveLength(4);
  });

  it("gives the same pool by its pair, from the pair's file", async () => {
    const found = nodeFrom(files);
    const byPair = await reader().ammInfoByPair(XRP, RLUSD);
    expect(found).toEqual(["xrpl/node/amm_info/XRP_524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De.json"]);
    expect(byPair.account).toBe(POOL);
    expect(byPair).toEqual(await reader().ammInfo(POOL));
  });

  it("is a failure, not a pool, for a pair or an account that has no file (the mock's actNotFound is the node's)", async () => {
    nodeFrom(files);
    await expect(reader().ammInfo("rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh")).rejects.toThrow(/no fixture file/);
    await expect(reader().ammInfoByPair(RLUSD, XRP)).rejects.toThrow(/no fixture file/);
  });
});

// The pools E5 adds are not all in XRP/RLUSD's shapes: the answer by pair has `amount` as asked, whichever the pool's own order is, and the reader accepts
// either; a pool whose line has the pool as the high account has its holding negated. They go through the reader as the node would serve them.
describe("the amm_info answers of other recorded pools, read by the node client", () => {
  const pools: Array<[string, AmmInfoPool]> = [
    ["XRP/USD (the pool is the high account of its line)", { pool: "rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am", asset: XRP, asset2: { currency: "USD", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" } }],
    ["DVR/XRP (the natural orientation is the reverse of the pool's own)", { pool: "rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG", asset: { currency: "DVR", issuer: "rpvRJUcmqQqyCHCmYRPW9FXFAGQEcibVz9" }, asset2: XRP }],
    ["USDC/RLUSD (no native currency, no AccountRoot)", { pool: "rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb", asset: { currency: "5553444300000000000000000000000000000000", issuer: "rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE" }, asset2: RLUSD }],
  ];

  it.each(pools)("%s", async (_name, pool) => {
    const files = new Map<string, string>([
      [nodeFile("xrpl", "amm_info", { amm_account: pool.pool })!, fixtureText({ result: ammInfoResult(ledgers, pool) })],
      [nodeFile("xrpl", "amm_info", { asset: pool.asset, asset2: pool.asset2 })!, fixtureText({ result: ammInfoResultByPair(ledgers, pool) })],
    ]);
    nodeFrom(files);
    const byAccount = await reader().ammInfo(pool.pool);
    const byPair = await reader().ammInfoByPair(pool.asset, pool.asset2);
    expect(byAccount.account).toBe(pool.pool);
    expect(byPair.account).toBe(pool.pool);
    // By pair `amount` is the asset asked as `asset`; by account the two are the same holdings in the pool's own order.
    expect(byPair.amount.currency).toBe(pool.asset.currency);
    expect(byPair.amount2.currency).toBe(pool.asset2.currency);
    const holdings = (from: Pool) => new Map([from.amount, from.amount2].map((amount) => [amount.currency, amount.value]));
    expect(holdings(byPair)).toEqual(holdings(byAccount));
    // No holding is negative or empty: the reader refuses a value that is not a non-negative number, and these are the pool's own.
    for (const amount of [byPair.amount, byPair.amount2]) expect(Number(amount.value)).toBeGreaterThan(0);
  });

  it("holds the pool's side of the line where the pool is the high account: 4794.265265945032 USD of the XRP/USD pool", async () => {
    const [, pool] = pools[0]!;
    nodeFrom(new Map([[nodeFile("xrpl", "amm_info", { amm_account: pool.pool })!, fixtureText({ result: ammInfoResult(ledgers, pool) })]]));
    expect((await reader().ammInfo(pool.pool)).amount2.value).toBe("4794.265265945032");
  });
});

// The default export of the generator is the list the later tasks write: its files are the ones read above.
describe("AMM_INFO_POOLS", () => {
  it("has files that the client finds, by account and by pair, for every pool", async () => {
    const files = ammInfoFixtures();
    const found = nodeFrom(files);
    for (const { pool, asset, asset2 } of AMM_INFO_POOLS) {
      expect((await reader().ammInfo(pool)).account).toBe(pool);
      expect((await reader().ammInfoByPair(asset, asset2)).account).toBe(pool);
    }
    expect(new Set(found)).toEqual(new Set(files.keys()));
  });
});
