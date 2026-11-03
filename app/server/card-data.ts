// The words and numbers of a link-preview image (spec 9, the LinkPreview board; validators spec 8; AMM spec 5.2; NFT spec 10; token pages spec 7.2; E14 spec 9): a transaction, a ledger, an account, a
// validator, an amendment, an AMM pool, an NFT, an issued token or an MPT, from the same facts the page's tags are made of, so a link's text and its picture never disagree. Pure;
// app/og/card.tsx draws what this returns.

import { describe, headlineAmount, type FlowAmount } from "../domain/describe";
import { formatAmount, shortAddress, shortHash } from "../domain/format";
import { labelWords, plainNameOf, vouchedByOf, type NameView } from "../domain/names";
import type { Native } from "../domain/parse/types";
import { formatDate } from "../domain/time-words";
import type { CardData } from "../og/types";
import type { NetworkBrief } from "../ui/networks";
import type { AmmPoolFacts } from "./amm-view";
import type { AmendmentDetail, NftKind, ValidatorDetail } from "./api-types";
import type { LedgerFacts } from "./meta-ledger";
import { amountText, movement, type TxFacts } from "./meta-transaction";
import type { MptFacts } from "./mpt-view";
import type { Network } from "./networks";
import type { NftFacts } from "./nft-view";
import type { TokenMetaFacts } from "./token-view";
import { plainText, type TransactionPageData, type TransactionSource } from "./transaction-view";
import { amendmentStatusView, count, versionText } from "./validator-facts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/** `15 Jul 2025`, from unix seconds, in UTC. */
function formatCardDate(seconds: number): string {
  const at = new Date(seconds * 1000);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** `17 Oct 2026, 15:42 UTC`, from unix seconds. */
export function formatCardTime(seconds: number): string {
  const at = new Date(seconds * 1000);
  return `${formatCardDate(seconds)}, ${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC`;
}

/** The most characters of a sentence the card says. */
const SENTENCE_MAX = 100;

function clip(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length > max ? `${characters.slice(0, max - 1).join("").trimEnd()}…` : text;
}

const labelOf = (network: NetworkBrief) => network.label;

/** What the card of a transaction reads: the page's own data, and what only the transaction itself says. */
export type TxCardFacts = TxFacts &
  Pick<TransactionPageData, "closeTime" | "account"> & {
    /** The amount that says the most about it (`headlineAmount` of describe/), when it has one. Wins over the ends of the flow. */
    amount?: FlowAmount;
    /** The account it was sent to, for a transaction with no flow (one that failed). */
    destination?: string;
  };

/**
 * The facts a transaction's card reads, from the transaction as the data API or the node gave it: what `describe` makes of it (the page's
 * own title, result, sentence and flow, so the card and the page's tags say the same) and its headline amount. The balance changes, the
 * objects touched and the raw JSON the page also works out are not needed here and are not worked out.
 */
export function transactionFacts(source: TransactionSource, native: Native): TxCardFacts {
  const { tx, meta } = source;
  const description = describe(tx, meta, { native });
  const facts: TxCardFacts = {
    hash: source.hash,
    ledgerIndex: source.ledgerIndex,
    closeTime: source.closeTime,
    title: description.title,
    ok: description.ok,
    summary: plainText(description.sentence),
    flow: description.flow ?? null,
    account: tx.Account,
  };
  const amount = headlineAmount(tx, meta, native);
  if (amount) facts.amount = amount;
  if (typeof tx.Destination === "string" && tx.Destination !== "") facts.destination = tx.Destination;
  return facts;
}

/**
 * The card of a transaction, as the board has it: its kind and result, the amount, who to whom, the ledger and the time, the hash.
 * With no amount the headline is the sentence of the page (which names the accounts, so there is no row of them), and with no flow the
 * accounts are the sender and the destination of the transaction when it names one.
 */
export function transactionCard(tx: TxCardFacts, network: NetworkBrief): CardData {
  const moved = movement(tx.flow);
  const amount = tx.amount ?? moved?.amount;
  const from = moved?.from ?? tx.account;
  const to = moved?.to ?? tx.destination;
  const parties = to === undefined || to === from ? [shortAddress(from)] : [shortAddress(from), shortAddress(to)];

  return {
    network: network.id,
    networkLabel: labelOf(network),
    kind: tx.title,
    status: tx.ok ? "success" : "failed",
    // The sentence names the accounts itself, so it has no row of them under it.
    ...(amount
      ? { headline: { text: amountText(amount), mono: true }, parties }
      : { headline: { text: clip(tx.summary.replace(/\.$/, ""), SENTENCE_MAX), mono: false } }),
    footer: [{ text: "Ledger " }, { text: `#${formatAmount(String(tx.ledgerIndex))}`, mono: true }, { text: ` · ${formatCardTime(tx.closeTime)}` }],
    footerEnd: shortHash(tx.hash),
  };
}

/** The card of a ledger: its index, how many transactions it had and how many failed, when it closed, its hash. */
export function ledgerCard(ledger: LedgerFacts, network: NetworkBrief): CardData {
  const { header, txCount } = ledger;
  const failed = txCount - ledger.succeeded;
  const counted =
    txCount === 0 ? "No transactions" : `${formatAmount(String(txCount))} ${txCount === 1 ? "transaction" : "transactions"}`;
  return {
    network: network.id,
    networkLabel: labelOf(network),
    kind: "Ledger",
    headline: { text: `#${formatAmount(String(header.index))}`, mono: true },
    note: failed > 0 ? `${counted} · ${formatAmount(String(failed))} failed` : counted,
    footer: [{ text: "Closed " }, { text: formatCardTime(header.closeTime) }],
    footerEnd: shortHash(header.hash),
  };
}

/** What the card of an account reads. */
export interface AccountCardFacts {
  address: string;
  native: Native;
  /** Unix seconds; `null` when the index has no record of its creation. */
  activatedAt: number | null;
  /** Whole units of the native currency; `null` when it could not be read. */
  balance: string | null;
  /** What the names batch says of the address (display names spec 3.3), when it says anything: its name, its account network name, its labels. */
  name?: NameView;
}

/**
 * The card of an account: the whole address, when it was activated, its balance. An account with a name a card may say (`plainNameOf`: verified or GateHub's, and unlabelled)
 * has it for the headline, in the text font, with the whole address under it; one without has the address, as it always had. The note (display names spec 7) says, joined by `·`,
 * the parts that apply: a warning that GateHub has labelled the address, who vouches for its name, and when it was activated.
 */
export function accountCard(account: AccountCardFacts, network: NetworkBrief): CardData {
  const { name } = account;
  const plain = plainNameOf(name);
  const card: CardData = {
    network: network.id,
    networkLabel: labelOf(network),
    kind: "Account",
    headline: plain === null ? { text: account.address, mono: true } : { text: plain, mono: false },
    ...(plain === null ? {} : { parties: [account.address] }),
    footer:
      account.balance === null
        ? [{ text: `Account on ${network.name}` }]
        : [{ text: "Balance " }, { text: `${formatAmount(account.balance)} ${account.native}`, mono: true }],
  };
  const note = [
    name && name.labels.length > 0 ? `Warning: labelled ${labelWords(name.labels)} by GateHub` : null,
    vouchedByOf(name),
    account.activatedAt === null ? null : `Activated ${formatCardDate(account.activatedAt)}`,
  ].filter((part): part is string => part !== null);
  if (note.length > 0) card.note = note.join(" · ");
  return card;
}

/** What the cards of a validator and an amendment need of their network: the chrome's id and name, and the software its validators run. */
type SoftwareNetwork = NetworkBrief & { software: Network["software"] };

/** A text that is there: D1 may leave a field out, and an empty text says nothing. */
const given = (text: string | undefined): string | undefined => (text === undefined || text === "" ? undefined : text);

/**
 * The card of a validator (spec 8): its domain, or the short key in mono when it has none; the whole master key under it; and, joined by `·`, the parts of what is known
 * of it that apply: that it is on the default UNL, that its domain is verified, and the software and version it runs (the build number is the page's). The footer is the network.
 */
export function validatorCard(detail: ValidatorDetail, network: SoftwareNetwork): CardData {
  const master = detail.validation_public_key;
  const domain = given(detail.domain);
  const version = versionText(detail, false);
  const parts = [
    detail.unl ? "On the default UNL" : null,
    domain !== undefined && detail.domain_verification?.status === "verified" ? "domain verified" : null,
    version === null ? null : `${network.software} ${version}`,
  ].filter((part): part is string => part !== null);

  const card: CardData = {
    network: network.id,
    networkLabel: labelOf(network),
    kind: "Validator",
    headline: domain !== undefined ? { text: domain, mono: false } : { text: shortHash(master), mono: true },
    parties: [master],
    footer: [{ text: network.name }],
  };
  if (parts.length > 0) card.note = parts.join(" · ");
  return card;
}

/**
 * The words that say where an amendment stands (spec 8), from the same view of its status as the pages. An enabled amendment says the day it was enabled; a retired one that
 * D1 has no enabling for (the ledger does not list it) is "Always on", as the pages say it, and one that has an enabling reads like any enabled amendment. What a status
 * lacks the data for (no majority, no tally, no day) is left out of the sentence, never made up.
 */
function amendmentNote(detail: AmendmentDetail): string {
  const view = amendmentStatusView(detail);
  switch (view.status) {
    case "enabled": {
      const { enabled } = detail;
      if (enabled === undefined) return view.retired ? "Always on" : "Enabled";
      return enabled.date === undefined ? "Enabled" : `Enabled on ${formatDate(enabled.date)}`;
    }
    case "majority": {
      const { majority } = detail;
      return majority === undefined ? "Majority" : `Majority since ${formatDate(majority.since)} · activates on or soon after ${formatDate(majority.expected_activation)}`;
    }
    case "voting": {
      const { votes } = detail;
      return votes === undefined ? "Voting" : `Voting · ${count(votes.yes)} of ${count(votes.trusted)} UNL validators vote yes`;
    }
    case "obsolete":
      return "Obsolete";
    default:
      return "Unknown amendment";
  }
}

/**
 * The card of an amendment (spec 8): its name, or its short ID, in mono; where it stands; its specification and the software version that introduced it (the parts that
 * apply, else the network); and its short ID at the end.
 */
export function amendmentCard(detail: AmendmentDetail, network: SoftwareNetwork): CardData {
  const xls = given(detail.xls);
  const introduced = given(detail.introduced);
  const about = [xls ?? null, introduced === undefined ? null : `introduced in ${network.software} ${introduced}`].filter((part): part is string => part !== null);
  return {
    network: network.id,
    networkLabel: labelOf(network),
    kind: "Amendment",
    headline: { text: detail.name ?? shortHash(detail.id), mono: true },
    note: amendmentNote(detail),
    footer: [{ text: about.length > 0 ? about.join(" · ") : network.name }],
    footerEnd: shortHash(detail.id),
  };
}

/**
 * The card of an AMM pool (AMM spec 5.2), made of the facts the page's tags are (`ammPoolFacts`), so a link's text and its picture agree: the pair in the text font
 * ("XRP / RLUSD": the facts' `text`, never the slug split again, since a code's text may have a "/" of its own), the pool's whole account under it, and, joined by
 * `·`, the value and the trading fee where the facts have them (the note starts with a capital, as every card's does), or "Deleted pool". The footer is the day of the pool's creation, else the network. Every figure is the facts' own text: none is worked out here.
 */
export function poolCard(facts: AmmPoolFacts, network: NetworkBrief): CardData {
  const known = [facts.value === undefined ? null : `Value ${facts.value} ${facts.native}`, facts.fee === undefined ? null : `trading fee ${facts.fee}`].filter(
    (part): part is string => part !== null,
  );
  // Joined, then capitalised, as every card's note starts: "Value 3.61M XRP · trading fee 0.300%", and "Trading fee 0.300%" where the value is not known.
  const joined = known.join(" · ");
  const note = facts.deleted ? "Deleted pool" : `${joined.charAt(0).toUpperCase()}${joined.slice(1)}`;

  const card: CardData = {
    network: network.id,
    networkLabel: labelOf(network),
    kind: "AMM pool",
    headline: { text: facts.text, mono: false },
    parties: [facts.pool],
    footer: [{ text: facts.created === undefined ? `AMM pool on ${network.name}` : `Created ${formatCardDate(facts.created.at)}` }],
  };
  if (note !== "") card.note = note;
  return card;
}

/**
 * What the card of an NFT says, in words: its kind, its headline ("#4,127", or the short id of a token with no serial), its collection's label, its owner (an address; none for a
 * burned NFT and for one whose owner is not known), the note ("Last sale 1,250 XRP", "Burned") and the footer ("Minted 14 Mar 2024"; none where the index does not tell it).
 */
export interface NftCardFacts {
  kind: NftKind;
  headline: string;
  collection: string;
  owner?: string;
  note: string;
  footer?: string;
}

/** A text with its first letter in capitals: "never sold", "sold 3 times". */
const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * The words of an NFT's card from the facts its page's tags are made of (`NftFacts`: a link's text and its picture never disagree). A burned NFT says "Burned", whatever it sold for;
 * one with a price says it ("Last sale 1,250 XRP"); one without says how often it was sold; one shown from the network, which says none of that, says it is not in the index yet.
 * Every figure is the facts' own text: none is worked out here.
 */
export function nftCardFacts(facts: NftFacts): NftCardFacts {
  const note = facts.burned ? "Burned" : facts.lastSale !== undefined ? `Last sale ${facts.lastSale}` : facts.sold !== undefined ? sentence(facts.sold) : "Not in the index yet";
  return {
    kind: facts.kind,
    headline: facts.headline,
    collection: facts.collection,
    ...(facts.owner === undefined ? {} : { owner: facts.owner }),
    note,
    ...(facts.minted === undefined ? {} : { footer: `Minted ${formatCardDate(facts.minted)}` }),
  };
}

/**
 * The card of an NFT (NFT spec 10): the kind ("NFT", "URIToken"), the number in mono, the owner's whole account under it, the note, and the day of the mint (else the network) with the
 * collection at the end of the footer, in mono.
 */
export function nftCard(facts: NftCardFacts, network: NetworkBrief): CardData {
  const kind = facts.kind === "nftoken" ? "NFT" : "URIToken";
  return {
    network: network.id,
    networkLabel: labelOf(network),
    kind,
    headline: { text: facts.headline, mono: true },
    ...(facts.owner === undefined ? {} : { parties: [facts.owner] }),
    note: facts.note,
    footer: [{ text: facts.footer ?? `${kind} on ${network.name}` }],
    footerEnd: facts.collection,
  };
}

/** The most characters of a domain the footer of a token's card says: the issuer writes it, and a longer one would run off the card. */
const DOMAIN_MAX = 50;

/**
 * The most characters of the note of a token's card: it is one line of 34 px between the card's side paddings (1,056 px), and a digit of Geist at that size is 22.9 px wide, so a line
 * of 46 digits is the longest that stays on the card. A supply has no unit above T (`compactNumber`), so one near 1e96 is a line of digits that would run off the edge and push the
 * footer with it. The cut takes the end of the note (the code, which the headline says as well), as the domain's does.
 */
const NOTE_MAX = 46;

/**
 * The card of an issued token (token pages spec 7.2), made of the facts the page's tags are (`tokenFacts`), so a link's text and its picture agree: the kind "Issued token"; the toml's name
 * for the headline in the text font, else the code in mono; the issuer's whole account under it; the note "{holders} holders · supply {supply} {CODE}" ("1 holder" for one); and the footer,
 * "Listed in {domain}'s toml" for a token its issuer's toml lists, else "Issued token on {network}". Every figure is the facts' own text: none is worked out here.
 */
export function tokenCard(facts: TokenMetaFacts, network: NetworkBrief): CardData {
  const holders = facts.holders === "1" ? "1 holder" : `${facts.holders} holders`;
  return {
    network: network.id,
    networkLabel: labelOf(network),
    kind: "Issued token",
    headline: facts.name === undefined ? { text: facts.code, mono: true } : { text: facts.name, mono: false },
    parties: [facts.issuer],
    note: clip(`${holders} · supply ${facts.supply} ${facts.code}`, NOTE_MAX),
    footer: [{ text: facts.listedBy === undefined ? `Issued token on ${network.name}` : `Listed in ${clip(facts.listedBy, DOMAIN_MAX)}'s toml` }],
  };
}

/**
 * The most characters of an MPT's name the note of its card says: the issuer writes up to 128, the note is one line of 34 px between the card's side paddings (1,056 px), and the figures after the name
 * must stay whole, so the name is cut and not the note (the token card's note is cut from its end, which is its code, said by the headline as well).
 */
const MPT_NAME_MAX = 40;

/**
 * The card of an MPT (E14 spec 9), made of the facts the page's tags are (`mptFacts`, whose `card` is the issuer's ticker and name without their bidi controls), so a link's text and its picture agree: the
 * kind "MPT"; the ticker for the big line, in mono as a token's code is, else the start and end of the ID; the issuer under it (its display name when the names say one, else its short address);
 * the note, "{name} · {compact outstanding} {T} outstanding · {n} holders" (without the name when there is none, without the holders for an issuance only the node has, whose amount is in
 * "units" when it has no ticker); and the footer, "Created 9 Oct 2025" when the index knows the day, else "MPT on {network}". The card has no line of its own for the name: it leads the note. Every figure is
 * the facts' own text: none is worked out here.
 */
export function mptCard(facts: MptFacts, network: NetworkBrief): CardData {
  const { card } = facts;
  const holders = card.holders === undefined ? [] : [card.holders === 1 ? "1 holder" : `${formatAmount(String(card.holders))} holders`];
  const figures = [`${card.outstanding} outstanding`, ...holders].join(" · ");
  return {
    network: network.id,
    networkLabel: labelOf(network),
    kind: "MPT",
    headline: { text: card.headline, mono: true },
    parties: [card.issuer],
    note: card.name === undefined ? figures : `${clip(card.name, MPT_NAME_MAX)} · ${figures}`,
    footer: [{ text: card.created === undefined ? `MPT on ${network.name}` : `Created ${formatCardDate(card.created)}` }],
  };
}
