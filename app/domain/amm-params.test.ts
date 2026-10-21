import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { valueImports } from "../../test/support/value-imports";
import { NO_FEATURES } from "../ui/features";
import {
  AMM_PERIODS,
  AMM_TABS,
  ammListHref,
  ammPoolHref,
  parseAmmListParams,
  parseAmmPoolParams,
  poolLink,
} from "./amm-params";
import { assetText, parseAssetText } from "./asset";

const P = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const XRPL = { native: "XRP" } as const;

const pool = (query: string) => parseAmmPoolParams(new URLSearchParams(query));
const list = (query: string) => parseAmmListParams(new URLSearchParams(query));
/** The canonical URL of a query: the href of what it names. */
const poolCanonical = (query: string) => ammPoolHref("xrpl", P, pool(query));
const listCanonical = (query: string) => ammListHref("xrpl", list(query));
/** The query of a URL after a URL parser has serialized it, as a loader sees `request.url`. */
const serialized = (href: string) => new URL(`https://h${href}`).search;
const queryOfHref = (href: string) => (href.includes("?") ? href.slice(href.indexOf("?")) : "");

describe("the tables", () => {
  it("has the tabs and the periods, in the order of their selectors", () => {
    expect([...AMM_TABS]).toEqual(["swaps", "liquidity", "governance"]);
    expect([...AMM_PERIODS]).toEqual(["30d", "90d", "1y"]);
  });
});

describe("parseAmmPoolParams and ammPoolHref: the canonical form of a pool query", () => {
  it.each([
    ["", `/xrpl/amm/${P}`],
    ["period=90d&tab=swaps", `/xrpl/amm/${P}`],
    ["period=30d", `/xrpl/amm/${P}?period=30d`],
    ["period=1y", `/xrpl/amm/${P}?period=1y`],
    ["tab=liquidity&period=1y", `/xrpl/amm/${P}?period=1y&tab=liquidity`],
    ["tab=governance", `/xrpl/amm/${P}?tab=governance`],
    ["period=2y", `/xrpl/amm/${P}`],
    ["tab=bogus", `/xrpl/amm/${P}`],
    ["period=2y&tab=bogus", `/xrpl/amm/${P}`],
    ["tab=liquidity&tab=governance", `/xrpl/amm/${P}?tab=liquidity`],
    ["period=30d&period=1y", `/xrpl/amm/${P}?period=30d`],
    ["period=2y&period=30d", `/xrpl/amm/${P}`],
    ["marker=M1&period=30d&tab=governance", `/xrpl/amm/${P}?tab=governance&marker=M1`],
    ["marker=M1&period=1y", `/xrpl/amm/${P}?marker=M1`],
    ["back=M2", `/xrpl/amm/${P}`],
    ["period=1y&back=M2.M1", `/xrpl/amm/${P}?period=1y`],
    ["marker=M3&back=M2.M1", `/xrpl/amm/${P}?marker=M3&back=M2.M1`],
    ["back=M2.M1&tab=liquidity&marker=M3", `/xrpl/amm/${P}?tab=liquidity&marker=M3&back=M2.M1`],
    ["x=1", `/xrpl/amm/${P}`],
    ["x=1&tab=liquidity&y=2", `/xrpl/amm/${P}?tab=liquidity`],
  ])("%j is %s", (query, href) => {
    expect(poolCanonical(query)).toBe(href);
  });

  it("reads period and tab as they are written: in any other case they are unknown values", () => {
    expect(poolCanonical("period=1Y&tab=Liquidity")).toBe(`/xrpl/amm/${P}`);
    expect(poolCanonical("period=&tab=")).toBe(`/xrpl/amm/${P}`);
  });

  it("returns the view a query names", () => {
    expect(pool("")).toEqual({ period: "90d", tab: "swaps", back: [] });
    expect(pool("period=1y&tab=liquidity")).toEqual({ period: "1y", tab: "liquidity", back: [] });
    expect(pool("tab=governance&tab=swaps")).toEqual({ period: "90d", tab: "governance", back: [] });
  });

  it("gives the default period behind a marker (that page has no charts), and keeps the tab", () => {
    expect(pool("marker=M1&period=30d&tab=governance")).toEqual({ period: "90d", tab: "governance", marker: "M1", back: [] });
  });

  it("gives a trail only behind a marker, and only one that parseTrail accepts", () => {
    expect(pool("marker=M3&back=M2.M1").back).toEqual(["M2", "M1"]);
    expect(pool("back=M2.M1").back).toEqual([]);
    expect(pool("marker=M3&back=M2.bad!").back).toEqual([]);
    expect(pool("marker=M3&back=").back).toEqual([]);
    const eleven = Array.from({ length: 11 }, (_, at) => `M${at}`).join(".");
    expect(pool(`marker=M3&back=${eleven}`).back).toEqual([]);
    expect(pool(`marker=M3&back=${eleven.split(".").slice(0, 10).join(".")}`).back).toHaveLength(10);
  });

  it("returns the marker as it was given, whatever it is: the loader checks isMarker and answers 404", () => {
    expect(pool("marker=a%27b").marker).toBe("a'b");
    expect(pool("marker=").marker).toBe("");
    expect(pool("marker=not%20one").marker).toBe("not one");
    expect(poolCanonical("marker=")).toBe(`/xrpl/amm/${P}?marker=`);
    expect(pool("marker=M1&marker=M2").marker).toBe("M1");
  });
});

