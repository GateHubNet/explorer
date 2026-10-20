// What the account page shows, worked out in the Worker from the data API's and the node's answers (spec 2, 3, 7.2, 10): the
// header (activation, flags, sequence, balance with its reserve, tokens, owned objects) and, for each tab, the list. The page
// gets this and never the transactions' JSON or the node's ledger entries, so the code that reads metadata stays out of the
// browser bundle. No I/O.
//
// Amounts: the API's exact decimal strings are passed on as they are; what is computed here (the reserve, the rate of an offer)
// is computed with bignumber.js and written in plain decimal notation, never as a float.

import BigNumber from "bignumber.js";

import { accountHref, ACCOUNT_TABS, isAccountTab, OBJECTS_LIMIT, type AccountTab, type ListTab } from "../domain/account-tabs";
import { describe, rowSentence, type Segment } from "../domain/describe";
import { dropsToNative, formatUtc } from "../domain/format";
import { MAX_TRAIL, parseTrail, trailPaging, type Paging } from "../domain/paging";
import { balanceChanges } from "../domain/parse";
import type { Native } from "../domain/parse/types";
import type { AnalyticsData } from "./analytics-view";
import type { AccountData, AccountExchange, BalancesResponse, OrdersResponse, Page, Payment, TxObject } from "./api-types";
import type { NetworkId } from "./networks";
import { RIPPLE_EPOCH_OFFSET, type AccountInfo, type AccountObjects, type LedgerObject, type ServerState } from "./node-rpc";
import { UpstreamError } from "./upstream";

// ---------------------------------------------------------------------------------------------------------------------------
// The tabs and the URL

export { accountHref, ACCOUNT_TABS, isAccountTab, OBJECTS_LIMIT, type AccountTab, type ListTab };

/** The tabs whose list is paged by marker; the offers and the objects are read live and have one page. */
export const PAGED_TABS: readonly AccountTab[] = ["transactions", "payments", "trades"];

/** Rows of a page of a list. */
export const PAGE_SIZE = 20;

export { MAX_TRAIL, parseTrail, type Paging };

const UINT32_MAX = 4294967295;

/**
 * A destination tag from `?tag=`: a decimal number, written the one way, that fits 32 bits. Anything else is no tag and is never
 * shown (it came from a URL anyone can write).
 */
export function parseTag(text: string | null): number | null {
  if (text === null || !/^(?:0|[1-9]\d{0,9})$/.test(text)) return null;
  const tag = Number(text);
  return tag <= UINT32_MAX ? tag : null;
}

/**
 * The Newer and Older links of a page of a list (`trailPaging`, which the other paged lists share), written as the account page's URLs.
 * A page reached with no trail (a link someone copied) goes back to the first page.
 */
export function pagingOf(
  net: NetworkId,
  address: string,
  page: { tab: AccountTab; marker?: string; back: readonly string[]; next?: string },
): Paging {
  return trailPaging(page, (to) => accountHref(net, address, { tab: page.tab, ...to }));
}

// ---------------------------------------------------------------------------------------------------------------------------
// What the calls came to

/** The outcome of a call the page can do without: its value, that the thing is not there, or that the call failed. */
export type Loaded<T> = { state: "ok"; value: T } | { state: "missing" } | { state: "failed" };

/**
 * `Promise.allSettled`'s result as a `Loaded`. A "not found" of an upstream is `missing`; any other failure of an upstream is
 * `failed`. An error that is not an upstream's is a bug and is thrown again.
 */
export function loaded<T>(result: PromiseSettledResult<T>): Loaded<T> {
  if (result.status === "fulfilled") return { state: "ok", value: result.value };
  if (!(result.reason instanceof UpstreamError)) throw result.reason;
  return result.reason.kind === "not_found" ? { state: "missing" } : { state: "failed" };
}

export type Existence = "active" | "deleted" | "unverified" | "never-activated" | "outage" | "undetermined";

/**
 * Whether the account exists, from what the index, the node and (when they cannot tell) the index's history say (spec 10).
 *
 * - The index knows it and the node has it: active. The node says it is gone: deleted. The node did not answer: `unverified`,
 *   shown with the history and without its live state.
 * - The index has no creation and the node has the account: active (the index may be behind).
 * - Neither has it: `undetermined` until `history` says whether the index has any transaction of the address. The index is filled by
 *   range, so an account created before its first ledger has no creation record, and a deleted one is then known by its history alone:
 *   a history is a deleted account (its activation unknown), none is never activated, and a history that could not be asked for is an
 *   outage, because a page must not say "never activated" without knowing.
 * - The index failed, or has nothing and the node did not answer: `outage`. It cannot be told either.
 */
