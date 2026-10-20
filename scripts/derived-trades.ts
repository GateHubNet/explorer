// The /v2/exchanges rows of the recorded ledgers, worked out from their transactions' metadata as the data API works them out. E3's pair fixtures
// (scripts/market-fixtures.ts) and E5's swap fixtures are made from them; test/fixtures/PROVENANCE.md ("Derived trades and pool states") names
// the commits. A row is the API's `PairExchange`, in the key order of the reference's row.
//
// The rules are the data API's, ported (data-api-new at feat/amm-data, never imported):
//
//   packages/shared/src/parsers/exchanges.parser.ts   an order-book trade from each Offer node a successful Payment or OfferCreate consumed
//                                                      (`ExchangeParser.parse`, `.exchange`, `consumed`, `offerRate`, `autobridgedThrough`,
//                                                      `amountsQuality`, `exchangeRate`, `canonicalPairKey`)
//   packages/shared/src/parsers/amm.parser.ts         a swap from each pool a successful Payment or OfferCreate moved (`AmmParser.swap`)
//   packages/shared/src/util/quality.ts               `parseQuality`, the price of an offer from the end of its book directory
//   apps/api/src/exchanges/exchange-object.ts         the row as the API serves it (`toExchangeObject`): the key order, `rate` at 8 significant
//                                                      digits, the inverted row (`ratio` in packages/shared/src/query/decimal.ts: 200 decimals)
//   apps/api/src/common/format.ts                      `precision8`: `toPrecision(8)`
//
// Where this differs from the parsers: a swap's pools and their amounts are `ammHops`' (app/domain/parse/amm-hops.ts: the pool's own changes, exact),
// not the parser's own walk of the metadata, and amounts are written with `toFixed()`, never in exponent form. The parsers' `toString()` writes the
// exponent form from 1e20 and below 1e-6, so the API serves "5.5801387e-9" where a row here has "0.0000000055801387" (two swaps of a worthless token
// in ledger 102186243); the client reads both (`isNumberText`).

import BigNumber from "bignumber.js";

import { canonicalPair, sameAsset, type Asset } from "../app/domain/asset";
import { ammHops } from "../app/domain/parse/amm-hops";
import { nodesOf, type Node } from "../app/domain/parse/objects";
import type { TxMeta } from "../app/domain/parse/types";
import type { PairExchange } from "../app/server/api-types";
import { inLedgerOrder, isoTime, unixOf, type RawLedger, type RawTx } from "./http-fixtures";

/** The native currency of XRPL, which the recorded ledgers are of. */
const NATIVE = "XRP";

/** `RippleState` flag: the line belongs to an AMM (the pool's reserve line). */
const LSF_AMM_NODE = 0x01000000;

/**
 * BigNumber as the data API's parsers have it (bignumber.js 9, on its defaults): 20 decimal places, rounded half up, and the exponent form from 1e20 and
 * below 1e-6. A rate is computed and printed with it, so it has the digits the API's has.
 */
const Parser = BigNumber.clone({ DECIMAL_PLACES: 20, ROUNDING_MODE: BigNumber.ROUND_HALF_UP, EXPONENTIAL_AT: [-7, 20] });
/** The room of an inverse rate (`ratio`): an amount runs from 1e-81 to 1e96, and the default 20 places would turn the inverse of a rate above 1e12 into 0. */
const Wide = BigNumber.clone({ DECIMAL_PLACES: 200, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });

/** An exchange rate or a candle's price as the API serves it: 8 significant digits, trailing zeros kept (`0.004` is `0.0040000000`). */
const precision8 = (value: BigNumber.Value): string => new Parser(value).toPrecision(8);

/** `1 / rate` to 200 decimal places, copied as it is: not rounded again by the caller's own arithmetic. */
const inverse = (rate: BigNumber.Value): BigNumber => new Parser(new Wide(1).dividedBy(rate));

// ---- The row ---------------------------------------------------------------------------------------------------------

/** The keys of an exchange in the order of the original's row (the reference lists them), the optional ones where a row has them. */
const KEY_ORDER = [
  "base_amount",
  "counter_amount",
  "node_index",
  "rate",
  "tx_index",
  "autobridged_currency",
  "autobridged_issuer",
  "buyer",
  "executed_time",
  "ledger_index",
  "offer_sequence",
  "provider",
  "seller",
  "taker",
  "tx_hash",
  "tx_type",
  "base_currency",
  "base_issuer",
  "counter_currency",
  "counter_issuer",
  "amm_account",
] as const satisfies readonly (keyof PairExchange)[];

