import { describe, expect, it } from "vitest";

import {
  holdersSample,
  TOKEN_SAMPLE_CURRENCY,
  TOKEN_SAMPLE_ISSUER,
  tokenDetailSample,
  tokenHolderSample,
  tokenMarketSample,
  tokenRowSample,
  tokenSample,
  tokensSample,
  tokenTransferSample,
  transfersSample,
  TOKEN_SAMPLE_OTHER_ISSUER,
} from "../../test/support/token-samples";
import { checkToken, checkTokenHolders, checkTokens, checkTokenTransfers } from "./token-shape";
import { UpstreamError } from "./upstream";

// The examples are the ones of data-api's docs/api-reference.md ("Tokens", feat/explorer-data-2 at 2fb4183), with addresses that exist (test/support/token-samples.ts). A defect is one change
// to an example.

/** A body to be broken in some way: a test reaches into it as it likes. */
type Body = any;
/** What is wrong, the field the message must name, and the change that makes it so. */
type Defect = [what: string, field: string, change: (body: Body) => void];

const clone = <T>(value: T): T => structuredClone(value);

/** An X-address (a classic address with a tag flag): it holds a tag, and a page links accounts. */
const X_ADDRESS = "XVNrKpKNWdzFVWZ5Vo2s8SsALv9gxNAt4Q7FCL34NVn2LWW";
const ASKED = { currency: TOKEN_SAMPLE_CURRENCY, issuer: TOKEN_SAMPLE_ISSUER };

/** The request each check is told it answers, which its message names. */
const PATH = {
  tokens: "/v2/tokens?kind=issued&limit=20",
  token: `/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}`,
  holders: `/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}/holders?limit=10`,
  transfers: `/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}/transfers?descending=true&limit=20`,
} as const;
/** Each check as the client calls it (`finish` of its call). */
const askTokens = (body: unknown) => checkTokens(body, PATH.tokens);
const askToken = (body: unknown) => checkToken(body, PATH.token, ASKED);
const askHolders = (body: unknown) => checkTokenHolders(body, PATH.holders);
const askTransfers = (body: unknown) => checkTokenTransfers(body, PATH.transfers);
/** Each with the sample of its answer. */
const FOUR = [
  ["tokens", askTokens, () => tokensSample()],
  ["token", askToken, () => tokenSample()],
  ["holders", askHolders, () => holdersSample()],
  ["transfers", askTransfers, () => transfersSample()],
] as const;

/** What every message says between the request and the reason. */
const WHY = "answered something unexpected: ";

/** The check refuses `body` as an `UpstreamError` of kind `server` that marks an answer of the upstream (status 200), and its message names the request, and `field` in its reason. */
function refuses(check: (body: unknown) => unknown, path: string, body: unknown, field: string): void {
  let error: unknown;
  try {
    check(body);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UpstreamError);
  expect((error as UpstreamError).kind).toBe("server");
  expect((error as UpstreamError).status).toBe(200);
  const { message } = error as UpstreamError;
  expect(message).toContain(`data API GET ${path}`);
  // The field is looked for in the reason alone: every message holds the path, and a field named "tokens" or "holders" is in that.
  expect(message).toContain(WHY);
  expect(message.slice(message.indexOf(WHY) + WHY.length)).toContain(field);
}

describe("the helper that looks for a field", () => {
  it('looks for it in the reason, not in the request every message holds: a close_time that is wrong is not a failure of "holders"', () => {
    const body = holdersSample();
    body.close_time = "2026-10-29";

    refuses(askHolders, PATH.holders, body, "close_time");
    expect(() => refuses(askHolders, PATH.holders, body, "holders")).toThrow();
    expect(() => refuses(askHolders, PATH.holders, body, "v2")).toThrow();
  });
});

describe("every check", () => {
  it.each(FOUR)("accepts a well-formed %s and returns it", (_name, check, sample) => {
    const good = sample();
    expect(check(good)).toBe(good);
  });

  it.each(FOUR)("refuses a %s answer that is no object, with a server error", (name, check) => {
    for (const body of [null, undefined, "success", 7, []]) refuses(check, PATH[name], body, "answer");
  });
});

