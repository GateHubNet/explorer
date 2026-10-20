// What the pair route does with its path (spec 1.3 and 1.4): the two assets it names and the one canonical path, or "not a pair"; and the
// redirect to the canonical URL. Worker-only code, no I/O: validation and redirects come before any upstream call.

import { redirect } from "react-router";

import { parseAssetText, sameAsset, type Asset, type NativeCode } from "../domain/asset";
import { marketHref } from "../domain/market-pair";
import { cacheClassHeaders } from "./edge-cache";
import type { NetworkId } from "./networks";

export type PairPath =
  | { kind: "pair"; base: Asset; counter: Asset; canonicalPath: string }
  /** `asked` is the decoded `base/counter`, cut to 40 characters: what the not-found page says was looked for. */
  | { kind: "not-a-pair"; asked: string };

/** How much of what was asked the not-found page repeats. */
const ASKED_LENGTH = 40;

/** A text cut to `ASKED_LENGTH` characters, between characters (a surrogate pair is one). */
function cut(text: string): string {
  const characters = [...text];
  return characters.length <= ASKED_LENGTH ? text : characters.slice(0, ASKED_LENGTH).join("");
}

/**
 * The pair a path names. `rawPath` is the path as the request has it (`/xrpl/markets/XRP/USD.rhub…`: percent-escapes kept, the query not
 * in it). The route matched `/:net/markets/:base/:counter`, so what follows the first three parts is the pair; React Router matches
 * `markets` in any case, which the canonical path then corrects. Each of the two segments is decoded and read with `parseAssetText`
 * (which takes `.`, `+`, a space and `|` as the separator); anything that is not exactly two assets of one pair is "not a pair".
 * `canonicalPath` is `marketHref`'s, made from `assetText`: a caller redirects when the request is not that path.
 *
 * The inverted pair is a pair of its own (it is not redirected), and so is a text code in another case (`rlusd` is not `RLUSD`).
 */
export function parsePairPath(network: { id: NetworkId; native: NativeCode }, rawPath: string): PairPath {
  const parts = rawPath.split("/");
  const segments = parts[0] === "" ? parts.slice(3) : [];

  const texts: string[] = [];
  let decodes = true;
  for (const segment of segments) {
    try {
      texts.push(decodeURIComponent(segment));
    } catch {
      // A malformed escape (`%E0%A4%A`): shown as it was written.
      texts.push(segment);
      decodes = false;
    }
  }
  const notAPair: PairPath = { kind: "not-a-pair", asked: cut(texts.join("/")) };

  if (segments.length !== 2 || !decodes) return notAPair;
  const base = parseAssetText(texts[0]!, network);
  const counter = parseAssetText(texts[1]!, network);
  if (base === null || counter === null || sameAsset(base, counter)) return notAPair;
  return { kind: "pair", base, counter, canonicalPath: marketHref(network.id, base, counter) };
}

/** A query as `?…`, or the empty text: the form the parse functions' `canonical` has. */
function withMark(search: string): string {
  return search === "" || search.startsWith("?") ? search : `?${search}`;
}

/**
 * The 302 to `canonical` when the request is not it, else null. `path` is the raw path and `search` the query, each in the form of the
 * canonical one (`parsePairPath`'s `canonicalPath`, `parsePairParams`' `canonical`: the query empty or with its `?`). The redirect goes to
 * both of the canonical ones at once, so one redirect gives the one URL. Its class is `immutable` when only the path differs, and `short`
 * when the query does (with or without the path): a made-up query string is not worth keeping a year.
 */
export function redirectToCanonical(
  request: { path: string; search: string },
  canonical: { path: string; search: string },
): Response | null {
  const asked = withMark(request.search);
  const wanted = withMark(canonical.search);
  if (request.path === canonical.path && asked === wanted) return null;
  return redirect(`${canonical.path}${wanted}`, {
    status: 302,
    headers: cacheClassHeaders(asked === wanted ? "immutable" : "short"),
  });
}
