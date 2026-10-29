// The tags of an account (spec 9), with the helpers of meta.ts. Only the account route imports this module (meta.ts says why).

import type { MetaDescriptor } from "react-router";

import { accountHref, type AccountTab } from "../domain/account-tabs";
import { ANALYTICS_META, type AnalyticsPeriod } from "../domain/analytics-params";
import { formatAmount, formatUtc, shortAddress } from "../domain/format";
import { labelWords, plainNameOf, vouchedByOf, type NamesPart } from "../domain/names";
import { nftWords } from "../domain/nft-params";
import type { Native } from "../domain/parse/types";
import type { Activation, BalanceView } from "./account-view";
import { absolute, imageUrl, sharing, suffixOf, type MetaContext } from "./meta";

/** What the tags of an account read. */
export interface AccountFacts {
  address: string;
  native: Native;
  tab: AccountTab;
  /** Present on the Analytics tab's data (its view), which is the only page that has it. */
  analytics?: { period: AnalyticsPeriod };
  /** The names of the page's accounts (the header's call): the account's own entry says what its title, description and card say of it (display names spec 7). */
  names: Pick<NamesPart, "map">;
  header:
    | { status: "history" }
    | { status: "active" | "deleted"; activation: Pick<Activation, "time"> | null; balance: Pick<BalanceView, "native"> | null };
}

/**
 * The tags of `/{net}/account/{address}`. The canonical URL names the tab unless it is the first one; `tag` and every other parameter
 * are not part of it. A page of old history (reached with a marker) is `noindex, follow`, with no canonical URL and nothing to share, and
 * so is a view of the Analytics tab (spec 4): a title per period, a description with no figures.
 *
 * The account's own entry in `names` (display names spec 7) puts its name in every title, ahead of the short address, when it is one a title may say (`plainNameOf`: verified or
 * GateHub's, and unlabelled); and in the description of the page that is shared, which says in words that GateHub has labelled the address, before today's, and who vouches for its
 * name, after it. The descriptions of the pages that are not (older history, Analytics) and every other page's title are as they were: they are shared out of context.
 */
export function accountMeta(account: AccountFacts, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const { address, tab, header, analytics } = account;
  const view = account.names.map[address];
  const plain = plainNameOf(view);
  const title = `Account ${plain === null ? shortAddress(address) : `${plain} (${shortAddress(address)})`} · ${suffixOf(network)}`;

  if (analytics) {
    const period = ANALYTICS_META[analytics.period];
    return [
      { title: `Analytics${period ? `, ${period}` : ""} · ${title}` },
      { name: "description", content: `Account value, transactions sent, balances, money in and out, counterparties and DEX trading of ${address} on ${network.name}.` },
      { name: "robots", content: "noindex, follow" },
    ];
  }

  const url = absolute(origin, accountHref(network.id, address, { tab }));

  if (header.status === "history") {
    // No canonical URL: Google advises against `noindex` on a page that names another URL as its canonical, and the two disagree.
    return [
      { title },
      // The NFTs tab says its network's word for them (`NFTs`, `URITokens`), as the tab's label does.
      { name: "description", content: `Older ${tab === "nfts" ? nftWords(network.id).tokens : tab} of the account ${address} on ${network.name}.` },
      { name: "robots", content: "noindex, follow" },
    ];
  }

  const { balance, activation } = header;
  const facts = [
    header.status === "deleted" ? "Deleted account" : balance ? `Balance ${formatAmount(balance.native)} ${account.native}` : null,
    activation ? `activated ${formatUtc(activation.time).slice(0, 10)}` : null,
  ].filter(Boolean);
  const labelled = view && view.labels.length > 0 ? `GateHub has labelled this address ${labelWords(view.labels)}. ` : "";
  const vouched = vouchedByOf(view);
  return sharing({
    title,
    description: `${labelled}${address} on ${network.name}${facts.length > 0 ? `: ${facts.join(", ")}` : ""}. Transactions, payments, trades, offers and objects.${vouched === null ? "" : ` ${vouched}.`}`,
    url,
    image: { url: imageUrl(origin, network.id, "account", address), alt: `Account ${shortAddress(address)} on ${network.name}` },
  });
}
