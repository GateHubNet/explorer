import { describe, expect, it } from "vitest";

import { finePercent, sharePercent, wholePercent } from "./percent";

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

describe("finePercent", () => {
  it("gives two decimals from 1%, two significant digits below it, 0% for nothing and a dash for no whole", () => {
    expect([
      finePercent("35212847105.402318", "100000000000"),
      finePercent("14687625.283682", "100000000000"),
      finePercent("46218377.402915", "64772465269.314"),
      finePercent("18406227.318004", "613401782.117306"),
      finePercent("9996", "1000000"),
      finePercent("0", "5"),
      finePercent("1", "0"),
      finePercent("x", "1"),
    ]).toEqual(["35.21%", "0.015%", "0.071%", "3.00%", "1.0%", "0%", "—", "—"]);
  });

  it("keeps the zeros of two decimals, and is exact on a half", () => {
    expect(finePercent("1", "100")).toBe("1.00%");
    expect(finePercent("5", "5")).toBe("100.00%");
    expect(finePercent("1005", "100000")).toBe("1.01%");
    expect(finePercent("1.004999999999999999999", "100")).toBe("1.00%");
    expect(finePercent("12345", "1000000")).toBe("1.23%");
  });

  it("writes a share under 1% with two significant digits, half up, at any size, and a carry into the next digit keeps two", () => {
    expect(finePercent("0.5", "100")).toBe("0.50%");
    expect(finePercent("0.0155", "100")).toBe("0.016%");
    expect(finePercent("0.0154999999999999999999", "100")).toBe("0.015%");
    expect(finePercent("0.0999", "100")).toBe("0.10%");
    expect(finePercent("0.99999", "100")).toBe("1.0%");
    expect(finePercent("0.00123", "100")).toBe("0.0012%");
  });

  it("never writes an exponent: a share of 1e-7 percent is plain digits", () => {
    // A freshly reset testnet: 100 XRP burned of 100 billion. toPrecision(2) would write 1.0e-7.
    expect(finePercent("100", "100000000000")).toBe("0.00000010%");
    expect(finePercent("1e2", "1e11")).toBe("0.00000010%");
    expect(finePercent("1", "1e30")).not.toMatch(/e/i);
  });

  it("says a dash for a part below 0, a whole that is not above 0 or what is not a number, and 0% for any zero", () => {
    expect(finePercent("-1", "10")).toBe("—");
    expect(finePercent("1", "-10")).toBe("—");
    expect(finePercent("0", "0")).toBe("—");
    expect(finePercent("0", "x")).toBe("—");
    expect(finePercent("1", "")).toBe("—");
    expect(finePercent("0.000", "5")).toBe("0%");
    expect(finePercent("-0", "5")).toBe("0%");
  });
});
