import { describe, expect, it } from "vitest";

import {
  ALL_DISPLAYS,
  DEFAULT_NETWORK_PARAMS,
  networkHref,
  networkScope,
  parseNetworkParams,
  PERIODS,
  USD_ISSUER,
} from "./network-params";

// The views a network has are its fact (`Network.displays`): the mainnet XRPL has the USD view, no other network has.
const XRPL = { id: "xrpl", displays: ["native", "usd"] } as const;
const XAHAU = { id: "xahau", displays: ["native"] } as const;
const TESTNET_XRPL = { id: "xrpl", displays: ["native"] } as const;
const TESTNET_XAHAU = { id: "xahau", displays: ["native"] } as const;

describe("parseNetworkParams: the canonical query of a view", () => {
  it.each([
    ["", XRPL, ""],
    ["period=30d", XRPL, ""],
    ["period=1y&in=usd", XRPL, "period=1y&in=usd"],
    ["in=usd&period=1y", XRPL, "period=1y&in=usd"],
    ["period=2y", XRPL, ""],
    ["in=usd", XAHAU, ""],
    ["period=7d&period=90d", XRPL, "period=7d"],
    ["x=1", XRPL, ""],
    ["period=1Y", XRPL, ""],
    ["in=USD", XRPL, ""],
    ["period=90d&x=1&in=usd", XRPL, "period=90d&in=usd"],
    ["period=%37d", XRPL, "period=7d"],
  ] as const)("reads %j on %j as %j", (query, net, canonical) => {
    expect(parseNetworkParams(query, net).canonical).toBe(canonical);
  });

  it("drops in=usd where the network has no USD view", () =>
    expect(parseNetworkParams("in=usd&period=7d", TESTNET_XRPL)).toEqual({ params: { period: "7d", display: "native" }, canonical: "period=7d" }));

  it("keeps in=usd on mainnet XRPL", () => {
    expect(parseNetworkParams("in=usd", XRPL)).toEqual({ params: { period: "30d", display: "usd" }, canonical: "in=usd" });
    expect(networkHref(XRPL, { display: "usd" })).toBe("/xrpl/network?in=usd");
  });

  it("drops in=usd on every network that is not the mainnet XRPL", () => {
    for (const net of [XAHAU, TESTNET_XRPL, TESTNET_XAHAU]) {
      expect(parseNetworkParams("in=usd", net)).toEqual({ params: DEFAULT_NETWORK_PARAMS, canonical: "" });
    }
  });

  it("gives the params the query names, the defaults for the rest", () => {
    expect(parseNetworkParams("period=1y&in=usd", XRPL).params).toEqual({ period: "1y", display: "usd" });
    expect(parseNetworkParams("in=usd", XRPL).params).toEqual({ period: "30d", display: "usd" });
    expect(parseNetworkParams("period=7d", XAHAU).params).toEqual({ period: "7d", display: "native" });
    expect(parseNetworkParams("", XRPL).params).toEqual(DEFAULT_NETWORK_PARAMS);
  });

  it("reads the first value of a parameter, even when it is unknown and a later one is not", () => {
    expect(parseNetworkParams("period=2y&period=7d", XRPL).canonical).toBe("");
    expect(parseNetworkParams("in=eur&in=usd", XRPL).canonical).toBe("");
  });

  it("keeps defaults out of the canonical form and keeps the order period, in", () => {
    expect(parseNetworkParams("in=usd&period=30d", XRPL).canonical).toBe("in=usd");
    expect(parseNetworkParams("in=usd&period=7d", XRPL).canonical).toBe("period=7d&in=usd");
  });

  it("is the same query it makes: a canonical query reads back as itself", () => {
    for (const net of [XRPL, XAHAU, TESTNET_XRPL, TESTNET_XAHAU]) {
      for (const { id } of PERIODS) {
        for (const display of net.displays) {
          const { canonical } = parseNetworkParams(`period=${id}&in=${display === "usd" ? "usd" : "x"}`, net);
          expect(parseNetworkParams(canonical, net).canonical).toBe(canonical);
        }
      }
    }
  });
});

describe("networkHref", () => {
  it("is the path alone for the default view", () => {
    expect(networkHref(XRPL, {})).toBe("/xrpl/network");
    expect(networkHref(XRPL, { period: "30d", display: "native" })).toBe("/xrpl/network");
  });

  it("names a view that is not the default, in the canonical order", () => {
    expect(networkHref(XRPL, { period: "1y", display: "usd" })).toBe("/xrpl/network?period=1y&in=usd");
    expect(networkHref(XRPL, { display: "usd" })).toBe("/xrpl/network?in=usd");
    expect(networkHref(XAHAU, { period: "7d" })).toBe("/xahau/network?period=7d");
  });

  it("has no USD on Xahau", () => {
    expect(networkHref(XAHAU, { display: "usd" })).toBe("/xahau/network");
    expect(networkHref(XAHAU, { period: "90d", display: "usd" })).toBe("/xahau/network?period=90d");
  });

  it("has no USD on a testnet, XRPL Testnet included", () => {
    expect(networkHref(TESTNET_XRPL, { display: "usd" })).toBe("/xrpl/network");
    expect(networkHref(TESTNET_XRPL, { period: "1y", display: "usd" })).toBe("/xrpl/network?period=1y");
    expect(networkHref(TESTNET_XAHAU, { period: "7d", display: "usd" })).toBe("/xahau/network?period=7d");
  });
});

describe("networkScope", () => {
  it("is the network and the canonical query", () => {
    expect(networkScope(XRPL, { period: "1y", display: "usd" })).toBe("xrpl?period=1y&in=usd");
    expect(networkScope(XRPL, DEFAULT_NETWORK_PARAMS)).toBe("xrpl");
    expect(networkScope(XAHAU, { period: "7d", display: "native" })).toBe("xahau?period=7d");
    expect(networkScope(XAHAU, { period: "30d", display: "usd" })).toBe("xahau");
    expect(networkScope(TESTNET_XRPL, { period: "30d", display: "usd" })).toBe("xrpl");
  });

  it("reads a query against every display where there are no network facts (the clientLoader): a testnet's ?in=usd is a scope no page on screen has", () => {
    const unknown = { id: "xrpl", displays: ALL_DISPLAYS } as const;
    const { params } = parseNetworkParams("in=usd", unknown);
    expect(networkScope(unknown, params)).toBe("xrpl?in=usd");
    expect(networkScope(unknown, params)).not.toBe(networkScope(TESTNET_XRPL, DEFAULT_NETWORK_PARAMS));
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

  it("has every display there is, the native one first", () => {
    expect(ALL_DISPLAYS).toEqual(["native", "usd"]);
  });

  it("names GateHub's USD issuer", () => {
    expect(USD_ISSUER).toBe("rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq");
  });
});
