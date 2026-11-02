import { afterEach, describe, expect, it } from "vitest";

import type { Asset } from "../../app/domain/asset";
import { candleWindow, dayWindowStart, INTERVALS, type Interval } from "../../app/domain/market-params";
import { createDataApi } from "../../app/server/data-api";
import type { Env } from "../../app/server/env";
import { networkOf } from "../../app/server/networks";
import { createNodeRpc } from "../../app/server/node-rpc";
import { passThroughCache } from "../support/subrequest-cache";
import { allSwitches } from "../support/switches";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The generated fixtures of the markets pages, read in the Workers runtime by the clients that read them: the node client's `ammInfo` and
// `ammInfoByPair` on the derived `amm_info` files (scripts/amm-info-fixtures.ts; scripts/amm-info-reader.test.ts does the same in Node), and the
// data API client's pair and markets calls on the files of scripts/market-fixtures.ts. The requests are the clients' own, through `mockUpstream`, so a
// file named otherwise than the request the client makes is an absent answer here, and the client's checks run on every answer.

const env: Env = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("off"),
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};
const xrpl = networkOf("xrpl", env);
const xahau = networkOf("xahau", env);

const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const XRP: Asset = { currency: "XRP" };
const XAH: Asset = { currency: "XAH" };
const RLUSD: Asset = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const EVR: Asset = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };
/** The close times of the newest recorded ledgers (data-api/last_validated.json), in unix seconds. */
const T = { xrpl: Date.parse("2026-10-17T17:01:12Z") / 1000, xahau: Date.parse("2026-10-17T17:47:11Z") / 1000 };

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

/** Every request the mock answered was answered from a fixture file, with a 200. */
function allFromFiles(): void {
  expect(mock!.requests.length).toBeGreaterThan(0);
  for (const request of mock!.requests) expect([request.key, request.source, request.status]).toEqual([request.key, "fixture", 200]);
}

describe("the derived amm_info files, read by the node client in the Workers runtime", () => {
  it("give the XRP/RLUSD pool by its account", async () => {
    mock = mockUpstream("xrpl");
    const pool = await createNodeRpc(xrpl, passThroughCache).ammInfo(POOL);
    expect(pool.account).toBe(POOL);
    expect(pool.lp_token.issuer).toBe(POOL);
    expect(pool.ledger_index).toBe(107721455);
    allFromFiles();
  });

  it("give the same pool by the pair XRP/RLUSD, the XRP side first", async () => {
    mock = mockUpstream("xrpl");
    const node = createNodeRpc(xrpl, passThroughCache);
    const byPair = await node.ammInfoByPair(XRP, RLUSD);
    expect(byPair.account).toBe(POOL);
    expect(byPair.amount.currency).toBe("XRP");
    expect(byPair.amount2).toMatchObject({ currency: RLUSD.currency, issuer: RLUSD.issuer });
    expect(byPair).toEqual(await node.ammInfo(POOL));
    allFromFiles();
  });
});

describe("the market files, read by the data API client in the Workers runtime", () => {
  it("serve XRP/RLUSD's trades 20 to a page, through the marker to the last page, for all trades and for each Trades filter", async () => {
    mock = mockUpstream("xrpl");
    const api = createDataApi(xrpl, env, passThroughCache);
    for (const amm of [undefined, "exclude", "only"] as const) {
      const first = await api.pairExchanges(XRP, RLUSD, { descending: true, limit: 20, amm });
      let rows = first.exchanges.length;
      let marker = first.marker;
      while (marker !== undefined) {
        const next = await api.pairExchanges(XRP, RLUSD, { descending: true, limit: 20, marker, amm });
        rows += next.exchanges.length;
        marker = next.marker;
      }
      expect(rows, `amm ${amm}`).toBeGreaterThan(0);
    }
    expect((await api.pairExchanges(XRP, RLUSD, { descending: true, limit: 1 })).exchanges).toHaveLength(1);
    allFromFiles();
  });

  it("serve the candles of every interval, the 24-hour rows and the active accounts of XRP/RLUSD and EVR/XAH", async () => {
    mock = mockUpstream("xrpl");
    const pairs = [
      { api: createDataApi(xrpl, env, passThroughCache), base: XRP, counter: RLUSD, now: T.xrpl, filters: [undefined, "exclude", "only"] as const },
      { api: createDataApi(xahau, env, passThroughCache), base: EVR, counter: XAH, now: T.xahau, filters: [undefined] as const },
    ];
    for (const { api, base, counter, now, filters } of pairs) {
      for (const amm of filters) {
        for (const interval of Object.keys(INTERVALS) as Interval[]) {
          const candles = await api.pairCandles(base, counter, { interval: INTERVALS[interval].api, start: candleWindow(now, interval).start, limit: 61, amm });
          expect(candles.exchanges.length, `${interval} ${amm}`).toBeGreaterThan(0);
        }
        expect((await api.pairReduce(base, counter, { start: dayWindowStart(now), amm })).start).toBe(dayWindowStart(now));
      }
      expect((await api.activeAccounts(base, counter)).accounts.length).toBeGreaterThan(0);
    }
    allFromFiles();
  });

  it("serve the markets table of every period on both networks, and of each Trades filter on XRPL, which it echoes (include without one)", async () => {
    mock = mockUpstream("xrpl");
    for (const period of ["day", "7day", "30day"] as const) {
      for (const amm of [undefined, "exclude", "only"] as const) {
        const answer = await createDataApi(xrpl, env, passThroughCache).networkMarkets({ period, limit: 1000, amm });
        expect([answer.period, answer.amm]).toEqual([period, amm ?? "include"]);
        expect(answer.markets.length).toBeGreaterThan(0);
      }
      const xahauAnswer = await createDataApi(xahau, env, passThroughCache).networkMarkets({ period, limit: 1000 });
      expect([xahauAnswer.amm, xahauAnswer.totals?.amm_share]).toEqual(["include", "0.0000"]);
    }
    allFromFiles();
  });
});
