// What the home page shows for a beat of the live page (display names spec 3.4): the one place the route's merge is worked out, apart from the route so that a test reads it without
// the route's loader. Browser code: it imports types of the server's page data (erased) and two pure files, nothing of app/server as a value.

import { mergeNamesPart } from "../../domain/names";
import type { HomeLoaderData } from "../../server/home-view";
import { keepLoaded } from "../live-page";

/**
 * The page to show when the beat's answer `next` is accepted and `shown` is on screen. A beat whose names call failed (`names` is `failed`) keeps the names part that is shown, unless
 * that one is `failed` too (`keepLoaded`): the page keeps its names through a failing data API, and the rows that are new to the page are their short addresses until a beat has their
 * names. Then the maps are merged (`mergeNamesPart`): the beat's entry for an address wins, and the rows that left the page keep theirs for the rows that stay. A beat with the switch off
 * stays off (`mergeNamesPart` leaves it as it is). Everything but the names is the beat's.
 */
export function mergeHomeBeat(next: HomeLoaderData, shown: HomeLoaderData): HomeLoaderData {
  const kept = keepLoaded(next, shown, ["names"]);
  return { ...kept, names: mergeNamesPart(kept.names, shown.names) };
}
