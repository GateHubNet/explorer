// What the answers of D3's NFT routes must look like for the NFT pages to use them: an NFT, its history and its open offers, an account's NFTs, the collections and
// everything of one (its NFTs, holders, sales and days), the sales of the network, and the NFT volume (data-api-new `feat/explorer-data-2` at da5ce14,
// `docs/api-reference.md` "NFTs", "Coverage" and `GET /v2/network/nft_volume`, and `apps/api/src/nft/nft-objects.ts`; the types are in api-types.ts, "NFTs"). Like
// `amm-shape.ts`, the data API client runs the checks inside the load its subrequest cache runs, as `get()`'s `finish`: a 200 that is not what the reference promises is an
// `UpstreamError` of kind `server` (status 200 marks it as an answer of the upstream), is held when the call asks, and is never stored, and the card of the call fails with it.
// A check takes the whole body and the path that was asked for (the message names the request), and returns the body, typed, as it is. Worker-only code, no I/O.
//
// What is checked, beside what `amm-shape.ts` does (lists are lists, with a count and a marker; counts, ledger indexes and indexes are whole numbers; a key the API leaves
// out when it has no value is checked when it is there, and `null` is never served; extra keys are not refused, the API may add a column):
//   - every answer has a `coverage` that is one (`checkCoverage`);
//   - an NFT id, an offer id and a transaction hash are 64 hexadecimal digits in upper case: they go into paths and links, and the pages compare them as text;
//   - an account (an issuer, an owner, `by`, `to`, `from`, a seller, a buyer, a broker, a destination, a holder) is a classic address, because it goes into a link;
//   - amounts are exact decimal strings (`isDecimalText`), `converted_amount` and the `*_native` values included: D3 writes them with at most 6 decimals and no exponent.
//     The volume's `total`, `converted_amount` and rates are the exception (`isNumberText`): shown in another currency they follow the other volumes' text, whose
//     BigNumber form has an exponent below 1e-6 and from 1e21, and a rate has one from 1e8; with no `exchange_currency` (the explorer asks for none) they are decimals too;
//   - times are `YYYY-MM-DDTHH:mm:ssZ`; a `taxon` and a `serial` are whole numbers up to 4294967295 (an XRPL id's 32 bits); `uri` is hex, `digest` 64 hex digits;
//   - the words of D3 that the pages build on keep their sets: `kind`, an event's `event`, a sale's `mode`. `removed_by` and `tx_type` are any text that is not empty.

import { fields, isAccount, isBoolean, isDecimalText, isIsoTime, isName, isNumberText, isWhole, listOf, optionalFields } from "./aggregate-shape";
import type {
  CollectionKey,
  NftAnswer,
  NftCollectionAnswer,
  NftCollectionDays,
  NftCollectionsPage,
  NftEventsPage,
  NftHoldersPage,
  NftOffersPage,
  NftSalesPage,
  NftsPage,
  NftVolume,
} from "./api-types";
import { checkCoverage } from "./coverage";
import { isObject, malformed } from "./tx-shape";

type Row = Record<string, unknown>;

const NFT_ID = "an NFT id (64 upper-case hexadecimal digits)";
const OFFER_ID = "an offer id (64 upper-case hexadecimal digits)";
const HASH = "a hash (64 upper-case hexadecimal digits)";
const ACCOUNT = "an account";
const WHOLE = "a whole number";
const UINT32 = "a whole number up to 4294967295";
const DECIMAL = "a decimal as text";
const NUMBER = "a number as text";
const TIME = "a time";
const TEXT = "text";

const HEX64 = /^[0-9A-F]{64}$/;
const DIGEST = /^[0-9A-Fa-f]{64}$/;
const HEX_BYTES = /^(?:[0-9A-Fa-f]{2})+$/;

const isHash = (value: unknown): value is string => typeof value === "string" && HEX64.test(value);
/** The digest of a URIToken: a hash as xahaud writes it, in either case (it is never a path). */
const isDigest = (value: unknown): value is string => typeof value === "string" && DIGEST.test(value);
/** A URI as the ledger holds it: hex of whole bytes, and not empty (a URI that is not there is left out). */
const isUri = (value: unknown): value is string => typeof value === "string" && HEX_BYTES.test(value);
const isUint32 = (value: unknown): value is number => isWhole(value) && value <= 4_294_967_295;
/** A word out of a fixed set. */
const oneOf =
  (...words: readonly string[]) =>
  (value: unknown): boolean =>
    typeof value === "string" && words.includes(value);

const isKind = oneOf("nftoken", "uritoken");
const isEvent = oneOf("mint", "burn", "modify", "offer_create", "offer_cancel", "offer_removed", "sale", "transfer");
const isMode = oneOf("direct", "brokered");

