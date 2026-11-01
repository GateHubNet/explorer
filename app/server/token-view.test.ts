import { describe, expect, it } from "vitest";

import { ammLiveVolumeSample, ammPoolAccount, ammPoolSample, ammPoolsSample, AMM_POOL } from "../../test/support/amm-samples";
import {
  HOLDERS_MARKER,
  holdersSample,
  tokenCoverageSample,
  tokenDetailSample,
  tokenHolderSample,
  tokenMarketSample,
  tokenRowSample,
  tokenSample,
  tokensSample,
  tokenTransferSample,
  TOKEN_SAMPLE_CURRENCY,
  TOKEN_SAMPLE_ISSUER,
  TOKEN_SAMPLE_OTHER_ISSUER,
  TOKENS_MARKER,
  TRANSFERS_MARKER,
  transfersSample,
} from "../../test/support/token-samples";
import { NAMES_OFF, NO_NAMES, type NamesPart, type NameView } from "../domain/names";
import { parseTokensParams, type TokensParams } from "../domain/token-params";
import { NO_FEATURES } from "../ui/features";
import type { AmmPool, AmmVolumeRow, Page, TokenDetail, TokensResponse } from "./api-types";
import type { Loaded } from "./account-view";
import type { AccountInfo } from "./node-rpc";
import {
  holderRows,
  linkOf,
  marketRows,
  poolRows,
  priceView,
  settingsRows,
  tokenFacts,
  tokenHoldersPage,
  tokenPage,
  tokensPage,
  tomlCard,
  transferRows,
  type TokenHoldersInput,
  type TokenInput,
  type TokensInput,
  type TokensNet,
} from "./token-view";

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

// ---- One token (spec 3) ---------------------------------------------------------------------------------------------------------------------------

// The token page's view builder (E11 spec 3.1 to 3.5): the page data of `/{net}/token/{token}` from D6's answers and the outcome of each call. Pure; every figure is D6's own text or made with
// BigNumber, and what the issuer controls (the toml's fields and URLs, its domain) is text that is shown without its bidi controls, with only an `https:` URL ever a link.

/** The switches the token page's links read: the markets and the AMM pages on (the base `FEATURES` has neither). */
const LINKED = { ...FEATURES, markets: true, ammPages: true };
const XRPL_LINKED: TokensNet = { ...XRPL, features: LINKED };
const XAHAU_LINKED: TokensNet = { ...XAHAU, features: LINKED };
const ASSET = { currency: TOKEN_SAMPLE_CURRENCY, issuer: TOKEN_SAMPLE_ISSUER };
const CODE = "RLUSD";

const ok = <T>(value: T): Loaded<T> => ({ state: "ok", value });
const FAILED = { state: "failed" } as const;
const MISSING = { state: "missing" } as const;

/** The issuer's account as the node gives it, with the flags and rate given. */
const infoOf = (Flags: number, TransferRate?: number): AccountInfo => ({
  account_data: {
    LedgerEntryType: "AccountRoot",
    Account: TOKEN_SAMPLE_ISSUER,
    Balance: "1000000",
    Flags,
    OwnerCount: 0,
    Sequence: 1,
    PreviousTxnID: "A".repeat(64),
    PreviousTxnLgrSeq: 1,
    ...(TransferRate === undefined ? {} : { TransferRate }),
  },
  ledger_index: 107900000,
  validated: true,
});

/** A pool holding the token, against XRP, as the AMM list gives it. */
const poolOf = (n: number, over: Partial<AmmPool> = {}): AmmPool =>
  ammPoolSample({ amm_account: ammPoolAccount(n), base_currency: TOKEN_SAMPLE_CURRENCY, base_issuer: TOKEN_SAMPLE_ISSUER, counter_currency: "XRP", ...over });

/** The live day's volume with a component for each pool given (the token against XRP, 100 XRP of swaps each). */
const volumeOf = (pools: readonly string[]): Page<"rows", AmmVolumeRow> => {
  const sample = ammLiveVolumeSample();
  const row = sample.rows[0]!;
  const component = row.components[0]!;
  return {
    ...sample,
    rows: [{ ...row, components: pools.map((amm_account) => ({ ...component, amm_account, base: { currency: TOKEN_SAMPLE_CURRENCY, issuer: TOKEN_SAMPLE_ISSUER }, converted_amount: "100" })) }],
  };
};

/** The page of a token on XRPL with every call answered, unless the input says otherwise. */
function tokenInput(over: Partial<TokenInput> = {}): TokenInput {
  return {
    net: XRPL_LINKED,
    asset: ASSET,
    answer: tokenSample(),
    mode: "first",
    params: { back: [] },
    holders: ok(holdersSample()),
    transfers: ok(transfersSample()),
    pools: ok(ammPoolsSample({ pools: [poolOf(1, { amm_account: AMM_POOL })], count: 1, marker: undefined })),
    ammVolume: ok(volumeOf([AMM_POOL])),
    accountInfo: null,
    names: NO_NAMES,
    ...over,
  };
}

/** The same with the token replaced by `over`'s. */
const withToken = (over: Partial<TokenDetail>, rest: Partial<TokenInput> = {}): TokenInput => tokenInput({ answer: tokenSample({ token: tokenDetailSample(over) }), ...rest });
const pageOfToken = (input: TokenInput = tokenInput()) => tokenPage(input).page;

describe("priceView", () => {
  const detail = (over: Partial<TokenDetail>) => tokenDetailSample({ price_change: undefined, price_time: undefined, ...over });

  it("is the price and the change of the day with its arrow's direction: a rise, and a fall with U+2212", () => {
    expect(priceView(detail({ price: "0.40990000", price_change: "0.123" }), "XRP")).toEqual({ value: "0.4099 XRP", sub: { kind: "change", sign: 1, text: "+0.12% in 24 h" } });
    expect(priceView(detail({ price: "0.4", price_change: "-0.40" }), "XRP")).toEqual({ value: "0.4 XRP", sub: { kind: "change", sign: -1, text: "−0.40% in 24 h" } });
  });

  it("has a change of nothing for a change that rounds to zero: no arrow either way", () => {
    expect(priceView(detail({ price: "1", price_change: "0.00" }), "XRP").sub).toEqual({ kind: "change", sign: 0, text: "0.00% in 24 h" });
    expect(priceView(detail({ price: "1", price_change: "-0.004" }), "XRP").sub).toEqual({ kind: "change", sign: 0, text: "0.00% in 24 h" });
  });

  it("is by the change being there (spec 3.4), not by how old the price is: a price_time of 2020 with a change says the change", () => {
    expect(priceView(detail({ price: "2", price_change: "5.00", price_time: "2020-01-02T03:04:05Z" }), "XRP").sub).toEqual({ kind: "change", sign: 1, text: "+5.00% in 24 h" });
  });

  it("is the day of the last trade where there is no change", () => {
    expect(priceView(detail({ price: "0.4", price_time: "2026-10-03T23:59:59Z" }), "XRP")).toEqual({ value: "0.4 XRP", sub: { kind: "last", text: "last trade Oct 3" } });
  });

  it("is a dash and the words of no trade for a token with no price, in the network's own currency", () => {
    expect(priceView(detail({ price: undefined }), "XRP")).toEqual({ value: "—", sub: { kind: "none", text: "No trade against XRP in 30 days" } });
    expect(priceView(detail({ price: undefined }), "XAH").sub.text).toBe("No trade against XAH in 30 days");
  });

  it("does not read the change or the time that remain after a dropped price (checkToken deletes an unreadable price and keeps them)", () => {
    expect(priceView(detail({ price: undefined, price_change: "12.00", price_time: "2026-10-03T00:00:00Z" }), "XRP")).toEqual({
      value: "—",
      sub: { kind: "none", text: "No trade against XRP in 30 days" },
    });
  });

  it("has no words for a price with neither a change nor a time, and writes a price in exponent form in plain digits", () => {
    expect(priceView(detail({ price: "1.2000000e-7" }), "XRP")).toEqual({ value: "0.00000012 XRP", sub: { kind: "none", text: "" } });
  });
});

