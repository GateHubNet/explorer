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

describe("NO_FEATURES", () => {
  it("is frozen, so that a component cannot turn a feature on for everyone", () => {
    expect(Object.isFrozen(NO_FEATURES)).toBe(true);
  });
});