/** What every answer starts with: `result`, and a coverage that is one. */
const answerDefects: Defect[] = [
  ["no result", "result", (b) => delete b.result],
  ["a result that is not success", "result", (b) => (b.result = "error")],
  ["no coverage", "coverage", (b) => delete b.coverage],
  ["a coverage that is text", "coverage", (b) => (b.coverage = "complete")],
  ["a coverage without complete", "coverage.complete", (b) => (b.coverage = { from_ledger_index: 32570 })],
  ["a coverage whose complete is text", "coverage.complete", (b) => (b.coverage = { from_ledger_index: 32570, complete: "true" })],
  ["a coverage whose ledger is fractional", "coverage.from_ledger_index", (b) => (b.coverage = { from_ledger_index: 1.5, complete: true })],
  ["a coverage whose ledger is 0", "coverage.from_ledger_index", (b) => (b.coverage = { from_ledger_index: 0, complete: true })],
];

/** The ledger the list, the detail and the holders are as of, when the answer has it. */
const asOfDefects: Defect[] = [
  ["a ledger_index that is text", "ledger_index", (b) => (b.ledger_index = "107900000")],
  ["a ledger_index that is negative", "ledger_index", (b) => (b.ledger_index = -1)],
  ["a close_time that is no time", "close_time", (b) => (b.close_time = "2026-10-29")],
];

/** What every list has: its rows are a list of objects, with a count and, when there is a next page, a marker. */
const listDefects = (key: string): Defect[] => [
  [`${key} that are an object`, key, (b) => (b[key] = {})],
  [`no ${key}`, key, (b) => delete b[key]],
  [`a row that is text in ${key}`, `${key}[0]`, (b) => (b[key][0] = "row")],
  ["a count that is text", "count", (b) => (b.count = "2")],
  ["no count", "count", (b) => delete b.count],
  ["a marker that is none", "marker", (b) => (b.marker = "not a marker!")],
  ...answerDefects,
];

/** Each defect of an object, as a defect of the body that holds it (`at` is where, `holds` a function that reaches it). */
const within = (at: string, holds: (body: Body) => Body, defects: Defect[]): Defect[] =>
  defects.map(([what, field, change]): Defect => [`${what}, in ${at}`, field, (body) => change(holds(body))]);

const missing = (name: string): Defect => [`no ${name}`, name, (o) => delete o[name]];
const wrong = (what: string, name: string, value: unknown): Defect => [what, name, (o) => (o[name] = value)];
/** Each way a text that is a number as text (a decimal, or one in exponent form) is not one. */
const numberTextDefects = (name: string): Defect[] => [
  wrong(`a ${name} that is a number`, name, 1),
  wrong(`a ${name} that is empty`, name, ""),
  wrong(`a ${name} that is NaN`, name, "NaN"),
  wrong(`a ${name} that is Infinity`, name, "Infinity"),
  wrong(`a ${name} with an exponent of four digits`, name, "1e9999"),
  wrong(`a ${name} that is words`, name, "one"),
];

/** What a row of the list and the token of the detail have in common. */
const tokenDefects: Defect[] = [
  missing("currency"),
  wrong("a currency that is empty", "currency", ""),
  wrong("a code that is empty", "code", ""),
  wrong("a code that is a number", "code", 1),
  missing("issuer"),
  wrong("an issuer that is an X-address", "issuer", X_ADDRESS),
  wrong("an issuer that is no address", "issuer", "rNope"),
  missing("holders"),
  wrong("holders that are text", "holders", "120"),
  wrong("holders that are fractional", "holders", 1.5),
  wrong("holders that are negative", "holders", -1),
  wrong("trust_lines that are text", "trust_lines", "150"),
  missing("supply"),
  ...numberTextDefects("supply"),
  wrong("a price_change in exponent form", "price_change", "1e-7"),
  wrong("a price_change that is a number", "price_change", -20),
  wrong("a price_time that is no time", "price_time", "2026-10-29"),
  ...numberTextDefects("native_volume"),
  wrong("trades that are text", "trades", "35"),
  wrong("a domain that is a number", "domain", 1),
  missing("listed"),
  wrong("a listed that is text", "listed", "true"),
];