/** The row with its keys in the reference's order, and none for a field a row does not have (the native currency has no issuer). */
function inReferenceOrder(row: PairExchange): PairExchange {
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    if (row[key] !== undefined) ordered[key] = row[key];
  }
  return ordered as unknown as PairExchange;
}

/**
 * The `rate` each row stored before it was cut to 8 digits, by row. The API inverts the stored rate (`ratio(1, row.rate)` on the stored text), not the
 * 8 digits it served: inverting those instead gives another 8th digit for about three rows in ten. A row that is a copy of a derived one has no entry
 * here, and `invertedExchange` has only its 8 digits for it.
 */
const stored = new WeakMap<PairExchange, string>();

/** The row as the API serves it, with the rate it stored (`rate` is its first 8 significant digits). */
function served(row: Omit<PairExchange, "rate">, rate: string): PairExchange {
  const made = inReferenceOrder({ ...row, rate: precision8(rate) });
  stored.set(made, rate);
  return made;
}

// ---- What a transaction is -------------------------------------------------------------------------------------------

/** What the rows of one transaction share. */
interface Transaction {
  ledgerIndex: number;
  executedTime: string;
  txIndex: number;
  hash: string;
  type: string;
  /** The transaction's `Account`: who took the offers and the pools. */
  taker: string;
  /** The transaction itself, for `autobridgedThrough`. */
  tx: RawTx;
}

type Issued = { currency: string; issuer: string; value: string };

/** An issued-currency amount object (`currency`, `issuer`, `value`), as opposed to a drops string or an MPT amount. */
function isIssued(amount: unknown): amount is Issued {
  return typeof amount === "object" && amount !== null && typeof (amount as { currency?: unknown }).currency === "string";
}

/** A native amount (drops text) or an issued-currency one. An MPT amount is neither. */
const isSupported = (amount: unknown): boolean => typeof amount === "string" || isIssued(amount);

/** One side of an order-book exchange while it is being built. */
interface Side {
  currency: string;
  /** Absent for the native currency. */
  issuer?: string;
  native: boolean;
  /** Whole units, exact. */
  amount: string;
}

const assetOf = ({ currency, issuer }: Side): Asset => (issuer === undefined ? { currency } : { currency, issuer });

/** The part of one side of the offer that was consumed (`consumed`). */
function consumed(before: unknown, after: unknown): Side {
  if (isIssued(before)) {
    const change = new Parser(before.value).minus((after as Issued).value);
    return { currency: before.currency, issuer: before.issuer, native: false, amount: change.toFixed() };
  }
  const drops = new Parser(before as string).minus(after as string);
  return { currency: NATIVE, native: true, amount: drops.shiftedBy(-6).toFixed() };
}

const usable = (rate: BigNumber): boolean => rate.isFinite() && rate.gt(0);

/**
 * The quality encoded in the trailing 8 bytes of an order book directory: TakerPays over TakerGets of the offers in it, in whole units of each side
 * (`parseQuality`, which the Ripple Data API copied from ripple-lib-extensions). Like the reference it never throws: what is not hex gives NaN.
 */
function bookQuality(bookDirectory: unknown, paysIsNative: boolean, getsIsNative: boolean): BigNumber {
  if (typeof bookDirectory !== "string") return new Parser(Number.NaN);
  const qualityHex = bookDirectory.slice(-16);
  const mantissa = new Parser(qualityHex.slice(2), 16);
  const offset = Number.parseInt(qualityHex.slice(0, 2), 16) - 100;
  const quality = new Parser(`${mantissa.toString()}e${offset}`);
  const shift = (paysIsNative ? -6 : 0) - (getsIsNative ? -6 : 0);
  return shift === 0 ? quality : quality.shiftedBy(shift);
}

/** What the provider received per unit it paid, from the amounts that changed hands (`amountsQuality`); undefined unless positive and finite. */
function amountsQuality(received: string, paid: string): BigNumber | undefined {
  const ratio = new Parser(received).dividedBy(paid);
  return usable(ratio) ? ratio : undefined;
}

/** The rate of a consumed offer: base per counter, from the offer's quality, else from the amounts that changed hands (`offerRate`). */
function offerRate(bookDirectory: unknown, base: Side, counter: Side): BigNumber | undefined {
  const quality = bookQuality(bookDirectory, base.native, counter.native);
  return usable(quality) ? quality : amountsQuality(base.amount, counter.amount);
}

/**
 * The `rate` as the parsers store it, counter per base, from the provider's quality (received per paid). `paidIsBase` says the stored order put what the
 * provider paid first; otherwise base is what it received and the quality is inverted (`exchangeRate`).
 */
