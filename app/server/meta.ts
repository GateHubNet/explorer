// What the pages say about themselves to search engines and to the chat apps and social sites that unfurl a link (spec 9): a title, a
// description built from the page's data, a canonical URL, and Open Graph and Twitter card tags with the link-preview image. Pure
// functions over the page data and the origin of the request; the routes' `meta` exports call them.
//
// A page's `meta` is part of its route module, so the browser runs these too (a client-side navigation sets the tags of the page it lands
// on): this file imports only light, pure code, and the renderer of the images is not reachable from it (test/unit/og-bundle.test.ts).
//
// This file holds what every page's tags are made with: the context, the absolute URLs and `sharing`, and the one name of each network's DEX,
// which the markets pages' descriptions share. Each page's builder is in a module of its own, `meta-<page>.ts`, which that page's route alone
// imports: a module that every route imports is in a chunk that every page loads, so a builder here would be in every page's JavaScript, with
// what it imports (test/unit/meta-bundle.test.ts).
//
// Nothing here depends on who asks or when: no age, no "n minutes ago". The absolute URLs are on the origin of the request, which
// the `/:net` layout's loader hands to `meta` (the edge cache's key holds the host, so each stored page names its own).

import type { MetaDescriptor } from "react-router";

import { CARD_HEIGHT, CARD_WIDTH } from "../og/types";
import { PRODUCT_NAME } from "../ui/brand";
import { findNetwork, type NetworkBrief } from "../ui/networks";
import { NETWORK_ROUTE_ID } from "../ui/use-network";

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
export type ImageKind = "tx" | "ledger" | "account" | "validator" | "amendment" | "amm";

/** The absolute URL of a path on the origin. */
export function absolute(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/** The absolute URL of the link-preview image of a transaction, ledger, account, validator, amendment or AMM pool. */
export function imageUrl(origin: string, net: string, kind: ImageKind, id: string): string {
  return absolute(origin, `/og/${net}/${kind}/${id}.png`);
}

// ---- The tags -----------------------------------------------------------------------------------------------------------------

export interface Share {
  title: string;
  description: string;
  /** The canonical URL, absolute. */
  url: string;
  /** The link-preview image, when the page has one, with what it shows in words. */
  image?: { url: string; alt: string };
}

/** The tags of an indexable page: the title, the description, the canonical URL, Open Graph and the Twitter card. */
export function sharing(share: Share): MetaDescriptor[] {
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

/** The end of the title of a page of one object: `XRPL · explorer`. */
export const suffixOf = (network: NetworkBrief) => `${network.name} · ${PRODUCT_NAME}`;

/** The DEX of each network, as the descriptions of the markets page and the market pair page name it. */
export const DEX_NAMES = { xrpl: "the XRP Ledger DEX", xahau: "the Xahau DEX" } as const satisfies Record<NetworkBrief["id"], string>;
