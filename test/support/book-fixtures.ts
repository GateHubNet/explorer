// The recorded order books (test/fixtures/http/<net>/node/book_offers/, README.md "Upstream fixtures", PROVENANCE.md "Recorded node answers"): which
// books they are, and the rules an answer must keep to be recorded. The recorder (scripts/record-node-fixtures.ts) and the test of the recording
// (test/unit/market-fixtures.test.ts) share this file, so the pairs and the rules are written once. PROVENANCE.md's table is the independent pin: the test
// reads it and checks the pairs and the files against it.
//
// Nothing here runs anything: no network, no file, no import of app code (node-rpc.ts pulls in the Worker's modules, which Node cannot load). It is in
// tsconfig.node.json beside upstream-core.ts, which it uses to name a file.

import { nodeFile, type NetworkName } from "./upstream-core";

export interface Asset {
  currency: string;
  issuer?: string;
}

/** A book: what the owners of the offers give (`taker_gets`), then what they want (`taker_pays`). */
export interface Book {
  net: NetworkName;
  gets: Asset;
  pays: Asset;
}

// The currencies as the ledger holds them: RLUSD and LIONS are 40 hex digits, EVR is three characters. The native asset is written XRP on XRPL and
// XAH on Xahau, which answers `dstIsrMalformed` for XRP (app/server/node-rpc.ts, the notes above the readers).
export const XRP: Asset = { currency: "XRP" };
export const XAH: Asset = { currency: "XAH" };
export const RLUSD: Asset = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
export const LIONS: Asset = { currency: "4C494F4E53000000000000000000000000000000", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" };
export const EVR: Asset = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };

/** The books the pair page reads: both orientations of XRP/RLUSD and XRP/LIONS on XRPL and of XAH/EVR on Xahau. */
export const BOOKS: readonly Book[] = [
  { net: "xrpl", gets: XRP, pays: RLUSD },
  { net: "xrpl", gets: RLUSD, pays: XRP },
  { net: "xrpl", gets: LIONS, pays: XRP },
  { net: "xrpl", gets: XRP, pays: LIONS },
  { net: "xahau", gets: EVR, pays: XAH },
  { net: "xahau", gets: XAH, pays: EVR },
];

/** What the app asks a node for: `BOOK_OFFERS_LIMIT` of app/server/node-rpc.ts (node-rpc.spec.ts pins it to 60). */
export const BOOK_OFFERS_LIMIT = 60;

/** An asset as the file name and PROVENANCE.md write it: the native code alone, or `CUR+issuer`. */
export const assetText = (asset: Asset): string => (asset.issuer === undefined ? asset.currency : `${asset.currency}+${asset.issuer}`);

/** The parameters of the `book_offers` call that asks for a book, as the app makes it. */
export const requestOf = (book: Pick<Book, "gets" | "pays">) => ({
  taker_gets: book.gets,
  taker_pays: book.pays,
  ledger_index: "validated",
  limit: BOOK_OFFERS_LIMIT,
});

/** The path below test/fixtures/http/ of the file that holds the answer for a book, which is the file the upstream mock finds for the request. */
export function bookFile(book: Book): string {
  const path = nodeFile(book.net, "book_offers", requestOf(book));
  if (path === undefined) throw new Error(`no file for the book ${assetText(book.gets)} for ${assetText(book.pays)} on ${book.net}`);
  return path;
}

// ---- What an answer must be to be recorded --------------------------------------------------------------------------

/** A node's answer to `book_offers`, whole: its `result`, and Clio's `warnings` beside it. */
export interface BookAnswer {
  result: {
    status: "success";
    ledger_hash: string;
    ledger_index: number;
    /** Absent from Clio's answer to a call for `ledger_index: "validated"` (it serves validated ledgers only); true from xahaud; never anything else. */
    validated?: true;
    offers: unknown[];
    [field: string]: unknown;
  };
  warnings?: unknown[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The answer to record, or the reason it is not one. What the explorer reads and the tests then rely on: a successful call whose book is of a
 * validated ledger (`validated` true or absent, never false and never anything else) and has offers (an empty book would record nothing of use, and
 * the mock answers a book with no file with an empty one already), at most as many as were asked for, with the ledger it was read at named by an index
 * and a hash. Beside `result` only Clio's `warnings` list may be there: anything else is a node that is not the one this was written for. The answer
 * is returned as it is, never changed.
 */
export function acceptAnswer(answer: unknown): BookAnswer {
  if (!isObject(answer)) throw new Error("the answer is not a JSON object");
  const { result, warnings, ...other } = answer;
  if (!isObject(result)) throw new Error('the answer has no "result"');
  if (Object.keys(other).length > 0) throw new Error(`the answer has ${Object.keys(other).map((key) => JSON.stringify(key)).join(", ")} beside "result"`);
  if (warnings !== undefined && !Array.isArray(warnings)) throw new Error('"warnings" is not a list');
  if (result.status !== "success") throw new Error(`the call was not a success: ${JSON.stringify(result.error ?? result.status)}`);
  if ("validated" in result && result.validated !== true) throw new Error(`the book is not of a validated ledger (validated: ${JSON.stringify(result.validated)})`);
  if (typeof result.ledger_index !== "number" || !Number.isSafeInteger(result.ledger_index) || result.ledger_index <= 0) {
    throw new Error(`ledger_index is not a ledger index (${JSON.stringify(result.ledger_index)})`);
  }
  if (typeof result.ledger_hash !== "string" || !/^[0-9A-F]{64}$/.test(result.ledger_hash)) throw new Error(`ledger_hash is not a ledger hash (${JSON.stringify(result.ledger_hash)})`);
  if (!Array.isArray(result.offers)) throw new Error('no "offers" list');
  if (result.offers.length === 0) throw new Error("the book is empty");
  if (result.offers.length > BOOK_OFFERS_LIMIT) throw new Error(`${result.offers.length} offers where ${BOOK_OFFERS_LIMIT} were asked for`);
  return answer as unknown as BookAnswer;
}

/** A recorded answer with the book it is for. */
export interface Recording {
  net: NetworkName;
  /** The path below test/fixtures/http/ (`bookFile`). */
  path: string;
  answer: BookAnswer;
}

/**
 * The books of one network are one ledger: the pair page shows both orientations of a pair, and what they say must agree. Throws, naming the
 * network and the two files, when two books of one network were read at different ledgers (different index or different hash); the books of
 * different networks are of course of different ledgers.
 */
export function checkOneLedger(recordings: readonly Recording[]): void {
  const first = new Map<NetworkName, Recording>();
  for (const recording of recordings) {
    const head = first.get(recording.net);
    if (head === undefined) {
      first.set(recording.net, recording);
      continue;
    }
    const [a, b] = [head.answer.result, recording.answer.result];
    if (a.ledger_index !== b.ledger_index || a.ledger_hash !== b.ledger_hash) {
      throw new Error(
        `the books of ${recording.net} are not of one ledger: ${head.path} is ledger ${a.ledger_index} (${a.ledger_hash}), ${recording.path} is ledger ${b.ledger_index} (${b.ledger_hash})`,
      );
    }
  }
}