export function existenceOf(created: Loaded<AccountData>, info: Loaded<AccountInfo>, history?: Loaded<boolean>): Existence {
  if (created.state === "failed") return "outage";
  if (created.state === "missing") {
    if (info.state === "ok") return "active";
    if (info.state === "failed") return "outage";
    if (history === undefined) return "undetermined";
    if (history.state !== "ok") return "outage";
    return history.value ? "deleted" : "never-activated";
  }
  return info.state === "ok" ? "active" : info.state === "missing" ? "deleted" : "unverified";
}

// ---------------------------------------------------------------------------------------------------------------------------
// The header

export interface Activation {
  /** Unix seconds. */
  time: number;
  parent: string;
  /** Whole units of the native currency. */
  initialBalance: string;
  txHash: string;
}

export interface Reserve {
  /** Whole units of the native currency. */
  total: string;
  base: string;
  increment: string;
  /** The objects the increment is paid for. */
  objects: number;
}

/**
 * The reserve of an account and what is left of its balance: the base reserve plus the increment for each object it owns, as the
 * network has voted them (`reserve_base` and `reserve_inc` of `server_state`, in drops). `available` is never below 0.
 */
export function reserveOf(
  balanceDrops: string,
  ownerCount: number,
  reserveBase: number,
  reserveInc: number,
): { reserve: Reserve; available: string } {
  const total = new BigNumber(reserveBase).plus(new BigNumber(ownerCount).times(reserveInc));
  const available = BigNumber.max(new BigNumber(balanceDrops).minus(total), 0);
  return {
    reserve: {
      total: dropsToNative(total.toFixed()),
      base: dropsToNative(String(reserveBase)),
      increment: dropsToNative(String(reserveInc)),
      objects: ownerCount,
    },
    available: dropsToNative(available.toFixed()),
  };
}

export interface AccountFlag {
  id: string;
  label: string;
}

// The flags of an AccountRoot (`lsf...`). The same bit can mean different things on the two networks (0x02000000 is the AMM flag on
// the XRP Ledger), so a flag that only one has is listed for that one, and a bit nobody here knows says nothing.
const FLAGS: ReadonlyArray<{ mask: number; id: string; label: (native: Native) => string; only?: NetworkId }> = [
  { mask: 0x00020000, id: "requireDestTag", label: () => "Requires destination tag" },
  { mask: 0x00040000, id: "requireAuth", label: () => "Requires trust line authorization" },
  // lsfDisallowXRP asks senders not to pay in the native currency; the ledger does not stop them (a wallet or a service may heed it).
  { mask: 0x00080000, id: "disallowNative", label: (native) => `Asks not to receive ${native}` },
  { mask: 0x00100000, id: "disableMaster", label: () => "Master key disabled" },
  { mask: 0x00200000, id: "noFreeze", label: () => "No freeze" },
  { mask: 0x00400000, id: "globalFreeze", label: () => "Global freeze" },
  { mask: 0x00800000, id: "defaultRipple", label: () => "Default ripple" },
  { mask: 0x01000000, id: "depositAuth", label: () => "Deposit authorization" },
  { mask: 0x02000000, id: "amm", label: () => "AMM pool account", only: "xrpl" },
  { mask: 0x04000000, id: "blockNftOffers", label: () => "Blocks incoming NFT offers" },
  { mask: 0x08000000, id: "blockChecks", label: () => "Blocks incoming checks" },
  { mask: 0x10000000, id: "blockPayChannels", label: () => "Blocks incoming payment channels" },
  { mask: 0x20000000, id: "blockTrustLines", label: () => "Blocks incoming trust lines" },
  { mask: 0x80000000, id: "allowClawback", label: () => "Clawback allowed", only: "xrpl" },
];

/** The flags of an account worth showing, in the order of their bits. */
export function accountFlags(flags: number, net: NetworkId): AccountFlag[] {
  const native: Native = net === "xahau" ? "XAH" : "XRP";
  const bits = flags >>> 0;
  return FLAGS.filter((flag) => (flag.only === undefined || flag.only === net) && (bits & flag.mask) !== 0).map((flag) => ({
    id: flag.id,
    label: flag.label(native),
  }));
}

/**
 * The domain an account set, from the hex of its ASCII text. Only a plausible domain is shown: whole bytes of printable ASCII
 * with no space, at most 255 of them. Anything else is not text to put on a page.
 */