describe("ammPoolHref", () => {
  it("is the pool's page with no query for the default view and for no query", () => {
    expect(ammPoolHref("xrpl", P)).toBe(`/xrpl/amm/${P}`);
    expect(ammPoolHref("xrpl", P, {})).toBe(`/xrpl/amm/${P}`);
    expect(ammPoolHref("xrpl", P, { period: "90d", tab: "swaps", back: [] })).toBe(`/xrpl/amm/${P}`);
    expect(ammPoolHref("xahau", P)).toBe(`/xahau/amm/${P}`);
  });

  it("writes period, tab, marker and back, in that order, and leaves out what is the default's", () => {
    expect(ammPoolHref("xrpl", P, { period: "30d" })).toBe(`/xrpl/amm/${P}?period=30d`);
    expect(ammPoolHref("xrpl", P, { tab: "liquidity" })).toBe(`/xrpl/amm/${P}?tab=liquidity`);
    expect(ammPoolHref("xrpl", P, { tab: "swaps", period: "1y" })).toBe(`/xrpl/amm/${P}?period=1y`);
    expect(ammPoolHref("xrpl", P, { tab: "governance", period: "30d" })).toBe(`/xrpl/amm/${P}?period=30d&tab=governance`);
    expect(ammPoolHref("xrpl", P, { period: "1y", tab: "liquidity", marker: "M3", back: ["M2", "M1"] })).toBe(
      `/xrpl/amm/${P}?tab=liquidity&marker=M3&back=M2.M1`,
    );
  });

  it("leaves out the period beside a marker, and writes the trail only behind one", () => {
    expect(ammPoolHref("xrpl", P, { period: "30d", marker: "M1" })).toBe(`/xrpl/amm/${P}?marker=M1`);
    expect(ammPoolHref("xrpl", P, { back: ["M2"] })).toBe(`/xrpl/amm/${P}`);
    expect(ammPoolHref("xrpl", P, { period: "1y", back: ["M2"] })).toBe(`/xrpl/amm/${P}?period=1y`);
    expect(ammPoolHref("xrpl", P, { marker: "M3", back: [] })).toBe(`/xrpl/amm/${P}?marker=M3`);
    expect(ammPoolHref("xrpl", P, { marker: "M3" })).toBe(`/xrpl/amm/${P}?marker=M3`);
    expect(ammPoolHref("xrpl", P, { marker: undefined, back: [] })).toBe(`/xrpl/amm/${P}`);
  });

  it("is the href of the trailPaging shapes: the first page has neither marker nor trail", () => {
    expect(ammPoolHref("xrpl", P, { tab: "liquidity", back: [] })).toBe(`/xrpl/amm/${P}?tab=liquidity`);
    expect(ammPoolHref("xrpl", P, { tab: "liquidity", marker: "M2", back: ["M1"] })).toBe(`/xrpl/amm/${P}?tab=liquidity&marker=M2&back=M1`);
  });

  it("does not change the trail it is given", () => {
    const back = ["M2", "M1"];
    ammPoolHref("xrpl", P, { marker: "M3", back });
    expect(back).toEqual(["M2", "M1"]);
  });
});

