import { describe, expect, it } from "vitest";

import { fnv1a32, tokenOf } from "./fnv";

describe("fnv1a32", () => {
  it("is the offset basis for the empty string", () => {
    expect(fnv1a32("")).toBe(2166136261);
  });

  it("matches the published 32-bit FNV-1a vectors", () => {
    expect(fnv1a32("a")).toBe(3826002220);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("hashes the UTF-8 bytes of a string", () => {
    // 0xC3 0xA9: reference computed with the byte-wise algorithm.
    expect(fnv1a32("\u00e9")).toBe(0x1e9de8c1);
    // 0xE2 0x82 0xAC.
    expect(fnv1a32("\u20ac")).toBe(0x298f832b);
  });

  it("is an unsigned 32-bit integer", () => {
    for (const text of ["", "a", "b", "the quick brown fox", "\u00e9\u20ac".repeat(50)]) {
      const hash = fnv1a32(text);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("tokenOf", () => {
  it("is 8 lower-case hex digits", () => {
    expect(tokenOf({ a: 1 })).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is the FNV-1a of the JSON text, padded with zeros", () => {
    expect(tokenOf("")).toBe(fnv1a32('""').toString(16).padStart(8, "0"));
    expect(tokenOf(null)).toBe(fnv1a32("null").toString(16).padStart(8, "0"));
    // The offset basis, 0x811c9dc5, is not what a token is of: the JSON text of "" has two quote marks.
    expect(tokenOf("")).not.toBe("811c9dc5");
  });

  it("is stable for the same data and differs for other data", () => {
    expect(tokenOf({ a: 1 })).toBe(tokenOf({ a: 1 }));
    expect(tokenOf({ a: 1 })).not.toBe(tokenOf({ a: 2 }));
    expect(tokenOf([1, 2])).not.toBe(tokenOf([2, 1]));
  });

  it("has a value for something JSON cannot write", () => {
    expect(tokenOf(undefined)).toMatch(/^[0-9a-f]{8}$/);
  });
});