export function decodeDomain(hex: string | undefined): string | null {
  if (hex === undefined || !/^(?:[0-9A-Fa-f]{2})+$/.test(hex) || hex.length > 510) return null;
  const bytes = hex.match(/../g)!.map((pair) => Number.parseInt(pair, 16));
  return bytes.every((byte) => byte >= 0x21 && byte <= 0x7e) ? String.fromCharCode(...bytes) : null;
}

export interface OwnedCount {
  type: string;
  label: string;
  count: number;
}

const OWNED_LABELS: ReadonlyArray<readonly [type: string, one: string, many: string]> = [
  ["RippleState", "trust line", "trust lines"],
  ["Offer", "offer", "offers"],
  ["Escrow", "escrow", "escrows"],
  ["Check", "check", "checks"],
  ["PayChannel", "payment channel", "payment channels"],
  ["NFTokenPage", "NFT page", "NFT pages"],
  ["Ticket", "ticket", "tickets"],
  ["SignerList", "signer list", "signer lists"],
  ["DepositPreauth", "deposit preauthorization", "deposit preauthorizations"],
  ["NFTokenOffer", "NFT offer", "NFT offers"],
  ["URIToken", "URI token", "URI tokens"],
];

/**
 * The objects an account owns, counted by type: the known types first, in a fixed order, then any other by name. A label is in the
 * singular for one (`1 escrow`) and the plural otherwise; a type with no name here is shown as its own.
 */
export function ownedCounts(objects: readonly LedgerObject[]): OwnedCount[] {
  const counts = new Map<string, number>();
  for (const object of objects) counts.set(object.LedgerEntryType, (counts.get(object.LedgerEntryType) ?? 0) + 1);
  const known = OWNED_LABELS.filter(([type]) => counts.has(type)).map(([type, one, many]) => ({
    type,
    label: counts.get(type) === 1 ? one : many,
    count: counts.get(type)!,
  }));
  const others = [...counts.keys()]
    .filter((type) => !OWNED_LABELS.some(([known_]) => known_ === type))
    .sort()
    .map((type) => ({ type, label: type, count: counts.get(type)! }));
  return [...known, ...others];
}

export interface Token {
  /** As the API gave it: three characters, or 40 hex digits. */
  currency: string;
  /** The other side of the trust line; for an LP token, the AMM pool. */
  issuer: string;
  value: string;
  /** An LP token: a 40-hex code that starts with `03`. */
  lp: boolean;
}

/** The API's default and largest page of balances: a list that fills it may go on. */
const BALANCES_DEFAULT_LIMIT = 200;

/** The trust lines of an account's balances, the native balance left out. */
export function tokensOf(balances: BalancesResponse): { items: Token[]; truncated: boolean } {
  const items = balances.balances
    .filter((balance) => balance.counterparty !== undefined)
    .map((balance) => ({
      currency: balance.currency,
      issuer: balance.counterparty!,
      value: balance.value,
      lp: /^03[0-9A-Fa-f]{38}$/.test(balance.currency),
    }));
  return { items, truncated: balances.balances.length >= (balances.limit ?? BALANCES_DEFAULT_LIMIT) };
}

export interface LastActive {
  ledgerIndex: number;
  /** The transaction that last changed the account. */
  hash: string;
  /** Unix seconds, when the ledger it is in could be read. */
  time: number | null;
}

export type LiveState =
  | {
      state: "ok";
      /** The ledger the live state was read at. */
      ledgerIndex: number;
      sequence: number;
      flags: AccountFlag[];
      regularKey: boolean;
      domain: string | null;
      lastActive: LastActive | null;
    }
  /** The node did not answer. */
  | { state: "unavailable" }
  /** There is nothing to read: the account was deleted. */
  | { state: "none" };

export interface BalanceView {
  /** Whole units of the native currency. */
  native: string;
  /** What the balance leaves after the reserve; `null` when the reserve is not known. */
  available: string | null;
  reserve: Reserve | null;
}

export type TokensView = { state: "ok"; items: Token[]; truncated: boolean } | { state: "failed" } | { state: "none" };

export interface OwnedView {
  counts: OwnedCount[];
  /** The node had more than the first page of objects: the counts are of the first `OBJECTS_LIMIT`. */
  truncated: boolean;
}

