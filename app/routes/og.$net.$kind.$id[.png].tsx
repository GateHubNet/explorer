import { isValidClassicAddress } from "ripple-address-codec";
import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { amendmentSegment, parseAmendmentRef } from "../domain/amendment-ref";
import { dropsToNative } from "../domain/format";
import { parseValidatorKey } from "../domain/validator-key";
import { renderCard } from "../og/render";
import type { CardData } from "../og/types";
import { accountCard, amendmentCard, ledgerCard, poolCard, transactionCard, transactionFacts, validatorCard } from "../server/card-data";
import { VALIDATORS_CALL_TTL_SECONDS, type CacheClass } from "../server/cache-class";
import { activationOf } from "../server/account-view";
import { ammPoolFacts, createdOf } from "../server/amm-view";
import type { AmendmentDetail, AmmLiquidityEvent, ValidatorDetail } from "../server/api-types";
import { clientsFor } from "../server/clients";
import { cacheClassHeaders } from "../server/edge-cache";
import { getEnv } from "../server/env";
import { ledgerPage, sourceFromIndex, sourceFromNode, type LedgerSource } from "../server/ledger-view";
import { logProblem } from "../server/logging";
import { isNetworkId, networkOf, type Network } from "../server/networks";
import { txFromIndex, txFromNode, type TransactionSource } from "../server/transaction-view";
import { isMissingRoute, UpstreamError } from "../server/upstream";

// `/og/{net}/{tx|ledger|account|validator|amendment|amm}/{id}.png` (spec 2, 4, 9; validators spec 8; AMM spec 5.2): the link-preview image of a transaction, a
// ledger, an account, a validator, an amendment or an AMM pool, 1200 × 630, drawn on the first request and kept by the edge. A resource route at the top
// level: no layout, no HTML.
//
// - A URL with a query string is a 302 to the bare path (class `immutable`), before anything else: no call, nothing drawn, and no
//   copy of the image per query in the edge cache.
// - Net, kind and id are checked first, without a call: anything that is not one is a 404 of class `short`. A transaction hash in lower
//   case, a ledger hash in lower case and a ledger index with leading zeros are a 302 to the one URL the object has (class `immutable`),
//   as the pages do it. A CTID, an X-address and a label such as `latest` are not ids of an image.
// - The data comes through the same clients and builders as the page: the data API first and, when it says "not found", the network's
//   node (spec 10); an image drawn from the node is class `short` for 60 s, like the page, so the indexed version takes over.
// - Class: a transaction and a ledger the index has are `immutable`; an account is `slow` (its card holds its balance, so it is kept for
//   an hour, as the spec has it). The newest ledger is `short`: its page is live, because its "newest" status is about to change (the
//   next ledger closes within seconds), and an image kept for a year would keep the old status. An account whose balances could not be
//   read is drawn without them and is `short`, to be tried again soon.
// - A validator and an amendment (validators spec 8) are drawn from the data API's D1 routes alone (the node knows neither), in class `slow`: the
//   UNL, the version and the domain's check change rarely, and so does an amendment's standing. They are 404s of class `short` while `VALIDATORS`
//   is off, before any call. A key in hex is a 302 (`immutable`) to the base58 key; a signing key, and an amendment that is not named as D1 names
//   it (a case variant, an ID of a named amendment), are a 302 (`slow`) to the master key's and the canonical image: the mapping is D1's data.
//   D's and AD's own "not found" is the 404; every other failure, a 400 and a `Cannot GET` (an API without D1) included, is a 503.
// - An AMM pool (AMM spec 5.2) is drawn from the index alone, so an image never costs a node call: the pool (#1) and its create event (#8) are asked side by
//   side. It is class `slow` (its card holds its value, so it is kept for an hour, as an account's is); a failed #8 leaves the day of the creation out of the
//   card and makes it `short`, to be tried again soon. The index's own "pool not found" is the 404 (a pool younger than the aggregator's minute has no image for
//   that minute); every other failure of #1, a 400 and a `Cannot GET` (an API without the AMM routes) included, is a 503. It is a 404 of class `short`, before any
//   call, while `AMM_PAGES` is off, on a network without AMM, and for an id that is not a classic address.
// - A "not found" (the API's and the node's) is a 404 of class `short`. A failure of an upstream that leaves the question open, and a
//   card the renderer cannot draw, is a 503 with `Retry-After` that is never stored; the Worker's entry answers it with a stored copy
//   of the image if there is one, however old. A 400 of the data API for an id the route has checked is such a failure too (the API's
//   fault, as on the transaction and ledger pages), not a missing image.
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
 * What a failed call to an upstream makes of the answer: "not found" is a 404 (so is a node's refusal of the id as malformed: an index
 * that is no ledger number); every other failure is a 503. With `outage` a "not found" is a 503 too: it is about something the visitor did
 * not ask for (the newest ledger). An error that is not an upstream's is a bug and is thrown again.
 */
function failure(err: unknown, outage = false): Response {
  if (!(err instanceof UpstreamError)) throw err;
  if (!outage && (err.kind === "not_found" || err.kind === "bad_request")) return notFound();
  return unavailable(err.retryAfter);
}