describe("parseAmmListParams and ammListHref: the canonical form of a list query", () => {
  it.each([
    ["", "/xrpl/amm"],
    ["deleted=1&asset=XRP", "/xrpl/amm?asset=XRP&deleted=1"],
    ["deleted=1", "/xrpl/amm?deleted=1"],
    ["deleted=yes", "/xrpl/amm"],
    ["deleted=true", "/xrpl/amm"],
    ["deleted=0", "/xrpl/amm"],
    ["deleted=", "/xrpl/amm"],
    ["deleted=1&deleted=0", "/xrpl/amm?deleted=1"],
    ["deleted=0&deleted=1", "/xrpl/amm"],
    ["asset=", "/xrpl/amm"],
    ["asset=&deleted=1", "/xrpl/amm?deleted=1"],
    ["asset=XRP&asset=USD", "/xrpl/amm?asset=XRP"],
    ["asset=XRP&marker=M1&back=M0", "/xrpl/amm?asset=XRP&marker=M1&back=M0"],
    ["back=M0&marker=M1&deleted=1&asset=XRP", "/xrpl/amm?asset=XRP&deleted=1&marker=M1&back=M0"],
    ["marker=M3&back=M2.M1", "/xrpl/amm?marker=M3&back=M2.M1"],
    ["back=M0", "/xrpl/amm"],
    ["asset=XRP&back=M0", "/xrpl/amm?asset=XRP"],
    ["period=30d&tab=liquidity&x=1", "/xrpl/amm"],
  ])("%j is %s", (query, href) => {
    expect(listCanonical(query)).toBe(href);
  });

  it("returns the view a query names", () => {
    expect(list("")).toEqual({ deleted: false, back: [] });
    expect(list("asset=XRP&deleted=1")).toEqual({ asset: "XRP", deleted: true, back: [] });
    expect(list("asset=XRP&marker=M1&back=M0")).toEqual({ asset: "XRP", deleted: false, marker: "M1", back: ["M0"] });
    expect(list("asset=&back=M0")).toEqual({ deleted: false, back: [] });
  });

  it("returns the asset as the text it was given, a raw + (a space once parsed) included: the loader reads it with parseAssetText", () => {
    expect(list("asset=usd.rhub").asset).toBe("usd.rhub");
    expect(list("asset=RLUSD+rMx").asset).toBe("RLUSD rMx");
    expect(list("asset=RLUSD%2BrMx").asset).toBe("RLUSD+rMx");
    expect(list("asset=%20").asset).toBe(" ");
  });

  it("returns the marker as it was given, whatever it is, and keeps asset and deleted behind it", () => {
    expect(list("marker=%27").marker).toBe("'");
    expect(list("marker=").marker).toBe("");
    expect(listCanonical("asset=XRP&deleted=1&marker=M1")).toBe("/xrpl/amm?asset=XRP&deleted=1&marker=M1");
  });

  it("writes asset, deleted, marker and back, in that order, and leaves out what is empty or false", () => {
    expect(ammListHref("xrpl")).toBe("/xrpl/amm");
    expect(ammListHref("xrpl", {})).toBe("/xrpl/amm");
    expect(ammListHref("xrpl", { asset: "", deleted: false, back: [] })).toBe("/xrpl/amm");
    expect(ammListHref("xrpl", { back: ["M0"] })).toBe("/xrpl/amm");
    expect(ammListHref("xrpl", { asset: "XRP", back: ["M0"] })).toBe("/xrpl/amm?asset=XRP");
    expect(ammListHref("xrpl", { marker: "M3", back: ["M2", "M1"], deleted: true, asset: "XRP" })).toBe(
      "/xrpl/amm?asset=XRP&deleted=1&marker=M3&back=M2.M1",
    );
    expect(ammListHref("xahau", { deleted: true })).toBe("/xahau/amm?deleted=1");
  });

  it("does not change the trail it is given", () => {
    const back = ["M2", "M1"];
    ammListHref("xrpl", { marker: "M3", back });
    expect(back).toEqual(["M2", "M1"]);
  });
});

