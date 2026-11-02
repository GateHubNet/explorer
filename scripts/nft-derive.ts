// The NFTs and URITokens of the recorded NFT ledgers as the data API serves them: each NFT's events (spec D3 §2), its state folded from them, and its open offers, worked out from
// the transactions' metadata. E8's NFT fixtures (scripts/nft-fixtures.ts) are made of them; test/fixtures/PROVENANCE.md ("NFT answers") names the commit.
//
// The rules are the data API's D3, ported (data-api-new `feat/explorer-data-2` at PIN `da5ce14ccfe9e429aacaf5ab6672eac15ce0d1de`, read with `git show`, never imported):
//
//   packages/shared/src/parsers/nft.parser.ts      `NftParser.parse`: the events of one transaction, as amended by D3's controller rulings. An XRPL transaction's events come
//                                                  from who has each NFT before and after (the transaction's `NFTokenPage` nodes, compared as a union of ids: pages split
//                                                  and merge) and from the `NFTokenOffer` nodes it created and deleted; Xahau's from its `URIToken` nodes. A failed (`tec`)
//                                                  transaction gives only its deleted `NFTokenOffer` nodes, as `offer_removed` by `other`. The before ids of a modified or
//                                                  deleted page are `PreviousFields.NFTokens` when it has them, else `FinalFields.NFTokens`. `removed_by` is named by the
//                                                  removing transaction; an MPT amount skips its event and counts it; an `Amount` that was added to a
//                                                  URIToken is told by the transaction type alone (an offer is created only by `URITokenCreateSellOffer`, and a free
//                                                  `URITokenMint` offers at the transaction's `Amount`, which its entry leaves out).
//   packages/shared/src/aggregate/nft-state.ts     `foldNftEvents`: the owner, the burn, the URI, the sales and the creation of an NFT from its events, oldest first.
//   apps/api/src/nft/nft-objects.ts                the objects as served (`toNftObject`, `toNftEventObject`, `toNftOfferObject`): key orders, an absent string left out.
//   apps/api/src/nft/nfts.service.ts               the open offers: the newest event of each `offer_id` among the offer events, kept when it is an `offer_create`, newest first;
//                                                  the converted price of a sale (`nft-prices.ts`): a price in the native currency is itself, one in an issued currency has the
//                                                  asset's rate of the day, which the recordings do not give.
//
// Where this differs from the data API: a sale in an issued currency has no `converted_amount` (the data API converts it at the asset's rate of the day, which the recordings do
// not give; a sale in the native currency is its own price); the fold's list of every owner an NFT had and the roles an event gives an account (`rolesOf`, the account history's)
// are not ported, since no fixture reads them. The recorded NFT ledgers are newer than the explorer's other recordings (2026-10-24 and 25, where those end on 2026-10-17), so the
// events keep their recorded times; the transactions are not served (PROVENANCE.md, "NFT answers").

import BigNumber from "bignumber.js";
import { encodeAccountID } from "ripple-address-codec";

import { decodeNftId } from "../app/domain/nft-id";
import type { Nft, NftEvent, NftEventKind, NftKind, NftOffer } from "../app/server/api-types";
import type { NetworkName } from "../test/support/upstream-core";
import { inLedgerOrder, isoTime, unixOf, type RawLedger, type RawTx } from "./http-fixtures";

/** What an NFT is made of: its id, its events oldest first (as `/history` gives them, ascending), its state as `/v2/nfts/{id}` gives it, and its open offers, newest first. */
export interface DerivedNft {
  id: string;
  net: NetworkName;
  events: NftEvent[];
  nft: Nft;
  offers: NftOffer[];
}

// ---- The parser (nft.parser.ts) ------------------------------------------------------------------------------------------

/** What deleted an offer (`offer_removed`): an accepted offer, a burn of its NFT, a transfer of it, or anything else (an `AccountDelete`, a transaction that failed). */
export type OfferRemovedBy = "sale" | "burn" | "transfer" | "other";

/**
 * One event of an NFT or URIToken, without the columns its transaction gives. An absent string is `''` and an absent number `null`; amounts are exact decimal text in whole
 * units, the native currency `XRP` or `XAH` with an `amount_issuer` of `''` (`ParsedNftEvent` of the parser).
 */
export interface ParsedNftEvent {
  nft_id: string;
  event_index: number;
  kind: NftKind;
  event: NftEventKind;
  issuer: string;
  taxon: number | null;
  taxon_key: number;
  serial: number;
  nft_flags: number;
  transfer_fee: number;
  uri: string;
  digest: string;
  account: string;
  from_account: string;
  to_account: string;
  offer_id: string;
  is_sell_offer: 0 | 1;
  amount: string;
  currency: string;
  amount_issuer: string;
  destination: string;
  /** Unix seconds. */
  expiration: number | null;
  broker: string;
  broker_fee: string;
  royalty_est: string;
  removed_by: OfferRemovedBy | "";
}

