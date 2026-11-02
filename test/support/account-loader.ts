// What the Worker specs of the account page share: the account route's loader run directly, for the specs that read what it hands the page (the header's name, the names parts, a
// list or a card that is still a promise) rather than the HTML (a `.data` body has the streamed parts as promises that `decodeLoaderData` does not decode; the load context is the
// Worker's own, `createLoadContext`, over the Cache API and the upstream mock, with a degraded mark that records each reason), and the made-up account that has what the page
// asks for (`account`, `healthy`). For the Workers runtime: `env` and the Cache API.

import { env } from "cloudflare:workers";
import { encodeAccountID } from "ripple-address-codec";

import { loader } from "../../app/routes/net.account.$address";
import type { AccountPageData } from "../../app/server/account-view";
import { createLoadContext, type Env } from "../../app/server/env";
import { recordingMark } from "./degraded-mark";
import type { Overrides } from "./upstream";

const ORIGIN = "https://explorer.test";

/** A request's `waitUntil`: what the Worker hands it (a subrequest's store) runs on, and is not awaited. */
const executionContext = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

/**
 * The data the account route's loader gives for `path` (`/xrpl/account/r…?tab=…`), with `switches` over the Worker's own, and every reason the request was marked degraded
 * for, in order: a part that streams marks it when it settles, so read `marks` after awaiting it. `path` must be an account page (not a redirect or a 404).
 */
export async function loadAccountPage<T extends AccountPageData>(path: string, switches: Partial<Env> = {}): Promise<{ data: T; marks: string[] }> {
  const { mark, marks } = recordingMark();
  const url = new URL(path, ORIGIN);
  const [, net, , address] = url.pathname.split("/");
  const context = createLoadContext({ ...(env as unknown as Env), ...switches }, executionContext, mark);
  const result = (await loader({ request: new Request(url), params: { net, address }, context } as never)) as { data?: T };
  if (result.data?.kind !== "account") throw new Error(`${path} is not an account page`);
  return { data: result.data, marks };
}

/** A valid address that no recording has: 20 bytes of `n`. Funded in no recording, so every answer about it is the test's. */
export const account = (n: number) => encodeAccountID(new Uint8Array(20).fill(n));

export interface Health {
  /** The account's `account_info` fields over the defaults. */
  info?: Record<string, unknown>;
  /** What the node lists as its objects, and a marker when it has more. */
  objects?: Array<Record<string, unknown>>;
  objectsMarker?: string;
  /** The balances after the native one. */
  tokens?: Array<Record<string, unknown>>;
}

/** The answers of a healthy active account of `address` on the XRP Ledger, except for its lists, which a test adds. */
export function healthy(address: string, health: Health = {}): Overrides {
  const objects = health.objects ?? [];
  return {
    [`GET /v2/accounts/${address}`]: {
      result: "success",
      account_data: { account: address, parent: "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ", initial_balance: "25", inception: "2025-07-15T18:30:43Z", ledger_index: 97500000, tx_hash: "9B".repeat(32) },
    },
    [`GET /v2/accounts/${address}/balances`]: {
      result: "success",
      ledger_index: 107721455,
      limit: 200,
      balances: [{ currency: "XRP", value: "25" }, ...(health.tokens ?? [])],
    },
    [`node account_info ${address}`]: {
      account_data: {
        Account: address,
        Balance: "25000000",
        Flags: 0,
        LedgerEntryType: "AccountRoot",
        OwnerCount: objects.length,
        PreviousTxnID: "C7FE6468BA25CE904C41722C0892316954133B000339C644073A88CACD8A9143",
        PreviousTxnLgrSeq: 107720688,
        Sequence: 12,
        ...health.info,
      },
      ledger_index: 107721455,
      validated: true,
    },
    [`node account_objects ${address}`]: {
      account: address,
      account_objects: objects,
      ledger_index: 107721455,
      validated: true,
      ...(health.objectsMarker ? { marker: health.objectsMarker } : {}),
    },
  };
}
