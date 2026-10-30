// The data API's answers of D6's token routes (data-api `feat/explorer-data-2` at PIN 2fb4183721af6df58dd345f4a6ef90a293ae70b0: docs/api-reference.md "Tokens" and
// docs/superpowers/specs/2026-10-24-issued-tokens-design.md) for the token pages (E11). D6 has no deployment to record, so they are generated: http-fixtures.ts calls `tokenFixtures` from
// `generate()` for each network, so `pnpm fixtures:sync` writes the files with their keys as D6 orders them; test/fixtures/PROVENANCE.md ("Token answers") says what they are made of, and
// test/unit/token-fixtures.test.ts checks them. Each network has 100 tokens: 60 with 10 holders or more and 40 below, the featured ones among seeded ones, as of its newest recorded ledger,
// with the coverage `{ from_ledger_index: <its first recorded ledger>, complete: false }` in every answer (test/support/upstream-core.ts has the same one for a token without a file):
//
//   tokens@kind=issued&limit=20&min_holders=10[&marker=<M>].json     the tokens with 10 holders or more (3 pages)
//   tokens@kind=issued&limit=20&min_holders=10&q=USD.json            a search, and the same with `q=<an issuer>`: the featured issuer that has more tokens (`SIBLINGS`)
//   tokens@kind=issued&limit=20&q=USD.json                           the same search under `all=1`: the link of "more among tokens with fewer than 10 holders"
//   tokens@kind=issued&limit=20[&marker=<M>].json                    every token (5 pages)
//   tokens@kind=issued&limit=1&min_holders=10.json                   a token page's 404 asks for this, for its coverage
//   tokens/<CUR>.<issuer>.json                                       a featured token (`FEATURED`), with its toml, its issuer's settings and its markets
//   tokens/<CUR>.<issuer>/holders@limit=10.json                      the token page's top holders
//   tokens/<CUR>.<issuer>/holders@limit=50[&marker=<M>].json         the holders page: every holder of the token, so that the supply is their exact sum (at most 100, two pages)
//   tokens/<CUR>.<issuer>/transfers@descending=true&limit=20[&marker=<M>].json     its transfers, newest first (only RLUSD has a second page)
//
// A seeded token has a row and no page: its link is D6's 404. D6's rules are kept: `rank` runs on over the pages of what the filters select; the order is `holders` descending, then `issuer`,
// then `currency`; a marker is the kind and that key of the last row (a holder's the balance as a double and the holder, a transfer's the ledger and the transaction's index); `total`,
// `total_below` and `totals` are counts of the rows, `totals` the same in every list (`totals.holders` a seeded count between the largest token's and their sum, `totals.native_volume` the rows'
// sum); `share` is the balance over the supply, exact, 6 decimals half up; `price` and `last` have 8 significant digits, in exponent form below 0.000001 and from 100,000,000; a token's
// `price`, `price_change` and `price_time` are its native market's, or the 30-day set's (a time, no change, no market in the day set), or none, and its `native_volume` and `trades` its markets'
// sums. What is left out is left out, never `null`.
//
// Real, from the recordings (the sets of `readLedgers`): a featured token's first holders, the holders of its recorded trust lines in the order they are first met, then seeded ones; RLUSD's
// transfers, the newest 40 of the recorded payments that delivered it (a successful Payment between two different accounts, its `DeliveredAmount` or else its `Amount`); EVR's one such payment,
// then seeded ones; `last_ledger`, the newest ledger that changed a recorded line of the token. USD and LIONS deliver nothing in the recordings, so their transfers are seeded. The transaction
// behind a transfer has no file (a link to it is a 404, but for the served ones). The rest is synthetic, drawn per network and route from `mulberry32(seedOf(net, "tokens", …))`, so that no
// file depends on what another drew.
//
// The featured tokens' pools files (`amm/pools@asset=<CUR>+<issuer>&limit=20.json`) are amm-fixtures.ts's, by `FEATURED_XRPL_TOKENS`; `input.pools` only says which markets have a pool, and that
// the `lp` case (the XRP/RLUSD pool's LP token, test/support/token-case-rules.ts) is there: D6 has no such token, and its page redirects without a call. LIONS' issuer has no `issuer_settings`
// here: the node's recorded `account_info` serves them (`node/account_info/rGHtf1…`).
//
// A list's rows are one line each (`TOKEN_ROW_LISTS`). Like the other generators, this module reads nothing of http-fixtures.ts while it loads: `FEATURED_XRPL_TOKENS` is plain data, which
// amm-fixtures.ts reads when it is called (scripts/fixture-imports.test.ts).

import BigNumber from "bignumber.js";
import { encodeAccountID } from "ripple-address-codec";

import type {
  AmmPool,
  Coverage,
  IssuedTokenRow,
  IssuerSettings,
  LastValidated,
  TokenAnswer,
  TokenDetail,
  TokenHolder,
  TokenHoldersResponse,
  TokenMarket,
  TokensResponse,
  TokenToml,
  TokenTransfer,
  TokenTransfersResponse,
} from "../app/server/api-types";
import type { NetworkName } from "../test/support/upstream-core";
import { encodeMarker, inLedgerOrder, isoTime, txMarker, unixOf, type RawLedger } from "./http-fixtures";
import { precision8, Wide } from "./market-aggregates";
import { mulberry32, seedOf } from "./synthetic";

/** The lists whose rows are one line each: a token, a holder, a transfer. (A market is one already, at the depth a token's detail has it.) */
export const TOKEN_ROW_LISTS: readonly string[] = ["tokens", "holders", "transfers"];

