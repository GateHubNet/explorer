// What the market pair page shows for a beat of the live page (display names spec 3.4): the one place the route's merge and the parts it keeps are worked out, apart from the route so
// that the view builder's test and the page's own read them without the route's loader. Browser code: it imports types of the server's page data (erased) and two pure files,
// nothing of app/server as a value (the route module may not be imported by a Node test, and app/server may not reach the browser).

import { tokenOf } from "../../domain/fnv";
import { listedAccount } from "../../domain/listed-account";
import { mergeNamesPart, type NameMap } from "../../domain/names";
import type { LivePairData, PairPageData } from "../../server/pair-view";
import { keepLoaded } from "../live-page";

/**
 * The parts of the page's data that a beat may keep when its answer has them failed and the page shows them loaded (`keepLoaded`, markets spec 3.10), each one call or chain: the
 * 24 h figures (#3), the candles (#4), the traders (#5), the order book (#6 and #7, one part: half a book is never shown), the pool (#8) and its share (#9), and the names of the
 * accounts the page draws (the loader's names call, display names spec 3.4). The trades and the price are #2's, without which there is no answer to keep anything from.
 */
export const PAIR_PARTS = ["stats", "candles", "traders", "book", "pool", "share", "names"] as const;

/**
 * The page to show when the beat's answer `next` is accepted and `shown` is on screen. Each part of `PAIR_PARTS` that `next` has failed and `shown` has loaded is the one shown
 * (`keepLoaded`): the page keeps its names through a failing data API, and the accounts that are new to the page are their short addresses until a beat has their names. Then the
 * maps are merged (`mergeNamesPart`): the beat's entry for an address wins, and the accounts that left the page keep theirs for the ones that stay. A beat with the switch off stays
 * off. Everything else is the beat's. A page behind a marker never shows itself here, and neither page being a live one leaves the beat as it is.
 *
 * The traders' bars are written by the view builder with the names it had, so a beat whose names call failed has them without names while the links of the trades keep theirs: the bars
 * are written again with the merged names (`namedTraders`).
 */
export function mergePairBeat(next: PairPageData, shown: PairPageData): PairPageData {
  if (next.mode !== "live" || shown.mode !== "live") return next;
  const kept = keepLoaded(next, shown, PAIR_PARTS);
  const names = mergeNamesPart(kept.names, shown.names);
  return { ...kept, names, traders: namedTraders(kept.traders, names.map) };
}

/**
 * The traders card with each bar written through `listedAccount` with `names` (what `tradersOf` does with the names it is given): the bars whose label, sublabel or mark changes, and the token
 * that says so. The card itself when no bar changes, and a card that could not be loaded.
 */
function namedTraders(traders: LivePairData["traders"], names: NameMap): LivePairData["traders"] {
  if (traders.state !== "ok") return traders;
  // In the order `tradersOf` writes a bar in (the token reads the keys in order): the id, what `listedAccount` says of the account, then the rest.
  const items = traders.data.items.map(({ id, label: _label, sublabel: _sublabel, mark: _mark, ...rest }) => ({ id, ...listedAccount(id, names), ...rest }));
  const { format } = traders.data;
  const token = tokenOf({ items, format });
  return token === traders.data.token ? traders : { ...traders, data: { items, format, token } };
}