/**
 * `failure` for a call to the data API whose "not found" has been dealt with already (the caller asks the node for that). What is left is
 * an outage, a 400 included: the route has checked the id (64 hex digits, an index, a valid address), so a refusal is the API's fault and
 * not a missing image, and a 404 would be stored for 30 s. The transaction and ledger pages answer it the same way (503).
 */
function apiFailure(err: unknown): Response {
  return failure(err, true);
}

function isNotFound(err: unknown): boolean {
  return err instanceof UpstreamError && err.kind === "not_found";
}

/** A redirect to the one image an object has, as the data names it (a master key, an amendment's name). The mapping is data: it is kept for an hour, not for good. */
function slowRedirect(to: string): Response {
  return redirect(to, { status: 302, headers: cacheClassHeaders("slow") });
}

/** The failure of a route that has no node to ask in its place (D1's two, the AMM pool's): its own "not found" is a 404; everything else, a 400 included, is the API failing. */
function indexOnlyFailure(err: unknown): Response {
  return isNotFound(err) ? notFound() : apiFailure(err);
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
  // The image has no use for a query string, and the edge cache's key holds it: each one would be a copy of its own, drawn and kept for as
  // long as its class says. So any URL with one is sent to the bare path, before anything is checked, asked for or drawn.
  const { pathname, search } = new URL(request.url);
  if (search !== "") return permanent(pathname);

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
    case "validator":
      return validatorImage(context, network, id, request);
    case "amendment":
      return amendmentImage(context, network, id, request);
    case "amm":
      return ammImage(context, network, id, request);
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
    if (!isNotFound(err)) return apiFailure(err);
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
    return apiFailure(found.reason);
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
  if (!isNotFound(created.reason)) return apiFailure(created.reason);
  try {
    const info = await node.accountInfo(address);
    const card = accountCard({ address, native: network.native, activatedAt: null, balance: dropsToNative(info.account_data.Balance) }, network);
    return image(card, request, "short", FROM_NODE_TTL);
  } catch (err) {
    return failure(err);
  }
}

// ---- A validator ---------------------------------------------------------------------------------------------------------------------

async function validatorImage(context: LoaderFunctionArgs["context"], network: Network, id: string, request: Request) {
  if (!network.features.validators) return notFound();
  const parsed = parseValidatorKey(id);
  if (parsed === null) return notFound();
  if (parsed.from === "hex") return permanent(`/og/${network.id}/validator/${parsed.key}.png`);

  const { api } = clientsFor(context, network);
  let detail: ValidatorDetail;
  try {
    detail = await api.validator(parsed.key, { ttl: VALIDATORS_CALL_TTL_SECONDS });
  } catch (err) {
    return indexOnlyFailure(err);
  }
  // The string alone cannot tell a master key from a signing key: D says which it is.
  if (detail.validation_public_key !== parsed.key) return slowRedirect(`/og/${network.id}/validator/${detail.validation_public_key}.png`);
  return image(validatorCard(detail, network), request, "slow");
}

// ---- An amendment --------------------------------------------------------------------------------------------------------------------

async function amendmentImage(context: LoaderFunctionArgs["context"], network: Network, id: string, request: Request) {
  if (!network.features.validators) return notFound();
  const ref = parseAmendmentRef(id);
  if (ref === null) return notFound();

  const { api } = clientsFor(context, network);
  let detail: AmendmentDetail;
  try {
    detail = await api.amendment("id" in ref ? ref.id : ref.name);
  } catch (err) {
    return indexOnlyFailure(err);
  }
  const segment = amendmentSegment(detail);
  if (segment !== id) return slowRedirect(`/og/${network.id}/amendment/${encodeURIComponent(segment)}.png`);
  return image(amendmentCard(detail, network), request, "slow");
}

// ---- An AMM pool ---------------------------------------------------------------------------------------------------------------------

async function ammImage(context: LoaderFunctionArgs["context"], network: Network, pool: string, request: Request) {
  // Off, a network without AMM and an id that is no classic address (an X-address included: a pool takes no tag) are one 404, before any call.
  if (!network.features.ammPages || !network.hasAmm || !isValidClassicAddress(pool)) return notFound();

  const { api } = clientsFor(context, network);
  // #1 and #8 of the page, side by side: the node is not asked, and the page's keys are the same, so the page and its image share the answers.
  const [found, created] = await Promise.allSettled([api.ammPool(pool), api.ammLiquidity(pool, { event: "create", limit: 1 })]);
  if (found.status === "rejected") {
    // An API without the AMM routes behind a switch that is on is an outage to be seen, not a pool that does not exist.
    if (isMissingRoute(found.reason)) logProblem("the data API serves no AMM pools", found.reason, request);
    return indexOnlyFailure(found.reason);
  }

  // The creation is on the card when it could be read; a pool the index has no create event of (older than its first ledger) simply has none, and a failure to read
  // it is not a reason to have no card, only to ask again soon.
  let creation: AmmLiquidityEvent | null = null;
  let complete = true;
  if (created.status === "fulfilled") {
    creation = createdOf(created.value);
  } else {
    if (!(created.reason instanceof UpstreamError)) throw created.reason;
    logProblem("an AMM pool's link-preview image left out its creation", created.reason, request);
    complete = false;
  }

  const card = poolCard(ammPoolFacts(network, pool, found.value, null, creation), network);
  return image(card, request, complete ? "slow" : "short");
}