describe("the check of the tokens answer", () => {
  const check = askTokens;

  it.each([
    ...listDefects("tokens"),
    ...asOfDefects,
    wrong("a kind that is not issued", "kind", "mpt"),
    missing("kind"),
    wrong("totals that are text", "totals", "none"),
    ...within("totals", (b) => b.totals, [
      missing("tokens"),
      wrong("tokens that are text", "tokens", "15"),
      missing("tokens_with_10_holders"),
      wrong("tokens_with_10_holders that are negative", "tokens_with_10_holders", -1),
      wrong("holders that are text", "holders", "4321"),
      wrong("holders that are fractional", "holders", 1.5),
      ...numberTextDefects("native_volume"),
    ]),
    wrong("a total that is text", "total", "15"),
    wrong("a total_below that is text", "total_below", "0"),
    ...within(
      "a row",
      (b) => b.tokens[0],
      [missing("rank"), wrong("a rank that is text", "rank", "1"), wrong("a rank that is fractional", "rank", 1.5), ...tokenDefects, wrong("a name that is a number", "name", 1)],
    ),
  ] satisfies Defect[])("refuses %s", (_what, field, defect) => {
    const body = clone(tokensSample());
    defect(body);
    refuses(check, PATH.tokens, body, field);
  });

  it("takes the answer before the first generation exists: no totals, no total, no ledger, and no tokens", () => {
    const none = { result: "success", coverage: { complete: false }, kind: "issued", count: 0, tokens: [] };
    expect(check(none)).toBe(none);
  });

  it("takes totals without holders, which D6 leaves out until the job has counted them, and without native_volume while there is no day set", () => {
    const body = tokensSample();
    delete body.totals!.holders;
    delete body.totals!.native_volume;
    expect(check(body)).toBe(body);
  });

  it("takes an answer with no totals and no total, and one with a total_below", () => {
    const body = tokensSample({ total_below: 2 });
    delete body.totals;
    delete body.total;
    expect(check(body)).toBe(body);
  });

  it("takes the row of a token that has not traded: no price, no change, no price_time, no domain and no name, and a volume of 0", () => {
    const row = tokenRowSample({ native_volume: "0", trades: 0, listed: false });
    for (const key of ["price", "price_change", "price_time", "domain", "name"] as const) delete row[key];
    const body = tokensSample({ tokens: [row], count: 1 });
    expect(check(body)).toBe(body);
  });

  it("leaves out the price of a row that D6 gave no number (Infinity), and takes the other rows and the rest of that row as they are", () => {
    for (const price of ["Infinity", "-Infinity", "NaN", "", "unknown", 0.4, null]) {
      const other = tokenRowSample({ rank: 3, currency: "EUR", code: "EUR", price: "2.5000000e-7" });
      const body = tokensSample({ tokens: [tokenRowSample({ rank: 1 }), tokenRowSample({ rank: 2, issuer: TOKEN_SAMPLE_OTHER_ISSUER }), other], count: 3 });
      body.tokens[0]!.price = price as never;

      const checked = check(body);

      expect(checked, String(price)).toBe(body);
      expect("price" in checked.tokens[0]!, String(price)).toBe(false);
      const { price: _price, ...rest } = tokenRowSample({ rank: 1 });
      expect(checked.tokens[0], String(price)).toStrictEqual(rest);
      expect(checked.tokens[1], String(price)).toStrictEqual(tokenRowSample({ rank: 2, issuer: TOKEN_SAMPLE_OTHER_ISSUER }));
      expect(checked.tokens[2], String(price)).toStrictEqual(other);
    }
  });

  it("does not forgive another field of a row: a native_volume, a price_change or a supply of Infinity still fails the list", () => {
    for (const change of [{ native_volume: "Infinity" }, { price_change: "Infinity" }, { supply: "Infinity" }]) {
      const [field] = Object.keys(change);
      refuses(check, PATH.tokens, tokensSample({ tokens: [tokenRowSample(change)] }), `tokens[0].${field}`);
    }
  });

  it("takes prices and volumes in exponent form, which D6 writes for a price below 0.000001 and from 100,000,000", () => {
    const body = tokensSample({
      tokens: [tokenRowSample({ price: "1.2000000e-7", native_volume: "1.5e+21", supply: "1.2345679e+8" }), tokenRowSample({ rank: 2, price: "9.9000000e-7", price_change: "0.00" })],
      totals: { tokens: 15, tokens_with_10_holders: 9, holders: 4321, native_volume: "2.435e+21" },
    });
    expect(check(body)).toBe(body);
  });

  it("takes a price_change that is negative, and one that is 0", () => {
    const body = tokensSample({ tokens: [tokenRowSample({ price_change: "-20.00" }), tokenRowSample({ rank: 2, price_change: "0.00" })] });
    expect(check(body)).toBe(body);
  });
});

