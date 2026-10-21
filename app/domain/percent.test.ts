import { describe, expect, it } from "vitest";

import { sharePercent, wholePercent } from "./percent";

describe("sharePercent", () => {
  it("gives whole percents, half up", () => {
    expect(sharePercent("900", "1300.4")).toBe("69%");
    expect(sharePercent("400", "1300.4")).toBe("31%");
    expect(sharePercent("1", "200")).toBe("1%");
    expect(sharePercent("1", "3")).toBe("33%");
    expect(sharePercent("2", "3")).toBe("67%");
    expect(sharePercent("5", "5")).toBe("100%");
  });

  it("says <1% below one half of a percent", () => {
    expect(sharePercent("0.4", "1300.4")).toBe("<1%");
    expect(sharePercent("0.99", "200")).toBe("<1%");
  });

  it("is exact on a half, whatever the digits", () => {
    expect(sharePercent("0.5", "100")).toBe("1%");
    expect(sharePercent("0.4999999999999999999999", "100")).toBe("<1%");
  });

  it("says nothing of a share of nothing", () => {
    expect(sharePercent("1", "0")).toBe("\u2014");
    expect(sharePercent("soon", "10")).toBe("\u2014");
    expect(sharePercent("1", "soon")).toBe("\u2014");
  });
});

describe("wholePercent", () => {
  it("is sharePercent: whole percents, half up, and <1% below one half of a percent", () => {
    expect(wholePercent("34", "100")).toBe("34%");
    expect(wholePercent("900", "1300.4")).toBe("69%");
    expect(wholePercent("0.5", "100")).toBe("1%");
    expect(wholePercent("0.4", "100")).toBe("<1%");
    expect(wholePercent("0.4999999999999999999999", "100")).toBe("<1%");
    expect(wholePercent("5", "5")).toBe("100%");
  });

  it("says 0% for a part of exactly 0, in any way of writing it, where sharePercent says <1%", () => {
    expect(sharePercent("0", "100")).toBe("<1%");
    expect(wholePercent("0", "100")).toBe("0%");
    expect(wholePercent("0.0000", "100")).toBe("0%");
    expect(wholePercent("-0", "100")).toBe("0%");
    expect(wholePercent("0e5", "100")).toBe("0%");
  });

  it("says nothing of a share of nothing, or of what is not a number", () => {
    expect(wholePercent("0", "0")).toBe("\u2014");
    expect(wholePercent("1", "0")).toBe("\u2014");
    expect(wholePercent("0", "soon")).toBe("\u2014");
    expect(wholePercent("soon", "10")).toBe("\u2014");
    expect(wholePercent("-1", "10")).toBe("\u2014");
  });
});
