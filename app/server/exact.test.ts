import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { BN, decimalOf, divided, feePercent, percentText, ratioOf } from "./exact";

const n = (value: string) => new BigNumber(value);

describe("divided", () => {
  it("rounds half away from zero, at the places asked for", () => {
    expect(divided(n("1"), n("8"), 2).toFixed()).toBe("0.13");
    expect(divided(n("-1"), n("8"), 2).toFixed()).toBe("-0.13");
    expect(divided(n("1"), n("3"), 2).toFixed()).toBe("0.33");
    expect(divided(n("2"), n("3"), 0).toFixed()).toBe("1");
    expect(divided(n("5"), n("2"), 0).toFixed()).toBe("3");
    expect(divided(n("-5"), n("2"), 0).toFixed()).toBe("-3");
    expect(divided(n("1234"), n("1"), 1).toFixed()).toBe("1234");
  });

  it("has no negative zero: what rounds to nothing is 0", () => {
    expect(divided(n("-1"), n("1000"), 1).isZero()).toBe(true);
    expect(divided(n("-1"), n("1000"), 1).isNegative()).toBe(false);
    expect(divided(n("0"), n("7"), 2).toFixed()).toBe("0");
  });

  it("rounds once, on the exact quotient: a quotient that is a hair under a tie at the 20th place is not a tie", () => {
    // 0.05 less 1e-30 is under the tie; a division that rounds at 20 places first would read 0.05 and round it up to 0.1.
    const d = n("1e30");
    const nTie = n("5e28").minus(1);
    expect(divided(nTie, d, 1).toFixed()).toBe("0");
    expect(divided(nTie.plus(1), d, 1).toFixed()).toBe("0.1");
  });
});

describe("percentText", () => {
  it("writes a rise with +, a fall with U+2212, and zero with no sign", () => {
    expect(percentText(n("4.2"))).toEqual({ text: "+4.2%", sign: 1 });
    expect(percentText(n("-4.2"))).toEqual({ text: "−4.2%", sign: -1 });
    expect(percentText(n("0"))).toEqual({ text: "0.0%", sign: 0 });
  });

  it("writes one decimal always and groups the integer part", () => {
    expect(percentText(n("12"))).toEqual({ text: "+12.0%", sign: 1 });
    expect(percentText(n("333233.3"))).toEqual({ text: "+333,233.3%", sign: 1 });
    expect(percentText(n("-1000.5"))).toEqual({ text: "−1,000.5%", sign: -1 });
  });
});

describe("ratioOf", () => {
  it("divides to 8 significant digits, half up", () => {
    expect(ratioOf(n("1250"), n("512.4")).toFixed()).toBe("2.4395004");
    expect(ratioOf(n("2"), n("3")).toFixed()).toBe("0.66666667");
    expect(ratioOf(n("1"), n("8")).toFixed()).toBe("0.125");
    // The ninth digit is a 5: half up rounds the eighth.
    expect(ratioOf(n("1.00000005"), n("1")).toFixed()).toBe("1.0000001");
    expect(ratioOf(n("1.000000049"), n("1")).toFixed()).toBe("1");
  });

  it("scales into [1, 10) first, so that the 80 places are significant digits at any size of the amounts", () => {
    // 80 places alone would make 1e-81 ÷ 9.999999999999999e95 a 0.
    expect(ratioOf(n("1e-81"), n("9.999999999999999e95")).toFixed()).toBe(`0.${"0".repeat(176)}1`);
    expect(ratioOf(n("1"), n("3e60")).toFixed()).toBe(`0.${"0".repeat(60)}33333333`);
    expect(ratioOf(n("1e30"), n("3e-30")).toFixed()).toBe(`33333333${"0".repeat(52)}`);
  });

  it("does not depend on the precision the caller's BigNumber was set to", () => {
    const Coarse = BigNumber.clone({ DECIMAL_PLACES: 2, ROUNDING_MODE: BigNumber.ROUND_DOWN });
    expect(ratioOf(new Coarse("2"), new Coarse("3")).toFixed()).toBe("0.66666667");
    expect(ratioOf(new Coarse("1"), new Coarse("3e60")).toFixed()).toBe(`0.${"0".repeat(60)}33333333`);
  });

  it("gives 0 for a numerator of 0 and keeps the sign of a negative one", () => {
    expect(ratioOf(n("0"), n("7")).toFixed()).toBe("0");
    expect(ratioOf(n("-1"), n("8")).toFixed()).toBe("-0.125");
  });
});

describe("feePercent", () => {
  it("writes a fee in units of 1/100000 as a percent with three decimals", () => {
    expect(feePercent(205)).toBe("0.205%");
    expect(feePercent(30)).toBe("0.030%");
    expect(feePercent(0)).toBe("0.000%");
    expect(feePercent(1000)).toBe("1.000%");
    expect(feePercent(1)).toBe("0.001%");
  });
});

describe("decimalOf", () => {
  it("reads a decimal, and the exponent text the API writes, exactly", () => {
    expect(decimalOf("1250.50")?.toFixed()).toBe("1250.5");
    expect(decimalOf("-0.001")?.toFixed()).toBe("-0.001");
    expect(decimalOf("1.250946e-8")?.toFixed()).toBe("0.00000001250946");
    expect(decimalOf("7.6528766e+9")?.toFixed()).toBe("7652876600");
    expect(decimalOf("0")?.isZero()).toBe(true);
  });

  it("is null for what is not number text, and for a missing value, instead of a throw or a partial reading", () => {
    for (const text of ["", "abc", "NaN", "Infinity", "0x10", "1,250", " 1", "1 ", "1e", ".5", "1e9999", "1e999999999"]) {
      expect(decimalOf(text), JSON.stringify(text)).toBeNull();
    }
    expect(decimalOf(undefined)).toBeNull();
  });

  it("is a BN: its divisions keep 80 places, half up", () => {
    const third = decimalOf("1")!.div(decimalOf("3")!);
    expect(third.decimalPlaces()).toBe(80);
    expect(third instanceof BN).toBe(true);
  });
});