export interface ParsedNft {
  events: ParsedNftEvent[];
  /** Events dropped because their amount is an MPT (or is not an amount at all). */
  skipped: number;
}

type Json = Readonly<Record<string, any>>;

const RIPPLE_EPOCH_S = 946_684_800;
/** `lsfSellNFToken`: the offer sells the NFT (a buy offer has no flags at all). */
const LSF_SELL_NFTOKEN = 1;
/** `TransferFee` is in 1/100000. */
const FEE_SCALE = 5;

/** The order of the events that change who has an NFT or what it says: by kind, then by id. */
const OWNERSHIP_RANK: Readonly<Partial<Record<NftEventKind, number>>> = { mint: 0, sale: 1, transfer: 2, burn: 3, modify: 4 };

/** An amount as the event columns hold it. */
export interface Priced {
  amount: string;
  currency: string;
  amount_issuer: string;
}

/** The native currency of each network: the code of an amount of drops. */
const NATIVE: Record<NetworkName, string> = { xrpl: "XRP", xahau: "XAH" };

/** Whole units from drops. */
const dropsToNative = (drops: string): string => new BigNumber(drops).dividedBy(1_000_000).toString(10);

/**
 * An XRPL amount as exact text in whole units: drops of the native currency, or an issued currency's value. Undefined for an MPT amount (`mpt_issuance_id`) and for anything that
 * is not an amount.
 */
function readAmount(raw: unknown, native: string): Priced | undefined {
  if (typeof raw === "string") return /^[0-9]+$/.test(raw) ? { amount: dropsToNative(raw), currency: native, amount_issuer: "" } : undefined;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { currency, issuer, value } = raw as Record<string, unknown>;
  if (typeof currency !== "string" || typeof issuer !== "string" || typeof value !== "string") return undefined;
  const parsed = new BigNumber(value);
  return parsed.isNaN() ? undefined : { amount: parsed.toFixed(), currency, amount_issuer: issuer };
}

/** The owner of an `NFTokenPage`: the classic address of the first 20 bytes of the page's key. */
const pageOwner = (pageIndex: string): string => encodeAccountID(Uint8Array.from(Buffer.from(pageIndex.slice(0, 40), "hex")));

/** One entry of `AffectedNodes` that carries fields, with its position in the metadata (`ledgerNodes` of the AMM parser). */
interface LedgerNode {
  index: number;
  op: "CreatedNode" | "ModifiedNode" | "DeletedNode";
  type: string;
  fields: Json;
  previous: Json;
}

function ledgerNodes(meta: Json): LedgerNode[] {
  const nodes: LedgerNode[] = [];
  const entries: readonly Json[] = meta.AffectedNodes ?? [];
  entries.forEach((entry, index) => {
    const op = (["CreatedNode", "ModifiedNode", "DeletedNode"] as const).find((o) => entry?.[o]);
    if (!op) return;
    const body: Json = entry[op];
    const fields: Json | undefined = op === "CreatedNode" ? body.NewFields : body.FinalFields;
    if (!fields) return;
    nodes.push({ index, op, type: body.LedgerEntryType, fields, previous: body.PreviousFields ?? {} });
  });
  return nodes;
}

/** An NFT on a page of its owner. */
interface Holding {
  owner: string;
  uri: string;
}

/** The entries of an `NFTokens` array: id (upper-case) and `URI` (`''` when absent). */
function tokensOf(list: unknown): Array<{ id: string; uri: string }> {
  if (!Array.isArray(list)) return [];
  const tokens: Array<{ id: string; uri: string }> = [];
  for (const entry of list) {
    const token = entry?.NFToken;
    if (typeof token?.NFTokenID !== "string") continue;
    tokens.push({ id: token.NFTokenID.toUpperCase(), uri: typeof token.URI === "string" ? token.URI : "" });
  }
  return tokens;
}

/** The `LedgerIndex` of a node: `ledgerNodes` keeps the entry's fields but not its key. */
const ledgerIndexOf = (meta: Json, node: LedgerNode): string => meta.AffectedNodes[node.index][node.op].LedgerIndex;

/**
 * Who has each NFT (and with what `URI`) before the transaction and after it, from the transaction's `NFTokenPage` nodes and the page keys. The ids of all pages are compared,
 * never page by page. A modified or deleted page held its previous array before (`PreviousFields.NFTokens` when it has one, else what it holds: the neighbour of a split changes
 * only a link); a deleted page holds nothing afterwards; a created one held nothing before.
 */
