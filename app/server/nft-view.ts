// What an NFT's page shows, worked out in the Worker from the answers of the data API and the node (E8 spec 4): `nftModeOf` and `needsNode` (which page it is, from the
// index's answer for the NFT and the node's: Review Focus 2), `NFT_MODE_CLASS` (the edge class of each mode), `nftPage` for `/{net}/nft/{ID}`, `nftMarkerPage` for a page of its
// history behind a marker, `historyRows` and `offerRows` (the two tables), and `nftNotFound` (the words of the 404). No I/O, no clock (`now` is the loader's, in unix seconds), no
// `Intl`: each number of a page is the API's own text or made with BigNumber, so no float and no exponent reaches a label.
//
// The calls stand or fail on their own (spec 4.3). #1, the index's NFT, decides the page with #2, the node's; what a page needs of them it is given whole (`index`, `node`), and a
// page that is none (`none`, `unavailable`) is the loader's 404 or 503. The two cards, the open offers (#3) and the history (#4), may fail beside it: a rejected card is `null` and
// puts its words in `failures` (the `what` of the card's `SectionError`, "Couldn’t load {what}."); the loader holds the settled results, so it logs the reasons and marks the
// request degraded. A page from the network has no history: its `history` is `null` and no failure.
//
// It value-imports `nft-id.ts` (the id's fields and the URI's words; Worker-only) and the glyph characters of `app/ui/components/NftGlyph.tsx`, so only the Worker, the scripts and
// the tests import this file: the pages get the data it returns, and its types.

import type { Segment } from "../domain/describe";
import { formatAmount, formatCurrency } from "../domain/format";
import { decodeNftId, NFT_FLAG_LABELS, uriText } from "../domain/nft-id";
import { ARROW, collectionHref, collectionLabel, nftHref, nftsHref, nftWords, shortNftId, type CollectionKey, type NftQuery, type NftWords } from "../domain/nft-params";
import { trailPaging, type Paging } from "../domain/paging";
import { formatDate, formatDateTime } from "../domain/time-words";
import { nftGlyph } from "../ui/components/NftGlyph";
import type { Coverage, Nft, NftAnswer, NftEvent, NftEventKind, NftEventsPage, NftKind, NftOffer, NftOffersPage, NodeNftInfo, NodeNftOffers, NodeUriToken } from "./api-types";
import { CACHE_CLASSES, type CacheClass } from "./cache-class";
import { coverageNote, type CoverageNoteText } from "./coverage";
import { feePercent } from "./exact";
import type { Network } from "./networks";
import { convertedOf, counted, DASH, plain } from "./nft-format";
import { searchOnOther, type NetworkName } from "./search-view";
import { isNotFound } from "./upstream";
import { unixOf } from "./validator-facts";

/** What the builders read of the network: its id (the words and the links), its name (a breadcrumb, a 404), its native currency, its name in a sentence and the network the search leads to. */
export type NftNet = Pick<Network, "id" | "name" | "native" | "longName" | "other">;

/** An amount as `Amount` draws it, in its own currency. */
export interface NftAmount {
  value: string;
  currency: string;
  issuer?: string;
}

// ---- The modes (spec 4.1, Review Focus 2) ----------------------------------------------------------------------------------------------------

/**
 * The modes that are a page:
 * - `indexed`: the index's NFT, with an owner: everything.
 * - `burned`: the index's burned NFT: everything, the "burned" tag, "Burned {date} by {account}" in place of the owner, no open offers.
 * - `indexed-network-owner`: the index's NFT without an owner (no indexed event names one), and the node's: the owner "read from the network at ledger #N".
 * - `indexed-owner-unknown`: the same, and the node failed or has no such NFT: the owner "Not in the index yet".
 * - `network`: the index has no such NFT and the node has: the header, details and open offers from the node, no history, `noindex`.
 * - `network-burned`: as `network`, and the node says the NFT is burned (Clio's `is_burned`; a burned URIToken is no ledger entry, so Xahau has none): no offers.
 */
export type NftPageMode = "indexed" | "burned" | "indexed-network-owner" | "indexed-owner-unknown" | "network" | "network-burned";

/** The page's mode, or `none` (the index and the node both say there is no such NFT: a 404) or `unavailable` (a failure that is not that: a 503, never stored). */
export type NftMode = NftPageMode | "none" | "unavailable";

/** Whether the node is asked (#2): the index has no such NFT, or has it without an owner and not burned. An index that failed is no reason to ask the node in its place. */
export function needsNode(index: PromiseSettledResult<NftAnswer>): boolean {
  if (index.status === "rejected") return isNotFound(index.reason);
  const { nft } = index.value;
  return nft.owner === undefined && !nft.burned;
}

/** Whether the node's answer says the NFT is burned: Clio's `nft_info` does, a URIToken entry cannot (a burned one is no entry). */
const burnedOnNode = (node: NodeNftInfo | NodeUriToken): boolean => "is_burned" in node && node.is_burned;

/**
 * The mode of the NFT's page (spec 4.1's table) from the index's answer for the NFT (#1) and the node's (#2; `null`: not asked). A 404 (`none`) only when the index and the node
 * both say there is no such NFT; a failure on either side that is not that is never one, so it is never stored as one. What counts as "no such NFT" is upstream.ts's `isNotFound`:
 * the index's `nft not found`, and the node's `objectNotFound`, `entryNotFound`, and `unknownCmd` and `notImpl` (a node that is not Clio, which the reader logs once per Worker
 * instance). The data API's "Cannot GET" is kind `server` (data-api.ts), an outage, and so is a 5xx, a 429, a malformed answer, a `TooLate` and a bug.
 */
