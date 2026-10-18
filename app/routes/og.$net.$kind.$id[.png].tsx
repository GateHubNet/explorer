import { isValidClassicAddress } from "ripple-address-codec";
import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { dropsToNative } from "../domain/format";
import { renderCard } from "../og/render";
import type { CardData } from "../og/types";
import { accountCard, ledgerCard, transactionCard, transactionFacts } from "../server/card-data";
import type { CacheClass } from "../server/cache-class";
import { activationOf } from "../server/account-view";
import { clientsFor } from "../server/clients";
import { cacheClassHeaders } from "../server/edge-cache";
import { getEnv } from "../server/env";
import { ledgerPage, sourceFromIndex, sourceFromNode, type LedgerSource } from "../server/ledger-view";
import { logProblem } from "../server/logging";
import { isNetworkId, networkOf, type Network } from "../server/networks";
import { txFromIndex, txFromNode, type TransactionSource } from "../server/transaction-view";
import { UpstreamError } from "../server/upstream";

// `/og/{net}/{tx|ledger|account}/{id}.png` (spec 2, 4, 9): the link-preview image of a transaction, a ledger or an account, 1200 × 630,
// drawn on the first request and kept by the edge. A resource route at the top level: no layout, no HTML.
//
// - Net, kind and id are checked first, without a call: anything that is not one is a 404 of class `short`. A transaction hash in lower
//   case, a ledger hash in lower case and a ledger index with leading zeros are a 302 to the one URL the object has (class `immutable`),
//   as the pages do it. A CTID, an X-address and a label such as `latest` are not ids of an image.
// - The data comes through the same clients and builders as the page: the data API first and, when it says "not found", the network's
//   node (spec 10); an image drawn from the node is class `short` for 60 s, like the page, so the indexed version takes over.
// - Class: a transaction and a ledger the index has are `immutable`; an account is `slow` (its card holds its balance, so it is kept for
//   an hour, as the spec has it). The newest ledger is `short`: its page is live, and the index may not have all of it yet. An account
//   whose balances could not be read is drawn without them and is `short`, to be tried again soon.
// - A "not found" (the API's and the node's) is a 404 of class `short`. A failure of an upstream that leaves the question open, and a
//   card the renderer cannot draw, is a 503 with `Retry-After` that is never stored; the Worker's entry answers it with a stored copy
//   of the image if there is one, however old.
// - Not an indexable page: `X-Robots-Tag: noindex`.

const FROM_NODE_TTL = 60;
const DEFAULT_RETRY_AFTER = 30;

const HASH_64 = /^[0-9A-Fa-f]{64}$/;
const LEDGER_INDEX = /^\d{1,10}$/;

const NO_INDEX = "noindex";

function notFound(): Response {
  const headers = cacheClassHeaders("short");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("X-Robots-Tag", NO_INDEX);
  return new Response("There is no such image.\n", { status: 404, headers });
}

function unavailable(retryAfter?: number): Response {
  const wait = retryAfter !== undefined && Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER;
  return new Response("The image could not be made just now. Try again in a minute.\n", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(wait), "X-Robots-Tag": NO_INDEX },
  });
}

/** A redirect to the one URL an image has. It never changes. */
function permanent(to: string): Response {
  return redirect(to, { status: 302, headers: cacheClassHeaders("immutable") });
}

/**
 * What a failed call to an upstream makes of the answer: "not found" (and a refusal of an id that is well formed) is a 404; every other
 * failure is a 503. With `outage` a "not found" is a 503 too: it is about something the visitor did not ask for (the newest ledger).
 * An error that is not an upstream's is a bug and is thrown again.
 */
function failure(err: unknown, outage = false): Response {
  if (!(err instanceof UpstreamError)) throw err;
  if (!outage && (err.kind === "not_found" || err.kind === "bad_request")) return notFound();
  return unavailable(err.retryAfter);
}

function isNotFound(err: unknown): boolean {
  return err instanceof UpstreamError && err.kind === "not_found";
}

/** The PNG answer for a card, in the class it is kept under. */
async function image(data: CardData, request: Request, cls: CacheClass, ttl?: number): Promise<Response> {
  let bytes: ArrayBuffer;
  try {
    bytes = await renderCard(data);
  } catch (err) {
    logProblem("a link-preview image could not be drawn", err, request);
    return unavailable();
  }
  const headers = cacheClassHeaders(cls, ttl);
  headers.set("Content-Type", "image/png");
  headers.set("X-Robots-Tag", NO_INDEX);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(bytes, { status: 200, headers });
}

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const segment = params.net ?? "";
  if (!isNetworkId(segment)) return notFound();
  const network = networkOf(segment, getEnv(context));
  const id = params.id ?? "";

  switch (params.kind) {
    case "tx":
      return transactionImage(context, network, id, request);
    case "ledger":
      return ledgerImage(context, network, id, request);
    case "account":
      return accountImage(context, network, id, request);
    default:
      return notFound();
  }
}

