import { describe, expect, it } from "vitest";

import { decodeLoaderData } from "../support/loader-data";

// The decoder the Worker specs read `.data` bodies with: what it decodes, and what it refuses to guess at.

const decode = (flat: unknown[]) => decodeLoaderData(JSON.stringify(flat));

describe("decodeLoaderData", () => {
  it("decodes objects, arrays, strings, numbers and booleans, and gives what is pointed at twice as one value", () => {
    const decoded = decode([
      { _1: 2 }, // 0: the root { route: <2> }
      "route",
      { _3: 4, _5: 6, _7: 6 }, // 2: { n: <4>, list: <6>, again: <6> }
      "n",
      7,
      "list",
      [8, 9], // 6: [ <8>, <9> ]
      "again",
      "x",
      true,
    ]) as { route: { n: number; list: unknown[]; again: unknown[] } };
    expect(decoded).toEqual({ route: { n: 7, list: ["x", true], again: ["x", true] } });
    expect(decoded.route.again).toBe(decoded.route.list);
  });

  it("decodes the special values the stream writes as negative indexes (null, undefined, NaN, the infinities, negative zero) and a hole in an array", () => {
    const decoded = decode([
      { _1: 2, _3: -5, _4: -7, _5: -2, _6: -6, _7: -3, _8: -4, _9: 10 },
      "a",
      1,
      "null",
      "undefined",
      "nan",
      "inf",
      "neginf",
      "negzero",
      "holes",
      [-1, 2],
    ]) as Record<string, unknown>;
    expect(decoded.a).toBe(1);
    expect(decoded.null).toBeNull();
    expect(decoded).toHaveProperty("undefined", undefined);
    expect(decoded.nan).toBeNaN();
    expect(decoded.inf).toBe(Infinity);
    expect(decoded.neginf).toBe(-Infinity);
    expect(Object.is(decoded.negzero, -0)).toBe(true);
    const holes = decoded.holes as unknown[];
    expect(holes).toHaveLength(2);
    expect(0 in holes).toBe(false);
    expect(holes[1]).toBe(1);
  });

  it("throws on a negative index that is no special value", () => {
    expect(() => decode([{ _1: -9 }, "a"])).toThrow(/special value -9/);
  });

  it.each([
    ["a Date", ["D", "2026-10-29T00:00:00.000Z"]],
    ["a Map", ["M", 1, 1]],
    ["a Set", ["S", 1]],
    ["an error", ["E", "boom", "Error"]],
    ["a promise", ["P", 5]],
  ])("throws on %s: a type-tagged array it does not decode", (_what, tagged) => {
    expect(() => decode([{ _1: 2 }, "a", tagged])).toThrow(/is not decoded/);
  });

  it("throws on an index outside the list, a pointer that is no integer, a key that is no `_<index>`, and a key that is not a string", () => {
    expect(() => decode([{ _1: 9 }, "a"])).toThrow(/not in the list/);
    expect(() => decode([{ _1: 1.5 }, "a"])).toThrow(/not an index/);
    expect(() => decode([{ key: 2 }, "a", 1])).toThrow(/not a key/);
    expect(() => decode([{ _2: 2 }, "a", 5])).toThrow(/not a string/);
  });
});
