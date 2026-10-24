import { describe, expect, it } from "vitest";

import { DEFAULT_NETWORK_ID, findNetwork, NETWORK_NAMES, networkChoices } from "./networks";

// The names of the networks, which the browser has without any layout data (sandbox spec 5, 6): by kind, in the order the switch shows them.

describe("NETWORK_NAMES", () => {
  it("has the names table", () => {
    expect(NETWORK_NAMES).toEqual({
      mainnet: {
        xrpl: { name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX" },
        xahau: { name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX" },
      },
      testnet: {
        xrpl: { name: "XRPL Testnet", label: "XRPL Testnet", longName: "XRPL Testnet", dexName: "the XRPL Testnet DEX" },
        xahau: { name: "Xahau Testnet", label: "Xahau Testnet", longName: "Xahau Testnet", dexName: "the Xahau Testnet DEX" },
      },
    });
  });
});

describe("networkChoices", () => {
  it("lists each kind's networks in the switch's order", () => {
    expect(networkChoices("testnet").map((n) => [n.id, n.kind, n.name])).toEqual([
      ["xrpl", "testnet", "XRPL Testnet"],
      ["xahau", "testnet", "Xahau Testnet"],
    ]);
    expect(networkChoices("mainnet").map((n) => [n.id, n.kind, n.name])).toEqual([
      ["xrpl", "mainnet", "XRPL"],
      ["xahau", "mainnet", "Xahau"],
    ]);
  });

  it("gives each network its id, its kind and all four names", () => {
    expect(networkChoices("testnet")[1]).toEqual({
      id: "xahau",
      kind: "testnet",
      name: "Xahau Testnet",
      label: "Xahau Testnet",
      longName: "Xahau Testnet",
      dexName: "the Xahau Testnet DEX",
    });
    expect(networkChoices("mainnet")[0]).toEqual({
      id: "xrpl",
      kind: "mainnet",
      name: "XRPL",
      label: "XRPL mainnet",
      longName: "the XRP Ledger",
      dexName: "the XRP Ledger DEX",
    });
  });
});

describe("findNetwork", () => {
  it("finds a segment by kind, and nothing else", () => {
    expect(findNetwork("xahau", "testnet")?.longName).toBe("Xahau Testnet");
    expect(findNetwork("xahau", "mainnet")?.longName).toBe("Xahau");
    expect([findNetwork("xrp", "mainnet"), findNetwork(undefined, "testnet"), findNetwork("XRPL", "mainnet")]).toEqual([undefined, undefined, undefined]);
  });
});

describe("DEFAULT_NETWORK_ID", () => {
  it("is XRPL, the first of the switch, which a page that belongs to no network is drawn with", () => {
    expect(DEFAULT_NETWORK_ID).toBe("xrpl");
    expect(findNetwork(DEFAULT_NETWORK_ID, "testnet").name).toBe("XRPL Testnet");
  });
});
