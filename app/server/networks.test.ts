import { describe, expect, it } from "vitest";

import { allSwitches } from "../../test/support/switches";
import { featuresOf } from "../ui/features";
import type { Env } from "./env";
import { publicNetwork } from "./network-route";
import { isNetworkId, networkIdOfCtid, networkOf } from "./networks";

const env: Env = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid/",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("off"),
  AMM_DATA: "on",
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};

describe("networkOf", () => {
  it("describes the XRP Ledger", () => {
    expect(networkOf("xrpl", env)).toEqual({
      id: "xrpl",
      name: "XRPL",
      native: "XRP",
      ctidNetworkId: 0,
      dataApiUrl: "https://xrpl.data.example.invalid",
      nodeUrl: "https://s1.ripple.com:51234/",
      other: "xahau",
      hasAmm: true,
      software: "rippled",
      features: { ...featuresOf(allSwitches("off")), ammData: true },
    });
  });

  it("describes Xahau, whose CTIDs carry network id 21337", () => {
    const xahau = networkOf("xahau", env);
    expect(xahau.ctidNetworkId).toBe(21337);
    expect(xahau).toEqual({
      id: "xahau",
      name: "Xahau",
      native: "XAH",
      ctidNetworkId: 21337,
      dataApiUrl: "https://xahau.data.example.invalid/",
      nodeUrl: "https://xahau.network/",
      other: "xrpl",
      hasAmm: false,
      software: "xahaud",
      features: { ...featuresOf(allSwitches("off")), ammData: true },
    });
  });

  it("names the software each network runs, which decides the file a validator's domain publishes", () => {
    expect(networkOf("xrpl", env).software).toBe("rippled");
    expect(networkOf("xahau", env).software).toBe("xahaud");
    // It is a fact the browser may have, so the public network carries it too.
    expect(publicNetwork(networkOf("xrpl", env)).software).toBe("rippled");
    expect(publicNetwork(networkOf("xahau", env)).software).toBe("xahaud");
  });

  it("carries the switches of the env it is given, the same for both networks", () => {
    expect(networkOf("xrpl", { ...env, VALIDATORS: "on" }).features.validators).toBe(true);
    expect(networkOf("xrpl", env).features.validators).toBe(false);
    expect(networkOf("xahau", { ...env, VALIDATORS: "on" }).features).toEqual(networkOf("xrpl", { ...env, VALIDATORS: "on" }).features);
    expect(networkOf("xrpl", { ...env, AMM_DATA: "off" }).features.ammData).toBe(false);
    // MARKETS is off in this env (allSwitches("off")), and on for both networks when the env says so.
    expect(networkOf("xrpl", env).features.markets).toBe(false);
    expect(networkOf("xrpl", { ...env, MARKETS: "on" }).features.markets).toBe(true);
    expect(networkOf("xahau", { ...env, MARKETS: "on" }).features.markets).toBe(true);
    // ACCOUNT_ANALYTICS likewise: off in this env, on for both networks when the env says so, and no other switch turns it on.
    expect(networkOf("xrpl", env).features.accountAnalytics).toBe(false);
    expect(networkOf("xrpl", { ...env, ACCOUNT_ANALYTICS: "on" }).features.accountAnalytics).toBe(true);
    expect(networkOf("xahau", { ...env, ACCOUNT_ANALYTICS: "on" }).features.accountAnalytics).toBe(true);
    expect(networkOf("xrpl", { ...env, AMM_DATA: "on", MARKETS: "on", VALIDATORS: "on" }).features.accountAnalytics).toBe(false);
    // AMM_PAGES likewise, and AMM_DATA being on (as it is in this env) does not turn it on.
    expect(networkOf("xrpl", env).features.ammPages).toBe(false);
    expect(networkOf("xrpl", { ...env, AMM_PAGES: "on" }).features.ammPages).toBe(true);
    expect(networkOf("xahau", { ...env, AMM_PAGES: "on" }).features.ammPages).toBe(true);
    expect(networkOf("xrpl", { ...env, AMM_DATA: "on", MARKETS: "on", VALIDATORS: "on", ACCOUNT_ANALYTICS: "on" }).features.ammPages).toBe(false);
  });

  it("points each network at the other", () => {
    expect(networkOf(networkOf("xrpl", env).other, env).other).toBe("xrpl");
  });

  it("takes the URLs from the env it is given", () => {
    const moved = networkOf("xrpl", {
      ...env,
      XRPL_DATA_API_URL: "http://localhost:8787",
      XRPL_NODE_URL: "http://localhost:5005",
    });
    expect(moved.dataApiUrl).toBe("http://localhost:8787");
    expect(moved.nodeUrl).toBe("http://localhost:5005");
  });
});

describe("isNetworkId", () => {
  it("accepts the two networks", () => {
    expect(isNetworkId("xrpl")).toBe(true);
    expect(isNetworkId("xahau")).toBe(true);
  });

  it.each(["", "XRPL", "Xahau", "doge", "xrpl ", "constructor", "toString", "__proto__", "hasOwnProperty"])(
    "rejects %j",
    (segment) => {
      expect(isNetworkId(segment)).toBe(false);
    },
  );
});

describe("networkIdOfCtid", () => {
  it("names the network a CTID's network id belongs to", () => {
    expect(networkIdOfCtid(0)).toBe("xrpl");
    expect(networkIdOfCtid(21337)).toBe("xahau");
  });

  it("agrees with the network ids of networkOf", () => {
    for (const id of ["xrpl", "xahau"] as const) {
      expect(networkIdOfCtid(networkOf(id, env).ctidNetworkId)).toBe(id);
    }
  });

  // Testnets and sidechains have their own ids (1, 2, 21338, ...): the explorer does not cover them, and must not guess.
  it.each([1, 2, 21336, 21338, 65535, -1, 0.5, Number.NaN])("knows no network for %j", (networkId) => {
    expect(networkIdOfCtid(networkId)).toBeUndefined();
  });
});
