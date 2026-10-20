// The switches (spec 6.1): one list of every page-level and feature-level switch. Each is a Worker variable, "on" or "off", set per
// environment in wrangler.jsonc (README, "Switches"). Pure, with no React and no server import, so that the Worker, the browser, the
// scripts and the tests all import it. Nothing else lists switch names.
//
// A new switch is appended LAST to `FEATURE_VARS` and to `FEATURE_NAME`, and gets its field in `Env` (app/server/env.ts), an entry in
// every block of wrangler.jsonc and in `TOP_LEVEL_SWITCHES` of vitest.config.ts, and a row in the README.

export const FEATURE_VARS = ["VALIDATORS", "AMM_DATA", "MARKETS"] as const;
export type FeatureVar = (typeof FEATURE_VARS)[number];

/** The name each variable has in `Features`, which components and view builders read. */
export const FEATURE_NAME = {
  VALIDATORS: "validators",
  AMM_DATA: "ammData",
  MARKETS: "markets",
} as const satisfies Record<FeatureVar, string>;
export type Feature = (typeof FEATURE_NAME)[FeatureVar];
export type Features = Readonly<Record<Feature, boolean>>;

/** `vars[name] === "on"` for each switch; anything else, a missing value included, is off. */
export function featuresOf(vars: Readonly<Partial<Record<FeatureVar, unknown>>>): Features {
  return Object.fromEntries(FEATURE_VARS.map((name) => [FEATURE_NAME[name], vars[name] === "on"])) as Features;
}

/** Every switch off: where the layout's data is missing. Frozen, because it is shared. */
export const NO_FEATURES: Features = Object.freeze(featuresOf({}));