function holdingsOf(meta: Json, nodes: readonly LedgerNode[]): { before: Map<string, Holding>; after: Map<string, Holding> } {
  const before = new Map<string, Holding>();
  const after = new Map<string, Holding>();
  for (const node of nodes) {
    if (node.type !== "NFTokenPage") continue;
    const owner = pageOwner(ledgerIndexOf(meta, node));
    if (node.op !== "DeletedNode") for (const { id, uri } of tokensOf(node.fields.NFTokens)) after.set(id, { owner, uri });
    if (node.op === "CreatedNode") continue;
    for (const { id, uri } of tokensOf(node.previous.NFTokens ?? node.fields.NFTokens)) before.set(id, { owner, uri });
  }
  return { before, after };
}

/** An `NFTokenOffer` node: its key, the NFT it is for and its side. */
interface OfferNode {
  node: LedgerNode;
  id: string;
  nftId: string;
  isSell: boolean;
}

/** The `NFTokenOffer` nodes of the transaction, in the order of `AffectedNodes`. */
function offerNodesOf(meta: Json, nodes: readonly LedgerNode[]): OfferNode[] {
  const offers: OfferNode[] = [];
  for (const node of nodes) {
    if (node.type !== "NFTokenOffer" || typeof node.fields.NFTokenID !== "string") continue;
    offers.push({ node, id: ledgerIndexOf(meta, node), nftId: node.fields.NFTokenID.toUpperCase(), isSell: ((node.fields.Flags ?? 0) & LSF_SELL_NFTOKEN) === LSF_SELL_NFTOKEN });
  }
  return offers;
}

/** A blank event of an NFT or a URIToken: every column at its absent value. */
export function bareEvent(nftId: string, event: NftEventKind): ParsedNftEvent {
  return {
    nft_id: nftId, event_index: 0, kind: "nftoken", event, issuer: "", taxon: null, taxon_key: 0, serial: 0, nft_flags: 0, transfer_fee: 0, uri: "", digest: "", account: "",
    from_account: "", to_account: "", offer_id: "", is_sell_offer: 0, amount: "", currency: "", amount_issuer: "", destination: "", expiration: null, broker: "", broker_fee: "",
    royalty_est: "", removed_by: "",
  };
}

/** A blank event of an NFT, with the columns its id decodes to. */
function blankEvent(nftId: string, event: NftEventKind): ParsedNftEvent {
  const decoded = decodeNftId(nftId);
  return { ...bareEvent(nftId, event), issuer: decoded.issuer, taxon: decoded.taxon, taxon_key: decoded.taxon, serial: decoded.serial, nft_flags: decoded.flags, transfer_fee: decoded.transferFee };
}

const byNftId = (a: ParsedNftEvent, b: ParsedNftEvent): number => (a.nft_id < b.nft_id ? -1 : a.nft_id > b.nft_id ? 1 : 0);

/** The ledger entries the parser reads: XRPL's NFTokens and their offers, Xahau's URITokens. */
const NFT_ENTRY_TYPES: ReadonlySet<string> = new Set(["NFTokenPage", "NFTokenOffer", "URIToken"]);

/** True when some node of the transaction is an `NFTokenPage`, an `NFTokenOffer` or a `URIToken`. */
function touchesNfts(meta: Json): boolean {
  const entries: readonly Json[] = meta.AffectedNodes ?? [];
  return entries.some((entry) => NFT_ENTRY_TYPES.has((entry?.CreatedNode ?? entry?.ModifiedNode ?? entry?.DeletedNode)?.LedgerEntryType));
}

/** The event of an XRPL `NFTokenOffer` node, or undefined when its amount is an MPT (the caller counts it as skipped): `account` is the offer's owner. */
function xrplOfferEvent(offer: OfferNode, event: NftEventKind, removedBy: OfferRemovedBy | "", native: string): ParsedNftEvent | undefined {
  const fields = offer.node.fields;
  // The ledger leaves a native zero out of a created node: an absent `Amount` is zero.
  const priced = readAmount(fields.Amount ?? "0", native);
  if (!priced) return undefined;
  return {
    ...blankEvent(offer.nftId, event),
    account: typeof fields.Owner === "string" ? fields.Owner : "",
    offer_id: offer.id,
    is_sell_offer: offer.isSell ? 1 : 0,
    ...priced,
    destination: typeof fields.Destination === "string" ? fields.Destination : "",
    expiration: typeof fields.Expiration === "number" ? fields.Expiration + RIPPLE_EPOCH_S : null,
    removed_by: removedBy,
  };
}

/**
 * The events of a transaction that failed (a `tec` result): one `offer_removed` (`other`) for each `NFTokenOffer` its metadata deletes, in the order of the nodes, and nothing else
 * (rippled deletes the expired offers a failed `NFTokenAcceptOffer` met, `tecEXPIRED`).
 */
function offersRemovedInFailure(meta: Json, nodes: readonly LedgerNode[], native: string): ParsedNft {
  const events: ParsedNftEvent[] = [];
  let skipped = 0;
  for (const offer of offerNodesOf(meta, nodes)) {
    if (offer.node.op !== "DeletedNode") continue;
    const e = xrplOfferEvent(offer, "offer_removed", "other", native);
    if (e) events.push({ ...e, event_index: events.length });
    else skipped++;
  }
  return { events, skipped };
}