describe("tokenPage: the header", () => {
  it("is the token: its display code, the toml's name as the heading, its issuer and the source line", () => {
    const { head } = pageOfToken();
    expect(head).toEqual({
      code: CODE,
      codeTitle: TOKEN_SAMPLE_CURRENCY,
      codeHidden: `currency code ${TOKEN_SAMPLE_CURRENCY}`,
      hex: TOKEN_SAMPLE_CURRENCY,
      title: "Ripple USD",
      issuer: TOKEN_SAMPLE_ISSUER,
      issuerHref: `/xrpl/account/${TOKEN_SAMPLE_ISSUER}`,
      toml: { label: "xrp-ledger.toml", href: "https://ripple.com/.well-known/xrp-ledger.toml" },
      source: `/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}`,
    });
  });

  it("is headed by the code when the toml gives no name (or a name of bidi controls only), and a 3-character code has no hex", () => {
    const usd = { currency: "USD", code: "USD", toml: undefined, listed: false, toml_url: undefined };
    const { head } = pageOfToken(withToken(usd, { asset: { currency: "USD", issuer: TOKEN_SAMPLE_ISSUER } }));
    expect(head).toMatchObject({ code: "USD", title: "USD", toml: null });
    expect(head).not.toHaveProperty("hex");
    expect(head).not.toHaveProperty("codeTitle");
    expect(pageOfToken(withToken({ toml: { name: "‮⁦" } })).head.title).toBe(CODE);
  });

  it("takes the bidi controls out of the heading", () => {
    expect(pageOfToken(withToken({ toml: { name: "Ripple‮ USD" } })).head.title).toBe("Ripple USD");
  });

  it("names Xahau's toml file, and leaves out the button for a toml_url that is not an https: link", () => {
    const xahau = pageOfToken(withToken({}, { net: XAHAU_LINKED, pools: null, ammVolume: null }));
    expect(xahau.head.toml).toEqual({ label: "xahau.toml", href: "https://ripple.com/.well-known/xrp-ledger.toml" });
    for (const url of ["javascript:alert(1)", "http://ripple.com/.well-known/xrp-ledger.toml", "//ripple.com/x", "/relative", "data:text/html,x", "https://user:pw@ripple.com/x", ""]) {
      expect(pageOfToken(withToken({ toml_url: url })).head.toml, url).toBeNull();
    }
    expect(pageOfToken(withToken({ toml_url: undefined })).head.toml).toBeNull();
  });

  it("is on the network it is shown on", () => {
    expect(pageOfToken().network).toMatchObject({ id: "xrpl", name: "XRPL", native: "XRP" });
    expect(pageOfToken(tokenInput({ net: { ...XRPL_LINKED, ...TESTNET } })).network.name).toBe("XRPL Testnet");
  });
});

describe("tokenPage: the figures", () => {
  it("are the five tiles with D6's exact text: the supply, the holders, the trust lines with their zero balances, the price, the volume", () => {
    expect(pageOfToken().figures).toEqual([
      { label: "Supply", value: "7,320", sub: "RLUSD, the sum of all holders' balances" },
      { label: "Holders", value: "120", sub: "accounts with a positive balance" },
      { label: "Trust lines", value: "150", sub: "30 of them with a zero balance" },
      { label: "Price", value: "0.4 XRP", sub: "", delta: { text: "−20.00% in 24 h", sign: -1 } },
      { label: "Volume, 24 h", value: "150 XRP", sub: "35 trades on the DEX and AMM" },
    ]);
  });

  it("keep a huge supply exact, to the last decimal, and subtract the lines with BigNumber", () => {
    const [supply, holders, lines] = pageOfToken(withToken({ supply: "18240211855000000000000.000001", holders: 1, trust_lines: 9007199254740991 })).figures!;
    expect(supply!.value).toBe("18,240,211,855,000,000,000,000.000001");
    expect(holders!.value).toBe("1");
    expect(lines!.value).toBe("9,007,199,254,740,991");
    expect(lines!.sub).toBe("9,007,199,254,740,990 of them with a zero balance");
  });

  it("write the supply in plain digits when D6 sends it in exponent form", () => {
    expect(pageOfToken(withToken({ supply: "1.5e+21" })).figures![0]!.value).toBe("1,500,000,000,000,000,000,000");
  });

  it("show the price's last-trade day, or no price, under the price and not as a change", () => {
    const last = pageOfToken(withToken({ price_change: undefined, price_time: "2026-10-03T12:00:00Z" })).figures![3]!;
    expect(last).toEqual({ label: "Price", value: "0.4 XRP", sub: "last trade Oct 3" });
    const none = pageOfToken(withToken({ price: undefined })).figures![3]!;
    expect(none).toEqual({ label: "Price", value: "—", sub: "No trade against XRP in 30 days" });
  });

  it("say a single trade as one, a dash for a volume D6 does not have, and DEX trades only where there is no AMM (Xahau)", () => {
    expect(pageOfToken(withToken({ trades: 1 })).figures![4]!.sub).toBe("1 trade on the DEX and AMM");
    expect(pageOfToken(withToken({ native_volume: undefined, trades: undefined })).figures![4]).toEqual({ label: "Volume, 24 h", value: "—", sub: "" });
    const xahau = pageOfToken(withToken({ price: "1.5", price_change: undefined, price_time: undefined }, { net: XAHAU_LINKED, pools: null, ammVolume: null }));
    expect(xahau.figures![3]!.value).toBe("1.5 XAH");
    expect(xahau.figures![4]).toEqual({ label: "Volume, 24 h", value: "150 XAH", sub: "35 trades on the DEX" });
  });

  it("have the coverage note of the trust lines under them, and none when it is complete", () => {
    expect(pageOfToken().coverage).toBeNull();
    expect(pageOfToken(tokenInput({ answer: tokenSample({ coverage: tokenCoverageSample({ complete: false, from_ledger_index: 1234 }) }) })).coverage).toEqual({
      before: "Covers ledger ",
      ledger: 1234,
      after: " onwards: earlier trust lines are not in the index yet.",
    });
  });
});

describe("linkOf", () => {
  it.each([
    ["https://ripple.com/a.pdf", "https://ripple.com/a.pdf"],
    ["HTTPS://Ripple.com/a", "https://ripple.com/a"],
    // The parser's reading, not the text's: `https:host/x` is an absolute link to host, not a relative one.
    ["https:ripple.com/x", "https://ripple.com/x"],
    ["  https://ripple.com/x ", "https://ripple.com/x"],
  ])("makes %j the link %j", (text, href) => expect(linkOf(text)).toBe(href));

  it.each([
    "http://ripple.com/x",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:x",
    "file:///etc/passwd",
    "ftp://ripple.com/x",
    "mailto:a@b.c",
    "//ripple.com/x",
    "/relative/path",
    "ripple.com/x",
    "https://user@ripple.com/x",
    "https://user:password@ripple.com/x",
    "https://:password@ripple.com/x",
    "java\nscript:alert(1)",
    "",
    "not a url",
  ])("makes %j no link", (text) => expect(linkOf(text)).toBeNull());

  it("makes undefined no link", () => expect(linkOf(undefined)).toBeNull());
});

