import { describe, expect, it } from "vitest";

import {
  DEFAULT_NETWORK_PARAMS,
  displaysOf,
  networkHref,
  networkScope,
  parseNetworkParams,
  PERIODS,
  queryOf,
  USD_ISSUER,
} from "./network-params";

describe("parseNetworkParams: the canonical query of a view", () => {
  it.each([
    ["", "xrpl", ""],
    ["period=30d", "xrpl", ""],
    ["period=1y&in=usd", "xrpl", "period=1y&in=usd"],
    ["in=usd&period=1y", "xrpl", "period=1y&in=usd"],
    ["period=2y", "xrpl", ""],
    ["in=usd", "xahau", ""],
    ["period=7d&period=90d", "xrpl", "period=7d"],
    ["x=1", "xrpl", ""],
    ["period=1Y", "xrpl", ""],
    ["in=USD", "xrpl", ""],
    ["period=90d&x=1&in=usd", "xrpl", "period=90d&in=usd"],
    ["period=%37d", "xrpl", "period=7d"],
  ] as const)("reads %j on %s as %j", (query, net, canonical) => {
    expect(parseNetworkParams(query, net).canonical).toBe(canonical);
  });

  it("gives the params the query names, the defaults for the rest", () => {
    expect(parseNetworkParams("period=1y&in=usd", "xrpl").params).toEqual({ period: "1y", display: "usd" });
    expect(parseNetworkParams("in=usd", "xrpl").params).toEqual({ period: "30d", display: "usd" });
    expect(parseNetworkParams("period=7d", "xahau").params).toEqual({ period: "7d", display: "native" });
    expect(parseNetworkParams("", "xrpl").params).toEqual(DEFAULT_NETWORK_PARAMS);
  });

  it("reads the first value of a parameter, even when it is unknown and a later one is not", () => {
    expect(parseNetworkParams("period=2y&period=7d", "xrpl").canonical).toBe("");
    expect(parseNetworkParams("in=eur&in=usd", "xrpl").canonical).toBe("");
  });

  it("keeps defaults out of the canonical form and keeps the order period, in", () => {
    expect(parseNetworkParams("in=usd&period=30d", "xrpl").canonical).toBe("in=usd");
    expect(parseNetworkParams("in=usd&period=7d", "xrpl").canonical).toBe("period=7d&in=usd");
  });

  it("is the same query it makes: a canonical query reads back as itself", () => {
    for (const net of ["xrpl", "xahau"] as const) {
      for (const { id } of PERIODS) {
        for (const display of displaysOf(net)) {
          const { canonical } = parseNetworkParams(`period=${id}&in=${display === "usd" ? "usd" : "x"}`, net);
          expect(parseNetworkParams(canonical, net).canonical).toBe(canonical);
        }
      }
    }
  });
});

describe("queryOf", () => {
  it("takes the raw query of a URL, without the question mark", () => {
    expect(queryOf("https://e.test/xrpl/network?period=1y&in=usd")).toBe("period=1y&in=usd");
    expect(queryOf("https://e.test/xrpl/network")).toBe("");
    expect(queryOf("https://e.test/xrpl/network?")).toBe("");
  });

  it("leaves out the pair React Router adds to a data request", () => {
    expect(queryOf("https://e.test/xrpl/network.data?period=1y&_routes=routes%2Fnet.network")).toBe("period=1y");
    expect(queryOf("https://e.test/xrpl/network.data?_routes=routes%2Fnet.network")).toBe("");
    expect(queryOf("https://e.test/xrpl/network.data?_routes=routes%2Fnet.network&period=1y&in=usd")).toBe("period=1y&in=usd");
    expect(queryOf("https://e.test/xrpl/network.data?period=1y&_routes=a%2Cb&in=usd")).toBe("period=1y&in=usd");
  });

  it("keeps what is not canonical as it came, so that the loader can tell", () => {
    expect(queryOf("https://e.test/xrpl/network?period=1y&")).toBe("period=1y&");
    expect(queryOf("https://e.test/xrpl/network?period=%37d")).toBe("period=%37d");
    expect(queryOf("https://e.test/xrpl/network?x=1")).toBe("x=1");
  });

  it("stops at a fragment, and keeps a pair that only starts with _routes", () => {
    expect(queryOf("/xrpl/network?period=1y#top")).toBe("period=1y");
    expect(queryOf("/xrpl/network?_routes_x=1&period=1y")).toBe("_routes_x=1&period=1y");
  });
});

describe("networkHref", () => {
  it("is the path alone for the default view", () => {
    expect(networkHref("xrpl", {})).toBe("/xrpl/network");
    expect(networkHref("xrpl", { period: "30d", display: "native" })).toBe("/xrpl/network");
  });

  it("names a view that is not the default, in the canonical order", () => {
    expect(networkHref("xrpl", { period: "1y", display: "usd" })).toBe("/xrpl/network?period=1y&in=usd");
    expect(networkHref("xrpl", { display: "usd" })).toBe("/xrpl/network?in=usd");
    expect(networkHref("xahau", { period: "7d" })).toBe("/xahau/network?period=7d");
  });

  it("has no USD on Xahau", () => {
    expect(networkHref("xahau", { display: "usd" })).toBe("/xahau/network");
    expect(networkHref("xahau", { period: "90d", display: "usd" })).toBe("/xahau/network?period=90d");
  });
});

describe("networkScope", () => {
  it("is the network and the canonical query", () => {
    expect(networkScope("xrpl", { period: "1y", display: "usd" })).toBe("xrpl?period=1y&in=usd");
    expect(networkScope("xrpl", DEFAULT_NETWORK_PARAMS)).toBe("xrpl");
    expect(networkScope("xahau", { period: "7d", display: "native" })).toBe("xahau?period=7d");
    expect(networkScope("xahau", { period: "30d", display: "usd" })).toBe("xahau");
  });
});

describe("the tables", () => {
  it("has the four periods, in order", () => {
    expect(PERIODS).toEqual([
      { id: "7d", label: "7 days" },
      { id: "30d", label: "30 days" },
      { id: "90d", label: "90 days" },
      { id: "1y", label: "1 year" },
    ]);
  });

  it("starts at 30 days in the native currency", () => {
    expect(DEFAULT_NETWORK_PARAMS).toEqual({ period: "30d", display: "native" });
  });

  it("offers USD on XRPL only", () => {
    expect(displaysOf("xrpl")).toEqual(["native", "usd"]);
    expect(displaysOf("xahau")).toEqual(["native"]);
  });

  it("names GateHub's USD issuer", () => {
    expect(USD_ISSUER).toBe("rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq");
  });
});
