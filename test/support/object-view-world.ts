// What the tests of the ledger-object view builders (app/server/{escrow,check,payment-channel,ledger-object}-view.test.ts) share: the Worker's env with every switch on and the two
// networks built from it, a server state with the reserve of the XRP Ledger today, a sentence as the page reads it, and the walk that proves a page holds nothing a stored page cannot.
// Not for `app/`.

import { expect } from "vitest";

import type { Segment } from "../../app/domain/describe";
import { formatAmount, formatCurrency, shortAddress } from "../../app/domain/format";
import type { Env } from "../../app/server/env";
import { networkOf } from "../../app/server/networks";
import type { ServerState } from "../../app/server/node-rpc";
import { allSwitches } from "./switches";

export const env: Env = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("on"),
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};
export const XRPL = networkOf("xrpl", env);
export const XAHAU = networkOf("xahau", env);

/** A server state whose validated ledger has the reserve of the XRP Ledger today: 0.2 XRP per object, in drops. */
export const stateOf = (reserveInc = 200_000): ServerState => ({
  build_version: "2.5.0",
  complete_ledgers: "1-107972102",
  server_state: "full",
  validated_ledger: { base_fee: 10, close_time: 846_000_000, hash: "A".repeat(64), reserve_base: 1_000_000, reserve_inc: reserveInc, seq: 107_972_102 },
});

/** A sentence as the page reads it: an account by its short address, an amount in its grouped digits and currency, a permission by its name. */
export const said = (segments: readonly Segment[]): string =>
  segments
    .map((segment) =>
      segment.t === "text"
        ? segment.v
        : segment.t === "account"
          ? shortAddress(segment.v)
          : segment.t === "amount"
            ? `${formatAmount(segment.value)} ${formatCurrency(segment.currency)}`
            : segment.t === "pool"
              ? segment.pair
              : segment.t === "permission"
                ? segment.name
                : segment.t === "mpt"
                  ? segment.units === undefined
                    ? `MPT ${segment.id.slice(0, 8)}…`
                    : `${formatAmount(segment.units)} units of MPT ${segment.id.slice(0, 8)}…`
                  : segment.v,
    )
    .join("");

/** Every value of the data, with the path it is at; it fails on anything a stored page cannot hold (a class instance, a function). */
export function* walk(value: unknown, path = "page"): Generator<[string, unknown]> {
  if (value === null || typeof value === "string" || typeof value === "boolean") return void (yield [path, value]);
  if (typeof value === "number") return void (yield [path, value]);
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) yield* walk(item, `${path}[${i}]`);
    return;
  }
  expect(Object.getPrototypeOf(value), path).toBe(Object.prototype);
  for (const [key, item] of Object.entries(value as object)) if (item !== undefined) yield* walk(item, `${path}.${key}`);
}