const storedRate = (quality: BigNumber, paidIsBase: boolean): string => (paidIsBase ? quality.toString() : quality.pow(-1).toString());

/**
 * An OfferCreate between two issued currencies whose exchange has a native side was bridged through the native currency. The reference names the
 * bridge by currency code alone, not by issuer: if the issued side of the exchange has the code of the transaction's TakerPays the far side is
 * TakerGets, else if it has TakerGets's code the far side is TakerPays (`autobridgedThrough`). Used for order-book trades and swaps alike.
 */
function autobridgedThrough(
  tx: RawTx,
  base: { currency: string; native: boolean },
  counter: { currency: string; native: boolean },
): { currency: string; issuer: string } | undefined {
  const { TakerPays, TakerGets } = tx;
  if (!isIssued(TakerPays) || !isIssued(TakerGets) || base.native === counter.native) return undefined;

  const issued = base.native ? counter : base;
  if (issued.currency === TakerPays.currency) return { currency: TakerGets.currency, issuer: TakerGets.issuer };
  if (issued.currency === TakerGets.currency) return { currency: TakerPays.currency, issuer: TakerPays.issuer };
  return undefined;
}

// ---- Order-book trades -----------------------------------------------------------------------------------------------

/**
 * The trade a consumed or changed Offer node is (`ExchangeParser.exchange`), or undefined for an offer that is not one the transaction took (no
 * previous amounts) or whose rate cannot be derived.
 */
function tradeOf(t: Transaction, node: Node, nodeIndex: number): PairExchange | undefined {
  const { fields: after, previous: before } = node;
  if (node.type !== "Offer" || node.change === "created") return undefined;
  if (typeof after.Account !== "string" || !after.TakerPays || !after.TakerGets) return undefined;
  if (!before.TakerPays || !before.TakerGets || !isSupported(before.TakerPays) || !isSupported(before.TakerGets)) return undefined;

  // The offer's owner pays TakerGets and receives TakerPays; the other party is the transaction's sender, who takes the offer. The exchange's
  // base is what the owner receives.
  let base = consumed(before.TakerPays, after.TakerPays);
  let counter = consumed(before.TakerGets, after.TakerGets);
  const quality = offerRate(after.BookDirectory, base, counter);
  if (!quality) return undefined;

  const bridge = t.type === "OfferCreate" ? autobridgedThrough(t.tx, base, counter) : undefined;

  let buyer = after.Account;
  let seller = t.taker;
  // The pair is stored in the API's order: the side with the lower currency+issuer key first.
  const [lower] = canonicalPair(assetOf(base), assetOf(counter));
  const flipped = !sameAsset(lower, assetOf(base));
  if (flipped) {
    [base, counter] = [counter, base];
    [buyer, seller] = [seller, buyer];
  }
  // The quality was base per counter; once flipped that is counter per base.
  const rate = storedRate(quality, flipped);

  return served(
    {
      base_amount: base.amount,
      counter_amount: counter.amount,
      node_index: nodeIndex,
      tx_index: t.txIndex,
      autobridged_currency: bridge?.currency,
      autobridged_issuer: bridge?.issuer,
      buyer,
      executed_time: t.executedTime,
      ledger_index: t.ledgerIndex,
      offer_sequence: after.Sequence as number,
      provider: after.Account,
      seller,
      taker: t.taker,
      tx_hash: t.hash,
      tx_type: t.type,
      base_currency: base.currency,
      base_issuer: base.issuer,
      counter_currency: counter.currency,
      counter_issuer: counter.issuer,
    },
    rate,
  );
}

// ---- Swaps against a pool --------------------------------------------------------------------------------------------

/**
 * The index, in the metadata, of the node a swap row points at: the pool's account node, else its first reserve line (`AmmParser.swap`: `pool.root ??
 * pool.lines[0]`). A pool between two issued currencies shows no account node in a swap, only its reserve lines (`lsfAMMNode`), which have the pool as
 * one of their two sides.
 */
function poolNodeIndex(nodes: readonly Node[], pool: string): number {
  const root = nodes.findIndex((node) => node.type === "AccountRoot" && "AMMID" in node.fields && node.fields.Account === pool);
  if (root >= 0) return root;
  const line = nodes.findIndex((node) => {
    if (node.type !== "RippleState") return false;
    const flags = Number(node.fields.Flags ?? 0) | Number(node.previous.Flags ?? 0);
    const sides = [node.fields.LowLimit, node.fields.HighLimit].map((limit) => (limit as { issuer?: string } | undefined)?.issuer);
    return (flags & LSF_AMM_NODE) !== 0 && sides.includes(pool);
  });
  if (line < 0) throw new Error(`${pool}: a pool of ${nodes.length} nodes that shows neither its account nor a reserve line`);
  return line;
}

