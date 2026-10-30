import { env, exports } from "cloudflare:workers";
import BigNumber from "bignumber.js";
import { isValidClassicAddress } from "ripple-address-codec";
import { parseBalanceChanges } from "ripple-lib-transactionparser";
import { afterEach, describe, expect, it } from "vitest";

// The metadata of the AMMDeposit 83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B in ledger
// 107671558, taken from data-api-new/packages/shared/test/fixtures/xrpl/recorded/107671558.json.gz.
import ammDepositMeta from "../fixtures/runtime/amm-deposit.meta.json";
import { mockUpstream, type UpstreamMock } from "../support/upstream";
import { warmWorker } from "../support/warm-worker";

warmWorker();

describe("the parsing libraries in the Workers runtime", () => {
  it("parseBalanceChanges reads the metadata of an AMMDeposit", () => {
    const changes = parseBalanceChanges(ammDepositMeta);
    expect(Object.keys(changes).length).toBeGreaterThan(0);
  });

  it("isValidClassicAddress answers a boolean, and true for a real address", () => {
    expect(typeof isValidClassicAddress("rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg")).toBe("boolean");
    // The sender of the AMMDeposit above. (rJF2Xa…FQvg, the address the plan uses in its examples, fails its checksum.)
    expect(isValidClassicAddress("rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x")).toBe(true);
  });

  it("BigNumber prints an exponent-form value as a plain decimal", () => {
    expect(new BigNumber("1e-15").toFixed()).toBe("0.000000000000001");
  });
});

describe("the Worker", () => {
  let upstream: UpstreamMock | undefined;
  afterEach(() => {
    upstream?.restore();
    upstream = undefined;
  });

  it("serves an HTML page whose loader reads the Worker's env", async () => {
    // The loader of the /:net layout builds its network from the Worker's env (getEnv throws when the context did not
    // come from workers/app.ts), and the home page's loader reads the data API from it (here the recorded answers), so a
    // 200 here means the env reached them.
    upstream = mockUpstream("xrpl");
    const response = await exports.default.fetch("https://example.com/xrpl");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("<!DOCTYPE html>");
  });

  it("has the bindings the app declares", async () => {
    // The limiter comes from wrangler.jsonc; vitest.config.ts pins the vars and secrets.
    expect((await env.VISITOR_LIMITER.limit({ key: "203.0.113.7" })).success).toBe(true);
    expect(env.DATA_API_KEY).toBe("test-key");
    expect(env.SENTRY_DSN).toBe("");
  });
});
