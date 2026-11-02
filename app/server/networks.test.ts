import { describe, expect, it } from "vitest";

import { allSwitches } from "../../test/support/switches";
import { networkKindOf } from "../ui/environment";
import { featuresOf } from "../ui/features";
import { isNetworkId as uiIsNetworkId, networkChoices } from "../ui/networks";
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
      kind: "mainnet",
      name: "XRPL",
      label: "XRPL mainnet",
      longName: "the XRP Ledger",
      dexName: "the XRP Ledger DEX",
      native: "XRP",
      ctidNetworkId: 0,
      dataApiUrl: "https://xrpl.data.example.invalid",
      nodeUrl: "https://s1.ripple.com:51234/",
      other: "xahau",
      hasAmm: true,
      hasDelegation: true,
      hasMpt: true,
      software: "rippled",
      displays: ["native", "usd"],
      features: { ...featuresOf(allSwitches("off")), ammData: true },
    });
  });

  it("describes Xahau, whose CTIDs carry network id 21337", () => {
    const xahau = networkOf("xahau", env);
    expect(xahau.ctidNetworkId).toBe(21337);
    expect(xahau).toEqual({
      id: "xahau",
      kind: "mainnet",
      name: "Xahau",
      label: "Xahau mainnet",
      longName: "Xahau",
      dexName: "the Xahau DEX",
      native: "XAH",
      ctidNetworkId: 21337,
      dataApiUrl: "https://xahau.data.example.invalid/",
      nodeUrl: "https://xahau.network/",
      other: "xrpl",
      hasAmm: false,
      hasDelegation: false,
      hasMpt: false,
      software: "xahaud",
      displays: ["native"],
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
    // NFTS likewise: off in this env, on for both networks when the env says so, and no other switch turns it on.
    expect(networkOf("xrpl", env).features.nfts).toBe(false);
    expect(networkOf("xrpl", { ...env, NFTS: "on" }).features.nfts).toBe(true);
    expect(networkOf("xahau", { ...env, NFTS: "on" }).features.nfts).toBe(true);
    expect(networkOf("xrpl", { ...env, AMM_DATA: "on", MARKETS: "on", VALIDATORS: "on", ACCOUNT_ANALYTICS: "on", AMM_PAGES: "on" }).features.nfts).toBe(false);
    // LEDGER_OBJECTS and DELEGATION likewise, each on its own: off in this env, on for both networks when the env says so, and neither turns the other on.
    expect(networkOf("xrpl", env).features.ledgerObjects).toBe(false);
    expect(networkOf("xrpl", env).features.delegation).toBe(false);
    for (const id of ["xrpl", "xahau"] as const) {
      const objects = networkOf(id, { ...env, LEDGER_OBJECTS: "on" }).features;
      expect([objects.ledgerObjects, objects.delegation], id).toEqual([true, false]);
      const delegation = networkOf(id, { ...env, DELEGATION: "on" }).features;
      expect([delegation.ledgerObjects, delegation.delegation], id).toEqual([false, true]);
    }
  });

  // Whether the ledger has permission delegation (the Delegate object): XRPL and XRPL Testnet do, Xahau and Xahau Testnet do not. A fact of the network, as `hasAmm` is,
  // and not a switch: it holds in every environment of its kind, and the public network carries it, because the browser draws the Delegation tab by it.
  it.each([
    ["development", "xrpl", true],
    ["development", "xahau", false],
    ["production", "xrpl", true],
    ["production", "xahau", false],
    ["sandbox", "xrpl", true],
    ["sandbox", "xahau", false],
  ] as const)("says in %s that %s has delegation: %s, whichever switches are on", (environment, id, hasDelegation) => {
    for (const switches of [allSwitches("off"), allSwitches("on")]) {
      const net = networkOf(id, { ...env, ...switches, ENVIRONMENT: environment });
      expect(net.hasDelegation).toBe(hasDelegation);
      expect(publicNetwork(net).hasDelegation).toBe(hasDelegation);
    }
  });

  it("has delegation on the two XRP Ledger networks of each kind and on neither Xahau network", () => {
    const cells = (["mainnet", "testnet"] as const).flatMap((kind) =>
      (["xrpl", "xahau"] as const).map((id) => [kind, id, networkOf(id, { ...env, ENVIRONMENT: kind === "mainnet" ? "development" : "sandbox" }).hasDelegation] as const),
    );
    expect(cells).toEqual([
      ["mainnet", "xrpl", true],
      ["mainnet", "xahau", false],
      ["testnet", "xrpl", true],
      ["testnet", "xahau", false],
    ]);
  });

  // Whether the ledger has multi-purpose tokens (MPT, E14): XRPL and XRPL Testnet do, Xahau and Xahau Testnet do not. A fact of the network, as `hasAmm` and `hasDelegation` are, and not a switch: it holds in
  // every environment of its kind, whatever the `MPT` switch says, and the public network carries it, because the browser draws the token list's MPT tab by it (with the switch).
  it.each([
    ["development", "xrpl", true],
    ["development", "xahau", false],
    ["production", "xrpl", true],
    ["production", "xahau", false],
    ["sandbox", "xrpl", true],
    ["sandbox", "xahau", false],
  ] as const)("says in %s that %s has MPT: %s, whichever switches are on", (environment, id, hasMpt) => {
    for (const switches of [allSwitches("off"), allSwitches("on")]) {
      const net = networkOf(id, { ...env, ...switches, ENVIRONMENT: environment });
      expect(net.hasMpt).toBe(hasMpt);
      expect(publicNetwork(net).hasMpt).toBe(hasMpt);
    }
  });

  it("has MPT on the two XRP Ledger networks of each kind and on neither Xahau network, and the switch is another thing", () => {
    const cells = (["mainnet", "testnet"] as const).flatMap((kind) =>
      (["xrpl", "xahau"] as const).map((id) => [kind, id, networkOf(id, { ...env, ENVIRONMENT: kind === "mainnet" ? "development" : "sandbox" }).hasMpt] as const),
    );
    expect(cells).toEqual([
      ["mainnet", "xrpl", true],
      ["mainnet", "xahau", false],
      ["testnet", "xrpl", true],
      ["testnet", "xahau", false],
    ]);
    // The switch is on for both networks when the env says so, and the fact does not follow it.
    for (const id of ["xrpl", "xahau"] as const) {
      expect(networkOf(id, { ...env, MPT: "on" }).features.mpt, id).toBe(true);
      expect(networkOf(id, { ...env, MPT: "off" }).features.mpt, id).toBe(false);
    }
    expect(networkOf("xahau", { ...env, MPT: "on" }).hasMpt).toBe(false);
    expect(networkOf("xrpl", { ...env, MPT: "off" }).hasMpt).toBe(true);
  });

  it("points each network at the other", () => {
    expect(networkOf(networkOf("xrpl", env).other, env).other).toBe("xrpl");
  });

  // The facts and names of each cell of the sandbox spec's tables (§5), written out here and not read from the module under test.
  const FACTS = {
    mainnet: {
      xrpl: { kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", ctidNetworkId: 0, hasAmm: true, hasDelegation: true, hasMpt: true, software: "rippled", displays: ["native", "usd"] },
      xahau: { kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", ctidNetworkId: 21337, hasAmm: false, hasDelegation: false, hasMpt: false, software: "xahaud", displays: ["native"] },
    },
    testnet: {
      xrpl: { kind: "testnet", name: "XRPL Testnet", label: "XRPL Testnet", longName: "XRPL Testnet", dexName: "the XRPL Testnet DEX", native: "XRP", ctidNetworkId: 1, hasAmm: true, hasDelegation: true, hasMpt: true, software: "rippled", displays: ["native"] },
      xahau: { kind: "testnet", name: "Xahau Testnet", label: "Xahau Testnet", longName: "Xahau Testnet", dexName: "the Xahau Testnet DEX", native: "XAH", ctidNetworkId: 21338, hasAmm: false, hasDelegation: false, hasMpt: false, software: "xahaud", displays: ["native"] },
    },
  } as const;

  // "Sandbox" is not the environment's value: anything but the exact "sandbox" or "production" is development, which shows the mainnets.
  it.each([
    ["development", "mainnet"],
    ["production", "mainnet"],
    ["sandbox", "testnet"],
    ["Sandbox", "mainnet"],
  ] as const)("networkOf in %s gives the %s facts and names", (environment, kind) => {
    const inEnvironment = { ...env, ENVIRONMENT: environment as Env["ENVIRONMENT"] };
    for (const id of ["xrpl", "xahau"] as const) {
      const other = id === "xrpl" ? "xahau" : "xrpl";
      expect(networkOf(id, inEnvironment), `${environment} ${id}`).toMatchObject({ id, other, ...FACTS[kind][id] });
    }
  });

  it("takes the URLs from the env it is given, whatever its environment", () => {
    const sandbox = { ...env, ENVIRONMENT: "sandbox" as const };
    expect(networkOf("xrpl", sandbox).dataApiUrl).toBe("https://xrpl.data.example.invalid");
    expect(networkOf("xahau", sandbox).nodeUrl).toBe("https://xahau.network/");
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
  // The function is app/ui/networks.ts's (the browser asks it too; app/ui/networks.test.ts tests it): the Worker's routes import it from here.
  it("is the one of app/ui/networks.ts, and every id it accepts has a network in each environment's kind", () => {
    expect(isNetworkId).toBe(uiIsNetworkId);
    for (const environment of ["development", "sandbox", "production"] as const) {
      for (const choice of networkChoices(networkKindOf(environment))) {
        expect(isNetworkId(choice.id)).toBe(true);
        expect(networkOf(choice.id, { ...env, ENVIRONMENT: environment }).id).toBe(choice.id);
      }
    }
  });
});

describe("networkIdOfCtid", () => {
  it("knows the network of a CTID id by kind", () => {
    expect([networkIdOfCtid(0, "mainnet"), networkIdOfCtid(21337, "mainnet"), networkIdOfCtid(1, "testnet"), networkIdOfCtid(21338, "testnet")]).toEqual([
      "xrpl",
      "xahau",
      "xrpl",
      "xahau",
    ]);
    // The other kind's ids are not covered: a mainnet CTID in the sandbox, a testnet one elsewhere.
    expect([networkIdOfCtid(0, "testnet"), networkIdOfCtid(21338, "mainnet"), networkIdOfCtid(2, "testnet")]).toEqual([undefined, undefined, undefined]);
  });

  it("gives every network of a kind a CTID id of its own", () => {
    for (const environment of ["development", "sandbox"] as const) {
      const [xrpl, xahau] = (["xrpl", "xahau"] as const).map((id) => networkOf(id, { ...env, ENVIRONMENT: environment }));
      expect(xrpl.ctidNetworkId, environment).not.toBe(xahau.ctidNetworkId);
    }
  });

  it("agrees with the network ids of networkOf", () => {
    for (const environment of ["development", "sandbox", "production"] as const) {
      for (const id of ["xrpl", "xahau"] as const) {
        const network = networkOf(id, { ...env, ENVIRONMENT: environment });
        expect(networkIdOfCtid(network.ctidNetworkId, network.kind), `${environment} ${id}`).toBe(id);
      }
    }
  });

  // Sidechains and the other kind have their own ids (2, 21336, ...): the explorer does not cover them, and must not guess.
  it.each([2, 21336, 65535, -1, 0.5, Number.NaN])("knows no network for %j", (networkId) => {
    expect(networkIdOfCtid(networkId, "mainnet")).toBeUndefined();
    expect(networkIdOfCtid(networkId, "testnet")).toBeUndefined();
  });

  it.each([1, 21338])("knows no mainnet for the testnet id %j", (networkId) => {
    expect(networkIdOfCtid(networkId, "mainnet")).toBeUndefined();
  });

  it.each([0, 21337])("knows no testnet for the mainnet id %j", (networkId) => {
    expect(networkIdOfCtid(networkId, "testnet")).toBeUndefined();
  });
});