export function nftModeOf(index: PromiseSettledResult<NftAnswer>, node: PromiseSettledResult<NodeNftInfo | NodeUriToken> | null): NftMode {
  if (index.status === "fulfilled") {
    const { nft } = index.value;
    if (nft.burned) return "burned";
    if (nft.owner !== undefined) return "indexed";
    // The owner is the node's only when the node has the NFT and does not say it is burned: a burned NFT's owner is no owner.
    return node !== null && node.status === "fulfilled" && !burnedOnNode(node.value) ? "indexed-network-owner" : "indexed-owner-unknown";
  }
  if (!isNotFound(index.reason) || node === null) return "unavailable";
  if (node.status === "fulfilled") return burnedOnNode(node.value) ? "network-burned" : "network";
  return isNotFound(node.reason) ? "none" : "unavailable";
}

/**
 * The edge class of each mode that is a page: an indexed NFT `live`, a burned one `slow`, one from the network `short`, kept the aggregator's minute (the `minute` class's 60 s), after
 * which the index has it. `indexed-owner-unknown` is served and not stored when the node failed: not by its class, but by the loader, which marks the request degraded.
 */
export const NFT_MODE_CLASS: Record<NftPageMode, { cls: CacheClass; ttl?: number }> = {
  indexed: { cls: "live" },
  burned: { cls: "slow" },
  "indexed-network-owner": { cls: "live" },
  "indexed-owner-unknown": { cls: "live" },
  network: { cls: "short", ttl: CACHE_CLASSES.minute.edgeTtl },
  "network-burned": { cls: "short", ttl: CACHE_CLASSES.minute.edgeTtl },
};

// ---- The rows ----------------------------------------------------------------------------------------------------------------------------------

/**
 * An event of the history. `time` is unix seconds (the page writes the UTC time). `event` is the tag's text ("mint", "sale", "transfer", "burn", "URI change", "offer create",
 * "offer cancel", "offer removed"). `accounts` is the Accounts cell as `Sentence` draws it; a text segment that is exactly `ARROW` (domain/nft-params.ts, which the page imports to draw it) is the "to" of a seller → buyer, which the page draws
 * as an arrow with a visually hidden "to". `amount` is the price of a sale and the amount of an offer, in its own currency, `null` for the rest and for a group of removals.
 */
export interface NftHistoryRow {
  /** `tx_hash:event_index`: the row's own key (a group of removals has its first offer's). */
  key: string;
  time: number;
  txHash: string;
  event: string;
  accounts: Segment[];
  amount: NftAmount | null;
}

/**
 * An open offer. `onlyFor` is the destination, `"anyone"` for a sell offer that has none, `null` (a dash) for a buy offer that has none. `expires` is the UTC day, "never" (XRPL), or a
 * dash on Xahau, whose URIToken offers have no expiry; `expired` is that it is before the loader's time (a tag). `created` is the ledger the index says the offer was made in, `null` from
 * the node, which does not say.
 */
export interface NftOfferRow {
  /** The offer's id: the row's own key (a URIToken's sell offer has the token's). */
  key: string;
  side: "sell" | "buy";
  amount: NftAmount;
  by: string;
  onlyFor: string | "anyone" | null;
  expires: string;
  expired: boolean;
  created: { ledger: number } | null;
}

const text = (v: string): Segment => ({ t: "text", v });
const account = (v: string): Segment => ({ t: "account", v });
const amountOf = (value: string, currency: string, issuer?: string): NftAmount => ({ value, currency, ...(issuer === undefined ? {} : { issuer }) });

const EVENT_TAGS: Record<NftEventKind, string> = {
  mint: "mint",
  sale: "sale",
  transfer: "transfer",
  burn: "burn",
  modify: "URI change",
  offer_create: "offer create",
  offer_cancel: "offer cancel",
  offer_removed: "offer removed",
};

/** `{from} → {to}`, each as far as the event names it. */
function movement(e: NftEvent): Segment[] {
  return [...(e.from === undefined ? [] : [account(e.from)]), ...(e.from !== undefined && e.to !== undefined ? [text(ARROW)] : []), ...(e.to === undefined ? [] : [account(e.to)])];
}

/** `sell offer by {account}` (`buy`, or just `offer` when the event does not say), then `tail`, then ` · only for {destination}`. */
function offerCell(e: NftEvent, tail: string): Segment[] {
  const side = e.is_sell_offer === undefined ? "" : e.is_sell_offer ? "sell " : "buy ";
  return [
    text(`${side}offer`),
    ...(e.account === undefined ? [] : [text(" by "), account(e.account)]),
    ...(tail === "" ? [] : [text(tail)]),
    ...(e.destination === undefined ? [] : [text(" · only for "), account(e.destination)]),
  ];
}

/**
 * Why an offer was removed, in the words of the row: D3's `sale` (an accepted offer) is "removed by the sale", unless the transaction's ownership event is a transfer (a zero-amount
 * accept moves the token without a price), when it is "removed by the transfer"; `burn` and `transfer` say so; `other` (an `AccountDelete` of the offer's owner, or an accept that failed
 * with `tecEXPIRED` and still deleted the expired offer it met) and any word we do not know claim no cause: "removed". Only the page's own events are looked at, so a transfer on the next
 * page is not seen.
 */
function removalOf(e: NftEvent, events: readonly NftEvent[]): string {
  switch (e.removed_by) {
    case "sale":
      return events.some((other) => other.tx_hash === e.tx_hash && other.event === "transfer") ? "removed by the transfer" : "removed by the sale";
    case "burn":
      return "removed by the burn";
    case "transfer":
      return "removed by the transfer";
    default:
      return "removed";
  }
}

