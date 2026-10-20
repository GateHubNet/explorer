import { classicAddressToXAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import { apiAssetText, assetText, canonicalPair, parseAssetText, sameAsset, type Asset } from "./asset";

const XRPL = { native: "XRP" } as const;
const XAHAU = { native: "XAH" } as const;
const GH = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const RL = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const RLUSD_HEX = "524C555344000000000000000000000000000000";
const USD_STANDARD_HEX = "0000000000000000000000005553440000000000";
const LP_HEX = "03f5bc4d66b44aead668a84f094e08c8c13f5ee2";
const LP_POOL = "rGuYK1v7kyrKEa86wPN2M9CHpT9LiWFr5m";
const LIONS_HEX = "4C494F4E53000000000000000000000000000000";
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";

const USD: Asset = { currency: "USD", issuer: GH };
const XRP: Asset = { currency: "XRP" };
const RLUSD: Asset = { currency: RLUSD_HEX, issuer: RL };
const LIONS: Asset = { currency: LIONS_HEX, issuer: LIONS_ISSUER };

/** The ledger's standard form of the three characters: zero bytes, the characters, zero bytes. */
function standardHexOf(characters: string): string {
  const hex = [...characters].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return `${"0".repeat(24)}${hex}${"0".repeat(10)}`;
}

/** An asset text that must be one, on XRPL. */
function parsed(text: string, network: { native: "XRP" | "XAH" } = XRPL): Asset {
  const asset = parseAssetText(text, network);
  if (asset === null) throw new Error(`${JSON.stringify(text)} did not parse`);
  return asset;
}

describe("parseAssetText: the native code", () => {
  it("reads the network's own code alone, in any case, as the code", () => {
    expect(parseAssetText("XRP", XRPL)).toEqual({ currency: "XRP" });
    expect(parseAssetText("xrp", XRPL)).toEqual({ currency: "XRP" });
    expect(parseAssetText("xRp", XRPL)).toEqual({ currency: "XRP" });
    expect(parseAssetText("xah", XAHAU)).toEqual({ currency: "XAH" });
  });

  it("writes the native code upper-case, so `xrp` is not canonical", () => {
    expect(assetText(parsed("xrp"))).toBe("XRP");
    expect(assetText(parsed("XAH", XAHAU))).toBe("XAH");
  });

  it("takes the native code of the other network as an issued currency, and its own with an issuer as nothing", () => {
    expect(parseAssetText(`XRP.${GH}`, XRPL)).toBeNull();
    expect(parseAssetText(`xrp.${GH}`, XRPL)).toBeNull();
    expect(parseAssetText(`XRP.${GH}`, XAHAU)).toEqual({ currency: "XRP", issuer: GH });
    expect(parseAssetText(`XAH.${GH}`, XRPL)).toEqual({ currency: "XAH", issuer: GH });
    expect(parseAssetText(`xah.${GH}`, XRPL)).toEqual({ currency: "XAH", issuer: GH });
    expect(parseAssetText(`XAH.${GH}`, XAHAU)).toBeNull();
  });

  it("refuses the other network's code alone: any other code needs an issuer", () => {
    expect(parseAssetText("XAH", XRPL)).toBeNull();
    expect(parseAssetText("XRP", XAHAU)).toBeNull();
  });

  it("does not read the native code as the ledger's all-zero currency, nor as its 40 hex digits", () => {
    expect(parseAssetText(`${"0".repeat(40)}.${GH}`, XRPL)).toBeNull();
    expect(parseAssetText(`${"0".repeat(40)}.${GH}`, XAHAU)).toBeNull();
    expect(parseAssetText("0".repeat(40), XRPL)).toBeNull();
    const xrpHex = "0000000000000000000000005852500000000000";
    const xahHex = "0000000000000000000000005841480000000000";
    expect(parseAssetText(`${xrpHex}.${GH}`, XRPL)).toBeNull();
    expect(parseAssetText(`${xrpHex}.${GH}`, XAHAU)).toEqual({ currency: "XRP", issuer: GH });
    expect(parseAssetText(`${xahHex}.${GH}`, XAHAU)).toBeNull();
    expect(parseAssetText(`${xahHex}.${GH}`, XRPL)).toEqual({ currency: "XAH", issuer: GH });
  });

  it("matches the native code on ASCII letters only", () => {
    expect(parseAssetText("ｘｒｐ", XRPL)).toBeNull();
    expect(parseAssetText("xrṕ", XRPL)).toBeNull();
    expect(parseAssetText("XRP\u0000", XRPL)).toBeNull();
  });
});

describe("parseAssetText: standard 3-character codes", () => {
  it("reads a code in any case as the upper-case code (the canonical case rule)", () => {
    expect(parseAssetText(`usd.${GH}`, XRPL)).toEqual(USD);
    expect(parseAssetText(`UsD.${GH}`, XRPL)).toEqual(USD);
    expect(parseAssetText(`USD.${GH}`, XRPL)).toEqual(USD);
    expect(assetText(parsed(`usd.${GH}`))).toBe(`USD.${GH}`);
    expect(assetText(parsed(`UsD.${GH}`))).toBe(`USD.${GH}`);
  });

  it("keeps the case of the issuer, which is part of it", () => {
    expect(parsed(`usd.${GH}`).issuer).toBe(GH);
    expect(parseAssetText(`usd.${GH.toLowerCase()}`, XRPL)).toBeNull();
  });

  it("allows the symbols of the ledger's standard form", () => {
    expect(parseAssetText(`<3!.${GH}`, XRPL)).toEqual({ currency: "<3!", issuer: GH });
    expect(assetText(parsed(`<3!.${GH}`))).toBe(`<3!.${GH}`);
    for (const code of ["?!@", "#$%", "^&*", "<>(", "){}", "[]0", "a9Z"]) {
      expect(parseAssetText(`${code}.${GH}`, XRPL)).toEqual({ currency: code.toUpperCase(), issuer: GH });
    }
  });

  it("refuses a 3-character code with a character outside the set", () => {
    for (const code of ["U-D", "U_D", "U/D", "U~D", "U=D", "U:D", "U'D", 'U"D', "U\\D", "UÉD", "U€D", "ééé"]) {
      expect(parseAssetText(`${code}.${GH}`, XRPL), code).toBeNull();
    }
  });

  it("refuses a standard code without an issuer", () => {
    expect(parseAssetText("USD", XRPL)).toBeNull();
    expect(parseAssetText("usd", XAHAU)).toBeNull();
  });
});

describe("parseAssetText: text codes", () => {
  it("reads 4 to 20 printable characters as their bytes, left-aligned and zero-padded", () => {
    expect(parseAssetText(`RLUSD.${RL}`, XRPL)).toEqual(RLUSD);
    expect(parseAssetText(`LIONS.${LIONS_ISSUER}`, XRPL)).toEqual(LIONS);
    expect(assetText(parsed(`RLUSD.${RL}`))).toBe(`RLUSD.${RL}`);
  });

  it("keeps the case of a text code: its letters are the currency's bytes", () => {
    const lower = parseAssetText(`rlusd.${RL}`, XRPL);
    expect(lower).toEqual({ currency: "726C757364000000000000000000000000000000", issuer: RL });
    expect(lower?.currency).not.toBe(RLUSD_HEX);
    expect(assetText(parsed(`rlusd.${RL}`))).toBe(`rlusd.${RL}`);
    expect(assetText(parsed(`RlUsD.${RL}`))).toBe(`RlUsD.${RL}`);
  });

  it("takes the shortest and the longest text code, and no other length", () => {
    const four = parsed(`ABCD.${RL}`);
    expect(four.currency).toBe(`41424344${"0".repeat(32)}`);
    expect(assetText(four)).toBe(`ABCD.${RL}`);

    const twenty = "ABCDEFGHIJKLMNOPQRST";
    const full = parsed(`${twenty}.${RL}`);
    expect(full.currency).toBe("4142434445464748494A4B4C4D4E4F5051525354");
    expect(assetText(full)).toBe(`${twenty}.${RL}`);

    expect(parseAssetText(`${twenty}U.${RL}`, XRPL)).toBeNull();
    expect(parseAssetText(`AB.${RL}`, XRPL)).toBeNull();
    expect(parseAssetText(`A.${RL}`, XRPL)).toBeNull();
    expect(parseAssetText(`.${RL}`, XRPL)).toBeNull();
  });

  it("takes any printable ASCII character a separator is not", () => {
    for (const code of ["A-B_", "!~~!", "a/b\\c", "100%", "<tag>", "{x}[y]", "$$$$", "a'b\"c", "Z:;=?"]) {
      const asset = parsed(`${code}.${RL}`);
      expect(asset.currency).toHaveLength(40);
      expect(assetText(asset), code).toBe(`${code}.${RL}`);
    }
  });

  it("refuses a code with a non-printable or non-ASCII character", () => {
    for (const code of ["AB\tCD", "AB\u007FCD", "ABéCD", "€€€€", "AB\nCD", "AB\u0000CD"]) {
      expect(parseAssetText(`${code}.${RL}`, XRPL), JSON.stringify(code)).toBeNull();
    }
  });

  it("does not read a text code as the native code", () => {
    expect(parseAssetText(`XRPX.${GH}`, XRPL)).toEqual({ currency: `58525058${"0".repeat(32)}`, issuer: GH });
  });
});

describe("parseAssetText: 40 hex digits", () => {
  it("reads the hex of a text code as that text", () => {
    expect(parseAssetText(`${RLUSD_HEX.toLowerCase()}.${RL}`, XRPL)).toEqual(RLUSD);
    expect(parseAssetText(`${RLUSD_HEX}.${RL}`, XRPL)).toEqual(RLUSD);
    expect(assetText(parsed(`${RLUSD_HEX.toLowerCase()}.${RL}`))).toBe(`RLUSD.${RL}`);
    expect(assetText(parsed(`${RLUSD_HEX}.${RL}`))).toBe(`RLUSD.${RL}`);
  });

  it("reads the ledger's standard form of a 3-character code as that code", () => {
    expect(parseAssetText(`${USD_STANDARD_HEX}.${GH}`, XRPL)).toEqual(USD);
    expect(assetText(parsed(`${USD_STANDARD_HEX}.${GH}`))).toBe(`USD.${GH}`);
    // The bytes of `usd` give the upper-case code, as `usd.r…` does.
    expect(parseAssetText(`${standardHexOf("usd")}.${GH}`, XRPL)).toEqual(USD);
    // The symbols of the set are standard in hex too.
    expect(parseAssetText(`${standardHexOf("<3!")}.${GH}`, XRPL)).toEqual({ currency: "<3!", issuer: GH });
  });

  it("keeps an LP token's hex in upper case, and writes it so", () => {
    const lp = parseAssetText(`${LP_HEX}.${LP_POOL}`, XRPL);
    expect(lp).toEqual({ currency: LP_HEX.toUpperCase(), issuer: LP_POOL });
    expect(assetText(lp as Asset)).toBe(`${LP_HEX.toUpperCase()}.${LP_POOL}`);
    expect(parseAssetText(`${LP_HEX.toUpperCase()}.${LP_POOL}`, XRPL)).toEqual(lp);
  });

  it("refuses 40 zeros: they are the native code", () => {
    expect(parseAssetText(`${"0".repeat(40)}.${GH}`, XRPL)).toBeNull();
  });

  it("keeps as hex every 40 digits that spell neither a text nor a standard code", () => {
    const cases = [
      // The 3 characters at the left, as a text code of fewer than 4 characters.
      `555344${"0".repeat(34)}`,
      // A zero byte inside the text.
      `41420043${"0".repeat(32)}`,
      // Bytes 12 to 14 not a standard code (a space; a pipe; a zero; a character outside the set).
      standardHexOf("U D"),
      standardHexOf("U|D"),
      standardHexOf("U\0D"),
      standardHexOf("U-D"),
      // A standard code with something after it, or before it.
      "0000000000000000000000005553440000000001",
      "0100000000000000000000005553440000000000",
      // A character a URL cannot carry as a separator-free text.
      `41422E43${"0".repeat(32)}`,
      `41422B43${"0".repeat(32)}`,
      `41427C43${"0".repeat(32)}`,
      `41422043${"0".repeat(32)}`,
      // 20 bytes, the last one 0x7F: not printable.
      "414243444546474849505152535455565758597F",
      "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
      "1".repeat(40),
    ];
    for (const hex of cases) {
      expect(hex, hex).toHaveLength(40);
      const asset = parseAssetText(`${hex.toLowerCase()}.${GH}`, XRPL);
      expect(asset, hex).toEqual({ currency: hex.toUpperCase(), issuer: GH });
      expect(assetText(asset as Asset), hex).toBe(`${hex.toUpperCase()}.${GH}`);
    }
  });

  it("refuses hex of another length, or with a character that is not a digit", () => {
    expect(parseAssetText(`${RLUSD_HEX}0.${RL}`, XRPL)).toBeNull();
    expect(parseAssetText(`${"A".repeat(39)}.${RL}`, XRPL)).toBeNull();
    expect(parseAssetText(`${"A".repeat(39)}G.${RL}`, XRPL)).toBeNull();
    expect(parseAssetText(`0x${"A".repeat(38)}.${RL}`, XRPL)).toBeNull();
  });
});

describe("parseAssetText: separators", () => {
  it("reads `.`, `+`, a space and `|` as the one separator", () => {
    for (const separator of [".", "+", " ", "|"]) {
      expect(parseAssetText(`USD${separator}${GH}`, XRPL), JSON.stringify(separator)).toEqual(USD);
    }
    expect(parsed(`USD+${GH}`)).toEqual(parsed(`USD.${GH}`));
    expect(parsed(`USD ${GH}`)).toEqual(parsed(`USD.${GH}`));
    expect(parsed(`USD|${GH}`)).toEqual(parsed(`USD.${GH}`));
  });

  it("refuses more than one separator", () => {
    expect(parseAssetText(`USD.${GH}.x`, XRPL)).toBeNull();
    expect(parseAssetText(`USD.${GH}.`, XRPL)).toBeNull();
    expect(parseAssetText(`USD+${GH}+${GH}`, XRPL)).toBeNull();
    expect(parseAssetText(`USD ${GH} `, XRPL)).toBeNull();
    expect(parseAssetText(`USD.+${GH}`, XRPL)).toBeNull();
    expect(parseAssetText(`US D.${GH}`, XRPL)).toBeNull();
    expect(parseAssetText("XRP.", XRPL)).toBeNull();
    expect(parseAssetText("X.R.P", XRPL)).toBeNull();
  });

  it("refuses a code with `|` in it: the API splits on it", () => {
    expect(parseAssetText(`U|D.${GH}`, XRPL)).toBeNull();
    expect(parseAssetText(`AB|CD.${RL}`, XRPL)).toBeNull();
  });

  it("refuses a missing part", () => {
    expect(parseAssetText("", XRPL)).toBeNull();
    expect(parseAssetText(".", XRPL)).toBeNull();
    expect(parseAssetText(`.${GH}`, XRPL)).toBeNull();
    expect(parseAssetText(`+${GH}`, XRPL)).toBeNull();
    expect(parseAssetText("USD.", XRPL)).toBeNull();
    expect(parseAssetText("USD+", XRPL)).toBeNull();
    expect(parseAssetText("XRP ", XRPL)).toBeNull();
    expect(parseAssetText(" XRP", XRPL)).toBeNull();
    expect(parseAssetText(GH, XRPL)).toBeNull();
  });

  it("does not decode percent-escapes: the route decodes a segment first", () => {
    expect(parseAssetText(`USD%2B${GH}`, XRPL)).toBeNull();
    expect(parsed(decodeURIComponent(`USD%2B${GH}`))).toEqual(USD);
  });
});

describe("parseAssetText: issuers", () => {
  it("refuses an issuer whose checksum is wrong", () => {
    const wrong = `${GH.slice(0, -1)}${GH.endsWith("a") ? "b" : "a"}`;
    expect(wrong).not.toBe(GH);
    expect(parseAssetText(`USD.${wrong}`, XRPL)).toBeNull();
    expect(parseAssetText(`RLUSD.${wrong}`, XRPL)).toBeNull();
    expect(parseAssetText(`${RLUSD_HEX}.${wrong}`, XRPL)).toBeNull();
  });

  it("refuses the X-address of an issuer", () => {
    expect(parseAssetText(`USD.${classicAddressToXAddress(GH, false, false)}`, XRPL)).toBeNull();
    expect(parseAssetText(`USD.${classicAddressToXAddress(GH, 12, false)}`, XRPL)).toBeNull();
  });

  it("refuses an issuer that is no address at all", () => {
    for (const issuer of ["r", "rhub", "x".repeat(34), "0".repeat(34), "USD", "€"]) {
      expect(parseAssetText(`USD.${issuer}`, XRPL), issuer).toBeNull();
    }
  });
});

describe("parseAssetText: what the review looks at", () => {
  // The inputs the plan's Review Focus lists, as the route hands them over (a segment, decoded), and their one canonical text.
  const inputs: [string, string][] = [
    [`usd.${GH}`, `USD.${GH}`],
    ["xrp", "XRP"],
    [`USD+${GH}`, `USD.${GH}`],
    [decodeURIComponent(`USD%2B${GH}`), `USD.${GH}`],
    [`USD ${GH}`, `USD.${GH}`],
    [`USD|${GH}`, `USD.${GH}`],
    [`${RLUSD_HEX}.${RL}`, `RLUSD.${RL}`],
    [`${USD_STANDARD_HEX}.${GH}`, `USD.${GH}`],
    [`${LP_HEX}.${LP_POOL}`, `${LP_HEX.toUpperCase()}.${LP_POOL}`],
    [`rlusd.${RL}`, `rlusd.${RL}`],
  ];

  it.each(inputs)("%s is %s", (text, canonical) => {
    expect(assetText(parsed(text))).toBe(canonical);
  });

  it("keeps `rlusd` and `RLUSD` two currencies, and `usd` and `USD` one", () => {
    expect(parsed(`rlusd.${RL}`).currency).not.toBe(parsed(`RLUSD.${RL}`).currency);
    expect(parsed(`usd.${GH}`)).toEqual(parsed(`USD.${GH}`));
  });
});

describe("assetText", () => {
  it("writes the native code alone", () => {
    expect(assetText(XRP)).toBe("XRP");
    expect(assetText({ currency: "XAH" })).toBe("XAH");
  });

  it("writes the other network's code as an issued currency", () => {
    expect(assetText({ currency: "XAH", issuer: GH })).toBe(`XAH.${GH}`);
    expect(assetText({ currency: "XRP", issuer: GH })).toBe(`XRP.${GH}`);
  });

  it("upper-cases a 3-character code, and writes a standard-form currency as its 3 characters", () => {
    expect(assetText({ currency: "usd", issuer: GH })).toBe(`USD.${GH}`);
    expect(assetText({ currency: USD_STANDARD_HEX, issuer: GH })).toBe(`USD.${GH}`);
    expect(assetText({ currency: USD_STANDARD_HEX.toLowerCase(), issuer: GH })).toBe(`USD.${GH}`);
  });

  it("writes a currency whose bytes are 4 to 20 printable characters as that text", () => {
    expect(assetText(RLUSD)).toBe(`RLUSD.${RL}`);
    expect(assetText({ currency: RLUSD_HEX.toLowerCase(), issuer: RL })).toBe(`RLUSD.${RL}`);
    expect(assetText(LIONS)).toBe(`LIONS.${LIONS_ISSUER}`);
  });

  it("writes any other 40-hex currency as upper-case hex", () => {
    expect(assetText({ currency: LP_HEX, issuer: LP_POOL })).toBe(`${LP_HEX.toUpperCase()}.${LP_POOL}`);
    // `.`, `+` and `|` are separators and cannot be in a text; a text needs 4 characters at least.
    const withDot = `41422E43${"0".repeat(32)}`;
    const withPlus = `41422B43${"0".repeat(32)}`;
    const withPipe = `41427C43${"0".repeat(32)}`;
    const short = `555344${"0".repeat(34)}`;
    for (const currency of [withDot, withPlus, withPipe, short]) {
      expect(assetText({ currency, issuer: GH })).toBe(`${currency}.${GH}`);
    }
  });
});

describe("apiAssetText", () => {
  it("is the native code alone", () => {
    expect(apiAssetText(XRP)).toBe("XRP");
    expect(apiAssetText({ currency: "XAH" })).toBe("XAH");
  });

  it("is `CUR+issuer`", () => {
    expect(apiAssetText(USD)).toBe(`USD+${GH}`);
    expect(apiAssetText({ currency: "XAH", issuer: GH })).toBe(`XAH+${GH}`);
  });

  it("sends a text code as its 40 hex digits", () => {
    expect(apiAssetText(RLUSD)).toBe(`${RLUSD_HEX}+${RL}`);
    expect(apiAssetText(parsed(`RLUSD.${RL}`))).toBe(`${RLUSD_HEX}+${RL}`);
    expect(apiAssetText(parsed(`rlusd.${RL}`))).toBe(`726C757364000000000000000000000000000000+${RL}`);
  });

  it("sends the same text whatever way the asset was typed", () => {
    const typed = [`usd.${GH}`, `USD+${GH}`, `USD ${GH}`, `USD|${GH}`, `${USD_STANDARD_HEX}.${GH}`];
    for (const text of typed) expect(apiAssetText(parsed(text)), text).toBe(`USD+${GH}`);
  });
});

describe("canonicalPair", () => {
  it("puts USD before XRP, as the reference's example does", () => {
    expect(canonicalPair(USD, XRP)).toEqual([USD, XRP]);
    expect(canonicalPair(XRP, USD)).toEqual([USD, XRP]);
  });

  it("puts the hex of a text code before XRP", () => {
    expect(canonicalPair(XRP, RLUSD)).toEqual([RLUSD, XRP]);
    expect(canonicalPair(RLUSD, XRP)).toEqual([RLUSD, XRP]);
  });

  it("gives the order the account fixtures' API rows have: LIONS/XRP", () => {
    expect(canonicalPair(XRP, LIONS)).toEqual([LIONS, XRP]);
  });

  it("puts the asset of the code that sorts first before the other, in either order given", () => {
    const eur: Asset = { currency: "EUR", issuer: GH };
    expect(canonicalPair(USD, eur)).toEqual([eur, USD]);
    expect(canonicalPair(eur, USD)).toEqual([eur, USD]);
  });

  it("orders one currency of two issuers by the lower-cased issuer", () => {
    const first: Asset = { currency: "USD", issuer: GH };
    const second: Asset = { currency: "USD", issuer: RL };
    expect(GH.toLowerCase() < RL.toLowerCase()).toBe(true);
    expect(canonicalPair(second, first)).toEqual([first, second]);
    expect(canonicalPair(first, second)).toEqual([first, second]);
  });

  it("compares the lower-cased texts, so an upper-case letter does not sort before a lower-case one", () => {
    // Case-sensitively `rB…` (0x42) sorts before `rb…` (0x62); lower-cased, `rbA…` comes before `rbZ…`.
    const lower: Asset = { currency: "USD", issuer: "rAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
    const upper: Asset = { currency: "USD", issuer: "rbAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
    const mixed: Asset = { currency: "USD", issuer: "rBZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ" };
    expect(canonicalPair(mixed, upper)).toEqual([upper, mixed]);
    expect(canonicalPair(upper, mixed)).toEqual([upper, mixed]);
    expect(canonicalPair(lower, upper)).toEqual([lower, upper]);
  });

  it("joins the currency and the issuer with nothing between, as the API's stored key does", () => {
    // `abc` + `rhub…` is `abcrhub…`, and the hex `ABC000…` is `abc000…`: `0` sorts before `r`. With a separator between the
    // parts the 3-character code would sort first.
    const code: Asset = { currency: "ABC", issuer: GH };
    const hex: Asset = { currency: `ABC${"0".repeat(37)}`, issuer: GH };
    expect(canonicalPair(code, hex)).toEqual([hex, code]);
    expect(canonicalPair(hex, code)).toEqual([hex, code]);
  });

  it("keeps the order of two assets that sort alike", () => {
    const lower: Asset = { currency: "usd", issuer: GH };
    expect(canonicalPair(USD, lower)).toEqual([USD, lower]);
    expect(canonicalPair(lower, USD)).toEqual([lower, USD]);
  });

  it("puts XAH after the dollars on Xahau too", () => {
    const xah: Asset = { currency: "XAH" };
    expect(canonicalPair(xah, USD)).toEqual([USD, xah]);
  });

  // The API's key is `currency + (issuer || "undefined")`, lower-cased (`canonicalPairKey`, data-api-new
  // `packages/shared/src/parsers/exchanges.parser.ts`): a native currency's key is `xrpundefined`, not `xrp`.
  describe.each([
    ["XRP", XRP],
    ["XAH", { currency: "XAH" }],
  ] as const)("the native %s keyed as the API keys it", (code, native) => {
    const issued: Asset = { currency: code, issuer: GH };

    it("puts the same code issued before the native one: an issuer (`r…`) sorts before `undefined`", () => {
      expect(canonicalPair(native, issued)).toEqual([issued, native]);
      expect(canonicalPair(issued, native)).toEqual([issued, native]);
    });

    it("keys an empty issuer, as a stored row carries for the native currency, as the native currency", () => {
      const stored: Asset = { currency: code, issuer: "" };
      expect(canonicalPair(stored, issued)).toEqual([issued, stored]);
      expect(canonicalPair(issued, stored)).toEqual([issued, stored]);
      // The same key as the native one: the given order stays.
      expect(canonicalPair(stored, native)).toEqual([stored, native]);
      expect(canonicalPair(native, stored)).toEqual([native, stored]);
    });
  });
});

describe("sameAsset", () => {
  it("is true for an equal currency and issuer", () => {
    expect(sameAsset(USD, { currency: "USD", issuer: GH })).toBe(true);
    expect(sameAsset(XRP, { currency: "XRP" })).toBe(true);
    expect(sameAsset(RLUSD, parsed(`${RLUSD_HEX.toLowerCase()}.${RL}`))).toBe(true);
  });

  it("is false when the currency, or the issuer, differs", () => {
    expect(sameAsset(USD, { currency: "EUR", issuer: GH })).toBe(false);
    expect(sameAsset(USD, { currency: "USD", issuer: RL })).toBe(false);
    expect(sameAsset(RLUSD, parsed(`rlusd.${RL}`))).toBe(false);
  });

  it("tells the native code from an issued currency of the same code", () => {
    expect(sameAsset({ currency: "XRP" }, { currency: "XRP", issuer: GH })).toBe(false);
    expect(sameAsset({ currency: "XRP", issuer: GH }, { currency: "XRP" })).toBe(false);
  });

  it("takes an absent issuer and an empty one as the same", () => {
    expect(sameAsset({ currency: "XRP" }, { currency: "XRP", issuer: "" })).toBe(true);
  });
});

describe("round trip", () => {
  const texts: [string, { native: "XRP" | "XAH" }][] = [
    ["XRP", XRPL],
    ["xrp", XRPL],
    ["XAH", XAHAU],
    [`XRP.${GH}`, XAHAU],
    [`XAH.${GH}`, XRPL],
    [`usd.${GH}`, XRPL],
    [`UsD.${GH}`, XRPL],
    [`<3!.${GH}`, XRPL],
    [`RLUSD.${RL}`, XRPL],
    [`rlusd.${RL}`, XRPL],
    [`${RLUSD_HEX.toLowerCase()}.${RL}`, XRPL],
    [`${USD_STANDARD_HEX}.${GH}`, XRPL],
    [`${LP_HEX}.${LP_POOL}`, XRPL],
    [`USD+${GH}`, XRPL],
    [`USD ${GH}`, XRPL],
    [`USD|${GH}`, XRPL],
    [`${"41424344".padEnd(40, "0")}.${GH}`, XRPL],
    [`${"555344".padEnd(40, "0")}.${GH}`, XRPL],
    [`${"41422E43".padEnd(40, "0")}.${GH}`, XRPL],
    [`${"41420043".padEnd(40, "0")}.${GH}`, XRPL],
    [`${LIONS_HEX.toLowerCase()}.${LIONS_ISSUER}`, XRPL],
  ];

  it.each(texts)("%s reads back as itself", (text, network) => {
    const asset = parsed(text, network);
    expect(parseAssetText(assetText(asset), network)).toEqual(asset);
  });

  it.each(texts)("%s is canonical once written", (text, network) => {
    const written = assetText(parsed(text, network));
    expect(assetText(parsed(written, network))).toBe(written);
  });

  it.each(texts)("%s is sent to the API as the text the API reads back as the same asset", (text, network) => {
    const asset = parsed(text, network);
    expect(parseAssetText(apiAssetText(asset), network)).toEqual(asset);
  });
});
