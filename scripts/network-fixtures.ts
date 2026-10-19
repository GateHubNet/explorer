// The data API's answers for the network page that the recorded ledgers cannot give (spec 4, "Fixtures"): aggregates over months (`stats`, the
// daily fees, the three volumes), the syncer's fee snapshot, and the validations of the two newest ledgers. They are synthetic: drawn from
// streams seeded with `seedOf(net, endpoint)` (synthetic.ts), so `pnpm fixtures:sync` writes the same bytes every time. http-fixtures.ts calls
// `networkFixtures` for each network and puts each answer through its `api(net, path, query, value)`; test/fixtures/PROVENANCE.md says what
// they follow. Only an end-to-end run against a real stack (`E2E_DATA_API_URL`) checks them against real answers.
//
// What they follow is data-api-new's docs/api-reference.md: `main` at ff659c9 for the shapes (Network, Validations, Stats), `feat/amm-data` at
// c3e2302 for `amm_volume`.
//
// - `stats` leaves out zero counts, and `transaction_count` is the sum of the type columns of its bucket.
// - A day's values are one series for the whole generator, drawn once from the first day any window needs to the running one, so a day is the
//   same in every file that holds it, and a week is the sum of its days.
// - The running day is the day so far: the values of a full day times the part of it that has passed at the close of the newest ledger.
// - A volume route counts a day once the ingest has passed it by an hour, so its files end with the day before the running one (the one before
//   that in the first hour after midnight); a running week has the days counted so far.
// - Volume components are the native currency and the markets config's currencies, sorted by converted amount, with `rate = amount /
//   converted_amount` to 8 significant digits. USD rows are the native rows at a seeded daily rate.
// - Only integer arithmetic and IEEE operations are used on the numbers (no Math.sin, Math.exp or fractional powers), so the numbers are the
//   same on every Node.

import BigNumber from "bignumber.js";
import { encodeAccountID, encodeNodePublic } from "ripple-address-codec";

import { bucketStarts, utcDayOf, windowOf, type WindowPeriod } from "../app/domain/window";
import type {
  AmmVolumeComponent,
  AssetRef,
  ExchangeVolumeComponent,
  FeeBucketRow,
  FeeStatsRow,
  LastValidated,
  LedgerValidations,
  Page,
  PaymentVolumeComponent,
  StatsRow,
  Validation,
  VolumeRow,
} from "../app/server/api-types";
import type { NetworkName } from "../test/support/upstream-core";
import { mulberry32, seedOf } from "./synthetic";

/** A file of the fixtures: the request that finds it (`path` below the API's host, `query` in any order) and the body that it holds. */
export interface FixtureFile {
  path: string;
  query: string;
  value: unknown;
}

/**
 * A ledger the validations are written for: its index and hash, and its close time (`YYYY-MM-DDTHH:mm:ssZ`, the `date` of its row in the fees
 * list). Without the close time it is estimated from the distance to the newest ledger.
 */
export interface NewestLedger {
  index: number;
  hash: string;
  date?: string;
}

// ---- The markets configs ---------------------------------------------------------------------------------------------

interface MarketsConfig {
  version: number;
  tradeMarkets: Array<{ base: AssetRef; counter: AssetRef }>;
  paymentCurrencies: AssetRef[];
}

/**
 * The markets configs of the data API, copied with their source: `packages/shared/config/markets/xrpl.json` and `xahau.json` of the repository
 * `data-api-new` at commit ff659c95c6ce9fbf12e6745c91984fedc5f3ca16 (`main`). The components of the volume routes are these markets and
 * currencies, and the native currency for payments.
 */
