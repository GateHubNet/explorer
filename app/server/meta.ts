// What the pages say about themselves to search engines and to the chat apps and social sites that unfurl a link (spec 9): a title, a
// description built from the page's data, a canonical URL, and Open Graph and Twitter card tags with the link-preview image. Pure
// functions over the page data and the origin of the request; the routes' `meta` exports call them.
//
// A page's `meta` is part of its route module, so the browser runs these too (a client-side navigation sets the tags of the page it lands
// on): this file imports only light, pure code, and the renderer of the images is not reachable from it (test/unit/og-bundle.test.ts).
//
// Nothing here depends on who asks or when: no age, no "n minutes ago". The absolute URLs are on the origin of the request, which
// the `/:net` layout's loader hands to `meta` (the edge cache's key holds the host, so each stored page names its own).

import type { MetaDescriptor } from "react-router";

import { accountHref, type AccountTab } from "../domain/account-tabs";
import type { FlowAmount, FlowStep } from "../domain/describe";
import { formatAmount, formatCurrency, formatUtc, shortAddress, shortHash } from "../domain/format";
import type { Native } from "../domain/parse/types";
import { CARD_HEIGHT, CARD_WIDTH } from "../og/types";
import { PRODUCT_NAME } from "../ui/brand";
import { findNetwork, type NetworkBrief } from "../ui/networks";
import { NETWORK_ROUTE_ID } from "../ui/use-network";
import type { Activation, BalanceView } from "./account-view";
import type { LedgerPageData } from "./ledger-view";
import type { TransactionPageData } from "./transaction-view";

/** What every builder needs besides the page's data: the network, and the origin of the request (`https://host`, no slash at the end). */
export interface MetaContext {
  network: NetworkBrief;
  origin: string;
}

/**
 * The context of a page's tags from what `meta` is given: the `:net` segment, and the matches of the route, among which the `/:net` layout
 * carries the origin of the request (its loader reads it; `meta` has no request). `undefined` when either is missing: the page has no
 * network, or no layout above it, and says nothing.
 */
export function metaContext(
  net: string | undefined,
  matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined>,
): MetaContext | undefined {
  const network = findNetwork(net);
  const layout = matches.find((match) => match?.id === NETWORK_ROUTE_ID)?.loaderData as { origin?: unknown } | undefined;
  return network && typeof layout?.origin === "string" ? { network, origin: layout.origin } : undefined;
}

/** The kinds of object that have a link-preview image (`/og/{net}/{kind}/{id}.png`). */
export type ImageKind = "tx" | "ledger" | "account";

