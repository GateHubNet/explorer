// The data API's answers (D3, data-api-new `feat/explorer-data-2` at PIN da5ce14) for the NFTs and URITokens of the recorded NFT ledgers (`ledgers/xrpl-nft/`, `ledgers/xahau-nft/`),
// and the nodes' answers for the NFTs the index lacks. http-fixtures.ts calls `nftFixtures` from `generate()`, so `pnpm fixtures:sync` writes the files;
// test/fixtures/PROVENANCE.md ("NFT answers") says what they are made of, and test/unit/nft-fixtures.test.ts checks them.
//
// Derived (scripts/nft-derive.ts, a port of D3's parser, fold and open offers), for every NFT or URIToken the recorded transactions give an event of (XRPL 275, Xahau 18):
//
//   nfts/<ID>.json                                        `{ result, coverage, nft }`: the NFT folded from its events
//   nfts/<ID>/history@descending=true&limit=20[&marker=<M>].json                                                the whole history, newest first, 20 to a page
//   nfts/<ID>/history@descending=true&event=mint,burn,modify,sale,transfer&limit=20[&marker=<M>].json           the page's default: without the offer events
//   nfts/<ID>/offers@limit=50.json                        the open offers, newest first (an NFT with none gets an empty list)
//   accounts/<A>/nfts@limit=20.json                       the NFTs the account holds: the active account of each network holds the synthetic holdings below, the other two of its
//                                                         three hand-written accounts nothing; a list's `last_sale` has no `converted_amount` (D3's list rule)
//
// Per-NFT files carry D3's item coverage over the recorded world, `{ from_ledger_index: <the first recorded ledger of the set>, complete: <the first indexed event is a mint> }`,
// and the lists the feature's, `{ from_ledger_index, complete: false }` (nothing before the set is indexed, and no `EnableAmendment` is).
//
// Synthetic, seeded (`mulberry32(seedOf(net, "nfts", <what>))`), around the derived NFTs and marked in PROVENANCE.md:
//
//   - the featured NFT (the one of `brokered_sale_royalty` on XRPL, `uritoken_buy_above_ask` on Xahau) has older offer events before its first recorded one, in the recorded
//     ledgers before it, so that its whole history has two pages (the recorded NFTs have at most three events each) and its `marker` page exists (Ruling 6). They end in the
//     creation of the offers its recorded sale removed, and (XRPL) leave two buy offers open: one expired, one not.
//   - the active hand-written account of each network holds NFTs the recordings do not give it (C12): XRPL three (two of the featured NFT's collection, one it issued itself),
//     Xahau two. Each has a history of its own, so that its page, history and offers exist like any NFT's.
//
// The nodes' answers (hand-made, in Clio's and xahaud's shapes) are for what the index lacks or cannot tell: `nft_info` of the NFT without an owner (XRPL) and a token of the
// recorded pages the index has no event of, and of a burned NFT; the offers of that token; `ledger_entry` of the Xahau URITokens (the one without an owner, and one the index
// lacks). Anything else the node answers `objectNotFound` / `entryNotFound` (test/support/upstream-core.ts).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import BigNumber from "bignumber.js";
import { decodeAccountID, encodeAccountID } from "ripple-address-codec";

import { decodeNftId } from "../app/domain/nft-id";
import type { Coverage, Nft, NftEvent, NftEventKind } from "../app/server/api-types";
import { encodeNftId } from "../test/support/nft-case-rules";
import { dataApiFile, nodeFile, type NetworkName } from "../test/support/upstream-core";
import { encodeMarker, fixtureText, inLedgerOrder, LEDGERS, readLedgerSet, unixOf, type RawLedger } from "./http-fixtures";
import { bareEvent, byPosition, nftOf, storedEventsOf, type DerivedNft, type ParsedNftEvent, type StoredNftEvent } from "./nft-derive";
import { mulberry32, seedOf } from "./synthetic";

/** What the pages ask for: 20 events or NFTs of a page, 50 offers. */
const PAGE = 20;
const OFFERS_LIMIT = 50;
/** The events the NFT page asks for unless it shows the offer events too (spec 4.2). */
export const OWN_EVENTS: readonly NftEventKind[] = ["mint", "burn", "modify", "sale", "transfer"];
/** The lists whose rows are one line each: events, open offers, NFTs. */
const ROW_LISTS = ["events", "offers", "nfts"] as const;

/** The recorded set of each network (not among `SETS` of http-fixtures.ts: the NFT ledgers are newer than the day the other answers are dated to). */
export const NFT_SETS: Record<NetworkName, string> = { xrpl: "xrpl-nft", xahau: "xahau-nft" };

