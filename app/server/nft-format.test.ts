import { describe, expect, it } from "vitest";

import { staticClosure } from "../../test/support/value-imports";
import { convertedOf, counted, DASH, plain, queryPairsOf, salesCount, sharePercentTenth } from "./nft-format";

describe("queryPairsOf", () => {
  it("reads the query of a link back as [name, value] pairs, in the link's order", () => {
    expect(queryPairsOf("/xrpl/nfts?period=7day&sort=supply&order=asc")).toEqual([
      ["period", "7day"],
      ["sort", "supply"],
      ["order", "asc"],
    ]);
    expect(queryPairsOf(`/xrpl/nfts/r4PP7gwuVfxzLPWFiJXjLUtvzA7F97CzT3/10?measure=avg&tab=nfts`)).toEqual([
      ["measure", "avg"],
      ["tab", "nfts"],
    ]);
  });

  it("is empty for a link with no query, and for one with an empty query", () => {
    expect(queryPairsOf("/xrpl/nfts")).toEqual([]);
    expect(queryPairsOf("/xrpl/nfts?")).toEqual([]);
  });

  it("decodes the values", () => {
    expect(queryPairsOf("/xrpl/nfts?issuer=a%20b&order=asc")).toEqual([
      ["issuer", "a b"],
      ["order", "asc"],
    ]);
  });
});

describe("the words and numbers of the NFT builders", () => {
  it("writes a number as plain digits, a count grouped, and a sale count in the singular for one", () => {
    expect(plain(1e21)).toBe("1000000000000000000000");
    expect(counted(1234567)).toBe("1,234,567");
    expect(salesCount(1)).toBe("1 sale");
    expect(salesCount(0)).toBe("0 sales");
    expect(salesCount(412)).toBe("412 sales");
  });

  it("writes a share to one decimal half up, <0.1% for a share that rounds to nothing, and a dash for no whole", () => {
    expect(sharePercentTenth("439", "1000")).toBe("43.9%");
    expect(sharePercentTenth("25", "10000")).toBe("0.3%");
    expect(sharePercentTenth("1", "10000")).toBe("<0.1%");
    expect(sharePercentTenth("0", "10000")).toBe("0.0%");
    expect(sharePercentTenth("1", "0")).toBe(DASH);
  });
});

describe("convertedOf", () => {
  const sale = (currency: string, amount_issuer: string | undefined, converted_amount: string | undefined) => ({ currency, ...(amount_issuer === undefined ? {} : { amount_issuer }), ...(converted_amount === undefined ? {} : { converted_amount }) });

  it("is the native conversion of a price in a token, and nothing for a native price, a token with no rate that day or a conversion of 0", () => {
    expect(convertedOf("XRP", sale("SOLO", "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz", "96"))).toBe("96");
    expect(convertedOf("XRP", sale("XRP", undefined, "1250"))).toBeNull();
    expect(convertedOf("XAH", sale("XAH", undefined, "1250"))).toBeNull();
    expect(convertedOf("XRP", sale("SOLO", "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz", undefined))).toBeNull();
    expect(convertedOf("XRP", sale("SOLO", "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz", "0"))).toBeNull();
    // A token is one with an issuer, whatever its code: only the native currency has none.
    expect(convertedOf("XRP", sale("XRP", "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz", "3"))).toBe("3");
    // Another network's native code with no issuer is no token of this one.
    expect(convertedOf("XAH", sale("XRP", undefined, "5"))).toBe("5");
  });

  it("is written in this file: the NFT builders load neither the account's builder nor what it loads (no cycle with account-view.ts)", () => {
    const closure = staticClosure(new URL("../", import.meta.url), "server/nft-format.ts");
    expect(closure).not.toContain("server/account-view.ts");
    expect(closure.filter((path) => /^domain\/(describe|parse)\//.test(path))).toEqual([]);
  });
});
