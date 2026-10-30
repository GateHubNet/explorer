import { describe, expect, it } from "vitest";

import { allSwitches } from "../../test/support/switches";
import { FEATURE_NAME, FEATURE_VARS, featuresOf, NO_FEATURES } from "./features";

describe("the switches", () => {
  it("name a feature each, in the order of the list", () => {
    expect(Object.keys(FEATURE_NAME)).toEqual([...FEATURE_VARS]);
  });

  it("have a feature name nobody else has", () => {
    const names = Object.values(FEATURE_NAME);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("featuresOf", () => {
  it('reads "on" as true, for every switch', () => {
    const features = featuresOf(allSwitches("on"));
    expect(Object.keys(features).sort()).toEqual(Object.values(FEATURE_NAME).sort());
    for (const feature of Object.values(FEATURE_NAME)) expect(features[feature], feature).toBe(true);
  });

  it('reads "off" and missing values as false, which is NO_FEATURES', () => {
    expect(featuresOf(allSwitches("off"))).toEqual(NO_FEATURES);
    expect(featuresOf({})).toEqual(NO_FEATURES);
    for (const feature of Object.values(NO_FEATURES)) expect(feature).toBe(false);
    expect(Object.keys(NO_FEATURES).sort()).toEqual(Object.values(FEATURE_NAME).sort());
  });

  it.each(["ON", "On", "yes", "true", "1", "", " on", "on ", true, 1, null])("reads %j as off, whatever the switch", (value) => {
    for (const name of FEATURE_VARS) {
      expect(featuresOf({ [name]: value }), name).toEqual(NO_FEATURES);
    }
  });

  it("turns on the feature of the switch that is on, and no other", () => {
    for (const name of FEATURE_VARS) {
      const features = featuresOf({ ...allSwitches("off"), [name]: "on" });
      for (const other of FEATURE_VARS) expect(features[FEATURE_NAME[other]], `${name} on, ${other}`).toBe(other === name);
    }
  });

  it("ignores what is not a switch", () => {
    expect(featuresOf({ ...allSwitches("on"), BUILD_ID: "on", MARKET: "on" } as never)).toEqual(featuresOf(allSwitches("on")));
  });
});

// MARKETS (E3): the markets pages, the header's Markets link and every link into them.
describe("the MARKETS switch", () => {
  it("is appended after E2's two, and its feature is markets", () => {
    expect(FEATURE_VARS.slice(0, 3)).toEqual(["VALIDATORS", "AMM_DATA", "MARKETS"]);
    expect(FEATURE_NAME.MARKETS).toBe("markets");
  });

  it('is on for "on" only', () => {
    expect(featuresOf({ MARKETS: "on" }).markets).toBe(true);
    for (const value of ["On", "yes", undefined]) expect(featuresOf({ MARKETS: value }).markets, String(value)).toBe(false);
    expect(featuresOf({}).markets).toBe(false);
  });

  it("is off in NO_FEATURES", () => {
    expect(NO_FEATURES.markets).toBe(false);
  });

  it("does not turn on another feature, and no other switch turns it on", () => {
    expect(featuresOf({ MARKETS: "on" })).toEqual({ ...NO_FEATURES, markets: true });
    expect(featuresOf({ ...allSwitches("on"), MARKETS: "off" }).markets).toBe(false);
    expect(featuresOf({ VALIDATORS: "on", AMM_DATA: "on" }).markets).toBe(false);
  });
});

// ACCOUNT_ANALYTICS (E4): the account page's Analytics tab.
describe("the ACCOUNT_ANALYTICS switch", () => {
  // Its place is the fourth, after E2's two and E3's MARKETS. It is checked as a prefix of both lists, not as their last entry, so that a switch
  // appended after it by a later plan (E5's AMM_PAGES) leaves this test as it is.
  it("is the fourth switch, after E2's two and E3's MARKETS, and its feature is accountAnalytics", () => {
    const order = ["VALIDATORS", "AMM_DATA", "MARKETS", "ACCOUNT_ANALYTICS"];
    expect(FEATURE_VARS.slice(0, 4)).toEqual(order);
    expect(FEATURE_VARS.indexOf("ACCOUNT_ANALYTICS")).toBe(3);
    expect(Object.keys(FEATURE_NAME).slice(0, 4)).toEqual(order);
    expect(Object.keys(FEATURE_NAME).indexOf("ACCOUNT_ANALYTICS")).toBe(3);
    expect(FEATURE_NAME.ACCOUNT_ANALYTICS).toBe("accountAnalytics");
  });

  it('is on for "on" only', () => {
    expect(featuresOf({ ACCOUNT_ANALYTICS: "on" }).accountAnalytics).toBe(true);
    for (const value of ["off", "ON", "On", "yes", undefined]) expect(featuresOf({ ACCOUNT_ANALYTICS: value }).accountAnalytics, String(value)).toBe(false);
    expect(featuresOf({}).accountAnalytics).toBe(false);
  });

  it("is off in NO_FEATURES", () => {
    expect(NO_FEATURES.accountAnalytics).toBe(false);
  });

  it("does not turn on another feature, and no other switch turns it on", () => {
    expect(featuresOf({ ACCOUNT_ANALYTICS: "on" })).toEqual({ ...NO_FEATURES, accountAnalytics: true });
    expect(featuresOf({ ...allSwitches("on"), ACCOUNT_ANALYTICS: "off" }).accountAnalytics).toBe(false);
    expect(featuresOf({ VALIDATORS: "on", AMM_DATA: "on", MARKETS: "on" }).accountAnalytics).toBe(false);
  });
});

// AMM_PAGES (E5): the AMM pool pages, the header's AMM link and every link into them.
describe("the AMM_PAGES switch", () => {
  // Its place is the fifth, after E2's two, E3's MARKETS and E4's ACCOUNT_ANALYTICS. Checked as a prefix of both lists, not as their last entry, so that a
  // switch appended after it by a later plan leaves this test as it is.
  it("is the fifth switch, after E2's two, E3's MARKETS and E4's ACCOUNT_ANALYTICS, and its feature is ammPages", () => {
    const order = ["VALIDATORS", "AMM_DATA", "MARKETS", "ACCOUNT_ANALYTICS", "AMM_PAGES"];
    expect(FEATURE_VARS.slice(0, 5)).toEqual(order);
    expect(FEATURE_VARS.indexOf("AMM_PAGES")).toBe(4);
    expect(Object.keys(FEATURE_NAME).slice(0, 5)).toEqual(order);
    expect(Object.keys(FEATURE_NAME).indexOf("AMM_PAGES")).toBe(4);
    expect(FEATURE_NAME.AMM_PAGES).toBe("ammPages");
  });

  it('is on for "on" only', () => {
    expect(featuresOf({ AMM_PAGES: "on" }).ammPages).toBe(true);
    for (const value of ["off", "ON", "On", "yes", undefined]) expect(featuresOf({ AMM_PAGES: value }).ammPages, String(value)).toBe(false);
    expect(featuresOf({}).ammPages).toBe(false);
  });

  it("is off in NO_FEATURES", () => {
    expect(NO_FEATURES.ammPages).toBe(false);
  });

  it("does not turn on another feature, and no other switch turns it on (AMM_DATA least of all)", () => {
    expect(featuresOf({ AMM_PAGES: "on" })).toEqual({ ...NO_FEATURES, ammPages: true });
    expect(featuresOf({ ...allSwitches("on"), AMM_PAGES: "off" }).ammPages).toBe(false);
    expect(featuresOf({ VALIDATORS: "on", AMM_DATA: "on", MARKETS: "on", ACCOUNT_ANALYTICS: "on" }).ammPages).toBe(false);
    expect(featuresOf({ AMM_DATA: "on" }).ammPages).toBe(false);
  });
});

// NFTS (E8): the NFT pages, the header's NFTs link and every link into them (`nftLink`, `collectionLink`).
describe("the NFTS switch", () => {
  // Its place is the sixth, after E2's two, E3's MARKETS, E4's ACCOUNT_ANALYTICS and E5's AMM_PAGES. Checked as a prefix of both lists, not as their last entry,
  // so that a switch appended after it by a later plan leaves this test as it is.
  it("is the sixth switch, after the five before it, and its feature is nfts", () => {
    const order = ["VALIDATORS", "AMM_DATA", "MARKETS", "ACCOUNT_ANALYTICS", "AMM_PAGES", "NFTS"];
    expect(FEATURE_VARS.slice(0, 6)).toEqual(order);
    expect(FEATURE_VARS.indexOf("NFTS")).toBe(5);
    expect(Object.keys(FEATURE_NAME).slice(0, 6)).toEqual(order);
    expect(Object.keys(FEATURE_NAME).indexOf("NFTS")).toBe(5);
    expect(FEATURE_NAME.NFTS).toBe("nfts");
  });

  it('is on for "on" only', () => {
    expect(featuresOf({ NFTS: "on" }).nfts).toBe(true);
    for (const value of ["off", "ON", "On", "yes", undefined]) expect(featuresOf({ NFTS: value }).nfts, String(value)).toBe(false);
    expect(featuresOf({}).nfts).toBe(false);
  });

  it("is off in NO_FEATURES", () => {
    expect(NO_FEATURES.nfts).toBe(false);
  });

  it("does not turn on another feature, and no other switch turns it on", () => {
    expect(featuresOf({ NFTS: "on" })).toEqual({ ...NO_FEATURES, nfts: true });
    expect(featuresOf({ ...allSwitches("on"), NFTS: "off" }).nfts).toBe(false);
    expect(featuresOf({ VALIDATORS: "on", AMM_DATA: "on", MARKETS: "on", ACCOUNT_ANALYTICS: "on", AMM_PAGES: "on" }).nfts).toBe(false);
  });
});

// NAMES (E9): the display names, wherever an account shows. A feature-level switch: no route, no nav link.
describe("the NAMES switch", () => {
  // Its place is the seventh, after the NFTS switch. Checked as a prefix of both lists, not as their last entry, so that a switch appended after it by a later plan
  // leaves this test as it is.
  it("is the seventh switch, after the six before it, and its feature is names", () => {
    const order = ["VALIDATORS", "AMM_DATA", "MARKETS", "ACCOUNT_ANALYTICS", "AMM_PAGES", "NFTS", "NAMES"];
    expect(FEATURE_VARS.slice(0, 7)).toEqual(order);
    expect(FEATURE_VARS.indexOf("NAMES")).toBe(6);
    expect(Object.keys(FEATURE_NAME).slice(0, 7)).toEqual(order);
    expect(Object.keys(FEATURE_NAME).indexOf("NAMES")).toBe(6);
    expect(FEATURE_NAME.NAMES).toBe("names");
  });

  it('is on for "on" only', () => {
    expect(featuresOf({ NAMES: "on" }).names).toBe(true);
    for (const value of ["off", "ON", "On", "yes", undefined]) expect(featuresOf({ NAMES: value }).names, String(value)).toBe(false);
    expect(featuresOf({}).names).toBe(false);
  });

  it("is off in NO_FEATURES", () => {
    expect(NO_FEATURES.names).toBe(false);
  });

  it("does not turn on another feature, and no other switch turns it on", () => {
    expect(featuresOf({ NAMES: "on" })).toEqual({ ...NO_FEATURES, names: true });
    expect(featuresOf({ ...allSwitches("on"), NAMES: "off" }).names).toBe(false);
    expect(featuresOf({ VALIDATORS: "on", AMM_DATA: "on", MARKETS: "on", ACCOUNT_ANALYTICS: "on", AMM_PAGES: "on", NFTS: "on" }).names).toBe(false);
  });
});

// LEDGER_OBJECTS (E10): the escrow, check and payment-channel pages, their redirect, the links into them and the object question of search. Its own switch from DELEGATION,
// which gates the Delegation tab only: the two are independent.
describe("the LEDGER_OBJECTS switch", () => {
  // Its place is the eighth, after NAMES. Checked as a prefix of both lists, not as their last entry, so that a switch appended after it by a later plan leaves this test as it is.
  it("is the eighth switch, after the seven before it, and its feature is ledgerObjects", () => {
    const order = ["VALIDATORS", "AMM_DATA", "MARKETS", "ACCOUNT_ANALYTICS", "AMM_PAGES", "NFTS", "NAMES", "LEDGER_OBJECTS"];
    expect(FEATURE_VARS.slice(0, 8)).toEqual(order);
    expect(FEATURE_VARS.indexOf("LEDGER_OBJECTS")).toBe(7);
    expect(Object.keys(FEATURE_NAME).slice(0, 8)).toEqual(order);
    expect(Object.keys(FEATURE_NAME).indexOf("LEDGER_OBJECTS")).toBe(7);
    expect(FEATURE_NAME.LEDGER_OBJECTS).toBe("ledgerObjects");
  });

  it('is on for "on" only', () => {
    expect(featuresOf({ LEDGER_OBJECTS: "on" }).ledgerObjects).toBe(true);
    for (const value of ["off", "ON", "On", "yes", undefined]) expect(featuresOf({ LEDGER_OBJECTS: value }).ledgerObjects, String(value)).toBe(false);
    expect(featuresOf({}).ledgerObjects).toBe(false);
  });

  it("is off in NO_FEATURES", () => {
    expect(NO_FEATURES.ledgerObjects).toBe(false);
  });

  it("does not turn on another feature, and no other switch turns it on, DELEGATION included", () => {
    expect(featuresOf({ LEDGER_OBJECTS: "on" })).toEqual({ ...NO_FEATURES, ledgerObjects: true });
    expect(featuresOf({ ...allSwitches("on"), LEDGER_OBJECTS: "off" }).ledgerObjects).toBe(false);
    expect(featuresOf({ ...allSwitches("on"), LEDGER_OBJECTS: "off" }).delegation).toBe(true);
    expect(featuresOf({ VALIDATORS: "on", AMM_DATA: "on", MARKETS: "on", ACCOUNT_ANALYTICS: "on", AMM_PAGES: "on", NFTS: "on", NAMES: "on", DELEGATION: "on" }).ledgerObjects).toBe(false);
  });
});

// DELEGATION (E10): the Delegation tab of an account ("soon" while off) and every link into it. The "Sent by" row, the "sent it on behalf of" sentence, the DelegateSet sentences and the
// "· sent by" tail of a list row are not gated by it. Independent of LEDGER_OBJECTS.
describe("the DELEGATION switch", () => {
  it("is the ninth switch, after LEDGER_OBJECTS, and its feature is delegation", () => {
    const order = ["VALIDATORS", "AMM_DATA", "MARKETS", "ACCOUNT_ANALYTICS", "AMM_PAGES", "NFTS", "NAMES", "LEDGER_OBJECTS", "DELEGATION"];
    expect(FEATURE_VARS.slice(0, 9)).toEqual(order);
    expect(FEATURE_VARS.indexOf("DELEGATION")).toBe(8);
    expect(Object.keys(FEATURE_NAME).slice(0, 9)).toEqual(order);
    expect(Object.keys(FEATURE_NAME).indexOf("DELEGATION")).toBe(8);
    expect(FEATURE_NAME.DELEGATION).toBe("delegation");
  });

  it('is on for "on" only', () => {
    expect(featuresOf({ DELEGATION: "on" }).delegation).toBe(true);
    for (const value of ["off", "ON", "On", "yes", undefined]) expect(featuresOf({ DELEGATION: value }).delegation, String(value)).toBe(false);
    expect(featuresOf({}).delegation).toBe(false);
  });

  it("is off in NO_FEATURES", () => {
    expect(NO_FEATURES.delegation).toBe(false);
  });

  it("does not turn on another feature, and no other switch turns it on, LEDGER_OBJECTS included", () => {
    expect(featuresOf({ DELEGATION: "on" })).toEqual({ ...NO_FEATURES, delegation: true });
    expect(featuresOf({ ...allSwitches("on"), DELEGATION: "off" }).delegation).toBe(false);
    expect(featuresOf({ ...allSwitches("on"), DELEGATION: "off" }).ledgerObjects).toBe(true);
    expect(featuresOf({ VALIDATORS: "on", AMM_DATA: "on", MARKETS: "on", ACCOUNT_ANALYTICS: "on", AMM_PAGES: "on", NFTS: "on", NAMES: "on", LEDGER_OBJECTS: "on" }).delegation).toBe(false);
  });
});

describe("NO_FEATURES", () => {
  it("is frozen, so that a component cannot turn a feature on for everyone", () => {
    expect(Object.isFrozen(NO_FEATURES)).toBe(true);
  });
});
