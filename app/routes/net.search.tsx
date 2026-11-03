import { redirect } from "react-router";

import { hashWhat } from "../domain/hash-nouns";
import { mptLink } from "../domain/mpt-link";
import { nftPath } from "../domain/nft-link";
import { poolLink } from "../domain/pool-link";
import { classify } from "../domain/search";
import { parseTokenPath, TOKEN_SEARCH_MAX, tokenHref, tokensHref } from "../domain/token-params";
import { clientsFor } from "../server/clients";
import { cacheClassHeaders, cached, forwardCacheClass } from "../server/edge-cache";
import { getEnv } from "../server/env";
import { upstreamFailure } from "../server/loader-errors";
import { metaContext } from "../server/meta";
import { requireNetwork } from "../server/network-route";
import { networkIdOfCtid, networkOf, type Network, type NetworkId } from "../server/networks";
import { findHash, resolveCtid, type HashQuestions } from "../server/resolve";
import {
  choicePage,
  ctidNotFoundPage,
  hashNotFoundPage,
  helpPage,
  objectMatchHref,
  otherNetworkPage,
  shownQuery,
  type NetworkName,
  type SearchPageData,
} from "../server/search-view";
import { PRODUCT_NAME } from "../ui/brand";
import { choiceTitle } from "../ui/pages/SearchChoicePage";
import { SearchPage } from "../ui/pages/SearchPage";
import { useNetwork } from "../ui/use-network";

import type { Route } from "./+types/net.search";

// The loader names a cache class and throws 404s of class `short`.
export const headers = forwardCacheClass;

/** A redirect to what the search found. Class `short`, like the search pages themselves: a hash may be indexed any second. */
function found(to: string) {
  return redirect(to, { status: 302, headers: cacheClassHeaders("short") });
}

/** A network as a page names it: the environment's own (XRPL Testnet in the sandbox). */
function nameOf(context: Route.LoaderArgs["context"], id: NetworkId): NetworkName {
  return { id, name: networkOf(id, getEnv(context)).name };
}

/** What the token step of the search makes of a text `classify` found nothing in: where to send the visitor, the link to offer with the help text, or nothing. */
type TokenStep = { to: string } | { offer: { href: string; label: string } } | null;

/**
 * The token step (token pages spec 5.3): `typed`, trimmed, read by `parseTokenPath`. A token is its page (`tokenHref`, the canonical spelling) and an LP token its pool (`poolLink`, which is the account
 * page while `AMM_PAGES` is off); any other text, `XRP` alone and a word of a name included, is offered the list searched for it (`tokensHref`), when it is as long as the list takes (1 to `TOKEN_SEARCH_MAX`
 * code points, as the list counts them: a longer one would only get its message). Nothing while `TOKENS` is off.
 */
function tokenStep(network: Network, typed: string): TokenStep {
  if (!network.features.tokens) return null;
  const text = typed.trim();
  const path = parseTokenPath(network, text);
  if (path.kind === "token") return { to: tokenHref(network.id, path.asset) };
  if (path.kind === "lp") return { to: poolLink(network.id, path.issuer, network.features) };
  const length = [...text].length;
  if (length === 0 || length > TOKEN_SEARCH_MAX) return null;
  return { offer: { href: tokensHref(network.id, { q: text }), label: `Look for “${text}” among tokens →` } };
}

/** The answer for a text no step found a place for: the token step's redirect or offer, else the help text, as a 200. It is the last step. */
function unplaced(network: Network, typed: string, query: string) {
  const step = tokenStep(network, typed);
  if (step !== null && "to" in step) return found(step.to);
  return cached(step === null ? helpPage(query) : helpPage(query, step.offer), "short");
}

