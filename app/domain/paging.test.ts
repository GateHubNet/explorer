import { describe, expect, it } from "vitest";

import { MAX_TRAIL, parseTrail, trailPaging } from "./paging";

// `href` writes what it is given in a form that can be compared: the marker, then the trail, newest first.
const href = (to: { marker?: string; back: readonly string[] }) => `m=${to.marker ?? ""};b=${to.back.join(".")}`;

describe("trailPaging", () => {
  it("has nothing newer on the first page, and an Older when the API gave a marker", () => {
    expect(trailPaging({ back: [], next: "M1" }, href)).toEqual({ newerHref: null, olderHref: "m=M1;b=" });
  });

  it("has neither link on a first page that is the only one", () => {
    expect(trailPaging({ back: [] }, href)).toEqual({ newerHref: null, olderHref: null });
  });

  it("goes back to the first page from the second, and Older remembers the way back", () => {
    expect(trailPaging({ marker: "M1", back: [], next: "M2" }, href)).toEqual({ newerHref: "m=;b=", olderHref: "m=M2;b=M1" });
  });

  it("goes back to the page before from every other, and has no Older without a marker of the API", () => {
    expect(trailPaging({ marker: "M3", back: ["M2", "M1"] }, href)).toEqual({ newerHref: "m=M2;b=M1", olderHref: null });
  });

  it("goes back to the first page from a page reached with a marker and no trail (a link someone copied)", () => {
    expect(trailPaging({ marker: "M7", back: [], next: "M8" }, href)).toEqual({ newerHref: "m=;b=", olderHref: "m=M8;b=M7" });
  });

  it("keeps ten markers in Older when the trail is already ten long, and drops the oldest", () => {
    const back = ["M10", "M9", "M8", "M7", "M6", "M5", "M4", "M3", "M2", "M1"];
    expect(back).toHaveLength(MAX_TRAIL);
    const { olderHref } = trailPaging({ marker: "M11", back, next: "M12" }, href);
    expect(olderHref).toBe("m=M12;b=M11.M10.M9.M8.M7.M6.M5.M4.M3.M2");
    expect(olderHref!.split(";b=")[1]!.split(".")).toHaveLength(MAX_TRAIL);
  });

  it("does not change the trail it is given", () => {
    const back = ["M2", "M1"];
    trailPaging({ marker: "M3", back, next: "M4" }, href);
    expect(back).toEqual(["M2", "M1"]);
  });
});

describe("parseTrail", () => {
  it("is no trail without a value", () => {
    expect(parseTrail(null)).toEqual([]);
    expect(parseTrail("")).toEqual([]);
  });

  it("reads markers joined by dots, nearest first", () => {
    expect(parseTrail("M2.M1")).toEqual(["M2", "M1"]);
    expect(parseTrail("WzEwNzYxMjU3MywyNV0")).toEqual(["WzEwNzYxMjU3MywyNV0"]);
  });

  it("takes ten markers and no trail at all when there are more", () => {
    const ten = Array.from({ length: MAX_TRAIL }, (_, i) => `M${i}`);
    expect(parseTrail(ten.join("."))).toEqual(ten);
    expect(parseTrail([...ten, "M10"].join("."))).toEqual([]);
  });

  it("is no trail when a piece is not a marker", () => {
    expect(parseTrail("a b")).toEqual([]);
    expect(parseTrail("M2.a b")).toEqual([]);
    expect(parseTrail("M2..M1")).toEqual([]);
    expect(parseTrail("M2.<b>")).toEqual([]);
  });
});

describe("MAX_TRAIL", () => {
  it("is ten pages", () => expect(MAX_TRAIL).toBe(10));
});