/** The Accounts cell of one event (spec 4.2). */
function accountsOf(e: NftEvent, events: readonly NftEvent[]): Segment[] {
  switch (e.event) {
    case "mint":
      return [...(e.account === undefined ? [] : [text("by "), account(e.account)]), ...(e.to === undefined ? [] : [text(e.account === undefined ? "to " : ", to "), account(e.to)])];
    case "sale":
      return [
        ...movement(e),
        ...(e.broker === undefined ? [] : [text(" · broker "), account(e.broker)]),
        ...(e.broker !== undefined && e.broker_fee !== undefined && e.currency !== undefined ? [text(", fee "), { t: "amount" as const, ...amountOf(e.broker_fee, e.currency, e.amount_issuer) }] : []),
      ];
    case "transfer":
      return [...movement(e), ...(e.tx_type === "Remit" ? [text(" · by Remit")] : e.tx_type === "NFTokenAcceptOffer" ? [text(" · an accepted offer of 0")] : [])];
    case "burn":
      return [...(e.account === undefined ? [] : [text("by "), account(e.account)]), ...(e.from !== undefined && e.from !== e.account ? [text(" · owned by "), account(e.from)] : [])];
    case "modify":
      return e.account === undefined ? [] : [text("by "), account(e.account)];
    case "offer_create":
      return offerCell(e, "");
    case "offer_cancel":
      return offerCell(e, " cancelled");
    case "offer_removed":
      return offerCell(e, ` ${removalOf(e, events)}`);
  }
}

/**
 * The rows of the history, in the order the API gave them (newest first when the call asked for it). Each event is a row, but the `offer_removed` events of one transaction that were
 * removed for one cause are one row where the first of them is ("2 offers removed by the sale"). `net` is the page's network: the words of a row are the same on both, the
 * transaction types (`Remit`, `NFTokenAcceptOffer`) carry the difference.
 */
export function historyRows(_net: Pick<NftNet, "id">, events: readonly NftEvent[]): NftHistoryRow[] {
  // The group of each removal (its transaction and its cause) and how many removals are in it; the group is a row where its first removal is.
  const groups = events.map((e) => (e.event === "offer_removed" ? `${e.tx_hash}|${removalOf(e, events)}` : null));
  const sizes = new Map<string, number>();
  for (const group of groups) if (group !== null) sizes.set(group, (sizes.get(group) ?? 0) + 1);
  const rows: NftHistoryRow[] = [];
  const done = new Set<string>();
  events.forEach((e, at) => {
    const group = groups[at]!;
    const base = { key: `${e.tx_hash}:${plain(e.event_index)}`, time: unixOf(e.executed_time), txHash: e.tx_hash, event: EVENT_TAGS[e.event] };
    if (group !== null && sizes.get(group)! > 1) {
      if (done.has(group)) return;
      done.add(group);
      rows.push({ ...base, accounts: [text(`${counted(sizes.get(group)!)} offers ${removalOf(e, events)}`)], amount: null });
      return;
    }
    rows.push({ ...base, accounts: accountsOf(e, events), amount: e.amount !== undefined && e.currency !== undefined ? amountOf(e.amount, e.currency, e.amount_issuer) : null });
  });
  return rows;
}

/** When an offer expires, and whether that is before `now` (unix seconds; `at` too). Nothing to expire is "never", and on Xahau (native currency XAH) a dash: a URIToken's offer has no expiry. */
function expiryOf(at: number | undefined, now: number, native: string): { expires: string; expired: boolean } {
  if (at === undefined) return { expires: native === "XAH" ? DASH : "never", expired: false };
  return { expires: formatDate(at), expired: at < now };
}

/** The flag of an `NFTokenOffer` that says it is an offer to sell (`lsfSellNFToken`). */
const LSF_SELL_NFTOKEN = 0x1;

const isIndexOffers = (offers: readonly NftOffer[] | NodeNftOffers | NodeUriToken): offers is readonly NftOffer[] => Array.isArray(offers);

/**
 * The open offers as rows, in the order they came: the index's (`NftOffer`, whose `expiration` is ISO text), the node's (`nft_sell_offers` and `nft_buy_offers` joined, sell first:
 * `expiration` is unix seconds, the side is the offer's `lsfSellNFToken` flag), or a URIToken entry's one sell offer (its `Amount` and `Destination`; none without an `Amount`). `now` is the
 * loader's time in unix seconds, which an expiration is compared with; `native` is the network's native currency.
 */
export function offerRows(offers: readonly NftOffer[] | NodeNftOffers | NodeUriToken, now: number, native: string): NftOfferRow[] {
  if (isIndexOffers(offers)) {
    return offers.map((offer) => ({
      key: offer.offer_id,
      side: offer.is_sell_offer ? "sell" : "buy",
      amount: amountOf(offer.amount, offer.currency, offer.amount_issuer),
      by: offer.owner,
      onlyFor: offer.destination ?? (offer.is_sell_offer ? "anyone" : null),
      ...expiryOf(offer.expiration === undefined ? undefined : unixOf(offer.expiration), now, native),
      created: { ledger: offer.created_ledger },
    }));
  }
  if (!("offers" in offers)) {
    if (offers.Amount === undefined) return [];
    return [
      {
        key: offers.index,
        side: "sell",
        amount: amountOf(offers.Amount.value, offers.Amount.currency, offers.Amount.issuer),
        by: offers.Owner,
        onlyFor: offers.Destination ?? "anyone",
        ...expiryOf(undefined, now, native),
        created: null,
      },
    ];
  }
  return offers.offers.map((offer) => {
    const sell = (offer.flags & LSF_SELL_NFTOKEN) !== 0;
    return {
      key: offer.nft_offer_index,
      side: sell ? "sell" : "buy",
      amount: amountOf(offer.amount.value, offer.amount.currency, offer.amount.issuer),
      by: offer.owner,
      onlyFor: offer.destination ?? (sell ? "anyone" : null),
      ...expiryOf(offer.expiration, now, native),
      created: null,
    };
  });
}