export interface AccountHeader {
  status: "active" | "deleted";
  activation: Activation | null;
  live: LiveState;
  balance: BalanceView | null;
  tokens: TokensView;
  owned: OwnedView | null;
  /** Some of what the node tells could not be read: the page says "Live state unavailable". */
  nodeProblem: boolean;
}

export interface HeaderInput {
  native: Native;
  created: Loaded<AccountData>;
  info: Loaded<AccountInfo>;
  /** The node's objects of the account, for the owned objects: a header with its holdings needs them, one without (the analytics view) asks for none. */
  objects?: Loaded<AccountObjects>;
  state: Loaded<ServerState>;
  /** The index's balances, for the tokens (and the native balance when the node did not answer): as `objects`. */
  balances?: Loaded<BalancesResponse>;
  /** The close time (unix seconds) of the ledger that last changed the account, if it could be read. */
  lastLedgerTime: number | null;
  /** Whether the index has a transaction of the address: asked only when neither the index nor the node has the account. */
  history?: Loaded<boolean>;
}

/** A call a header with its holdings reads: leaving it out is the caller's mistake, not a call that failed. */
function needed<T>(value: Loaded<T> | undefined, name: string): Loaded<T> {
  if (value === undefined) throw new Error(`accountHeader with its holdings needs the ${name}`);
  return value;
}

export function activationOf(created: AccountData): Activation {
  return {
    time: Date.parse(created.inception) / 1000,
    parent: created.parent,
    initialBalance: created.initial_balance,
    txHash: created.tx_hash,
  };
}

/**
 * The header of an account that exists: `existenceOf` says active, deleted or unverified (the node did not answer). `problems`
 * names what could not be read, for the log and for the degraded mark: a page with any of them is served and not stored.
 *
 * `holdings` (the default) is the header of the list tabs, with the tokens and the owned objects, and needs `objects` and `balances`.
 * Without it (the analytics view, spec 2.1) neither is read: `owned` is `null`, `tokens` is `none`, neither adds a problem, and the balance
 * is the node's alone (an account whose node did not answer has none, and the page says the balance could not be read).
 */