/** What a transaction's deleted offers are: cancelled (an event of its own), or removed by an accept, a burn or another. */
function removalOf(type: unknown): OfferRemovedBy | "cancel" {
  switch (type) {
    case "NFTokenCancelOffer":
      return "cancel";
    case "NFTokenAcceptOffer":
      return "sale";
    case "NFTokenBurn":
      return "burn";
    default:
      return "other";
  }
}

/**
 * The issuer's cut of a sale (rippled `acceptOffer`): the transfer fee of the price less the broker's cut, rounded down to whole drops for the native currency and to 16
 * significant digits for an issued one. `''` when the NFT has no fee, or the issuer is the seller or the buyer.
 */
export function royaltyOf(sale: ParsedNftEvent, price: Priced, brokerFee: BigNumber): string {
  if (sale.transfer_fee === 0 || sale.issuer === sale.from_account || sale.issuer === sale.to_account) return "";
  const cut = new BigNumber(price.amount).minus(brokerFee).multipliedBy(sale.transfer_fee).shiftedBy(-FEE_SCALE);
  const rounded = price.amount_issuer === "" ? cut.decimalPlaces(6, BigNumber.ROUND_DOWN) : cut.precision(16, BigNumber.ROUND_DOWN);
  return rounded.toFixed();
}

/**
 * An NFT that went from one owner to another: a `sale` when an accepted offer with a non-zero amount moved it, else a `transfer`; `'skipped'` when that amount is an MPT. The
 * price is the accepted offer's `Amount`, in a brokered sale (both offers) the buy offer's, and the offer the event names is the accepted one, in a brokered sale the sell offer.
 */
function settle(moved: ParsedNftEvent, sell: OfferNode | undefined, buy: OfferNode | undefined, tx: Json, native: string): ParsedNftEvent | "skipped" {
  const listed = sell ?? buy;
  if (!listed) return moved;
  const withOffer: ParsedNftEvent = { ...moved, offer_id: listed.id, is_sell_offer: listed.isSell ? 1 : 0 };
  const brokered = sell !== undefined && buy !== undefined;
  const price = readAmount((brokered ? buy : listed).node.fields.Amount ?? "0", native);
  if (!price) return "skipped";
  if (new BigNumber(price.amount).isZero()) return withOffer;

  const sale: ParsedNftEvent = { ...withOffer, event: "sale", ...price };
  let brokerFee = new BigNumber(0);
  if (brokered) {
    sale.broker = moved.account;
    if (tx.NFTokenBrokerFee !== undefined) {
      const fee = readAmount(tx.NFTokenBrokerFee, native);
      if (!fee) return "skipped";
      sale.broker_fee = fee.amount;
      brokerFee = new BigNumber(fee.amount);
    }
  }
  sale.royalty_est = royaltyOf(sale, price, brokerFee);
  return sale;
}

/** A string field of a ledger entry, `''` when absent. */
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The events of a transaction's `URIToken` nodes, by the lists `parseNftTransaction` orders. */
interface UriTokenEvents {
  /** Offers cancelled or removed, in the order of the nodes. */
  removals: ParsedNftEvent[];
  /** Mints, sales, transfers and burns. */
  ownership: ParsedNftEvent[];
  /** Offers created, in the order of the nodes. */
  creations: ParsedNftEvent[];
  skipped: number;
}

/**
 * The events of the `URIToken` nodes of a transaction, from each node's diff and the transaction type:
 * - created: a `mint` for the entry's `Owner`, and an `offer_create` when it has an `Amount` (or its `URITokenMint` names one that the entry lacks: a native zero is not stored);
 * - deleted: an `offer_removed` (`burn`) when it had an `Amount` (kept in its `FinalFields`), and a `burn` of its `Owner`;
 * - `Owner` changed: in a `URITokenBuy`, the offer's `offer_removed` (`sale`) and a `sale` at the transaction's `Amount`; otherwise (a `Remit`) a `transfer`, with an
 *   `offer_removed` (`transfer`) when its `Amount` was cleared with it;
 * - same owner: the `Amount` cleared is an `offer_cancel`, and an `Amount` that changed an `offer_create`; an `Amount` that was added is not in `PreviousFields`, so it is an
 *   `offer_create` only in a `URITokenCreateSellOffer` (a `SetRemarks` of a token with an offer shows the same node).
 * The entry's key is the id, and the offer's: a URIToken has one sell offer, in its own `Amount` and `Destination`, which the ledger drops from the entry when the offer ends, so a
 * cleared offer is read from `PreviousFields`. An MPT amount skips the event and counts it.
 */