// ---- The page ----------------------------------------------------------------------------------------------------------------------------------

/** A breadcrumb: the last one, the page itself, has no link. */
export interface NftCrumb {
  label: string;
  href?: string;
}

/** A flag of the Flags row: `mark` is the ✓ or – the page draws (`aria-hidden`), `state` the "yes" or "no" a screen reader reads. */
export interface NftFlagView {
  label: string;
  on: boolean;
  mark: "✓" | "–";
  state: "yes" | "no";
}

/**
 * A row of the details or of the id's card. `value` is what `Sentence` draws (text and accounts). `hex` is the bytes of the id the value is read from (the id's card), `note` a faint line
 * after the value, `mono` that the value is a code (the URI), `title` the full text of a shortened value (the digest), `flags` the Flags row's flags (its `value` is then empty).
 */
export interface NftDetailRow {
  label: string;
  value: Segment[];
  hex?: string;
  note?: string;
  mono?: boolean;
  title?: string;
  flags?: NftFlagView[];
}

/**
 * The Owner line: the owner (`address`, "since" a time and the transaction that made it so, or `note`: "read from the network at ledger #N"), words in place of one (`text`: "Not in the
 * index yet", "Burned"), or, for a burned NFT, the label "Burned", its date (`text`) and the account that burned it (`by`): "Burned {text} by {by}".
 */
export interface NftOwnerLine {
  label: "Owner" | "Burned";
  address?: string;
  text?: string;
  by?: string;
  since?: { text: string; txHash: string };
  note?: string;
}

/** The newest sale: the price in its own currency, `converted` "≈ 96 XRP" under a price in a token the API converted, the day and the count, the transaction; or "Never sold". */
export type NftLastSaleView = { amount: NftAmount; converted?: string; text: string; txHash: string } | { text: string };

export interface NftHeader {
  /** The glyph box's two characters in the case they have (the stylesheet draws capitals). */
  glyph: string;
  /** "NFT #4,127", "URIToken A1F04C77…". */
  heading: string;
  /** "NFToken" or "URIToken", and "burned". */
  tags: string[];
  /** "Serial 4,127 of the collection" / "Minted by the issuer of", and the collection's label and link. */
  line: { text: string; collection: { label: string; href: string } };
  /** The id in full. */
  id: string;
  /** `null` behind a marker. */
  owner: NftOwnerLine | null;
  /** `null` behind a marker and from the network (the node does not tell the sales). */
  lastSale: NftLastSaleView | null;
}

/**
 * What the tags of an NFT's page and the card of its link-preview image say of it (spec 10), each fact left out where the page does not have it: the page and the image make it with
 * `nftFacts`, so that a link's text and its picture never disagree. `owner` is a classic address; `lastSale` the newest sale's price as text ("1,250 XRP"); `sold` what is said of the sales
 * when there is no price to say ("never sold", "sold 3 times"); `minted` is unix seconds, from the index.
 */
export interface NftFacts {
  kind: NftKind;
  /** "NFT #4,127", "URIToken A1F04C77…": the page's heading. */
  name: string;
  /** The image's headline: "#4,127", else the short id. */
  headline: string;
  burned: boolean;
  /** The collection's label: "rLULtF…mB3R · taxon 1". */
  collection: string;
  owner?: string;
  lastSale?: string;
  sold?: string;
  minted?: number;
}

export interface NftPageData {
  mode: NftPageMode;
  breadcrumb: NftCrumb[];
  header: NftHeader;
  /** The details (spec 4.2's source `/v2/nfts/{ID}`, or the node's); none behind a marker. */
  details: NftDetailRow[];
  /** The id's card: "The id, decoded" (XRPL) or "The id" (Xahau), its rows (the decoded fields; the digest and the ledger entry) and the paragraph under them. Empty behind a marker. */
  idTitle: string;
  idCard: NftDetailRow[];
  idNote: string;
  /** The open offers; `[]` for a burned NFT; `null` while the card failed (`failures.offers`), when none was asked for and behind a marker. */
  offers: NftOfferRow[] | null;
  /** Whether there are more offers than the first 50 shown ("Showing the first 50"). */
  offersMore: boolean;
  /** The note of the offers card, in each network's words. */
  offersNote: string;
  /** The history, newest first; `null` while the card failed, from the network (it has none) and when none was asked for. */
  history: NftHistoryRow[] | null;
  /** The note under the history. */
  historyNote: string;
  /** "Show offer events" / "Hide offer events", and where it leads (the other view's first page). */
  historyToggle: { label: string; href: string };
  paging: Paging;
  /** The per-NFT coverage note of each card (spec 8): "This NFT's history in the index starts at ledger #N: …". None from the network. */
  notes: { offers: CoverageNoteText | null; history: CoverageNoteText | null };
  /** What a card says when it has no row (`null` when it has rows, or is none). */
  empty: { offers: string | null; history: string | null };
  /** The `what` of the `SectionError` of each card that failed: "the open offers", "the history". */
  failures: { offers?: string; history?: string };
  /** "Not in the index yet, shown from the network. …" for the modes from the network, else `null`. */
  notice: string | null;
  /** From the network and behind a marker: `noindex`. */
  noindex: boolean;
  /** The NFT's name in a title: "NFT #4,127 (burned) of rLULtF…mB3R · taxon 1"; behind a marker "Older history of NFT #4,127". The tags add the network's name. */
  title: string;
  /** What the tags and the image say of the NFT. */
  facts: NftFacts;
  /** A page behind a marker: the breadcrumb, the header without owner and last sale, `back` and the history rows. */
  marker: boolean;
  /** "Back to the NFT", to the NFT's page in the view of offer events it is behind; `null` unless behind a marker. */
  back: { label: string; href: string } | null;
}