export function accountHeader(input: HeaderInput, { holdings }: { holdings: boolean } = { holdings: true }): { header: AccountHeader; problems: string[] } {
  const { native, created, info, state, lastLedgerTime, history } = input;
  const objects = holdings ? needed(input.objects, "objects") : undefined;
  const balances = holdings ? needed(input.balances, "balances") : undefined;
  const existence = existenceOf(created, info, history);
  if (existence === "never-activated" || existence === "outage" || existence === "undetermined") {
    throw new Error(`accountHeader is for an account that exists, not one that is ${existence}`);
  }
  const net: NetworkId = native === "XAH" ? "xahau" : "xrpl";
  const deleted = existence === "deleted";
  const problems: string[] = [];

  // What the node says of the account.
  let live: LiveState;
  if (deleted) {
    live = { state: "none" };
  } else if (info.state === "ok") {
    const root = info.value.account_data;
    live = {
      state: "ok",
      ledgerIndex: info.value.ledger_index,
      sequence: root.Sequence,
      flags: accountFlags(root.Flags, net),
      regularKey: typeof root.RegularKey === "string" && root.RegularKey !== "",
      domain: decodeDomain(root.Domain),
      lastActive:
        typeof root.PreviousTxnID === "string" && Number.isInteger(root.PreviousTxnLgrSeq)
          ? { ledgerIndex: root.PreviousTxnLgrSeq, hash: root.PreviousTxnID, time: lastLedgerTime }
          : null,
    };
  } else {
    live = { state: "unavailable" };
    problems.push("node account_info failed");
  }

  // The balance: the node's, which the reserve is worked out from; else the native balance the index read.
  let balance: BalanceView | null = null;
  if (!deleted) {
    const indexed = balances?.state === "ok" ? balances.value.balances.find((b) => b.counterparty === undefined)?.value : undefined;
    const nativeBalance = info.state === "ok" ? dropsToNative(info.value.account_data.Balance) : indexed;
    if (nativeBalance !== undefined) {
      balance = { native: nativeBalance, available: null, reserve: null };
      if (info.state === "ok" && state.state === "ok") {
        const ledger = state.value.validated_ledger;
        if (ledger) {
          const worked = reserveOf(info.value.account_data.Balance, info.value.account_data.OwnerCount, ledger.reserve_base, ledger.reserve_inc);
          balance = { native: nativeBalance, available: worked.available, reserve: worked.reserve };
        } else {
          problems.push("the node has no validated ledger to read the reserves from");
        }
      }
    }
  }

  // What the node owns, for the counts of the page's margin.
  let owned: OwnedView | null = null;
  if (!deleted && objects) {
    if (objects.state === "ok") {
      owned = { counts: ownedCounts(objects.value.account_objects), truncated: objects.value.marker !== undefined };
    } else if (objects.state === "failed") {
      problems.push("node account_objects failed");
    }
  }
  if (!deleted && state.state === "failed") problems.push("node server_state failed");

  let tokens: TokensView = { state: "none" };
  if (!deleted && balances?.state === "ok") tokens = { state: "ok", ...tokensOf(balances.value) };
  else if (!deleted && balances?.state === "failed") {
    tokens = { state: "failed" };
    problems.push("balances failed");
  }

  const nodeProblem = problems.some((problem) => problem.startsWith("node ") || problem.startsWith("the node "));
  return {
    header: {
      status: deleted ? "deleted" : "active",
      activation: created.state === "ok" ? activationOf(created.value) : null,
      live,
      balance,
      tokens,
      owned,
      nodeProblem,
    },
    problems,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The lists

const timeOf = (iso: string): number => {
  const seconds = Date.parse(iso) / 1000;
  return Number.isFinite(seconds) ? seconds : 0;
};

const isZero = (value: string) => !/[1-9]/.test(value);

/** An amount of a row: the API's digits as they are. */
export interface RowAmount {
  value: string;
  currency: string;
  issuer?: string;
}

const amountOf = (value: string, currency: string, issuer?: string): RowAmount => (issuer === undefined ? { value, currency } : { value, currency, issuer });

/** What a transaction did to the account's balance: the change that says the most, and how many others there were. */
export interface ChangeView {
  value: string;
  currency: string;
  more: number;
}

export interface TxRow {
  hash: string;
  ledgerIndex: number;
  /** Unix seconds. */
  time: number;
  type: string;
  /** What happened, from the account's side. */
  what: Segment[];
  change: ChangeView | null;
  ok: boolean;
  code: string;
}

const lowerFirst = (word: string) => (/^[A-Z][a-z]/.test(word) ? `${word.charAt(0).toLowerCase()}${word.slice(1)}` : word);

/** The row's sentence: the account's own transactions leave their sender out (it is the page's subject); another account's name it. */
function sentenceFor(description: Parameters<typeof rowSentence>[0], sender: string, subject: string): Segment[] {
  const row = rowSentence(description);
  if (sender === subject) return row;
  const [first, ...rest] = row;
  if (first?.t === "text") return [{ t: "account", v: sender }, { t: "text", v: ` ${lowerFirst(first.v)}` }, ...rest];
  return [{ t: "account", v: sender }, { t: "text", v: " " }, ...(first ? [first] : []), ...rest];
}

/** Of the changes the transaction made to the account's balances, the one to show (see `ChangeView`). */
function changeOf(tx: TxObject, address: string, native: Native): ChangeView | null {
  const mine = balanceChanges(tx.tx, tx.meta, native).filter((change) => change.account === address && !isZero(change.value));
  const isNative = (change: { currency: string; issuer?: string }) => change.issuer === undefined && change.currency === native;
  const fee = new BigNumber(dropsToNative(tx.tx.Fee)).negated();
  // The sender's native change includes the fee. When that is all of it, the change that is not the fee is the one that matters.
  const feeOnly = (change: { value: string; currency: string; issuer?: string }) => tx.tx.Account === address && isNative(change) && new BigNumber(change.value).isEqualTo(fee);
  const meaningful = mine.filter((change) => !feeOnly(change));
  const pool = meaningful.length > 0 ? meaningful : mine;
  const ordered = [...pool.filter(isNative), ...pool.filter((change) => !isNative(change))];
  const first = ordered[0];
  return first ? { value: first.value, currency: first.currency, more: ordered.length - 1 } : null;
}

export function transactionRows(rows: readonly TxObject[], address: string, native: Native): TxRow[] {
  return rows.map((row) => {
    const description = describe(row.tx, row.meta, { native });
    return {
      hash: row.hash,
      ledgerIndex: row.ledger_index,
      time: timeOf(row.date),
      type: row.tx.TransactionType,
      what: sentenceFor(description, row.tx.Account, address),
      change: changeOf(row, address, native),
      ok: description.ok,
      code: description.result.code,
    };
  });
}

export interface PaymentRow {
  hash: string;
  time: number;
  direction: "sent" | "received";
  counterparty: string;
  /** What the destination got, signed from the account's side. */
  amount: RowAmount;
  tag: number | null;
}

export function paymentRows(rows: readonly Payment[], address: string): PaymentRow[] {
  return rows.map((row) => {
    const sent = row.source === address;
    const delivered = row.delivered_amount ?? row.amount;
    return {
      hash: row.tx_hash,
      time: timeOf(row.executed_time),
      direction: sent ? "sent" : "received",
      counterparty: sent ? row.destination : row.source,
      amount: amountOf(sent && !isZero(delivered) && !delivered.startsWith("-") ? `-${delivered}` : delivered, row.currency, row.issuer),
      tag: row.destination_tag ?? null,
    };
  });
}

export interface TradeRow {
  hash: string;
  time: number;
  side: "buy" | "sell";
  pair: { base: { currency: string; issuer?: string }; counter: { currency: string; issuer?: string } };
  /** What was traded, in the base currency. */
  amount: RowAmount;
  /** The rate, in the counter currency per unit of base: the API's 8 significant digits. */
  price: RowAmount;
  counterparty: string;
}

export function tradeRows(rows: readonly AccountExchange[], address: string): TradeRow[] {
  return rows.map((row) => {
    const bought = row.buyer === address;
    const base = row.base_issuer === undefined ? { currency: row.base_currency } : { currency: row.base_currency, issuer: row.base_issuer };
    const counter = row.counter_issuer === undefined ? { currency: row.counter_currency } : { currency: row.counter_currency, issuer: row.counter_issuer };
    return {
      hash: row.tx_hash,
      time: timeOf(row.executed_time),
      side: bought ? "buy" : "sell",
      pair: { base, counter },
      amount: amountOf(row.base_amount, row.base_currency, row.base_issuer),
      price: amountOf(row.rate, row.counter_currency, row.counter_issuer),
      counterparty: bought ? row.seller : row.buyer,
    };
  });
}

export interface OfferRow {
  side: "buy" | "sell";
  quantity: RowAmount;
  total: RowAmount;
  /** What the offer asks per unit of the quantity: total over quantity, 8 significant digits; `null` for a quantity of nothing. */
  rate: { value: string; quote: string; per: string } | null;
  sequence: number;
}

/** Division with room for the tiny and the huge, and plain decimal notation however small or large the result. */
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 80, EXPONENTIAL_AT: [-1e9, 1e9] });