function uriTokenEvents(meta: Json, nodes: readonly LedgerNode[], tx: Json, sender: string, native: string): UriTokenEvents {
  const out: UriTokenEvents = { removals: [], ownership: [], creations: [], skipped: 0 };
  const isMint = tx.TransactionType === "URITokenMint";
  const isBuy = tx.TransactionType === "URITokenBuy";
  const setsOffer = tx.TransactionType === "URITokenCreateSellOffer";

  for (const node of nodes) {
    if (node.type !== "URIToken") continue;
    const id = ledgerIndexOf(meta, node).toUpperCase();
    const { fields, previous } = node;
    const owner = text(fields.Owner);

    const tokenEvent = (event: NftEventKind): ParsedNftEvent => ({
      ...bareEvent(id, event),
      kind: "uritoken",
      issuer: text(fields.Issuer),
      nft_flags: typeof fields.Flags === "number" ? fields.Flags : 0,
      digest: text(fields.Digest),
    });
    /** The offer event of its sell offer (`offered` holds the offer's `Amount` and `Destination`): `account` is the offer's owner. */
    const offerEvent = (event: NftEventKind, account: string, offered: Json, removedBy: OfferRemovedBy | ""): ParsedNftEvent | undefined => {
      const priced = readAmount(offered.Amount, native);
      if (!priced) {
        out.skipped++;
        return undefined;
      }
      return { ...tokenEvent(event), account, offer_id: id, is_sell_offer: 1, ...priced, destination: text(offered.Destination), removed_by: removedBy };
    };
    const add = (list: ParsedNftEvent[], e: ParsedNftEvent | undefined): void => {
      if (e) list.push(e);
    };
    // The offer the entry held before the transaction: what it still has, else what the transaction cleared.
    const standing: Json = { Amount: previous.Amount ?? fields.Amount, Destination: previous.Destination ?? fields.Destination };

    if (node.op === "CreatedNode") {
      out.ownership.push({ ...tokenEvent("mint"), account: sender, to_account: owner, uri: text(fields.URI) });
      // A native zero is left out of a created entry: a mint whose transaction names an Amount that its entry lacks is offered at the transaction's.
      const offered: Json = fields.Amount === undefined && isMint && tx.Amount !== undefined ? { ...fields, Amount: tx.Amount } : fields;
      if (offered.Amount !== undefined) add(out.creations, offerEvent("offer_create", owner, offered, ""));
    } else if (node.op === "DeletedNode") {
      if (fields.Amount !== undefined) add(out.removals, offerEvent("offer_removed", owner, standing, "burn"));
      out.ownership.push({ ...tokenEvent("burn"), account: sender, from_account: owner });
    } else if (typeof previous.Owner === "string" && previous.Owner !== owner) {
      // The token changed hands: the offer it had (if its `Amount` was cleared) is the previous owner's.
      if (previous.Amount !== undefined && fields.Amount === undefined) add(out.removals, offerEvent("offer_removed", previous.Owner, standing, isBuy ? "sale" : "transfer"));
      const moved: ParsedNftEvent = { ...tokenEvent(isBuy ? "sale" : "transfer"), account: sender, from_account: previous.Owner, to_account: owner };
      if (!isBuy) {
        out.ownership.push(moved);
      } else {
        // The price is the transaction's Amount, paid to the seller; the sale is of the token's sell offer.
        const price = readAmount(tx.Amount, native);
        if (price) out.ownership.push({ ...moved, offer_id: id, is_sell_offer: 1, ...price });
        else out.skipped++;
      }
    } else if (fields.Amount === undefined) {
      if (previous.Amount !== undefined) add(out.removals, offerEvent("offer_cancel", owner, standing, ""));
    } else if (previous.Amount !== undefined || setsOffer) {
      add(out.creations, offerEvent("offer_create", owner, fields, ""));
    }
  }
  return out;
}

/**
 * The NFT events of a transaction of `net`: XRPL's, from who has each NFT before and after (the `NFTokenPage` nodes of the transaction, over the union of them) and the
 * `NFTokenOffer` nodes it created and deleted, and Xahau's URIToken events, from its `URIToken` nodes. No transaction has both. Pure, and never writes to its input. The events
 * come in this order (`event_index`): the offers cancelled or removed, then the mints, sales, transfers, burns and modifies, then the offers created.
 */