/** What the pages ask for: 20 tokens or transfers to a page, 50 holders on the holders page, 10 on the token page. */
const LIMIT = 20;
const HOLDERS_LIMIT = 50;
const TOP_HOLDERS = 10;
/** How many of RLUSD's recorded payments are served, the newest: two pages, so that every marker has its file. */
const MOST_TRANSFERS = 2 * LIMIT;
/** D6's fixed floor of `tokens_with_10_holders`, and the view the list has by default. */
const FLOOR = 10;
/** The list's sizes: the plan's 60 and 40, the featured tokens among them. */
const TOKENS_ABOVE = 60;
const TOKENS_BELOW = 40;
/** The seeded issuers a network's tokens share (an issuer often has more than one): with the featured ones they fit in the room the names' cap leaves on XRPL (scripts/names-fixtures.ts). */
const SEEDED_ISSUERS = 30;

const DAY = 86_400;
/** About how many seconds a ledger takes: the time of a seeded transfer in a ledger that is not recorded. */
const LEDGER_SECONDS = 4;

const NATIVE: Record<NetworkName, "XRP" | "XAH"> = { xrpl: "XRP", xahau: "XAH" };

type Next = () => number;
type Row = Omit<IssuedTokenRow, "rank">;
type Asset = { currency: string; issuer: string };

