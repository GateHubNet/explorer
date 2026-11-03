// What the MPT routes do with a request before any call (E14 spec 1.3), and where an issuance is read from (spec 3.2). Worker-only code: the MPT page's route, its holders' and its transfers'
// start with `checkMptRequest`, and read the issuance with `loadMptSource`, so that the three agree on every answer.

import { isMptId, mptPath } from "../domain/mpt";
import type { Features } from "../ui/features";
import type { MptIssuanceAnswer } from "./api-types";
import type { DataApi } from "./data-api";
import type { Network } from "./networks";
import type { MptSource } from "./mpt-view";
import type { NodeRpc } from "./node-rpc";
import { isNotFound } from "./upstream";

/**
 * What a request for an MPT route is, before any call:
 * - `off`: `MPT` is off, whatever the path is (a 404 of class `short`);
 * - `no-mpt`: a network without MPT (Xahau, Xahau Testnet) and 48 hex digits, in any case; `id` is in capitals (the page that says MPT is not there, a 404 of class `short`);
 * - `bad`: not 48 hex digits (a 404 of class `short`);
 * - `case`: an ID in lower or mixed case; `to` is the path with the ID in capitals (a 302, `immutable` for the path alone);
 * - `ok`: an ID in capitals, on a network with MPT; `id` is it.
 */
export type MptRequest = { kind: "off" } | { kind: "no-mpt"; id: string } | { kind: "bad" } | { kind: "case"; to: string } | { kind: "ok"; id: string };

/**
 * The first step of the three MPT routes' loaders, in the order of spec 1.3 (the order is the point: a request is the cheapest answer it can have): the switch, then the network, then the shape
 * of the ID, then its case. `raw` is the path's `{id}` as the request has it, decoded.
 */
export function checkMptRequest(net: Pick<Network, "id" | "hasMpt">, raw: string, features: Pick<Features, "mpt">): MptRequest {
  if (!features.mpt) return { kind: "off" };
  if (!isMptId(raw)) return { kind: "bad" };
  const id = raw.toUpperCase();
  if (!net.hasMpt) return { kind: "no-mpt", id };
  return id === raw ? { kind: "ok", id } : { kind: "case", to: mptPath(net.id, id) };
}

/**
 * The issuance an MPT route draws: the index's (`GET /v2/mpt/{id}`, class `minute`), else, when the index answers `not_found` (an issuance created less than a tick ago, or whose state is outside its
 * coverage), the node's `ledger_entry` (spec 3.2 step 3). `null` when neither has it: the page is a 404. Anything else, the index failing (a 5xx, a 429, a timeout, a bad shape, a `Cannot GET`) or the
 * node failing after the index's 404, is thrown as it was: the caller makes a 503 of it (`upstreamOutage`).
 */
export async function loadMptSource(api: Pick<DataApi, "mpt">, node: Pick<NodeRpc, "mptIssuance">, id: string): Promise<MptSource | null> {
  let answer: MptIssuanceAnswer;
  try {
    answer = await api.mpt(id);
  } catch (err) {
    if (!isNotFound(err)) throw err;
    try {
      const { node: entry, ledger_index: ledgerIndex } = await node.mptIssuance(id);
      return { origin: "node", node: entry, ledgerIndex, id };
    } catch (nodeErr) {
      if (isNotFound(nodeErr)) return null;
      throw nodeErr;
    }
  }
  return { origin: "index", answer };
}