// ---- A transaction -----------------------------------------------------------------------------------------------------------------

async function transactionImage(context: LoaderFunctionArgs["context"], network: Network, id: string, request: Request) {
  if (!HASH_64.test(id)) return notFound();
  const hash = id.toUpperCase();
  if (id !== hash) return permanent(`/og/${network.id}/tx/${hash}.png`);

  const { api, node } = clientsFor(context, network);
  let source: TransactionSource;
  let fromNode = false;
  try {
    source = txFromIndex(await api.transaction(hash));
  } catch (err) {
    // Not indexed (yet): the network itself may have it (spec 10). Any other failure is a 503, and the node is not asked in its place.
    if (!isNotFound(err)) return failure(err);
    try {
      source = txFromNode(await node.tx(hash), hash);
      fromNode = true;
    } catch (nodeErr) {
      return failure(nodeErr);
    }
  }

  const card = transactionCard(transactionFacts(source, network.native), network);
  return fromNode ? image(card, request, "short", FROM_NODE_TTL) : image(card, request, "immutable");
}

// ---- A ledger -------------------------------------------------------------------------------------------------------------------------

async function ledgerImage(context: LoaderFunctionArgs["context"], network: Network, id: string, request: Request) {
  if (HASH_64.test(id)) {
    const canonical = id.toUpperCase();
    if (id !== canonical) return permanent(`/og/${network.id}/ledger/${canonical}.png`);
  } else if (LEDGER_INDEX.test(id)) {
    const canonical = String(Number(id));
    if (id !== canonical) return permanent(`/og/${network.id}/ledger/${canonical}.png`);
  } else {
    return notFound();
  }

  const { api, node } = clientsFor(context, network);
  const [found, newest] = await Promise.allSettled([api.ledger(id, { expand: true }), api.lastValidated()]);
  // Without the newest ledger it cannot be told whether this one is final.
  if (newest.status === "rejected") return failure(newest.reason, true);

  let source: LedgerSource;
  if (found.status === "fulfilled") {
    source = sourceFromIndex(found.value);
  } else if (isNotFound(found.reason)) {
    try {
      source = sourceFromNode(await node.ledger(id, { expand: true }));
    } catch (err) {
      return failure(err);
    }
  } else {
    return failure(found.reason);
  }

  const last = Number(newest.value.ledger_index);
  const hasNext = Number.isSafeInteger(last) && source.index < last;
  const card = ledgerCard(ledgerPage(source, { native: network.native, hasNext }), network);
  if (source.origin === "node") return image(card, request, "short", FROM_NODE_TTL);
  return image(card, request, hasNext ? "immutable" : "short");
}

// ---- An account ----------------------------------------------------------------------------------------------------------------------

async function accountImage(context: LoaderFunctionArgs["context"], network: Network, address: string, request: Request) {
  if (!isValidClassicAddress(address)) return notFound();

  const { api, node } = clientsFor(context, network);
  const [created, balances] = await Promise.allSettled([api.account(address), api.balances(address)]);

  if (created.status === "fulfilled") {
    // The index knows the account. Its balance is on the card when it could be read; an account without one (it was deleted) has none to
    // show, and a failure to read it is not a reason to have no card, only to ask again soon.
    let balance: string | null = null;
    let complete = true;
    if (balances.status === "fulfilled") {
      balance = balances.value.balances.find((entry) => entry.counterparty === undefined)?.value ?? null;
    } else if (!isNotFound(balances.reason)) {
      if (!(balances.reason instanceof UpstreamError)) throw balances.reason;
      complete = false;
    }
    const activated = activationOf(created.value).time;
    const card = accountCard({ address, native: network.native, activatedAt: Number.isFinite(activated) ? activated : null, balance }, network);
    return complete ? image(card, request, "slow") : image(card, request, "short");
  }

  // The index has no record of it (the account may be older than its first ledger, or newer than its last): the node is asked.
  if (!isNotFound(created.reason)) return failure(created.reason);
  try {
    const info = await node.accountInfo(address);
    const card = accountCard({ address, native: network.native, activatedAt: null, balance: dropsToNative(info.account_data.Balance) }, network);
    return image(card, request, "short", FROM_NODE_TTL);
  } catch (err) {
    return failure(err);
  }
}