/** The swaps a transaction made, one for each pool that took in one asset and paid out another (`AmmParser.swap`). */
function swapsOf(t: Transaction, meta: TxMeta, nodes: readonly Node[]): PairExchange[] {
  const swaps: PairExchange[] = [];
  for (const hop of ammHops(meta, NATIVE)) {
    // What the pool received per unit it paid.
    const quality = amountsQuality(hop.in.value, hop.out.value);
    if (!quality) continue;

    const [lower] = canonicalPair(hop.in, hop.out);
    const paidIsBase = sameAsset(lower, hop.out);
    const [base, counter] = paidIsBase ? [hop.out, hop.in] : [hop.in, hop.out];
    const bridge =
      t.type === "OfferCreate"
        ? autobridgedThrough(t.tx, { currency: base.currency, native: base.issuer === undefined }, { currency: counter.currency, native: counter.issuer === undefined })
        : undefined;

    swaps.push(
      served(
        {
          base_amount: base.value,
          counter_amount: counter.value,
          node_index: poolNodeIndex(nodes, hop.pool),
          tx_index: t.txIndex,
          autobridged_currency: bridge?.currency,
          autobridged_issuer: bridge?.issuer,
          // Who received base: the taker when base flowed out of the pool, else the pool.
          buyer: paidIsBase ? t.taker : hop.pool,
          executed_time: t.executedTime,
          ledger_index: t.ledgerIndex,
          offer_sequence: 0,
          provider: hop.pool,
          seller: paidIsBase ? hop.pool : t.taker,
          taker: t.taker,
          tx_hash: t.hash,
          tx_type: t.type,
          base_currency: base.currency,
          base_issuer: base.issuer,
          counter_currency: counter.currency,
          counter_issuer: counter.issuer,
          amm_account: hop.pool,
        },
        storedRate(quality, paidIsBase),
      ),
    );
  }
  return swaps;
}

// ---- The rows --------------------------------------------------------------------------------------------------------

/** Every row of a successful Payment or OfferCreate: its swaps and the trades of the offers it took. */
function rowsOfTransaction(raw: RawLedger, tx: RawTx): PairExchange[] {
  const meta = tx.metaData as unknown as TxMeta;
  if (meta.TransactionResult !== "tesSUCCESS") return [];
  if (tx.TransactionType !== "Payment" && tx.TransactionType !== "OfferCreate") return [];

  const t: Transaction = {
    ledgerIndex: Number(raw.ledger.ledger_index),
    executedTime: isoTime(unixOf(raw.ledger.close_time)),
    txIndex: meta.TransactionIndex,
    hash: tx.hash,
    type: tx.TransactionType,
    taker: tx.Account,
    tx,
  };
  const nodes = nodesOf(meta);
  const trades = nodes.flatMap((node, index) => tradeOf(t, node, index) ?? []);
  return [...trades, ...swapsOf(t, meta, nodes)];
}

/** Every /v2/exchanges row of the recorded ledgers (all three XRPL sets), in the stored pair order, oldest first by (ledger_index, tx_index, node_index). */
export function derivedExchanges(ledgers: readonly RawLedger[]): PairExchange[] {
  const rows = ledgers.flatMap((raw) => inLedgerOrder(raw).flatMap((tx) => rowsOfTransaction(raw, tx)));
  return rows.sort((a, b) => a.ledger_index - b.ledger_index || a.tx_index - b.tx_index || a.node_index - b.node_index);
}

/**
 * The row as the API serves it for the pair asked in reverse: sides, amounts, buyer and seller swapped, rate 1/rate (200 decimals, then 8 significant
 * digits). A row `derivedExchanges` made is inverted from the rate it stored, as the API does it; any other row (a copy, or one made by hand) from its
 * own 8 digits, which is the same but for the last digit of about three rows in ten.
 */
export function invertedExchange(row: PairExchange): PairExchange {
  const exact = inverse(stored.get(row) ?? row.rate).toString();
  return served(
    {
      ...row,
      base_amount: row.counter_amount,
      counter_amount: row.base_amount,
      buyer: row.seller,
      seller: row.buyer,
      base_currency: row.counter_currency,
      base_issuer: row.counter_issuer,
      counter_currency: row.base_currency,
      counter_issuer: row.base_issuer,
    },
    exact,
  );
}