function rateOf(total: string, quantity: string): string | null {
  const divisor = new Decimal(quantity);
  const dividend = new Decimal(total);
  if (!divisor.isFinite() || !dividend.isFinite() || divisor.isZero()) return null;
  return dividend.dividedBy(divisor).precision(8).toFixed();
}

export function offerRows(orders: OrdersResponse): OfferRow[] {
  return orders.orders.map((order) => {
    const { quantity, totalPrice, direction } = order.specification;
    const rate = rateOf(totalPrice.value, quantity.value);
    return {
      side: direction,
      quantity: amountOf(quantity.value, quantity.currency, quantity.counterparty),
      total: amountOf(totalPrice.value, totalPrice.currency, totalPrice.counterparty),
      rate: rate === null ? null : { value: rate, quote: totalPrice.currency, per: quantity.currency },
      sequence: order.properties.sequence,
    };
  });
}

export interface ObjectField {
  label: string;
  value: Segment[];
}

export interface ObjectRow {
  key: string;
  /** The ledger entry type: `Escrow`, `Check`, ... */
  type: string;
  fields: ObjectField[];
  /** The transaction that last changed it. */
  tx: string | null;
}

const text = (v: string): Segment => ({ t: "text", v });

/** A field that holds an amount: drops of the native currency, or an issued amount; anything else (an MPT) is none. */
function amountField(value: unknown, native: Native): Segment | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return { t: "amount", value: dropsToNative(value), currency: native };
  if (typeof value === "object" && value !== null) {
    const { currency, issuer, value: amount } = value as Record<string, unknown>;
    if (typeof currency === "string" && typeof issuer === "string" && typeof amount === "string") return { t: "amount", value: amount, currency, issuer };
  }
  return null;
}

const accountField = (value: unknown): Segment | null => (typeof value === "string" && value !== "" ? { t: "account", v: value } : null);

/** A time field of a ledger entry: Ripple-epoch seconds. */
function timeField(value: unknown): Segment | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? text(formatUtc(value + RIPPLE_EPOCH_OFFSET)) : null;
}