/** What every answer is: an object with a coverage. Returned, so that a check reads its keys from it. */
function answerOf(what: string, body: unknown): Row {
  if (!isObject(body)) throw malformed(what, "the answer is not an object");
  checkCoverage(body, `${what} answered something unexpected`);
  return body;
}

/** The object under `key` of `row`, or a failure. */
function objectAt(what: string, where: string, value: unknown): Row {
  if (!isObject(value)) throw malformed(what, `${where} is not an object`);
  return value;
}

/** The place of a fact in the ledger history, and the `accounts` it names (`by`, `to`). */
function checkPoint(what: string, where: string, value: unknown, accounts: readonly string[] = []): void {
  const point = objectAt(what, where, value);
  fields(what, where, point, ["ledger_index"], isWhole, WHOLE);
  fields(what, where, point, ["tx_hash"], isHash, HASH);
  fields(what, where, point, ["executed_time"], isIsoTime, TIME);
  fields(what, where, point, accounts, isAccount, ACCOUNT);
}

/** An asset's name and issuer; the native currency has no issuer key. */
function checkAssetOf(what: string, where: string, row: Row): void {
  fields(what, where, row, ["currency"], isName, "a currency");
  optionalFields(what, where, row, ["amount_issuer"], isName, "an issuer");
}

/** The newest sale of an NFT. */
function checkLastSale(what: string, where: string, value: unknown): void {
  const sale = objectAt(what, where, value);
  fields(what, where, sale, ["amount"], isDecimalText, DECIMAL);
  checkAssetOf(what, where, sale);
  optionalFields(what, where, sale, ["converted_amount"], isDecimalText, DECIMAL);
  fields(what, where, sale, ["ledger_index"], isWhole, WHOLE);
  fields(what, where, sale, ["tx_hash"], isHash, HASH);
  fields(what, where, sale, ["executed_time"], isIsoTime, TIME);
}

/** What an NFT, an event and a sale all start with: the NFT's id, kind and collection. */
function checkWhose(what: string, where: string, row: Row): void {
  fields(what, where, row, ["nft_id"], isHash, NFT_ID);
  fields(what, where, row, ["kind"], isKind, "nftoken or uritoken");
  fields(what, where, row, ["issuer"], isAccount, ACCOUNT);
  optionalFields(what, where, row, ["taxon", "serial"], isUint32, UINT32);
}

/** An NFT (`Nft`): the keys it always has, and the ones it has when known. */
function checkNftRow(what: string, where: string, row: Row): void {
  checkWhose(what, where, row);
  fields(what, where, row, ["flags"], isWhole, WHOLE);
  optionalFields(what, where, row, ["transfer_fee"], isWhole, WHOLE);
  optionalFields(what, where, row, ["owner"], isAccount, ACCOUNT);
  if (row.owner_since !== undefined) checkPoint(what, `${where}.owner_since`, row.owner_since);
  optionalFields(what, where, row, ["uri"], isUri, "hex text");
  optionalFields(what, where, row, ["digest"], isDigest, "64 hexadecimal digits");
  if (row.minted !== undefined) checkPoint(what, `${where}.minted`, row.minted, ["by", "to"]);
  fields(what, where, row, ["burned"], isBoolean, "a boolean");
  if (row.burned_at !== undefined) checkPoint(what, `${where}.burned_at`, row.burned_at, ["by"]);
  fields(what, where, row, ["sale_count"], isWhole, WHOLE);
  if (row.last_sale !== undefined) checkLastSale(what, `${where}.last_sale`, row.last_sale);
}

/** An event of an NFT's history (`NftEvent`): most of what follows the time is there only for the events it belongs to. */
function checkEventRow(what: string, where: string, row: Row): void {
  checkWhose(what, where, row);
  fields(what, where, row, ["ledger_index", "tx_index", "event_index"], isWhole, WHOLE);
  fields(what, where, row, ["tx_hash"], isHash, HASH);
  fields(what, where, row, ["tx_type"], isName, TEXT);
  fields(what, where, row, ["executed_time"], isIsoTime, TIME);
  fields(what, where, row, ["event"], isEvent, "an event of the reference");
  optionalFields(what, where, row, ["account", "from", "to", "destination", "broker"], isAccount, ACCOUNT);
  optionalFields(what, where, row, ["offer_id"], isHash, OFFER_ID);
  optionalFields(what, where, row, ["is_sell_offer"], isBoolean, "a boolean");
  optionalFields(what, where, row, ["amount", "converted_amount", "broker_fee", "royalty_est"], isDecimalText, DECIMAL);
  optionalFields(what, where, row, ["currency", "amount_issuer"], isName, "a currency");
  optionalFields(what, where, row, ["expiration"], isIsoTime, TIME);
  optionalFields(what, where, row, ["removed_by"], isName, TEXT);
  optionalFields(what, where, row, ["uri"], isUri, "hex text");
}

