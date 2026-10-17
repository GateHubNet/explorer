import { describe, expect, it } from "vitest";

import {
  dropsToNative,
  formatAmount,
  formatCurrency,
  formatUtc,
  relativeTime,
  shortAddress,
  shortHash,
} from "./format";

describe("formatAmount", () => {
  it("separates thousands and keeps every fraction digit", () => {
    expect(formatAmount("12480.256114")).toBe("12,480.256114");
    expect(formatAmount("1000000")).toBe("1,000,000");
    expect(formatAmount("999")).toBe("999");
    expect(formatAmount("1000")).toBe("1,000");
  });

  it("shows a negative number with U+2212, not a hyphen", () => {
    expect(formatAmount("-1250")).toBe("\u22121,250");
    expect(formatAmount("-0.5")).toBe("\u22120.5");
  });

  it("writes exponent notation out in full", () => {
    expect(formatAmount("1e-15")).toBe("0.000000000000001");
    expect(formatAmount("-1.5e+21")).toBe("\u22121,500,000,000,000,000,000,000");
    expect(formatAmount("1.5E3")).toBe("1,500");
  });

  it("keeps the precision of the digits it was given", () => {
    expect(formatAmount("1250.00")).toBe("1,250.00");
    expect(formatAmount("0.10")).toBe("0.10");
    expect(formatAmount("9007199254740993.123456789")).toBe("9,007,199,254,740,993.123456789");
  });

  it("formats zero without a sign", () => {
    expect(formatAmount("0")).toBe("0");
    expect(formatAmount("-0")).toBe("0");
    expect(formatAmount("-0.00")).toBe("0.00");
    expect(formatAmount("0e5")).toBe("0");
  });

  it("drops a plus sign and leading zeros", () => {
    expect(formatAmount("+5")).toBe("5");
    expect(formatAmount("0007.5")).toBe("7.5");
  });

  it("returns what is not a number as it came", () => {
    expect(formatAmount("")).toBe("");
    expect(formatAmount("abc")).toBe("abc");
    expect(formatAmount("Infinity")).toBe("Infinity");
  });
});

describe("dropsToNative", () => {
  it("divides by one million, exactly", () => {
    expect(dropsToNative("12")).toBe("0.000012");
    expect(dropsToNative("1000000")).toBe("1");
    expect(dropsToNative("12480256114")).toBe("12480.256114");
    expect(dropsToNative("99999999999999999")).toBe("99999999999.999999");
    expect(dropsToNative("0")).toBe("0");
  });

  it("keeps the sign and never writes an exponent", () => {
    expect(dropsToNative("-12")).toBe("-0.000012");
    expect(dropsToNative("1")).toBe("0.000001");
  });

  it("returns what is not a number as it came", () => {
    expect(dropsToNative("")).toBe("");
    expect(dropsToNative("n/a")).toBe("n/a");
  });
});

describe("formatCurrency", () => {
  it("leaves a standard code as it is", () => {
    expect(formatCurrency("USD")).toBe("USD");
    expect(formatCurrency("XRP")).toBe("XRP");
    expect(formatCurrency("XAH")).toBe("XAH");
  });

  it("decodes a 40-hex code that is printable ASCII", () => {
    expect(formatCurrency("534F4C4F00000000000000000000000000000000")).toBe("SOLO");
    expect(formatCurrency("534f4c4f00000000000000000000000000000000")).toBe("SOLO");
    expect(formatCurrency("4D6F6F6E63617400000000000000000000000000")).toBe("Mooncat");
  });

  it("leaves anything that is not a 3-letter or 40-hex code as it is", () => {
    expect(formatCurrency("4D6F6F6E636174000000000000000000000000000")).toBe(
      "4D6F6F6E636174000000000000000000000000000",
    );
    expect(formatCurrency("")).toBe("");
  });

  it("reads the standard 160-bit form of a three-letter code", () => {
    expect(formatCurrency("0000000000000000000000005553440000000000")).toBe("USD");
  });

  it("calls a code that starts with 03 an LP token", () => {
    expect(formatCurrency("03A1F7D29C2E0000000000000000000000000000")).toBe("LP token");
    expect(formatCurrency("03a1f7d29c2e0000000000000000000000000000")).toBe("LP token");
  });

  it("shortens any other 40-hex code to its first 8 digits", () => {
    expect(formatCurrency("01FFFE0000000000000000000000000000000000")).toBe("01FFFE00\u2026");
    expect(formatCurrency("01fffe0000000000000000000000000000000000")).toBe("01FFFE00\u2026");
    // Not printable: a control byte inside the text.
    expect(formatCurrency("5300410000000000000000000000000000000000")).toBe("53004100\u2026");
    // All zeros decodes to nothing.
    expect(formatCurrency("0000000000000000000000000000000000000000")).toBe("00000000\u2026");
  });
});

