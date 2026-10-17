import { describe, expect, it } from "vitest";

import type { Env } from "./env";
import { isNetworkId, networkOf } from "./networks";

const env: Env = {
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid/",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
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
    });
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