/** A sale (`NftSale`). */
function checkSaleRow(what: string, where: string, row: Row): void {
  checkWhose(what, where, row);
  fields(what, where, row, ["ledger_index", "tx_index", "event_index"], isWhole, WHOLE);
  fields(what, where, row, ["tx_hash"], isHash, HASH);
  fields(what, where, row, ["executed_time"], isIsoTime, TIME);
  fields(what, where, row, ["seller", "buyer"], isAccount, ACCOUNT);
  fields(what, where, row, ["mode"], isMode, "direct or brokered");
  fields(what, where, row, ["amount"], isDecimalText, DECIMAL);
  checkAssetOf(what, where, row);
  optionalFields(what, where, row, ["converted_amount", "broker_fee", "royalty_est"], isDecimalText, DECIMAL);
  optionalFields(what, where, row, ["broker"], isAccount, ACCOUNT);
}

/** An open offer (`NftOffer`). */
function checkOfferRow(what: string, where: string, row: Row): void {
  fields(what, where, row, ["offer_id"], isHash, OFFER_ID);
  fields(what, where, row, ["is_sell_offer"], isBoolean, "a boolean");
  fields(what, where, row, ["owner"], isAccount, ACCOUNT);
  fields(what, where, row, ["amount"], isDecimalText, DECIMAL);
  checkAssetOf(what, where, row);
  optionalFields(what, where, row, ["destination"], isAccount, ACCOUNT);
  optionalFields(what, where, row, ["expiration"], isIsoTime, TIME);
  fields(what, where, row, ["created_ledger"], isWhole, WHOLE);
  fields(what, where, row, ["created_tx_hash"], isHash, HASH);
  fields(what, where, row, ["created_time"], isIsoTime, TIME);
}

/** A collection (`NftCollection`). */
function checkCollectionRow(what: string, where: string, row: Row): void {
  fields(what, where, row, ["issuer"], isAccount, ACCOUNT);
  optionalFields(what, where, row, ["taxon"], isUint32, UINT32);
  fields(what, where, row, ["kind"], isKind, "nftoken or uritoken");
  fields(what, where, row, ["supply", "holders", "minted", "burned", "sales_count"], isWhole, WHOLE);
  fields(what, where, row, ["volume_native"], isDecimalText, DECIMAL);
  if (row.first_mint !== undefined) checkPoint(what, `${where}.first_mint`, row.first_mint);
  if (row.last_mint !== undefined) checkPoint(what, `${where}.last_mint`, row.last_mint);
  fields(what, where, row, ["last_ledger"], isWhole, WHOLE);
}

/** `GET /v2/nfts/{nft_id}`: the NFT, under `nft`. */
export function checkNft(body: unknown, path: string): NftAnswer {
  const what = `data API GET ${path}`;
  checkNftRow(what, "nft", objectAt(what, "nft", answerOf(what, body).nft));
  return body as NftAnswer;
}

/** `GET /v2/nfts/{nft_id}/history`: the events, under `events`. */
export function checkNftEventsPage(body: unknown, path: string): NftEventsPage {
  const what = `data API GET ${path}`;
  answerOf(what, body);
  for (const [index, row] of listOf(what, body, "events").entries()) checkEventRow(what, `events[${index}]`, row);
  return body as NftEventsPage;
}

/** `GET /v2/nfts/{nft_id}/offers`: the open offers, under `offers`. */
export function checkNftOffersPage(body: unknown, path: string): NftOffersPage {
  const what = `data API GET ${path}`;
  answerOf(what, body);
  for (const [index, row] of listOf(what, body, "offers").entries()) checkOfferRow(what, `offers[${index}]`, row);
  return body as NftOffersPage;
}

/** `GET /v2/nft_sales` and a collection's `/sales`: the sales, under `sales`. */
export function checkNftSalesPage(body: unknown, path: string): NftSalesPage {
  const what = `data API GET ${path}`;
  answerOf(what, body);
  for (const [index, row] of listOf(what, body, "sales").entries()) checkSaleRow(what, `sales[${index}]`, row);
  return body as NftSalesPage;
}

/** A collection's `/holders`: the accounts that hold its NFTs, under `holders`. */
export function checkHoldersPage(body: unknown, path: string): NftHoldersPage {
  const what = `data API GET ${path}`;
  answerOf(what, body);
  for (const [index, row] of listOf(what, body, "holders").entries()) {
    fields(what, `holders[${index}]`, row, ["owner"], isAccount, ACCOUNT);
    fields(what, `holders[${index}]`, row, ["held"], isWhole, WHOLE);
  }
  return body as NftHoldersPage;
}