describe("formatUtc", () => {
  it("formats an ISO string as UTC", () => {
    expect(formatUtc("2026-10-17T15:42:51Z")).toBe("2026-10-17 15:42:51 UTC");
    expect(formatUtc("2026-10-17T15:42:51.000Z")).toBe("2026-10-17 15:42:51 UTC");
    expect(formatUtc("2026-10-17T17:42:51+02:00")).toBe("2026-10-17 15:42:51 UTC");
  });

  it("reads a string with no zone as UTC, not as local time", () => {
    expect(formatUtc("2026-10-17T15:42:51")).toBe("2026-10-17 15:42:51 UTC");
    expect(formatUtc("2026-10-17 15:42:51")).toBe("2026-10-17 15:42:51 UTC");
  });

  it("reads a number as unix seconds", () => {
    expect(formatUtc(1_792_251_771)).toBe("2026-10-17 15:42:51 UTC");
    expect(formatUtc(0)).toBe("1970-01-01 00:00:00 UTC");
  });

  it("does not guess an epoch from the size of the number", () => {
    // Small numbers are unix seconds too (a Ripple-epoch time is converted before it gets here).
    expect(formatUtc(845_566_971)).toBe("1996-10-17 15:42:51 UTC");
    expect(formatUtc(946_684_799)).toBe("1999-12-31 23:59:59 UTC");
    expect(formatUtc(946_684_800)).toBe("2000-01-01 00:00:00 UTC");
    // The same on both sides of 946684800, which a Ripple-epoch time passes on 2029-12-30.
    expect(formatUtc(946_684_801)).toBe("2000-01-01 00:00:01 UTC");
  });

  it("returns what is not a time as it came", () => {
    expect(formatUtc("yesterday")).toBe("yesterday");
    expect(formatUtc(Number.NaN)).toBe("NaN");
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 9, 17, 15, 42, 51);

  it("counts seconds, minutes, hours and days", () => {
    expect(relativeTime(now - 3_000, now)).toBe("3 s ago");
    expect(relativeTime(now - 4 * 60_000, now)).toBe("4 min ago");
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(relativeTime(now - 5 * 86_400_000, now)).toBe("5 d ago");
  });

  it("rounds down and switches unit at the boundary", () => {
    expect(relativeTime(now - 59_999, now)).toBe("59 s ago");
    expect(relativeTime(now - 60_000, now)).toBe("1 min ago");
    expect(relativeTime(now - 3_599_000, now)).toBe("59 min ago");
    expect(relativeTime(now - 3_600_000, now)).toBe("1 h ago");
    expect(relativeTime(now - 86_399_000, now)).toBe("23 h ago");
    expect(relativeTime(now - 86_400_000, now)).toBe("1 d ago");
    expect(relativeTime(now - 400 * 86_400_000, now)).toBe("400 d ago");
  });

  it("shows 0 s ago for now and for a clock that is a little ahead", () => {
    expect(relativeTime(now, now)).toBe("0 s ago");
    expect(relativeTime(now + 4_000, now)).toBe("0 s ago");
  });
});

describe("shortHash and shortAddress", () => {
  const hash = "83F332E0A1B2C3D4E5F60718293A4B5C6D7E8F90112233445566778899AA0A4B";

  it("keeps the first 6 and last 4 characters of a hash", () => {
    expect(shortHash(hash)).toBe("83F332\u20260A4B");
  });

  it("keeps the first 6 and last 4 characters of an address", () => {
    expect(shortAddress("rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFQvg")).toBe("rJF2Xa\u2026FQvg");
    // The case of the characters it keeps is not changed.
    expect(shortAddress("rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg")).toBe("rJF2Xa\u2026fQvg");
  });

  it("leaves a string that is already short", () => {
    expect(shortHash("ABCDEF1234")).toBe("ABCDEF1234");
    expect(shortAddress("rShort")).toBe("rShort");
    expect(shortHash("")).toBe("");
  });
});
