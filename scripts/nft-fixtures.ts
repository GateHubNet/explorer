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
// Per-NFT files carry D3's item coverage over the recorded world, `{ from_ledger_index: <the first recorded ledger of the set>, complete: <the first indexed event is a mint> }`;
// every other answer carries the feature's, `FEATURE_COVERAGE` (XRPL `{ 32570, complete: true }`, Xahau `{ 26533927, complete: false }`: C5).
//
// Synthetic, seeded (`mulberry32(seedOf(net, "nfts", <what>))`), around the derived NFTs and marked in PROVENANCE.md:
//
//   - the featured NFT (the one of `brokered_sale_royalty` on XRPL, `uritoken_buy_above_ask` on Xahau) has older offer events before its first recorded one, in the recorded
//     ledgers before it, so that its whole history has two pages (the recorded NFTs have at most three events each) and its `marker` page exists (Ruling 6). They end in the
//     creation of the offers its recorded sale removed, and (XRPL) leave two buy offers open: one expired, one not.
//   - the active hand-written account of each network holds NFTs the recordings do not give it (C12): XRPL three (two of the featured NFT's collection, one it issued itself),
//     Xahau two. Each has a history of its own, so that its page, history and offers exist like any NFT's.
//   - the featured NFT's collection has four more NFTs that change hands (`"traded"`): 19 sales between them, the newest of the network's, one in an issued currency, one NFT
//     burned. They have NFT files like any other, and give the collection and the network lists of sales their second page.
//   Every synthetic event has a place of its own in a recorded ledger: past the ledger's own transactions (`drawSlots`).
//
// The aggregates (`aggregateFiles`, worked out from the NFTs above, around some synthetic collections, with the reference's own rules and key orders), below `data-api/`:
//
//   nft_collections@limit=20&sort=<volume|supply|holders>[&descending=false][&issuer=<I>][&marker=<M>].json     every collection, every sort each way, and the filters by issuer (the
//                                                         featured NFT's, which has two collections on XRPL, and an account that issued none); a marker is `[value, issuer, taxon]`
//   nft_collections/<issuer>[/<taxon>].json               the three collections that have a page of their own (the featured NFT's, one not sold, the most sold of the others), and
//     .../stats@end=<T>&start=<W₀>, .../sales@descending=true&limit=20[&marker=<M>], .../nfts@limit=20 (with `include_burned=true` for the featured one, with `owner=<A>` for all),
//     .../holders@limit=20                                its lists, one `stats` row for each day of the 30 days to T with a sale, a mint or a burn (the featured collection's has days with
//                                                         several events: `crowdedDays`)
//   nft_sales@descending=true&limit=10 | limit=20[&marker=<M>]    the sales of the network, newest first: the list page's ten, the older sales' twenty from the start and from the ten's marker
//   network/nft_volume@live=day|7day|30day, @end=<T>&interval=day&limit=1000&start=<W₀>    the rolling periods to T's close, and the days the route has computed (not the running one)
//
// The nodes' answers (hand-made, in Clio's and xahaud's shapes) are for what the index lacks or cannot tell: `nft_info` of the NFT without an owner (XRPL) and a token of the
// recorded pages the index has no event of, and of a burned NFT; the offers of that token; `ledger_entry` of the Xahau URITokens (the one without an owner, and one the index
// lacks). Anything else the node answers `objectNotFound` / `entryNotFound` (test/support/upstream-core.ts).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import BigNumber from "bignumber.js";
import { decodeAccountID, encodeAccountID } from "ripple-address-codec";

import { decodeNftId } from "../app/domain/nft-id";
import { addDays, utcDayOf, windowOf } from "../app/domain/window";
import type { Coverage, Nft, NftCollection, NftCollectionDay, NftEvent, NftEventKind, NftHolder, NftPoint, NftSale, NftVolumeRow } from "../app/server/api-types";
import { encodeNftId } from "../test/support/nft-case-rules";
import { dataApiFile, nodeFile, type NetworkName } from "../test/support/upstream-core";
import { encodeMarker, fixtureText, inLedgerOrder, isoTime, LEDGERS, readLedgers, readLedgerSet, unixOf, type RawLedger } from "./http-fixtures";
import { bareEvent, byPosition, nftOf, royaltyOf, storedEventsOf, type DerivedNft, type ParsedNftEvent, type StoredNftEvent } from "./nft-derive";
import { mulberry32, seedOf } from "./synthetic";

/** What the pages ask for: 20 events or NFTs of a page, 50 offers. */
const PAGE = 20;
const OFFERS_LIMIT = 50;
/** The events the NFT page asks for unless it shows the offer events too (spec 4.2). */
export const OWN_EVENTS: readonly NftEventKind[] = ["mint", "burn", "modify", "sale", "transfer"];
/** The lists whose rows are one line each: events, open offers, NFTs, collections, sales, holders, a collection's days, the volume's rows. */
const ROW_LISTS = ["events", "offers", "nfts", "collections", "sales", "holders", "days", "rows"] as const;

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

/** The first recorded ledger of a set, the newest one, the manifest, and the places the synthetic events have taken so far. */
interface SetFacts {
  ledgers: RawLedger[];
  from: number;
  head: RawLedger;
  cases: Record<string, { ledger: number; hash: string }>;
  /** How many places each ledger has given to a synthetic event, by ledger index: the next one is that many past the ledger's own transactions. */
  given: Map<number, number>;
}

function factsOf(net: NetworkName): SetFacts {
  const set = NFT_SETS[net];
  const ledgers = readLedgerSet(set);
  const manifest = JSON.parse(readFileSync(new URL(`${set}/manifest.json`, LEDGERS), "utf8")) as { cases: SetFacts["cases"] };
  return { ledgers, from: Number(ledgers[0]!.ledger.ledger_index), head: ledgers.at(-1)!, cases: manifest.cases, given: new Map() };
}

/** A place in the recorded ledgers: a ledger and a transaction index in it. */
interface Slot {
  ledger_index: number;
  tx_index: number;
  close_time: number;
}

/** Which of the recorded ledgers a synthetic event may take its place in: those from `since` (inclusive) up to, but not including, `before`. */
interface Between {
  since?: number;
  before?: number;
}

