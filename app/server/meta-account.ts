// The tags of an account (spec 9), with the helpers of meta.ts. Only the account route imports this module (meta.ts says why).

import type { MetaDescriptor } from "react-router";

import { accountHref, type AccountTab } from "../domain/account-tabs";
import { formatAmount, formatUtc, shortAddress } from "../domain/format";
import type { Native } from "../domain/parse/types";
import type { Activation, BalanceView } from "./account-view";
import { absolute, imageUrl, sharing, suffixOf, type MetaContext } from "./meta";

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
 * are not part of it. A page of old history (reached with a marker) is `noindex, follow`, with no canonical URL and nothing to share.
 */
export function accountMeta(account: AccountFacts, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const { address, tab, header } = account;
  const title = `Account ${shortAddress(address)} · ${suffixOf(network)}`;
  const url = absolute(origin, accountHref(network.id, address, { tab }));

  if (header.status === "history") {
    // No canonical URL: Google advises against `noindex` on a page that names another URL as its canonical, and the two disagree.
    return [
      { title },
      { name: "description", content: `Older ${tab} of the account ${address} on ${network.name}.` },
      { name: "robots", content: "noindex, follow" },
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