/**
 * `/{net}/search?q=...` (spec 6): says what the input is (`classify`) and either redirects to the page that shows it or
 * answers with a page of its own. Every answer is class `short`; the pages are `noindex, follow`.
 *
 * - A ledger index (plain, or grouped as the explorer shows it), an address and an X-address (with `?tag=`): a redirect,
 *   without asking anyone.
 * - A hash: the data API is asked for the transaction, the ledger and, while `NFTS` is on, the NFT and, while `LEDGER_OBJECTS` is on, the object (an escrow, a check, a payment channel or a
 *   delegation), and when it has none of them, the node is (spec 10; the NFT by XRPL's `nft_info`, Xahau's URIToken entry; the object by `ledger_entry`). One found: a redirect to it
 *   (`/{net}/nft/{HASH}` for an NFT, whose page shows what only the node has too; an object's page; a delegation's delegator's Delegation tab, or the account page when `DELEGATION` is off or
 *   the delegation is removed: `objectMatchHref`). Two or more: a page with a link to each. None: a 404 that offers the same search on the other network. While `NFTS` or `LEDGER_OBJECTS` is off
 *   its question is not asked (the sequence is `findHash`'s, which E14 extends).
 * - 48 hex digits (E14 spec 8: an MPT issuance ID, in either case, no `0x`): while `MPT` is on a redirect to `/{net}/mpt/{ID}` in capitals (`mptLink`, the one place an inbound MPT link is decided), without
 *   asking anyone and on Xahau too, whose page says MPT is not there; while it is off the text is what it was before E14, one that `classify` found nothing in (the last step, below).
 * - A CTID: of this network, the transaction at its place in the ledger (a redirect, or a 404 if there is none); of the
 *   other network, a page that offers it there; of neither, a 404.
 * - A text none of those is, while `TOKENS` is on (token pages spec 5.3): the text read as the path of a token (`parseTokenPath`: `USD.rvYAf…`, `usd rvYAf…`, `RLUSD+rMxCK…`) is a redirect to the token's page, without a
 *   call (the page answers its own 404, so a token that is not there is no 404 here), and an AMM's LP token to its pool; any other text of 1 to 64 characters gets the link "Look for “…” among tokens →" with the help
 *   text. It is the last step: it runs only when `classify` gave `none`.
 * - Anything else, and every text while `TOKENS` is off: the help text, as a 200.
 * - An upstream failure that leaves the question open is a 503 (`upstreamFailure`), never a "not found" that would be stored.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const network = requireNetwork(context, params);
  const typed = new URL(request.url).searchParams.get("q") ?? "";
  const query = shownQuery(typed);
  const input = classify(typed);
  const other = nameOf(context, network.other);

  switch (input.kind) {
    case "ledger-index":
      return found(`/${network.id}/ledger/${input.index}`);

    case "account":
      return found(`/${network.id}/account/${input.address}${input.tag === undefined ? "" : `?tag=${input.tag}`}`);

    case "hash": {
      const { api, node } = clientsFor(context, network);
      const asked: HashQuestions = { net: network.id, ...network.features };
      let matches;
      try {
        matches = await findHash(api, node, input.hash, asked);
      } catch (err) {
        return upstreamFailure(err, `${hashWhat(asked.net, asked)} ${input.hash}`);
      }
      if ([matches.tx, matches.ledger, matches.nft, matches.object].filter(Boolean).length > 1) return cached(choicePage(input.hash, matches, network), "short");
      if (matches.tx) return found(`/${network.id}/tx/${input.hash}`);
      if (matches.ledger) return found(`/${network.id}/ledger/${input.hash}`);
      if (matches.nft) return found(nftPath(network.id, input.hash));
      if (matches.object) return found(objectMatchHref(network, input.hash, matches.object));
      return cached(hashNotFoundPage(query, input.hash, other, asked), "short", { status: 404 });
    }

    case "ctid": {
      const { api } = clientsFor(context, network);
      let resolved;
      try {
        resolved = await resolveCtid(api, network, input.ctid);
      } catch (err) {
        return upstreamFailure(err, `transaction ${input.ctid}`);
      }
      if (resolved === null) {
        const covered = networkIdOfCtid(input.networkId, network.kind) !== undefined;
        return cached(ctidNotFoundPage(query, input.ctid, input.networkId, covered), "short", { status: 404 });
      }
      if ("hash" in resolved) return found(`/${network.id}/tx/${resolved.hash}`);
      return cached(otherNetworkPage(query, input.ctid, nameOf(context, resolved.otherNetwork)), "short");
    }

    case "mpt": {
      // Null while `MPT` is off: the digits are then a text like any other.
      const to = mptLink(network.id, input.id, network.features);
      return to === null ? unplaced(network, typed, query) : found(to);
    }

    case "none":
      return unplaced(network, typed, query);
  }
}

/** The part of the title that says which of the pages this is. */
function titleOf(data: SearchPageData): string {
  switch (data.kind) {
    case "choice":
      return choiceTitle(data);
    case "help":
      return "Search";
    case "other-network":
      return `CTID on ${data.other.name}`;
    case "not-found":
      return "Not found";
  }
}

/** Search pages are for visitors: out of the index, but their links are followed (spec 9). */
export function meta({ loaderData, params, matches }: Route.MetaArgs) {
  const robots = { name: "robots", content: "noindex, follow" };
  const network = metaContext(params.net, matches)?.network;
  if (!loaderData || !network) return [robots];
  return [{ title: `${titleOf(loaderData)} · ${network.name} · ${PRODUCT_NAME}` }, robots];
}

export default function Search({ loaderData }: Route.ComponentProps) {
  return <SearchPage network={useNetwork()} data={loaderData} />;
}
