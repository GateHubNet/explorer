import { describe, expect, it } from "vitest";

import {
  compactNumber,
  decodesCurrency,
  dropsToNative,
  formatAmount,
  formatChange,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPrice,
  formatUtc,
  formatUtcDay,
  joinAnd,
  relativeTime,
  sharePercent,
  shortAddress,
  shortHash,
  untilText,
  wholePercent,
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

describe("decodesCurrency", () => {
  it("is true for what formatCurrency shows as text: a standard code, decoded hex, the standard 160-bit form, an LP token", () => {
    for (const code of [
      "USD",
      "XRP",
      "",
      "534F4C4F00000000000000000000000000000000",
      "534f4c4f00000000000000000000000000000000",
      "0000000000000000000000005553440000000000",
      "03A1F7D29C2E0000000000000000000000000000",
      "4D6F6F6E636174000000000000000000000000000",
    ]) {
      expect(decodesCurrency(code), code).toBe(true);
    }
  });

  it("is false for the 40-hex codes that formatCurrency shortens to 8 digits and an ellipsis", () => {
    for (const code of [
      "01FFFE0000000000000000000000000000000000",
      "01fffe0000000000000000000000000000000000",
      "5300410000000000000000000000000000000000",
      "0000000000000000000000000000000000000000",
    ]) {
      expect(decodesCurrency(code), code).toBe(false);
      expect(formatCurrency(code).endsWith("\u2026"), code).toBe(true);
    }
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

describe("untilText", () => {
  const NOW = Date.UTC(2026, 9, 19, 15, 42, 0);

  it("is null at and after the moment", () => {
    expect(untilText(NOW, NOW)).toBeNull();
    expect(untilText(NOW - 1, NOW)).toBeNull();
  });

  it.each([
    [59, "under a minute"],
    [60, "1 min"],
    [59 * 60 + 1, "60 min"],
    [3600, "1 h"],
    [47 * 3600 + 59 * 60, "47 h"],
    [48 * 3600, "2 days"],
    [3.5 * 86400, "4 days"],
  ])("with %i s left is %s", (seconds, text) => {
    expect(untilText(NOW + seconds * 1000, NOW)).toBe(text);
  });

  it("rounds a minute up, an hour down and a day to the nearest", () => {
    expect(untilText(NOW + 1, NOW)).toBe("under a minute");
    expect(untilText(NOW + 59_999, NOW)).toBe("under a minute");
    expect(untilText(NOW + 60_001, NOW)).toBe("2 min");
    expect(untilText(NOW + 3_599_000, NOW)).toBe("60 min");
    expect(untilText(NOW + 3_600_000 + 3_599_000, NOW)).toBe("1 h");
    expect(untilText(NOW + 48 * 3_600_000 - 1, NOW)).toBe("47 h");
    expect(untilText(NOW + 2.49 * 86_400_000, NOW)).toBe("2 days");
    expect(untilText(NOW + 400 * 86_400_000, NOW)).toBe("400 days");
  });

  it("puts ~ before the number only", () => {
    expect(untilText(NOW + 11 * 60_000, NOW, { approx: true })).toBe("~11 min");
    expect(untilText(NOW + 4 * 86_400_000, NOW, { approx: true })).toBe("~4 days");
    expect(untilText(NOW + 5 * 3_600_000, NOW, { approx: true })).toBe("~5 h");
    expect(untilText(NOW + 30_000, NOW, { approx: true })).toBe("under a minute");
    expect(untilText(NOW, NOW, { approx: true })).toBeNull();
  });
});

describe("formatDate and formatDateTime", () => {
  it("write UTC dates with the fixed month table", () => {
    expect(formatDate("2026-10-09T09:34:30Z")).toBe("Oct 9, 2026");
    expect(formatDate("2026-09-20")).toBe("Sep 20, 2026");
    expect(formatDateTime("2026-10-09T09:34:30Z")).toBe("Oct 9, 2026, 09:34 UTC");
    expect(formatDateTime("2026-07-21T08:00:12.004Z")).toBe("Jul 21, 2026, 08:00 UTC");
    expect(formatDateTime(1792256472)).toBe("Oct 17, 2026, 17:01 UTC"); // unix seconds
    expect(formatDate(1792256472)).toBe("Oct 17, 2026");
    expect(formatDate("soon")).toBe("soon");
  });

  it("read a string with no zone as UTC and a zone as the UTC moment it names", () => {
    expect(formatDateTime("2026-10-09T09:34:30")).toBe("Oct 9, 2026, 09:34 UTC");
    expect(formatDateTime("2026-10-09T01:34:30+02:00")).toBe("Oct 8, 2026, 23:34 UTC");
    expect(formatDate("2026-10-09T01:34:30+02:00")).toBe("Oct 8, 2026");
  });

  it("take the day from UTC at the turn of the day, not from a local clock", () => {
    expect(formatDateTime("2026-12-31T23:59:59Z")).toBe("Dec 31, 2026, 23:59 UTC");
    expect(formatDateTime("2027-01-01T00:00:00Z")).toBe("Jan 1, 2027, 00:00 UTC");
  });

  it("return what is not a moment as it came", () => {
    expect(formatDateTime("soon")).toBe("soon");
    expect(formatDate("2026-13-45")).toBe("2026-13-45");
    expect(formatDateTime("2026-13-45T25:00:00Z")).toBe("2026-13-45T25:00:00Z");
    expect(formatDate(Number.NaN)).toBe("NaN");
    expect(formatDateTime(Number.NaN)).toBe("NaN");
    expect(formatDateTime("")).toBe("");
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

describe("formatUtcDay", () => {
  it("writes a UTC day as the month and the day", () => {
    expect(formatUtcDay("2026-10-17")).toBe("Oct 17");
  });

  it("adds the year when asked, with no leading zero on the day", () => {
    expect(formatUtcDay("2026-01-05", true)).toBe("Jan 5, 2026");
    expect(formatUtcDay("2026-10-17", true)).toBe("Oct 17, 2026");
  });

  it("names each of the twelve months", () => {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (const [i, name] of names.entries()) {
      expect(formatUtcDay(`2026-${String(i + 1).padStart(2, "0")}-01`)).toBe(`${name} 1`);
    }
  });

  it("returns what is not a day as it came", () => {
    expect(formatUtcDay("")).toBe("");
    expect(formatUtcDay("soon")).toBe("soon");
    expect(formatUtcDay("2026-13-01")).toBe("2026-13-01");
  });
});

describe("compactNumber", () => {
  it("keeps 3 significant digits and a K, M, B or T from 10,000", () => {
    expect(compactNumber("10000")).toBe("10K");
    expect(compactNumber("12900")).toBe("12.9K");
    expect(compactNumber("4200000")).toBe("4.2M");
    expect(compactNumber("1240000000")).toBe("1.24B");
    expect(compactNumber("2310000")).toBe("2.31M");
    expect(compactNumber("2104331")).toBe("2.1M");
    expect(compactNumber("45500000")).toBe("45.5M");
    expect(compactNumber("3500000000000")).toBe("3.5T");
  });

  it("rolls to the next suffix when the rounded digits reach 1000", () => {
    expect(compactNumber("999950")).toBe("1M");
    expect(compactNumber("999500")).toBe("1M");
    expect(compactNumber("999499")).toBe("999K");
    expect(compactNumber("999500000")).toBe("1B");
    expect(compactNumber("999499999")).toBe("999M");
    expect(compactNumber("999500000000")).toBe("1T");
  });

  it("goes on in T past a thousand of them, grouped", () => {
    expect(compactNumber("1500000000000000")).toBe("1,500T");
  });

  it("writes from 1 to 9,999.99 grouped, with at most 2 decimals, half up", () => {
    expect(compactNumber("9999.99")).toBe("9,999.99");
    expect(compactNumber("1234.567")).toBe("1,234.57");
    expect(compactNumber("999.995")).toBe("1,000");
    expect(compactNumber("1")).toBe("1");
    expect(compactNumber("7500")).toBe("7,500");
    expect(compactNumber("1.50")).toBe("1.5");
    expect(compactNumber("2.005")).toBe("2.01");
  });

  it("keeps 3 significant digits under 1", () => {
    expect(compactNumber("0.000123456")).toBe("0.000123");
    expect(compactNumber("0.5")).toBe("0.5");
    expect(compactNumber("0.123456")).toBe("0.123");
    expect(compactNumber("0.0000005")).toBe("0.0000005");
  });

  it("writes 0 as 0, whatever its spelling", () => {
    expect(compactNumber("0")).toBe("0");
    expect(compactNumber("0.00")).toBe("0");
    expect(compactNumber("-0")).toBe("0");
  });

  it("shows a negative number with U+2212, not a hyphen", () => {
    expect(compactNumber("-12900")).toBe("\u221212.9K");
    expect(compactNumber("-1234.567")).toBe("\u22121,234.57");
    expect(compactNumber("-0.5")).toBe("\u22120.5");
  });

  it("reads exponent notation and writes it out in full", () => {
    expect(compactNumber("1e-7")).toBe("0.0000001");
    expect(compactNumber("2.5e6")).toBe("2.5M");
    expect(compactNumber("1.5E3")).toBe("1,500");
  });

  it("returns what is not a number as it came", () => {
    expect(compactNumber("")).toBe("");
    expect(compactNumber("soon")).toBe("soon");
  });
});

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

describe("formatPrice", () => {
  it("keeps 8 significant digits, half up, and drops the trailing zeros", () => {
    expect(formatPrice("0.40990000")).toBe("0.4099");
    expect(formatPrice("2.43934999")).toBe("2.43935");
    expect(formatPrice("12345.678912")).toBe("12,345.679");
    expect(formatPrice("0.000123456789")).toBe("0.00012345679");
    expect(formatPrice("2.4")).toBe("2.4");
    expect(formatPrice("2.40")).toBe("2.4");
    expect(formatPrice("1")).toBe("1");
    expect(formatPrice("1.00000000")).toBe("1");
  });

  it("rounds half up on the digits, not on a float", () => {
    expect(formatPrice("0.123456785")).toBe("0.12345679");
    expect(formatPrice("0.123456784999")).toBe("0.12345678");
    expect(formatPrice("1.00000005")).toBe("1.0000001");
    expect(formatPrice("1.00000004")).toBe("1");
    expect(formatPrice("99999999.5")).toBe("100,000,000");
    expect(formatPrice("0.99999999999")).toBe("1");
  });

  it("groups the integer part, and rounds a large price to 8 digits with zeros after them", () => {
    expect(formatPrice("123456789012")).toBe("123,456,790,000");
    expect(formatPrice("1234")).toBe("1,234");
    expect(formatPrice("1234567.891")).toBe("1,234,567.9");
  });

  it("reads exponent notation, which the data API writes from 1e8 and below 1e-6, and never writes it", () => {
    expect(formatPrice("1e-10")).toBe("0.0000000001");
    expect(formatPrice("1.5E+3")).toBe("1,500");
    expect(formatPrice("1.2345678e+8")).toBe("123,456,780");
    expect(formatPrice("1.23456789e-7")).toBe("0.00000012345679");
    expect(formatPrice("1e+21")).toBe("1,000,000,000,000,000,000,000");
    expect(formatPrice("-2.5e-9")).toBe("\u22120.0000000025");
    for (const text of ["1e-10", "1.5E+3", "1.2345678e+8", "9.9999999e-12", "1e+30", "123456789012", "0.000123456789"]) expect(formatPrice(text)).not.toMatch(/e/i);
  });

  it("is 0 for a zero, with U+2212 for a negative value", () => {
    expect(formatPrice("0")).toBe("0");
    expect(formatPrice("0.00000000")).toBe("0");
    expect(formatPrice("-0")).toBe("0");
    expect(formatPrice("-1.234567891")).toBe("\u22121.2345679");
    expect(formatPrice("+2.5")).toBe("2.5");
  });

  it("returns what is not a number as it came", () => {
    expect(formatPrice("abc")).toBe("abc");
    expect(formatPrice("")).toBe("");
    expect(formatPrice("NaN")).toBe("NaN");
    expect(formatPrice("Infinity")).toBe("Infinity");
    expect(formatPrice("1,5")).toBe("1,5");
    expect(formatPrice("\u2014")).toBe("\u2014");
  });
});

describe("formatChange", () => {
  it("has 2 decimals, half up, a + before a positive value and U+2212 before a negative one", () => {
    expect(formatChange("2.375")).toBe("+2.38");
    expect(formatChange("-2.375")).toBe("\u22122.38");
    expect(formatChange("12.3")).toBe("+12.30");
    expect(formatChange("-12.3")).toBe("\u221212.30");
    expect(formatChange("0.005")).toBe("+0.01");
    expect(formatChange("-0.005")).toBe("\u22120.01");
    expect(formatChange("+2.375")).toBe("+2.38");
  });

  it("rounds on the digits, not on a float", () => {
    expect(formatChange("2.3749999999999999999")).toBe("+2.37");
    expect(formatChange("1.005")).toBe("+1.01");
    expect(formatChange("2.675")).toBe("+2.68");
  });

  it("is 0.00 for zero and for what rounds to it, with no sign", () => {
    expect(formatChange("0")).toBe("0.00");
    expect(formatChange("0.00")).toBe("0.00");
    expect(formatChange("-0")).toBe("0.00");
    expect(formatChange("-0.004")).toBe("0.00");
    expect(formatChange("0.004")).toBe("0.00");
    expect(formatChange("1e-10")).toBe("0.00");
  });

  it("groups a large change, reads exponent notation and never writes it, and has no percent sign", () => {
    expect(formatChange("1234.5")).toBe("+1,234.50");
    expect(formatChange("-1234567.891")).toBe("\u22121,234,567.89");
    expect(formatChange("1.5E+3")).toBe("+1,500.00");
    expect(formatChange("2.5e1")).toBe("+25.00");
    expect(formatChange("12.3")).not.toContain("%");
  });

  it("returns what is not a number as it came", () => {
    expect(formatChange("abc")).toBe("abc");
    expect(formatChange("")).toBe("");
    expect(formatChange("\u2014")).toBe("\u2014");
  });
});

describe("joinAnd", () => {
  it("joins a list the way a sentence does", () => {
    expect(joinAnd([])).toBe("");
    expect(joinAnd(["a"])).toBe("a");
    expect(joinAnd(["a", "b"])).toBe("a and b");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b and c");
    expect(joinAnd(["vl.ripple.com", "unl.xrplf.org"])).toBe("vl.ripple.com and unl.xrplf.org");
    expect(joinAnd(["a", "b", "c", "d"])).toBe("a, b, c and d");
  });
});
