import { redirect } from "react-router";
import { isValidClassicAddress } from "ripple-address-codec";

import { echoOf } from "../server/echo";
import { cacheClassHeaders, forwardCacheClass } from "../server/edge-cache";
import { escrowKeylet } from "../server/keylet";
import { notFound } from "../server/loader-errors";
import { requireNetwork } from "../server/network-route";

import type { Route } from "./+types/net.escrows.$owner.$sequence";

// The loader redirects to the escrow's page (`immutable`: an owner and a sequence name one escrow for good) and answers its 404s with class `short`. It makes no call.
export const headers = forwardCacheClass;

/** A sequence as a decimal UInt32 is written one way: no sign, no leading zero, at most ten digits (and then no more than 4,294,967,295). */
const SEQUENCE = /^(0|[1-9]\d{0,9})$/;
const SEQUENCE_MAX = 0xffff_ffff;

/**
 * `/{net}/escrows/{owner}/{sequence}` (ledger object pages spec 1.2): the escrow `owner` created with `sequence`, as an `EscrowFinish` or an `EscrowCancel` names it. While `LEDGER_OBJECTS` is on,
 * an owner that is a classic address with a valid checksum (not an X-address) and a sequence written as above is a 302 to `/{net}/escrows/{ID}`, the ID being the escrow's keylet
 * (`escrowKeylet`), worked out here without asking anyone: whether the escrow exists is its page's to say. Anything else, and the switch off, is a 404.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const net = requireNetwork(context, params);
  if (!net.features.ledgerObjects) notFound({ notFound: "the escrow pages" });
  const { owner, sequence } = params;
  if (!isValidClassicAddress(owner) || !SEQUENCE.test(sequence) || Number(sequence) > SEQUENCE_MAX) notFound({ notFound: `escrow ${echoOf(`${owner}/${sequence}`, 80)}` });
  return redirect(`/${net.id}/escrows/${await escrowKeylet(owner, Number(sequence))}`, { status: 302, headers: cacheClassHeaders("immutable") });
}

/** Never drawn: the loader always redirects or throws. The route has a component so that its 404 is the layout's HTML page. */
export default function EscrowByOwner() {
  return null;
}