/** The input of `nftPage`: the outcomes of the loader's calls (spec 4.3) and the mode they made. */
export interface NftPageInput {
  net: NftNet;
  /** The NFT's id, 64 hex digits in upper case. */
  id: string;
  query: NftQuery;
  mode: NftPageMode;
  /** The loader's time, unix seconds: what an offer's expiration is compared with. */
  now: number;
  /** #1; the modes of the index. */
  index?: NftAnswer;
  /** #2; the modes `indexed-network-owner`, `network` and `network-burned`. */
  node?: NodeNftInfo | NodeUriToken;
  /** #3: the index's offers, or the node's (the two sides of an XRPL NFT joined, sell first; a Xahau URIToken's entry); `null`: not asked. */
  offers: PromiseSettledResult<NftOffersPage | NodeNftOffers | NodeUriToken> | null;
  /** #4; `null`: not asked (from the network, no history). */
  history: PromiseSettledResult<NftEventsPage> | null;
}

/** The input of `nftMarkerPage`: #1 and #4 only, awaited whole (a failure is the loader's 503). */
export interface NftMarkerInput {
  net: NftNet;
  id: string;
  query: NftQuery;
  index: NftAnswer;
  history: NftEventsPage;
}

// ---- Words -------------------------------------------------------------------------------------------------------------------------------------

const OFFERS_WHAT = "the open offers";
const HISTORY_WHAT = "the history";
const NOTICE = "Not in the index yet, shown from the network. Its history appears once the index has it.";
const NO_OWNER = "Not in the index yet";
const NEVER_SOLD = "Never sold";
const HISTORY_NOTE = "Newest first. A sale's price is the offer it accepted; a transfer moves the token without a price.";
const XRPL_OFFERS_NOTE = "Open offers: created and not yet cancelled, removed or accepted. A buy offer's amount is what its owner would pay; an expired offer stays until someone removes it.";
const XRPL_ID_NOTE = "The taxon is stored scrambled with the sequence; the explorer unscrambles it, as rippled does.";
const URI_NOTE = "Decoded from hex. Not fetched.";
const URI_HEX_NOTE = "Not text, shown as hex. Not fetched.";

/** The per-network words of a page: the offers' note and the id card's paragraph and title (the network's name is the layout's, so the sandbox says "Xahau Testnet"). */
function networkWords(net: NftNet, words: NftWords): { offersNote: string; idTitle: string; idNote: string } {
  return net.id === "xrpl"
    ? { offersNote: XRPL_OFFERS_NOTE, idTitle: "The id, decoded", idNote: XRPL_ID_NOTE }
    : {
        offersNote: `A ${words.token} carries at most one sell offer, on the entry itself. ${net.longName} has no buy offers.`,
        idTitle: "The id",
        idNote: `A ${words.token}'s id is the key of its ledger entry, worked out from the issuer and the URI. It encodes nothing else: the issuer, owner, flags and digest are fields of the entry.`,
      };
}

const fulfilled = <T>(value: T): PromiseFulfilledResult<T> => ({ status: "fulfilled", value });
const timesOf = (count: number): string => (count === 1 ? "once" : `${counted(count)} times`);
const readAt = (node: NodeNftInfo | NodeUriToken): string => `read from the network at ledger #${counted(node.ledger_index)}`;

// ---- What the NFT is, from the index or the node -----------------------------------------------------------------------------------------------

/** The facts of an NFT that its header, details and id card read, whichever answer they come from. `transferFee` is in 1/100000; `uri` hex. */
interface Facts {
  issuer: string;
  taxon?: number;
  serial?: number;
  flags: number;
  transferFee?: number;
  uri?: string;
  digest?: string;
}

const isNodeInfo = (node: NodeNftInfo | NodeUriToken): node is NodeNftInfo => "nft_id" in node;

/**
 * The NFT's facts. An XRPL id encodes its taxon, serial and transfer fee, so one the answer does not carry is read from the id (`decodeNftId`): the collection's crumb, the heading and the
 * id's card then never lack them.
 */
function factsOf(net: NftNet, id: string, from: Nft | NodeNftInfo | NodeUriToken): Facts {
  const facts: Facts =
    "burned" in from
      ? { issuer: from.issuer, taxon: from.taxon, serial: from.serial, flags: from.flags, transferFee: from.transfer_fee, uri: from.uri, digest: from.digest }
      : isNodeInfo(from)
        ? { issuer: from.issuer, taxon: from.nft_taxon, serial: from.nft_serial, flags: from.flags, transferFee: from.transfer_fee, uri: from.uri }
        : { issuer: from.Issuer, flags: from.Flags, uri: from.URI, digest: from.Digest };
  if (net.id !== "xrpl") return facts;
  const decoded = decodeNftId(id);
  return { ...facts, taxon: facts.taxon ?? decoded.taxon, serial: facts.serial ?? decoded.serial, transferFee: facts.transferFee ?? decoded.transferFee };
}

const keyOf = (facts: Facts): CollectionKey => (facts.taxon === undefined ? { issuer: facts.issuer } : { issuer: facts.issuer, taxon: facts.taxon });

/** The NFT as a name: "NFT #4,127", "URIToken A1F04C77…" (its crumb is "#4,127", "A1F04C77…3D10"). */
function nameOf(net: NftNet, id: string, facts: Facts): { name: string; crumb: string } {
  const words = nftWords(net.id);
  return net.id === "xrpl" && facts.serial !== undefined
    ? { name: `${words.token} #${counted(facts.serial)}`, crumb: `#${counted(facts.serial)}` }
    : { name: `${words.token} ${id.slice(0, 8)}…`, crumb: shortNftId(id) };
}

