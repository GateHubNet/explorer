import { describe, expect, it } from "vitest";

import { groupCounts, typeGroups, typeGroupsNote } from "./type-groups";

describe("typeGroups", () => {
  it("lists the XRPL groups in stack order, Other last", () => {
    expect(typeGroups("xrpl").map((g) => [g.id, g.slot])).toEqual([
      ["Payment", 1],
      ["OfferCreate", 2],
      ["OfferCancel", 3],
      ["TrustSet", 4],
      ["AMM", 5],
      ["other", "other"],
    ]);
  });

  it("lists the Xahau groups in stack order, Other last", () => {
    expect(typeGroups("xahau").map((g) => [g.id, g.slot])).toEqual([
      ["Payment", 1],
      ["Invoke", 2],
      ["ClaimReward", 3],
      ["URIToken", 4],
      ["SetHook", 5],
      ["other", "other"],
    ]);
  });

  it("labels a group with its id, and Other as Other", () => {
    for (const net of ["xrpl", "xahau"] as const) {
      for (const group of typeGroups(net)) {
        expect(group.label).toBe(group.id === "other" ? "Other" : group.id);
      }
    }
  });

  it("adds up every type that starts with a prefix, and the others by name", () => {
    const [xrpl, xahau] = [typeGroups("xrpl"), typeGroups("xahau")];
    expect(xrpl.find((g) => g.id === "AMM")).toMatchObject({ prefix: "AMM" });
    expect(xahau.find((g) => g.id === "URIToken")).toMatchObject({ prefix: "URIToken" });
    expect(xrpl.find((g) => g.id === "Payment")).toMatchObject({ types: ["Payment"] });
    expect(xrpl.find((g) => g.id === "other")).toEqual({ id: "other", label: "Other", slot: "other" });
  });

  it("gives the same groups on every call", () => {
    expect(typeGroups("xrpl")).toBe(typeGroups("xrpl"));
  });
});

describe("groupCounts", () => {
  it("sums a row of XRPL type counts per group, a group without a type being 0", () => {
    expect(
      groupCounts("xrpl", { Payment: 10, OfferCreate: 5, AMMDeposit: 2, AMMWithdraw: 1, AccountSet: 3, NFTokenMint: 4 }),
    ).toEqual({ Payment: "10", OfferCreate: "5", OfferCancel: "0", TrustSet: "0", AMM: "3", other: "7" });
  });

  it("adds up every type that starts with URIToken on Xahau", () => {
    const counts = groupCounts("xahau", { URITokenMint: 2, URITokenBuy: 1, Invoke: 5, Payment: 1, AccountSet: 1 });
    expect(counts).toEqual({ Payment: "1", Invoke: "5", ClaimReward: "0", URIToken: "3", SetHook: "0", other: "1" });
  });

  it("does not take a type of the other network's group: AMM is Other on Xahau", () => {
    expect(groupCounts("xahau", { AMMDeposit: 4 }).other).toBe("4");
    expect(groupCounts("xrpl", { URITokenMint: 4 }).other).toBe("4");
  });

  it("matches a type by its whole name, not as a part of another", () => {
    // `Payment` is a name, `AMM` a prefix: PaymentChannelCreate is Other, and a type that merely contains AMM is too.
    expect(groupCounts("xrpl", { PaymentChannelCreate: 6, Payment: 1, XAMM: 2 })).toMatchObject({ Payment: "1", other: "8", AMM: "0" });
  });

  it("is exact beyond the integers a double holds in a sum", () => {
    expect(groupCounts("xrpl", { AMMDeposit: 9007199254740991, AMMWithdraw: 2 }).AMM).toBe("9007199254740993");
  });

  it("is all zeros for an empty row", () => {
    expect(groupCounts("xrpl", {})).toEqual({ Payment: "0", OfferCreate: "0", OfferCancel: "0", TrustSet: "0", AMM: "0", other: "0" });
  });

  it("has one entry for every group, in stack order", () => {
    for (const net of ["xrpl", "xahau"] as const) {
      expect(Object.keys(groupCounts(net, { Payment: 1 }))).toEqual(typeGroups(net).map((g) => g.id));
    }
  });

  it("writes a large sum in full, never in exponent notation", () => {
    expect(groupCounts("xrpl", { Payment: 1e21 }).Payment).toBe("1000000000000000000000");
  });
});

describe("typeGroupsNote", () => {
  it("is the XRPL note", () => {
    expect(typeGroupsNote("xrpl")).toBe("AMM adds up its transaction types; Other is every other type.");
  });

  it("is the Xahau note", () => {
    expect(typeGroupsNote("xahau")).toBe("URIToken adds up its transaction types; Other is every other type.");
  });
});
