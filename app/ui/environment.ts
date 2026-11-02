// Which environment this deployment is, and which kind of network it shows (sandbox spec 1, 6). Pure, with no imports, so that the Worker, the
// browser, the scripts and the tests all import it. The Worker reads `ENVIRONMENT` through `environmentOf` (app/server/env.ts types it, the
// predeploy guard makes a deployed build hold the exact value), and the browser gets the result in the root's loader data (app/root.tsx).

export type Environment = "development" | "sandbox" | "production";
export type NetworkKind = "mainnet" | "testnet";

/** Anything but "sandbox" or "production" is development: a deployed build has the exact value (the predeploy guard), so a typo can only be local. */
export function environmentOf(value: unknown): Environment {
  return value === "sandbox" || value === "production" ? value : "development";
}

/** The sandbox shows the testnets; development and production the mainnets. */
export function networkKindOf(environment: Environment): NetworkKind {
  return environment === "sandbox" ? "testnet" : "mainnet";
}