/**
 * `count` places for synthetic events in the recorded ledgers `between` them, oldest first, drawn from `next`. A synthetic event goes in a ledger of the set, so that its ledger is
 * one of the recorded ones and its time the ledger's close time, but at a transaction index **no recorded transaction has**: past the ledger's own transactions, in the order the places
 * are given (each ledger counts them in `facts.given`, for the whole world). So `(ledger_index, tx_index, event_index)` is a unique key over every NFT of the world, and a
 * `(ledger_index, tx_index)` is one transaction, with one hash: the sales lists join the NFTs' events on it.
 */
function drawSlots(facts: SetFacts, count: number, next: () => number, between: Between = {}): Slot[] {
  const usable = facts.ledgers.filter((raw) => Number(raw.ledger.ledger_index) >= (between.since ?? 0) && Number(raw.ledger.ledger_index) < (between.before ?? Number.POSITIVE_INFINITY));
  if (usable.length === 0) throw new Error(`no recorded ledger from ${between.since ?? "the first"} to before ${between.before ?? "the last"}`);
  const slots: Slot[] = [];
  for (let at = 0; at < count; at++) {
    const raw = usable[Math.floor(next() * usable.length)]!;
    const ledger_index = Number(raw.ledger.ledger_index);
    const given = facts.given.get(ledger_index) ?? 0;
    facts.given.set(ledger_index, given + 1);
    slots.push({ ledger_index, tx_index: raw.ledger.transactions.length + given, close_time: unixOf(raw.ledger.close_time) });
  }
  return slots.sort((a, b) => a.ledger_index - b.ledger_index || a.tx_index - b.tx_index);
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

/** How many older events the featured NFT gets: with its recorded ones, more than a page, so that its history has a second page. Each has a place of its own in a recorded ledger before the sale. */
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
  const slots = drawSlots(facts, PADDING.xrpl, next, { before: first.ledger_index });
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
  const slots = drawSlots(facts, PADDING.xahau, next, { before: first.ledger_index });
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

/** The `https://nft.example/…` URI of an XRPL NFT (a version above 1 is a changed URI). */
function nftUri(id: string, version = 1): string {
  const d = decodeNftId(id);
  return uriHex(`https://nft.example/${d.issuer.slice(0, 8)}/${d.serial}.json${version === 1 ? "" : `?v=${version}`}`);
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
  const holdings = new Map<string, StoredNftEvent[]>();

  // bought: minted by the issuer, listed for 20 XRP, bought by the holder (the issuer is the seller, so no royalty); the offer's removal and the sale are one transaction
  {
    const [mint, list, buy] = drawSlots(facts, 3, next);
    const offer = hexOf(next, 64);
    const priced = { offer_id: offer, is_sell_offer: 1 as const, amount: "20", currency: "XRP" };
    const accepted = hexOf(next, 64);
    holdings.set(bought, [
      rowAt(net, next, mint!, { ...blank(bought, "mint"), account: featured.issuer, to_account: featured.issuer, uri: nftUri(bought) }),
      rowAt(net, next, list!, { ...blank(bought, "offer_create"), account: featured.issuer, ...priced }),
      rowAt(net, next, buy!, { ...blank(bought, "offer_removed"), account: featured.issuer, ...priced, removed_by: "sale", event_index: 0 }, accepted),
      rowAt(net, next, buy!, { ...blank(bought, "sale"), account: holder, from_account: featured.issuer, to_account: holder, ...priced, event_index: 1 }, accepted),
    ]);
  }
  // gifted: minted by the issuer to the holder
  {
    const [mint] = drawSlots(facts, 1, next);
    holdings.set(gifted, [rowAt(net, next, mint!, { ...blank(gifted, "mint"), account: featured.issuer, to_account: holder, uri: nftUri(gifted) })]);
  }
  // own: issued by the holder to itself, and its URI changed (the flags say it is mutable)
  {
    const [mint, modify] = drawSlots(facts, 2, next);
    holdings.set(own, [
      rowAt(net, next, mint!, { ...blank(own, "mint"), account: holder, to_account: holder, uri: nftUri(own) }),
      rowAt(net, next, modify!, { ...blank(own, "modify"), account: holder, uri: nftUri(own, 2) }),
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
    const [mint, list, buy] = drawSlots(facts, 3, next);
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
    const [mint] = drawSlots(facts, 1, next);
    holdings.set(id, [rowAt(net, next, mint!, { ...token(id, holder, 1, "")("mint"), account: holder, to_account: holder, uri })]);
  }
  return holdings;
}

// ---- The featured collection's traded NFTs -----------------------------------------------------------------------------------

/**
 * The traded NFTs of each network (`"traded"`): NFTs of the featured NFT's collection that change hands, so that the collection has what the pages of a collection draw, a list of
 * sales with a page behind its marker, and the network's list of sales has a second page. The recordings give the collection two sales; the synthetic holdings one more. Each NFT is
 * minted by the collection's issuer, listed by its owner and bought, again and again (the number of sales, in the order of the NFTs); the last one is burned by its owner after its
 * sales (so that the collection has a burned NFT: `include_burned`). The second NFT's third sale is priced in an issued currency, which has no rate: a sale in no volume.
 */
const TRADED: Record<NetworkName, number[]> = { xrpl: [5, 5, 5, 4], xahau: [5, 5, 5, 4] };
/** The traded NFT whose third sale has an issued price, and the asset it is in (XRPlay, which the recordings' XRPL sale is in, and Evernode's EVR). */
const UNRATED_TRADED = 1;
const ISSUED: Record<NetworkName, { currency: string; issuer: string; hundredths: [low: number, high: number] }> = {
  xrpl: { currency: "5852506C61790000000000000000000000000000", issuer: "rfUefeHzBZQGEs66znmX9rV6S9viGbxv9v", hundredths: [10_000, 90_000] },
  xahau: { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8", hundredths: [50, 500] },
};
/** What a sale in the native currency costs, in hundredths: 40 to 400 XRP, 900 to 6,000 XAH. */
const TRADED_PRICE: Record<NetworkName, [low: number, high: number]> = { xrpl: [4_000, 40_000], xahau: [90_000, 600_000] };
/** The accounts that buy the traded NFTs, so that a buyer holds more than one of them. */
const BUYERS = 6;

/**
 * The traded NFTs of the featured NFT's collection, by id, rows oldest first, in the places the newest of the recorded ledgers have (`since`: the ledger of the newest sale of any
 * other collection, so that the collection's newest sales, and the network's, are these: one marker serves both lists). XRPL: siblings of the featured NFT by serial; a sale is the
 * seller's offer and the buyer's accept (one transaction, so one hash), with the royalty (the featured NFT's 3%) from the second sale on, the first seller being the issuer. Xahau:
 * URITokens of the featured token's issuer with an id of their own, burnable; a URIToken's one offer is the token's.
 */
function tradedNfts(net: NetworkName, featured: StoredNftEvent, since: number, facts: SetFacts, next: () => number): Map<string, StoredNftEvent[]> {
  const issuer = featured.issuer;
  const buyers = Array.from({ length: BUYERS }, () => accountOf(next));
  const traded = new Map<string, StoredNftEvent[]>();
  TRADED[net].forEach((sales, at) => {
    const last = at === TRADED[net].length - 1;
    // the token: an XRPL sibling of the featured NFT 11, 13, 15, … serials below it; a Xahau token, whose id is made of its URI
    const tokenUri = net === "xrpl" ? "" : uriHex(`odinseyes:raven:v2:00${hexOf(next, 6).toLowerCase()}`);
    const id = net === "xrpl" ? encodeNftId({ flags: featured.nft_flags, transferFee: featured.transfer_fee, issuer, taxon: featured.taxon!, serial: featured.serial - 11 - 2 * at }) : uriTokenId(issuer, tokenUri);
    if (traded.has(id)) throw new Error(`${id}: two traded NFTs`);
    const blank = (event: NftEventKind): ParsedNftEvent => {
      if (net === "xahau") return { ...bareEvent(id, event), kind: "uritoken", issuer, nft_flags: 1, digest: "" };
      const d = decodeNftId(id);
      return { ...bareEvent(id, event), issuer: d.issuer, taxon: d.taxon, taxon_key: d.taxon, serial: d.serial, nft_flags: d.flags, transfer_fee: d.transferFee };
    };
    const digest = net === "xahau" ? hexOf(next, 64) : "";
    const slots = drawSlots(facts, 1 + 2 * sales + (last ? 1 : 0), next, { since });
    const rows: StoredNftEvent[] = [rowAt(net, next, slots[0]!, { ...blank("mint"), digest, account: issuer, to_account: issuer, uri: net === "xrpl" ? nftUri(id) : tokenUri })];
    let owner = issuer;
    for (let sale = 0; sale < sales; sale++) {
      const [list, buy] = [slots[1 + 2 * sale]!, slots[2 + 2 * sale]!];
      const buyer = (): string => buyers[Math.floor(next() * BUYERS)]!;
      let to = buyer();
      while (to === owner) to = buyer();
      // the price: in the native currency, but the third sale of one NFT, in an issued one
      const issued = at === UNRATED_TRADED && sale === 2;
      const [low, high] = issued ? ISSUED[net].hundredths : TRADED_PRICE[net];
      const price = issued
        ? { amount: priceOf(drawIn(next, low, high)), currency: ISSUED[net].currency, amount_issuer: ISSUED[net].issuer }
        : { amount: priceOf(drawIn(next, low, high)), currency: NATIVE[net], amount_issuer: "" };
      const offered = { offer_id: net === "xrpl" ? hexOf(next, 64) : id, is_sell_offer: 1 as const, ...price };
      const accepted = hexOf(next, 64);
      const bought: ParsedNftEvent = { ...blank("sale"), digest, account: to, from_account: owner, to_account: to, ...offered, event_index: 1 };
      rows.push(
        rowAt(net, next, list, { ...blank("offer_create"), digest, account: owner, ...offered }),
        rowAt(net, next, buy, { ...blank("offer_removed"), digest, account: owner, ...offered, removed_by: "sale", event_index: 0 }, accepted),
        rowAt(net, next, buy, { ...bought, royalty_est: royaltyOf(bought, price, new BigNumber(0)) }, accepted),
      );
      owner = to;
    }
    if (last) rows.push(rowAt(net, next, slots.at(-1)!, { ...blank("burn"), digest, account: owner, from_account: owner }));
    traded.set(id, rows);
  });
  return traded;
}

// ---- The NFTs of a network ---------------------------------------------------------------------------------------------------------

/** What the files of a network describe. */
export interface NftWorld {
  net: NetworkName;
  /** The first recorded ledger of the set: where the index starts. */
  from: number;
  /** Every NFT, by id: the recorded ones (the featured one with its older offer events), the synthetic holdings and the traded NFTs of the featured collection. */
  nfts: DerivedNft[];
  /** The featured NFT's id, and the NFT of `unowned` (indexed without an owner, the node tells its owner). */
  featured: string;
  unowned: string;
  /** The ids the active account holds, in the order its list gives (issuer, taxon, serial, id). */
  holdings: string[];
  /** The ids of the featured collection's traded NFTs, by id (the last of them burned). */
  traded: string[];
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
  const sale = recorded.find((e) => e.event === "sale")!;
  const pad = net === "xrpl" ? paddingXrpl : paddingXahau;
  byId.set(featured, [...pad(net, recorded, facts, mulberry32(seedOf(net, "nfts", "padding"))), ...recorded]);

  const held = (net === "xrpl" ? holdingsXrpl : holdingsXahau)(net, sale, facts, mulberry32(seedOf(net, "nfts", "holdings")));
  for (const [id, rows] of held) {
    if (byId.has(id)) throw new Error(`${id}: a synthetic holding that the recordings have`);
    byId.set(id, rows.sort(byPosition));
  }

  // The newest sale of a collection other than the featured one is where the traded NFTs' places begin: their sales are the newest of the network.
  let since = 0;
  for (const rows of byId.values()) for (const e of rows) if (e.event === "sale" && (e.issuer !== sale.issuer || e.taxon_key !== sale.taxon_key)) since = Math.max(since, e.ledger_index);
  const traded = tradedNfts(net, sale, since, facts, mulberry32(seedOf(net, "nfts", "traded")));
  for (const [id, rows] of traded) {
    if (byId.has(id)) throw new Error(`${id}: a traded NFT that the recordings or the holdings have`);
    byId.set(id, rows.sort(byPosition));
  }

  const nfts = [...byId.keys()].sort().map((id) => nftOf(net, id, byId.get(id)!));
  const holdings = nfts
    .filter((each) => held.has(each.id))
    .sort((a, b) => byCollection(a.nft, b.nft))
    .map((each) => each.id);
  return { net, from: facts.from, nfts, featured, unowned, holdings, traded: [...traded.keys()].sort(), ledgers: facts.ledgers };
}

// ---- The data API's files ------------------------------------------------------------------------------------------------------

/** D3's coverage of one NFT over the recorded world: the set's first ledger, complete when the NFT's first indexed event is its mint (`itemCoverage`). */
export const itemCoverage = (from: number, nft: DerivedNft): Coverage => ({ from_ledger_index: from, complete: nft.events[0]!.event === "mint" });

/**
 * The feature's coverage as the fixtures give it (C5, and the ruling on Task 5's fourth concern): the one `coverage` of every answer of a network that is not about one NFT, the
 * lists and aggregates (the collections, a collection and its lists, the sales, the volume) and an account's NFTs, and the mock's empty page (`NFT_COVERAGE` in
 * test/support/upstream-core.ts). XRPL's is complete from 32,570, the network's first ledger ("a feature as old as the network" in D3's "Coverage": the index holds its history
 * whole); Xahau's starts where the recordings do and is not complete (D3 needs its ledger 1 for that), so that both states are drawn. D3 would not give XRPL's complete coverage
 * beside the incomplete per-NFT coverage over the same recorded world, which is the item rule over the set's first ledger: these two never meet in one D3.
 */
export const FEATURE_COVERAGE: Record<NetworkName, Coverage> = { xrpl: { from_ledger_index: 32570, complete: true }, xahau: { from_ledger_index: 26533927, complete: false } };
export const featureCoverage = (net: NetworkName): Coverage => FEATURE_COVERAGE[net];

/** An NFT in a list (an account's or a collection's): the detail without the converted price of its last sale (D3's list rule). */
export function listNft(nft: Nft): Nft {
  if (nft.last_sale?.converted_amount === undefined) return nft;
  const { converted_amount: _converted, ...sale } = nft.last_sale;
  return { ...nft, last_sale: sale };
}

/**
 * The pages of a list, `size` rows each (`PAGE` unless said), the first reached by `from` (none: the list's own first page): the marker each is reached by and the rows. A page has
 * a marker when another follows, the base64url JSON of its last row's key (`keyOf`).
 */
function pagesOf<T>(rows: readonly T[], keyOf: (row: T) => Array<string | number>, size = PAGE, from?: string): Array<{ marker?: string; next?: string; rows: T[] }> {
  const pages: Array<{ marker?: string; next?: string; rows: T[] }> = [];
  let marker = from;
  for (let at = 0; at === 0 || at < rows.length; at += size) {
    const shown = rows.slice(at, at + size);
    const next = at + size < rows.length ? encodeMarker(keyOf(shown.at(-1)!)) : undefined;
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
    put(`/v2/accounts/${account}/nfts`, query, { result: "success", coverage: featureCoverage(world.net), count: rows.length, ...(next !== undefined && { marker: next }), nfts: rows.map((each) => listNft(each.nft)) });
  }
}

// ---- The collections, the sales and the volume ----------------------------------------------------------------------------------

type ApiPut = (path: string, query: string, value: unknown) => void;

/** What a collection is called in a path: `issuer/taxon` on XRPL, the issuer alone on Xahau (a collection is everything one issuer minted). */
const collectionKey = (place: { issuer: string; taxon?: number }): string => (place.taxon === undefined ? place.issuer : `${place.issuer}/${place.taxon}`);

/** The order of events in D3's tables: `(ledger_index, tx_index, event_index)`. */
const byEvent = (a: NftEvent, b: NftEvent): number => a.ledger_index - b.ledger_index || a.tx_index - b.tx_index || a.event_index - b.event_index;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const pointOfEvent = (e: NftEvent): NftPoint => ({ ledger_index: e.ledger_index, tx_hash: e.tx_hash, executed_time: e.executed_time });

/** The clock of the aggregates: T, the UTC day of the newest ledger of the network's other sets (the recorded `last_validated`), and that ledger's close time in unix seconds. */
function clockOf(net: NetworkName): { today: string; head: number } {
  const head = unixOf(readLedgers(net).at(-1)!.ledger.close_time);
  return { today: utcDayOf(head), head };
}

// What the lists of collections are sorted by, and how each sort reads a collection (the volume by its number, as D3 does by its Float64 shadow).
const SORTS = ["volume", "supply", "holders"] as const;
type Sort = (typeof SORTS)[number];
const sortValue = (collection: NftCollection, sort: Sort): number => Number(sort === "volume" ? collection.volume_native : collection[sort]);

/** The collections in the order of a sort: by the value, then (whichever way it runs) by issuer and by taxon, ascending. */
function sortedCollections(collections: readonly NftCollection[], sort: Sort, ascending: boolean): NftCollection[] {
  const direction = ascending ? 1 : -1;
  return [...collections].sort((a, b) => direction * (sortValue(a, sort) - sortValue(b, sort)) || byText(a.issuer, b.issuer) || (a.taxon ?? 0) - (b.taxon ?? 0));
}

/** A collection as D3's aggregator counts it from its NFTs' events (`recomputeCollections`): supply and holders from the NFTs, the rest from the events. */
function derivedCollection(nfts: readonly DerivedNft[]): NftCollection {
  const first = nfts[0]!.nft;
  const events = nfts.flatMap((each) => each.events);
  const held = nfts.filter((each) => !each.nft.burned);
  const mints = events.filter((e) => e.event === "mint").sort(byEvent);
  const sales = events.filter((e) => e.event === "sale");
  const volume = sales.reduce((sum, e) => (e.converted_amount === undefined ? sum : sum.plus(e.converted_amount)), new BigNumber(0));
  return {
    issuer: first.issuer,
    ...(first.taxon !== undefined && { taxon: first.taxon }),
    kind: first.kind,
    supply: held.length,
    holders: new Set(held.flatMap((each) => (each.nft.owner === undefined ? [] : [each.nft.owner]))).size,
    minted: mints.length,
    burned: events.filter((e) => e.event === "burn").length,
    sales_count: sales.length,
    volume_native: volume.toFixed(),
    ...(mints.length > 0 && { first_mint: pointOfEvent(mints[0]!), last_mint: pointOfEvent(mints.at(-1)!) }),
    last_ledger: Math.max(...events.map((e) => e.ledger_index)),
  };
}

// The synthetic collections (`"collections"`): the rest of the network's, for the list's pages. Their counts are drawn from tiers of supply and of average price, so that the sorts
// have ties (the same supply or holders, a volume of 0) and a long tail. They have no NFT of the world: only the three collections of the cases have a page of their own.
const SYNTHETIC_COLLECTIONS: Record<NetworkName, number> = { xrpl: 20, xahau: 7 };
const SUPPLY_TIERS = [1, 2, 5, 10, 25, 100, 333, 1_000, 2_500, 10_000, 25_000];
/** The average price of a synthetic collection's sales, in hundredths of the native currency: 1, 5, 20, 50, 150 and 400 coins. */
const PRICE_TIERS = [100, 500, 2_000, 5_000, 15_000, 40_000];

/**
 * `SYNTHETIC_COLLECTIONS` collections that `existing` (the world's) have no key of, each a row of the list as D3 writes it: `holders` at most `supply`, `minted` the supply and the
 * burned NFTs when the mints are in the index (else none, and no first or last mint), the volume the rated sales' prices summed, and the newest ledger at or after the last mint.
 * On XRPL the first is a second collection of the featured NFT's issuer, so that a filter by issuer has two.
 */
function syntheticCollections(world: NftWorld, existing: readonly NftCollection[]): NftCollection[] {
  const { net } = world;
  const next = mulberry32(seedOf(net, "nfts", "collections"));
  const featured = world.nfts.find((each) => each.id === world.featured)!.nft;
  const taken = new Set(existing.map(collectionKey));
  const ledgerAt = (): RawLedger => world.ledgers[Math.floor(next() * world.ledgers.length)]!;
  const pointIn = (raw: RawLedger): NftPoint => ({ ledger_index: Number(raw.ledger.ledger_index), tx_hash: hexOf(next, 64), executed_time: isoTime(unixOf(raw.ledger.close_time)) });
  const made: NftCollection[] = [];
  while (made.length < SYNTHETIC_COLLECTIONS[net]) {
    const issuer = made.length === 0 && net === "xrpl" ? featured.issuer : accountOf(next);
    const place = net === "xrpl" ? { issuer, taxon: drawIn(next, 0, 9_999) } : { issuer };
    const tier = SUPPLY_TIERS[Math.floor(next() * SUPPLY_TIERS.length)]!;
    const supply = next() < 0.3 ? tier : Math.max(1, Math.floor(tier * (0.5 + next())));
    const holders = next() < 0.2 ? 1 : Math.max(1, Math.min(supply, Math.floor(supply * (0.05 + 0.9 * next()))));
    const burned = Math.floor(supply * 0.1 * next());
    // some were minted before the index began: they have a supply and no indexed mint
    const indexed = next() < 0.5;
    const sales = next() < 0.25 ? 0 : 1 + Math.floor(supply * (0.2 + 2 * next()));
    const rated = Math.floor(sales * (0.8 + 0.2 * next()));
    const hundredths = Math.floor(rated * PRICE_TIERS[Math.floor(next() * PRICE_TIERS.length)]! * (0.5 + next()));
    const [firstLedger, lastLedger] = [ledgerAt(), ledgerAt()].sort((a, b) => Number(a.ledger.ledger_index) - Number(b.ledger.ledger_index)) as [RawLedger, RawLedger];
    const [first, last] = [pointIn(firstLedger), pointIn(lastLedger)];
    const newest = ledgerAt();
    if (taken.has(collectionKey(place))) continue;
    taken.add(collectionKey(place));
    made.push({
      ...place,
      kind: net === "xrpl" ? "nftoken" : "uritoken",
      supply,
      holders,
      minted: indexed ? supply + burned : 0,
      burned,
      sales_count: sales,
      volume_native: priceOf(hundredths),
      ...(indexed && { first_mint: first, last_mint: supply + burned === 1 ? first : last }),
      last_ledger: Math.max(Number(newest.ledger.ledger_index), indexed ? last.ledger_index : 0),
    });
  }
  return made;
}

// ---- A collection's lists

/** A sale (`toNftSaleObject`) from the `sale` event of an NFT's history. */
function saleOf(e: NftEvent): NftSale {
  return {
    nft_id: e.nft_id,
    kind: e.kind,
    issuer: e.issuer,
    ...(e.taxon !== undefined && { taxon: e.taxon }),
    ...(e.serial !== undefined && { serial: e.serial }),
    ledger_index: e.ledger_index,
    tx_index: e.tx_index,
    event_index: e.event_index,
    tx_hash: e.tx_hash,
    executed_time: e.executed_time,
    seller: e.from!,
    buyer: e.to!,
    mode: e.broker === undefined ? "direct" : "brokered",
    amount: e.amount!,
    currency: e.currency!,
    ...(e.amount_issuer !== undefined && { amount_issuer: e.amount_issuer }),
    ...(e.converted_amount !== undefined && { converted_amount: e.converted_amount }),
    ...(e.broker !== undefined && { broker: e.broker }),
    ...(e.broker_fee !== undefined && { broker_fee: e.broker_fee }),
    ...(e.royalty_est !== undefined && { royalty_est: e.royalty_est }),
  };
}

/** The sales of some NFTs, newest first (the order of both lists of sales when `descending=true`). */
const salesOf = (nfts: readonly DerivedNft[]): NftSale[] => nfts.flatMap((each) => each.events.filter((e) => e.event === "sale")).sort((a, b) => byEvent(b, a)).map(saleOf);
const saleKey = (sale: NftSale): number[] => [sale.ledger_index, sale.tx_index, sale.event_index];

/** The accounts that hold NFTs of a collection and how many: the most first, then by address. */
function holdersOf(nfts: readonly DerivedNft[]): NftHolder[] {
  const held = new Map<string, number>();
  for (const each of nfts) if (!each.nft.burned && each.nft.owner !== undefined) held.set(each.nft.owner, (held.get(each.nft.owner) ?? 0) + 1);
  return [...held].map(([owner, count]) => ({ owner, held: count })).sort((a, b) => b.held - a.held || byText(a.owner, b.owner));
}

/** One day of a collection's stats (`toCollectionDayObject`): the average and the lowest price are of the sales that have a converted price, left out when none has. */
function dayRow(date: string, events: readonly NftEvent[]): NftCollectionDay {
  const sales = events.filter((e) => e.event === "sale");
  const prices = sales.flatMap((e) => (e.converted_amount === undefined ? [] : [new BigNumber(e.converted_amount)]));
  const volume = prices.reduce((sum, price) => sum.plus(price), new BigNumber(0));
  return {
    date: `${date}T00:00:00Z`,
    sales_count: sales.length,
    volume_native: volume.toFixed(),
    ...(prices.length > 0 && { avg_price_native: volume.dividedBy(prices.length).decimalPlaces(6, BigNumber.ROUND_HALF_UP).toFixed(), min_price_native: BigNumber.minimum(...prices).toFixed() }),
    mints: events.filter((e) => e.event === "mint").length,
    burns: events.filter((e) => e.event === "burn").length,
  };
}

/**
 * The days of a collection's stats: its sales, mints and burns moved into the window (the recordings are dated after T, so none of them is in it), each to a day drawn from
 * `next`, so that the days add up to the collection's own totals. A sale with no converted price (an issued currency without a rate) is alone on its day, which has a row with a
 * sale, a volume of 0 and no price. A day is a row only when it has an event; `crowded` is the featured collection's (see `crowdedDays`).
 */
function collectionDays(events: readonly NftEvent[], buckets: readonly string[], crowded: boolean, next: () => number): NftCollectionDay[] {
  if (crowded) return crowdedDays(events, buckets, next);
  const open = [...buckets];
  const dayOf = new Map<NftEvent, string>();
  const unrated = events.filter((e) => e.event === "sale" && e.converted_amount === undefined);
  const alone = new Set<string>();
  for (const e of unrated) {
    const free = open.filter((day) => !alone.has(day));
    const day = free[Math.floor(next() * free.length)]!;
    alone.add(day);
    dayOf.set(e, day);
  }
  const shared = open.filter((day) => !alone.has(day));
  // a shuffle, so that the first events (one to a shared day) are not the oldest
  const others = events.filter((e) => !dayOf.has(e));
  for (let at = others.length - 1; at > 0; at--) {
    const other = Math.floor(next() * (at + 1));
    [others[at], others[other]] = [others[other]!, others[at]!];
  }
  others.forEach((e) => {
    const among = e.event === "sale" ? shared : open;
    dayOf.set(e, among[Math.floor(next() * among.length)]!);
  });
  return daysOf(dayOf);
}

/** The rows of the days that `dayOf` puts events on, oldest day first. */
function daysOf(dayOf: ReadonlyMap<NftEvent, string>): NftCollectionDay[] {
  const byDay = new Map<string, NftEvent[]>();
  for (const [e, day] of dayOf) byDay.set(day, [...(byDay.get(day) ?? []), e]);
  return [...byDay].sort(([a], [b]) => byText(a, b)).map(([day, of]) => dayRow(day, of));
}

/**
 * The days of the featured collection's stats, which the average and the lowest price of a day need to be seen at work on (E8 Task 9): every row is a day with an event and every
 * day with an event is a row, and three days have several: one with two rated sales, one with a rated sale and an unrated one (`sales_count` 2, and an average over the one that has
 * a price), and one with two rated sales and a mint. The two rated sales of the first and of the third have different prices, so that on both days the lowest price is less than
 * the average, which neither price is (test/unit/nft-fixtures.test.ts relies on it). The other events have a day each, and the days with no row (never the first or the last, which
 * are 2026-09-18 and T) are as many as the days that the crowded ones took from the events. The sales, mints and burns still add up to the collection's totals.
 */
function crowdedDays(events: readonly NftEvent[], buckets: readonly string[], next: () => number): NftCollectionDay[] {
  const rated = events.filter((e) => e.event === "sale" && e.converted_amount !== undefined);
  const unrated = events.filter((e) => e.event === "sale" && e.converted_amount === undefined);
  const mints = events.filter((e) => e.event === "mint");
  const single = events.filter((e) => e.event !== "sale" || e.converted_amount !== undefined);
  /** One of `among` drawn from `next`, taken out of it and out of `single`. */
  const take = (among: NftEvent[], wanted: (e: NftEvent) => boolean = () => true): NftEvent => {
    const fit = among.filter(wanted);
    const e = fit[Math.floor(next() * fit.length)];
    if (e === undefined) throw new Error("the featured collection has too few events for its crowded days");
    among.splice(among.indexOf(e), 1);
    single.splice(single.indexOf(e), 1);
    return e;
  };
  const crowd: NftEvent[][] = [];
  const differing = (than: NftEvent) => (e: NftEvent) => e.converted_amount !== than.converted_amount;
  const first = take(rated);
  crowd.push([first, take(rated, differing(first))]);
  for (const e of unrated) crowd.push([take(rated), e]);
  const third = take(rated);
  crowd.push([third, take(rated, differing(third)), take(mints)]);

  const units = [...crowd, ...single.map((e) => [e])];
  const quiet = buckets.length - units.length;
  if (quiet < 0 || quiet > buckets.length - 2) throw new Error(`${units.length} days with events cannot be among ${buckets.length} days with the first and the last among them`);
  const open = [...buckets];
  for (let at = 0; at < quiet; at++) open.splice(1 + Math.floor(next() * (open.length - 2)), 1);
  // a shuffle of the days with events, so that the crowded ones are not the oldest
  for (let at = units.length - 1; at > 0; at--) {
    const other = Math.floor(next() * (at + 1));
    [units[at], units[other]] = [units[other]!, units[at]!];
  }
  return daysOf(new Map(units.flatMap((unit, at) => unit.map((e): [NftEvent, string] => [e, open[at]!]))));
}

/**
 * The files of one collection's page: itself, its stats over the 30 days to T (with `crowded` days, those of the featured collection: `crowdedDays`), its sales, its NFTs (with the burned ones when `withBurned`,
 * and the ones the active account holds) and its holders.
 */
function collectionFiles(world: NftWorld, collection: NftCollection, nfts: readonly DerivedNft[], clock: { today: string }, crowded: boolean, withBurned: boolean, put: ApiPut): void {
  const coverage = featureCoverage(world.net);
  const path = `/v2/nft_collections/${collectionKey(collection)}`;
  const window = windowOf(clock.today, "30d");
  const events = nfts.flatMap((each) => each.events).filter((e) => e.event === "sale" || e.event === "mint" || e.event === "burn");
  const days = collectionDays(events, window.buckets, crowded, mulberry32(seedOf(world.net, "nfts", "days", collectionKey(collection))));
  put(path, "", { result: "success", coverage, collection });
  put(`${path}/stats`, `end=${window.end}&start=${window.start}`, { result: "success", coverage, count: days.length, days });
  const page = (list: string, query: string[], pages: ReadonlyArray<{ marker?: string; next?: string; rows: unknown[] }>): void => {
    for (const { marker, next, rows } of pages) {
      put(`${path}/${list}`, [...query, `limit=${PAGE}`, ...(marker !== undefined ? [`marker=${marker}`] : [])].join("&"), { result: "success", coverage, count: rows.length, ...(next !== undefined && { marker: next }), [list]: rows });
    }
  };
  page("sales", ["descending=true"], pagesOf(salesOf(nfts), saleKey));
  const listed = [...nfts].sort((a, b) => byCollection(a.nft, b.nft));
  const nftKey = (each: DerivedNft): Array<string | number> => [each.nft.serial ?? 0, each.id];
  const listOf = (among: readonly DerivedNft[]) => pagesOf(among, nftKey).map((each) => ({ ...each, rows: each.rows.map((nft) => listNft(nft.nft)) }));
  page("nfts", [], listOf(listed.filter((each) => !each.nft.burned)));
  if (withBurned) page("nfts", ["include_burned=true"], listOf(listed));
  page("nfts", [`owner=${NFT_ACCOUNTS[world.net].active}`], listOf(listed.filter((each) => !each.nft.burned && each.nft.owner === NFT_ACCOUNTS[world.net].active)));
  page("holders", [], pagesOf(holdersOf(nfts), (holder) => [holder.held, holder.owner]));
}

// ---- The volume of the network

/** The collections with the sales the volume is drawn from, and how many: the most traded ones (by volume). */
const ACTIVE_COLLECTIONS: Record<NetworkName, number> = { xrpl: 6, xahau: 5 };
const DAY_SECONDS = 86_400;
/** The rate of the native currency to itself, and so of every component until a display currency is asked for. */
const UNIT_RATE = "1.0000000";

/** A sale of the volume's model: a collection's, at `time` (unix seconds), for `hundredths` of the native currency, or priced in an issued currency with no rate (`null`). */
interface Trade {
  collection: NftCollection;
  time: number;
  hundredths: number | null;
}

/**
 * The sales the network volume is made of: for each of the most traded collections of the list (by volume), a number of sales over the 31 days before `end` (32 to the first, fewer
 * the lower it ranks), at times and prices drawn around the collection's own average price; one in sixteen is priced in an issued currency, which has no rate that day. Every
 * live row and every day is a view of this one list, so the 7-day row has the day's sales and the 30-day row the 7-day's.
 */
function tradesOf(net: NetworkName, collections: readonly NftCollection[], end: number): Trade[] {
  const next = mulberry32(seedOf(net, "nfts", "volume"));
  const active = sortedCollections(collections, "volume", false).filter((each) => each.sales_count > 0).slice(0, ACTIVE_COLLECTIONS[net]);
  return active.flatMap((collection, rank) => {
    const average = (Number(collection.volume_native) * 100) / collection.sales_count;
    return Array.from({ length: Math.floor(60 / (rank + 2)) + 2 }, (): Trade => {
      const time = end - Math.floor(next() * 31 * DAY_SECONDS);
      return { collection, time, hundredths: next() < 1 / 16 ? null : Math.max(1, Math.floor(average * (0.4 + 1.2 * next()))) };
    });
  });
}

/** A row of the volume over `[start, end)`: the sales' collections as components (the rated ones), the row's count every sale, the converted amounts the same text as the amounts. */
function volumeRow(net: NetworkName, trades: readonly Trade[], start: number, end: number): NftVolumeRow {
  const parts = new Map<string, { collection: NftCollection; count: number; hundredths: number }>();
  for (const { collection, hundredths } of trades) {
    if (hundredths === null) continue;
    const part = parts.get(collectionKey(collection)) ?? { collection, count: 0, hundredths: 0 };
    part.count += 1;
    part.hundredths += hundredths;
    parts.set(collectionKey(collection), part);
  }
  const sorted = [...parts.values()].sort((a, b) => b.hundredths - a.hundredths || byText(a.collection.issuer, b.collection.issuer) || (a.collection.taxon ?? 0) - (b.collection.taxon ?? 0));
  return {
    components: sorted.map(({ collection, count, hundredths }) => ({
      issuer: collection.issuer,
      ...(collection.taxon !== undefined && { taxon: collection.taxon }),
      count,
      amount: priceOf(hundredths),
      rate: UNIT_RATE,
      converted_amount: priceOf(hundredths),
    })),
    count: trades.length,
    exchange: { currency: NATIVE[net] },
    total: priceOf(sorted.reduce((sum, { hundredths }) => sum + hundredths, 0)),
    exchange_rate: UNIT_RATE,
    start_time: isoTime(start),
    end_time: isoTime(end),
  };
}

/** `network/nft_volume`: the three rolling periods ending at the minute of T's close, and the days of the 30-day window the route has computed (not the running day, nor, in the first hour after midnight, the one before). */
function volumeFiles(world: NftWorld, collections: readonly NftCollection[], clock: { today: string; head: number }, put: ApiPut): void {
  const { net } = world;
  const coverage = featureCoverage(net);
  const end = Math.floor(clock.head / 60) * 60;
  const trades = tradesOf(net, collections, end);
  for (const [period, days] of [["day", 1], ["7day", 7], ["30day", 30]] as const) {
    const start = end - days * DAY_SECONDS;
    put("/v2/network/nft_volume", `live=${period}`, { result: "success", coverage, count: 1, rows: [volumeRow(net, trades.filter((trade) => trade.time >= start), start, end)] });
  }
  const window = windowOf(clock.today, "30d");
  const final = addDays(clock.today, clock.head % DAY_SECONDS >= 3_600 ? -1 : -2);
  // the window's days are consecutive and the last is T, whose own start is the newest ledger's close time less what has passed of that day
  const todayStart = clock.head - (clock.head % DAY_SECONDS);
  const rows = window.buckets
    .map((day, at) => ({ day, start: todayStart - (window.buckets.length - 1 - at) * DAY_SECONDS }))
    .filter(({ day }) => day <= final)
    .map(({ start }) => volumeRow(net, trades.filter((trade) => trade.time >= start && trade.time < start + DAY_SECONDS), start, start + DAY_SECONDS));
  put("/v2/network/nft_volume", `end=${window.end}&interval=day&limit=1000&start=${window.start}`, { result: "success", coverage, count: rows.length, rows });
}

// ---- All of them

/** A collection that has not been sold has at most this many NFTs for the page of its own (a few: the page only has to show a list that is short and quiet). */
const QUIET_NFTS = 6;

/**
 * The collections that get the files of a page of their own (`collectionCase`, test/support/nft-cases.ts, finds them again by their data): the featured NFT's, the one with the most
 * NFTs of those that have not been sold and have a holder (`QUIET_NFTS` at most), and the most sold of the others (20 NFTs at most: no marker page for its NFTs).
 */
function caseCollections(world: NftWorld, groups: ReadonlyMap<string, DerivedNft[]>): { featured: string; quiet: string; other: string } {
  const featured = collectionKey(world.nfts.find((each) => each.id === world.featured)!.nft);
  const rows = [...groups].filter(([key, nfts]) => key !== featured && nfts.length <= PAGE).map(([key, nfts]) => ({ key, nfts, row: derivedCollection(nfts) }));
  const best = (pick: (row: NftCollection, nfts: readonly DerivedNft[]) => boolean, rank: (row: NftCollection, nfts: readonly DerivedNft[]) => number): string => {
    const [found] = rows.filter(({ row, nfts }) => pick(row, nfts)).sort((a, b) => rank(b.row, b.nfts) - rank(a.row, a.nfts) || byText(a.key, b.key));
    if (found === undefined) throw new Error(`${world.net}: no collection for a case`);
    return found.key;
  };
  return {
    featured,
    quiet: best((row, nfts) => row.sales_count === 0 && row.holders > 0 && nfts.length <= QUIET_NFTS, (_, nfts) => nfts.length),
    other: best((row) => row.sales_count > 0, (row) => row.sales_count),
  };
}

/** The aggregates of a network: the collections' lists, three collections' pages, the sales and the volume. */
function aggregateFiles(world: NftWorld, put: ApiPut): void {
  const { net } = world;
  const coverage = featureCoverage(net);
  const clock = clockOf(net);
  const groups = new Map<string, DerivedNft[]>();
  for (const each of world.nfts) groups.set(collectionKey(each.nft), [...(groups.get(collectionKey(each.nft)) ?? []), each]);
  const derivedRows = [...groups.values()].map(derivedCollection);
  const collections = [...derivedRows, ...syntheticCollections(world, derivedRows)];

  // The list: every sort, each way, and a filter by issuer (the featured NFT's, and one that has issued nothing), on every page.
  const lists = (filter: string | undefined, rows: readonly NftCollection[]): void => {
    for (const sort of SORTS) {
      for (const ascending of [false, true]) {
        const sorted = sortedCollections(rows, sort, ascending);
        for (const { marker, next, rows: shown } of pagesOf(sorted, (each) => [sortValue(each, sort), each.issuer, each.taxon ?? 0])) {
          const query = [`limit=${PAGE}`, `sort=${sort}`, ...(ascending ? ["descending=false"] : []), ...(filter !== undefined ? [`issuer=${filter}`] : []), ...(marker !== undefined ? [`marker=${marker}`] : [])].join("&");
          put("/v2/nft_collections", query, { result: "success", coverage, total: sorted.length, count: shown.length, ...(next !== undefined && { marker: next }), collections: shown });
        }
      }
    }
  };
  lists(undefined, collections);
  const cases = caseCollections(world, groups);
  const featuredIssuer = world.nfts.find((each) => each.id === world.featured)!.nft.issuer;
  for (const issuer of [featuredIssuer, NFT_ACCOUNTS[net].unfunded]) lists(issuer, collections.filter((each) => each.issuer === issuer));

  // The pages of the three cases.
  for (const key of Object.values(cases)) {
    const nfts = groups.get(key)!;
    collectionFiles(world, derivedCollection(nfts), nfts, clock, key === cases.featured, key === cases.featured, put);
  }

  // The sales of the network: the first page of ten (the list page's), and pages of twenty from the start and from the marker of that first page (the older sales' page).
  const sales = salesOf(world.nfts);
  const page = (rows: readonly NftSale[], limit: number, marker: string | undefined, next: string | undefined): void => {
    const query = ["descending=true", `limit=${limit}`, ...(marker !== undefined ? [`marker=${marker}`] : [])].join("&");
    put("/v2/nft_sales", query, { result: "success", coverage, count: rows.length, ...(next !== undefined && { marker: next }), sales: rows });
  };
  const [firstTen] = pagesOf(sales, saleKey, 10);
  page(firstTen!.rows, 10, undefined, firstTen!.next);
  for (const { marker, next, rows } of pagesOf(sales, saleKey)) page(rows, PAGE, marker, next);
  if (firstTen!.next !== undefined) for (const { marker, next, rows } of pagesOf(sales.slice(10), saleKey, PAGE, firstTen!.next)) page(rows, PAGE, marker, next);

  volumeFiles(world, collections, clock, put);
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
    aggregateFiles(world, put);
    nodeFiles(net, world, write);
  }
  return answers;
}

let ledgerEntryIds: Set<string> | undefined;

/**
 * The ids of the Xahau URITokens whose `node/ledger_entry/<ID>.json` this generator writes (`nodeFiles`), worked out once: `node/ledger_entry/` is the ledger-object pages' too, and
 * `isNftGenerated` claims these entries only (C5).
 */
export function nftLedgerEntryIds(): ReadonlySet<string> {
  if (ledgerEntryIds === undefined) {
    ledgerEntryIds = new Set();
    for (const { path } of nftAnswers()) {
      const id = /^(xrpl|xahau)\/node\/ledger_entry\/([0-9A-F]{64})\.json$/.exec(path)?.[2];
      if (id !== undefined) ledgerEntryIds.add(id);
    }
  }
  return ledgerEntryIds;
}

/** Every NFT file: path below test/fixtures/http/ and text. */
export function nftFixtures(): Array<[path: string, text: string]> {
  return nftAnswers().map(({ path, value }) => [path, fixtureText(value, ROW_LISTS)]);
}