/** The three hand-written accounts of each network: their NFT lists exist, and the active one holds the synthetic holdings. */
export const NFT_ACCOUNTS: Record<NetworkName, { active: string; deleted: string; unfunded: string }> = {
  xrpl: { active: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", deleted: "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC", unfunded: "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC" },
  xahau: { active: "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto", deleted: "rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD", unfunded: "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC" },
};

/**
 * The manifest's cases the generator builds on, by the transaction each names: the NFT of `featured` is padded and has two pages of history, and the NFT of `unowned` (indexed
 * without an owner) is the one the node is asked for its owner. The cases of the pages (test/support/nft-case-rules.ts) are found from the files by their own predicates.
 */
export const NFT_CASE_TXS: Record<NetworkName, { featured: string; unowned: string }> = {
  xrpl: { featured: "brokered_sale_royalty", unowned: "sell_offer_create" },
  xahau: { featured: "uritoken_buy_above_ask", unowned: "uritoken_sell_offer_create" },
};

const NATIVE: Record<NetworkName, string> = { xrpl: "XRP", xahau: "XAH" };
const DAY = 86_400;

// ---- Small things ------------------------------------------------------------------------------------------------------------

const HEX = "0123456789ABCDEF";
const hexOf = (next: () => number, digits: number): string => Array.from({ length: digits }, () => HEX[Math.floor(next() * 16)]!).join("");
const accountOf = (next: () => number): string => encodeAccountID(Uint8Array.from({ length: 20 }, () => Math.floor(next() * 256)));
const uriHex = (text: string): string => Buffer.from(text, "utf8").toString("hex").toUpperCase();
/** A price of whole hundredths, as exact text. */
const priceOf = (hundredths: number): string => new BigNumber(hundredths).shiftedBy(-2).toFixed();
const drawIn = (next: () => number, low: number, high: number): number => low + Math.floor(next() * (high - low + 1));

/** The first recorded ledger of a set, the newest one, and the manifest. */
interface SetFacts {
  ledgers: RawLedger[];
  from: number;
  head: RawLedger;
  cases: Record<string, { ledger: number; hash: string }>;
}

function factsOf(net: NetworkName): SetFacts {
  const set = NFT_SETS[net];
  const ledgers = readLedgerSet(set);
  const manifest = JSON.parse(readFileSync(new URL(`${set}/manifest.json`, LEDGERS), "utf8")) as { cases: SetFacts["cases"] };
  return { ledgers, from: Number(ledgers[0]!.ledger.ledger_index), head: ledgers.at(-1)!, cases: manifest.cases };
}

/** A place in the recorded ledgers: a ledger and a transaction index in it. */
interface Slot {
  ledger_index: number;
  tx_index: number;
  close_time: number;
}

/**
 * `count` distinct places in the ledgers of `ledgers` before ledger `before`, oldest first, drawn from `next`: a ledger and a transaction index of its own transactions.
 * A synthetic event goes where a transaction of that ledger was, so that its ledger is one of the recorded ones and its time the ledger's close time.
 */
function drawSlots(ledgers: readonly RawLedger[], count: number, next: () => number, before = Number.POSITIVE_INFINITY): Slot[] {
  const usable = ledgers.filter((raw) => Number(raw.ledger.ledger_index) < before);
  const room = usable.reduce((sum, raw) => sum + raw.ledger.transactions.length, 0);
  if (room < count) throw new Error(`${count} places wanted before ledger ${before}, the recorded ledgers have ${room}`);
  const slots = new Map<string, Slot>();
  while (slots.size < count) {
    const raw = usable[Math.floor(next() * usable.length)]!;
    const slot: Slot = { ledger_index: Number(raw.ledger.ledger_index), tx_index: Math.floor(next() * raw.ledger.transactions.length), close_time: unixOf(raw.ledger.close_time) };
    slots.set(`${slot.ledger_index}:${slot.tx_index}`, slot);
  }
  return [...slots.values()].sort((a, b) => a.ledger_index - b.ledger_index || a.tx_index - b.tx_index);
}

/** The columns of an event that name its NFT. */
const identityOf = (e: ParsedNftEvent) => ({ nft_id: e.nft_id, kind: e.kind, issuer: e.issuer, taxon: e.taxon, taxon_key: e.taxon_key, serial: e.serial, nft_flags: e.nft_flags, transfer_fee: e.transfer_fee, digest: e.digest });

/** The name of the transaction that makes each event of an NFT (XRPL) or a URIToken (Xahau). */
const TX_TYPES: Record<NetworkName, Partial<Record<NftEventKind, string>>> = {
  xrpl: { mint: "NFTokenMint", burn: "NFTokenBurn", modify: "NFTokenModify", offer_create: "NFTokenCreateOffer", offer_cancel: "NFTokenCancelOffer", offer_removed: "NFTokenAcceptOffer", sale: "NFTokenAcceptOffer" },
  xahau: { mint: "URITokenMint", burn: "URITokenBurn", offer_create: "URITokenCreateSellOffer", offer_cancel: "URITokenCancelSellOffer", offer_removed: "URITokenBuy", sale: "URITokenBuy" },
};

/** A stored row at `slot`: the event's columns, the transaction's hash (drawn unless the event shares its transaction with another), its type by the event. */
function rowAt(net: NetworkName, next: () => number, slot: Slot, event: ParsedNftEvent, hash: string = hexOf(next, 64)): StoredNftEvent {
  return { ...event, ledger_index: slot.ledger_index, tx_index: slot.tx_index, tx_hash: hash, tx_type: TX_TYPES[net][event.event] ?? "", close_time: slot.close_time };
}

// ---- The featured NFT's older offer events ----------------------------------------------------------------------------------------

/** An XRPL offer the padding creates, and may cancel: when it expires is worked out from the time it is made (`null`: never). */
interface PaddedOffer {
  id: string;
  owner: string;
  sell: boolean;
  amount: string;
  destination: string;
  expires: (made: number) => number | null;
}

/**
 * How many older events the featured NFT gets: with its recorded ones, more than a page, so that its history has a second page. Each takes the place of a transaction of the
 * recorded ledgers before the sale, and the Xahau ledgers before it hold 22.
 */
const PADDING: Record<NetworkName, number> = { xrpl: 24, xahau: 20 };

/**
 * The older offer events of the featured XRPL NFT (`brokered_sale_royalty`): ten offers made and cancelled (four sell offers of the seller relisting it, six buy offers of
 * bidders), two buy offers that stay open (one expired an hour after it was made, which is before the recordings end, one that lasts a year), and last the creation of the two
 * offers the recorded sale removed (the seller's sell offer and the buyer's buy offer, with their recorded amounts, destinations and expirations). 24 events, in the recorded
 * ledgers before the sale.
 */
function paddingXrpl(net: NetworkName, recorded: readonly StoredNftEvent[], facts: SetFacts, next: () => number): StoredNftEvent[] {
  const first = recorded[0]!;
  const removed = recorded.filter((e) => e.event === "offer_removed");
  const sellRemoved = removed.find((e) => e.is_sell_offer === 1);
  const buyRemoved = removed.find((e) => e.is_sell_offer === 0);
  if (sellRemoved === undefined || buyRemoved === undefined) throw new Error("the featured NFT's sale did not remove a sell and a buy offer");
  const head = unixOf(facts.head.ledger.close_time);
  const slots = drawSlots(facts.ledgers, PADDING.xrpl, next, first.ledger_index);
  const broker = sellRemoved.destination;
  const seller = sellRemoved.account;

  const offers: PaddedOffer[] = [];
  for (let i = 0; i < 10; i++) {
    const sell = i % 5 === 1 || i % 5 === 3;
    // the seller asks more than the recorded sell offer did, the bidders offer less than the recorded buy offer
    const lasts = drawIn(next, 1, 5) * DAY;
    offers.push({
      id: hexOf(next, 64),
      owner: sell ? seller : accountOf(next),
      sell,
      amount: sell ? priceOf(drawIn(next, 15_000, 19_900)) : priceOf(drawIn(next, 9_000, 14_900)),
      destination: i === 4 ? "" : broker,
      expires: (made) => (sell ? null : made + lasts),
    });
  }
  const steps: Array<{ event: "offer_create" | "offer_cancel"; offer: PaddedOffer }> = [];
  const open: PaddedOffer[] = [];
  let made = 0;
  while (made < offers.length || open.length > 0) {
    if (open.length > 0 && (made === offers.length || next() < 0.45)) {
      const [cancelled] = open.splice(Math.floor(next() * open.length), 1);
      steps.push({ event: "offer_cancel", offer: cancelled! });
    } else {
      const offer = offers[made++]!;
      open.push(offer);
      steps.push({ event: "offer_create", offer });
    }
  }
  const strays: PaddedOffer[] = [(made: number) => made + 3600, () => head + 400 * DAY].map((expires) => ({
    id: hexOf(next, 64),
    owner: accountOf(next),
    sell: false,
    amount: priceOf(drawIn(next, 8_000, 12_000)),
    destination: broker,
    expires,
  }));
  for (const stray of strays) steps.splice(Math.floor(next() * (steps.length + 1)), 0, { event: "offer_create", offer: stray });
  const asRecorded = (e: StoredNftEvent): PaddedOffer => ({ id: e.offer_id, owner: e.account, sell: e.is_sell_offer === 1, amount: e.amount, destination: e.destination, expires: () => e.expiration });
  steps.push({ event: "offer_create", offer: asRecorded(sellRemoved) }, { event: "offer_create", offer: asRecorded(buyRemoved) });
  if (steps.length !== PADDING.xrpl) throw new Error(`${steps.length} older events, not ${PADDING.xrpl}`);

  // An offer's cancel carries the expiration its creation had, as the deleted node does.
  const expiration = new Map<string, number | null>();
  return steps.map(({ event, offer }, at) => {
    const slot = slots[at]!;
    if (event === "offer_create") expiration.set(offer.id, offer.expires(slot.close_time));
    return rowAt(net, next, slot, {
      ...bareEvent(first.nft_id, event),
      ...identityOf(first),
      account: offer.owner,
      offer_id: offer.id,
      is_sell_offer: offer.sell ? 1 : 0,
      amount: offer.amount,
      currency: NATIVE[net],
      destination: offer.destination,
      expiration: expiration.get(offer.id) ?? null,
    });
  });
}

/**
 * The older offer events of the featured URIToken (`uritoken_buy_above_ask`): its owner listing it, relisting it at another price and cancelling the offer, 20 events in the
 * recorded ledgers before the sale, and last the offer at the price the recorded sale removed. A URIToken has one sell offer (the entry's own, so every event names the token as
 * its offer), so the events follow its state: a new offer when none stands, then a relisting or a cancel.
 */
function paddingXahau(net: NetworkName, recorded: readonly StoredNftEvent[], facts: SetFacts, next: () => number): StoredNftEvent[] {
  const first = recorded[0]!;
  const removed = recorded.find((e) => e.event === "offer_removed");
  if (removed === undefined) throw new Error("the featured URIToken's sale did not remove an offer");
  const slots = drawSlots(facts.ledgers, PADDING.xahau, next, first.ledger_index);
  const events: Array<{ event: "offer_create" | "offer_cancel"; amount: string }> = [];
  let standing: string | undefined;
  for (let i = 0; i < PADDING.xahau - 1; i++) {
    if (standing !== undefined && next() < 0.45) {
      events.push({ event: "offer_cancel", amount: standing });
      standing = undefined;
    } else {
      standing = priceOf(drawIn(next, 150_000, 480_000));
      events.push({ event: "offer_create", amount: standing });
    }
  }
  events.push({ event: "offer_create", amount: removed.amount });
  return events.map(({ event, amount }, at) =>
    rowAt(net, next, slots[at]!, {
      ...bareEvent(first.nft_id, event),
      ...identityOf(first),
      account: removed.account,
      offer_id: removed.offer_id,
      is_sell_offer: 1,
      amount,
      currency: removed.currency,
      amount_issuer: removed.amount_issuer,
    }),
  );
}

// ---- The active account's holdings -------------------------------------------------------------------------------------------

/** The id of a URIToken: SHA-512Half of `0x0055`, the issuer's 20 bytes and the URI's bytes (xahaud's `keylet::uritoken`; every recorded token's id is this). */
export function uriTokenId(issuer: string, uriHexText: string): string {
  const input = Buffer.concat([Buffer.from("0055", "hex"), Buffer.from(decodeAccountID(issuer)), Buffer.from(uriHexText, "hex")]);
  return createHash("sha512").update(input).digest("hex").slice(0, 64).toUpperCase();
}

/**
 * The NFTs the active XRPL account holds (C12), each with a history of its own in the recorded ledgers: two of the featured NFT's collection (one bought from its issuer for 20 XRP
 * from a sell offer, one minted to the account) and one the account issued itself and changed the URI of. Keyed by id, rows oldest first.
 */
function holdingsXrpl(net: NetworkName, featured: StoredNftEvent, facts: SetFacts, next: () => number): Map<string, StoredNftEvent[]> {
  const holder = NFT_ACCOUNTS.xrpl.active;
  const sibling = (serial: number): string => encodeNftId({ flags: featured.nft_flags, transferFee: featured.transfer_fee, issuer: featured.issuer, taxon: featured.taxon!, serial });
  const bought = sibling(featured.serial - 7);
  const gifted = sibling(featured.serial - 3);
  const own = encodeNftId({ flags: 25, transferFee: 0, issuer: holder, taxon: 7, serial: 12 });
  const blank = (id: string, event: NftEventKind): ParsedNftEvent => {
    const d = decodeNftId(id);
    return { ...bareEvent(id, event), issuer: d.issuer, taxon: d.taxon, taxon_key: d.taxon, serial: d.serial, nft_flags: d.flags, transfer_fee: d.transferFee };
  };
  const uri = (id: string, version = 1): string => {
    const d = decodeNftId(id);
    return uriHex(`https://nft.example/${d.issuer.slice(0, 8)}/${d.serial}.json${version === 1 ? "" : `?v=${version}`}`);
  };
  const holdings = new Map<string, StoredNftEvent[]>();

  // bought: minted by the issuer, listed for 20 XRP, bought by the holder (the issuer is the seller, so no royalty); the offer's removal and the sale are one transaction
  {
    const [mint, list, buy] = drawSlots(facts.ledgers, 3, next);
    const offer = hexOf(next, 64);
    const priced = { offer_id: offer, is_sell_offer: 1 as const, amount: "20", currency: "XRP" };
    const accepted = hexOf(next, 64);
    holdings.set(bought, [
      rowAt(net, next, mint!, { ...blank(bought, "mint"), account: featured.issuer, to_account: featured.issuer, uri: uri(bought) }),
      rowAt(net, next, list!, { ...blank(bought, "offer_create"), account: featured.issuer, ...priced }),
      rowAt(net, next, buy!, { ...blank(bought, "offer_removed"), account: featured.issuer, ...priced, removed_by: "sale", event_index: 0 }, accepted),
      rowAt(net, next, buy!, { ...blank(bought, "sale"), account: holder, from_account: featured.issuer, to_account: holder, ...priced, event_index: 1 }, accepted),
    ]);
  }
  // gifted: minted by the issuer to the holder
  {
    const [mint] = drawSlots(facts.ledgers, 1, next);
    holdings.set(gifted, [rowAt(net, next, mint!, { ...blank(gifted, "mint"), account: featured.issuer, to_account: holder, uri: uri(gifted) })]);
  }
  // own: issued by the holder to itself, and its URI changed (the flags say it is mutable)
  {
    const [mint, modify] = drawSlots(facts.ledgers, 2, next);
    holdings.set(own, [
      rowAt(net, next, mint!, { ...blank(own, "mint"), account: holder, to_account: holder, uri: uri(own) }),
      rowAt(net, next, modify!, { ...blank(own, "modify"), account: holder, uri: uri(own, 2) }),
    ]);
  }
  return holdings;
}

/**
 * The URITokens the active Xahau account holds (C12): one of the featured token's issuer, bought from it for 1,500 XAH from its offer, and one the account issued itself.
 */
function holdingsXahau(net: NetworkName, featured: StoredNftEvent, facts: SetFacts, next: () => number): Map<string, StoredNftEvent[]> {
  const holder = NFT_ACCOUNTS.xahau.active;
  const holdings = new Map<string, StoredNftEvent[]>();
  /** An event of a URIToken: its issuer, flags and digest are the entry's, the same in every event of it. */
  const token = (id: string, issuer: string, flags: number, digest: string) => (event: NftEventKind): ParsedNftEvent => ({ ...bareEvent(id, event), kind: "uritoken", issuer, nft_flags: flags, digest });

  // bought: minted by its issuer, listed for 1,500 XAH, bought by the holder (the offer's removal and the sale are one transaction)
  {
    const uri = uriHex(`odinseyes:raven:v2:00${hexOf(next, 6).toLowerCase()}`);
    const id = uriTokenId(featured.issuer, uri);
    const event = token(id, featured.issuer, 0, hexOf(next, 64));
    const [mint, list, buy] = drawSlots(facts.ledgers, 3, next);
    const priced = { offer_id: id, is_sell_offer: 1 as const, amount: "1500", currency: "XAH" };
    const accepted = hexOf(next, 64);
    holdings.set(id, [
      rowAt(net, next, mint!, { ...event("mint"), account: featured.issuer, to_account: featured.issuer, uri }),
      rowAt(net, next, list!, { ...event("offer_create"), account: featured.issuer, ...priced }),
      rowAt(net, next, buy!, { ...event("offer_removed"), account: featured.issuer, ...priced, removed_by: "sale", event_index: 0 }, accepted),
      rowAt(net, next, buy!, { ...event("sale"), account: holder, from_account: featured.issuer, to_account: holder, ...priced, event_index: 1 }, accepted),
    ]);
  }
  // own: issued by the holder to itself, burnable, with no digest
  {
    const uri = uriHex(`https://nft.example/${holder.slice(0, 8)}/1.json`);
    const id = uriTokenId(holder, uri);
    const [mint] = drawSlots(facts.ledgers, 1, next);
    holdings.set(id, [rowAt(net, next, mint!, { ...token(id, holder, 1, "")("mint"), account: holder, to_account: holder, uri })]);
  }
  return holdings;
}

// ---- The NFTs of a network ---------------------------------------------------------------------------------------------------------

/** What the files of a network describe. */
export interface NftWorld {
  net: NetworkName;
  /** The first recorded ledger of the set: where the index starts. */
  from: number;
  /** Every NFT, by id: the recorded ones (the featured one with its older offer events) and the synthetic holdings. */
  nfts: DerivedNft[];
  /** The featured NFT's id, and the NFT of `unowned` (indexed without an owner, the node tells its owner). */
  featured: string;
  unowned: string;
  /** The ids the active account holds, in the order its list gives (issuer, taxon, serial, id). */
  holdings: string[];
  /** The recorded ledgers of the set (the node's answers name them). */
  ledgers: RawLedger[];
}

/** The id of the NFT that a case's transaction made an event of, with an event of `kind`. */
function idOfCase(rows: ReadonlyMap<string, StoredNftEvent[]>, facts: SetFacts, name: string, kind: NftEventKind): string {
  const hash = facts.cases[name]?.hash;
  if (hash === undefined) throw new Error(`the manifest has no case ${name}`);
  for (const [id, events] of rows) if (events.some((e) => e.tx_hash === hash && e.event === kind)) return id;
  throw new Error(`no NFT has a ${kind} in the transaction of ${name}`);
}

/** The order of an account's NFTs: by collection (issuer, then taxon), then serial (on Xahau by id). */
const byCollection = (a: Nft, b: Nft): number =>
  a.issuer < b.issuer ? -1 : a.issuer > b.issuer ? 1 : (a.taxon ?? 0) - (b.taxon ?? 0) || (a.serial ?? 0) - (b.serial ?? 0) || (a.nft_id < b.nft_id ? -1 : a.nft_id > b.nft_id ? 1 : 0);

export function nftWorld(net: NetworkName): NftWorld {
  const facts = factsOf(net);
  const { byId } = storedEventsOf(net, facts.ledgers);
  const featured = idOfCase(byId, facts, NFT_CASE_TXS[net].featured, "sale");
  const unowned = idOfCase(byId, facts, NFT_CASE_TXS[net].unowned, "offer_create");

  const recorded = byId.get(featured)!;
  const pad = net === "xrpl" ? paddingXrpl : paddingXahau;
  byId.set(featured, [...pad(net, recorded, facts, mulberry32(seedOf(net, "nfts", "padding"))), ...recorded]);

  const held = (net === "xrpl" ? holdingsXrpl : holdingsXahau)(net, recorded.find((e) => e.event === "sale")!, facts, mulberry32(seedOf(net, "nfts", "holdings")));
  for (const [id, rows] of held) {
    if (byId.has(id)) throw new Error(`${id}: a synthetic holding that the recordings have`);
    byId.set(id, rows.sort(byPosition));
  }

  const nfts = [...byId.keys()].sort().map((id) => nftOf(net, id, byId.get(id)!));
  const holdings = nfts
    .filter((each) => held.has(each.id))
    .sort((a, b) => byCollection(a.nft, b.nft))
    .map((each) => each.id);
  return { net, from: facts.from, nfts, featured, unowned, holdings, ledgers: facts.ledgers };
}

// ---- The data API's files ------------------------------------------------------------------------------------------------------

/** D3's coverage of one NFT over the recorded world: the set's first ledger, complete when the NFT's first indexed event is its mint (`itemCoverage`). */
export const itemCoverage = (from: number, nft: DerivedNft): Coverage => ({ from_ledger_index: from, complete: nft.events[0]!.event === "mint" });

/** The feature's coverage over the recorded world: nothing before the set is indexed, and no `EnableAmendment` is. */
export const featureCoverage = (from: number): Coverage => ({ from_ledger_index: from, complete: false });

/** An NFT in a list (an account's or a collection's): the detail without the converted price of its last sale (D3's list rule). */
export function listNft(nft: Nft): Nft {
  if (nft.last_sale?.converted_amount === undefined) return nft;
  const { converted_amount: _converted, ...sale } = nft.last_sale;
  return { ...nft, last_sale: sale };
}

/** The pages of a list newest first, `PAGE` rows each: the marker each is reached by (none for the first) and the rows. A page has a marker when another follows. */
function pagesOf<T>(rows: readonly T[], keyOf: (row: T) => Array<string | number>): Array<{ marker?: string; next?: string; rows: T[] }> {
  const pages: Array<{ marker?: string; next?: string; rows: T[] }> = [];
  let marker: string | undefined;
  for (let at = 0; at === 0 || at < rows.length; at += PAGE) {
    const shown = rows.slice(at, at + PAGE);
    const next = at + PAGE < rows.length ? encodeMarker(keyOf(shown.at(-1)!)) : undefined;
    pages.push({ ...(marker !== undefined && { marker }), ...(next !== undefined && { next }), rows: shown });
    marker = next;
  }
  return pages;
}

/** The files of one NFT: its detail, its history with and without the offer events, and its open offers. */
function nftFiles(from: number, each: DerivedNft, put: (path: string, query: string, value: unknown) => void): void {
  const coverage = itemCoverage(from, each);
  put(`/v2/nfts/${each.id}`, "", { result: "success", coverage, nft: each.nft });
  const newest = [...each.events].reverse();
  const history = (events: readonly NftEvent[], filter: string | undefined): void => {
    for (const { marker, next, rows } of pagesOf(events, (e) => [e.ledger_index, e.tx_index, e.event_index])) {
      const query = [`descending=true`, ...(filter !== undefined ? [`event=${filter}`] : []), `limit=${PAGE}`, ...(marker !== undefined ? [`marker=${marker}`] : [])].join("&");
      put(`/v2/nfts/${each.id}/history`, query, { result: "success", coverage, count: rows.length, ...(next !== undefined && { marker: next }), events: rows });
    }
  };
  history(newest, undefined);
  history(newest.filter((e) => OWN_EVENTS.includes(e.event)), OWN_EVENTS.join(","));
  if (each.offers.length > OFFERS_LIMIT) throw new Error(`${each.id}: ${each.offers.length} open offers need marker pages`);
  put(`/v2/nfts/${each.id}/offers`, `limit=${OFFERS_LIMIT}`, { result: "success", coverage, count: each.offers.length, offers: each.offers });
}

/** An account's NFTs: `PAGE` to a page, ordered by collection. */
function accountFiles(world: NftWorld, account: string, put: (path: string, query: string, value: unknown) => void): void {
  const held = world.nfts.filter((each) => each.nft.owner === account && !each.nft.burned).sort((a, b) => byCollection(a.nft, b.nft));
  for (const { marker, next, rows } of pagesOf(held, (each) => [each.nft.issuer, each.nft.taxon ?? 0, each.nft.serial ?? 0, each.id])) {
    const query = [`limit=${PAGE}`, ...(marker !== undefined ? [`marker=${marker}`] : [])].join("&");
    put(`/v2/accounts/${account}/nfts`, query, { result: "success", coverage: featureCoverage(world.from), count: rows.length, ...(next !== undefined && { marker: next }), nfts: rows.map((each) => listNft(each.nft)) });
  }
}

// ---- The nodes' files ----------------------------------------------------------------------------------------------------------

/** A token of the recorded `NFTokenPage` nodes that no event of the index names: the pages hold every token on them, and a transaction touches few. */
interface PageToken {
  id: string;
  owner: string;
  uri: string;
  ledger: number;
}

function untouchedTokens(ledgers: readonly RawLedger[], indexed: ReadonlySet<string>): PageToken[] {
  const found = new Map<string, PageToken>();
  for (const raw of ledgers) {
    for (const tx of inLedgerOrder(raw)) {
      for (const wrapper of (tx.metaData.AffectedNodes ?? []) as Array<Record<string, any>>) {
        const body = wrapper[Object.keys(wrapper)[0]!];
        if (body.LedgerEntryType !== "NFTokenPage") continue;
        const owner = encodeAccountID(Uint8Array.from(Buffer.from((body.LedgerIndex as string).slice(0, 40), "hex")));
        for (const list of [body.NewFields?.NFTokens, body.FinalFields?.NFTokens, body.PreviousFields?.NFTokens] as Array<Array<{ NFToken: { NFTokenID: string; URI?: string } }> | undefined>) {
          for (const { NFToken } of list ?? []) {
            const id = NFToken.NFTokenID.toUpperCase();
            if (!indexed.has(id) && NFToken.URI !== undefined && !found.has(id)) found.set(id, { id, owner, uri: NFToken.URI, ledger: Number(raw.ledger.ledger_index) });
          }
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

type Put = (file: string | undefined, value: unknown) => void;

const nodeResult = (value: Record<string, unknown>) => ({ result: { ...value, status: "success" } });
const rippleTime = (unix: number): number => unix - 946_684_800;

/** Clio's `nft_info` for an XRPL NFT, `validated`, as it answers for an NFT it has (flags, fee, issuer, taxon and serial are the id's). */
function nftInfo(id: string, owner: string, ledger: number, burned: boolean, uri: string | undefined) {
  const d = decodeNftId(id);
  return nodeResult({
    nft_id: id,
    ledger_index: ledger,
    owner,
    is_burned: burned,
    flags: d.flags,
    transfer_fee: d.transferFee,
    issuer: d.issuer,
    nft_taxon: d.taxon,
    nft_serial: d.serial,
    ...(uri !== undefined && { uri }),
    validated: true,
  });
}

/** xahaud's `ledger_entry` of a URIToken by its id, `validated`, with the sell offer it holds (`Amount` in drops). */
function uriTokenEntry(id: string, ledger: RawLedger, token: { owner: string; issuer: string; uri: string; digest: string; flags: number; created: number; offer?: { amount: string; destination: string } }) {
  const entry: Record<string, unknown> = {
    ...(token.offer !== undefined && { Amount: new BigNumber(token.offer.amount).shiftedBy(6).toFixed(), ...(token.offer.destination !== "" && { Destination: token.offer.destination }) }),
    ...(token.digest !== "" && { Digest: token.digest }),
    Flags: token.flags,
    Issuer: token.issuer,
    LedgerEntryType: "URIToken",
    Owner: token.owner,
    OwnerNode: "0",
    PreviousTxnLgrSeq: token.created,
    URI: token.uri,
    index: id,
  };
  return nodeResult({ index: id, ledger_hash: ledger.ledger_hash, ledger_index: Number(ledger.ledger.ledger_index), node: entry, validated: true });
}

/**
 * The node's files of a network (hand-made, in the nodes' shapes):
 * - XRPL `nft_info` of the NFT without an owner (the owner of its newest open sell offer: only the owner can sell it), of the first token of the recorded pages that no event of
 *   the index names (its owner the page's, its URI the page's) with a sell and a buy offer for it, and of a burned NFT the index has never seen;
 * - Xahau `ledger_entry` of the URIToken without an owner (the owner of its offer) and of a hand-made token the index lacks.
 */
function nodeFiles(net: NetworkName, world: NftWorld, put: Put): void {
  const next = mulberry32(seedOf(net, "nfts", "node"));
  const head = world.ledgers.at(-1)!;
  const indexed = new Set(world.nfts.map((each) => each.id));
  const unowned = world.nfts.find((each) => each.id === world.unowned)!;
  const sellOffer = unowned.offers.find((offer) => offer.is_sell_offer);
  if (sellOffer === undefined) throw new Error("the NFT without an owner has no sell offer to name its owner");
  const link = (method: string, id: string, extra: Record<string, unknown> = {}) => nodeFile(net, method, { [method === "ledger_entry" ? "index" : "nft_id"]: id, ledger_index: "validated", ...extra });

  if (net === "xrpl") {
    // The NFT without an owner: it last changed before the index began.
    put(link("nft_info", unowned.id), nftInfo(unowned.id, sellOffer.owner, world.from - drawIn(next, 1_000, 90_000), false, uriHex(`https://nft.example/${unowned.nft.issuer.slice(0, 8)}/${unowned.nft.serial}.json`)));

    // A token of the recorded pages the index has no event of, with one offer to sell it and one to buy it.
    const token = untouchedTokens(world.ledgers, indexed)[0];
    if (token === undefined) throw new Error("every token of the recorded pages has an event");
    put(link("nft_info", token.id), nftInfo(token.id, token.owner, token.ledger, false, token.uri));
    const offers = (side: "sell" | "buy") => {
      const sell = side === "sell";
      const offer = {
        nft_offer_index: hexOf(next, 64),
        flags: sell ? 1 : 0,
        owner: sell ? token.owner : accountOf(next),
        amount: sell ? new BigNumber(drawIn(next, 10, 90)).shiftedBy(6).toFixed() : { currency: "USD", issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq", value: priceOf(drawIn(next, 500, 5_000)) },
        ...(sell && { destination: accountOf(next) }),
        ...(!sell && { expiration: rippleTime(unixOf(head.ledger.close_time) + 5 * DAY) }),
      };
      return nodeResult({ nft_id: token.id, validated: true, offers: [offer] });
    };
    put(link("nft_sell_offers", token.id, { limit: OFFERS_LIMIT }), offers("sell"));
    put(link("nft_buy_offers", token.id, { limit: OFFERS_LIMIT }), offers("buy"));

    // A burned NFT: Clio keeps its issuer, taxon and serial from the id, and names the owner it had; a burned NFT has no URI.
    const burned = encodeNftId({ flags: 9, transferFee: 5000, issuer: "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu", taxon: 500, serial: drawIn(next, 106_290_000, 106_293_000) });
    if (indexed.has(burned)) throw new Error("the burned NFT of the node is one of the index's");
    put(link("nft_info", burned), nftInfo(burned, "rKqqb5QZXVAL3VqXJL6obfRGeHou1DtyBV", world.from - drawIn(next, 1_000, 90_000), true, undefined));
    return;
  }

  // The URIToken without an owner: the entry's owner is the offer's; its URI is not in the index (its mint is before the recordings).
  put(
    link("ledger_entry", unowned.id),
    uriTokenEntry(unowned.id, head, {
      owner: sellOffer.owner,
      issuer: unowned.nft.issuer,
      uri: uriHex(`odinseyes:raven:v2:00${hexOf(next, 6).toLowerCase()}`),
      digest: unowned.nft.digest ?? "",
      flags: unowned.nft.flags,
      created: sellOffer.created_ledger,
      offer: { amount: sellOffer.amount, destination: sellOffer.destination ?? "" },
    }),
  );
  // A token the index lacks: the featured token's issuer's, owned by an account of the recordings, with no offer.
  const uri = uriHex(`odinseyes:raven:v2:00${hexOf(next, 6).toLowerCase()}`);
  const id = uriTokenId(world.nfts.find((each) => each.id === world.featured)!.nft.issuer, uri);
  if (indexed.has(id)) throw new Error("the URIToken of the node is one of the index's");
  put(
    link("ledger_entry", id),
    uriTokenEntry(id, head, { owner: "rAucmWmE8yiueemhmrGh5MyD2mNjXfpQp", issuer: world.nfts.find((each) => each.id === world.featured)!.nft.issuer, uri, digest: hexOf(next, 64), flags: 0, created: world.from }),
  );
}

// ---- All of them ---------------------------------------------------------------------------------------------------------------

/** An answer before serialization (`fixtureText` sorts its keys, so the tests check the reference's key orders on this): the file's path below test/fixtures/http/ and its body. */
export interface NftAnswer {
  path: string;
  value: unknown;
}

/** Every NFT answer, before serialization. */
export function nftAnswers(): NftAnswer[] {
  const answers: NftAnswer[] = [];
  const seen = new Set<string>();
  const write = (path: string | undefined, value: unknown): void => {
    if (path === undefined) throw new Error("no file for an NFT fixture");
    if (seen.has(path)) throw new Error(`${path} is written twice`);
    seen.add(path);
    answers.push({ path, value });
  };

  for (const net of ["xrpl", "xahau"] as const) {
    const world = nftWorld(net);
    const put = (path: string, query: string, value: unknown): void => write(dataApiFile(net, path, query), value);
    for (const each of world.nfts) nftFiles(world.from, each, put);
    const accounts = NFT_ACCOUNTS[net];
    for (const account of [accounts.active, accounts.deleted, accounts.unfunded]) accountFiles(world, account, put);
    nodeFiles(net, world, write);
  }
  return answers;
}

/** Every NFT file: path below test/fixtures/http/ and text. */
export function nftFixtures(): Array<[path: string, text: string]> {
  return nftAnswers().map(({ path, value }) => [path, fixtureText(value, ROW_LISTS)]);
}