describe("the check of the token answer", () => {
  const check = askToken;
  const market = (b: Body) => b.token.markets[0];

  it.each([
    ...answerDefects,
    ...asOfDefects,
    missing("ledger_index"),
    missing("close_time"),
    missing("token"),
    wrong("a token that is text", "token", "RLUSD"),
    ...within("the token", (b) => b.token, [
      ...tokenDefects,
      missing("last_ledger"),
      wrong("a last_ledger that is text", "last_ledger", "107899990"),
      wrong("a toml_url that is a number", "toml_url", 1),
      wrong("a toml that is text", "toml", "Ripple USD"),
      wrong("issuer_settings that are text", "issuer_settings", "default"),
      wrong("markets that are an object", "markets", {}),
      missing("markets"),
    ]),
    ["a market that is text", "markets[0]", (b) => (b.token.markets[0] = "XRP")],
    ...within("the toml", (b) => b.token.toml, [
      wrong("a name that is a number", "name", 1),
      wrong("a desc that is a number", "desc", 1),
      wrong("an icon that is a number", "icon", 1),
      wrong("a symbol that is a number", "symbol", 1),
      wrong("an asset_class that is a number", "asset_class", 1),
      wrong("an asset_subclass that is a number", "asset_subclass", 1),
      wrong("an attestation that is a number", "attestation", 1),
      wrong("display_decimals 31", "display_decimals", 31),
      wrong("display_decimals -1", "display_decimals", -1),
      wrong("display_decimals 2.5", "display_decimals", 2.5),
      wrong("display_decimals that is text", "display_decimals", "2"),
    ]),
    ...within("the issuer's settings", (b) => b.token.issuer_settings, [
      missing("transfer_fee"),
      wrong("a transfer_fee that is a number", "transfer_fee", 0.2),
      wrong("a transfer_fee in exponent form", "transfer_fee", "2e-1"),
      missing("global_freeze"),
      wrong("a global_freeze that is text", "global_freeze", "false"),
      missing("no_freeze"),
      wrong("a no_freeze that is a number", "no_freeze", 0),
      wrong("an allow_trust_line_clawback that is text", "allow_trust_line_clawback", "true"),
      wrong("a require_auth that is text", "require_auth", "false"),
      wrong("a default_ripple that is a number", "default_ripple", 1),
    ]),
    ...within("a market", market, [
      missing("counter_currency"),
      wrong("a counter_currency that is empty", "counter_currency", ""),
      wrong("a counter_issuer that is an X-address", "counter_issuer", X_ADDRESS),
      wrong("a count that is text", "count", "13"),
      missing("volume"),
      ...numberTextDefects("volume"),
      missing("counter_volume"),
      ...numberTextDefects("counter_volume"),
      ...numberTextDefects("native_volume"),
      wrong("a change in exponent form", "change", "1e-7"),
      wrong("a change that is a number", "change", -20),
      missing("last_time"),
      wrong("a last_time that is no time", "last_time", "2026-10-29"),
      wrong("an amm_pool that is text", "amm_pool", "false"),
    ]),
  ] satisfies Defect[])("refuses %s", (_what, field, defect) => {
    const body = clone(tokenSample());
    defect(body);
    refuses(check, PATH.token, body, field);
  });

  it("refuses the answer for another token than the one asked, naming what differs", () => {
    refuses(check, PATH.token, tokenSample({ token: tokenDetailSample({ issuer: TOKEN_SAMPLE_OTHER_ISSUER }) }), "token.issuer");
    refuses(check, PATH.token, tokenSample({ token: tokenDetailSample({ currency: "524C555345000000000000000000000000000000" }) }), "token.currency");
    refuses(check, PATH.token, tokenSample({ token: tokenDetailSample({ currency: "USD" }) }), "token.currency");
    // The currency is compared as the client wrote it into the path, the ledger's own form: the same hex in lower case is not it.
    refuses(check, PATH.token, tokenSample({ token: tokenDetailSample({ currency: TOKEN_SAMPLE_CURRENCY.toLowerCase() }) }), "token.currency");
  });

  it("takes a token with no code, no domain, no toml, no issuer settings, no price and no market", () => {
    const body = tokenSample({ token: tokenDetailSample({ markets: [], listed: false }) });
    for (const key of ["code", "domain", "toml_url", "toml", "issuer_settings", "price", "price_change", "price_time"] as const) delete body.token[key];
    expect(check(body)).toBe(body);
  });

  it("takes an empty toml, and a display_decimals of 0 and of 30", () => {
    for (const toml of [{}, { display_decimals: 0 }, { display_decimals: 30 }]) {
      const body = tokenSample({ token: tokenDetailSample({ toml }) });
      expect(check(body)).toBe(body);
    }
  });

  it("takes a market with no counter_issuer (the native currency), no native_volume, no change and no amm_pool", () => {
    const body = tokenSample();
    for (const key of ["counter_issuer", "native_volume", "change", "amm_pool"] as const) delete body.token.markets[0]![key];
    expect(check(body)).toBe(body);
  });

  it("takes prices and volumes in exponent form, in the token and in its markets", () => {
    const body = tokenSample({
      token: tokenDetailSample({
        price: "1.2000000e-7",
        markets: [tokenMarketSample({ last: "1.2000000e-7", volume: "1.2345679e+8", counter_volume: "14.814815", native_volume: "14.814815" }), tokenMarketSample({ last: "8.3333333e+6" })],
      }),
    });
    expect(check(body)).toBe(body);
  });

  it("leaves out the last of a market that D6 gave no number (a pair whose stored rate is 0 gives Infinity), and takes the rest as it is", () => {
    for (const last of ["Infinity", "-Infinity", "NaN", "", "unknown", 0.5, null]) {
      const other = tokenMarketSample({ counter_currency: "EUR", counter_issuer: TOKEN_SAMPLE_OTHER_ISSUER });
      const body = tokenSample({ token: tokenDetailSample({ markets: [tokenMarketSample(), other] }) });
      body.token.markets[0]!.last = last as never;

      const checked = check(body);

      expect(checked, String(last)).toBe(body);
      expect("last" in checked.token.markets[0]!, String(last)).toBe(false);
      // The rest of that market is as it was, and the other market and the token are whole.
      const { last: _last, ...rest } = tokenMarketSample();
      expect(checked.token.markets[0], String(last)).toStrictEqual(rest);
      expect(checked.token.markets[1], String(last)).toStrictEqual(other);
      expect(checked.token.price, String(last)).toBe("0.40000000");
    }
  });

  it("does not leave out a last it can read: a decimal and one in exponent form", () => {
    const body = tokenSample({ token: tokenDetailSample({ markets: [tokenMarketSample({ last: "0.5" }), tokenMarketSample({ last: "2.5000000e-7" })] }) });
    check(body);
    expect(body.token.markets.map((m) => m.last)).toEqual(["0.5", "2.5000000e-7"]);
  });

  it("leaves out the price of the token that D6 gave no number (a token that is the counter side of its native pair, whose stored rate is 0, has Infinity), and takes the rest as it is", () => {
    for (const price of ["Infinity", "-Infinity", "NaN", "", "unknown", 0.4, null]) {
      const body = tokenSample({ token: tokenDetailSample() });
      body.token.price = price as never;

      const checked = check(body);

      expect(checked, String(price)).toBe(body);
      expect("price" in checked.token, String(price)).toBe(false);
      // The rest of the token is as it was: the change and the time of the price, the volume and the markets.
      const { price: _price, ...rest } = tokenDetailSample();
      expect(checked.token, String(price)).toStrictEqual(rest);
    }
  });

  it("does not leave out a price it can read: a decimal and one in exponent form", () => {
    for (const price of ["0.40000000", "1.2000000e-7", "1.2345679e+8"]) {
      const body = tokenSample({ token: tokenDetailSample({ price }) });
      check(body);
      expect(body.token.price).toBe(price);
    }
  });

  it("does not forgive another field of a market, nor another field of the token: only last and price are left out", () => {
    refuses(check, PATH.token, tokenSample({ token: tokenDetailSample({ markets: [tokenMarketSample({ volume: "Infinity" })] }) }), "markets[0].volume");
    refuses(check, PATH.token, tokenSample({ token: tokenDetailSample({ native_volume: "Infinity" }) }), "token.native_volume");
    refuses(check, PATH.token, tokenSample({ token: tokenDetailSample({ price_change: "Infinity" }) }), "token.price_change");
    refuses(check, PATH.token, tokenSample({ token: tokenDetailSample({ supply: "Infinity" }) }), "token.supply");
  });
});