describe("the asset's URL form, through E3's asset.ts", () => {
  it("writes the canonical text of an asset as the loader gives it: a lower-case standard code in upper case", () => {
    const asset = assetText(parseAssetText(`usd.${ISSUER}`, XRPL)!);
    expect(ammListHref("xrpl", { asset })).toBe(`/xrpl/amm?asset=USD.${ISSUER}`);
  });

  it("writes the native code alone", () => {
    expect(ammListHref("xrpl", { asset: assetText(parseAssetText("xrp", XRPL)!) })).toBe("/xrpl/amm?asset=XRP");
  });

  it("writes a raw + (a space in the query it came in) as the separator", () => {
    const asset = assetText(parseAssetText("RLUSD rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", XRPL)!);
    expect(ammListHref("xrpl", { asset })).toBe("/xrpl/amm?asset=RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De");
    const fromQuery = list("asset=RLUSD+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De").asset!;
    expect(ammListHref("xrpl", { asset: assetText(parseAssetText(fromQuery, XRPL)!) })).toBe(
      "/xrpl/amm?asset=RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
    );
  });

  it("is a fixed point: the canonical text of an asset is its own href", () => {
    const text = assetText(parseAssetText(`usd.${ISSUER}`, XRPL)!);
    const href = ammListHref("xrpl", { asset: text, deleted: true });
    expect(listCanonical(queryOfHref(href).slice(1))).toBe(href);
    expect(list(queryOfHref(href).slice(1)).asset).toBe(text);
  });
});

describe("values are escaped for a query", () => {
  it("writes a marker and the pieces of a trail with encodeURIComponent, and leaves - and _ as they are", () => {
    expect(ammPoolHref("xrpl", P, { marker: "AB-cd_EF" })).toBe(`/xrpl/amm/${P}?marker=AB-cd_EF`);
    expect(ammPoolHref("xrpl", P, { marker: "M3", back: ["A_b-C", "M1"] })).toBe(`/xrpl/amm/${P}?marker=M3&back=A_b-C.M1`);
    expect(ammPoolHref("xrpl", P, { marker: "ab==" })).toBe(`/xrpl/amm/${P}?marker=ab%3D%3D`);
    expect(ammPoolHref("xrpl", P, { marker: "a b&c=d" })).toBe(`/xrpl/amm/${P}?marker=a%20b%26c%3Dd`);
    expect(ammListHref("xrpl", { marker: "a b&c=d", back: ["A+B=", "C/D"] })).toBe("/xrpl/amm?marker=a%20b%26c%3Dd&back=A%2BB%3D.C%2FD");
  });

  it("escapes a text code's #, and every character that would end or split a value", () => {
    const asset = assetText(parseAssetText(`AB#C.${ISSUER}`, XRPL)!);
    expect(asset).toBe(`AB#C.${ISSUER}`);
    expect(ammListHref("xrpl", { asset })).toBe(`/xrpl/amm?asset=AB%23C.${ISSUER}`);
    expect(ammListHref("xrpl", { asset: "a&b=c d" })).toBe("/xrpl/amm?asset=a%26b%3Dc%20d");
  });

  it("escapes ' as %27, which a URL parser would write in a query anyway (E3's rule)", () => {
    const asset = assetText(parseAssetText(`AB'C.${ISSUER}`, XRPL)!);
    expect(asset).toBe(`AB'C.${ISSUER}`);
    const href = ammListHref("xrpl", { asset });
    expect(href).toBe(`/xrpl/amm?asset=AB%27C.${ISSUER}`);
    expect(serialized(href)).toBe(queryOfHref(href));
    expect(ammListHref("xrpl", { marker: "a'b", back: ["x'y", "M1"] })).toBe("/xrpl/amm?marker=a%27b&back=x%27y.M1");
    expect(ammPoolHref("xrpl", P, { marker: "a'b", back: ["x'y", "M1"] })).toBe(`/xrpl/amm/${P}?marker=a%27b&back=x%27y.M1`);
  });
});

