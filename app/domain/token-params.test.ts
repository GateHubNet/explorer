import { classicAddressToXAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import { redirectToCanonical } from "../server/pair-route";
import { FEATURE_VARS, featuresOf, NO_FEATURES, type Features } from "../ui/features";
import { assetText } from "./asset";
import { parseTrail } from "./paging";
import { queryOf } from "./query-of";
import {
  LP_CURRENCY,
  TOKEN_KINDS,
  TOKEN_SEARCH_MAX,
  kindTabs,
  mptAvailableOf,
  parseTokenPageParams,
  parseTokenPath,
  parseTokensParams,
  tokenHoldersHref,
  tokenHref,
  tokenLink,
  tokenPageQuery,
  tokensHref,
  tokensQuery,
  type TokensParams,
} from "./token-params";

const XRPL = { native: "XRP" } as const;
const XAHAU = { native: "XAH" } as const;
/** USD's issuer in D6's examples, RLUSD's issuer, and an AMM's account (the issuer of its pool's LP token). */
const GH = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";
const RL = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";

/** The currencies D6's own tests pin for a path (data-api `token-param.spec.ts` and `currency-code.spec.ts` at the pin 2fb4183), as the ledger holds them. */
const RLUSD_HEX = "524C555344000000000000000000000000000000";
const RLUSD_LOWER_HEX = "726C757364000000000000000000000000000000";
const USD_STANDARD_HEX = "0000000000000000000000005553440000000000";
const LOWER_USD_STANDARD_HEX = "0000000000000000000000007573640000000000";
const XRP_STANDARD_HEX = "0000000000000000000000005852500000000000";
const XAH_STANDARD_HEX = "0000000000000000000000005841480000000000";
const MY_TOKEN_HEX = "4D5920544F4B454E000000000000000000000000";
const DEMURRAGE_HEX = "015841550000000041F78E0A28CBF19200000000";
const LP_HEX = `03A1F7${"0".repeat(34)}`;
/** The ledger's standard form of `U|D`: D6 reads it as that 3-character code, which `asset.ts` does not (it keeps the pipe out of a code). */
const PIPE_STANDARD_HEX = "000000000000000000000000557C440000000000";

const RLUSD = { currency: RLUSD_HEX, issuer: RL };
const USD = { currency: "USD", issuer: GH };

/** Every switch on, as a deployment where all of today's switches are, and the same with TOKENS alone off. */
const TOKENS_ON: Features = featuresOf(Object.fromEntries(FEATURE_VARS.map((name) => [name, "on"])));
const TOKENS_OFF: Features = { ...TOKENS_ON, tokens: false };

const tokens = (query: string, mptAvailable = false) => parseTokensParams(new URLSearchParams(query), { mptAvailable });
const page = (query: string) => parseTokenPageParams(new URLSearchParams(query));
/** The canonical URL of a query: the href of what it names. */
const tokensCanonical = (query: string, mptAvailable = false) => tokensHref("xrpl", tokens(query, mptAvailable));
/** The query of a URL after a URL parser has serialized it, as a loader sees `request.url`. */
const serialized = (href: string) => new URL(`https://h${href}`).search;
const queryOfHref = (href: string) => (href.includes("?") ? href.slice(href.indexOf("?")) : "");

describe("the tables", () => {
  it("has the kinds, issued first: E14's seam", () => {
    expect([...TOKEN_KINDS]).toEqual(["issued", "mpt"]);
    expect(TOKEN_SEARCH_MAX).toBe(64);
  });

  it("knows an LP token's currency as D6 does: 40 upper-case hex digits that start with 03", () => {
    expect([LP_CURRENCY.test(LP_HEX), LP_CURRENCY.test("USD"), LP_CURRENCY.test(LP_HEX.toLowerCase())]).toEqual([true, false, false]);
    expect([LP_CURRENCY.test(`04${"0".repeat(38)}`), LP_CURRENCY.test(`03${"0".repeat(37)}`), LP_CURRENCY.test(`03${"0".repeat(39)}`)]).toEqual([false, false, false]);
  });
});

describe("parseTokenPath: the currency each spelling is handed to the data API as (checkToken compares it strictly)", () => {
  // [the decoded path segment, the `asset.currency` it gives, the canonical segment]. The currency is D6's own form (`ledgerCurrencyOf`, token-param.spec.ts at the pin):
  // a standard 3-character code as 3 upper-case characters, whatever way it was spelled; any other code as 40 upper-case hex digits, a text code hex-encoded.
  it.each<[string, string, string]>([
    [`USD.${GH}`, "USD", `USD.${GH}`],
    [`usd.${GH}`, "USD", `USD.${GH}`],
    [`UsD.${GH}`, "USD", `USD.${GH}`],
    [`${USD_STANDARD_HEX}.${GH}`, "USD", `USD.${GH}`],
    [`${USD_STANDARD_HEX.toLowerCase()}.${GH}`, "USD", `USD.${GH}`],
    [`${LOWER_USD_STANDARD_HEX}.${GH}`, "USD", `USD.${GH}`],
    [`<3!.${GH}`, "<3!", `<3!.${GH}`],
    // a text code is its bytes, zero-padded, in upper case; its case is its own (`rlusd` is not `RLUSD`)
    [`RLUSD.${RL}`, RLUSD_HEX, `RLUSD.${RL}`],
    [`rlusd.${RL}`, RLUSD_LOWER_HEX, `rlusd.${RL}`],
    [`${RLUSD_HEX}.${RL}`, RLUSD_HEX, `RLUSD.${RL}`],
    [`${RLUSD_HEX.toLowerCase()}.${RL}`, RLUSD_HEX, `RLUSD.${RL}`],
    // the separators: `+` and `|` (a raw `+` of a query comes as a space)
    [`USD+${GH}`, "USD", `USD.${GH}`],
    [`USD|${GH}`, "USD", `USD.${GH}`],
    [`USD ${GH}`, "USD", `USD.${GH}`],
    [`usd+${GH}`, "USD", `USD.${GH}`],
    [`RLUSD+${RL}`, RLUSD_HEX, `RLUSD.${RL}`],
    [`${RLUSD_HEX.toLowerCase()}|${RL}`, RLUSD_HEX, `RLUSD.${RL}`],
    [`${RLUSD_HEX} ${RL}`, RLUSD_HEX, `RLUSD.${RL}`],
    [`${USD_STANDARD_HEX}+${GH}`, "USD", `USD.${GH}`],
    // a code that is no text a URL can hold is its hex, in the URL as in the API: a demurrage currency, a text with a space, a text with a separator
    [`${DEMURRAGE_HEX.toLowerCase()}.${GH}`, DEMURRAGE_HEX, `${DEMURRAGE_HEX}.${GH}`],
    [`${MY_TOKEN_HEX}.${GH}`, MY_TOKEN_HEX, `${MY_TOKEN_HEX}.${GH}`],
    [`412E422E43${"0".repeat(30)}.${GH}`, `412E422E43${"0".repeat(30)}`, `412E422E43${"0".repeat(30)}.${GH}`],
    // the shortest text code
    [`ABCD.${GH}`, `41424344${"0".repeat(32)}`, `ABCD.${GH}`],
  ])("%s is the currency %s", (text, currency, canonical) => {
    expect(parseTokenPath(XRPL, text)).toEqual({ kind: "token", asset: { currency, issuer: text.endsWith(RL) ? RL : GH }, canonical });
  });

  it("gives the spellings of one token one asset and one canonical segment", () => {
    const spellings = [`usd.${GH}`, `USD.${GH}`, `USD+${GH}`, `USD|${GH}`, `USD ${GH}`, `${USD_STANDARD_HEX}.${GH}`, `${LOWER_USD_STANDARD_HEX}.${GH}`];
    const results = spellings.map((text) => parseTokenPath(XRPL, text));
    expect(new Set(results.map((path) => JSON.stringify(path))).size).toBe(1);
    expect(results[0]).toEqual({ kind: "token", asset: USD, canonical: `USD.${GH}` });
    expect(parseTokenPath(XRPL, `${RLUSD_HEX.toLowerCase()}.${RL}`)).toMatchObject({ kind: "token", asset: RLUSD, canonical: `RLUSD.${RL}` });
    expect(parseTokenPath(XRPL, `RLUSD.${RL}`)).toMatchObject({ asset: RLUSD });
  });

  it("is a token on Xahau whose code is the other network's native: XRP is an issued currency there, and XAH is one on XRPL", () => {
    expect(parseTokenPath(XAHAU, `XRP.${GH}`)).toEqual({ kind: "token", asset: { currency: "XRP", issuer: GH }, canonical: `XRP.${GH}` });
    expect(parseTokenPath(XAHAU, `xrp+${GH}`)).toEqual({ kind: "token", asset: { currency: "XRP", issuer: GH }, canonical: `XRP.${GH}` });
    expect(parseTokenPath(XAHAU, `${XRP_STANDARD_HEX}.${GH}`)).toEqual({ kind: "token", asset: { currency: "XRP", issuer: GH }, canonical: `XRP.${GH}` });
    expect(parseTokenPath(XRPL, `XAH.${GH}`)).toEqual({ kind: "token", asset: { currency: "XAH", issuer: GH }, canonical: `XAH.${GH}` });
    expect(parseTokenPath(XRPL, `${XAH_STANDARD_HEX}.${GH}`)).toEqual({ kind: "token", asset: { currency: "XAH", issuer: GH }, canonical: `XAH.${GH}` });
    expect(parseTokenPath(XAHAU, `USD.${GH}`)).toEqual({ kind: "token", asset: USD, canonical: `USD.${GH}` });
  });

  it("is its own fixed point: the canonical segment reads as the same asset, and nothing is canonical twice", () => {
    for (const text of [`usd.${GH}`, `rlusd.${RL}`, `${RLUSD_HEX}+${RL}`, `${MY_TOKEN_HEX}.${GH}`, `${DEMURRAGE_HEX}|${GH}`, `<3!.${GH}`]) {
      const path = parseTokenPath(XRPL, text);
      if (path.kind !== "token") throw new Error(`${text} is no token`);
      expect(parseTokenPath(XRPL, path.canonical)).toEqual(path);
      expect(assetText(path.asset)).toBe(path.canonical);
    }
  });
});

describe("parseTokenPath: the native code, an AMM's LP token, and what is none", () => {
  it("is the native code for the network's own code alone, in any case", () => {
    expect([parseTokenPath(XRPL, "XRP"), parseTokenPath(XRPL, "xrp"), parseTokenPath(XRPL, "Xrp"), parseTokenPath(XAHAU, "XAH"), parseTokenPath(XAHAU, "xah")]).toEqual([
      { kind: "native" },
      { kind: "native" },
      { kind: "native" },
      { kind: "native" },
      { kind: "native" },
    ]);
  });

  it("is an LP token, with its pool's account, for the currency of an AMM's LP token in any case and with any separator", () => {
    expect(parseTokenPath(XRPL, `${LP_HEX}.${POOL}`)).toEqual({ kind: "lp", issuer: POOL });
    expect(parseTokenPath(XRPL, `${LP_HEX.toLowerCase()}.${POOL}`)).toEqual({ kind: "lp", issuer: POOL });
    expect(parseTokenPath(XRPL, `${LP_HEX}+${POOL}`)).toEqual({ kind: "lp", issuer: POOL });
    expect(parseTokenPath(XRPL, `${LP_HEX} ${POOL}`)).toEqual({ kind: "lp", issuer: POOL });
    expect(parseTokenPath(XAHAU, `${LP_HEX}|${POOL}`)).toEqual({ kind: "lp", issuer: POOL });
    expect(parseTokenPath(XRPL, `03${"AB".repeat(19)}.${POOL}`)).toEqual({ kind: "lp", issuer: POOL });
  });

  it("is none for a path that no token can be at (the review's junk, one by one)", () => {
    const wrongChecksum = `${GH.slice(0, -1)}${GH.endsWith("a") ? "b" : "a"}`;
    expect(wrongChecksum).not.toBe(GH);
    const junk: [string, string][] = [
      ["an X-address as the issuer", `USD.${classicAddressToXAddress(GH, false, false)}`],
      ["an X-address with a tag", `RLUSD.${classicAddressToXAddress(RL, 12, false)}`],
      ["an issuer whose checksum is wrong", `USD.${wrongChecksum}`],
      ["an LP token's pool whose checksum is wrong", `${LP_HEX}.${wrongChecksum}`],
      ["the native code with an issuer", `XRP.${GH}`],
      ["the native code with an issuer, in any case", `xrp+${GH}`],
      ["the native code's standard hex with an issuer", `${XRP_STANDARD_HEX}.${GH}`],
      ["a code alone", "USD"],
      ["a text code alone", "RLUSD"],
      ["an issuer alone", GH],
      ["the other network's native code alone", "XAH"],
      ["an empty string", ""],
      ["a lone `.`", "."],
      ["a lone `+`", "+"],
      ["a lone `|`", "|"],
      ["a lone space", " "],
      ["a separator and no code", `.${GH}`],
      ["a code and no issuer", "USD."],
      ["two separators", `USD.${GH}.x`],
      ["a trailing separator", `USD.${GH}.`],
      ["a code that holds a separator, as text", `A.B.C.${GH}`],
      ["a 41-digit hex currency", `${RLUSD_HEX}0.${RL}`],
      ["a 39-digit hex currency", `${"A".repeat(39)}.${RL}`],
      ["the all-zero hex", `${"0".repeat(40)}.${GH}`],
      ["a 3-character code outside the ledger's set", `U-D.${GH}`],
      ["a 2-character code", `US.${GH}`],
      ["a text code of 21 characters", `${"A".repeat(21)}.${RL}`],
      ["a text code with a control character", `AB\tCD.${RL}`],
      ["a text code that is not ASCII", `€€€€.${RL}`],
      ["an issuer in lower case", `USD.${GH.toLowerCase()}`],
      ["the segment as an escape: percent-escapes are the route's to decode", `USD%2B${GH}`],
      // D6 reads the ledger's standard form of `U|D` as that code and `asset.ts` keeps its hex: the answer's currency would not be the one asked for
      ["the standard form of a code with a pipe in it", `${PIPE_STANDARD_HEX}.${GH}`],
      ["the same in lower case", `${PIPE_STANDARD_HEX.toLowerCase()}+${GH}`],
      ["a code with a pipe in it", `U|D.${GH}`],
    ];
    for (const [what, text] of junk) expect(parseTokenPath(XRPL, text), what).toEqual({ kind: "none" });
  });

  it("is none on Xahau for what is none on XRPL, and for XAH with an issuer", () => {
    expect([parseTokenPath(XAHAU, `XAH.${GH}`), parseTokenPath(XAHAU, `${XAH_STANDARD_HEX}.${GH}`), parseTokenPath(XAHAU, "XRP"), parseTokenPath(XAHAU, "USD"), parseTokenPath(XAHAU, "")]).toEqual([
      { kind: "none" },
      { kind: "none" },
      { kind: "none" },
      { kind: "none" },
      { kind: "none" },
    ]);
  });
});

describe("tokenHref and tokenHoldersHref", () => {
  it("writes the token's page and its holders' page from the canonical segment", () => {
    expect(tokenHref("xrpl", RLUSD)).toBe(`/xrpl/token/RLUSD.${RL}`);
    expect(tokenHref("xahau", { currency: "XRP", issuer: GH })).toBe(`/xahau/token/XRP.${GH}`);
    expect(tokenHref("xrpl", USD)).toBe(`/xrpl/token/USD.${GH}`);
    expect(tokenHoldersHref("xrpl", RLUSD)).toBe(`/xrpl/token/RLUSD.${RL}/holders`);
    expect(tokenHoldersHref("xrpl", RLUSD, { marker: "M2", back: ["M1"] })).toBe(`/xrpl/token/RLUSD.${RL}/holders?marker=M2&back=M1`);
  });

  it("writes a hex currency as its 40 upper-case digits", () => {
    expect(tokenHref("xrpl", { currency: DEMURRAGE_HEX, issuer: GH })).toBe(`/xrpl/token/${DEMURRAGE_HEX}.${GH}`);
    expect(tokenHref("xrpl", { currency: MY_TOKEN_HEX, issuer: GH })).toBe(`/xrpl/token/${MY_TOKEN_HEX}.${GH}`);
    expect(tokenHref("xrpl", { currency: DEMURRAGE_HEX.toLowerCase(), issuer: GH })).toBe(`/xrpl/token/${DEMURRAGE_HEX}.${GH}`);
  });

  it("writes the trail only behind a marker, and the marker's pages in the order marker, back", () => {
    expect(tokenHref("xrpl", RLUSD, { back: [] })).toBe(`/xrpl/token/RLUSD.${RL}`);
    expect(tokenHref("xrpl", RLUSD, { back: ["M1"] })).toBe(`/xrpl/token/RLUSD.${RL}`);
    expect(tokenHref("xrpl", RLUSD, { marker: "M3", back: [] })).toBe(`/xrpl/token/RLUSD.${RL}?marker=M3`);
    expect(tokenHref("xrpl", RLUSD, { marker: "M3", back: ["M2", "M1"] })).toBe(`/xrpl/token/RLUSD.${RL}?marker=M3&back=M2.M1`);
    expect(tokenHoldersHref("xrpl", RLUSD, { marker: "a'b", back: ["x y"] })).toBe(`/xrpl/token/RLUSD.${RL}/holders?marker=a%27b&back=x%20y`);
  });

  it("escapes the segment for a path: a text code's own characters never end it", () => {
    expect(tokenHref("xrpl", { currency: `41234243${"0".repeat(32)}`, issuer: GH })).toBe(`/xrpl/token/A%23BC.${GH}`);
    const slash = parseTokenPath(XRPL, `A/B?.${GH}`);
    expect(slash.kind).toBe("token");
    if (slash.kind === "token") expect(tokenHref("xrpl", slash.asset)).toBe(`/xrpl/token/A%2FB%3F.${GH}`);
  });

  it("is the segment a loader reads back: every printable character of a text code, escaped and decoded, is the same token", () => {
    let tried = 0;
    for (let code = 0x21; code < 0x7f; code++) {
      const text = `A${String.fromCharCode(code)}BC`;
      const path = parseTokenPath(XRPL, `${text}.${RL}`);
      if (path.kind !== "token") continue;
      tried++;
      const href = tokenHref("xrpl", path.asset);
      const arrived = new URL(`https://h${href}`);
      // a URL parser leaves the path as it was written, so the loader's `url.pathname` is the canonical path
      expect(arrived.pathname, text).toBe(href);
      const segment = decodeURIComponent(arrived.pathname.split("/")[3]!);
      expect(segment, text).toBe(path.canonical);
      expect(parseTokenPath(XRPL, segment), text).toEqual(path);
    }
    expect(tried).toBe(94 - 3);
  });
});

describe("parseTokensParams and tokensHref: the canonical form of the list's query", () => {
  it.each([
    ["", "/xrpl/tokens"],
    ["kind=issued", "/xrpl/tokens"],
    ["kind=mpt", "/xrpl/tokens"],
    ["kind=MPT", "/xrpl/tokens"],
    ["kind=bogus&all=1", "/xrpl/tokens?all=1"],
    ["q=USD", "/xrpl/tokens?q=USD"],
    ["q=%20USD%20", "/xrpl/tokens?q=USD"],
    ["q=a%20b", "/xrpl/tokens?q=a%20b"],
    ["q=a+b", "/xrpl/tokens?q=a%20b"],
    ["q=a%26b%3Dc%23d%27e", "/xrpl/tokens?q=a%26b%3Dc%23d%27e"],
    ["q=", "/xrpl/tokens"],
    ["q=%20%20", "/xrpl/tokens"],
    ["q=a&q=b", "/xrpl/tokens?q=a"],
    ["q=&q=b", "/xrpl/tokens"],
    ["all=1", "/xrpl/tokens?all=1"],
    ["all=0", "/xrpl/tokens"],
    ["all=true", "/xrpl/tokens"],
    ["all=", "/xrpl/tokens"],
    ["all=1&all=0", "/xrpl/tokens?all=1"],
    ["all=0&all=1", "/xrpl/tokens"],
    ["all=1&q=USD", "/xrpl/tokens?q=USD&all=1"],
    ["marker=M1&all=1&q=a", "/xrpl/tokens?q=a&all=1&marker=M1"],
    ["back=M2.M1&marker=M3", "/xrpl/tokens?marker=M3&back=M2.M1"],
    ["marker=M3&back=M2.bad!", "/xrpl/tokens?marker=M3"],
    ["marker=M3&back=", "/xrpl/tokens?marker=M3"],
    ["back=M2", "/xrpl/tokens"],
    ["q=a&back=M2", "/xrpl/tokens?q=a"],
    ["x=1", "/xrpl/tokens"],
    ["x=1&q=b&period=7day&y=2", "/xrpl/tokens?q=b"],
    ["kind=issued&q=&all=0&back=M1&q=b&x=1", "/xrpl/tokens"],
  ])("%j is %s", (query, href) => {
    expect(tokensCanonical(query)).toBe(href);
  });

  it("returns the view a query names, with no q for an empty one and no back without a marker", () => {
    expect(tokens("kind=issued&q=&all=0&back=M1&q=b&x=1")).toEqual({ kind: "issued", all: false, back: [] });
    expect(tokens("")).toEqual({ kind: "issued", all: false, back: [] });
    expect(tokens("q=%20usd%20&all=1")).toEqual({ kind: "issued", q: "usd", all: true, back: [] });
    expect(tokens("marker=M3&back=M2.M1&q=a")).toEqual({ kind: "issued", q: "a", all: false, marker: "M3", back: ["M2", "M1"] });
  });

  it("reads kind=mpt as mpt only while E14 has made it a view, and as issued otherwise", () => {
    expect(tokens("kind=mpt").kind).toBe("issued");
    expect(tokens("kind=mpt", false).kind).toBe("issued");
    expect(tokens("kind=mpt", true).kind).toBe("mpt");
    expect(tokens("kind=issued", true).kind).toBe("issued");
    expect(tokens("kind=Mpt", true).kind).toBe("issued");
    expect(tokens("kind=mpt&kind=issued", true).kind).toBe("mpt");
    expect(tokens("kind=issued&kind=mpt", true).kind).toBe("issued");
    expect(tokensCanonical("kind=mpt&q=a&all=1&marker=M1&back=M0", true)).toBe("/xrpl/tokens?kind=mpt&q=a&all=1&marker=M1&back=M0");
    expect(tokensCanonical("kind=mpt", true)).toBe("/xrpl/tokens?kind=mpt");
  });

  it("keeps a q of any length: the loader checks it against TOKEN_SEARCH_MAX", () => {
    const sixtyFour = "a".repeat(TOKEN_SEARCH_MAX);
    const sixtyFive = "a".repeat(TOKEN_SEARCH_MAX + 1);
    expect(tokens(`q=${sixtyFour}`).q).toBe(sixtyFour);
    expect(tokens(`q=${sixtyFive}`).q).toBe(sixtyFive);
    expect(tokens(`q=${"a".repeat(5000)}`).q).toHaveLength(5000);
    expect(tokensCanonical(`q=${sixtyFive}`)).toBe(`/xrpl/tokens?q=${sixtyFive}`);
  });

  it("returns the marker as it was given, whatever it is: the loader checks isMarker and answers 404", () => {
    expect(tokens("marker=a%27b").marker).toBe("a'b");
    expect(tokens("marker=").marker).toBe("");
    expect(tokens("marker=M1&marker=M2").marker).toBe("M1");
    expect(tokensCanonical("marker=")).toBe("/xrpl/tokens?marker=");
  });

  it("gives a trail only behind a marker, and only one that parseTrail accepts", () => {
    expect(tokens("marker=M3&back=M2.M1").back).toEqual(["M2", "M1"]);
    expect(tokens("marker=M3&back=M2.M1").back).toEqual(parseTrail("M2.M1"));
    expect(tokens("back=M2.M1").back).toEqual([]);
    const eleven = Array.from({ length: 11 }, (_, at) => `M${at}`).join(".");
    expect(tokens(`marker=M3&back=${eleven}`).back).toEqual([]);
    expect(tokens(`marker=M3&back=${eleven.split(".").slice(0, 10).join(".")}`).back).toHaveLength(10);
  });

  it("does not hold the trail it is given, and does not change it", () => {
    const back = ["M2", "M1"];
    expect(tokensHref("xrpl", { marker: "M3", back })).toBe("/xrpl/tokens?marker=M3&back=M2.M1");
    expect(back).toEqual(["M2", "M1"]);
  });
});

describe("tokensQuery and tokensHref: what they write", () => {
  const defaults: TokensParams = { kind: "issued", all: false, back: [] };

  it("writes kind, q, all, marker and back, in that order, with its ? and the empty text when there is no query", () => {
    expect(tokensQuery(defaults)).toBe("");
    expect(tokensQuery({ ...defaults, q: "USD" })).toBe("?q=USD");
    expect(tokensQuery({ ...defaults, all: true })).toBe("?all=1");
    expect(tokensQuery({ kind: "mpt", q: "a", all: true, marker: "M3", back: ["M2", "M1"] })).toBe("?kind=mpt&q=a&all=1&marker=M3&back=M2.M1");
    expect(tokensQuery({ ...defaults, q: "  ", back: ["M1"] })).toBe("");
    expect(tokensQuery({ ...defaults, q: " a b " })).toBe("?q=a%20b");
    expect(tokensQuery({ ...defaults, marker: "a'b", back: ["x'y"] })).toBe("?marker=a%27b&back=x%27y");
  });

  it("is the list's path, then the query, and the path alone for no query", () => {
    expect(tokensHref("xrpl")).toBe("/xrpl/tokens");
    expect(tokensHref("xahau")).toBe("/xahau/tokens");
    expect(tokensHref("xrpl", {})).toBe("/xrpl/tokens");
    expect(tokensHref("xrpl", { kind: "issued", all: false, back: [], q: "", marker: undefined })).toBe("/xrpl/tokens");
    expect(tokensHref("xrpl", { all: true, q: "USD" })).toBe("/xrpl/tokens?q=USD&all=1");
    expect(tokensHref("xrpl", { kind: "mpt" })).toBe("/xrpl/tokens?kind=mpt");
    expect(tokensHref("xrpl", { marker: "M2", back: ["M1"], q: "a" })).toBe("/xrpl/tokens?q=a&marker=M2&back=M1");
    expect(tokensHref("xrpl", { back: ["M1"] })).toBe("/xrpl/tokens");
    expect(tokensHref("xrpl", { kind: undefined, all: undefined, back: undefined })).toBe("/xrpl/tokens");
  });

  it("writes what a parse names, with the query a redirect compares", () => {
    for (const query of ["", "q=USD&all=1", "kind=mpt&q=a&marker=M1&back=M0", "x=1&q=%20b%20"]) {
      const parsed = tokens(query, true);
      expect(tokensHref("xrpl", parsed)).toBe(`/xrpl/tokens${tokensQuery(parsed)}`);
    }
  });
});

describe("parseTokenPageParams and tokenPageQuery: the token page's trail and the holders'", () => {
  it.each([
    ["", ""],
    ["marker=M1", "?marker=M1"],
    ["marker=M3&back=M2.M1", "?marker=M3&back=M2.M1"],
    ["back=M2.M1&marker=M3", "?marker=M3&back=M2.M1"],
    ["back=M2", ""],
    ["marker=M3&back=M2.bad!", "?marker=M3"],
    ["marker=M1&marker=M2", "?marker=M1"],
    ["q=USD&all=1&kind=mpt&x=1", ""],
    ["marker=a%27b", "?marker=a%27b"],
    ["marker=", "?marker="],
  ])("%j is %j", (query, canonical) => {
    expect(tokenPageQuery(page(query))).toBe(canonical);
  });

  it("returns the marker as it was given and the trail behind it", () => {
    expect(page("")).toEqual({ back: [] });
    expect(page("marker=M3&back=M2.M1")).toEqual({ marker: "M3", back: ["M2", "M1"] });
    expect(page("back=M2")).toEqual({ back: [] });
    expect(page("marker=").marker).toBe("");
  });
});

describe("the loop a loader makes: a canonical URL is what the request says once it is serialized, so a redirect to it ends", () => {
  /** A small seeded generator, so that a failure can be repeated. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  const characters = [..."'\"<> #%&+=?/\\^`{|}~!$()*,:;@[]-_.é\u{1F600}"];
  for (let code = 0x20; code < 0x7f; code++) characters.push(String.fromCharCode(code));

  /** What a loader does with a request for `path` with `request` as its query: compare the canonical path and query with the request's. */
  function loop(path: string, canonicalPath: string, canonicalSearch: string, request: string, again: (query: string) => string): void {
    const href = `${canonicalPath}${canonicalSearch}`;
    const arrived = new URL(`https://h${href}`);
    expect(arrived.pathname).toBe(canonicalPath);
    expect(queryOf(arrived.href)).toBe(canonicalSearch.slice(1));
    expect(serialized(href)).toBe(queryOfHref(href));
    expect(redirectToCanonical({ path: arrived.pathname, search: queryOf(arrived.href) }, { path: canonicalPath, search: canonicalSearch })).toBeNull();
    expect(again(queryOf(arrived.href))).toBe(href);
    const asked = new URL(`https://h${path}${request === "" ? "" : `?${request}`}`);
    const answer = redirectToCanonical({ path: asked.pathname, search: queryOf(asked.href) }, { path: canonicalPath, search: canonicalSearch });
    if (answer !== null) {
      expect(answer.status).toBe(302);
      expect(answer.headers.get("Location")).toBe(href);
    }
  }

  function checkTokens(query: string): void {
    const parsed = tokens(query, true);
    loop("/xrpl/tokens", tokensHref("xrpl"), tokensQuery(parsed), query, (again) => tokensCanonical(again, true));
  }
  function checkPage(query: string): void {
    const parsed = page(query);
    const path = tokenHref("xrpl", RLUSD);
    loop(path, path, tokenPageQuery(parsed), query, (again) => tokenHref("xrpl", RLUSD, page(again)));
  }

  it("holds for any character of a search, a marker or a trail", () => {
    for (const character of characters) {
      const value = encodeURIComponent(`a${character}b`);
      checkTokens(`q=${value}`);
      checkTokens(`q=${value}&all=1&marker=M3&back=${value}.M1`);
      checkTokens(`marker=${value}`);
      checkPage(`marker=${value}`);
      checkPage(`marker=M3&back=M2.${value}`);
    }
  });

  it("holds for a raw query, where the characters come unescaped and a + is a space", () => {
    for (const query of ["q=a+b", "q=a'b", "marker=a'b&back=c'd", "q=%zz", "marker=%E0%A4%A", "q=a%2Bb", "marker=ab%3d", "kind=%6Dpt", "all=%31"]) {
      checkTokens(query);
      checkPage(query);
    }
  });

  it("holds for random queries of the known parameters, unknown ones and repeats", () => {
    const next = lcg(20261030);
    const keys = ["kind", "q", "all", "marker", "back", "x", "_routes"];
    const values = ["", "1", "0", "yes", "mpt", "issued", "USD", "usd rvYAf", "a b", "M1", "M2.M1", "a'b", "a%27b", "%20", "%", "ab%3D%3D", "é", "M0.M1.M2.M3.M4.M5.M6.M7.M8.M9.M10"];
    const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
    for (let round = 0; round < 400; round++) {
      const pairs: string[] = [];
      for (let count = Math.floor(next() * 7); count > 0; count--) pairs.push(`${pick(keys)}=${pick(values)}`);
      const query = pairs.join("&");
      checkTokens(query);
      checkPage(query);
    }
  });
});

describe("tokenLink: where a token's code leads", () => {
  const LP = { currency: LP_HEX, issuer: POOL };

  it("is the token's page while TOKENS is on", () => {
    expect(tokenLink("xrpl", RLUSD, TOKENS_ON)).toBe(`/xrpl/token/RLUSD.${RL}`);
    expect(tokenLink("xrpl", USD, TOKENS_ON)).toBe(`/xrpl/token/USD.${GH}`);
    expect(tokenLink("xrpl", { currency: DEMURRAGE_HEX, issuer: GH }, TOKENS_ON)).toBe(`/xrpl/token/${DEMURRAGE_HEX}.${GH}`);
    expect(tokenLink("xahau", { currency: "XRP", issuer: GH }, TOKENS_ON)).toBe(`/xahau/token/XRP.${GH}`);
    expect(tokenLink("xrpl", RLUSD, { ...NO_FEATURES, tokens: true })).toBe(`/xrpl/token/RLUSD.${RL}`);
  });

  it("is nothing while TOKENS is off, whatever else is on: the code stays text", () => {
    expect([tokenLink("xrpl", RLUSD, NO_FEATURES), tokenLink("xrpl", RLUSD, TOKENS_OFF), tokenLink("xrpl", RLUSD, { ...NO_FEATURES, ammPages: true })]).toEqual([null, null, null]);
    expect(tokenLink("xahau", USD, TOKENS_OFF)).toBeNull();
  });

  it("is nothing for the native currency, which has no page and no issuer", () => {
    expect([tokenLink("xrpl", { currency: "XRP" }, TOKENS_OFF), tokenLink("xrpl", { currency: "XRP" }, TOKENS_ON), tokenLink("xahau", { currency: "XAH" }, TOKENS_ON)]).toEqual([null, null, null]);
    expect(tokenLink("xrpl", { currency: "XRP", issuer: "" }, TOKENS_ON)).toBeNull();
    // the native code with an issuer is no token of the ledger
    expect(tokenLink("xrpl", { currency: "XRP", issuer: GH }, TOKENS_ON)).toBeNull();
    expect(tokenLink("xahau", { currency: "XAH", issuer: GH }, TOKENS_ON)).toBeNull();
  });

  it("is an LP token's pool, with TOKENS on or off", () => {
    expect(tokenLink("xrpl", LP, { ...NO_FEATURES, ammPages: true })).toBe(`/xrpl/amm/${POOL}`);
    expect(tokenLink("xrpl", LP, { ...TOKENS_ON, ammPages: true })).toBe(`/xrpl/amm/${POOL}`);
    expect(tokenLink("xrpl", LP, { ...TOKENS_OFF, ammPages: true })).toBe(`/xrpl/amm/${POOL}`);
  });

  it("is the pool's account page for an LP token while AMM_PAGES is off: poolLink's rule", () => {
    expect(tokenLink("xrpl", LP, { ...TOKENS_ON, ammPages: false })).toBe(`/xrpl/account/${POOL}`);
    expect(tokenLink("xrpl", LP, NO_FEATURES)).toBe(`/xrpl/account/${POOL}`);
  });

  it("is nothing for a currency its own link would not read back as: a lower-case `usd` is not USD, a pipe is no part of a code", () => {
    expect(tokenLink("xrpl", { currency: "usd", issuer: GH }, TOKENS_ON)).toBeNull();
    expect(tokenLink("xrpl", { currency: "U|D", issuer: GH }, TOKENS_ON)).toBeNull();
    expect(tokenLink("xrpl", { currency: PIPE_STANDARD_HEX, issuer: GH }, TOKENS_ON)).toBeNull();
    expect(tokenLink("xrpl", { currency: LP_HEX.toLowerCase(), issuer: POOL }, { ...TOKENS_ON, ammPages: true })).toBeNull();
    expect(tokenLink("xrpl", { currency: RLUSD_HEX.toLowerCase(), issuer: RL }, TOKENS_ON)).toBeNull();
    expect(tokenLink("xrpl", { currency: "RLUSD", issuer: RL }, TOKENS_ON)).toBeNull();
    expect(tokenLink("xrpl", { currency: `${"0".repeat(40)}`, issuer: GH }, TOKENS_ON)).toBeNull();
  });

  it("is nothing for an issuer that is no classic address", () => {
    const wrongChecksum = `${GH.slice(0, -1)}${GH.endsWith("a") ? "b" : "a"}`;
    for (const issuer of [wrongChecksum, classicAddressToXAddress(GH, false, false), "r", "x".repeat(34)]) {
      expect(tokenLink("xrpl", { currency: "USD", issuer }, TOKENS_ON), issuer).toBeNull();
      expect(tokenLink("xrpl", { currency: LP_HEX, issuer }, { ...TOKENS_ON, ammPages: true }), issuer).toBeNull();
    }
  });

  it("is a link a loader reads back as the same token", () => {
    for (const asset of [USD, RLUSD, { currency: DEMURRAGE_HEX, issuer: GH }, { currency: MY_TOKEN_HEX, issuer: RL }, { currency: "<3!", issuer: GH }]) {
      const href = tokenLink("xrpl", asset, TOKENS_ON)!;
      const segment = decodeURIComponent(href.split("/")[3]!);
      expect(parseTokenPath(XRPL, segment)).toMatchObject({ kind: "token", asset });
    }
  });
});

describe("mptAvailableOf: E14's seam", () => {
  it("is false for both networks and every set of switches, until E14 makes it features.mpt && net.hasMpt", () => {
    for (const net of [{ id: "xrpl" }, { id: "xahau" }]) {
      for (const features of [NO_FEATURES, TOKENS_ON, TOKENS_OFF]) expect(mptAvailableOf(net, features)).toBe(false);
    }
  });
});

describe("kindTabs", () => {
  it("is Issued tokens, current, and MPT disabled with the tag `soon` where MPT may come", () => {
    expect(kindTabs({ id: "xrpl" }, "issued", false)).toEqual([
      { label: "Issued tokens", href: "/xrpl/tokens", current: true },
      { label: "MPT", href: "/xrpl/tokens?kind=mpt", current: false, disabled: { tag: "soon" } },
    ]);
  });

  it("is MPT disabled with its reason on Xahau, whose ledger has no MPT", () => {
    expect(kindTabs({ id: "xahau" }, "issued", false)).toEqual([
      { label: "Issued tokens", href: "/xahau/tokens", current: true },
      { label: "MPT", href: "/xahau/tokens?kind=mpt", current: false, disabled: { note: "MPT isn't enabled on Xahau." } },
    ]);
  });

  it("is two links once MPT is available, the current one marked", () => {
    expect(kindTabs({ id: "xrpl" }, "issued", true)).toEqual([
      { label: "Issued tokens", href: "/xrpl/tokens", current: true },
      { label: "MPT", href: "/xrpl/tokens?kind=mpt", current: false },
    ]);
    expect(kindTabs({ id: "xrpl" }, "mpt", true)).toEqual([
      { label: "Issued tokens", href: "/xrpl/tokens", current: false },
      { label: "MPT", href: "/xrpl/tokens?kind=mpt", current: true },
    ]);
  });

  it("links the tabs to the canonical list URLs: the first drops every filter", () => {
    const [issued, mpt] = kindTabs({ id: "xrpl" }, "mpt", true);
    expect(issued!.href).toBe(tokensHref("xrpl"));
    expect(mpt!.href).toBe(tokensHref("xrpl", { kind: "mpt" }));
    expect(tokensCanonical("kind=mpt", true)).toBe(mpt!.href);
  });
});
