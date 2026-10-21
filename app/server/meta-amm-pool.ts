// The tags of an AMM pool's page (AMM spec 5.1), with the helpers of meta.ts. Only the pool's route imports this module (meta.ts says why). Like
// meta.ts, it runs in the browser too: it value-imports nothing of app/server but ./meta (test/unit/meta-bundle.test.ts); the facts it reads
// (`AmmPoolMeta`) were written by the view builder, whose types alone it imports.

import type { MetaDescriptor } from "react-router";

import { ammPoolHref, type AmmPeriod, type AmmTab } from "../domain/amm-params";
import { shortAddress } from "../domain/format";
import type { AmmPoolMeta } from "./amm-view";
import { absolute, imageUrl, sharing, suffixOf, type MetaContext } from "./meta";

/** What a tab adds to the title (the first tab adds nothing). */
const TAB_TITLES: Record<AmmTab, string | null> = { swaps: null, liquidity: "liquidity", governance: "votes and bids" };

/** What a period adds to the title (the default period adds nothing). */
const PERIOD_TITLES: Record<AmmPeriod, string | null> = { "30d": "last 30 days", "90d": null, "1y": "last year" };

/** The rows of each tab, as the title of a page of older rows names them. */
const OLDER_ROWS: Record<AmmTab, string> = { swaps: "swaps", liquidity: "liquidity events", governance: "votes and bids" };

/** What the tags of a page that is not for a search engine are: its title, its description and `robots`. */
const unshared = (title: string, description: string, robots: string): MetaDescriptor[] => [
  { title },
  { name: "description", content: description },
  { name: "robots", content: robots },
];

/**
 * The tags of `/{net}/amm/{pool}` (spec 5.1), from the facts the view builder wrote (`AmmPoolPageData.meta`, `AmmHistoryPageData.meta`).
 *
 * - The title is the pair's pool ("XRP/RLUSD AMM pool", "(deleted)" after "pool" for a deleted one), then the tab when it is not the first ("· liquidity",
 *   "· votes and bids") and the period when it is not the default ("· last 30 days", "· last year"). Behind a marker it is the tab's older rows: "Older swaps
 *   of the XRP/RLUSD AMM pool".
 * - The description names the pair, the network and the pool's short account, then the trading fee and the day of the creation where the page has them (a
 *   fact it lacks is left out with its words). It has no figure that changes with each swap.
 * - The first page at the default period is indexable: the canonical URL names the tab unless it is the first one (as the account page's), with the
 *   link-preview image (`/og/{net}/amm/{pool}.png`) and a large card. A pool shown from the network is a stand-in for 60 s: `noindex`, no canonical URL and
 *   nothing to share. Another period and a page behind a marker are `noindex, follow`, with no canonical URL and no Open Graph or card tags.
 */
export function ammPoolMeta(facts: AmmPoolMeta, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const { pool, pair, deleted, fee, created, tab, period, marker, mode } = facts;
  const suffix = suffixOf(network);
  const name = `${pair} AMM pool${deleted ? " (deleted)" : ""}`;
  const said = [fee === undefined ? null : `trading fee ${fee}`, created === undefined ? null : `created ${created.date}`].filter((fact) => fact !== null);
  const description = `${name} on ${network.name}, account ${shortAddress(pool)}${said.length > 0 ? `: ${said.join(", ")}` : ""}. Reserves, price, swaps, liquidity and votes.`;

  if (marker) {
    return unshared(`Older ${OLDER_ROWS[tab]} of the ${name} · ${suffix}`, `Older ${OLDER_ROWS[tab]} of the ${name} on ${network.name}, account ${shortAddress(pool)}.`, "noindex, follow");
  }

  const title = [name, TAB_TITLES[tab], PERIOD_TITLES[period], suffix].filter((part) => part !== null).join(" · ");
  if (mode === "network") return unshared(title, description, "noindex");
  if (PERIOD_TITLES[period] !== null) return unshared(title, description, "noindex, follow");
  return sharing({
    title,
    description,
    url: absolute(origin, ammPoolHref(network.id, pool, { tab })),
    image: { url: imageUrl(origin, network.id, "amm", pool), alt: `${name} on ${network.name}` },
  });
}