describe("tomlCard", () => {
  const verified: NameView = { name: { text: "Ripple", kind: "verified" }, domain: "ripple.com", labels: [] };
  const listed = (over: Partial<TokenDetail> = {}, name: NameView | undefined = undefined) => tomlCard(tokenDetailSample(over), XRPL, name);

  it("is the entry of a listed token: its title, where the entry is, and the rows in D6's order", () => {
    const card = listed({
      toml: { name: "Ripple USD", desc: "A US dollar stablecoin", icon: "https://ripple.com/icon.png", symbol: "RLUSD", display_decimals: 2, asset_class: "Fiat-backed stablecoin", asset_subclass: "Stablecoin", attestation: "https://ripple.com/attest/2026-09.pdf" },
    });
    expect(card).toEqual({
      state: "listed",
      title: "From ripple.com's toml",
      entry: { code: "RLUSD", where: { text: "ripple.com/.well-known/xrp-ledger.toml", href: "https://ripple.com/.well-known/xrp-ledger.toml" } },
      verified: false,
      rows: [
        { label: "code", value: { kind: "text", text: "RLUSD" } },
        { label: "issuer", value: { kind: "account", address: TOKEN_SAMPLE_ISSUER } },
        { label: "name", value: { kind: "text", text: "Ripple USD" } },
        { label: "desc", value: { kind: "text", text: "A US dollar stablecoin" } },
        { label: "icon", value: { kind: "link", text: "ripple.com/icon.png", href: "https://ripple.com/icon.png" } },
        { label: "symbol", value: { kind: "text", text: "RLUSD" } },
        { label: "display_decimals", value: { kind: "text", text: "2" } },
        { label: "asset_class", value: { kind: "text", text: "Fiat-backed stablecoin" } },
        { label: "asset_subclass", value: { kind: "text", text: "Stablecoin" } },
        { label: "attestation", value: { kind: "link", text: "ripple.com/attest/2026-09.pdf", href: "https://ripple.com/attest/2026-09.pdf" } },
        { label: "Currency code in hex", value: { kind: "hex", hex: TOKEN_SAMPLE_CURRENCY, note: "Codes other than three letters are stored on the ledger as 40 hex characters." } },
      ],
    });
  });

  it("keeps the order of D6 whatever the order of the keys it was sent in, and writes display_decimals 0", () => {
    const card = listed({ toml: { attestation: "a", display_decimals: 0, name: "N" } });
    expect(card.state === "listed" && card.rows.map((row) => row.label)).toEqual(["code", "issuer", "name", "display_decimals", "attestation", "Currency code in hex"]);
    expect(card.state === "listed" && card.rows[3]).toEqual({ label: "display_decimals", value: { kind: "text", text: "0" } });
  });

  it("is the code and the issuer alone for a listed token whose entry has no served field", () => {
    const card = listed({ toml: undefined, currency: "USD" });
    expect(card.state === "listed" && card.rows.map((row) => row.label)).toEqual(["code", "issuer"]);
  });

  it("says the toml also lists the issuer when E9 gives it a verified name of the token's domain", () => {
    expect(listed({}, verified)).toMatchObject({ state: "listed", verified: true });
    // The domain compares in lower case; the name must be a verified one, and of this domain.
    expect(listed({ domain: "Ripple.com" }, verified)).toMatchObject({ verified: true });
    expect(listed({}, { ...verified, domain: "other.example" })).toMatchObject({ verified: false });
    expect(listed({}, { name: { text: "Ripple", kind: "domain" }, domain: "ripple.com", labels: [] })).toMatchObject({ verified: false });
    expect(listed({}, { name: { text: "Ripple", kind: "account" }, domain: "ripple.com", labels: [] })).toMatchObject({ verified: false });
    expect(listed({}, { labels: ["spam"] })).toMatchObject({ verified: false });
    expect(listed({}, undefined)).toMatchObject({ verified: false });
  });

  it("says a domain's toml has no entry for a token it does not list, and that no toml describes a token whose issuer has no domain", () => {
    expect(listed({ listed: false, toml: undefined })).toEqual({
      state: "unlisted",
      title: "From ripple.com's toml",
      text: "ripple.com's toml has no [[CURRENCIES]] entry for RLUSD by this issuer.",
    });
    expect(listed({ domain: undefined, toml_url: undefined, listed: false, toml: undefined })).toEqual({
      state: "no-domain",
      title: "The issuer's toml",
      text: "The issuer's account names no domain, so no toml describes RLUSD.",
    });
  });

  it("names Xahau's toml file", () => {
    const card = tomlCard(tokenDetailSample({ toml_url: "https://ripple.com/.well-known/xahau.toml" }), { software: "xahaud" }, undefined);
    expect(card).toMatchObject({ entry: { where: { text: "ripple.com/.well-known/xahau.toml", href: "https://ripple.com/.well-known/xahau.toml" } } });
  });

  it("makes a link only of an https: URL, and shows anything else as the text it is: the icon is never an image, an attestation is not a link when it is not a URL", () => {
    const rows = (toml: TokenDetail["toml"]) => {
      const card = listed({ toml });
      return card.state === "listed" ? card.rows.filter((row) => row.label === "icon" || row.label === "attestation") : [];
    };
    expect(rows({ icon: "http://ripple.com/icon.png", attestation: "javascript:alert(1)" })).toEqual([
      { label: "icon", value: { kind: "text", text: "http://ripple.com/icon.png" } },
      { label: "attestation", value: { kind: "text", text: "javascript:alert(1)" } },
    ]);
    expect(rows({ icon: "data:image/svg+xml;base64,PHN2Zz4=", attestation: "Audited by Example LLP, 2026" })).toEqual([
      { label: "icon", value: { kind: "text", text: "data:image/svg+xml;base64,PHN2Zz4=" } },
      { label: "attestation", value: { kind: "text", text: "Audited by Example LLP, 2026" } },
    ]);
    expect(rows({ icon: "https://user:pw@evil.example/i.png" })).toEqual([{ label: "icon", value: { kind: "text", text: "https://user:pw@evil.example/i.png" } }]);
    // No value of any row carries an href but a link, and a link's is the parsed https URL.
    for (const row of rows({ icon: "https://ripple.com/i.png", attestation: "https://ripple.com/a" })) expect(row.value).toMatchObject({ kind: "link", href: expect.stringMatching(/^https:\/\//) });
  });

  it("cuts the words of a very long link and keeps the whole link in the href", () => {
    const long = `https://ripple.com/${"a".repeat(200)}`;
    const card = listed({ toml: { attestation: long } });
    const row = card.state === "listed" ? card.rows.find((r) => r.label === "attestation") : undefined;
    expect(row?.value).toMatchObject({ kind: "link", href: long });
    expect(row?.value.kind === "link" && [...row.value.text]).toHaveLength(90);
    expect(row?.value.kind === "link" && row.value.text.endsWith("…")).toBe(true);
  });

  it("does not make a link of a field that is not a URL field, even when its text is an https: URL", () => {
    const card = listed({ toml: { name: "https://evil.example/x", desc: "https://evil.example/y", symbol: "https://evil.example/z" } });
    expect(card.state === "listed" && card.rows.every((row) => row.value.kind !== "link")).toBe(true);
  });

  it("links the file only when toml_url is an https: URL, and shows the domain's file as text otherwise", () => {
    expect(listed({ toml_url: "http://ripple.com/.well-known/xrp-ledger.toml" })).toMatchObject({ entry: { where: { text: "ripple.com/.well-known/xrp-ledger.toml", href: null } } });
    expect(listed({ toml_url: undefined })).toMatchObject({ entry: { where: { href: null } } });
    expect(listed({ toml_url: "javascript:alert(1)" })).toMatchObject({ entry: { where: { href: null } } });
  });

  it("takes the bidi controls out of every text the issuer wrote, the domain's included, and drops an empty field", () => {
    const card = listed({ domain: "ripple.com‮", toml: { name: "R‮L", desc: "", symbol: "⁦", asset_class: "Stable‭coin" } });
    expect(card).toMatchObject({ title: "From ripple.com's toml", entry: { where: { text: "ripple.com/.well-known/xrp-ledger.toml" } } });
    expect(card.state === "listed" && card.rows.map((row) => [row.label, row.value.kind === "text" ? row.value.text : null])).toEqual([
      ["code", "RLUSD"],
      ["issuer", null],
      ["name", "RL"],
      ["asset_class", "Stablecoin"],
      ["Currency code in hex", null],
    ]);
  });

  it("has no hex row for a 3-character code", () => {
    const card = listed({ currency: "USD" });
    expect(card.state === "listed" && card.rows.some((row) => row.value.kind === "hex")).toBe(false);
  });
});

describe("settingsRows", () => {
  const D6 = { transfer_fee: "0.2", global_freeze: false, no_freeze: true, allow_trust_line_clawback: true, require_auth: false, default_ripple: true };
  const summary = (read: ReturnType<typeof settingsRows>) => read?.rows.map((row) => `${row.name}: ${row.value}${row.on ? " (on)" : ""}`);

  it("is six rows from D6's issuer_settings: the fee as a percent, then five flags, each with its pill word and a sentence of the token", () => {
    const read = settingsRows({ settings: D6 }, CODE);
    expect(read?.fromNode).toBe(false);
    expect(summary(read)).toEqual(["Transfer fee: 0.2% (on)", "Global freeze: Off", "No freeze: Set (on)", "Clawback: Allowed (on)", "Require auth: Off", "Default ripple: On (on)"]);
    expect(read?.rows.map((row) => row.id)).toEqual(["transfer-fee", "global-freeze", "no-freeze", "clawback", "require-auth", "default-ripple"]);
    expect(read?.rows.map((row) => row.sentence)).toEqual([
      "Sending RLUSD from one holder to another costs 0.2% on top of the amount.",
      "RLUSD moves freely. The issuer has not frozen it for everyone.",
      "The issuer has given up the right to freeze: it can never freeze a holder's trust line, or all of RLUSD.",
      "The issuer can take RLUSD back from a holder's trust line.",
      "Anyone can open a trust line and hold RLUSD, without the issuer's approval.",
      "Holders can pay each other in RLUSD through the issuer's account.",
    ]);
  });

  it("says the other word of each flag, and None for no fee (D6 writes it \"0\", and exactly)", () => {
    const read = settingsRows({ settings: { transfer_fee: "0", global_freeze: true, no_freeze: false, allow_trust_line_clawback: false, require_auth: true, default_ripple: false } }, CODE);
    expect(summary(read)).toEqual(["Transfer fee: None", "Global freeze: On (on)", "No freeze: Not set", "Clawback: Not allowed", "Require auth: On (on)", "Default ripple: Off"]);
    expect(read?.rows[0]!.sentence).toBe("Holders send RLUSD to each other at no extra cost.");
    expect(read?.rows[3]!.sentence).toBe("The issuer cannot take RLUSD back from a holder.");
    expect(settingsRows({ settings: { ...D6, transfer_fee: "0.000" } }, CODE)?.rows[0]).toMatchObject({ value: "None", on: false });
    expect(settingsRows({ settings: { ...D6, transfer_fee: "1.000" } }, CODE)?.rows[0]).toMatchObject({ value: "1%", on: true });
    expect(settingsRows({ settings: { ...D6, transfer_fee: "0.0000001" } }, CODE)?.rows[0]).toMatchObject({ value: "0.0000001%" });
  });

  it("is read from the node's account on the XRP Ledger: 0x80000000 is the clawback, and TransferRate by D6's formula", () => {
    // DefaultRipple 0x00800000, NoFreeze 0x00200000, RequireAuth 0x00040000, GlobalFreeze 0x00400000, AllowTrustLineClawback 0x80000000.
    const read = settingsRows({ flags: 0x80000000 + 0x00800000 + 0x00200000, transferRate: 1_002_000_000, net: "xrpl" }, CODE);
    expect(read?.fromNode).toBe(true);
    expect(summary(read)).toEqual(["Transfer fee: 0.2% (on)", "Global freeze: Off", "No freeze: Set (on)", "Clawback: Allowed (on)", "Require auth: Off", "Default ripple: On (on)"]);
    expect(summary(settingsRows({ flags: 0x00400000 + 0x00040000, net: "xrpl" }, CODE))).toEqual(["Transfer fee: None", "Global freeze: On (on)", "No freeze: Not set", "Clawback: Not allowed", "Require auth: On (on)", "Default ripple: Off"]);
    // The flags of the account come as the node writes them: a signed number is read as its bits.
    expect(settingsRows({ flags: -0x80000000, net: "xrpl" }, CODE)?.rows[3]).toMatchObject({ value: "Allowed" });
  });

  it("is read on Xahau by Xahau's table: 0x1000 is the clawback, and 0x80000000 is not", () => {
    expect(settingsRows({ flags: 0x00001000, net: "xahau" }, CODE)?.rows[3]).toMatchObject({ name: "Clawback", value: "Allowed", on: true });
    expect(settingsRows({ flags: 0x80000000, net: "xahau" }, CODE)?.rows[3]).toMatchObject({ value: "Not allowed", on: false });
    expect(settingsRows({ flags: 0x00001000, net: "xrpl" }, CODE)?.rows[3]).toMatchObject({ value: "Not allowed" });
  });

  it("writes TransferRate exactly: 1e9 and below is none, one unit above is 0.0000001%, the ledger's largest is 100%", () => {
    const fee = (transferRate?: number) => settingsRows({ flags: 0, ...(transferRate === undefined ? {} : { transferRate }), net: "xrpl" }, CODE)?.rows[0]!.value;
    expect(fee()).toBe("None");
    expect(fee(0)).toBe("None");
    expect(fee(1_000_000_000)).toBe("None");
    expect(fee(999_999_999)).toBe("None");
    expect(fee(1_000_000_001)).toBe("0.0000001%");
    expect(fee(1_005_000_000)).toBe("0.5%");
    expect(fee(2_000_000_000)).toBe("100%");
  });

  it("is nothing when there is neither", () => {
    expect(settingsRows(null, CODE)).toBeNull();
  });
});

describe("tokenPage: the settings card", () => {
  it("reads D6's issuer_settings, with the sentence of the token and no caption of the network", () => {
    const { settings } = pageOfToken();
    expect(settings).toMatchObject({ state: "ok", fromNode: false, source: `/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}`, intro: "Set on the issuer's account. They apply to every holder of RLUSD." });
    expect(settings?.state === "ok" && settings.rows).toHaveLength(6);
  });

  it("asks nothing of the node's answer when D6 has the settings", () => {
    const { page, problems } = tokenPage(tokenInput({ accountInfo: FAILED }));
    expect(page.settings).toMatchObject({ state: "ok", fromNode: false });
    expect(problems).toEqual([]);
  });

  it("is read from the node's account_info when D6 has none, and says where from", () => {
    const { settings } = pageOfToken(withToken({ issuer_settings: undefined }, { accountInfo: ok(infoOf(0x00800000, 1_002_000_000)) }));
    expect(settings).toMatchObject({ state: "ok", fromNode: true, source: "the network" });
    expect(settings?.state === "ok" && settings.rows.map((row) => row.value)).toEqual(["0.2%", "Off", "Not set", "Not allowed", "Off", "On"]);
  });

  it("reads Xahau's account by Xahau's flags", () => {
    const { settings } = pageOfToken(withToken({ issuer_settings: undefined }, { net: XAHAU_LINKED, pools: null, ammVolume: null, accountInfo: ok(infoOf(0x00001000 | 0x00200000)) }));
    expect(settings?.state === "ok" && settings.rows.map((row) => row.value)).toEqual(["None", "Off", "Set", "Allowed", "Off", "Off"]);
  });

  it("says the settings couldn't be read, with a Retry when the node failed and without one when it has no such account", () => {
    const failed = tokenPage(withToken({ issuer_settings: undefined }, { accountInfo: FAILED }));
    expect(failed.page.settings).toMatchObject({ state: "unread", message: "The issuer's settings couldn't be read.", retry: true });
    expect(failed.problems).toEqual([{ part: "accountInfo" }]);
    const missing = tokenPage(withToken({ issuer_settings: undefined }, { accountInfo: MISSING }));
    expect(missing.page.settings).toMatchObject({ state: "unread", retry: false });
    expect(missing.problems).toEqual([]);
    expect(pageOfToken(withToken({ issuer_settings: undefined }, { accountInfo: null })).settings).toMatchObject({ state: "unread", retry: false });
  });
});

describe("marketRows", () => {
  const detail = tokenDetailSample();

  it("is D6's order, each pair \"{CODE} / {COUNTER}\" with the last price in the counter, the volume in the native currency and the trades", () => {
    expect(marketRows(detail, XRPL_LINKED)).toEqual([
      { key: "XRP.", pair: "RLUSD / XRP", counter: "XRP", href: `/xrpl/markets/XRP/RLUSD.${TOKEN_SAMPLE_ISSUER}`, last: "0.4 XRP", volume: "65", trades: "13" },
      {
        key: `USD.${TOKEN_SAMPLE_OTHER_ISSUER}`,
        pair: "RLUSD / USD",
        counter: "USD",
        issuer: TOKEN_SAMPLE_OTHER_ISSUER,
        href: `/xrpl/markets/RLUSD.${TOKEN_SAMPLE_ISSUER}/USD.${TOKEN_SAMPLE_OTHER_ISSUER}`,
        last: "2 USD",
        volume: "60",
        trades: "12",
      },
    ]);
  });

  it("links the pair in E3's natural orientation while the markets are on, and the row stays \"{CODE} / {COUNTER}\" whichever way the link goes", () => {
    const [native, issued, other] = marketRows(tokenDetailSample({ markets: [tokenMarketSample(), tokenMarketSample({ counter_currency: "USD", counter_issuer: TOKEN_SAMPLE_OTHER_ISSUER }), tokenMarketSample({ counter_currency: "ZZZ", counter_issuer: TOKEN_SAMPLE_OTHER_ISSUER })] }), XRPL_LINKED);
    // The native currency is the base against the better-ranked RLUSD: the link runs XRP/RLUSD, the row RLUSD / XRP. USD ranks better than RLUSD, so RLUSD is the base there.
    expect(native).toMatchObject({ pair: "RLUSD / XRP", href: `/xrpl/markets/XRP/RLUSD.${TOKEN_SAMPLE_ISSUER}` });
    expect(issued).toMatchObject({ pair: "RLUSD / USD", href: `/xrpl/markets/RLUSD.${TOKEN_SAMPLE_ISSUER}/USD.${TOKEN_SAMPLE_OTHER_ISSUER}` });
    // An unranked counter against a ranked token: the better-ranked RLUSD is the counter.
    expect(other).toMatchObject({ pair: "RLUSD / ZZZ", href: `/xrpl/markets/ZZZ.${TOKEN_SAMPLE_OTHER_ISSUER}/RLUSD.${TOKEN_SAMPLE_ISSUER}` });
  });

  it("has no link with the markets pages off, and none for a pair the data API cannot be asked for", () => {
    expect(marketRows(detail, XRPL).map((row) => row.href)).toEqual([null, null]);
    const odd = tokenDetailSample({ markets: [tokenMarketSample({ counter_currency: "U|D", counter_issuer: TOKEN_SAMPLE_OTHER_ISSUER })] });
    expect(marketRows(odd, XRPL_LINKED)[0]!.href).toBeNull();
  });

  it("writes a last price D6 does not have as a dash, and the volume of a pair with no native volume as one too", () => {
    const rows = marketRows(tokenDetailSample({ markets: [tokenMarketSample({ last: undefined, native_volume: undefined })] }), XRPL_LINKED);
    expect(rows[0]).toMatchObject({ last: "—", volume: "—" });
  });

  it("writes the last price to 8 significant digits, never in exponent form, and the volume compact", () => {
    const rows = marketRows(tokenDetailSample({ markets: [tokenMarketSample({ last: "1.2000000e-7", native_volume: "98765.4321", count: 12345 })] }), XRPL_LINKED);
    expect(rows[0]).toMatchObject({ last: "0.00000012 XRP", volume: "98.8K", trades: "12,345" });
  });

  it("is empty for a token with no pair, and keeps Xahau's native currency", () => {
    expect(marketRows(tokenDetailSample({ markets: [] }), XRPL_LINKED)).toEqual([]);
    expect(marketRows(tokenDetailSample({ markets: [tokenMarketSample({ counter_currency: "XAH" })] }), XAHAU_LINKED)[0]).toMatchObject({ pair: "RLUSD / XAH", href: `/xahau/markets/XAH/RLUSD.${TOKEN_SAMPLE_ISSUER}`, last: "0.4 XAH" });
  });
});

describe("poolRows", () => {
  const live = ok(volumeOf([AMM_POOL]));

  it("is the pool: its pair in the natural orientation, its page, its value, its fee and its volume of the day joined from the live components", () => {
    const pools = ammPoolsSample({ pools: [poolOf(1, { amm_account: AMM_POOL })], count: 1, marker: undefined });
    const { rows, more, volumeFailed } = poolRows(pools, live, ASSET, XRPL_LINKED);
    expect(rows).toEqual([
      { key: AMM_POOL, pair: "XRP / RLUSD", coins: ["XRP", "RLUSD"], href: `/xrpl/amm/${AMM_POOL}`, value: "5,000", fee: "0.500%", volume: "100" },
    ]);
    expect(more).toBeNull();
    expect(volumeFailed).toBe(false);
  });

  it("writes the volume of a native pool with no component as 0, of one without the native currency as a dash (E5's rule), and a dash for all when the live call failed", () => {
    const issued = poolOf(2, { counter_currency: "USD", counter_issuer: TOKEN_SAMPLE_OTHER_ISSUER });
    const pools = ammPoolsSample({ pools: [poolOf(1), issued], count: 2, marker: undefined });
    expect(poolRows(pools, live, ASSET, XRPL_LINKED).rows.map((row) => row.volume)).toEqual(["0", "—"]);
    const failed = poolRows(pools, FAILED, ASSET, XRPL_LINKED);
    expect(failed.rows.map((row) => row.volume)).toEqual(["—", "—"]);
    expect(failed.volumeFailed).toBe(true);
    expect(poolRows(pools, MISSING, ASSET, XRPL_LINKED).volumeFailed).toBe(true);
    // An answer with no row is no live set.
    expect(poolRows(pools, ok({ ...volumeOf([]), rows: [], count: 0 }), ASSET, XRPL_LINKED).volumeFailed).toBe(true);
  });

  it("shows the first five and leads to all the pools with the token while the AMM pages are on and there are more", () => {
    const six = ammPoolsSample({ pools: [1, 2, 3, 4, 5, 6].map((n) => poolOf(n)), count: 6, marker: undefined });
    const shown = poolRows(six, live, ASSET, XRPL_LINKED);
    expect(shown.rows.map((row) => row.key)).toEqual([1, 2, 3, 4, 5].map(ammPoolAccount));
    expect(shown.more).toBe(`/xrpl/amm?asset=RLUSD.${TOKEN_SAMPLE_ISSUER}`);
    expect(poolRows(six, live, ASSET, XRPL).more).toBeNull();
    // Five, and a marker: there are more than the answer holds.
    const marked = ammPoolsSample({ pools: [1, 2, 3, 4, 5].map((n) => poolOf(n)), count: 5 });
    expect(poolRows(marked, live, ASSET, XRPL_LINKED).more).not.toBeNull();
    const five = ammPoolsSample({ pools: [1, 2, 3, 4, 5].map((n) => poolOf(n)), count: 5, marker: undefined });
    expect(poolRows(five, live, ASSET, XRPL_LINKED).more).toBeNull();
  });

  it("leads each pool to its account page while the AMM pages are off", () => {
    const pools = ammPoolsSample({ pools: [poolOf(1, { amm_account: AMM_POOL })], count: 1, marker: undefined });
    expect(poolRows(pools, live, ASSET, XRPL).rows[0]!.href).toBe(`/xrpl/account/${AMM_POOL}`);
  });

  it("writes a value or a fee the pool lacks as a dash, and a pair the other way round in the natural orientation", () => {
    const pools = ammPoolsSample({
      pools: [poolOf(1, { value_native: undefined, trading_fee: undefined, base_currency: "XRP", base_issuer: undefined, counter_currency: TOKEN_SAMPLE_CURRENCY, counter_issuer: TOKEN_SAMPLE_ISSUER })],
      count: 1,
      marker: undefined,
    });
    expect(poolRows(pools, live, ASSET, XRPL_LINKED).rows[0]).toMatchObject({ pair: "XRP / RLUSD", value: "—", fee: "—" });
  });
});

describe("holderRows", () => {
  it("is the holders as D6 gives them: the share as a percent to 2 decimals, the meter against the first share, the balance and the limit exact", () => {
    const { rows } = holderRows(holdersSample(), CODE, { requireAuth: null });
    expect(rows.map((row) => [row.rank, row.holder, row.balance, row.share, row.limit, row.frozen])).toEqual([
      ["1", "rrrrrrrrrrrrrrrrrrcJYjXAZjD", "40.5", "0.55%", "1,000,000", true],
      ["2", "rrrrrrrrrrrrrrrrrrcJYdToyGA", "39.5", "0.54%", "1,000,000", false],
      ["3", "rrrrrrrrrrrrrrrrrrcJY2vaNnX", "38.5", "0.53%", "1,000,000", false],
    ]);
    expect(rows[0]!.meter).toMatchObject({ value: "0.005533", max: "0.005533" });
    expect(rows[2]!.meter).toMatchObject({ value: "0.005260", max: "0.005533" });
  });

  it("rounds half up at the 2nd decimal and keeps a share exactly", () => {
    const share = (value: string) => holderRows(holdersSample({ holders: [tokenHolderSample({ share: value })] }), CODE, { requireAuth: null }).rows[0]!.share;
    expect(share("0.117300")).toBe("11.73%");
    expect(share("0.117350")).toBe("11.74%");
    expect(share("0.117349")).toBe("11.73%");
    expect(share("1.000000")).toBe("100.00%");
    expect(share("0.000000")).toBe("0.00%");
  });

  it("sums the first ten shares exactly for the sentence of the top holders, with fewer rows its own count", () => {
    const rows = Array.from({ length: 12 }, (_, at) => tokenHolderSample({ rank: at + 1, holder: `r${at}`, share: "0.040000" }));
    expect(holderRows(holdersSample({ holders: rows }), CODE, { requireAuth: null }).top10).toBe("The top 10 hold 40.00% of the supply.");
    expect(holderRows(holdersSample(), CODE, { requireAuth: null }).top10).toBe("The top 3 hold 1.62% of the supply.");
    expect(holderRows(holdersSample({ holders: [tokenHolderSample({ share: "0.333333" })] }), CODE, { requireAuth: null }).top10).toBe("The top holder holds 33.33% of the supply.");
    // A float sum of 0.017400 and 0.001050 is 0.018449999999999998: the exact 1.845% rounds half up to 1.85%, and the float's would round down.
    const apart = [tokenHolderSample({ share: "0.017400" }), tokenHolderSample({ rank: 2, share: "0.001050" })];
    expect(holderRows(holdersSample({ holders: apart }), CODE, { requireAuth: null }).top10).toBe("The top 2 hold 1.85% of the supply.");
    expect(holderRows(holdersSample({ holders: [] }), CODE, { requireAuth: null })).toEqual({ rows: [], top10: "" });
  });

  it("shows Authorized only where the issuer requires authorisation: true shows it, false and not known (null) never", () => {
    const authorized = (requireAuth: boolean | null) => holderRows(holdersSample(), CODE, { requireAuth }).rows.map((row) => row.authorized);
    expect(authorized(true)).toEqual([false, false, true]);
    expect(authorized(false)).toEqual([false, false, false]);
    expect(authorized(null)).toEqual([false, false, false]);
  });

  it("groups the rank of a page that starts late, and gives a meter of nothing when the first share is zero", () => {
    const { rows } = holderRows(holdersSample({ holders: [tokenHolderSample({ rank: 1001, share: "0.000000" })] }), CODE, { requireAuth: null });
    expect(rows[0]).toMatchObject({ rank: "1,001", meter: { value: "0.000000", max: "0.000000" } });
  });
});

describe("tokenPage: the holders card", () => {
  it("is the top holders with the sentence, a way to all of them with the count from the token, and the require-auth setting read from D6", () => {
    const { holders } = pageOfToken();
    expect(holders).toMatchObject({
      state: "ok",
      source: `/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}/holders`,
      empty: null,
      top10: "The top 3 hold 1.62% of the supply.",
      all: { href: `/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}/holders`, label: "All 120 holders →" },
    });
    expect(holders?.state === "ok" && holders.rows).toHaveLength(3);
  });

  it("says no account holds the token, with no way to the holders", () => {
    const { holders } = pageOfToken(tokenInput({ holders: ok(holdersSample({ holders: [], count: 0, marker: undefined })) }));
    expect(holders).toMatchObject({ state: "ok", rows: [], empty: "No account holds RLUSD.", all: null });
  });

  it("fails on its own: the card's words and the problem", () => {
    const { page, problems } = tokenPage(tokenInput({ holders: FAILED }));
    expect(page.holders).toEqual({ source: `/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}/holders`, state: "failed", what: "the top holders" });
    expect(problems).toEqual([{ part: "holders" }]);
    expect(page.transfers.state).toBe("ok");
  });

  it("is not Authorized-marked when the issuer's settings are unknown (the node's answer is not asked for the holders)", () => {
    const { holders } = pageOfToken(withToken({ issuer_settings: undefined }));
    expect(holders?.state === "ok" && holders.rows.map((row) => row.authorized)).toEqual([false, false, false]);
    const required = pageOfToken(withToken({ issuer_settings: { ...tokenDetailSample().issuer_settings!, require_auth: true } }));
    expect(required.holders?.state === "ok" && required.holders.rows.map((row) => row.authorized)).toEqual([false, false, true]);
  });
});

describe("transferRows", () => {
  const issuer = TOKEN_SAMPLE_ISSUER;

  it("is the payments as D6 gives them: the time in unix seconds, the parties, the amount exact and the transaction", () => {
    expect(transferRows(transfersSample(), issuer)).toEqual([
      {
        key: "3EBBB8672ADA7B5EADBE3878740346DD60B667D4919E1084D2E140238F0D2044",
        time: Date.UTC(2026, 9, 24, 14, 21, 42) / 1000,
        from: "rfaF3eu2m192LkHKdxRfzd68oEC1paa57",
        to: "rMPwy3Ntx56Nyc2fKGNm7VRWdmpHSB92Z7",
        amount: "0.002",
        tag: null,
        hash: "3EBBB8672ADA7B5EADBE3878740346DD60B667D4919E1084D2E140238F0D2044",
      },
      expect.objectContaining({ amount: "0.2121364558499999", tag: null }),
    ]);
  });

  it("tags a payment from the issuer Issued and one to it Redeemed", () => {
    const answer = transfersSample({
      transfers: [tokenTransferSample({ source: issuer }), tokenTransferSample({ destination: issuer, hash: "B".repeat(64) }), tokenTransferSample({ hash: "C".repeat(64) })],
    });
    expect(transferRows(answer, issuer).map((row) => row.tag)).toEqual(["Issued", "Redeemed", null]);
  });

  it("writes an amount in exponent form in plain digits", () => {
    expect(transferRows(transfersSample({ transfers: [tokenTransferSample({ amount: "1.5e-7" })] }), issuer)[0]!.amount).toBe("0.00000015");
  });
});

describe("tokenPage: the transfers card", () => {
  it("is the recent transfers with the footnote about the issuer, the pager and the transfers' own coverage note", () => {
    const { transfers } = pageOfToken();
    expect(transfers).toMatchObject({
      state: "ok",
      title: "Recent transfers",
      source: `/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}/transfers`,
      empty: null,
      footnote: "Newest first. A transfer from rMxCKb…m5De issues new RLUSD; one to it redeems RLUSD.",
      coverage: { before: "Covers ledger ", ledger: 11999941, after: " onwards: earlier transfers are not in the index yet." },
      pager: { newerHref: null, olderHref: `/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}?marker=${TRANSFERS_MARKER}` },
    });
  });

  it("writes the issuer by its plain name where E9 gives it one", () => {
    const names: NamesPart = { state: "ok", map: { [TOKEN_SAMPLE_ISSUER]: { name: { text: "Ripple", kind: "verified" }, domain: "ripple.com", labels: [] } } };
    expect(pageOfToken(tokenInput({ names })).transfers).toMatchObject({ footnote: "Newest first. A transfer from Ripple issues new RLUSD; one to it redeems RLUSD." });
  });

  it("has no coverage note when it is complete, and says nothing has been delivered when there are no rows", () => {
    const { transfers } = pageOfToken(tokenInput({ transfers: ok(transfersSample({ coverage: tokenCoverageSample(), transfers: [], count: 0, marker: undefined })) }));
    expect(transfers).toMatchObject({ state: "ok", rows: [], empty: "No payment has delivered RLUSD yet.", coverage: null, pager: { newerHref: null, olderHref: null } });
  });

  it("leads Newer along the trail and Older to the next marker", () => {
    const params = { marker: "M2", back: ["M1", "M0"] };
    const { transfers } = pageOfToken(tokenInput({ params, transfers: ok(transfersSample({ marker: "M3" })) }));
    expect(transfers.state === "ok" && transfers.pager).toEqual({
      newerHref: `/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}?marker=M1&back=M0`,
      olderHref: `/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}?marker=M3&back=M2.M1.M0`,
    });
  });

  it("fails on its own: the card's words and the problem", () => {
    const { page, problems } = tokenPage(tokenInput({ transfers: FAILED }));
    expect(page.transfers).toEqual({ title: "Recent transfers", source: `/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}/transfers`, state: "failed", what: "the transfers" });
    expect(problems).toEqual([{ part: "transfers" }]);
  });
});

describe("tokenPage: the markets card", () => {
  it("is the rows, the source of the day and the footnote of the network's words", () => {
    const { markets } = pageOfToken();
    expect(markets).toMatchObject({
      source: `/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER} · last 24 h`,
      empty: null,
      footnote: "Prices are the counter currency per RLUSD. DEX and AMM trades of the last 24 hours.",
    });
    expect(markets?.rows).toHaveLength(2);
  });

  it("says DEX trades on Xahau, and that the token had no trades when it has no pair", () => {
    const xahau = pageOfToken(withToken({ markets: [] }, { net: XAHAU_LINKED, pools: null, ammVolume: null }));
    expect(xahau.markets).toMatchObject({ rows: [], empty: "RLUSD had no trades in the last 24 hours.", footnote: "Prices are the counter currency per RLUSD. DEX trades of the last 24 hours." });
  });
});

describe("tokenPage: the pools card", () => {
  it("is the rows, the source of the asset and the footnote in the native currency", () => {
    const { pools } = pageOfToken();
    expect(pools).toMatchObject({
      state: "ok",
      source: `/v2/amm/pools?asset=${TOKEN_SAMPLE_CURRENCY}+${TOKEN_SAMPLE_ISSUER}`,
      empty: null,
      more: null,
      note: null,
      footnote: "Value and volume in XRP.",
    });
  });

  it("leads to all the pools with the token, in the code's words, when there are more than five", () => {
    const six = ammPoolsSample({ pools: [1, 2, 3, 4, 5, 6].map((n) => poolOf(n)), count: 6, marker: undefined });
    const { pools } = pageOfToken(tokenInput({ pools: ok(six) }));
    expect(pools).toMatchObject({ more: { href: `/xrpl/amm?asset=RLUSD.${TOKEN_SAMPLE_ISSUER}`, label: "All pools with RLUSD →" } });
    expect(pools?.state === "ok" && pools.rows).toHaveLength(5);
  });

  it("says no pool holds the token", () => {
    const { pools } = pageOfToken(tokenInput({ pools: ok(ammPoolsSample({ pools: [], count: 0, marker: undefined })) }));
    expect(pools).toMatchObject({ state: "ok", rows: [], empty: "No AMM pool holds RLUSD." });
  });

  it("keeps the rows when only the live volume failed, and says so, with a dash for each volume", () => {
    const { page, problems } = tokenPage(tokenInput({ ammVolume: FAILED }));
    expect(page.pools).toMatchObject({ state: "ok", note: "Couldn't load the 24-hour volume" });
    expect(page.pools?.state === "ok" && page.pools.rows.map((row) => row.volume)).toEqual(["—"]);
    expect(problems).toEqual([{ part: "ammVolume" }]);
  });

  it("fails on its own: the card's words and the problem (and the volume's, when it failed too)", () => {
    const { page, problems } = tokenPage(tokenInput({ pools: FAILED }));
    expect(page.pools).toEqual({ source: `/v2/amm/pools?asset=${TOKEN_SAMPLE_CURRENCY}+${TOKEN_SAMPLE_ISSUER}`, state: "failed", what: "the AMM pools" });
    expect(problems).toEqual([{ part: "pools" }]);
    expect(tokenPage(tokenInput({ pools: FAILED, ammVolume: FAILED })).problems).toEqual([{ part: "pools" }, { part: "ammVolume" }]);
  });
});

describe("tokenPage: Xahau", () => {
  const xahau = (over: Partial<TokenInput> = {}) => pageOfToken(withToken({ toml_url: "https://example.org/.well-known/xahau.toml" }, { net: XAHAU_LINKED, pools: null, ammVolume: null, ...over }));

  it("has no pools card, and says the token trades on the order book only", () => {
    const page = xahau();
    expect(page.pools).toBeNull();
    expect(page.ammNote).toBe("Xahau has no AMM, so RLUSD trades only on the order book here.");
    expect(page.network).toMatchObject({ id: "xahau", native: "XAH", software: "xahaud" });
  });

  it("names the network of the sandbox in the note and Xahau's toml in the card and the button", () => {
    expect(xahau({ net: { ...XAHAU_LINKED, name: "Xahau Testnet" } }).ammNote).toBe("Xahau Testnet has no AMM, so RLUSD trades only on the order book here.");
    expect(xahau().head.toml).toEqual({ label: "xahau.toml", href: "https://example.org/.well-known/xahau.toml" });
    expect(xahau().toml).toMatchObject({ entry: { where: { text: "ripple.com/.well-known/xahau.toml" } } });
  });

  it("has the AMM note on XRPL nowhere", () => {
    expect(pageOfToken().ammNote).toBeNull();
  });
});

describe("tokenPage: a page of older transfers", () => {
  const older = (over: Partial<TokenInput> = {}) => tokenPage(tokenInput({ mode: "older", params: { marker: "M1", back: [] }, holders: null, pools: null, ammVolume: null, ...over }));

  it("is the header and the transfers only, with a way back to the first page", () => {
    const { page, problems } = older();
    expect(page.older).toBe(true);
    expect(page.head.code).toBe(CODE);
    expect(page.figures).toBeNull();
    expect(page.coverage).toBeNull();
    expect([page.toml, page.settings, page.markets, page.pools, page.holders, page.ammNote]).toEqual([null, null, null, null, null, null]);
    expect(page.back).toEqual({ href: `/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}`, label: "Back to RLUSD" });
    expect(page.transfers).toMatchObject({ state: "ok", title: "Older transfers" });
    expect(problems).toEqual([]);
  });

  it("goes back to the first page along Newer, and has its facts say it is behind a marker", () => {
    const { page } = older();
    expect(page.transfers.state === "ok" && page.transfers.pager.newerHref).toBe(`/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}`);
    expect(page.meta.more).toBe(true);
  });

  it("asks nothing of the cards it does not draw: Xahau's note is not there either, and a failed transfers card is a problem", () => {
    expect(older({ net: XAHAU_LINKED }).page.ammNote).toBeNull();
    const failed = older({ transfers: FAILED });
    expect(failed.page.transfers).toMatchObject({ state: "failed", title: "Older transfers" });
    expect(failed.page.back).not.toBeNull();
    expect(failed.problems).toEqual([{ part: "transfers" }]);
  });

  it("is not the first page's on the other mode: the first page has no way back", () => {
    expect(pageOfToken().older).toBe(false);
    expect(pageOfToken().back).toBeNull();
  });
});

describe("tokenPage: the problems", () => {
  it("lists each failed part, in the page's order (settings, pools, volume, holders, transfers)", () => {
    const { problems } = tokenPage(withToken({ issuer_settings: undefined }, { accountInfo: FAILED, pools: FAILED, ammVolume: FAILED, holders: FAILED, transfers: FAILED }));
    expect(problems).toEqual([{ part: "accountInfo" }, { part: "pools" }, { part: "ammVolume" }, { part: "holders" }, { part: "transfers" }]);
  });

  it("lists none when every call answered, and none for a part that was not asked", () => {
    expect(tokenPage(tokenInput()).problems).toEqual([]);
    expect(tokenPage(tokenInput({ pools: null, ammVolume: null })).problems).toEqual([]);
  });

  it("counts a missing holders, pools or transfers answer as a failure too (a token that vanished between the calls)", () => {
    expect(tokenPage(tokenInput({ holders: MISSING, pools: MISSING, transfers: MISSING })).problems).toEqual([{ part: "pools" }, { part: "holders" }, { part: "transfers" }]);
  });
});

describe("tokenPage: the names", () => {
  it("are the loader's part, as it is, and the issuer's name reaches the toml card", () => {
    const part: NamesPart = { state: "ok", map: { [TOKEN_SAMPLE_ISSUER]: { name: { text: "Ripple", kind: "verified" }, domain: "ripple.com", labels: [] } } };
    const page = pageOfToken(tokenInput({ names: part }));
    expect(page.names).toBe(part);
    expect(page.toml).toMatchObject({ verified: true });
    expect(pageOfToken(tokenInput({ names: NAMES_OFF })).names).toBe(NAMES_OFF);
  });
});

describe("tokenFacts", () => {
  const detail = tokenDetailSample();

  it("are what the tags and the image read: the code, the name, the issuer, the holders, the supply, the domain that lists it and where the page is", () => {
    expect(tokenFacts(XRPL, detail, false)).toEqual({
      code: "RLUSD",
      name: "Ripple USD",
      issuer: TOKEN_SAMPLE_ISSUER,
      holders: "120",
      supply: "7,320",
      listedBy: "ripple.com",
      href: `/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}`,
      segment: `RLUSD.${TOKEN_SAMPLE_ISSUER}`,
      more: false,
    });
    expect(tokenPage(tokenInput()).page.meta).toEqual(tokenFacts(XRPL, detail, false));
    expect(tokenPage(tokenInput({ mode: "older", params: { marker: "M", back: [] } })).page.meta.more).toBe(true);
  });

  it("have no name for a token the toml does not name, and no domain for one it does not list", () => {
    const facts = tokenFacts(XRPL, tokenDetailSample({ toml: undefined, listed: false }), false);
    expect(facts).not.toHaveProperty("name");
    expect(facts).not.toHaveProperty("listedBy");
    // A domain without a listing is not "listed by": the image says only what the toml lists.
    expect(tokenFacts(XRPL, tokenDetailSample({ listed: false }), false)).not.toHaveProperty("listedBy");
  });

  it("write the segment as the canonical path does: escaped for a path, whatever the code holds", () => {
    const facts = tokenFacts(XRPL, tokenDetailSample({ currency: "5A2F23405E2A2F2F000000000000000000000000" }), false);
    expect(facts.href).toBe(`/xrpl/token/${facts.segment}`);
  });

  it("take the bidi controls out of the name", () => {
    expect(tokenFacts(XRPL, tokenDetailSample({ toml: { name: "Ripple‮ USD" } }), false).name).toBe("Ripple USD");
  });
});

// ---- The holders page (spec 4) --------------------------------------------------------------------------------------------------------------------------------------

describe("tokenHoldersPage", () => {
  const HOLDERS_PATH = `/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}/holders`;
  const holdersInput = (over: Partial<TokenHoldersInput> = {}): TokenHoldersInput => ({
    net: XRPL_LINKED,
    asset: ASSET,
    answer: tokenSample(),
    holders: ok(holdersSample()),
    params: { back: [] },
    names: NO_NAMES,
    ...over,
  });
  const holdersPage = (over: Partial<TokenHoldersInput> = {}) => tokenHoldersPage(holdersInput(over)).page;
  /** The list of a page whose holders were answered. */
  const okList = (over: Partial<TokenHoldersInput> = {}) => {
    const { holders } = holdersPage(over);
    if (holders.state !== "ok") throw new Error("the holders list failed");
    return holders;
  };

  it("is the head: the title, the line of how many hold how much, the issuer, and the way back to the token", () => {
    const page = holdersPage();
    expect(page.kind).toBe("token-holders");
    expect(page.network).toMatchObject({ id: "xrpl", name: "XRPL", native: "XRP" });
    expect(page.head).toEqual({
      code: "RLUSD",
      title: "Holders of RLUSD",
      summary: "120 accounts hold 7,320 RLUSD",
      issuer: TOKEN_SAMPLE_ISSUER,
      token: { href: `/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}`, label: "Back to RLUSD" },
    });
  });

  it("writes the line from the token's own figures with BigNumber: the supply exact with its thousands grouped, one account in the singular", () => {
    expect(holdersPage(withHolders({ holders: 1_284, supply: "21898528.59363" })).head.summary).toBe("1,284 accounts hold 21,898,528.59363 RLUSD");
    expect(holdersPage(withHolders({ holders: 1, supply: "5" })).head.summary).toBe("1 account holds 5 RLUSD");
    expect(holdersPage(withHolders({ holders: 0, supply: "0" })).head.summary).toBe("0 accounts hold 0 RLUSD");
  });

  it("is the display code of a code that is hex: the title and the line say it as text, the hex stays out of the head", () => {
    const page = holdersPage(withHolders({ currency: "5A2F23405E2A2F2F000000000000000000000000" }));
    expect(page.head.code).toBe("Z/#@^*//");
    expect(page.head.title).toBe("Holders of Z/#@^*//");
  });

  it("has the rows of the holders: the rank D6 gives, the holder, the balance, the share, the meter, the limit, and the status", () => {
    const list = okList();
    expect(list.rows.map((row) => [row.rank, row.holder, row.balance, row.share, row.limit, row.frozen, row.authorized])).toEqual([
      ["1", "rrrrrrrrrrrrrrrrrrcJYjXAZjD", "40.5", "0.55%", "1,000,000", true, false],
      ["2", "rrrrrrrrrrrrrrrrrrcJYdToyGA", "39.5", "0.54%", "1,000,000", false, false],
      ["3", "rrrrrrrrrrrrrrrrrrcJY2vaNnX", "38.5", "0.53%", "1,000,000", false, false],
    ]);
    expect(list.rows[2]!.meter).toMatchObject({ value: "0.005260", max: "0.005533" });
    expect(list.source).toBe(`/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}/holders`);
    expect(list.empty).toBeNull();
  });

  it("shows Authorized only where the issuer requires authorisation: from the token's issuer_settings, never when they are not known", () => {
    const authorized = (over: Partial<TokenDetail>) => okList(withHolders(over)).rows.map((row) => row.authorized);
    const settings = tokenDetailSample().issuer_settings!;
    expect(authorized({ issuer_settings: { ...settings, require_auth: true } })).toEqual([false, false, true]);
    expect(authorized({ issuer_settings: { ...settings, require_auth: false } })).toEqual([false, false, false]);
    expect(authorized({ issuer_settings: undefined })).toEqual([false, false, false]);
  });

  it("continues the ranks on page 2: the rank is the place in the whole ranking, whatever the page", () => {
    const second = holdersSample({ holders: [tokenHolderSample({ rank: 51, holder: "rA" }), tokenHolderSample({ rank: 52, holder: "rB" }), tokenHolderSample({ rank: 1_051, holder: "rC" })] });
    expect(okList({ holders: ok(second), params: { marker: "M2", back: ["M1"] } }).rows.map((row) => row.rank)).toEqual(["51", "52", "1,051"]);
  });

  it("pages by the trail: More holders carries the marker and this page's own marker behind it, Previous goes back along the trail, and the first page has no Previous", () => {
    const first = okList();
    expect(first.pager).toEqual({ newerHref: null, olderHref: `${HOLDERS_PATH}?marker=${HOLDERS_MARKER}`, labels: { newer: "Previous", older: "More holders" } });

    const second = okList({ params: { marker: HOLDERS_MARKER, back: [] } });
    expect(second.pager.newerHref).toBe(HOLDERS_PATH);
    expect(second.pager.olderHref).toBe(`${HOLDERS_PATH}?marker=${HOLDERS_MARKER}&back=${HOLDERS_MARKER}`);

    const third = okList({ holders: ok(holdersSample({ marker: "M3" })), params: { marker: "M2", back: ["M1"] } });
    expect(third.pager.newerHref).toBe(`${HOLDERS_PATH}?marker=M1`);
    expect(third.pager.olderHref).toBe(`${HOLDERS_PATH}?marker=M3&back=M2.M1`);

    expect(okList({ holders: ok(holdersSample({ marker: undefined })), params: { marker: "M2", back: [] } }).pager.olderHref).toBeNull();
  });

  it("carries the holders answer's coverage as the note of the trust lines, and none when it is complete", () => {
    expect(okList({ holders: ok(holdersSample({ coverage: tokenCoverageSample({ complete: false, from_ledger_index: 93663334 }) })) }).coverage).toMatchObject({ ledger: 93663334 });
    expect(okList().coverage).toBeNull();
  });

  it("says no account holds the token on an empty first page, with no pager", () => {
    const list = okList({ holders: ok(holdersSample({ holders: [], count: 0, marker: undefined })) });
    expect(list).toMatchObject({ rows: [], empty: "No account holds RLUSD.", pager: { newerHref: null, olderHref: null } });
  });

  it("explains the columns in a footnote", () => {
    expect(okList().footnote).toBe("Largest balance first. Limit is the most a holder's trust line can hold. Authorized is shown only where the issuer must approve each trust line.");
  });

  it("fails on its own: the card's words, the source, and the problem; the head stands", () => {
    for (const holders of [FAILED, MISSING]) {
      const { page, problems } = tokenHoldersPage(holdersInput({ holders }));
      expect(page.holders).toEqual({ source: `/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}/holders`, state: "failed", what: "the holders" });
      expect(page.head.title).toBe("Holders of RLUSD");
      expect(problems).toEqual([{ part: "holders" }]);
    }
    expect(tokenHoldersPage(holdersInput()).problems).toEqual([]);
  });

  it("is Xahau's and the sandbox's on their networks: the native currency and the name come from the network", () => {
    expect(holdersPage({ net: XAHAU_LINKED, asset: { currency: TOKEN_SAMPLE_CURRENCY, issuer: TOKEN_SAMPLE_ISSUER } }).network).toMatchObject({ id: "xahau", native: "XAH" });
    expect(holdersPage({ net: XAHAU_LINKED }).head.token.href).toBe(`/xahau/token/RLUSD.${TOKEN_SAMPLE_ISSUER}`);
    expect(holdersPage({ net: { ...XRPL_LINKED, ...TESTNET } }).network.name).toBe("XRPL Testnet");
  });

  it("hands on the names as the loader has them", () => {
    const part: NamesPart = { state: "ok", map: { rrrrrrrrrrrrrrrrrrcJYjXAZjD: { name: { text: "Ripple", kind: "verified" }, domain: "ripple.com", labels: [] } } };
    expect(holdersPage({ names: part }).names).toBe(part);
    expect(holdersPage({ names: NAMES_OFF }).names).toBe(NAMES_OFF);
  });

  it("writes the facts of its tags: the display code, the issuer, where the first page is, and whether it is behind a marker", () => {
    expect(holdersPage().meta).toEqual({ code: "RLUSD", issuer: TOKEN_SAMPLE_ISSUER, href: HOLDERS_PATH, more: false });
    expect(holdersPage({ params: { marker: "M2", back: ["M1"] } }).meta).toEqual({ code: "RLUSD", issuer: TOKEN_SAMPLE_ISSUER, href: HOLDERS_PATH, more: true });
  });

  /** The same input with the token replaced by `over`'s fields. */
  function withHolders(over: Partial<TokenDetail>): Partial<TokenHoldersInput> {
    return { answer: tokenSample({ token: tokenDetailSample(over) }) };
  }
});