/** The breadcrumb, the header without its owner and last sale, the title and whether the NFT is burned: what a page and a page behind a marker have alike. */
function headOf(net: NftNet, id: string, facts: Facts, burned: boolean): Pick<NftPageData, "breadcrumb" | "title"> & { header: NftHeader; name: string } {
  const words = nftWords(net.id);
  const { name, crumb } = nameOf(net, id, facts);
  const key = keyOf(facts);
  const collection = { label: collectionLabel(key), href: collectionHref(net.id, key) };
  return {
    name,
    breadcrumb: [{ label: net.name, href: `/${net.id}` }, { label: words.tokens, href: nftsHref(net.id) }, { label: collection.label, href: collection.href }, { label: crumb }],
    title: `${name}${burned ? " (burned)" : ""} of ${collection.label}`,
    header: {
      glyph: nftGlyph(id, facts.serial),
      heading: name,
      tags: [words.kindTag, ...(burned ? ["burned"] : [])],
      line: { text: net.id === "xrpl" && facts.serial !== undefined ? `Serial ${counted(facts.serial)} of the collection` : "Minted by the issuer of", collection },
      id,
      owner: null,
      lastSale: null,
    },
  };
}

// ---- The details and the id's card -------------------------------------------------------------------------------------------------------------

/** The flags of the network's NFTs, each ✓ or – with the word a screen reader reads. */
function flagsOf(net: NftNet, flags: number): NftFlagView[] {
  return NFT_FLAG_LABELS[net.id].map(({ mask, label }) => {
    const on = (flags & mask) !== 0;
    return { label, on, mark: on ? "✓" : "–", state: on ? "yes" : "no" };
  });
}

/** The URI: the text it decodes to, or its hex, as a code; never a link and never fetched. What is not there says why. */
function uriRow(uri: string | undefined, missing: string): NftDetailRow {
  if (uri === undefined || uri === "") return { label: "URI", value: [text(missing)] };
  const { text: shown, decoded } = uriText(uri);
  return { label: "URI", value: [text(shown)], mono: true, note: decoded ? URI_NOTE : URI_HEX_NOTE };
}

/** The Minted row's value from the index: the mint, or why it is not there (the index starts after it: "Before ledger #N, not in the index"). */
function mintedValue(nft: Nft, coverage: Coverage): Segment[] {
  const { minted } = nft;
  if (minted !== undefined) {
    return [text(`#${counted(minted.ledger_index)} · ${formatDate(minted.executed_time)} · by `), account(minted.by), ...(minted.to === minted.by ? [] : [text(", to "), account(minted.to)])];
  }
  if (coverage.complete) return [text(DASH)];
  return [text(coverage.from_ledger_index === undefined ? "Not in the index" : `Before ledger #${counted(coverage.from_ledger_index)}, not in the index`)];
}

/**
 * The details (spec 4.2): the issuer, the taxon and serial (XRPL), the mint (from the index; the node does not tell it), the transfer fee (XRPL) or the royalty (Xahau: none), the URI and
 * the flags. `index` is the NFT and its coverage when the details come from the index, `null` from the node, whose absent URI is none.
 */
function detailRows(net: NftNet, facts: Facts, index: { nft: Nft; coverage: Coverage } | null): NftDetailRow[] {
  const words = nftWords(net.id);
  const fee = facts.transferFee ?? 0;
  return [
    { label: "Issuer", value: [account(facts.issuer)] },
    ...(net.id === "xrpl" && facts.taxon !== undefined && facts.serial !== undefined ? [{ label: "Taxon · serial", value: [text(`${counted(facts.taxon)} · ${counted(facts.serial)}`)] }] : []),
    ...(index === null ? [] : [{ label: "Minted", value: mintedValue(index.nft, index.coverage) }]),
    net.id === "xrpl"
      ? { label: "Transfer fee", value: [text(fee > 0 ? `${feePercent(fee)} of every sale goes to the issuer` : "None")] }
      : { label: "Royalty", value: [text(`None: ${words.tokens} carry no transfer fee`)] },
    uriRow(facts.uri, index !== null && !index.coverage.complete ? "Not in the index" : "None"),
    { label: "Flags", value: [], flags: flagsOf(net, facts.flags) },
  ];
}

/** The flags of an id, as their tags: "transferable", "burnable, transferable", "none". */
function flagWords(net: NftNet, flags: number): string {
  const tags = NFT_FLAG_LABELS[net.id].filter(({ mask }) => (flags & mask) !== 0).map(({ tag }) => tag);
  return tags.length === 0 ? "none" : tags.join(", ");
}

/**
 * The id's card: an XRPL id decoded into its fields with the bytes each is read from (`decodeNftId`), a URIToken's id (which encodes nothing) by its entry's digest (short, the full digest
 * in `title`; a dash without one) and the entry's type.
 */
function idRows(net: NftNet, id: string, facts: Facts): NftDetailRow[] {
  if (net.id === "xahau") {
    return [
      facts.digest === undefined ? { label: "Digest", value: [text(DASH)] } : { label: "Digest", value: [text(shortNftId(facts.digest))], title: facts.digest },
      { label: "Ledger entry", value: [text("URIToken")] },
    ];
  }
  const decoded = decodeNftId(id);
  const hex = id.toUpperCase();
  return [
    { label: "Flags", hex: hex.slice(0, 4), value: [text(flagWords(net, decoded.flags))] },
    { label: "Transfer fee", hex: hex.slice(4, 8), value: [text(`${counted(decoded.transferFee)} = ${feePercent(decoded.transferFee)} royalty`)] },
    { label: "Issuer, 20 bytes", hex: hex.slice(8, 48), value: [account(decoded.issuer)] },
    { label: "Taxon, scrambled", hex: hex.slice(48, 56), value: [text(`taxon ${counted(decoded.taxon)}`)] },
    { label: "Sequence", hex: hex.slice(56, 64), value: [text(`serial ${counted(decoded.serial)} of the issuer`)] },
  ];
}