const countField = (value: unknown): Segment | null => (Array.isArray(value) ? text(String(value.length)) : null);
const numberField = (value: unknown): Segment | null => (typeof value === "number" && Number.isFinite(value) ? text(String(value)) : null);

/** The fields to show of each type of object, in order; a field the entry does not have, or in a shape unknown here, is left out. */
const OBJECT_FIELDS: Record<string, (entry: LedgerObject, native: Native) => ReadonlyArray<readonly [string, Segment | null]>> = {
  Escrow: (e, native) => [
    ["Amount", amountField(e.Amount, native)],
    ["To", accountField(e.Destination)],
    ["Can finish after", timeField(e.FinishAfter)],
    ["Can cancel after", timeField(e.CancelAfter)],
  ],
  Check: (e, native) => [
    ["Send up to", amountField(e.SendMax, native)],
    ["To", accountField(e.Destination)],
    ["Expires", timeField(e.Expiration)],
  ],
  PayChannel: (e, native) => [
    ["Amount", amountField(e.Amount, native)],
    ["Claimed so far", amountField(e.Balance, native)],
    ["To", accountField(e.Destination)],
    ["Expires", timeField(e.Expiration)],
  ],
  NFTokenPage: (e) => [["NFTs", countField(e.NFTokens)]],
  Ticket: (e) => [["Ticket sequence", numberField(e.TicketSequence)]],
  SignerList: (e) => [
    ["Quorum", numberField(e.SignerQuorum)],
    ["Signers", countField(e.SignerEntries)],
  ],
  DepositPreauth: (e) => [["Authorized", accountField(e.Authorize)]],
};

/**
 * The objects an account owns, as rows for the Objects tab. Trust lines and offers have a place of their own (Tokens, the Offers
 * tab), so they are counted and left out.
 */
