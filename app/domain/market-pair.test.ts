import { encodeAccountID } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import { parsePairPath } from "../server/pair-route";
import { assetText, sameAsset, type Asset, type NativeCode } from "./asset";
import { marketHref, naturalOrientation, QUOTE_RANK } from "./market-pair";

const GH = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const RL = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";
const LP_POOL = "rGuYK1v7kyrKEa86wPN2M9CHpT9LiWFr5m";
/** Two issuers that sort one way as written and the other lower-cased: "rP…" is before "ra…" in ASCII, "ra…" before "rp…". */
const UPPER_FIRST = "rPprykcTM16XDFtK8N1FHY9SfQ3skk6XP";
const LOWER_FIRST = "raHgU3KRBN6XYbEhi5JyJELSHtstSwaiz";
/** A valid classic address made from a byte. */
const issuerOf = (byte: number) => encodeAccountID(new Uint8Array(20).fill(byte));

/** The 40 hex digits of a text code: its bytes, left-aligned. */
const hexOf = (text: string) =>
  [...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase().padEnd(40, "0");

const XRP: Asset = { currency: "XRP" };
const XAH: Asset = { currency: "XAH" };
const USD: Asset = { currency: "USD", issuer: GH };
const EUR: Asset = { currency: "EUR", issuer: issuerOf(1) };
const BTC: Asset = { currency: "BTC", issuer: issuerOf(2) };
const ETH: Asset = { currency: "ETH", issuer: issuerOf(3) };
const RLUSD: Asset = { currency: hexOf("RLUSD"), issuer: RL };
const LIONS: Asset = { currency: hexOf("LIONS"), issuer: LIONS_ISSUER };
const EVR: Asset = { currency: "EVR", issuer: issuerOf(4) };
const LP: Asset = { currency: "03F5BC4D66B44AEAD668A84F094E08C8C13F5EE2", issuer: LP_POOL };
const ODD_CODE: Asset = { currency: hexOf("A#BC"), issuer: RL };

const XRPL = { id: "xrpl", native: "XRP" } as const;
const XAHAU = { id: "xahau", native: "XAH" } as const;

/** The natural orientation of the pair as asked, by the assets' texts. */
function natural(a: Asset, b: Asset, native: NativeCode = "XRP") {
  const { base, counter, inverted } = naturalOrientation(a, b, native);
  return { pair: `${assetText(base)}/${assetText(counter)}`, inverted };
}

describe("QUOTE_RANK", () => {
  it("ranks the quote currencies 1 to 14, best first, and leaves 15 to the native asset", () => {
    expect(QUOTE_RANK).toEqual(["USD", "EUR", "GBP", "JPY", "CNY", "AUD", "CAD", "CHF", "KRW", "RLUSD", "USDC", "USDT", "BTC", "ETH"]);
  });
});

describe("naturalOrientation: the pair as people read it", () => {
  it.each([
    ["XRP/USD", XRP, USD, "XRP/USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq"],
    ["XRP/RLUSD", XRP, RLUSD, `XRP/RLUSD.${RL}`],
    ["BTC/USD", BTC, USD, `BTC.${BTC.issuer}/USD.${GH}`],
    ["EUR/USD", EUR, USD, `EUR.${EUR.issuer}/USD.${GH}`],
    ["ETH/BTC", ETH, BTC, `ETH.${ETH.issuer}/BTC.${BTC.issuer}`],
    ["LIONS/XRP", LIONS, XRP, `LIONS.${LIONS_ISSUER}/XRP`],
  ])("gives %s, asked either way round", (_name, base, counter, text) => {
    expect(natural(base, counter)).toEqual({ pair: text, inverted: false });
    expect(natural(counter, base)).toEqual({ pair: text, inverted: true });
  });

  it("says inverted when the pair asked for is the reverse of the natural one", () => {
    expect(naturalOrientation(USD, XRP, "XRP")).toEqual({ base: XRP, counter: USD, inverted: true });
    expect(naturalOrientation(XRP, USD, "XRP")).toEqual({ base: XRP, counter: USD, inverted: false });
  });

  it("gives EVR/XAH and XAH/USD on Xahau", () => {
    expect(natural(EVR, XAH, "XAH")).toEqual({ pair: `EVR.${EVR.issuer}/XAH`, inverted: false });
    expect(natural(XAH, EVR, "XAH")).toEqual({ pair: `EVR.${EVR.issuer}/XAH`, inverted: true });
    expect(natural(XAH, USD, "XAH")).toEqual({ pair: `XAH/USD.${GH}`, inverted: false });
    expect(natural(USD, XAH, "XAH")).toEqual({ pair: `XAH/USD.${GH}`, inverted: true });
  });

  it("puts an LP token against the native asset with the native asset as the counter", () => {
    expect(natural(LP, XRP)).toEqual({ pair: `${LP.currency}.${LP_POOL}/XRP`, inverted: false });
    expect(natural(XRP, LP)).toEqual({ pair: `${LP.currency}.${LP_POOL}/XRP`, inverted: true });
  });

  it("ranks the quote currencies against each other, the lower rank being the counter", () => {
    expect(natural(RLUSD, USD).pair).toBe(`RLUSD.${RL}/USD.${GH}`);
    expect(natural(BTC, ETH).pair).toBe(`ETH.${ETH.issuer}/BTC.${BTC.issuer}`);
    const USDC: Asset = { currency: "USDC", issuer: issuerOf(5) };
    const USDT: Asset = { currency: "USDT", issuer: issuerOf(6) };
    expect(natural(USDC, USDT).pair).toBe(`USDT.${USDT.issuer}/USDC.${USDC.issuer}`);
    expect(natural(EUR, RLUSD).pair).toBe(`RLUSD.${RL}/EUR.${EUR.issuer}`);
  });

  it("ranks a ranked side above an unranked one", () => {
    const SOLO: Asset = { currency: hexOf("SOLO"), issuer: issuerOf(7) };
    expect(natural(USD, SOLO).pair).toBe(`SOLO.${SOLO.issuer}/USD.${GH}`);
    expect(natural(SOLO, XRP).pair).toBe(`SOLO.${SOLO.issuer}/XRP`);
    expect(natural(LP, USD).pair).toBe(`${LP.currency}.${LP_POOL}/USD.${GH}`);
  });

  it("ranks by the display code, so the hex of a text code or of the standard form ranks as its code", () => {
    // `RLUSD` as the API's 40 hex digits (what a stored row holds), USD in the ledger's standard form
    const standardUsd: Asset = { currency: "0000000000000000000000005553440000000000", issuer: GH };
    expect(natural(XRP, standardUsd)).toEqual({ pair: `XRP/${assetText(standardUsd)}`, inverted: false });
    expect(natural(RLUSD, standardUsd).pair).toBe(`RLUSD.${RL}/USD.${GH}`);
    expect(natural(standardUsd, XRP).inverted).toBe(true);
  });

  it("does not rank a text code by its letters in another case: `usdc` is not `USDC`", () => {
    const lower: Asset = { currency: hexOf("usdc"), issuer: issuerOf(8) };
    expect(natural(lower, XRP)).toEqual({ pair: `usdc.${lower.issuer}/XRP`, inverted: false });
    expect(natural(XRP, lower).inverted).toBe(true);
  });

  it("ranks an issued XAH on XRPL, and an issued XRP on Xahau, as unranked, not as the native asset", () => {
    const issuedXah: Asset = { currency: "XAH", issuer: issuerOf(9) };
    const issuedXrp: Asset = { currency: "XRP", issuer: issuerOf(9) };
    expect(natural(issuedXah, XRP, "XRP")).toEqual({ pair: `XAH.${issuedXah.issuer}/XRP`, inverted: false });
    expect(natural(XRP, issuedXah, "XRP").inverted).toBe(true);
    expect(natural(issuedXah, USD, "XRP").pair).toBe(`XAH.${issuedXah.issuer}/USD.${GH}`);
    expect(natural(issuedXrp, XAH, "XAH")).toEqual({ pair: `XRP.${issuedXrp.issuer}/XAH`, inverted: false });
    // two unranked: the display code that sorts first is the base
    expect(natural(issuedXah, LIONS, "XRP").pair).toBe(`LIONS.${LIONS_ISSUER}/XAH.${issuedXah.issuer}`);
  });

  it("makes the base of two issuers of one quote code the one whose lower-cased issuer sorts first", () => {
    const upperFirst: Asset = { currency: "USD", issuer: UPPER_FIRST };
    const lowerFirst: Asset = { currency: "USD", issuer: LOWER_FIRST };
    // As written "rP…" is before "ra…"; lower-cased "ra…" is before "rp…", and that is the rule.
    expect(UPPER_FIRST < LOWER_FIRST).toBe(true);
    expect(natural(upperFirst, lowerFirst)).toEqual({ pair: `USD.${LOWER_FIRST}/USD.${UPPER_FIRST}`, inverted: true });
    expect(natural(lowerFirst, upperFirst)).toEqual({ pair: `USD.${LOWER_FIRST}/USD.${UPPER_FIRST}`, inverted: false });
  });

  it("makes the base of two unranked codes the one whose lower-cased display code sorts first", () => {
    const zebra: Asset = { currency: hexOf("Zebra"), issuer: issuerOf(10) };
    const apple: Asset = { currency: hexOf("apple"), issuer: issuerOf(11) };
    // As written "Zebra" is before "apple"; lower-cased "apple" is first.
    expect("Zebra" < "apple").toBe(true);
    expect(natural(zebra, apple)).toEqual({ pair: `apple.${apple.issuer}/Zebra.${zebra.issuer}`, inverted: true });
    expect(natural(apple, zebra)).toEqual({ pair: `apple.${apple.issuer}/Zebra.${zebra.issuer}`, inverted: false });
    expect(natural(LIONS, { currency: hexOf("SOLO"), issuer: issuerOf(12) }).inverted).toBe(false);
  });

  it("orders the same display code by issuer, then by the held currency", () => {
    // Two hex codes that both show as "AABBCCDD…".
    const one: Asset = { currency: "AABBCCDD01000000000000000000000000000000", issuer: UPPER_FIRST };
    const two: Asset = { currency: "AABBCCDD02000000000000000000000000000000", issuer: LOWER_FIRST };
    // The issuer decides, though `one` has the currency that sorts first: lower-cased "ra…" is before "rp…".
    expect(natural(one, two)).toEqual({ pair: `${assetText(two)}/${assetText(one)}`, inverted: true });
    expect(natural(two, one).inverted).toBe(false);
    // With one issuer, the held currency decides.
    const sameIssuer: Asset = { currency: two.currency, issuer: UPPER_FIRST };
    expect(natural(sameIssuer, one)).toEqual({ pair: `${assetText(one)}/${assetText(sameIssuer)}`, inverted: true });
    expect(natural(one, sameIssuer).inverted).toBe(false);
  });

  it("takes only the network's native code, without an issuer, for the native asset", () => {
    // Not a pair the explorer links to, but the rank must not be given to whatever has no issuer.
    const other: Asset = { currency: "AAA" };
    expect(natural(other, LIONS).pair).toBe(`AAA/LIONS.${LIONS_ISSUER}`);
    expect(natural(LIONS, other).inverted).toBe(true);
  });

  it("keeps the order asked for when both sides are one asset", () => {
    expect(naturalOrientation(USD, { ...USD }, "XRP")).toEqual({ base: USD, counter: USD, inverted: false });
  });

  it("gives the same pair whichever way round it is asked, with only `inverted` turning", () => {
    const assets = [XRP, XAH, USD, EUR, BTC, ETH, RLUSD, LIONS, EVR, LP, ODD_CODE];
    for (const a of assets) {
      for (const b of assets) {
        if (sameAsset(a, b)) continue;
        const ab = naturalOrientation(a, b, "XRP");
        const ba = naturalOrientation(b, a, "XRP");
        expect(ab.base).toBe(ba.base);
        expect(ab.counter).toBe(ba.counter);
        expect(ab.inverted).toBe(!ba.inverted);
        expect(ab.inverted).toBe(!sameAsset(ab.base, a));
      }
    }
  });
});

describe("marketHref: the canonical link to a pair", () => {
  it("writes each side as its URL form, base first", () => {
    expect(marketHref("xrpl", XRP, RLUSD)).toBe(`/xrpl/markets/XRP/RLUSD.${RL}`);
    expect(marketHref("xrpl", XRP, RLUSD)).toBe("/xrpl/markets/XRP/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De");
    expect(marketHref("xahau", EVR, XAH)).toBe(`/xahau/markets/EVR.${EVR.issuer}/XAH`);
  });

  it("writes the inverted pair as it is asked: it is a page of its own", () => {
    expect(marketHref("xrpl", USD, XRP)).toBe(`/xrpl/markets/USD.${GH}/XRP`);
  });

  it("appends the query of the params", () => {
    expect(marketHref("xrpl", XRP, RLUSD, { interval: "4h", trades: "amm" })).toBe(`/xrpl/markets/XRP/RLUSD.${RL}?interval=4h&trades=amm`);
    expect(marketHref("xrpl", XRP, RLUSD, { marker: "M3", back: ["M2", "M1"] })).toBe(`/xrpl/markets/XRP/RLUSD.${RL}?marker=M3&back=M2.M1`);
    expect(marketHref("xrpl", XRP, RLUSD, { interval: "1h", trades: null })).toBe(`/xrpl/markets/XRP/RLUSD.${RL}`);
    expect(marketHref("xrpl", XRP, RLUSD, {})).toBe(`/xrpl/markets/XRP/RLUSD.${RL}`);
  });

  it("reads an absent marker as the first page", () => {
    expect(marketHref("xrpl", XRP, USD, { back: [] })).toBe(`/xrpl/markets/XRP/USD.${GH}`);
  });

  it("escapes a character a path cannot hold as it is: a text code `A#BC` is written A%23BC", () => {
    expect(marketHref("xrpl", ODD_CODE, XRP)).toBe(`/xrpl/markets/A%23BC.${RL}/XRP`);
    const percent: Asset = { currency: hexOf("A%BC"), issuer: RL };
    expect(marketHref("xrpl", percent, XRP)).toBe(`/xrpl/markets/A%25BC.${RL}/XRP`);
    const slash: Asset = { currency: hexOf("A/BC"), issuer: RL };
    expect(marketHref("xrpl", slash, XRP)).toBe(`/xrpl/markets/A%2FBC.${RL}/XRP`);
  });

  it("writes an LP token's hex in upper case", () => {
    expect(marketHref("xrpl", LP, XRP)).toBe(`/xrpl/markets/${LP.currency}.${LP_POOL}/XRP`);
  });
});

describe("marketHref and parsePairPath: the round trip", () => {
  const pairs: [string, Asset, Asset, typeof XRPL | typeof XAHAU][] = [
    ["XRP/USD", XRP, USD, XRPL],
    ["USD/XRP", USD, XRP, XRPL],
    ["XRP/RLUSD", XRP, RLUSD, XRPL],
    ["RLUSD/XRP", RLUSD, XRP, XRPL],
    ["BTC/USD", BTC, USD, XRPL],
    ["EUR/USD", EUR, USD, XRPL],
    ["ETH/BTC", ETH, BTC, XRPL],
    ["LIONS/XRP", LIONS, XRP, XRPL],
    ["LP/XRP", LP, XRP, XRPL],
    ["A#BC/XRP", ODD_CODE, XRP, XRPL],
    ["EVR/XAH", EVR, XAH, XAHAU],
    ["XAH/USD", XAH, USD, XAHAU],
    ["issued XAH/XRP on XRPL", { currency: "XAH", issuer: GH }, XRP, XRPL],
    ["issued XRP/XAH on Xahau", { currency: "XRP", issuer: GH }, XAH, XAHAU],
  ];

  it.each(pairs)("reads the link to %s as the same assets, at its own path", (_name, a, b, net) => {
    const href = marketHref(net.id, a, b);
    const parsed = parsePairPath(net, href);
    expect(parsed.kind).toBe("pair");
    if (parsed.kind !== "pair") return;
    expect(parsed.base).toEqual(a);
    expect(parsed.counter).toEqual(b);
    expect(parsed.canonicalPath).toBe(href);
  });
});