export function parseNftTransaction(net: NetworkName, tx: RawTx): ParsedNft {
  const native = NATIVE[net];
  const meta: Json = tx.metaData;
  if (!touchesNfts(meta)) return { events: [], skipped: 0 };
  const nodes = ledgerNodes(meta);
  if (meta.TransactionResult !== "tesSUCCESS") return offersRemovedInFailure(meta, nodes, native);
  const sender = typeof tx.Account === "string" ? (tx.Account === "" ? "rrrrrrrrrrrrrrrrrrrrrhoLvTp" : tx.Account) : "";
  // A transaction has XRPL NFT nodes or URIToken nodes, never both: the lists below start with the URIToken events.
  const uriTokens = uriTokenEvents(meta, nodes, tx, sender, native);
  let skipped = uriTokens.skipped;

  const { before, after } = holdingsOf(meta, nodes);
  const offers = offerNodesOf(meta, nodes);
  // The offers an NFTokenAcceptOffer consumed: the deleted offers its two offer fields name.
  const acceptedOffer = (field: string): OfferNode | undefined => {
    const id = tx[field];
    return typeof id === "string" ? offers.find((o) => o.node.op === "DeletedNode" && o.id === id) : undefined;
  };
  const sellOffer = acceptedOffer("NFTokenSellOffer");
  const buyOffer = acceptedOffer("NFTokenBuyOffer");

  /** The offer event of an offer node, or undefined (and one more skipped) when its amount is an MPT. */
  const offerEvent = (offer: OfferNode, event: NftEventKind, removedBy: OfferRemovedBy | ""): ParsedNftEvent | undefined => {
    const e = xrplOfferEvent(offer, event, removedBy, native);
    if (!e) skipped++;
    return e;
  };

  const removals: ParsedNftEvent[] = uriTokens.removals;
  const creations: ParsedNftEvent[] = uriTokens.creations;
  const removal = removalOf(tx.TransactionType);
  for (const offer of offers) {
    let e: ParsedNftEvent | undefined;
    if (offer.node.op === "CreatedNode") {
      e = offerEvent(offer, "offer_create", "");
      if (e) creations.push(e);
    } else if (offer.node.op === "DeletedNode") {
      e = removal === "cancel" ? offerEvent(offer, "offer_cancel", "") : offerEvent(offer, "offer_removed", removal);
      if (e) removals.push(e);
    }
  }

  // The events of the NFTs themselves.
  const ownership: ParsedNftEvent[] = uriTokens.ownership;
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(id);
    const now = after.get(id);
    if (now && !was) {
      ownership.push({ ...blankEvent(id, "mint"), account: sender, to_account: now.owner, uri: now.uri });
    } else if (was && !now) {
      ownership.push({ ...blankEvent(id, "burn"), account: sender, from_account: was.owner });
    } else if (was && now && was.owner !== now.owner) {
      const transfer: ParsedNftEvent = { ...blankEvent(id, "transfer"), account: sender, from_account: was.owner, to_account: now.owner };
      const settled = settle(transfer, sellOffer, buyOffer, tx, native);
      if (settled === "skipped") skipped++;
      else ownership.push(settled);
    } else if (was && now && was.uri !== now.uri) {
      ownership.push({ ...blankEvent(id, "modify"), account: sender, uri: now.uri });
    }
  }
  ownership.sort((a, b) => (OWNERSHIP_RANK[a.event] ?? 0) - (OWNERSHIP_RANK[b.event] ?? 0) || byNftId(a, b));

  const events = [...removals, ...ownership, ...creations];
  events.forEach((e, i) => (e.event_index = i));
  return { events, skipped };
}

// ---- The stored events -------------------------------------------------------------------------------------------------------

/** A row of `nft_events`: the parser's event with the columns its transaction gives. `close_time` is unix seconds. */
export interface StoredNftEvent extends ParsedNftEvent {
  ledger_index: number;
  tx_index: number;
  tx_hash: string;
  tx_type: string;
  close_time: number;
}

/** The order the events are read in: `(ledger_index, tx_index, event_index)`. */
export const byPosition = (a: StoredNftEvent, b: StoredNftEvent): number => a.ledger_index - b.ledger_index || a.tx_index - b.tx_index || a.event_index - b.event_index;

/** Every NFT event of the ledgers of `net`, by NFT id, each NFT's events oldest first, and how many events were skipped (an MPT amount). */
export function storedEventsOf(net: NetworkName, ledgers: readonly RawLedger[]): { byId: Map<string, StoredNftEvent[]>; skipped: number } {
  const byId = new Map<string, StoredNftEvent[]>();
  let skipped = 0;
  for (const raw of ledgers) {
    const ledgerIndex = Number(raw.ledger.ledger_index);
    const closeTime = unixOf(raw.ledger.close_time);
    for (const tx of inLedgerOrder(raw)) {
      const parsed = parseNftTransaction(net, tx);
      skipped += parsed.skipped;
      for (const event of parsed.events) {
        const row: StoredNftEvent = { ...event, ledger_index: ledgerIndex, tx_index: tx.metaData.TransactionIndex, tx_hash: tx.hash, tx_type: tx.TransactionType, close_time: closeTime };
        const rows = byId.get(row.nft_id);
        if (rows) rows.push(row);
        else byId.set(row.nft_id, [row]);
      }
    }
  }
  for (const rows of byId.values()) rows.sort(byPosition);
  return { byId, skipped };
}

