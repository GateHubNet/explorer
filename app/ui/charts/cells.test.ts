import { describe, expect, it } from "vitest";

import { cellOf, lastOf, shareOf } from "./cells";

describe("cellOf", () => {
  it("keeps the exact text and reads its number: the text is what a label says, the number is for the geometry only", () => {
    expect(cellOf("45500000.123456789012")).toEqual({ text: "45500000.123456789012", value: 45500000.123456789 });
    expect(cellOf("0")).toEqual({ text: "0", value: 0 });
    expect(cellOf("-50")).toEqual({ text: "-50", value: -50 });
  });

  it("is nothing for a value that is missing: null, undefined, blank, or not a number", () => {
    expect(cellOf(null)).toBeNull();
    expect(cellOf(undefined)).toBeNull();
    expect(cellOf("")).toBeNull();
    expect(cellOf("  ")).toBeNull();
    expect(cellOf("n/a")).toBeNull();
    expect(cellOf("Infinity")).toBeNull();
  });
});

describe("lastOf", () => {
  const cell = (text: string) => cellOf(text);

  it("is the index of the newest bucket that has a value, and -1 when none has", () => {
    expect(lastOf([cell("1"), cell("2"), cell("3")])).toBe(2);
    expect(lastOf([cell("1"), null, null])).toBe(0);
    expect(lastOf([null, cell("0"), null])).toBe(1);
    expect(lastOf([null, null])).toBe(-1);
    expect(lastOf([])).toBe(-1);
  });
});

describe("shareOf", () => {
  it("is the size over the maximum", () => {
    expect(shareOf("84", "100")).toBe(0.84);
    expect(shareOf("1", "4")).toBe(0.25);
    expect(shareOf("100", "100")).toBe(1);
    expect(shareOf("0", "100")).toBe(0);
  });

  it("holds a size past the ends at them", () => {
    expect(shareOf("120", "100")).toBe(1);
    expect(shareOf("-5", "100")).toBe(0);
  });

  it("is 0 for a size or a maximum that is not a number, and for a maximum that is not above 0", () => {
    for (const [size, max] of [["n/a", "100"], ["", "100"], ["5", "n/a"], ["5", ""], ["5", "0"], ["5", "-10"]]) {
      expect(shareOf(size!, max!), `${size} of ${max}`).toBe(0);
    }
  });
});