export function objectRows(objects: readonly LedgerObject[], native: Native): { rows: ObjectRow[]; trustLines: number; offers: number } {
  let trustLines = 0;
  let offers = 0;
  const rows: ObjectRow[] = [];
  objects.forEach((entry, index) => {
    if (entry.LedgerEntryType === "RippleState") {
      trustLines += 1;
      return;
    }
    if (entry.LedgerEntryType === "Offer") {
      offers += 1;
      return;
    }
    const fields = Object.hasOwn(OBJECT_FIELDS, entry.LedgerEntryType) ? OBJECT_FIELDS[entry.LedgerEntryType]!(entry, native) : [];
    const last = entry.PreviousTxnID;
    rows.push({
      key: typeof entry.index === "string" ? entry.index : String(index),
      type: entry.LedgerEntryType,
      fields: fields.flatMap(([label, value]) => (value === null ? [] : [{ label, value: [value] }])),
      tx: typeof last === "string" && /^[0-9A-Fa-f]{64}$/.test(last) ? last : null,
    });
  });
  return { rows, trustLines, offers };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The tab list and the page

/** What the active tab shows. `failed` is the section that could not be loaded: "Couldn't load {what}" and Retry. */
export type TabList =
  | { state: "failed"; what: string }
  | { state: "ok"; tab: "transactions"; rows: TxRow[]; paging: Paging }
  | { state: "ok"; tab: "payments"; rows: PaymentRow[]; paging: Paging; csvHref: string }
  | { state: "ok"; tab: "trades"; rows: TradeRow[]; paging: Paging }
  | { state: "ok"; tab: "offers"; rows: OfferRow[]; ledgerIndex: number | null; truncated: boolean }
  | { state: "ok"; tab: "objects"; rows: ObjectRow[]; trustLines: number; offers: number; truncated: boolean; ledgerIndex: number | null };

/** What each tab is called in "Couldn't load transactions"; the analytics view's whole-view error is "Couldn't load the analytics." */
export const TAB_WHAT: Record<AccountTab, string> = {
  transactions: "transactions",
  payments: "payments",
  trades: "trades",
  offers: "offers",
  objects: "objects",
  analytics: "the analytics",
};

export interface ListContext {
  net: NetworkId;
  native: Native;
  address: string;
  marker?: string;
  back: readonly string[];
}

export function transactionsList(page: Page<"transactions", TxObject>, ctx: ListContext): TabList {
  return {
    state: "ok",
    tab: "transactions",
    rows: transactionRows(page.transactions, ctx.address, ctx.native),
    paging: pagingOf(ctx.net, ctx.address, { tab: "transactions", marker: ctx.marker, back: ctx.back, next: page.marker }),
  };
}

export function paymentsList(page: Page<"payments", Payment>, ctx: ListContext): TabList {
  return {
    state: "ok",
    tab: "payments",
    rows: paymentRows(page.payments, ctx.address),
    paging: pagingOf(ctx.net, ctx.address, { tab: "payments", marker: ctx.marker, back: ctx.back, next: page.marker }),
    csvHref: `/${ctx.net}/account/${ctx.address}/payments.csv`,
  };
}

export function tradesList(page: Page<"exchanges", AccountExchange>, ctx: ListContext): TabList {
  return {
    state: "ok",
    tab: "trades",
    rows: tradeRows(page.exchanges, ctx.address),
    paging: pagingOf(ctx.net, ctx.address, { tab: "trades", marker: ctx.marker, back: ctx.back, next: page.marker }),
  };
}

/** The API's default page of orders, which `api.orders` does not change: a list that fills it may go on. */
const ORDERS_DEFAULT_LIMIT = 200;

/**
 * The Offers tab. The API gives one page of at most `limit` offers (200 when the request names none, and the answer says), with no
 * total and no marker, so a list that fills it is cut and the page says "Showing the first N", as it does for tokens.
 */
export function offersList(orders: OrdersResponse): TabList {
  return {
    state: "ok",
    tab: "offers",
    rows: offerRows(orders),
    ledgerIndex: orders.ledger_index ?? null,
    truncated: orders.orders.length >= (orders.limit ?? ORDERS_DEFAULT_LIMIT),
  };
}

/** The Objects tab; `null` for an account that has none to read (it was deleted). */
export function objectsList(objects: AccountObjects | null, native: Native): TabList {
  if (objects === null) return { state: "ok", tab: "objects", rows: [], trustLines: 0, offers: 0, truncated: false, ledgerIndex: null };
  return { state: "ok", tab: "objects", ...objectRows(objects.account_objects, native), truncated: objects.marker !== undefined, ledgerIndex: objects.ledger_index };
}

export function failedList(tab: ListTab): TabList {
  return { state: "failed", what: TAB_WHAT[tab] };
}

/**
 * The header of a page of old history (reached with a marker): that page is stored for good, so it carries nothing that changes (no
 * live state) and nothing that the index may not have (no activation: the creation record is slow-class data, and an account created
 * before the index's first ledger has none).
 */
export interface HistoryHeader {
  status: "history";
}

/**
 * The finished QR code, for the page to draw: `path` is the `d` of a `<path>` in module units (see `qrPath`). `content` is what it
 * holds: the classic address, or, when the page was opened with a destination tag, the X-address that is the address with that tag
 * (`tag`), so that a wallet that scans it fills in both.
 */
export interface QrPicture {
  size: number;
  path: string;
  content: string;
  tag: number | null;
}

/** What every account page is drawn from, whatever its tab. */
interface AccountPageBase {
  kind: "account";
  address: string;
  /** The network's native currency, for the page's title and description. */
  native: Native;
  /** The destination tag of the X-address the visitor came from, if the URL had a valid one. */
  tag: number | null;
  qr: QrPicture;
  /**
   * Whether the Analytics tab is a link (`ACCOUNT_ANALYTICS` is on) or the "soon" label: read from the switch by the loader and carried in
   * the page data, so that the stored HTML, the server's tab bar and the browser's agree.
   */
  analyticsTab: boolean;
}

/**
 * A page of a tab that shows a list. `mode` is `live` for the first page of a list (the header is read from the node and the index) and
 * `history` for a page reached with a marker. On the first page `list` is a promise that settles after the header has been sent (it never
 * rejects: a failure is a `TabList` of state `failed`); on a page with a marker it is there already.
 */
export interface AccountListPageData extends AccountPageBase {
  tab: ListTab;
  mode: "live" | "history";
  header: AccountHeader | HistoryHeader;
  list: TabList | Promise<TabList>;
}

/** The Analytics tab (spec 1.5): always live mode, its header that of the first page, and the view's parts as promises that never reject. */
export interface AccountAnalyticsPageData extends AccountPageBase {
  tab: "analytics";
  mode: "live";
  header: AccountHeader;
  analytics: AnalyticsData;
}

/** What the account page is drawn from: a list tab's page or the analytics view. */
export type AccountPageData = AccountListPageData | AccountAnalyticsPageData;

/** The page for an address nothing ever funded (a 404 of class `short`). */
export interface NeverActivatedData {
  kind: "never-activated";
  address: string;
  /** The other network, which may know the address. */
  other: { id: NetworkId; name: string };
}
