import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { divided, percentText } from "./exact";

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
