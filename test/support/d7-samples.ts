// Small, valid answers of D7's two routes (the supply of the native currency: the snapshot, and Xahau's minting per day) for the tests of the client (test/worker/data-api.spec.ts), of its shape
// checks (app/server/supply-shape.test.ts) and of the supply page. The values are the examples of the sections `GET /v2/network/supply` and `GET /v2/network/supply/minted` of data-api's
// docs/api-reference.md (`feat/explorer-data-2` at 31e97efaa1a6e098435b666e8893c79a0c4bee66), key order included: the XRPL one is read over a history from ledger 28,685,313 (the escrows and
// the AMM pools complete, the reserves, which start at the first ledger, not), the Xahau one over a history from ledger 1. Not the older example of D7's design spec §5.1, whose coverages
// "cannot occur together" (reserves starting above escrowed) and which the built reference replaces. Each sample is `(over?) => T`: a new object on every call, with a shallow override. A test that
// needs a case the sample does not have builds it from the sample (`delete` a key for the one D7 leaves out).
//
// Not for `app/`, and not the fixtures of the e2e suite (scripts/ makes those). The types are api-types.ts's, so that a sample that stopped being what the reference promises, or a type that did,
// fails `pnpm typecheck`.

import type { MintedPage, NetworkSupply } from "../../app/server/api-types";

/** `GET /v2/network/supply` on the XRP Ledger or on Xahau, as the reference gives it. */
export function supplySample(net: "xrpl" | "xahau", over: Partial<NetworkSupply> = {}): NetworkSupply {
  return { ...(net === "xrpl" ? XRPL : XAHAU)(), ...over };
}

const XRPL = (): NetworkSupply => ({
  result: "success",
  ledger_index: 107747456,
  close_time: "2026-10-24T21:00:00Z",
  computed_at: "2026-10-24T21:01:47Z",
  currency: "XRP",
  total: "99985312374.716318",
  burned: { amount: "14687625.283682" },
  escrowed: { amount: "35212847105.402318", escrows: 12879, coverage: { from_ledger_index: 28685313, complete: true } },
  circulating: { amount: "64772465269.314", coverage: { from_ledger_index: 28685313, complete: true } },
  amm: { amount: "46218377.402915", pools: 14594, coverage: { from_ledger_index: 28685313, complete: true } },
  reserves: { amount: "9810004", accounts: 6410280, owner_count: 16998620, base: "1", increment: "0.2", coverage: { from_ledger_index: 28685313, complete: false } },
});

const XAHAU = (): NetworkSupply => ({
  result: "success",
  ledger_index: 26603520,
  close_time: "2026-10-24T21:00:02Z",
  computed_at: "2026-10-24T21:00:31Z",
  currency: "XAH",
  total: "613401782.117306",
  burned: { amount: "2318.640227", coverage: { from_ledger_index: 1, complete: true } },
  minted: {
    amount: "49425551.616207",
    rewards: "41203318.512207",
    import: "8102233.104",
    genesis_mint: "120000",
    coverage: { from_ledger_index: 1, complete: true },
  },
  escrowed: { amount: "18406227.318004", escrows: 2140, coverage: { from_ledger_index: 1, complete: true } },
  circulating: { amount: "594995554.799302", coverage: { from_ledger_index: 1, complete: true } },
  reserves: { amount: "268973.2", accounts: 186412, owner_count: 412806, base: "1", increment: "0.2", coverage: { from_ledger_index: 1, complete: true } },
});

/** `GET /v2/network/supply/minted?limit=3` on Xahau: three of five days, so with a `marker`. */
export function mintedPageSample(over: Partial<MintedPage> = {}): MintedPage {
  return {
    result: "success",
    coverage: { from_ledger_index: 1, complete: true },
    marker: "WzE3OTI2MjcyMDBd",
    count: 3,
    rows: [
      { date: "2026-10-20T00:00:00Z", amount: "3.75", rewards: "1.75", import: "2", genesis_mint: "0" },
      { date: "2026-10-21T00:00:00Z", amount: "0", rewards: "0", import: "0", genesis_mint: "0" },
      { date: "2026-10-22T00:00:00Z", amount: "6", rewards: "0", import: "0", genesis_mint: "6" },
    ],
    ...over,
  };
}
