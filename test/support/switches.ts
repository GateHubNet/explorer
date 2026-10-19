// The switches as the tests set them (spec 6.1): every name of `FEATURE_VARS` at one value. A hand-built `Env` takes
// `...allSwitches("off")`, so that a switch added to the list needs no edit in it. Imports only app/ui/features.ts, which is pure,
// so that the Node tests of scripts/ can use it too.

import { FEATURE_VARS, type FeatureVar } from "../../app/ui/features";

export function allSwitches(value: "on" | "off"): Record<FeatureVar, "on" | "off"> {
  return Object.fromEntries(FEATURE_VARS.map((name) => [name, value])) as Record<FeatureVar, "on" | "off">;
}