// ---- The fold (nft-state.ts) --------------------------------------------------------------------------------------------

/** The place of a fact in the ledger history: the transaction's ledger, hash and close time (unix seconds). */
interface Point {
  ledger_index: number;
  tx_hash: string;
  close_time: number;
}

/** The state of an NFT after its events (`NftFold`, less the owners it ever had, which nothing here reads). */
export interface NftFold {
  nft_id: string;
  kind: NftKind;
  issuer: string;
  taxon: number | null;
  serial: number;
  nft_flags: number;
  transfer_fee: number;
  owner: string;
  owner_since?: Point;
  uri: string;
  digest: string;
  minted?: Point & { by: string; to: string };
  burned: boolean;
  burned_at?: Point & { by: string };
  sale_count: number;
  last_sale?: Point & { amount: string; currency: string; amount_issuer: string };
}

const pointOf = (e: StoredNftEvent): Point => ({ ledger_index: e.ledger_index, tx_hash: e.tx_hash, close_time: e.close_time });

/**
 * The state of an NFT from its events, oldest first: the owner is the `to_account` of the newest mint, sale or transfer and a burn clears it; `burned` holds while the newest of
 * those events is a burn; `uri` is the newest mint's or modify's, `digest` the newest one an event names; `last_sale` is the newest sale and `sale_count` all of them. The offers
 * count for nothing here. Throws for no event.
 */
export function foldNftEvents(events: readonly StoredNftEvent[]): NftFold {
  if (events.length === 0) throw new RangeError("An NFT with no events has no state to fold");
  const newest = events[events.length - 1]!;
  let owner = "";
  let owner_since: Point | undefined;
  let uri = "";
  let digest = "";
  let minted: NftFold["minted"];
  let burned_at: NftFold["burned_at"];
  let sale_count = 0;
  let last_sale: NftFold["last_sale"];

  for (const e of events) {
    if (e.digest !== "") digest = e.digest;
    switch (e.event) {
      case "mint":
        owner = e.to_account;
        owner_since = owner === "" ? undefined : pointOf(e);
        burned_at = undefined;
        uri = e.uri;
        minted = { ...pointOf(e), by: e.account, to: e.to_account };
        break;
      case "sale":
      case "transfer":
        owner = e.to_account;
        owner_since = owner === "" ? undefined : pointOf(e);
        burned_at = undefined;
        if (e.event === "sale") {
          sale_count++;
          last_sale = { ...pointOf(e), amount: e.amount, currency: e.currency, amount_issuer: e.amount_issuer };
        }
        break;
      case "burn":
        owner = "";
        owner_since = undefined;
        burned_at = { ...pointOf(e), by: e.account };
        break;
      case "modify":
        uri = e.uri;
        break;
      default:
        // an offer: it moves nothing
        break;
    }
  }
  return {
    nft_id: newest.nft_id,
    kind: newest.kind,
    issuer: newest.issuer,
    taxon: newest.taxon,
    serial: newest.serial,
    nft_flags: newest.nft_flags,
    transfer_fee: newest.transfer_fee,
    owner,
    ...(owner_since && { owner_since }),
    uri,
    digest,
    ...(minted && { minted }),
    burned: burned_at !== undefined,
    ...(burned_at && { burned_at }),
    sale_count,
    ...(last_sale && { last_sale }),
  };
}

// ---- The objects (nft-objects.ts) ---------------------------------------------------------------------------------------

/** `{ [key]: value }` where the text is not empty, else nothing: an absent string is `''`. */
const present = <K extends string>(key: K, value: string): { [P in K]?: string } => (value !== "" ? { [key]: value } : {}) as { [P in K]?: string };

/** The `taxon` and `serial` of the id: XRPL only (Xahau's id encodes neither). */
const identity = (row: { kind: NftKind; taxon: number | null; serial: number }): { taxon?: number; serial?: number } => ({
  ...(row.kind === "nftoken" && row.taxon !== null && { taxon: row.taxon }),
  ...(row.kind === "nftoken" && { serial: row.serial }),
});

const pointObject = (p: Point): { ledger_index: number; tx_hash: string; executed_time: string } => ({ ledger_index: p.ledger_index, tx_hash: p.tx_hash, executed_time: isoTime(p.close_time) });

/**
 * The price of a sale in the native currency (nft-prices.ts): the amount itself for a price in the native currency; none for one in an issued currency, whose daily rate the
 * recordings do not give (the sale then counts in the sales and in no volume).
 */
export const convertedOf = (price: { amount: string; amount_issuer: string }): string | undefined => (price.amount_issuer === "" ? new BigNumber(price.amount).toFixed() : undefined);