describe("the check of the holders answer", () => {
  const check = askHolders;

  it.each([
    ...listDefects("holders"),
    ...asOfDefects,
    missing("ledger_index"),
    missing("close_time"),
    missing("supply"),
    ...numberTextDefects("supply"),
    ...within("a holder", (b) => b.holders[0], [
      missing("rank"),
      wrong("a rank that is text", "rank", "1"),
      missing("holder"),
      wrong("a holder that is an X-address", "holder", X_ADDRESS),
      wrong("a holder that is no address", "holder", "rNope"),
      missing("balance"),
      ...numberTextDefects("balance"),
      missing("share"),
      wrong("a share with 4 decimals", "share", "0.0055"),
      wrong("a share with 7 decimals", "share", "0.0055330"),
      wrong("a share with no decimals", "share", "1"),
      wrong("a share that is a number", "share", 0.005533),
      wrong("a share in exponent form", "share", "5.533e-3"),
      wrong("a share that is negative", "share", "-0.005533"),
      wrong("a share that ends in a point", "share", "0."),
      missing("limit"),
      ...numberTextDefects("limit"),
      missing("frozen"),
      wrong("a frozen that is text", "frozen", "false"),
      missing("authorized"),
      wrong("an authorized that is a number", "authorized", 0),
    ]),
  ] satisfies Defect[])("refuses %s", (_what, field, defect) => {
    const body = clone(holdersSample());
    defect(body);
    refuses(check, PATH.holders, body, field);
  });

  it("takes a share of 0.000000 (a dust balance rounds to it) and of 1.000000 (the only holder), and a page with no marker", () => {
    const body = holdersSample({ holders: [tokenHolderSample({ share: "0.000000" }), tokenHolderSample({ rank: 2, share: "1.000000" })], count: 2 });
    delete body.marker;
    expect(check(body)).toBe(body);
  });

  it("takes balances and limits in exponent form", () => {
    const body = holdersSample({ supply: "1.0000000e+9", holders: [tokenHolderSample({ balance: "1.0000000e+9", limit: "1e+15" })], count: 1 });
    expect(check(body)).toBe(body);
  });

  it("takes an empty page", () => {
    const body = holdersSample({ count: 0, holders: [] });
    delete body.marker;
    expect(check(body)).toBe(body);
  });
});

