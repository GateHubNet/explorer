// What the validator page shows for a beat of the live page (display names spec 3.4): the one place the route's merge and the parts it keeps are worked out, apart from the route so
// that a test reads them without the route's loader. Browser code: it imports types of the server's page data (erased) and two pure files, nothing of app/server as a value (the
// route module may not be imported by a Node test, and app/server may not reach the browser).

import { mergeNamesPart } from "../../domain/names";
import type { Anchor } from "../../server/anchor";
import type { ValidatorLiveData } from "../../server/validator-view";
import { keepLoaded } from "../live-page";

/** What the route's loader answers for the live view: the view builder's page, the ledger it was built from and the Worker's build. */
export type ValidatorLoaderData = ValidatorLiveData & { anchor: Anchor; build: string };

/**
 * The parts of the page that a beat may keep when its answer has them failed and the page shows them loaded (`keepLoaded`, validators spec 2.3): VV, S and A, and the names of the
 * accounts the page draws (the loader's names call, display names spec 3.4).
 */
export const VALIDATOR_PARTS = ["recent", "summary", "amendments", "names"] as const;

/**
 * The page to show when the beat's answer `next` is accepted and `shown` is on screen. Each part of `VALIDATOR_PARTS` that `next` has failed and `shown` has loaded is the one shown
 * (`keepLoaded`): the page keeps its names through a failing data API. Then the maps are merged (`mergeNamesPart`): the beat's entry for an account wins, and the accounts that left
 * the page keep theirs for the ones that stay. A beat with the switch off stays off. Everything else is the beat's.
 */
export function mergeValidatorBeat(next: ValidatorLoaderData, shown: ValidatorLoaderData): ValidatorLoaderData {
  const kept = keepLoaded(next, shown, VALIDATOR_PARTS);
  return { ...kept, names: mergeNamesPart(kept.names, shown.names) };
}