/** An NFT from its fold, with the converted price of its last sale when it has one (`toNftObject`). */
export function nftObject(f: NftFold, lastSaleConverted?: string): Nft {
  const { owner_since: since, minted, burned_at: burnedAt, last_sale: sale } = f;
  return {
    nft_id: f.nft_id,
    kind: f.kind,
    issuer: f.issuer,
    ...(f.kind === "nftoken" && f.taxon !== null && { taxon: f.taxon }),
    ...(f.kind === "nftoken" && { serial: f.serial }),
    flags: f.nft_flags,
    ...(f.kind === "nftoken" && { transfer_fee: f.transfer_fee }),
    ...present("owner", f.owner),
    ...(since && { owner_since: pointObject(since) }),
    ...present("uri", f.uri),
    ...present("digest", f.digest),
    ...(minted && { minted: { ...pointObject(minted), by: minted.by, to: minted.to } }),
    burned: f.burned,
    ...(burnedAt && { burned_at: { ...pointObject(burnedAt), by: burnedAt.by } }),
    sale_count: f.sale_count,
    ...(sale && {
      last_sale: {
        amount: sale.amount,
        currency: sale.currency,
        ...present("amount_issuer", sale.amount_issuer),
        ...(lastSaleConverted !== undefined && { converted_amount: lastSaleConverted }),
        ledger_index: sale.ledger_index,
        tx_hash: sale.tx_hash,
        executed_time: isoTime(sale.close_time),
      },
    }),
  };
}

/** An event from its row, with the converted price when it is a sale that has one (`toNftEventObject`). */
export function eventObject(r: StoredNftEvent): NftEvent {
  const converted = r.event === "sale" ? convertedOf(r) : undefined;
  return {
    nft_id: r.nft_id,
    kind: r.kind,
    issuer: r.issuer,
    ...identity(r),
    ledger_index: r.ledger_index,
    tx_index: r.tx_index,
    event_index: r.event_index,
    tx_hash: r.tx_hash,
    tx_type: r.tx_type,
    executed_time: isoTime(r.close_time),
    event: r.event,
    ...present("account", r.account),
    ...present("from", r.from_account),
    ...present("to", r.to_account),
    ...present("offer_id", r.offer_id),
    // the events that name an offer (an offer's own, and the sale or transfer that accepted it) say which side it was on
    ...(r.offer_id !== "" && { is_sell_offer: r.is_sell_offer === 1 }),
    ...present("amount", r.amount),
    ...present("currency", r.currency),
    ...present("amount_issuer", r.amount_issuer),
    ...(converted !== undefined && { converted_amount: converted }),
    ...present("destination", r.destination),
    ...(r.expiration !== null && { expiration: isoTime(r.expiration) }),
    ...present("broker", r.broker),
    ...present("broker_fee", r.broker_fee),
    ...present("royalty_est", r.royalty_est),
    ...present("removed_by", r.removed_by),
    ...present("uri", r.uri),
  };
}

/** An open offer from the `offer_create` event that made it (`toNftOfferObject`). */
export function offerObject(created: StoredNftEvent): NftOffer {
  return {
    offer_id: created.offer_id,
    is_sell_offer: created.is_sell_offer === 1,
    owner: created.account,
    amount: created.amount,
    currency: created.currency,
    ...present("amount_issuer", created.amount_issuer),
    ...present("destination", created.destination),
    ...(created.expiration !== null && { expiration: isoTime(created.expiration) }),
    created_ledger: created.ledger_index,
    created_tx_hash: created.tx_hash,
    created_time: isoTime(created.close_time),
  };
}

/**
 * The open offers of an NFT from its events, oldest first: the newest event of each `offer_id` among its offer events, kept when it is an `offer_create`, newest first. An
 * offer that has expired is open until a transaction removes it.
 */
export function openOffers(rows: readonly StoredNftEvent[]): StoredNftEvent[] {
  const newest = new Map<string, StoredNftEvent>();
  for (const row of rows) if (row.event === "offer_create" || row.event === "offer_cancel" || row.event === "offer_removed") newest.set(row.offer_id, row);
  return [...newest.values()].filter((row) => row.event === "offer_create").sort((a, b) => byPosition(b, a));
}

/** An NFT with its events, oldest first, as the data API answers for it. */
export function nftOf(net: NetworkName, id: string, rows: readonly StoredNftEvent[]): DerivedNft {
  const fold = foldNftEvents(rows);
  const sale = fold.last_sale;
  return {
    id,
    net,
    events: rows.map(eventObject),
    nft: nftObject(fold, sale === undefined ? undefined : convertedOf(sale)),
    offers: openOffers(rows).map(offerObject),
  };
}

/** Every NFT and URIToken the transactions of `ledgers` give an event of, by id: events, state and open offers. Sorted by id. */
export function deriveNfts(net: NetworkName, ledgers: readonly RawLedger[]): DerivedNft[] {
  const { byId } = storedEventsOf(net, ledgers);
  return [...byId.keys()].sort().map((id) => nftOf(net, id, byId.get(id)!));
}
