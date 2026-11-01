import { describe, expect, it } from "vitest";

import {
  TOKEN_SAMPLE_CURRENCY,
  TOKEN_SAMPLE_ISSUER,
  TOKEN_SAMPLE_OTHER_ISSUER,
  tokenCoverageSample,
  tokenRowSample,
  tokensSample,
  TOKENS_MARKER,
} from "../../test/support/token-samples";
import { NAMES_OFF, NO_NAMES, type NamesPart } from "../domain/names";
import { parseTokensParams, type TokensParams } from "../domain/token-params";
import { NO_FEATURES } from "../ui/features";
import type { TokensResponse } from "./api-types";
import { tokensPage, type TokensInput, type TokensNet } from "./token-view";

// The token list's view builder (E11 spec 2.1 and 2.2): the page data of `/{net}/tokens` from D6's answer of the list. Pure; every figure is D6's own text or made with BigNumber, every href
// is written here, and a page draws what it is given.

const FEATURES = { ...NO_FEATURES, tokens: true };
const XRPL: TokensNet = {
  id: "xrpl",
  kind: "mainnet",
  name: "XRPL",
  label: "XRPL mainnet",
  longName: "the XRP Ledger",
  dexName: "the XRP Ledger DEX",
  native: "XRP",
  software: "rippled",
  hasAmm: true,
  features: FEATURES,
};
const XAHAU: TokensNet = { ...XRPL, id: "xahau", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud", hasAmm: false };
const TESTNET: TokensNet = { ...XRPL, kind: "testnet", name: "XRPL Testnet", label: "XRPL Testnet", longName: "XRPL Testnet", dexName: "the XRPL Testnet DEX" };

/** The view a query names, read as the loader reads it. */
const paramsOf = (query = ""): TokensParams => parseTokensParams(new URLSearchParams(query), { mptAvailable: false });

/** The page of a query for `answer`, on XRPL unless the input says otherwise. */
function listed(query = "", answer: TokensResponse | null = tokensSample(), over: Partial<TokensInput> = {}) {
  return tokensPage({ net: XRPL, params: paramsOf(query), mptAvailable: false, answer, names: NO_NAMES, ...over });
}

/** A page of the list: `count` rows from `first`, of a list of `total` tokens. */
const pageOf = (first: number, count: number, over: Partial<TokensResponse> = {}): TokensResponse =>
  tokensSample({
    total: 1284,
    total_below: 48206,
    count,
    tokens: Array.from({ length: count }, (_, at) => tokenRowSample({ rank: first + at, currency: "USD", code: "USD", issuer: TOKEN_SAMPLE_OTHER_ISSUER, name: undefined })),
    ...over,
  });

describe("tokensPage: the head", () => {
  it("names the page, its network and its source", () => {
    const page = listed();
    expect(page.kind).toBe("tokens");
    expect(page.network).toMatchObject({ id: "xrpl", name: "XRPL", native: "XRP" });
    expect(page.tokenKind).toBe("issued");
    expect(page.intro).toBe("Tokens on XRPL, ranked by holders. Names come from each issuer's toml.");
    expect(page.source).toBe("/v2/tokens?kind=issued&min_holders=10");
  });

  it("says the network's own name: Xahau's, and the sandbox's", () => {
    expect(listed("", tokensSample(), { net: XAHAU }).intro).toBe("Tokens on Xahau, ranked by holders. Names come from each issuer's toml.");
    expect(listed("", tokensSample(), { net: TESTNET }).intro).toBe("Tokens on XRPL Testnet, ranked by holders. Names come from each issuer's toml.");
  });

  it("leaves min_holders out of the source line under all", () => {
    expect(listed("all=1").source).toBe("/v2/tokens?kind=issued");
  });

  it("passes the kind tabs through: MPT soon on XRPL, with the note on Xahau, a link when E14 says it is available", () => {
    expect(listed().tabs).toEqual([
      { label: "Issued tokens", href: "/xrpl/tokens", current: true },
      { label: "MPT", href: "/xrpl/tokens?kind=mpt", current: false, disabled: { tag: "soon" } },
    ]);
    expect(listed("", tokensSample(), { net: XAHAU }).tabs[1]).toMatchObject({ disabled: { note: "MPT isn't enabled on Xahau." } });
    expect(listed("", tokensSample(), { mptAvailable: true }).tabs[1]).toEqual({ label: "MPT", href: "/xrpl/tokens?kind=mpt", current: false });
  });
});

describe("tokensPage: the tiles", () => {
  it("are the totals of the kind: tokens with 10 holders and how many have fewer, the holders, the volume of the day", () => {
    expect(listed().tiles).toEqual([
      { label: "Tokens with 10+ holders", value: "9", sub: "6 more have fewer than 10 holders" },
      { label: "Holders", value: "4,321", sub: "accounts holding at least one issued token" },
      { label: "Volume, 24 h", value: "243.5 XRP", sub: "DEX and AMM trades of every pair" },
    ]);
  });

  it("write the volume compact, in the native currency, and say DEX trades only where the network has no AMM (Xahau)", () => {
    const answer = tokensSample({ totals: { tokens: 2000, tokens_with_10_holders: 1284, holders: 1_234_567, native_volume: "1234567.89" } });
    expect(listed("", answer).tiles.map((tile) => tile.value)).toEqual(["1,284", "1,234,567", "1.23M XRP"]);
    expect(listed("", answer).tiles[0]!.sub).toBe("716 more have fewer than 10 holders");
    const xahau = listed("", answer, { net: XAHAU }).tiles;
    expect(xahau[2]).toEqual({ label: "Volume, 24 h", value: "1.23M XAH", sub: "DEX trades of every pair" });
  });

  it("read a dash for the volume while D6 has no day set, and for the holders while it has not counted them", () => {
    const answer = tokensSample({ totals: { tokens: 15, tokens_with_10_holders: 9 } });
    expect(listed("", answer).tiles).toEqual([
      { label: "Tokens with 10+ holders", value: "9", sub: "6 more have fewer than 10 holders" },
      { label: "Holders", value: "—", sub: "accounts holding at least one issued token" },
      { label: "Volume, 24 h", value: "—", sub: "DEX and AMM trades of every pair" },
    ]);
  });

  it("are all dashes with no totals (D6 before its first generation), and the first has no sub", () => {
    const answer: TokensResponse = { result: "success", coverage: tokenCoverageSample(), kind: "issued", count: 0, tokens: [] };
    expect(listed("", answer).tiles).toEqual([
      { label: "Tokens with 10+ holders", value: "—", sub: "" },
      { label: "Holders", value: "—", sub: "accounts holding at least one issued token" },
      { label: "Volume, 24 h", value: "—", sub: "DEX and AMM trades of every pair" },
    ]);
  });
});

describe("tokensPage: a row", () => {
  it("is the token with its figures made from D6's text, and a link through tokenLink", () => {
    const [row] = listed().issued!.rows;
    expect(row).toEqual({
      key: `${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}`,
      rank: "1",
      code: "RLUSD",
      codeTitle: TOKEN_SAMPLE_CURRENCY,
      codeHidden: `currency code ${TOKEN_SAMPLE_CURRENCY}`,
      name: "Ripple USD",
      href: `/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}`,
      issuer: TOKEN_SAMPLE_ISSUER,
      holders: "120",
      supply: "7,320",
      price: "0.4",
      volume: "150",
      listed: true,
    });
  });

  it("writes a 3-character code as it is, with no title and no hidden words, and dashes for a token with no price or volume", () => {
    const [, row] = listed().issued!.rows;
    expect(row).toEqual({
      key: `USD.${TOKEN_SAMPLE_OTHER_ISSUER}`,
      rank: "2",
      code: "USD",
      href: `/xrpl/token/USD.${TOKEN_SAMPLE_OTHER_ISSUER}`,
      issuer: TOKEN_SAMPLE_OTHER_ISSUER,
      holders: "60",
      supply: "1,860",
      price: "—",
      volume: "0",
      listed: false,
    });
    expect(row).not.toHaveProperty("name");
    expect(row).not.toHaveProperty("codeTitle");
    expect(row).not.toHaveProperty("codeHidden");
  });

  it("writes the volume as a dash while D6 has no day set", () => {
    const answer = tokensSample({ tokens: [tokenRowSample({ native_volume: undefined, trades: undefined })] });
    expect(listed("", answer).issued!.rows[0]!.volume).toBe("—");
  });

  it("writes the price to 8 significant digits and never in exponent notation, and the supply and the volume compact", () => {
    const answer = tokensSample({ tokens: [tokenRowSample({ price: "1.2000000e-7", supply: "1234567890", native_volume: "98765.4321" })] });
    const [row] = listed("", answer).issued!.rows;
    expect(row).toMatchObject({ price: "0.00000012", supply: "1.23B", volume: "98.8K" });
  });

  it("writes a hex code that does not decode as its first digits with the whole hex in the title and in the hidden words", () => {
    const hex = "FF00000000000000000000000000000000000001";
    const answer = tokensSample({ tokens: [tokenRowSample({ currency: hex, code: undefined, name: undefined })] });
    const [row] = listed("", answer).issued!.rows;
    expect(row).toMatchObject({ code: "FF000000…", codeTitle: hex, codeHidden: `currency code ${hex}`, href: `/xrpl/token/${hex}.${TOKEN_SAMPLE_ISSUER}` });
  });

  it("groups the rank (it is the place in the whole list, whatever the page)", () => {
    expect(listed("", pageOf(1001, 2)).issued!.rows.map((row) => row.rank)).toEqual(["1,001", "1,002"]);
  });

  it("has no link for a code its own path would not read back as itself (a pipe in a 3-character code), and draws it as text", () => {
    const answer = tokensSample({ tokens: [tokenRowSample({ currency: "U|D", code: "U|D", name: undefined })] });
    const [row] = listed("", answer).issued!.rows;
    expect(row).toMatchObject({ code: "U|D", href: null });
  });

  it("takes the bidi controls out of the toml's name: it is the issuer's text", () => {
    const answer = tokensSample({ tokens: [tokenRowSample({ name: "Ripple‮ USD⁦" })] });
    expect(listed("", answer).issued!.rows[0]!.name).toBe("Ripple USD");
    const only = tokensSample({ tokens: [tokenRowSample({ name: "‮" })] });
    expect(listed("", only).issued!.rows[0]).not.toHaveProperty("name");
  });
});

describe("tokensPage: the note", () => {
  it("counts the ranks of the page against the whole list of tokens with 10 or more holders", () => {
    expect(listed("", pageOf(1, 20)).issued!.note).toEqual({ text: "Showing 1–20 of 1,284 tokens with 10 or more holders" });
    expect(listed(`marker=${TOKENS_MARKER}`, pageOf(21, 20)).issued!.note).toEqual({ text: "Showing 21–40 of 1,284 tokens with 10 or more holders" });
    expect(listed("", pageOf(1001, 20)).issued!.note).toEqual({ text: "Showing 1,001–1,020 of 1,284 tokens with 10 or more holders" });
  });

  it("counts all the tokens under all", () => {
    expect(listed("all=1", pageOf(1, 20, { total: 49490, total_below: undefined })).issued!.note).toEqual({ text: "Showing 1–20 of 49,490 tokens" });
  });

  it("counts the matches of a search, and links the same search under all when more match among the tokens with fewer holders", () => {
    expect(listed("q=USD", pageOf(1, 12, { total: 12, total_below: 3 })).issued!.note).toEqual({
      text: "12 matches",
      more: { text: "3 more among tokens with fewer than 10 holders", href: "/xrpl/tokens?q=USD&all=1" },
    });
    expect(listed("q=USD", pageOf(1, 1, { total: 1, total_below: 1_204 })).issued!.note).toEqual({
      text: "1 match",
      more: { text: "1,204 more among tokens with fewer than 10 holders", href: "/xrpl/tokens?q=USD&all=1" },
    });
  });

  it("has no link to more when none match among the tokens with fewer holders, and none under all", () => {
    expect(listed("q=USD", pageOf(1, 12, { total: 12, total_below: 0 })).issued!.note).toEqual({ text: "12 matches" });
    expect(listed("q=USD", pageOf(1, 12, { total: 12, total_below: undefined })).issued!.note).toEqual({ text: "12 matches" });
    expect(listed("q=USD&all=1", pageOf(1, 15, { total: 15, total_below: undefined })).issued!.note).toEqual({ text: "15 matches" });
  });

  it("has none while D6 has no total (before its first generation)", () => {
    const answer: TokensResponse = { result: "success", coverage: tokenCoverageSample(), kind: "issued", count: 0, tokens: [] };
    expect(listed("", answer).issued!.note).toBeNull();
    expect(listed("q=USD", answer).issued!.note).toBeNull();
  });

  it("is followed by the definitions of the figures, in the network's currency", () => {
    expect(listed().issued!.footnote).toBe("Holders: accounts with a positive balance. Supply: the sum of their balances. Price: the last trade against XRP.");
    expect(listed("", tokensSample(), { net: XAHAU }).issued!.footnote).toBe("Holders: accounts with a positive balance. Supply: the sum of their balances. Price: the last trade against XAH.");
  });
});

describe("tokensPage: Show all", () => {
  it("counts the tokens with fewer than 10 holders and leads to all=1", () => {
    expect(listed("", pageOf(1, 20)).showAll).toEqual({ href: "/xrpl/tokens?all=1", label: "Show all (48,206 hidden)" });
  });

  it("keeps the search", () => {
    expect(listed("q=USD", pageOf(1, 12, { total: 12, total_below: 3 })).showAll).toEqual({ href: "/xrpl/tokens?q=USD&all=1", label: "Show all (3 hidden)" });
  });

  it("is the way back under all, with the search kept", () => {
    expect(listed("all=1", pageOf(1, 20, { total_below: undefined })).showAll).toEqual({ href: "/xrpl/tokens", label: "Hide tokens with fewer than 10 holders" });
    expect(listed("q=USD&all=1", pageOf(1, 20, { total_below: undefined })).showAll).toEqual({ href: "/xrpl/tokens?q=USD", label: "Hide tokens with fewer than 10 holders" });
  });

  it("is not there when nothing is hidden, or while D6 does not count it", () => {
    expect(listed("", pageOf(1, 20, { total_below: 0 })).showAll).toBeNull();
    expect(listed("", pageOf(1, 20, { total_below: undefined })).showAll).toBeNull();
  });
});

describe("tokensPage: the search form", () => {
  it("is a GET form to the list, with the field labelled and the search as typed", () => {
    expect(listed("q=USD", pageOf(1, 12, { total: 12 })).search).toEqual({
      action: "/xrpl/tokens",
      q: "USD",
      error: null,
      label: "Code, name or issuer",
      placeholder: "RLUSD, Ripple or rMxCK…",
      hidden: [],
    });
    expect(listed().search.q).toBe("");
  });

  it("carries all=1 as a hidden field under all", () => {
    expect(listed("all=1").search.hidden).toEqual([{ name: "all", value: "1" }]);
  });

  it("answers a search of more than 64 characters with its message, no list and no pager, and keeps what was typed", () => {
    const q = "x".repeat(65);
    const page = listed(`q=${q}`, null);
    expect(page.search).toMatchObject({ q, error: "Search for at most 64 characters" });
    expect(page.issued).toBeNull();
    expect(page.coverage).toBeNull();
    expect(page.pager).toEqual({ newerHref: null, olderHref: null, labels: { newer: "Previous", older: "More tokens" } });
    expect(page.showAll).toBeNull();
    expect(page.tiles.map((tile) => tile.value)).toEqual(["—", "—", "—"]);
    expect(page.meta).toMatchObject({ error: true });
    // 64 characters are a search.
    expect(listed(`q=${"x".repeat(64)}`, pageOf(1, 0, { total: 0 })).search.error).toBeNull();
  });

  it("offers the way back under all even for the search that was too long (there is no answer to count by)", () => {
    expect(listed(`q=${"x".repeat(65)}&all=1`, null).showAll).toEqual({ href: `/xrpl/tokens?q=${"x".repeat(65)}`, label: "Hide tokens with fewer than 10 holders" });
  });
});

describe("tokensPage: an empty list", () => {
  it("says no token matches the search", () => {
    const answer = pageOf(1, 0, { total: 0, total_below: 0, marker: undefined });
    expect(listed("q=zzz", answer).issued).toMatchObject({ rows: [], empty: "No issued tokens match “zzz”." });
    expect(listed("q=zzz&all=1", answer).issued!.empty).toBe("No issued tokens match “zzz”.");
  });

  it("takes the bidi controls out of the search it repeats", () => {
    const answer = pageOf(1, 0, { total: 0, total_below: 0, marker: undefined });
    expect(listed("q=a%E2%80%AEb", answer).issued!.empty).toBe("No issued tokens match “ab”.");
  });

  it("says no token has 10 holders when the tokens with fewer are hidden, and that there is none yet when there is no answer of D6's", () => {
    expect(listed("", pageOf(1, 0, { total: 0, total_below: 3, marker: undefined })).issued!.empty).toBe("No issued tokens have 10 or more holders.");
    const first: TokensResponse = { result: "success", coverage: tokenCoverageSample(), kind: "issued", count: 0, tokens: [] };
    expect(listed("", first).issued!.empty).toBe("No issued tokens in the index yet.");
    expect(listed("all=1", pageOf(1, 0, { total: 0, total_below: undefined, marker: undefined })).issued!.empty).toBe("No issued tokens in the index yet.");
  });

  it("has no empty message while there are rows", () => {
    expect(listed().issued!.empty).toBeNull();
  });
});

describe("tokensPage: the pager", () => {
  it("leads from the first page to the marker of the next, remembering it", () => {
    expect(listed("", tokensSample()).pager).toEqual({ newerHref: null, olderHref: `/xrpl/tokens?marker=${TOKENS_MARKER}`, labels: { newer: "Previous", older: "More tokens" } });
  });

  it("leads back along the trail from a page behind a marker, and on from it", () => {
    const answer = tokensSample({ marker: "M3" });
    expect(listed("marker=M2&back=M1", answer).pager).toMatchObject({ newerHref: "/xrpl/tokens?marker=M1", olderHref: "/xrpl/tokens?marker=M3&back=M2.M1" });
    expect(listed("marker=M1", answer).pager).toMatchObject({ newerHref: "/xrpl/tokens", olderHref: "/xrpl/tokens?marker=M3&back=M1" });
  });

  it("keeps the search and all in every link, and has no next page at the end of the list", () => {
    const answer = tokensSample({ marker: undefined });
    expect(listed("q=USD&all=1&marker=M1", answer).pager).toMatchObject({ newerHref: "/xrpl/tokens?q=USD&all=1", olderHref: null });
    expect(listed("q=USD&all=1&marker=M2&back=M1", tokensSample({ marker: "M3" })).pager).toMatchObject({
      newerHref: "/xrpl/tokens?q=USD&all=1&marker=M1",
      olderHref: "/xrpl/tokens?q=USD&all=1&marker=M3&back=M2.M1",
    });
  });
});

describe("tokensPage: the coverage", () => {
  it("is the note of the trust lines the index holds, with the ledger it starts at, when it is not complete", () => {
    const answer = tokensSample({ coverage: tokenCoverageSample({ from_ledger_index: 107874617, complete: false }) });
    expect(listed("", answer).coverage).toEqual({ before: "Covers ledger ", ledger: 107874617, after: " onwards: earlier trust lines are not in the index yet." });
  });

  it("is nothing when it is complete", () => {
    expect(listed().coverage).toBeNull();
  });
});

describe("tokensPage: the facts of the tags", () => {
  it("are the default view's with no search, no all and no marker", () => {
    expect(listed().meta).toEqual({ all: false, more: false, error: false });
  });

  it("name the search (without its bidi controls), all and the marker", () => {
    expect(listed("q=USD", pageOf(1, 12, { total: 12 })).meta).toEqual({ q: "USD", all: false, more: false, error: false });
    expect(listed("q=a%E2%80%AEb", pageOf(1, 12, { total: 12 })).meta.q).toBe("ab");
    expect(listed("all=1").meta).toEqual({ all: true, more: false, error: false });
    expect(listed("marker=M1").meta).toEqual({ all: false, more: true, error: false });
  });

  it("say the search was too long without repeating it", () => {
    expect(listed(`q=${"x".repeat(65)}`, null).meta).toEqual({ all: false, more: false, error: true });
  });
});

describe("tokensPage: the names", () => {
  it("are the loader's part, as it is", () => {
    expect(listed().names).toBe(NO_NAMES);
    expect(listed("", tokensSample(), { names: NAMES_OFF }).names).toBe(NAMES_OFF);
    const failed: NamesPart = { state: "failed", map: {} };
    expect(listed("", tokensSample(), { names: failed }).names).toBe(failed);
  });
});