/** The absolute URL of a path on the origin. */
function absolute(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/** The absolute URL of the link-preview image of a transaction, ledger or account. */
export function imageUrl(origin: string, net: string, kind: ImageKind, id: string): string {
  return absolute(origin, `/og/${net}/${kind}/${id}.png`);
}

// ---- The tags -----------------------------------------------------------------------------------------------------------------

interface Share {
  title: string;
  description: string;
  /** The canonical URL, absolute. */
  url: string;
  /** The link-preview image, when the page has one, with what it shows in words. */
  image?: { url: string; alt: string };
}

/** The tags of an indexable page: the title, the description, the canonical URL, Open Graph and the Twitter card. */
function sharing(share: Share): MetaDescriptor[] {
  const { title, description, url, image } = share;
  const tags: MetaDescriptor[] = [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: PRODUCT_NAME },
  ];
  if (image) {
    tags.push(
      { property: "og:image", content: image.url },
      { property: "og:image:width", content: String(CARD_WIDTH) },
      { property: "og:image:height", content: String(CARD_HEIGHT) },
      { property: "og:image:alt", content: image.alt },
    );
  }
  tags.push(
    { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  );
  if (image) {
    tags.push({ name: "twitter:image", content: image.url }, { name: "twitter:image:alt", content: image.alt });
  }
  return tags;
}

const suffixOf = (network: NetworkBrief) => `${network.name} · ${PRODUCT_NAME}`;

// ---- Home -------------------------------------------------------------------------------------------------------------------------

/**
 * The tags of `/{net}`. `heading` is the page's own title (`Explore the XRP Ledger`). The description does not name the newest ledger:
 * it would change every few seconds and say nothing about the page. There is no image: the card is of a transaction, a ledger or an
 * account, and the home page is none of them.
 */
export function homeMeta(heading: string, ctx: MetaContext): MetaDescriptor[] {
  return sharing({
    title: `${heading} · ${PRODUCT_NAME}`,
    description: `Look up any ledger, transaction or account on ${ctx.network.name} from validated history.`,
    url: absolute(ctx.origin, `/${ctx.network.id}`),
  });
}

// ---- A transaction ------------------------------------------------------------------------------------------------------------------

/** What the description of a transaction reads: the page's own data, which the image route also has. */
export type TxFacts = Pick<TransactionPageData, "hash" | "ledgerIndex" | "title" | "ok" | "summary" | "flow">;

function amountText(amount: FlowAmount): string {
  return `${formatAmount(amount.value)} ${formatCurrency(amount.currency)}`;
}

/** Who sent what to whom, from the flow: the sender, the destination and what the destination got. */
export function movement(flow: readonly FlowStep[] | null): { from: string; to: string; amount: FlowAmount } | undefined {
  const sender = flow?.[0];
  const destination = flow?.at(-1);
  if (sender?.role !== "sender" || destination?.role !== "destination" || destination.amount === undefined) return undefined;
  return { from: sender.account, to: destination.account, amount: destination.amount };
}

/**
 * `Payment of 1,250.00 USD from rJF2Xa…FQvg to rNYbL8…UKq5 · XRPL ledger 107,695,660`. That is what a transaction that moved something from
 * one account to another says; any other (a failure, which moved nothing; an offer; a swap, which is a payment to oneself) says the
 * sentence of its page, which has more to say, and then where it is.
 */
export function transactionDescription(tx: TxFacts, network: NetworkBrief): string {
  const where = `${network.name} ledger ${formatAmount(String(tx.ledgerIndex))}`;
  const moved = tx.ok ? movement(tx.flow) : undefined;
  if (moved && moved.from !== moved.to) {
    return `${tx.title} of ${amountText(moved.amount)} from ${shortAddress(moved.from)} to ${shortAddress(moved.to)} · ${where}`;
  }
  return `${tx.summary.replace(/\.$/, "")} · ${where}`;
}

/** The tags of `/{net}/tx/{hash}`. */
export function transactionMeta(tx: TxFacts, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const title = `${tx.title} ${shortHash(tx.hash)} · ${suffixOf(network)}`;
  return sharing({
    title,
    description: transactionDescription(tx, network),
    url: absolute(origin, `/${network.id}/tx/${tx.hash}`),
    image: { url: imageUrl(origin, network.id, "tx", tx.hash), alt: `${tx.title} ${shortHash(tx.hash)} on ${network.name}` },
  });
}

// ---- A ledger -------------------------------------------------------------------------------------------------------------------------

/** What the tags of a ledger read. */
export interface LedgerFacts {
  header: Pick<LedgerPageData["header"], "index" | "hash" | "closeTime">;
  txCount: number;
  succeeded: number;
}

/**
 * The tags of `/{net}/ledger/{index|hash}`. A ledger has one canonical URL, the index's, and one image, whichever of the two the page
 * was reached by.
 */
export function ledgerMeta(ledger: LedgerFacts, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const index = formatAmount(String(ledger.header.index));
  const transactions = `${formatAmount(String(ledger.txCount))} ${ledger.txCount === 1 ? "transaction" : "transactions"}`;
  return sharing({
    title: `Ledger #${index} · ${suffixOf(network)}`,
    description: `Ledger ${index} on ${network.name} closed ${formatUtc(ledger.header.closeTime)} with ${transactions}.`,
    url: absolute(origin, `/${network.id}/ledger/${ledger.header.index}`),
    image: { url: imageUrl(origin, network.id, "ledger", String(ledger.header.index)), alt: `Ledger #${index} on ${network.name}` },
  });
}

// ---- An account -----------------------------------------------------------------------------------------------------------------------

/** What the tags of an account read. */
export interface AccountFacts {
  address: string;
  native: Native;
  tab: AccountTab;
  header:
    | { status: "history" }
    | { status: "active" | "deleted"; activation: Pick<Activation, "time"> | null; balance: Pick<BalanceView, "native"> | null };
}

/**
 * The tags of `/{net}/account/{address}`. The canonical URL names the tab unless it is the first one; `tag` and every other parameter
 * are not part of it. A page of old history (reached with a marker) is `noindex, follow` with the first page of its tab as its canonical
 * URL, and has nothing to share.
 */
export function accountMeta(account: AccountFacts, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const { address, tab, header } = account;
  const title = `Account ${shortAddress(address)} · ${suffixOf(network)}`;
  const url = absolute(origin, accountHref(network.id, address, { tab }));

  if (header.status === "history") {
    return [
      { title },
      { name: "description", content: `Older ${tab} of the account ${address} on ${network.name}.` },
      { name: "robots", content: "noindex, follow" },
      { tagName: "link", rel: "canonical", href: url },
    ];
  }

  const { balance, activation } = header;
  const facts = [
    header.status === "deleted" ? "Deleted account" : balance ? `Balance ${formatAmount(balance.native)} ${account.native}` : null,
    activation ? `activated ${formatUtc(activation.time).slice(0, 10)}` : null,
  ].filter(Boolean);
  return sharing({
    title,
    description: `${address} on ${network.name}${facts.length > 0 ? `: ${facts.join(", ")}` : ""}. Transactions, payments, trades, offers and objects.`,
    url,
    image: { url: imageUrl(origin, network.id, "account", address), alt: `Account ${shortAddress(address)} on ${network.name}` },
  });
}