/** A small seeded generator, so that a failure can be repeated. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("a canonical href is a fixed point of parse-then-write (P1: the routes compare what the request says to it)", () => {
  const characters = [..."'\"<> #%&+=?/\\^`{|}~!$()*,:;@[]-_.é\u{1F600}"];
  for (let code = 0x20; code < 0x7f; code++) characters.push(String.fromCharCode(code));

  /**
   * What a loader does with a request whose query is `query`: parse it, write the canonical href, and take the query of `request.url`
   * once that href has been requested (a URL parser serialized it). The canonical href must be what that query writes again.
   */
  function checkPool(query: string): void {
    const href = poolCanonical(query);
    expect(serialized(href)).toBe(queryOfHref(href));
    expect(poolCanonical(queryOfHref(serialized(href)).slice(1))).toBe(href);
    expect(new URL(`https://h${href}`).pathname).toBe(`/xrpl/amm/${P}`);
  }
  function checkList(query: string): void {
    const href = listCanonical(query);
    expect(serialized(href)).toBe(queryOfHref(href));
    expect(listCanonical(queryOfHref(serialized(href)).slice(1))).toBe(href);
    expect(new URL(`https://h${href}`).pathname).toBe("/xrpl/amm");
  }

  it("holds for any character of an asset, a marker or a trail", () => {
    for (const character of characters) {
      const text = `a${character}b`;
      const value = encodeURIComponent(text);
      checkList(`asset=${value}`);
      checkList(`marker=${value}`);
      checkList(`asset=${value}&deleted=1&marker=M3&back=${value}.M1`);
      checkList(`marker=M3&back=${encodeURIComponent(`M${character}`)}`);
      checkPool(`marker=${value}&tab=liquidity`);
      checkPool(`marker=M3&back=M2.${value}`);
    }
  });

  it("holds for a raw query, where the characters come unescaped and a + is a space", () => {
    for (const query of ["asset=RLUSD+rMx", "asset=a'b", "marker=a'b&back=c'd", "asset=%zz", "marker=%E0%A4%A", "asset=a%2Bb", "marker=ab%3d", "tab=%6Ciquidity", "period=%33%30d"]) {
      checkList(query);
      checkPool(query);
    }
  });

  it("holds for random queries of the known parameters, unknown ones and repeats", () => {
    const next = lcg(20261019);
    const keys = ["asset", "deleted", "marker", "back", "period", "tab", "x", "_routes"];
    const values = ["", "1", "0", "yes", "XRP", "usd.rhub", "RLUSD+x", "30d", "90d", "1y", "2y", "swaps", "liquidity", "governance", "bogus", "M1", "M2.M1", "a'b", "a%27b", "%20", "%", "ab%3D%3D", "é", "a.b.c", "M0.M1.M2.M3.M4.M5.M6.M7.M8.M9.M10"];
    const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
    for (let round = 0; round < 400; round++) {
      const pairs: string[] = [];
      for (let count = Math.floor(next() * 7); count > 0; count--) pairs.push(`${pick(keys)}=${pick(values)}`);
      const query = pairs.join("&");
      checkList(query);
      checkPool(query);
    }
  });

  it("writes the same href again from what it has written, for the views the selectors link to", () => {
    for (const href of [
      ammPoolHref("xrpl", P, { period: "30d", tab: "liquidity" }),
      ammPoolHref("xrpl", P, { tab: "governance", marker: "M3", back: ["M2", "M1"] }),
      ammListHref("xrpl", { asset: `USD.${ISSUER}`, deleted: true, marker: "M3", back: ["M2"] }),
    ]) {
      const query = queryOfHref(href).slice(1);
      expect(href.startsWith("/xrpl/amm/") ? poolCanonical(query) : listCanonical(query)).toBe(href);
    }
  });
});

