import { describe, expect, it } from "vitest";

import { environmentOf, networkKindOf } from "./environment";

describe("environmentOf", () => {
  it("reads the three values", () =>
    expect(["development", "sandbox", "production"].map(environmentOf)).toEqual(["development", "sandbox", "production"]));

  it("takes anything else for development", () =>
    expect([undefined, "", "stag" + "ing", "Sandbox", 1].map(environmentOf)).toEqual(Array(5).fill("development")));
});

describe("networkKindOf", () => {
  it("shows the testnets in the sandbox only", () =>
    expect((["development", "sandbox", "production"] as const).map(networkKindOf)).toEqual(["mainnet", "testnet", "mainnet"]));
});
