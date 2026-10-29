// The traders card of the market pair page as the view builder makes it (`tradersOf`), for the specs of the page and of its merge of a beat that need the card of some accounts with some
// names. Built by the real function, never by hand: the token of the card reads the keys of its bars in order, so a card written another way is another card.

import type { NameMap } from "../../app/domain/names";
import type { ActiveAccounts } from "../../app/server/api-types";
import { pairHead, tradersOf, type LivePairData } from "../../app/server/pair-view";
import { NO_FEATURES } from "../../app/ui/features";

const NETWORK = { id: "xrpl", name: "XRPL", native: "XRP", hasAmm: true, features: NO_FEATURES } as const;

/** The head of XRP / USD (the issuer's `USD`), which the card reads its unit from. */
export const XRP_USD_HEAD = pairHead(NETWORK, { currency: "XRP" }, { currency: "USD", issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq" }, { interval: "1h", trades: null, back: [] });

/** The answer of the traders call for `accounts`, in the order given: the first the largest, each with a trade less than the one before. */
export function activeAccounts(accounts: readonly string[]): ActiveAccounts {
  const side = { base_volume: "0", counter_volume: "0", count: 0 };
  return {
    result: "success",
    count: accounts.length,
    exchanges_count: 9999,
    accounts: accounts.map((account, at) => ({ account, buy: side, sell: side, base_volume: String(1_000_000 - at), counter_volume: "0", count: 100 - at })),
  };
}

/** The card of `accounts` written with `names`, on XRP / USD, the pool left out of none. */
export function tradersCard(accounts: readonly string[], names: NameMap = {}): Extract<LivePairData["traders"], { state: "ok" }> {
  return tradersOf(activeAccounts(accounts), null, { net: NETWORK.id, head: XRP_USD_HEAD, filtered: false, names });
}