const RLUSD: Asset = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const BITSTAMP_USD: Asset = { currency: "USD", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" };
const LIONS: Asset = { currency: "4C494F4E53000000000000000000000000000000", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" };
/** Made up: the account of `seedOf("xrpl", "tokens", "few-holders", "issuer")`'s draws, written out because amm-fixtures.ts reads it. */
const FEW_HOLDERS: Asset = { currency: "TIN", issuer: "rNwnk4Z6aDGGVcytB5NWeegHLZKbHRjdL3" };
const EVR: Asset = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };
/** Made up: the account of `seedOf("xahau", "tokens", "xahau-unlisted", "issuer")`'s draws. */
const UNLISTED: Asset = { currency: "NOD", issuer: "rsU3Rid6exHofd2D5xjewTJSYJe5QfKUiJ" };
/** USDC of the USDC/RLUSD pool (`FEATURED_POOLS` of amm-fixtures.ts). */
const USDC: Asset = { currency: "5553444300000000000000000000000000000000", issuer: "rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE" };

/** The featured tokens of XRPL, whose token pages ask for their pools: amm-fixtures.ts writes that file of each. */
export const FEATURED_XRPL_TOKENS: readonly Asset[] = [RLUSD, BITSTAMP_USD, LIONS, FEW_HOLDERS];

// ---- The featured tokens ------------------------------------------------------------------------------------------------------------

/** A pair of a featured token's markets: its counter, the counter per token, and whether the set has a native volume for it. */
interface MarketSpec {
  counter: { currency: string; issuer?: string };
  rate: number;
  /** The native coins a token buys: a pair with no native side has its native volume through this; without it, none. */
  nativeRate?: number;
}

interface FeaturedSpec extends Asset {
  /** The name of its draws. */
  name: string;
  code: string;
  /** How many hold it: the rows the holders files have. At most 100, two pages. */
  holders: number;
  /** `trust_lines − holders`: its lines with a zero balance. */
  zeroLines: number;
  /** The largest balance, in whole units. */
  top: number;
  domain?: string;
  listed: boolean;
  toml?: TokenToml;
  settings?: IssuerSettings;
  markets: readonly MarketSpec[];
  /** A price of the 30-day set: no market in the day set, this many days old. */
  oldPrice?: { price: number; daysAgo: number };
  /** The ranks whose line the issuer froze. */
  frozen?: readonly number[];
  /** The issuer authorizes lines (`require_auth`): every holder is authorized but the last. */
  authorizes?: boolean;
  /** How many transfers it has: the recorded ones first, then seeded. */
  transfers: number;
}

const SETTINGS: IssuerSettings = { transfer_fee: "0", global_freeze: false, no_freeze: false, allow_trust_line_clawback: false, require_auth: false, default_ripple: true };

/** What each featured token is. A domain is only words on its page's toml card: nothing is fetched from it, and the tomls of the display names are another matter (names-fixtures.ts). */
const FEATURED: Record<NetworkName, readonly FeaturedSpec[]> = {
  xrpl: [
    {
      ...RLUSD,
      name: "rlusd",
      code: "RLUSD",
      holders: 96,
      zeroLines: 31,
      top: 2_400_000,
      domain: "ripple.com",
      listed: true,
      toml: {
        name: "Ripple USD",
        desc: "A US dollar stablecoin",
        icon: "https://ripple.com/assets/rlusd.svg",
        symbol: "RLUSD",
        display_decimals: 2,
        asset_class: "Fiat-backed stablecoin",
        asset_subclass: "USD",
        attestation: "https://ripple.com/attestations/rlusd-2026-09.pdf",
      },
      settings: { ...SETTINGS, allow_trust_line_clawback: true },
      markets: [
        { counter: { currency: "XRP" }, rate: 0.41 },
        { counter: USDC, rate: 0.9998, nativeRate: 0.41 },
        { counter: BITSTAMP_USD, rate: 1.0004, nativeRate: 0.41 },
      ],
      frozen: [2],
      transfers: MOST_TRANSFERS,
    },
    {
      ...BITSTAMP_USD,
      name: "usd",
      code: "USD",
      holders: 72,
      zeroLines: 5,
      top: 800_000,
      domain: "bitstamp.net",
      listed: false,
      settings: { ...SETTINGS, transfer_fee: "0.2" },
      markets: [
        { counter: { currency: "XRP" }, rate: 0.412 },
        { counter: { currency: "EUR", issuer: BITSTAMP_USD.issuer }, rate: 0.92, nativeRate: 0.412 },
        // A pair with no native volume: the last of the markets.
        { counter: RLUSD, rate: 0.9996 },
      ],
      frozen: [5],
      transfers: 14,
    },
    { ...LIONS, name: "lions", code: "LIONS", holders: 54, zeroLines: 9, top: 900_000_000, listed: false, markets: [{ counter: { currency: "XRP" }, rate: 0.00000034 }], transfers: 8 },
    { ...FEW_HOLDERS, name: "few-holders", code: "TIN", holders: 4, zeroLines: 2, top: 500, listed: false, settings: SETTINGS, markets: [], transfers: 3 },
  ],
  xahau: [
    {
      ...EVR,
      name: "evr",
      code: "EVR",
      holders: 88,
      zeroLines: 12,
      top: 1_500_000,
      domain: "evernode.org",
      listed: true,
      // An `icon` that is no `https:` URL: the toml card shows it as text.
      toml: { name: "Evernode", desc: "The native token of Evernode", icon: "ipfs://evernode/evr.png", symbol: "EVR", display_decimals: 6 },
      settings: SETTINGS,
      markets: [
        { counter: { currency: "XAH" }, rate: 0.12 },
        { counter: UNLISTED, rate: 3.5 },
      ],
      transfers: 12,
    },
    {
      ...UNLISTED,
      name: "xahau-unlisted",
      code: "NOD",
      holders: 61,
      zeroLines: 0,
      top: 40_000,
      domain: "nodefield-7c31.example",
      listed: false,
      settings: { transfer_fee: "0.5", global_freeze: false, no_freeze: true, allow_trust_line_clawback: false, require_auth: true, default_ripple: false },
      markets: [],
      oldPrice: { price: 0.034, daysAgo: 12 },
      authorizes: true,
      transfers: 6,
    },
  ],
};

/** Tokens the featured issuers have besides: a search for an issuer finds more than one, and none below 10 holders, so that it has no link to a file nobody writes. */
const SIBLINGS: Record<NetworkName, { issuer: string; domain?: string; codes: readonly string[] }> = {
  xrpl: { issuer: BITSTAMP_USD.issuer, domain: "bitstamp.net", codes: ["EUR", "BTC"] },
  xahau: { issuer: EVR.issuer, domain: "evernode.org", codes: ["EVRS"] },
};

// ---- Small things ---------------------------------------------------------------------------------------------------------------------

const HEX = "0123456789ABCDEF";
const hexOf = (next: Next, digits: number): string => Array.from({ length: digits }, () => HEX[Math.floor(next() * 16)]!).join("");
const accountOf = (next: Next): string => encodeAccountID(Uint8Array.from({ length: 20 }, () => Math.floor(next() * 256)));
const drawIn = (next: Next, low: number, high: number): number => low + Math.floor(next() * (high - low + 1));
/** A currency as the ledger holds a code: the 3 characters, or the text's 40 hex digits. */
const currencyOf = (code: string): string => (code.length === 3 ? code : Buffer.from(code, "ascii").toString("hex").toUpperCase().padEnd(40, "0"));
/** Exact text of a whole number of millionths. */
const millionths = (units: number): string => new BigNumber(units).shiftedBy(-6).toFixed();
/** A percent as D6 writes it: 2 decimals, never `-0.00`. */
const percentOf = (next: Next): string => new BigNumber(Math.round((next() - 0.5) * 3000) + 0).shiftedBy(-2).toFixed(2);
/** `balance` over `supply`, rounded half up to 6 decimals. */
const shareOf = (balance: string, supply: string): string => new Wide(balance).dividedBy(supply).decimalPlaces(6, BigNumber.ROUND_HALF_UP).toFixed(6);
const sumOf = (texts: readonly string[]): string => texts.reduce((sum, text) => sum.plus(text), new BigNumber(0)).toFixed();
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const keyOf = (token: Asset): string => `${token.currency}.${token.issuer}`;

/** What every answer says of the moment: the coverage, and the ledger the list, the detail and the holders are as of. */
interface World {
  net: NetworkName;
  coverage: Coverage;
  ledgerIndex: number;
  closeTime: string;
  /** The close of the newest ledger, unix seconds. */
  now: number;
}

// ---- The recordings -------------------------------------------------------------------------------------------------------------------

/** A recorded token's lines: its holders in the order they were first met, with a positive balance at the end of the recordings, and the newest ledger that changed a line. */
interface RecordedLines {
  holders: string[];
  lastLedger: number;
}

type LineFields = { Balance?: { currency?: string; value?: string }; LowLimit?: { issuer?: string }; HighLimit?: { issuer?: string } };
type NodeOf = { LedgerEntryType?: string; FinalFields?: LineFields; NewFields?: LineFields };

/** The ledgers oldest first and each one's transactions in ledger order, whichever way they were handed over. */
const inOrder = (ledgers: readonly RawLedger[]): RawLedger[] => [...ledgers].sort((a, b) => Number(a.ledger.ledger_index) - Number(b.ledger.ledger_index));

/** The recorded trust lines of `tokens`, from the `RippleState` nodes of every transaction. A line holds the token when the balance, from the issuer's side, is below 0. */
function recordedLines(ledgers: readonly RawLedger[], tokens: readonly Asset[]): Map<string, RecordedLines> {
  const wanted = new Set(tokens.map(keyOf));
  const balances = new Map<string, Map<string, boolean>>();
  const newest = new Map<string, number>();
  for (const raw of inOrder(ledgers)) {
    for (const tx of inLedgerOrder(raw)) {
      for (const wrapper of (tx.metaData.AffectedNodes ?? []) as Array<{ ModifiedNode?: NodeOf; CreatedNode?: NodeOf; DeletedNode?: NodeOf }>) {
        const node = wrapper.ModifiedNode ?? wrapper.CreatedNode ?? wrapper.DeletedNode;
        if (node?.LedgerEntryType !== "RippleState") continue;
        const fields = node.FinalFields ?? node.NewFields;
        const [currency, value, low, high] = [fields?.Balance?.currency, fields?.Balance?.value, fields?.LowLimit?.issuer, fields?.HighLimit?.issuer];
        if (currency === undefined || value === undefined || low === undefined || high === undefined) continue;
        // The balance is the low account's: above 0, the high account issued what the low one holds.
        const amount = new BigNumber(value);
        const sides: Array<[issuer: string, holder: string, holds: boolean]> = [
          [high, low, amount.gt(0)],
          [low, high, amount.lt(0)],
        ];
        for (const [issuer, holder, holds] of sides) {
          const key = keyOf({ currency, issuer });
          if (!wanted.has(key)) continue;
          newest.set(key, Number(raw.ledger.ledger_index));
          const lines = balances.get(key) ?? new Map<string, boolean>();
          // A `Map` keeps the place of the first time a key was set.
          lines.set(holder, holds && wrapper.DeletedNode === undefined);
          balances.set(key, lines);
        }
      }
    }
  }
  return new Map(
    [...balances].map(([key, lines]) => [key, { holders: [...lines].filter(([, holds]) => holds).map(([holder]) => holder), lastLedger: newest.get(key)! }]),
  );
}

/** A transfer and the transaction's place in its ledger, which its marker names. */
interface Placed {
  row: TokenTransfer;
  txIndex: number;
}

/** The recorded payments that delivered `token`, newest first: D6's rule, a successful Payment between two different accounts, the amount it delivered. */
function recordedTransfers(ledgers: readonly RawLedger[], token: Asset): Placed[] {
  const placed: Placed[] = [];
  for (const raw of inOrder(ledgers)) {
    for (const tx of inLedgerOrder(raw)) {
      if (tx.TransactionType !== "Payment" || tx.metaData.TransactionResult !== "tesSUCCESS" || tx.Account === tx.Destination) continue;
      const delivered = (tx.metaData.DeliveredAmount ?? tx.Amount) as { currency?: string; issuer?: string; value?: string } | string | undefined;
      if (typeof delivered !== "object" || delivered.currency !== token.currency || delivered.issuer !== token.issuer) continue;
      const row: TokenTransfer = {
        hash: tx.hash,
        ledger_index: Number(raw.ledger.ledger_index),
        executed_time: isoTime(unixOf(raw.ledger.close_time)),
        source: tx.Account,
        destination: tx.Destination as string,
        amount: new BigNumber(delivered.value!).toFixed(),
      };
      if (typeof tx.SourceTag === "number") row.source_tag = tx.SourceTag;
      if (typeof tx.DestinationTag === "number") row.destination_tag = tx.DestinationTag;
      placed.push({ row, txIndex: tx.metaData.TransactionIndex });
    }
  }
  return placed.reverse();
}

// ---- A featured token's rows ----------------------------------------------------------------------------------------------------------

/**
 * Its holders by D6's rule, from `mulberry32(seedOf(net, "tokens", name, "holders"))`: the recorded ones first, then seeded, each with a balance below the one before, so that they keep that order.
 * The supply is the balances' exact sum, and each share of it.
 */
function holdersOf(world: World, spec: FeaturedSpec, recorded: readonly string[]): { holders: TokenHolder[]; supply: string } {
  if (spec.holders > 2 * HOLDERS_LIMIT) throw new Error(`${spec.name}: more holders than the two pages the holders files have`);
  const next = mulberry32(seedOf(world.net, "tokens", spec.name, "holders"));
  const addresses = new Set(recorded.filter((address) => address !== spec.issuer).slice(0, spec.holders));
  while (addresses.size < spec.holders) addresses.add(accountOf(next));

  let units = spec.top * 1_000_000;
  const rows = [...addresses].map((holder, at) => {
    const balance = millionths(units);
    units = Math.max(Math.floor(units * (0.8 + 0.19 * next())) - 1, 1);
    const limit = new BigNumber(balance).times(1 + drawIn(next, 1, 9)).integerValue(BigNumber.ROUND_CEIL).toFixed();
    return { holder, balance, limit, frozen: spec.frozen?.includes(at + 1) ?? false, authorized: spec.authorizes === true && at < spec.holders - 1 };
  });
  const supply = sumOf(rows.map((row) => row.balance));
  const holders = rows.map(({ holder, balance, limit, frozen, authorized }, at): TokenHolder => ({ rank: at + 1, holder, balance, share: shareOf(balance, supply), limit, frozen, authorized }));
  return { holders, supply };
}

/** Its markets from `mulberry32(seedOf(net, "tokens", name, "markets"))`, in D6's order: `native_volume` descending (a pair without one last), then `count`. */
function marketsOf(world: World, spec: FeaturedSpec, pools: readonly AmmPool[]): TokenMarket[] {
  const next = mulberry32(seedOf(world.net, "tokens", spec.name, "markets"));
  const pooled = (counter: MarketSpec["counter"]): boolean =>
    pools.some(
      (pool) =>
        !pool.deleted &&
        ((pool.base_currency === spec.currency && pool.base_issuer === spec.issuer && pool.counter_currency === counter.currency && pool.counter_issuer === counter.issuer) ||
          (pool.counter_currency === spec.currency && pool.counter_issuer === spec.issuer && pool.base_currency === counter.currency && pool.base_issuer === counter.issuer)),
    );
  const markets = spec.markets.map(({ counter, rate, nativeRate }): TokenMarket => {
    const [count, volumeDraw, drift, age] = [drawIn(next, 3, 300), next(), next(), drawIn(next, 60, DAY - 60)];
    const change = percentOf(next);
    const isNativeSide = counter.issuer === undefined;
    // The token's side: a few thousand native coins' worth, whatever its price.
    const volume = new BigNumber(Math.floor((200 + 4000 * volumeDraw) / (isNativeSide || nativeRate === undefined ? rate : nativeRate))).toFixed();
    const counterVolume = new BigNumber(volume).times(rate).decimalPlaces(6, BigNumber.ROUND_HALF_UP).toFixed();
    const nativeVolume = isNativeSide ? counterVolume : nativeRate === undefined ? undefined : new BigNumber(volume).times(nativeRate).decimalPlaces(6, BigNumber.ROUND_HALF_UP).toFixed();
    return {
      counter_currency: counter.currency,
      ...(counter.issuer !== undefined && { counter_issuer: counter.issuer }),
      count,
      volume,
      counter_volume: counterVolume,
      ...(nativeVolume !== undefined && { native_volume: nativeVolume }),
      last: precision8(new Wide(rate).times(0.99 + 0.02 * drift)),
      change,
      last_time: isoTime(world.now - age),
      amm_pool: pooled(counter),
    };
  });
  const native = (market: TokenMarket): BigNumber => new BigNumber(market.native_volume ?? -1);
  return markets.sort((a, b) => native(b).comparedTo(native(a))! || b.count - a.count);
}

/** The figures a token's row and detail have of the markets: the price of its native market or the 30-day set's, the sums of its markets. */
function figuresOf(world: World, spec: FeaturedSpec, markets: readonly TokenMarket[]): Pick<Row, "price" | "price_change" | "price_time" | "native_volume" | "trades"> {
  const native = markets.find((market) => market.counter_issuer === undefined);
  const volumes = markets.flatMap((market) => (market.native_volume === undefined ? [] : [market.native_volume]));
  const sums = { native_volume: sumOf(volumes), trades: markets.reduce((sum, market) => sum + market.count, 0) };
  if (native !== undefined) return { price: native.last!, price_change: native.change!, price_time: native.last_time, ...sums };
  if (spec.oldPrice !== undefined) return { price: precision8(spec.oldPrice.price), price_time: isoTime(world.now - spec.oldPrice.daysAgo * DAY), ...sums };
  return sums;
}

/** Its transfers: the recorded ones up to its number, then seeded ones in older ledgers, from `mulberry32(seedOf(net, "tokens", name, "transfers"))`. */
function transfersOf(world: World, spec: FeaturedSpec, recorded: readonly Placed[], holders: readonly TokenHolder[]): Placed[] {
  const next = mulberry32(seedOf(world.net, "tokens", spec.name, "transfers"));
  const placed = recorded.slice(0, spec.transfers);
  let ledger = placed.at(-1)?.row.ledger_index ?? world.ledgerIndex;
  const scale = new BigNumber(holders[0]!.balance).dividedBy(40);
  for (let at = placed.length; at < spec.transfers; at++) {
    ledger -= drawIn(next, 8, 400);
    if (ledger < (world.coverage.from_ledger_index ?? 0)) throw new Error(`${spec.name}: a seeded transfer before the coverage`);
    const holder = holders[drawIn(next, 0, holders.length - 1)]!.holder;
    const other = holders[drawIn(next, 0, holders.length - 1)]!.holder;
    // In turn: an issue, a redemption, and between two holders (or an issue again, when both draws are the one holder).
    const kind = at % 3;
    const source = kind === 0 || (kind === 2 && holder === other) ? spec.issuer : holder;
    const destination = kind === 1 ? spec.issuer : kind === 0 ? holder : other;
    const amount = scale.times(next()).decimalPlaces(6, BigNumber.ROUND_DOWN).plus("0.000001").toFixed();
    const row: TokenTransfer = {
      hash: hexOf(next, 64),
      ledger_index: ledger,
      executed_time: isoTime(world.now - (world.ledgerIndex - ledger) * LEDGER_SECONDS),
      source,
      destination,
      amount,
    };
    // A tag on some, and one of 0: a tag of `0` is a tag, and is served.
    if (at % 5 === 0) row.source_tag = drawIn(next, 1, 4_000_000_000);
    if (at % 7 === 3) row.destination_tag = 0;
    else if (at % 7 === 5) row.destination_tag = drawIn(next, 1, 4_000_000_000);
    placed.push({ row, txIndex: drawIn(next, 0, 60) });
  }
  return placed;
}

interface Featured {
  spec: FeaturedSpec;
  row: Row;
  detail: TokenDetail;
  holders: TokenHolder[];
  transfers: Placed[];
}

/** A featured token: its row and detail, from its holders and its markets. */
function featuredOf(world: World, spec: FeaturedSpec, ledgers: readonly RawLedger[], lines: ReadonlyMap<string, RecordedLines>, pools: readonly AmmPool[]): Featured {
  const recorded = lines.get(keyOf(spec));
  const { holders, supply } = holdersOf(world, spec, recorded?.holders ?? []);
  const markets = marketsOf(world, spec, pools);
  const figures = figuresOf(world, spec, markets);
  const next = mulberry32(seedOf(world.net, "tokens", spec.name, "last_ledger"));
  const lastLedger = recorded?.lastLedger ?? world.ledgerIndex - drawIn(next, 1, 5000);
  const head = {
    currency: spec.currency,
    code: spec.code,
    issuer: spec.issuer,
    holders: spec.holders,
    trust_lines: spec.holders + spec.zeroLines,
    supply,
    ...(figures.price !== undefined && { price: figures.price }),
    ...(figures.price_change !== undefined && { price_change: figures.price_change }),
    ...(figures.price_time !== undefined && { price_time: figures.price_time }),
    native_volume: figures.native_volume!,
    trades: figures.trades!,
    ...(spec.domain !== undefined && { domain: spec.domain }),
  };
  const row: Row = { ...head, listed: spec.listed, ...(spec.toml?.name !== undefined && { name: spec.toml.name }) };
  const detail: TokenDetail = {
    ...head,
    ...(spec.domain !== undefined && { toml_url: `https://${spec.domain}/.well-known/${world.net === "xrpl" ? "xrp-ledger" : "xahau"}.toml` }),
    listed: spec.listed,
    ...(spec.toml !== undefined && { toml: spec.toml }),
    ...(spec.settings !== undefined && { issuer_settings: spec.settings }),
    markets,
    last_ledger: lastLedger,
  };
  return { spec, row, detail, holders, transfers: transfersOf(world, spec, recordedTransfers(ledgers, spec), holders) };
}

// ---- The seeded tokens -----------------------------------------------------------------------------------------------------------------

const WORDS = ["Northpeak", "Bluewave", "Saltmarsh", "Fernhill", "Thistle", "Oakfield", "Riverstone", "Copperline", "Lanternway", "Harbourgate", "Stonebridge", "Willowmere", "Ashgrove", "Kestrel", "Marlow", "Tidewater"];

/** The currencies of the tokens above the floor, in order. `USD` and its kin first, which the search finds; the first ones that are not get the forced prices of `PRICE_CASES`. */
const CODES_ABOVE: readonly string[] = [
  "USD", "USD", "USDT", "USDC", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK", "SGD", "HKD", "KRW", "INR", "BRL", "MXN", "ZAR", "PLN", "CZK", "ETH", "LTC",
  "GOLD", "NORTHCOIN", "BLUEWAVE", "MARSHGAS", "FERNCOIN", "TIDEPOOL", "QUILLPAY", "EMBERDAO", "OAKSHARE", "RIVERBED", "STONEFRUIT", "LANTERN", "COPPERLINE", "HARBOR", "WILLOW", "PINECONE",
  "KESTREL", "MARLOW", "ASHGROVE", "SILVER", "PLATINUM", "PALLADIUM", "CARBON", "SOLARIS", "AURORA", "Moon Coin", "a.b.c", "ZEPHYR", "NIMBUS", "CIRRUS", "STRATUS", "MISTRAL", "SIROCCO", "HAMSIN",
];
/** The currencies of the tokens below the floor, in order: `USD` and its kin first, which the search's "more among tokens with fewer than 10 holders" counts. */
const CODES_BELOW: readonly string[] = [
  "USD", "XUSD", "USDX", "ARS", "CLP", "COP", "PEN", "THB", "VND", "PHP", "IDR", "MYR", "AED", "SAR", "ILS", "EGP", "NGN", "KES", "GHS", "MAD",
  "DUSTCOIN", "PEBBLE", "GRAVEL", "SANDBANK", "SHINGLE", "DRIFTWOOD", "BRACKEN", "HEATHER", "GORSE", "SEDGE", "RUSHES", "LICHEN", "MOSSY", "FUNGI", "SPORE", "ALGAE", "PLANKTON", "KRILL", "SHRIMP", "MINNOW",
];
/** A currency with no text: a demurrage code, D6 leaves its `code` out. */
const NO_TEXT_CURRENCY = "015841550000000041F78E0A28CBF19200000000";

/** The rows whose price the plan asks for by name, by their place among the tokens above and below the floor: an exponent-form price and no price on the first page, and a price from 100,000,000. */
const PRICE_ABOVE: Readonly<Record<number, number | null>> = { 4: 0.00000012, 5: null };
const PRICE_BELOW: Readonly<Record<number, number | null>> = { 3: 123_456_789 };

/** The seeded issuers, with their account domains: most have one. */
function seededIssuers(next: Next): Array<{ issuer: string; domain?: string }> {
  return Array.from({ length: SEEDED_ISSUERS }, (_, at) => {
    const issuer = accountOf(next);
    const suffix = hexOf(next, 4).toLowerCase();
    const named = at % 3 !== 2;
    return { issuer, ...(named && { domain: `${WORDS[at % WORDS.length]!.toLowerCase()}-${suffix}.example` }) };
  });
}

/**
 * The row of a seeded token, from one stream per network. `holders` is what it has; `forced` a price the plan asks for (`null`: none). Otherwise a draw: no price, one of the day set (a change, a
 * volume and trades) or one of the 30-day set (a time, no change, no volume). A token nobody holds has no supply and no price.
 */
function seededRow(world: World, next: Next, code: string | null, owner: { issuer: string; domain?: string }, holders: number, forced: number | null | undefined): Row {
  const [zeroLines, supplyDraw, form, priceDraw, age, volumeDraw, tradesDraw, listedDraw, wordDraw] = [next(), next(), next(), next(), next(), next(), next(), next(), next()];
  const change = percentOf(next);
  const none = holders === 0 || forced === null || (forced === undefined && form < 0.2);
  const fromDay = !none && (forced !== undefined || form < 0.8);
  const listed = owner.domain !== undefined && listedDraw < 0.45;
  const price = none ? undefined : precision8(forced ?? 0.00001 + 5 * priceDraw * priceDraw);
  return {
    currency: code === null ? NO_TEXT_CURRENCY : currencyOf(code),
    ...(code !== null && { code }),
    issuer: owner.issuer,
    holders,
    trust_lines: holders + Math.floor(zeroLines * 6) + (holders === 0 ? 1 : 0),
    supply: holders === 0 ? "0" : new BigNumber(Math.floor(holders * (100 + 90_000 * supplyDraw))).shiftedBy(-2).toFixed(),
    ...(price !== undefined && { price }),
    ...(fromDay && { price_change: change }),
    ...(price !== undefined && { price_time: isoTime(world.now - (fromDay ? Math.floor(age * (DAY - 60)) + 60 : (2 + Math.floor(age * 27)) * DAY)) }),
    native_volume: fromDay ? new BigNumber(Math.floor(volumeDraw * 500_000_000) + 1).shiftedBy(-3).toFixed() : "0",
    trades: fromDay ? Math.floor(tradesDraw * 400) + 1 : 0,
    ...(owner.domain !== undefined && { domain: owner.domain }),
    listed,
    ...(listed && { name: `${WORDS[Math.floor(wordDraw * WORDS.length)]!} ${code ?? "token"}` }),
  };
}

/** Every seeded row of a network, from `mulberry32(seedOf(net, "tokens"))`: as many above and below the floor as the featured ones leave. No token holds as many as the largest featured one. */
function seededRows(world: World, featured: readonly Row[]): Row[] {
  const next = mulberry32(seedOf(world.net, "tokens"));
  const issuers = seededIssuers(next);
  const siblings = SIBLINGS[world.net];
  const most = Math.max(...featured.map((row) => row.holders));
  const above = TOKENS_ABOVE - featured.filter((row) => row.holders >= FLOOR).length - siblings.codes.length;
  const below = TOKENS_BELOW - featured.filter((row) => row.holders < FLOOR).length;
  if (above > CODES_ABOVE.length || below > CODES_BELOW.length) throw new Error(`${world.net}: more seeded tokens than codes`);

  const rows: Row[] = [];
  // The issuers take their turns over both lists, so that the two `USD` of one list are of two issuers.
  let turn = 0;
  const drawnAbove = (forced: number | null | undefined) => (forced === undefined ? FLOOR + Math.floor(next() * next() * (most - 3 - FLOOR)) : most - (forced === null ? 2 : 1));
  for (const [at, code] of CODES_ABOVE.slice(0, above).entries()) rows.push(seededRow(world, next, code, issuers[turn++ % issuers.length]!, drawnAbove(PRICE_ABOVE[at]), PRICE_ABOVE[at]));
  for (const code of siblings.codes) rows.push(seededRow(world, next, code, siblings, drawnAbove(undefined), undefined));
  // The last below the floor has no text, and the one before no holder at all (a token whose lines all have a zero balance).
  for (const [at, code] of CODES_BELOW.slice(0, below).entries()) {
    const last = at === below - 1;
    rows.push(seededRow(world, next, last ? null : code, issuers[turn++ % issuers.length]!, at === below - 2 ? 0 : 1 + Math.floor(next() * (FLOOR - 1)), PRICE_BELOW[at]));
  }
  return rows;
}

// ---- The files -------------------------------------------------------------------------------------------------------------------------

/** D6's order of the list: `holders` descending, then `issuer`, then `currency`. */
const listOrder = (a: Row, b: Row): number => b.holders - a.holders || byText(a.issuer, b.issuer) || byText(a.currency, b.currency);

/** D6's search: a part of the code, the name or the domain (any case), the whole currency, or the start of the issuer, which for a classic address is that issuer's tokens. */
function searched(rows: readonly Row[], q: string): Row[] {
  const low = q.toLowerCase();
  const within = (text: string | undefined): boolean => text !== undefined && text.toLowerCase().includes(low);
  return rows.filter((row) => within(row.code) || within(row.name) || within(row.domain) || row.currency.toLowerCase() === low || row.issuer.startsWith(q));
}

type Answer = { path: string; query: string; value: unknown };

/** A query with its parameters as they come: `generate()`'s `dataApiFile` sorts them. */
const queryOf = (params: Record<string, string | number | undefined>): string =>
  Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join("&");

/** The pages of a list of tokens. `rows` is the whole answer of the filters, in D6's order; `every` also writes the pages behind the first. `belowFloor` is `total_below`, under `min_holders` only. */
function listAnswers(world: World, rows: readonly Row[], totals: TokensResponse["totals"], { limit, minHolders, q, belowFloor, every }: { limit: number; minHolders?: number; q?: string; belowFloor?: number; every: boolean }): Answer[] {
  const answers: Answer[] = [];
  let marker: string | undefined;
  for (let at = 0; at === 0 || (every && at < rows.length); at += limit) {
    const shown = rows.slice(at, at + limit).map((row, place): IssuedTokenRow => ({ rank: at + place + 1, ...row }));
    const last = shown.at(-1);
    const next = at + limit < rows.length && last !== undefined ? encodeMarker(["issued", last.holders, last.issuer, last.currency]) : undefined;
    const value: TokensResponse = {
      result: "success",
      coverage: world.coverage,
      kind: "issued",
      ledger_index: world.ledgerIndex,
      close_time: world.closeTime,
      ...(totals !== undefined && { totals }),
      total: rows.length,
      ...(belowFloor !== undefined && { total_below: belowFloor }),
      count: shown.length,
      ...(next !== undefined && { marker: next }),
      tokens: shown,
    };
    answers.push({ path: "/v2/tokens", query: queryOf({ kind: "issued", limit, marker, min_holders: minHolders, q }), value });
    marker = next;
  }
  return answers;
}

/** A token's holders files: the ten of the token page, and the pages of 50 of the holders page, every one of them. */
function holderAnswers(world: World, { spec, detail, holders }: Featured): Answer[] {
  const path = `/v2/tokens/${keyOf(spec)}/holders`;
  const page = (shown: readonly TokenHolder[], goesOn: boolean): TokenHoldersResponse => {
    const last = shown.at(-1)!;
    return {
      result: "success",
      coverage: world.coverage,
      ledger_index: world.ledgerIndex,
      close_time: world.closeTime,
      supply: detail.supply,
      count: shown.length,
      ...(goesOn && { marker: encodeMarker([Number(last.balance), last.holder]) }),
      holders: [...shown],
    };
  };
  const answers: Answer[] = [{ path, query: queryOf({ limit: TOP_HOLDERS }), value: page(holders.slice(0, TOP_HOLDERS), holders.length > TOP_HOLDERS) }];
  let marker: string | undefined;
  for (let at = 0; at < holders.length; at += HOLDERS_LIMIT) {
    const value = page(holders.slice(at, at + HOLDERS_LIMIT), at + HOLDERS_LIMIT < holders.length);
    answers.push({ path, query: queryOf({ limit: HOLDERS_LIMIT, marker }), value });
    marker = value.marker;
  }
  return answers;
}

/** A token's transfers files, newest first: a page of 20, and each page behind it. */
function transferAnswers(world: World, { spec, transfers }: Featured): Answer[] {
  const path = `/v2/tokens/${keyOf(spec)}/transfers`;
  const answers: Answer[] = [];
  let marker: string | undefined;
  for (let at = 0; at === 0 || at < transfers.length; at += LIMIT) {
    const shown = transfers.slice(at, at + LIMIT);
    const last = shown.at(-1)!;
    const next = at + LIMIT < transfers.length ? txMarker(last.row.ledger_index, last.txIndex) : undefined;
    const value: TokenTransfersResponse = { result: "success", coverage: world.coverage, count: shown.length, ...(next !== undefined && { marker: next }), transfers: shown.map(({ row }) => row) };
    answers.push({ path, query: queryOf({ descending: "true", limit: LIMIT, marker }), value });
    marker = next;
  }
  return answers;
}

/** Every file of D6's token routes of a network, before serialization: the route, the query and the answer, with its keys in D6's order. */
export function tokenFixtures(net: NetworkName, input: { ledgers: readonly RawLedger[]; last: LastValidated; pools: readonly AmmPool[] }): Answer[] {
  const first = inOrder(input.ledgers)[0];
  if (first === undefined) throw new Error(`${net}: no recorded ledger`);
  if (net === "xrpl" && !input.pools.some((pool) => !pool.deleted && pool.lp_currency !== undefined && pool.base_currency === RLUSD.currency && pool.counter_issuer === undefined)) {
    throw new Error("xrpl: no XRP/RLUSD pool for the lp case");
  }
  const world: World = {
    net,
    coverage: { from_ledger_index: Number(first.ledger.ledger_index), complete: false },
    ledgerIndex: Number(input.last.ledger_index),
    closeTime: input.last.close_time,
    now: Date.parse(input.last.close_time) / 1000,
  };

  const specs = FEATURED[net];
  const lines = recordedLines(input.ledgers, specs);
  const featured = specs.map((spec) => featuredOf(world, spec, input.ledgers, lines, input.pools));
  const featuredRows = featured.map(({ row }) => row);
  const rows = [...featuredRows, ...seededRows(world, featuredRows)].sort(listOrder);
  const unique = new Set(rows.map(keyOf));
  if (unique.size !== rows.length) throw new Error(`${net}: a token is seeded twice`);

  const above = rows.filter((row) => row.holders >= FLOOR);
  const sum = rows.reduce((total, row) => total + row.holders, 0);
  const totals: NonNullable<TokensResponse["totals"]> = {
    tokens: rows.length,
    tokens_with_10_holders: above.length,
    // The accounts that hold any token: many hold more than one.
    holders: Math.max(Math.floor(sum * 0.62), Math.max(...rows.map((row) => row.holders))),
    native_volume: sumOf(rows.map((row) => row.native_volume ?? "0")),
  };

  const answers: Answer[] = [
    ...listAnswers(world, above, totals, { limit: LIMIT, minHolders: FLOOR, belowFloor: rows.length - above.length, every: true }),
    ...listAnswers(world, rows, totals, { limit: LIMIT, every: true }),
    ...listAnswers(world, above, totals, { limit: 1, minHolders: FLOOR, belowFloor: rows.length - above.length, every: false }),
  ];
  for (const q of ["USD", SIBLINGS[net].issuer]) {
    const found = searched(rows, q);
    const foundAbove = found.filter((row) => row.holders >= FLOOR);
    if (foundAbove.length > LIMIT || found.length > LIMIT) throw new Error(`${net}: the search for ${q} has more than a page`);
    answers.push(...listAnswers(world, foundAbove, totals, { limit: LIMIT, minHolders: FLOOR, q, belowFloor: found.length - foundAbove.length, every: false }));
    // The same search under `all=1`, for the link of "more among tokens with fewer than 10 holders": a search that has none below has no such link.
    if (found.length > foundAbove.length) answers.push(...listAnswers(world, found, totals, { limit: LIMIT, q, every: false }));
  }
  for (const one of featured) {
    const value: TokenAnswer = { result: "success", coverage: world.coverage, ledger_index: world.ledgerIndex, close_time: world.closeTime, token: one.detail };
    answers.push({ path: `/v2/tokens/${keyOf(one.spec)}`, query: "", value }, ...holderAnswers(world, one), ...transferAnswers(world, one));
  }
  return answers;
}