const MARKETS: Record<NetworkName, MarketsConfig> = {
  xrpl: {
    version: 1,
    tradeMarkets: [
      { base: { currency: "USD", issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq" }, counter: { currency: "XRP" } },
      { base: { currency: "EUR", issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq" }, counter: { currency: "XRP" } },
      { base: { currency: "USD", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" }, counter: { currency: "XRP" } },
      { base: { currency: "BTC", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" }, counter: { currency: "XRP" } },
      { base: { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" }, counter: { currency: "XRP" } },
    ],
    paymentCurrencies: [
      { currency: "USD", issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq" },
      { currency: "EUR", issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq" },
      { currency: "USD", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" },
      { currency: "BTC", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" },
      { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" },
    ],
  },
  xahau: {
    version: 3,
    tradeMarkets: [{ base: { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" }, counter: { currency: "XAH" } }],
    paymentCurrencies: [
      { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" },
      { currency: "4555525100000000000000000000000000000000", issuer: "rDk1xiArDMjDqnrR2yWypwQAKg4mKnQYvs" },
      { currency: "RVN", issuer: "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb" },
    ],
  },
};

// The currencies of the profiles below, the markets configs' (XRPL's GateHub and Bitstamp issuers, the RLUSD token, Xahau's Evernode).
const USD_GATEHUB: AssetRef = { currency: "USD", issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq" };
const EUR_GATEHUB: AssetRef = { currency: "EUR", issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq" };
const USD_BITSTAMP: AssetRef = { currency: "USD", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" };
const BTC_BITSTAMP: AssetRef = { currency: "BTC", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" };
const RLUSD: AssetRef = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const EVR: AssetRef = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };
const EURQ: AssetRef = { currency: "4555525100000000000000000000000000000000", issuer: "rDk1xiArDMjDqnrR2yWypwQAKg4mKnQYvs" };
const RVN: AssetRef = { currency: "RVN", issuer: "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb" };

/** The display currency of XRPL's `in=usd`: USD issued by GateHub (`exchange_issuer`). */
const USD = USD_GATEHUB;

const idOf = (asset: AssetRef): string => (asset.issuer === undefined ? asset.currency : `${asset.currency}.${asset.issuer}`);

// ---- What each network looks like ------------------------------------------------------------------------------------

interface Profile {
  native: string;
  ledgersPerDay: number;
  /** Seconds between ledgers, to estimate a close time. */
  ledgerSeconds: number;
  txPerLedger: number;
  accountsPerDay: number;
  /** The relative weight of each transaction type; a rare one has no transaction on some days. */
  types: Record<string, number>;
  /** What a transaction pays on average, in drops. */
  feeDrops: number;
  /** US dollars one native coin is worth, on average. */
  usdPerNative: number;
  validators: number;
  /** The fee snapshot: the open ledger's size, the size it is expected to have, and the median fee in whole native units. */
  snapshot: { open: number; expected: number; median: number };
  /** Per currency (`currency.issuer`): units of it one US dollar buys, and decimals of its amounts. */
  units: Record<string, { perUsd: number; decimals: number }>;
  /** Per payment currency (the native one by its code): native units paid a day, and the share of the Payment transactions. */
  payments: Record<string, { volume: number; share: number }>;
  /** Per market, by its base: native units traded a day, and the size of a trade in native units. */
  trades: Record<string, { volume: number; size: number }>;
  /** AMM pools: not limited to the markets config. The native pools have the native currency as their counter. */
  pools: Array<{ base: AssetRef; counter: AssetRef; volume: number; size: number }>;
}

const PROFILES: Record<NetworkName, Profile> = {
  xrpl: {
    native: "XRP",
    ledgersPerDay: 22_150,
    ledgerSeconds: 3.9,
    txPerLedger: 93,
    accountsPerDay: 3_200,
    types: {
      Payment: 46,
      OfferCreate: 24,
      OfferCancel: 7.5,
      TrustSet: 6,
      AccountSet: 2,
      NFTokenMint: 1.8,
      NFTokenCreateOffer: 1.2,
      NFTokenAcceptOffer: 0.6,
      NFTokenCancelOffer: 0.3,
      NFTokenBurn: 0.15,
      AMMDeposit: 0.45,
      AMMWithdraw: 0.25,
      AMMBid: 0.06,
      AMMVote: 0.04,
      AMMCreate: 0.0004,
      AMMDelete: 0.00008,
      OracleSet: 0.35,
      SetRegularKey: 0.12,
      TicketCreate: 0.06,
      EscrowCreate: 0.05,
      EscrowFinish: 0.04,
      EscrowCancel: 0.002,
      CheckCreate: 0.03,
      CheckCash: 0.02,
      CheckCancel: 0.001,
      DepositPreauth: 0.03,
      AccountDelete: 0.006,
      PaymentChannelClaim: 0.01,
      PaymentChannelCreate: 0.0005,
      PaymentChannelFund: 0.0002,
      SignerListSet: 0.001,
      MPTokenIssuanceCreate: 0.02,
      MPTokenAuthorize: 0.01,
      Clawback: 0.0005,
    },
    feeDrops: 14,
    usdPerNative: 2.4,
    validators: 35,
    snapshot: { open: 84, expected: 96, median: 0.000005 },
    units: {
      [idOf(USD_GATEHUB)]: { perUsd: 1, decimals: 4 },
      [idOf(EUR_GATEHUB)]: { perUsd: 0.92, decimals: 4 },
      [idOf(USD_BITSTAMP)]: { perUsd: 1, decimals: 4 },
      [idOf(BTC_BITSTAMP)]: { perUsd: 1 / 96_000, decimals: 8 },
      [idOf(RLUSD)]: { perUsd: 1, decimals: 4 },
    },
    payments: {
      XRP: { volume: 42_000_000, share: 0.8 },
      [idOf(USD_GATEHUB)]: { volume: 3_500_000, share: 0.03 },
      [idOf(EUR_GATEHUB)]: { volume: 2_500_000, share: 0.02 },
      [idOf(USD_BITSTAMP)]: { volume: 6_000_000, share: 0.04 },
      [idOf(BTC_BITSTAMP)]: { volume: 1_500_000, share: 0.01 },
      [idOf(RLUSD)]: { volume: 12_000_000, share: 0.06 },
    },
    trades: {
      [idOf(USD_GATEHUB)]: { volume: 1_400_000, size: 800 },
      [idOf(EUR_GATEHUB)]: { volume: 900_000, size: 700 },
      [idOf(USD_BITSTAMP)]: { volume: 2_600_000, size: 900 },
      [idOf(BTC_BITSTAMP)]: { volume: 1_100_000, size: 1_200 },
      [idOf(RLUSD)]: { volume: 3_600_000, size: 1_000 },
    },
    pools: [
      { base: USD_GATEHUB, counter: { currency: "XRP" }, volume: 3_000_000, size: 450 },
      { base: RLUSD, counter: { currency: "XRP" }, volume: 1_600_000, size: 380 },
      { base: BTC_BITSTAMP, counter: USD_BITSTAMP, volume: 500_000, size: 1_500 },
    ],
  },
  xahau: {
    native: "XAH",
    ledgersPerDay: 21_600,
    ledgerSeconds: 4,
    txPerLedger: 14,
    accountsPerDay: 150,
    types: {
      Payment: 38,
      Invoke: 30,
      ClaimReward: 14,
      OfferCreate: 6,
      TrustSet: 3.5,
      OfferCancel: 2,
      AccountSet: 1.5,
      URITokenMint: 1.2,
      URITokenCreateSellOffer: 1,
      URITokenBuy: 0.9,
      Remit: 0.5,
      URITokenCancelSellOffer: 0.3,
      SetRegularKey: 0.2,
      SetHook: 0.15,
      Import: 0.08,
      TicketCreate: 0.05,
      EscrowCreate: 0.05,
      EscrowFinish: 0.04,
      DepositPreauth: 0.03,
      AccountDelete: 0.01,
      GenesisMint: 0.0005,
    },
    feeDrops: 12,
    usdPerNative: 0.04,
    validators: 25,
    snapshot: { open: 16, expected: 24, median: 0.00001 },
    units: {
      [idOf(EVR)]: { perUsd: 1 / 0.14, decimals: 6 },
      [idOf(EURQ)]: { perUsd: 0.92, decimals: 4 },
      [idOf(RVN)]: { perUsd: 1 / 0.03, decimals: 6 },
    },
    payments: {
      XAH: { volume: 14_000_000, share: 0.7 },
      [idOf(EVR)]: { volume: 1_200_000, share: 0.12 },
      [idOf(EURQ)]: { volume: 800_000, share: 0.06 },
      [idOf(RVN)]: { volume: 400_000, share: 0.04 },
    },
    trades: { [idOf(EVR)]: { volume: 500_000, size: 400 } },
    pools: [],
  },
};

// ---- Numbers ---------------------------------------------------------------------------------------------------------

const BN = BigNumber.clone({ DECIMAL_PLACES: 40, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
type Decimal = BigNumber;

const stream = (net: NetworkName, endpoint: string) => mulberry32(seedOf(net, endpoint));

const plusDays = (day: string, days: number): string => {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
};
const weekdayOf = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();
const startOf = (day: string): string => `${day}T00:00:00Z`;

/** The days a bucket holds up to `last`: itself for a day, its Monday to Sunday for a week. */
function daysOf(bucket: string, unit: "day" | "week", last: string): string[] {
  if (unit === "day") return bucket <= last ? [bucket] : [];
  const end = plusDays(bucket, 6);
  return bucket > last ? [] : bucketStarts(bucket, end < last ? end : last, "day");
}

const WEEKDAY = [0.93, 1, 1.02, 1.03, 1.02, 0.99, 0.94];

/**
 * How busy a day is against an average one: the day of the week, a swell of 10% either way with a period of 120 days (a triangle wave), and
 * a draw `u` of the stream that makes it `spread` more or less.
 */
function busy(day: string, at: number, u: number, spread: number): number {
  const swell = 1 + 0.1 * (Math.abs((at % 120) / 60 - 1) * 2 - 1);
  return WEEKDAY[weekdayOf(day)]! * swell * (1 - spread + 2 * spread * u);
}

/** Display text of a ratio to 8 significant digits (`1.0000000`, `0.0090909091`), as the API writes `rate` and `exchange_rate`. */
const ratio = (numerator: Decimal, denominator: Decimal): string => numerator.dividedBy(denominator).toPrecision(8);

// ---- The context -----------------------------------------------------------------------------------------------------

interface Context {
  net: NetworkName;
  profile: Profile;
  markets: MarketsConfig;
  /** T: the UTC day of the newest ledger's close time, the running day. */
  today: string;
  /** The part of the running day that has passed at the close time of the newest ledger. */
  fraction: number;
  /** The newest day the volume routes have computed: one that ended an hour ago. */
  final: string;
  /** Every day from the first that any window needs (P₀ of `1y`) to the running day. */
  days: string[];
  /** US dollars a native coin is worth, by day. */
  rates: Map<string, number>;
  closedAt: number;
}

function contextOf(net: NetworkName, last: LastValidated): Context {
  const closedAt = Date.parse(last.close_time);
  const today = utcDayOf(closedAt / 1000);
  const seconds = (closedAt / 1000) % 86_400;
  const profile = PROFILES[net];
  const days = bucketStarts(windowOf(today, "1y").previous.start, today, "day");

  // The USD rate wanders around its mean: a little of the last day's distance from it is kept, and a draw moves it.
  const next = stream(net, "network/exchange_rate");
  let drift = 0;
  const rates = new Map<string, number>();
  for (const day of days) {
    drift = 0.98 * drift + 0.04 * (2 * next() - 1);
    rates.set(day, Math.round(profile.usdPerNative * (1 + drift) * 1_000_000) / 1_000_000);
  }

  return {
    net,
    profile,
    markets: MARKETS[net],
    today,
    fraction: seconds / 86_400,
    final: plusDays(today, seconds >= 3600 ? -1 : -2),
    days,
    rates,
    closedAt,
  };
}

// ---- Stats and fees --------------------------------------------------------------------------------------------------

type Counts = Record<string, number>;

/** Transactions of each type a day; a type with none is not there. The running day is the day so far. */
function typesOf(ctx: Context): Map<string, Counts> {
  const { profile, today, fraction } = ctx;
  const next = stream(ctx.net, "stats/type");
  const weights = Object.entries(profile.types);
  const whole = weights.reduce((sum, [, weight]) => sum + weight, 0);
  return new Map(
    ctx.days.map((day, at) => {
      const total = profile.ledgersPerDay * profile.txPerLedger * busy(day, at, next(), 0.06);
      const counts: Counts = {};
      for (const [name, weight] of weights) {
        const u = next();
        const expected = (total * weight) / whole;
        // A rare type is a draw from none to twice what is expected, so it has no transaction on some days.
        const full = expected < 40 ? Math.floor(expected * 2 * u) : Math.round(expected * (0.92 + 0.16 * u));
        const count = day === today ? Math.round(full * fraction) : full;
        if (count > 0) counts[name] = count;
      }
      return [day, counts];
    }),
  );
}

const sumOf = (counts: Counts): number => Object.values(counts).reduce((sum, count) => sum + count, 0);

interface Metrics {
  accounts_created: number;
  ledger_count: number;
  transaction_count: number;
}

function metricsOf(ctx: Context, types: Map<string, Counts>): Map<string, Metrics> {
  const { profile, today, fraction } = ctx;
  const next = stream(ctx.net, "stats/metric");
  return new Map(
    ctx.days.map((day, at) => {
      const act = busy(day, at, next(), 0.1);
      const ledgers = profile.ledgersPerDay + Math.round((next() - 0.5) * 300);
      const accounts = profile.accountsPerDay * act * (0.85 + 0.3 * next());
      const part = day === today ? fraction : 1;
      return [day, { accounts_created: Math.round(accounts * part), ledger_count: Math.round(ledgers * part), transaction_count: sumOf(types.get(day)!) }];
    }),
  );
}

/** The rows of `/v2/stats/{family}` for the buckets from `start` to `end`: the counts of a bucket's days added up, with no zero. */
function statsRows(ctx: Context, unit: "day" | "week", start: string, end: string, counts: (day: string) => Counts): StatsRow[] {
  return bucketStarts(start, end, unit).map((bucket) => {
    const row: Counts = {};
    for (const day of daysOf(bucket, unit, ctx.today)) {
      for (const [name, count] of Object.entries(counts(day))) if (count > 0) row[name] = (row[name] ?? 0) + count;
    }
    return { date: startOf(bucket), ...row };
  });
}

const MAX_FEES = [100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 100_000_000];

/** A day's fees: what its transactions paid, with the transactions of the stats. A drop is 0.000001 of the native currency. */
function feesOf(ctx: Context, types: Map<string, Counts>): Map<string, FeeBucketRow> {
  const next = stream(ctx.net, "network/fees");
  const whole = (drops: number) => drops / 1_000_000;
  return new Map(
    ctx.days.map((day) => {
      const count = sumOf(types.get(day)!);
      const [a, b, c, d, e] = [next(), next(), next(), next(), next()] as const;
      // Most transactions pay the base fee; on a busy day some pay more, and a few days a good deal more.
      const mean = ctx.profile.feeDrops * (0.85 + 0.3 * a) * (b < 0.06 ? 2 + 6 * c : 1);
      const total = Math.round(count * mean);
      const avg = count === 0 ? 0 : Math.round(total / count);
      return [day, { avg: whole(avg), max: whole(Math.max(MAX_FEES[Math.floor(d * MAX_FEES.length)]!, avg)), min: whole(e < 0.5 ? 0 : 10), total: whole(total), tx_count: count, date: startOf(day) }];
    }),
  );
}

// ---- Volumes ---------------------------------------------------------------------------------------------------------

type Kind = "payment" | "exchange" | "amm";
interface Components {
  payment: PaymentVolumeComponent;
  exchange: ExchangeVolumeComponent;
  amm: AmmVolumeComponent;
}
type Fields<K extends Kind> = Omit<Components[K], "amount" | "converted_amount" | "count" | "rate">;

/** What a kind trades in a day: one line for each of its components. */
interface Line<K extends Kind> {
  key: string;
  fields: Fields<K>;
  /** The currency the amount is in (`undefined` for the native one). */
  unit: string | undefined;
  /** Native units a day on an average one, and how much of that a draw can take away or add (0.3 is 30%). */
  volume: number;
  spread: number;
  /** How many payments or trades it was, from the native amount, the day's payments and a draw. */
  count: (native: number, payments: number, u: number) => number;
}

function linesOf<K extends Kind>(ctx: Context, kind: K, next: () => number): Array<Line<K>> {
  const { profile, markets } = ctx;
  const lines: Array<Line<Kind>> = [];
  if (kind === "payment") {
    for (const asset of [{ currency: profile.native } as AssetRef, ...markets.paymentCurrencies]) {
      const id = idOf(asset);
      const own = profile.payments[id];
      if (!own) throw new Error(`${ctx.net}: no payment profile for ${id}`);
      lines.push({
        key: id,
        fields: asset.issuer === undefined ? { currency: asset.currency } : { currency: asset.currency, issuer: asset.issuer },
        unit: asset.issuer === undefined ? undefined : id,
        volume: own.volume,
        spread: 0.3,
        count: (_native, payments, u) => Math.round(payments * own.share * (0.9 + 0.2 * u)),
      } satisfies Line<"payment">);
    }
  } else if (kind === "exchange") {
    for (const { base, counter } of markets.tradeMarkets) {
      const own = profile.trades[idOf(base)];
      if (!own) throw new Error(`${ctx.net}: no trade profile for ${idOf(base)}`);
      lines.push({
        key: `${idOf(base)}/${idOf(counter)}`,
        fields: { base, counter },
        unit: idOf(base),
        volume: own.volume,
        spread: 0.4,
        count: (native, _payments, u) => Math.round((native / own.size) * (0.8 + 0.4 * u)),
      } satisfies Line<"exchange">);
    }
  } else {
    // The pools' accounts come first in the stream, so that adding a day never changes them.
    for (const pool of profile.pools) {
      const amm_account = encodeAccountID(Uint8Array.from({ length: 20 }, () => Math.floor(next() * 256)));
      lines.push({
        key: amm_account,
        fields: { amm_account, base: pool.base, counter: pool.counter },
        unit: idOf(pool.base),
        volume: pool.volume,
        spread: 0.4,
        count: (native, _payments, u) => Math.round((native / pool.size) * (0.8 + 0.4 * u)),
      } satisfies Line<"amm">);
    }
  }
  return lines as Array<Line<K>>;
}

interface Part<K extends Kind> {
  line: Line<K>;
  /** In the component's currency. */
  amount: Decimal;
  /** In the native currency. */
  native: Decimal;
  count: number;
}
interface VolumeDay<K extends Kind> {
  parts: Array<Part<K>>;
  /** Payments of untracked currencies: they are in the row's `count` and in no component. */
  extra: number;
}

/** The days the routes have computed, from the first to `final`, with what each component did. Native amounts to 6 decimals. */
function volumesOf<K extends Kind>(ctx: Context, kind: K, types: Map<string, Counts>): { lines: Array<Line<K>>; days: Map<string, VolumeDay<K>> } {
  const next = stream(ctx.net, `network/${kind}_volume`);
  const lines = linesOf(ctx, kind, next);
  const shares = kind === "payment" ? Object.values(ctx.profile.payments).reduce((sum, { share }) => sum + share, 0) : 1;
  const days = new Map<string, VolumeDay<K>>();
  ctx.days.forEach((day, at) => {
    const act = busy(day, at, next(), 0.12);
    const payments = types.get(day)?.Payment ?? 0;
    const parts = lines.map((line): Part<K> => {
      const [u, v] = [next(), next()] as const;
      const native = new BN(line.volume * act * (1 - line.spread + 2 * line.spread * u)).decimalPlaces(6);
      const unit = line.unit === undefined ? undefined : ctx.profile.units[line.unit];
      if (line.unit !== undefined && !unit) throw new Error(`${ctx.net}: no units for ${line.unit}`);
      const amount = unit ? native.times(ctx.rates.get(day)! * unit.perUsd).decimalPlaces(unit.decimals) : native;
      return { line, amount, native, count: Math.max(1, line.count(native.toNumber(), payments, v)) };
    });
    // Every kind draws for the untracked payments, so that the streams of the three kinds have the same shape; only payments use it.
    const extra = Math.round(payments * (1 - shares) * (0.8 + 0.4 * next()));
    // The running day has no row yet: the route counts a day an hour after it ended.
    if (day <= ctx.final) days.set(day, { parts, extra: kind === "payment" ? extra : 0 });
  });
  return { lines, days };
}

/**
 * The row of a volume route for a bucket: its days' components added up and sorted by converted amount. A day converted to USD is converted at
 * its own rate, and a week adds up the converted days, as the API does.
 */
function volumeRow<K extends Kind>(
  ctx: Context,
  days: Map<string, VolumeDay<K>>,
  unit: "day" | "week",
  bucket: string,
  display: "native" | "usd",
): VolumeRow<Components[K]> {
  const sums = new Map<string, { part: Part<K>; amount: Decimal; converted: Decimal; count: number }>();
  let count = 0;
  let native = new BN(0);
  for (const day of daysOf(bucket, unit, ctx.final)) {
    const own = days.get(day)!;
    count += own.extra;
    for (const part of own.parts) {
      const converted = display === "usd" ? part.native.times(ctx.rates.get(day)!).decimalPlaces(6) : part.native;
      const sum = sums.get(part.line.key) ?? { part, amount: new BN(0), converted: new BN(0), count: 0 };
      sum.amount = sum.amount.plus(part.amount);
      sum.converted = sum.converted.plus(converted);
      sum.count += part.count;
      sums.set(part.line.key, sum);
      native = native.plus(part.native);
      count += part.count;
    }
  }
  const sorted = [...sums.values()].sort((a, b) => b.converted.comparedTo(a.converted) || (a.part.line.key < b.part.line.key ? -1 : 1));
  const total = sorted.reduce((sum, { converted }) => sum.plus(converted), new BN(0));
  const components = sorted.map(
    ({ part, amount, converted, count: swaps }) =>
      ({ ...part.line.fields, amount: amount.toFixed(), converted_amount: converted.toFixed(), count: swaps, rate: ratio(amount, converted) }) as unknown as Components[K],
  );
  return {
    components,
    count,
    exchange: display === "usd" ? USD : { currency: ctx.profile.native },
    exchange_rate: ratio(total, native),
    start_time: startOf(bucket),
    end_time: startOf(plusDays(bucket, unit === "week" ? 7 : 1)),
    total: total.toFixed(),
  };
}

/** The rows from `start`: a bucket is a row when it has a day the route has computed. */
function volumeRows<K extends Kind>(ctx: Context, days: Map<string, VolumeDay<K>>, unit: "day" | "week", start: string, display: "native" | "usd") {
  return bucketStarts(start, ctx.today, unit)
    .filter((bucket) => bucket <= ctx.final)
    .map((bucket) => volumeRow(ctx, days, unit, bucket, display));
}

// ---- Validations and the fee snapshot --------------------------------------------------------------------------------

/** The validations of each ledger: the same validators, each seen a little after the close. Keys are valid node public keys of seeded bytes. */
function validationFiles(ctx: Context, last: LastValidated, newest: readonly NewestLedger[]): FixtureFile[] {
  const next = stream(ctx.net, "ledgers/validations");
  const key = (): string => encodeNodePublic(Uint8Array.from([0xed, ...Array.from({ length: 32 }, () => Math.floor(next() * 256))]));
  const validators = Array.from({ length: ctx.profile.validators }, () => ({ master: key(), ephemeral: key() })).sort((a, b) => (a.master < b.master ? -1 : 1));
  const reporter = key();

  return newest.map((ledger) => {
    const closed = ledger.date !== undefined ? Date.parse(ledger.date) : ctx.closedAt - (Number(last.ledger_index) - ledger.index) * ctx.profile.ledgerSeconds * 1000;
    const validations = validators.map((validator): Validation => {
      const first = closed + Math.floor(next() * 401);
      return {
        base_fee: "10",
        count: 1 + Math.floor(next() * 3),
        ephemeral_public_key: validator.ephemeral,
        first_datetime: new Date(first).toISOString(),
        flags: "2147483649",
        full: "true",
        last_datetime: new Date(first + Math.floor(next() * 300)).toISOString(),
        ledger_hash: ledger.hash,
        ledger_index: String(ledger.index),
        reporter_public_key: reporter,
        reserve_base: "1000000",
        reserve_inc: "200000",
        // The Ripple epoch counts from 2000-01-01.
        signing_time: String(Math.floor(closed / 1000) - 946_684_800 + Math.floor(next() * 3)),
        validation_public_key: validator.master,
      };
    });
    const value: LedgerValidations = { result: "success", ledger_hash: ledger.hash, count: validations.length, validations };
    return { path: `/v2/ledgers/${ledger.hash}/validations`, query: "limit=1000", value };
  });
}

/**
 * The newest fee snapshot: taken 2 s before the close of the newest ledger, with nothing in the queue. The reference does not say what the marker
 * of a snapshot list is, and the page never follows one, so there is none.
 */
function feeStatsFile(ctx: Context): FixtureFile {
  const { snapshot } = ctx.profile;
  const row: FeeStatsRow = {
    current_ledger_size: snapshot.open,
    current_queue_size: 0,
    date: new Date(ctx.closedAt - 2000).toISOString().replace(".000Z", "Z"),
    expected_ledger_size: snapshot.expected,
    median_fee: snapshot.median,
    minimum_fee: 0.00001,
    open_ledger_fee: 0.00001,
    pct_max_queue_size: 0,
  };
  const value: Page<"rows", FeeStatsRow> = { result: "success", count: 1, rows: [row] };
  return { path: "/v2/network/fee_stats", query: `descending=true&limit=1&start=${ctx.today}`, value };
}

// ---- The files -------------------------------------------------------------------------------------------------------

const PERIODS: WindowPeriod[] = ["7d", "30d", "90d", "1y"];

/** A query as `data-api.ts` writes it, in its order; what is `undefined` is left out. */
const queryOf = (params: Record<string, string | undefined>): string =>
  Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join("&");

const page = <K extends string, T>(key: K, rows: T[]): Page<K, T> => ({ result: "success", count: rows.length, [key]: rows }) as Page<K, T>;

/**
 * Every synthetic answer of a network: path and query of the request that asks for it (the calls of spec 1.4, for the four periods and, on XRPL,
 * both display currencies) and its body. `last` is the newest ledger (its close time sets the day and how far through it the running day is), and
 * `newest` the two newest recorded ledgers, which have validations.
 */
export function networkFixtures(net: NetworkName, last: LastValidated, newest: readonly NewestLedger[]): FixtureFile[] {
  const ctx = contextOf(net, last);
  const types = typesOf(ctx);
  const metrics = metricsOf(ctx, types);
  const fees = feesOf(ctx, types);
  const payments = volumesOf(ctx, "payment", types).days;
  const exchanges = volumesOf(ctx, "exchange", types).days;
  const swaps = net === "xrpl" ? volumesOf(ctx, "amm", types).days : undefined;
  const displays = net === "xrpl" ? (["native", "usd"] as const) : (["native"] as const);

  const files: FixtureFile[] = [...validationFiles(ctx, last, newest), feeStatsFile(ctx)];
  for (const period of PERIODS) {
    const w = windowOf(ctx.today, period);
    const [W0, P0, end] = [w.start, w.previous.start, ctx.today];
    const base = { interval: w.unit, start: W0, end, limit: "1000" };
    files.push(
      { path: "/v2/stats/type", query: queryOf(base), value: page("stats", statsRows(ctx, w.unit, W0, end, (day) => types.get(day)!)) },
      {
        path: "/v2/stats/metric",
        query: queryOf({ ...base, start: P0, metrics: "accounts_created,ledger_count,transaction_count" }),
        value: page(
          "stats",
          statsRows(ctx, w.unit, P0, end, (day) => ({ ...metrics.get(day)! })),
        ),
      },
      { path: "/v2/network/fees", query: queryOf({ ...base, interval: "day" }), value: page("rows", bucketStarts(W0, end, "day").map((day) => fees.get(day)!)) },
    );
    for (const display of displays) {
      const shown = display === "usd" ? { exchange_currency: USD.currency, exchange_issuer: USD.issuer } : {};
      files.push(
        { path: "/v2/network/payment_volume", query: queryOf({ ...base, start: P0, ...shown }), value: page("rows", volumeRows(ctx, payments, w.unit, P0, display)) },
        { path: "/v2/network/exchange_volume", query: queryOf({ ...base, ...shown }), value: page("rows", volumeRows(ctx, exchanges, w.unit, W0, display)) },
      );
      if (swaps) {
        files.push({ path: "/v2/network/amm_volume", query: queryOf({ ...base, ...shown }), value: page("rows", volumeRows(ctx, swaps, w.unit, W0, display)) });
      }
    }
  }
  return files;
}
