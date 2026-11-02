import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allSwitches } from "../../test/support/switches";
import { staticClosure, valueImports } from "../../test/support/value-imports";
import { featuresOf, NO_FEATURES } from "../ui/features";
import { mptLink } from "./mpt-link";

const LOWER = "0000012a2adb0b3959d60a6e6991f729e1918b7163925230";
const UPPER = LOWER.toUpperCase();
const ON = { ...NO_FEATURES, mpt: true };

describe("mptLink", () => {
  it("is the issuance's page while MPT is on, on either network, with the ID in upper case whatever case it came in", () => {
    expect(mptLink("xrpl", LOWER, ON)).toBe(`/xrpl/mpt/${UPPER}`);
    expect(mptLink("xrpl", UPPER, ON)).toBe(`/xrpl/mpt/${UPPER}`);
    expect(mptLink("xrpl", `${LOWER.slice(0, 20)}${UPPER.slice(20)}`, ON)).toBe(`/xrpl/mpt/${UPPER}`);
    // Xahau has no MPT: its page is the one that says so, and an amount that links there is as good a place to say it.
    expect(mptLink("xahau", LOWER, ON)).toBe(`/xahau/mpt/${UPPER}`);
  });

  it("is null, the plain text, while MPT is off, and for NO_FEATURES", () => {
    expect(mptLink("xrpl", LOWER, NO_FEATURES)).toBeNull();
    expect(mptLink("xahau", UPPER, NO_FEATURES)).toBeNull();
    expect(mptLink("xrpl", UPPER, { ...featuresOf(allSwitches("on")), mpt: false })).toBeNull();
    expect(mptLink("xrpl", UPPER, featuresOf({ ...allSwitches("on"), MPT: "off" }))).toBeNull();
  });

  it("follows MPT alone: no other switch turns it on (TOKENS included), and none turns it off", () => {
    expect(mptLink("xrpl", UPPER, featuresOf({ ...allSwitches("off"), TOKENS: "on", NFTS: "on" }))).toBeNull();
    expect(mptLink("xrpl", UPPER, { ...featuresOf(allSwitches("on")), tokens: false })).toBe(`/xrpl/mpt/${UPPER}`);
    expect(mptLink("xrpl", UPPER, featuresOf({ ...allSwitches("off"), MPT: "on" }))).toBe(`/xrpl/mpt/${UPPER}`);
  });
});

describe("the browser bundle", () => {
  // mpt-link.ts is what every page with an MPT amount loads (the transaction, account and escrow pages, the lists), in `Sentence`'s closure. It is a leaf: it imports the types of the switches and of
  // the network ids, which the compiler erases, and nothing at run time, so it loads no file but itself (and not mpt.ts, which only the MPT pages need).
  const appDir = new URL("../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

  it("imports nothing at run time, and so loads no file but itself", () => {
    expect(valueImports(read("domain/mpt-link.ts"))).toEqual([]);
    expect(staticClosure(appDir, "domain/mpt-link.ts")).toEqual(["domain/mpt-link.ts"]);
  });
});