describe("poolLink", () => {
  it("goes to the pool page when the pages are on", () => {
    expect(poolLink("xrpl", P, { ...NO_FEATURES, ammPages: true })).toBe(`/xrpl/amm/${P}`);
    expect(poolLink("xahau", P, { ...NO_FEATURES, ammPages: true })).toBe(`/xahau/amm/${P}`);
  });

  it("goes to the account page when they are off, and with no features", () => {
    expect(poolLink("xrpl", P, { ...NO_FEATURES, ammPages: false })).toBe(`/xrpl/account/${P}`);
    expect(poolLink("xrpl", P, NO_FEATURES)).toBe(`/xrpl/account/${P}`);
    expect(poolLink("xahau", P, NO_FEATURES)).toBe(`/xahau/account/${P}`);
  });

  it("reads only ammPages: the other switches do not turn the pool page on", () => {
    const others = { validators: true, ammData: true, markets: true, accountAnalytics: true };
    expect(poolLink("xrpl", P, { ...NO_FEATURES, ...others, ammPages: false })).toBe(`/xrpl/account/${P}`);
    expect(poolLink("xrpl", P, { ...NO_FEATURES, ...others, ammPages: true })).toBe(`/xrpl/amm/${P}`);
  });
});

describe("the browser bundle", () => {
  // amm-params.ts is in the browser bundle of every page that shows a pool link: sentences, flows, LP tokens, E3's pool card. It imports
  // nothing of the Worker, of the issuer checksums (`ripple-address-codec`, behind asset.ts) or of the describe and parse trees.
  const appDir = new URL("../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

  const FORBIDDEN = (from: string) =>
    /(^|\/)server(\/|$)/.test(from) ||
    /ripple-/.test(from) ||
    /(^|\/)domain\/(describe|parse|asset)(\/|\.ts|$)/.test(from) ||
    /^\.\/(describe|parse|asset)(\/|\.ts|$)/.test(from);

  /** The file of the app (a path below app/) that `specifier`, a relative import of `from`, names. */
  function resolve(from: string, specifier: string): string {
    const target = new URL(specifier, new URL(from, appDir)).href.slice(appDir.href.length);
    for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`]) {
      if (!/\.tsx?$/.test(candidate)) continue;
      try {
        read(candidate);
        return candidate;
      } catch {
        // not a file of the app: try the next form
      }
    }
    throw new Error(`${from} imports ${specifier}, which is no file of the app`);
  }

  /** The files of the app that `file` (a path below app/) loads with it: the closure of its static, relative value imports. */
  function staticClosure(file: string): string[] {
    const seen = new Set<string>();
    const stack = [file];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const source = read(current).replace(/\bimport\(\s*["'][^"']+["']\s*\)/g, "");
      for (const from of valueImports(source).filter((specifier) => specifier.startsWith("."))) stack.push(resolve(current, from));
    }
    return [...seen].sort();
  }

  it("amm-params.ts imports nothing of app/server, domain/describe, domain/parse, domain/asset or ripple-* as a value", () => {
    expect(valueImports(read("domain/amm-params.ts")).filter(FORBIDDEN)).toEqual([]);
  });

  it("imports only paging.ts and query-of.ts at run time", () => {
    expect(valueImports(read("domain/amm-params.ts")).sort()).toEqual(["./paging", "./query-of"]);
  });

  it("loads none of those through the files it imports either; the only file of app/server it reaches is the marker alphabet, a leaf", () => {
    const closure = staticClosure("domain/amm-params.ts");
    expect(closure).toEqual(["domain/amm-params.ts", "domain/paging.ts", "domain/query-of.ts", "server/marker.ts"]);
    expect(closure.filter((path) => FORBIDDEN(path) && path !== "server/marker.ts")).toEqual([]);
    expect(valueImports(read("server/marker.ts"))).toEqual([]);
  });

  it("is checked by a filter that sees each of those", () => {
    const source = [
      'import { isMarker } from "../server/marker";',
      'import { parseAssetText } from "./asset";',
      'import { describeTx } from "./describe/describe";',
      'import { parseTx } from "../domain/parse/index";',
      'import { isValidClassicAddress } from "ripple-address-codec";',
      'import { parseTrail } from "./paging";',
      'import type { Asset } from "./asset";',
      'import { type Asset as A } from "./asset";',
    ].join("\n");
    expect(valueImports(source).filter(FORBIDDEN)).toEqual([
      "../server/marker",
      "./asset",
      "./describe/describe",
      "../domain/parse/index",
      "ripple-address-codec",
    ]);
  });
});