/**
 * `GET /v2/accounts/{address}/nfts` and a collection's `/nfts`: the NFTs, under `nfts`. With `key` (the collection that was asked for) every NFT must be of it: its
 * `issuer` is the key's and, on XRPL, where the key has a `taxon`, its `taxon` too. A page of another collection is not the answer to that request, and a page would show
 * its NFTs as that collection's.
 */
export function checkNftsPage(body: unknown, path: string, key?: CollectionKey): NftsPage {
  const what = `data API GET ${path}`;
  answerOf(what, body);
  for (const [index, row] of listOf(what, body, "nfts").entries()) {
    const where = `nfts[${index}]`;
    checkNftRow(what, where, row);
    if (key === undefined) continue;
    if (row.issuer !== key.issuer) {
      throw malformed(what, `${where}.issuer is ${JSON.stringify(row.issuer)}, not the collection asked for (${JSON.stringify(key.issuer)})`);
    }
    if (key.taxon !== undefined && row.taxon !== key.taxon) {
      throw malformed(what, `${where}.taxon is ${JSON.stringify(row.taxon)}, not the collection asked for (${key.taxon})`);
    }
  }
  return body as NftsPage;
}

/** `GET /v2/nft_collections`: the collections, under `collections`, and `total`, how many match the filter whatever the page. */
export function checkCollectionsPage(body: unknown, path: string): NftCollectionsPage {
  const what = `data API GET ${path}`;
  const head = answerOf(what, body);
  fields(what, "answer", head, ["total"], isWhole, WHOLE);
  for (const [index, row] of listOf(what, body, "collections").entries()) checkCollectionRow(what, `collections[${index}]`, row);
  return body as NftCollectionsPage;
}

/** `GET /v2/nft_collections/{issuer}[/{taxon}]`: the collection, under `collection`. */
export function checkCollection(body: unknown, path: string): NftCollectionAnswer {
  const what = `data API GET ${path}`;
  checkCollectionRow(what, "collection", objectAt(what, "collection", answerOf(what, body).collection));
  return body as NftCollectionAnswer;
}

/** A collection's `/stats`: a row for each UTC day of the window with activity, under `days`. */
export function checkCollectionDays(body: unknown, path: string): NftCollectionDays {
  const what = `data API GET ${path}`;
  answerOf(what, body);
  for (const [index, row] of listOf(what, body, "days").entries()) {
    const where = `days[${index}]`;
    fields(what, where, row, ["date"], isIsoTime, TIME);
    fields(what, where, row, ["sales_count", "mints", "burns"], isWhole, WHOLE);
    fields(what, where, row, ["volume_native"], isDecimalText, DECIMAL);
    optionalFields(what, where, row, ["avg_price_native", "min_price_native"], isDecimalText, DECIMAL);
  }
  return body as NftCollectionDays;
}

/**
 * `GET /v2/network/nft_volume`: a row for each bucket, under `rows`, each with its components, one for each collection that sold (`NftVolumeRow`). `live` is the rolling
 * period (`?live=`), which is exactly one row, the period ending now: an answer with no row, or with more than one, is not that. `daily` is a window of days, any number of
 * rows.
 */
export function checkNftVolume(body: unknown, path: string, mode: "live" | "daily"): NftVolume {
  const what = `data API GET ${path}`;
  answerOf(what, body);
  const rows = listOf(what, body, "rows");
  if (mode === "live" && rows.length !== 1) throw malformed(what, `${rows.length} rows, not one`);
  for (const [index, row] of rows.entries()) {
    const where = `rows[${index}]`;
    fields(what, where, row, ["count"], isWhole, WHOLE);
    fields(what, where, row, ["total", "exchange_rate"], isNumberText, NUMBER);
    fields(what, where, row, ["start_time", "end_time"], isIsoTime, TIME);
    const exchange = row.exchange;
    if (!isObject(exchange) || !isName(exchange.currency) || (exchange.issuer !== undefined && !isName(exchange.issuer))) {
      throw malformed(what, `${where}.exchange is not a currency`);
    }
    const components = row.components;
    if (!Array.isArray(components)) throw malformed(what, `${where}.components is not a list`);
    for (const [at, component] of (components as unknown[]).entries()) {
      const here = `${where}.components[${at}]`;
      const entry = objectAt(what, here, component);
      fields(what, here, entry, ["issuer"], isAccount, ACCOUNT);
      optionalFields(what, here, entry, ["taxon"], isUint32, UINT32);
      fields(what, here, entry, ["count"], isWhole, WHOLE);
      // The volume of the collection's sales in the native currency is exact; the rate and the converted amount are the display currency's, as the other volumes write them.
      fields(what, here, entry, ["amount"], isDecimalText, DECIMAL);
      fields(what, here, entry, ["rate", "converted_amount"], isNumberText, NUMBER);
    }
  }
  return body as NftVolume;
}