// ---- The owner and the last sale ---------------------------------------------------------------------------------------------------------------

function ownerLine(mode: NftPageMode, nft: Nft | undefined, node: NodeNftInfo | NodeUriToken | undefined): NftOwnerLine {
  switch (mode) {
    case "burned": {
      const burned = nft?.burned_at;
      return burned === undefined ? { label: "Owner", text: "Burned" } : { label: "Burned", text: formatDate(burned.executed_time), by: burned.by };
    }
    case "network-burned":
      return { label: "Owner", text: "Burned", ...(node === undefined ? {} : { note: readAt(node) }) };
    case "network":
    case "indexed-network-owner":
      return node === undefined ? { label: "Owner", text: NO_OWNER } : { label: "Owner", address: isNodeInfo(node) ? node.owner : node.Owner, note: readAt(node) };
    case "indexed-owner-unknown":
      return { label: "Owner", text: NO_OWNER };
    case "indexed": {
      if (nft?.owner === undefined) return { label: "Owner", text: NO_OWNER };
      const since = nft.owner_since;
      return { label: "Owner", address: nft.owner, ...(since === undefined ? {} : { since: { text: formatDateTime(since.executed_time), txHash: since.tx_hash } }) };
    }
  }
}

function lastSaleOf(net: NftNet, nft: Nft): NftLastSaleView {
  const sale = nft.last_sale;
  if (sale === undefined) return { text: nft.sale_count === 0 ? NEVER_SOLD : `Sold ${timesOf(nft.sale_count)}` };
  const converted = convertedOf(net.native, sale);
  return {
    amount: amountOf(sale.amount, sale.currency, sale.amount_issuer),
    ...(converted === null ? {} : { converted: `≈ ${formatAmount(converted)} ${net.native}` }),
    text: `${formatDate(sale.executed_time)} · sold ${timesOf(nft.sale_count)}`,
    txHash: sale.tx_hash,
  };
}

/**
 * The facts of the tags and of the image (`NftFacts`) from #1 and #2: the index's NFT, the node's, or both (`indexed-network-owner`). `index` is the NFT of the index's modes and
 * `node` the node's answer the owner or the whole NFT is read from. What neither has is left out: a page from the network has no sale and no mint, an NFT whose owner is not known no owner.
 */
export function nftFacts(net: NftNet, id: string, mode: NftPageMode, index: NftAnswer | undefined, node: NodeNftInfo | NodeUriToken | undefined): NftFacts {
  const source = index?.nft ?? node;
  if (source === undefined) throw new Error(`nftFacts: the ${mode} NFT needs the index's answer or the node's`);
  const facts = factsOf(net, id, source);
  const burned = mode === "burned" || mode === "network-burned";
  const { name, crumb } = nameOf(net, id, facts);
  const nft = index?.nft;
  const sale = nft?.last_sale;
  const { address } = ownerLine(mode, nft, node);
  return {
    kind: net.id === "xrpl" ? "nftoken" : "uritoken",
    name,
    headline: crumb,
    burned,
    collection: collectionLabel(keyOf(facts)),
    ...(address === undefined ? {} : { owner: address }),
    ...(sale === undefined ? {} : { lastSale: `${formatAmount(sale.amount)} ${formatCurrency(sale.currency)}` }),
    ...(nft === undefined || sale !== undefined ? {} : { sold: nft.sale_count === 0 ? "never sold" : `sold ${timesOf(nft.sale_count)}` }),
    ...(nft?.minted === undefined ? {} : { minted: unixOf(nft.minted.executed_time) }),
  };
}

// ---- The two cards -----------------------------------------------------------------------------------------------------------------------------

/** What the offers card has: its rows, whether there are more than it shows, its coverage note, or its failure. */
function offersOf(
  net: NftNet,
  words: NftWords,
  burned: boolean,
  offers: NftPageInput["offers"],
  now: number,
): { rows: NftOfferRow[] | null; more: boolean; note: CoverageNoteText | null; failure?: string } {
  // No NFT that is burned has an open offer, whatever was asked.
  if (burned) return { rows: [], more: false, note: null };
  if (offers === null) return { rows: null, more: false, note: null };
  if (offers.status === "rejected") return { rows: null, more: false, note: null, failure: OFFERS_WHAT };
  const value = offers.value;
  if ("coverage" in value) {
    return { rows: offerRows(value.offers, now, net.native), more: value.marker !== undefined, note: coverageNote(value.coverage, `offers of this ${words.token}`, `This ${words.token}'s history`) };
  }
  return { rows: offerRows(value, now, net.native), more: "more" in value && value.more, note: null };
}

/** What the history card has: its rows, its coverage note, the Older marker, or its failure. `null`: no history was asked for. */
function historyOf(
  net: NftNet,
  words: NftWords,
  history: PromiseSettledResult<NftEventsPage> | null,
): { rows: NftHistoryRow[] | null; note: CoverageNoteText | null; next: string | undefined; failure?: string } {
  if (history === null) return { rows: null, note: null, next: undefined };
  if (history.status === "rejected") return { rows: null, note: null, next: undefined, failure: HISTORY_WHAT };
  const page = history.value;
  return { rows: historyRows(net, page.events), note: coverageNote(page.coverage, `events of this ${words.token}`, `This ${words.token}'s history`), next: page.marker };
}

/** What each card says when it has no row: the offers' "No open offers.", and the history's, which says what the view leaves out. */
function emptyOf(words: NftWords, query: NftQuery, offers: NftOfferRow[] | null, history: NftHistoryRow[] | null): NftPageData["empty"] {
  return {
    offers: offers !== null && offers.length === 0 ? "No open offers." : null,
    history: history !== null && history.length === 0 ? (query.offers ? `No event of this ${words.token} is in the index.` : `No mint, sale, transfer or burn of this ${words.token} is in the index.`) : null,
  };
}

