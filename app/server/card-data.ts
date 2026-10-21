// The words and numbers of a link-preview image (spec 9, the LinkPreview board; validators spec 8): a transaction, a ledger, an account, a
// validator or an amendment, from the same facts the page's tags are made of, so a link's text and its picture never disagree. Pure;
// app/og/card.tsx draws what this returns.

import { describe, headlineAmount, type FlowAmount } from "../domain/describe";
import { formatAmount, formatCurrency, shortAddress, shortHash } from "../domain/format";
import type { Native } from "../domain/parse/types";
import { formatDate } from "../domain/time-words";
import type { CardData } from "../og/types";
import type { NetworkBrief } from "../ui/networks";
import type { AmendmentDetail, ValidatorDetail } from "./api-types";
import type { LedgerFacts } from "./meta-ledger";
import { movement, type TxFacts } from "./meta-transaction";
import type { Network } from "./networks";
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

const labelOf = (network: NetworkBrief) => `${network.name} mainnet`;
const amountText = (amount: FlowAmount) => `${formatAmount(amount.value)} ${formatCurrency(amount.currency)}`;

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
}

/** The card of an account: the whole address, when it was activated, its balance. */
export function accountCard(account: AccountCardFacts, network: NetworkBrief): CardData {
  const card: CardData = {
    network: network.id,
    networkLabel: labelOf(network),
    kind: "Account",
    headline: { text: account.address, mono: true },
    footer:
      account.balance === null
        ? [{ text: `Account on ${network.name}` }]
        : [{ text: "Balance " }, { text: `${formatAmount(account.balance)} ${account.native}`, mono: true }],
  };
  if (account.activatedAt !== null) card.note = `Activated ${formatCardDate(account.activatedAt)}`;
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
