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

describe("NO_FEATURES", () => {
  it("is frozen, so that a component cannot turn a feature on for everyone", () => {
    expect(Object.isFrozen(NO_FEATURES)).toBe(true);
  });
});