/** The pager of the history: where the page was reached from, and the view of offer events it keeps. */
function pagingOf(net: NftNet, id: string, query: NftQuery, next: string | undefined): Paging {
  return trailPaging({ marker: query.marker, back: query.back, next }, (to) => nftHref(net.id, id, { offers: query.offers, ...to }));
}

/** The link that switches the history between its two views, to the first page of the other. */
function toggleOf(net: NftNet, id: string, query: NftQuery): NftPageData["historyToggle"] {
  return { label: query.offers ? "Hide offer events" : "Show offer events", href: nftHref(net.id, id, { offers: !query.offers }) };
}

// ---- The pages ---------------------------------------------------------------------------------------------------------------------------------

/**
 * An NFT's page (spec 4.2) from the outcomes of the loader's calls. A mode that needs an answer it was not given (`index` for the modes of the index, `node` for the owner from the
 * network and the modes from the network) is a bug of the caller and throws. A card whose call was rejected is `null` and has its words in `failures`; the page stands on the others.
 */
export function nftPage(input: NftPageInput): NftPageData {
  const { net, id, query, mode, now } = input;
  const words = nftWords(net.id);
  const local = networkWords(net, words);
  const fromNetwork = mode === "network" || mode === "network-burned";
  const burned = mode === "burned" || mode === "network-burned";
  const index = fromNetwork ? undefined : input.index;
  const node = fromNetwork || mode === "indexed-network-owner" ? input.node : undefined;
  if (!fromNetwork && index === undefined) throw new Error(`nftPage: the ${mode} page needs the index's answer for the NFT`);
  if ((fromNetwork || mode === "indexed-network-owner") && node === undefined) throw new Error(`nftPage: the ${mode} page needs the node's answer for the NFT`);

  // The details and the id's card come from the index when it has the NFT, else from the node.
  const source = index?.nft ?? node!;
  const facts = factsOf(net, id, source);
  const head = headOf(net, id, facts, burned);
  const offers = offersOf(net, words, burned, input.offers, now);
  const history = historyOf(net, words, input.history);
  const failures: NftPageData["failures"] = { ...(offers.failure === undefined ? {} : { offers: offers.failure }), ...(history.failure === undefined ? {} : { history: history.failure }) };

  return {
    mode,
    breadcrumb: head.breadcrumb,
    header: {
      ...head.header,
      owner: ownerLine(mode, index?.nft, node),
      lastSale: index === undefined ? null : lastSaleOf(net, index.nft),
    },
    details: detailRows(net, facts, index === undefined ? null : { nft: index.nft, coverage: index.coverage }),
    idTitle: local.idTitle,
    idCard: idRows(net, id, facts),
    idNote: local.idNote,
    offers: offers.rows,
    offersMore: offers.more,
    offersNote: local.offersNote,
    history: history.rows,
    historyNote: HISTORY_NOTE,
    historyToggle: toggleOf(net, id, query),
    paging: pagingOf(net, id, query, history.next),
    notes: { offers: offers.note, history: history.note },
    empty: emptyOf(words, query, offers.rows, history.rows),
    failures,
    notice: fromNetwork ? NOTICE : null,
    noindex: fromNetwork,
    title: head.title,
    facts: nftFacts(net, id, mode, index, node),
    marker: false,
    back: null,
  };
}

/**
 * A page of the history behind a marker (spec 4.3): the breadcrumb, the header without its owner and last sale, "Back to the NFT" and the history rows, titled "Older history of NFT
 * #4,127". The loader awaits #1 and #4 whole, so there is no failure to tell: a failed call is its 503. The view of offer events (`query.offers`) is kept by Back and by the pager.
 */
export function nftMarkerPage(input: NftMarkerInput): NftPageData {
  const { net, id, query, index } = input;
  const words = nftWords(net.id);
  const local = networkWords(net, words);
  const burned = index.nft.burned;
  const head = headOf(net, id, factsOf(net, id, index.nft), burned);
  const history = historyOf(net, words, fulfilled(input.history));
  return {
    mode: burned ? "burned" : "indexed",
    breadcrumb: head.breadcrumb,
    header: head.header,
    details: [],
    idTitle: "",
    idCard: [],
    idNote: "",
    offers: null,
    offersMore: false,
    offersNote: local.offersNote,
    history: history.rows,
    historyNote: HISTORY_NOTE,
    historyToggle: toggleOf(net, id, query),
    paging: pagingOf(net, id, query, history.next),
    notes: { offers: null, history: history.note },
    empty: emptyOf(words, query, null, history.rows),
    failures: {},
    notice: null,
    noindex: true,
    title: `Older history of ${head.name}`,
    facts: nftFacts(net, id, burned ? "burned" : "indexed", index, undefined),
    marker: true,
    back: { label: `Back to the ${words.token}`, href: nftHref(net.id, id, { offers: query.offers }) },
  };
}

/**
 * What the 404 of an NFT neither the index nor the node has says (`NotFoundData`): the phrase the not-found page writes its sentence round ("We couldn't find NFT 00081388…101F on XRPL";
 * "URIToken" on Xahau; the network's name is the layout's, so the sandbox says "XRPL Testnet"), and the offer of the same search on the other network (`searchOnOther`: "Search on Xahau",
 * `/xahau/search?q={ID}`). `other` is the other network as the environment names it.
 */
export function nftNotFound(net: Pick<NftNet, "id">, id: string, other: NetworkName): { notFound: string; suggestion: { href: string; label: string } } {
  return { notFound: `${nftWords(net.id).token} ${shortNftId(id)}`, suggestion: searchOnOther(id, other) };
}
