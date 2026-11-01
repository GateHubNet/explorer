// What the token routes do with their paths and queries before any call (E11 spec 1.3), and what they say of a token the index does not know. Worker-only code: the token page's route
// and the holders page's both start with `checkTokenRoute` and end a 404 of a missing token with `throwTokenNotFound`, so that the two agree on every answer.

import { redirect } from "react-router";

import { accountHref } from "../domain/account-tabs";
import { formatAmount, formatCurrency, shortAddress } from "../domain/format";
import { poolLink } from "../domain/pool-link";
import { parseTokenPageParams, parseTokenPath, tokenHoldersHref, tokenHref, tokenPageQuery, type TokenPageParams } from "../domain/token-params";
import { coverageNote } from "./coverage";
import type { DataApi } from "./data-api";
import { echoOf } from "./echo";
import { cacheClassHeaders } from "./edge-cache";
import { notFound } from "./loader-errors";
import { isMarker } from "./marker";
import type { Network } from "./networks";
import { redirectToCanonical } from "./pair-route";
import { UpstreamError } from "./upstream";

/** The text of a segment a path holds, percent-decoded; `null` for a malformed escape (the path names nothing). */
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * The first step of the token page's loader (`page` "token") and of its holders' ("holders"): everything a request carries, checked before any call. It throws the 404s of class `short`
 * (`TOKENS` off; a segment that is no asset with an issuer, with `XRP` alone's own note; a marker that is none), and returns the redirect (a response) when the request is not the
 * one canonical URL of its view: an LP token to its pool or, with `AMM_PAGES` off, its account (class `slow`), and another spelling or a made-up query to the canonical URL (`immutable`
 * for the path alone, `short` with the query). Otherwise it returns the token (as the ledger holds its currency) and the view the query names.
 *
 * `segment` is the path's `{token}` piece with its escapes, as the request has it; `request` the raw path and the query with its `?` (or the empty text), as `redirectToCanonical` takes
 * them.
 */
export function checkTokenRoute(
  net: Network,
  request: { path: string; search: string },
  segment: string,
  page: "token" | "holders",
): Response | { asset: { currency: string; issuer: string }; params: TokenPageParams } {
  if (!net.features.tokens) notFound({ notFound: "the token pages" });

  const text = decoded(segment);
  const path = text === null ? ({ kind: "none" } as const) : parseTokenPath(net, text);
  switch (path.kind) {
    case "none":
      return notFound({ notFound: `token ${echoOf(text ?? segment)}` });
    case "native":
      return notFound({ notFound: `token ${echoOf(text ?? segment)}`, note: `${net.native} is ${net.name}'s own currency, not an issued token.` });
    case "lp":
      // A pool account's LP token has no page of its own: its pool does (or its account, while the AMM pages are off).
      return redirect(poolLink(net.id, path.issuer, net.features), { status: 302, headers: cacheClassHeaders("slow") });
    case "token":
      break;
  }

  const params = parseTokenPageParams(new URLSearchParams(request.search));
  // A marker is checked before the redirect, which would otherwise lead to a URL that holds it.
  if (params.marker !== undefined && !isMarker(params.marker)) {
    notFound({ notFound: page === "token" ? `that page of the transfers of ${formatCurrency(path.asset.currency)}` : `that page of the holders of ${formatCurrency(path.asset.currency)}` });
  }
  const canonical = page === "token" ? tokenHref(net.id, path.asset) : tokenHoldersHref(net.id, path.asset);
  const tidied = redirectToCanonical(request, { path: canonical, search: tokenPageQuery(params) });
  return tidied ?? { asset: path.asset, params };
}

/**
 * The 404 of a token D6 does not know ("We couldn't find RLUSD issued by rMxCKb…m5De on XRPL": the page adds the network), with the way to the issuer's account. While D6's coverage is not complete, a token that exists may
 * be missing from its index, so the page says so: the answer to the missing token has no `coverage` (an error answer has none), so it comes from a `limit=1` list call made only here. If
 * that call fails, or its coverage is complete, there is no note. Always throws.
 */
export async function throwTokenNotFound(api: Pick<DataApi, "tokens">, net: Network, asset: { currency: string; issuer: string }): Promise<never> {
  const listed = await api.tokens({ kind: "issued", limit: 1, minHolders: 10 }).catch((err: unknown) => {
    // A failed call says nothing of the index; anything that is not an upstream's failure is a bug.
    if (!(err instanceof UpstreamError)) throw err;
    return null;
  });
  const note = listed === null ? null : coverageNote(listed.coverage, "trust lines");
  return notFound({
    notFound: `${formatCurrency(asset.currency)} issued by ${shortAddress(asset.issuer)}`,
    suggestion: { href: accountHref(net.id, asset.issuer, {}), label: "Open the issuer's account" },
    // The coverage note as the page would draw it (the ledger as `#107,874,617`, a link on the page), in plain text.
    ...(note === null ? {} : { note: `${note.before}${note.ledger === null ? "" : `#${formatAmount(String(note.ledger))}`}${note.after} A token whose trust lines have not changed since is not listed yet.` }),
  });
}