describe("the check of the transfers answer", () => {
  const check = askTransfers;

  it.each([
    ...listDefects("transfers"),
    ...within("a transfer", (b) => b.transfers[0], [
      missing("hash"),
      wrong("a hash of 63 digits", "hash", "3EBBB8672ADA7B5EADBE3878740346DD60B667D4919E1084D2E140238F0D204"),
      wrong("a hash that is no hex", "hash", "Z".repeat(64)),
      missing("ledger_index"),
      wrong("a ledger_index that is text", "ledger_index", "107873024"),
      wrong("a ledger_index that is fractional", "ledger_index", 1.5),
      missing("executed_time"),
      wrong("an executed_time that is no time", "executed_time", "2026-10-24"),
      missing("source"),
      wrong("a source that is an X-address", "source", X_ADDRESS),
      missing("destination"),
      wrong("a destination that is no address", "destination", "rNope"),
      missing("amount"),
      ...numberTextDefects("amount"),
      wrong("a source_tag that is text", "source_tag", "804681468"),
      wrong("a source_tag that is negative", "source_tag", -1),
      wrong("a destination_tag that is fractional", "destination_tag", 1.5),
    ]),
  ] satisfies Defect[])("refuses %s", (_what, field, defect) => {
    const body = clone(transfersSample());
    defect(body);
    refuses(check, PATH.transfers, body, field);
  });

  it("takes an answer with no ledger_index and no close_time: the transfers have none of their own", () => {
    const body = transfersSample();
    expect(body).not.toHaveProperty("ledger_index");
    expect(check(body)).toBe(body);
  });

  it("takes no transfers (a token nobody was paid in), a tag of 0 and an amount in exponent form", () => {
    const none = transfersSample({ count: 0, transfers: [] });
    delete none.marker;
    expect(check(none)).toBe(none);

    const tagged = transfersSample({ count: 1, transfers: [{ ...tokenTransferSample({ amount: "7.4000000e-9", destination_tag: 0 }), source_tag: undefined }] });
    delete tagged.transfers[0]!.source_tag;
    expect(check(tagged)).toBe(tagged);
  });

  it("takes a coverage that has no ledger: the index holds none yet", () => {
    const body = transfersSample({ coverage: { complete: false } });
    expect(check(body)).toBe(body);
  });
});
