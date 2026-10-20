import { classicAddressToXAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import { type Asset } from "../domain/asset";
import { parsePairPath, redirectToCanonical, type PairPath } from "./pair-route";

const XRPL = { id: "xrpl", native: "XRP" } as const;
const XAHAU = { id: "xahau", native: "XAH" } as const;
const GH = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const RL = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const LP_POOL = "rGuYK1v7kyrKEa86wPN2M9CHpT9LiWFr5m";
const RLUSD_HEX = "524C555344000000000000000000000000000000";
const USD_STANDARD_HEX = "0000000000000000000000005553440000000000";
const LP_HEX = "03F5BC4D66B44AEAD668A84F094E08C8C13F5EE2";

const XRP: Asset = { currency: "XRP" };
const USD: Asset = { currency: "USD", issuer: GH };
const RLUSD: Asset = { currency: RLUSD_HEX, issuer: RL };
const RLUSD_LOWER: Asset = { currency: "726C757364000000000000000000000000000000", issuer: RL };
const LP: Asset = { currency: LP_HEX, issuer: LP_POOL };

const path = (base: string, counter: string, net = "xrpl") => `/${net}/markets/${base}/${counter}`;

/** The pair a path names, which the test needs to be one. */
function pairOf(net: typeof XRPL | typeof XAHAU, rawPath: string): Extract<PairPath, { kind: "pair" }> {
  const parsed = parsePairPath(net, rawPath);
  if (parsed.kind !== "pair") throw new Error(`${rawPath} is not a pair: ${JSON.stringify(parsed)}`);
  return parsed;
}

describe("parsePairPath: the canonical path of what is typed, pasted or linked", () => {
  // [what is asked, the path that answers it, base, counter]
  const rows: [string, string, string, Asset, Asset][] = [
    ["the canonical path", path("XRP", `USD.${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["a `+`", path("XRP", `USD+${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["a `%2B`", path("XRP", `USD%2B${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["a `%2b` in lower case", path("XRP", `USD%2b${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["a space (`%20`)", path("XRP", `USD%20${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["a `|`", path("XRP", `USD|${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["a `%7C`", path("XRP", `USD%7C${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["the dot escaped (`%2E`)", path("XRP", `USD%2E${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["a lower-case standard code", path("XRP", `usd.${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["a mixed-case standard code", path("XRP", `UsD.${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["`xrp` in lower case", path("xrp", `USD.${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["the native code with an escaped letter", path("%58RP", `USD.${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["an escaped character that needs none", path("XRP", `%55SD.${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["lower-case 40-hex digits of a text code", path("XRP", `${RLUSD_HEX.toLowerCase()}.${RL}`), path("XRP", `RLUSD.${RL}`), XRP, RLUSD],
    ["the hex of a text code", path("XRP", `${RLUSD_HEX}.${RL}`), path("XRP", `RLUSD.${RL}`), XRP, RLUSD],
    ["the ledger's standard form of a code", path("XRP", `${USD_STANDARD_HEX}.${GH}`), path("XRP", `USD.${GH}`), XRP, USD],
    ["a text code in lower case", path("XRP", `rlusd.${RL}`), path("XRP", `rlusd.${RL}`), XRP, RLUSD_LOWER],
    ["a text code", path("XRP", `RLUSD.${RL}`), path("XRP", `RLUSD.${RL}`), XRP, RLUSD],
    ["an LP token's hex in lower case", path("XRP", `${LP_HEX.toLowerCase()}.${LP_POOL}`), path("XRP", `${LP_HEX}.${LP_POOL}`), XRP, LP],
    ["an LP token's hex in upper case", path("XRP", `${LP_HEX}.${LP_POOL}`), path("XRP", `${LP_HEX}.${LP_POOL}`), XRP, LP],
    [
      "the inverted pair",
      path(`USD.${GH}`, "XRP"),
      path(`USD.${GH}`, "XRP"),
      USD,
      XRP,
    ],
    [
      "both sides needing a change",
      path("xrp", `usd+${GH}`),
      path("XRP", `USD.${GH}`),
      XRP,
      USD,
    ],
    [
      "a character the path holds raw that the canonical path escapes",
      path("XRP", `A^BC.${RL}`),
      path("XRP", `A%5EBC.${RL}`),
      XRP,
      { currency: "415E424300000000000000000000000000000000", issuer: RL },
    ],
    [
      "a character escaped in lower case",
      path("XRP", `A%2fBC.${RL}`),
      path("XRP", `A%2FBC.${RL}`),
      XRP,
      { currency: "412F424300000000000000000000000000000000", issuer: RL },
    ],
    [
      "a text code with a `#`, escaped",
      path("XRP", `A%23BC.${RL}`),
      path("XRP", `A%23BC.${RL}`),
      XRP,
      { currency: "4123424300000000000000000000000000000000", issuer: RL },
    ],
    [
      "a text code with a `%`, escaped",
      path("XRP", `A%25BC.${RL}`),
      path("XRP", `A%25BC.${RL}`),
      XRP,
      { currency: "4125424300000000000000000000000000000000", issuer: RL },
    ],
    [
      "`markets` in another case (React Router matches it in any case)",
      `/xrpl/MARKETS/XRP/USD.${GH}`,
      path("XRP", `USD.${GH}`),
      XRP,
      USD,
    ],
  ];

  it.each(rows)("reads %s", (_what, raw, canonicalPath, base, counter) => {
    const parsed = pairOf(XRPL, raw);
    expect(parsed.base).toEqual(base);
    expect(parsed.counter).toEqual(counter);
    expect(parsed.canonicalPath).toBe(canonicalPath);
  });

  it.each(rows)("redirects %s to the canonical path, or does not when it is that", (_what, raw, canonicalPath) => {
    const response = redirectToCanonical({ path: raw, search: "" }, { path: canonicalPath, search: "" });
    if (raw === canonicalPath) {
      expect(response).toBeNull();
      return;
    }
    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe(canonicalPath);
    expect(response?.headers.get("X-Cache-Class")).toBe("immutable");
  });

  it("does not redirect the inverted pair: it is a pair of its own", () => {
    const inverted = pairOf(XRPL, path(`USD.${GH}`, "XRP"));
    expect(inverted.base).toEqual(USD);
    expect(inverted.counter).toEqual(XRP);
    expect(inverted.canonicalPath).toBe(path(`USD.${GH}`, "XRP"));
  });

  it("keeps `rlusd` as its own currency: not the one `RLUSD` is", () => {
    const lower = pairOf(XRPL, path("XRP", `rlusd.${RL}`));
    const upper = pairOf(XRPL, path("XRP", `RLUSD.${RL}`));
    expect(lower.counter.currency).not.toBe(upper.counter.currency);
    expect(lower.canonicalPath).not.toBe(upper.canonicalPath);
  });

  it("reads the native asset of Xahau, and XRP and XAH as issued currencies on the other network", () => {
    const xahau = pairOf(XAHAU, path("XAH", `USD.${GH}`, "xahau"));
    expect(xahau.base).toEqual({ currency: "XAH" });
    expect(xahau.canonicalPath).toBe(path("XAH", `USD.${GH}`, "xahau"));
    expect(pairOf(XAHAU, path(`XRP.${GH}`, "xah", "xahau"))).toMatchObject({
      base: { currency: "XRP", issuer: GH },
      counter: { currency: "XAH" },
      canonicalPath: path(`XRP.${GH}`, "XAH", "xahau"),
    });
    expect(pairOf(XRPL, path("XRP", `XAH.${GH}`))).toMatchObject({ counter: { currency: "XAH", issuer: GH } });
  });

  it("writes the canonical path with the network's own id", () => {
    expect(pairOf(XAHAU, `/xrpl/markets/XAH/USD.${GH}`).canonicalPath).toBe(path("XAH", `USD.${GH}`, "xahau"));
  });
});

describe("parsePairPath: not a pair", () => {
  const SAME_ISSUER_USD = `USD.${GH}`;

  it.each([
    ["two separators", XRPL, path("XRP", `USD.${GH}.x`), `XRP/USD.${GH}.x`.slice(0, 40)],
    ["two kinds of separator", XRPL, path("XRP", `USD+${GH}.x`), `XRP/USD+${GH}.x`.slice(0, 40)],
    ["all-zero hex", XRPL, path("XRP", `${"0".repeat(40)}.${GH}`), `XRP/${"0".repeat(40)}.${GH}`.slice(0, 40)],
    ["the native code with an issuer on XRPL", XRPL, path(`XRP.${GH}`, SAME_ISSUER_USD), `XRP.${GH}/USD.${GH}`.slice(0, 40)],
    ["the native code in lower case with an issuer on XRPL", XRPL, path(`xrp.${GH}`, "XRP"), `xrp.${GH}/XRP`.slice(0, 40)],
    ["the native code with an issuer on Xahau", XAHAU, path(`XAH.${GH}`, SAME_ISSUER_USD, "xahau"), `XAH.${GH}/USD.${GH}`.slice(0, 40)],
    ["a code without an issuer", XRPL, path("XRP", "USD"), "XRP/USD"],
    ["a text code without an issuer", XRPL, path("XRP", "RLUSD"), "XRP/RLUSD"],
    ["the other network's native code alone", XRPL, path("XRP", "XAH"), "XRP/XAH"],
    ["a bad checksum", XRPL, path("XRP", `USD.${GH.slice(0, -1)}x`), `XRP/USD.${GH.slice(0, -1)}x`.slice(0, 40)],
    ["an X-address issuer", XRPL, path("XRP", `USD.${classicAddressToXAddress(GH, false, false)}`), `XRP/USD.${classicAddressToXAddress(GH, false, false)}`.slice(0, 40)],
    ["a code containing `|`", XRPL, path("XRP", `U|D.${GH}`), `XRP/U|D.${GH}`.slice(0, 40)],
    ["a code containing an escaped `|`", XRPL, path("XRP", `U%7CD.${GH}`), `XRP/U|D.${GH}`.slice(0, 40)],
    ["a code of the wrong length", XRPL, path("XRP", `US.${GH}`), `XRP/US.${GH}`.slice(0, 40)],
    ["a code that is too long", XRPL, path("XRP", `${"A".repeat(21)}.${GH}`), `XRP/${"A".repeat(21)}.${GH}`.slice(0, 40)],
    ["the same asset on both sides", XRPL, path("XRP", "XRP"), "XRP/XRP"],
    ["the same asset written two ways", XRPL, path("XRP", "xrp"), "XRP/xrp"],
    ["the same asset with an issuer", XRPL, path(`USD.${GH}`, `usd+${GH}`), `USD.${GH}/usd+${GH}`.slice(0, 40)],
    ["the same asset, a text code and its hex", XRPL, path(`RLUSD.${RL}`, `${RLUSD_HEX}.${RL}`), `RLUSD.${RL}/${RLUSD_HEX}.${RL}`.slice(0, 40)],
    ["an empty segment", XRPL, `/xrpl/markets//USD.${GH}`, `/USD.${GH}`],
    ["both segments empty", XRPL, "/xrpl/markets//", "/"],
    ["one segment", XRPL, "/xrpl/markets/XRP", "XRP"],
    ["three segments", XRPL, path("XRP", `USD.${GH}/x`), `XRP/USD.${GH}/x`.slice(0, 40)],
    ["a trailing slash", XRPL, `${path("XRP", `USD.${GH}`)}/`, `XRP/USD.${GH}/`.slice(0, 40)],
    ["no segments", XRPL, "/xrpl/markets", ""],
    ["no segments, with a slash", XRPL, "/xrpl/markets/", ""],
  ] as const)("says so for %s", (_what, net, raw, asked) => {
    expect(parsePairPath(net, raw)).toEqual({ kind: "not-a-pair", asked });
  });

  it("says so for a segment that does not decode, and shows it as it was written", () => {
    expect(parsePairPath(XRPL, path("XRP", "%E0%A4%A"))).toEqual({ kind: "not-a-pair", asked: "XRP/%E0%A4%A" });
    expect(parsePairPath(XRPL, path("XRP", `USD.${GH}%`))).toEqual({
      kind: "not-a-pair",
      asked: `XRP/USD.${GH}%`.slice(0, 40),
    });
    // a lone `%BC` is a malformed UTF-8 sequence, not a character
    expect(parsePairPath(XRPL, path("XRP", `A%BC.${RL}`)).kind).toBe("not-a-pair");
  });

  it("shows what was asked decoded, and cut to 40 characters", () => {
    expect(parsePairPath(XRPL, path("XRP", "USD%2B%41"))).toEqual({ kind: "not-a-pair", asked: "XRP/USD+A" });
    const asked = (parsePairPath(XRPL, path("XRP", "z".repeat(100))) as { asked: string }).asked;
    expect(asked).toBe(`XRP/${"z".repeat(36)}`);
    expect(asked).toHaveLength(40);
  });

  it("cuts a long text between characters, never inside one", () => {
    const smiley = "\u{1F600}";
    const { asked } = parsePairPath(XRPL, path("XRP", encodeURIComponent(smiley.repeat(50)))) as { asked: string };
    expect([...asked]).toHaveLength(40);
    expect(asked).toBe(`XRP/${smiley.repeat(36)}`);
    expect(asked).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("does not read a code that is valid on the other network", () => {
    // `XRP.r…` is an issued currency on Xahau, not a pair on XRPL; `XAH.r…` is one on XRPL.
    expect(parsePairPath(XRPL, path(`XRP.${GH}`, "XRP")).kind).toBe("not-a-pair");
    expect(parsePairPath(XAHAU, path(`XRP.${GH}`, "XAH", "xahau")).kind).toBe("pair");
    expect(parsePairPath(XAHAU, path(`XAH.${GH}`, "XAH", "xahau")).kind).toBe("not-a-pair");
    expect(parsePairPath(XRPL, path(`XAH.${GH}`, "XRP")).kind).toBe("pair");
  });
});

describe("redirectToCanonical", () => {
  const canonical = { path: `/xrpl/markets/XRP/USD.${GH}`, search: "?interval=4h" };

  it("is null when the path and the query are the canonical ones", () => {
    expect(redirectToCanonical({ ...canonical }, canonical)).toBeNull();
    expect(redirectToCanonical({ path: canonical.path, search: "" }, { path: canonical.path, search: "" })).toBeNull();
  });

  it("is a 302 of class immutable when only the path differs, to the canonical path and query", () => {
    const response = redirectToCanonical({ path: `/xrpl/markets/XRP/usd.${GH}`, search: "?interval=4h" }, canonical);
    expect(response?.status).toBe(302);
    expect(response?.headers.get("X-Cache-Class")).toBe("immutable");
    expect(response?.headers.get("Location")).toBe(`/xrpl/markets/XRP/USD.${GH}?interval=4h`);
  });

  it("is a 302 of class short when the query differs", () => {
    const query = redirectToCanonical({ path: canonical.path, search: "?interval=4H&x=1" }, canonical);
    expect(query?.status).toBe(302);
    expect(query?.headers.get("X-Cache-Class")).toBe("short");
    expect(query?.headers.get("Location")).toBe(`/xrpl/markets/XRP/USD.${GH}?interval=4h`);
    // a query that is not there, and one that should not be
    expect(redirectToCanonical({ path: canonical.path, search: "" }, canonical)?.headers.get("X-Cache-Class")).toBe("short");
    const dropped = redirectToCanonical({ path: canonical.path, search: "?x=1" }, { path: canonical.path, search: "" });
    expect(dropped?.headers.get("X-Cache-Class")).toBe("short");
    expect(dropped?.headers.get("Location")).toBe(canonical.path);
  });

  it("is short when both the path and the query differ, and goes to both of the canonical ones", () => {
    const both = redirectToCanonical({ path: `/xrpl/markets/xrp/USD+${GH}`, search: "?x=1" }, canonical);
    expect(both?.status).toBe(302);
    expect(both?.headers.get("X-Cache-Class")).toBe("short");
    expect(both?.headers.get("Location")).toBe(`/xrpl/markets/XRP/USD.${GH}?interval=4h`);
  });

  it("reads a query written with or without its `?` as the same query", () => {
    expect(redirectToCanonical({ path: canonical.path, search: "interval=4h" }, canonical)).toBeNull();
    expect(redirectToCanonical({ path: canonical.path, search: "?interval=4h" }, { path: canonical.path, search: "interval=4h" })).toBeNull();
    const response = redirectToCanonical({ path: canonical.path, search: "" }, { path: canonical.path, search: "interval=4h" });
    expect(response?.headers.get("Location")).toBe(`${canonical.path}?interval=4h`);
  });

  it("keeps a canonical path with an escape as it is written", () => {
    const escaped = { path: `/xrpl/markets/A%23BC.${RL}/XRP`, search: "" };
    expect(redirectToCanonical({ path: `/xrpl/markets/A%23BC.${RL}/%58RP`, search: "" }, escaped)?.headers.get("Location")).toBe(escaped.path);
  });
});
