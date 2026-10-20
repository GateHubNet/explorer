// The command that records the order books of the markets pages from the public nodes into test/fixtures/http/, as the recorder of
// test/fixtures/ledgers/ records ledgers: real answers, kept as the node served them (README.md, "Upstream fixtures"; PROVENANCE.md, "Recorded node
// answers").
//
//   pnpm exec tsx scripts/record-node-fixtures.ts
//
// It posts `book_offers` for six (taker_gets, taker_pays) pairs, both orientations of three pairs, to the XRPL node (Clio at s1.ripple.com) and to
// the Xahau node (xahau.network), and writes each whole JSON-RPC answer, `{ "result": ... }`, with `fixtureText` at the file the upstream mock
// finds for that request (`nodeFile`). It only reads: `book_offers` is a read-only method, and the only thing written is the six files. Nothing is
// ever deleted here. The six answers are all asked for before any file is written, so a node that does not answer leaves the files as they were.
//
// The answers are the books of the moment: running this again records different ledgers and different offers, and the files and the table of
// PROVENANCE.md ("Recorded node answers", which names the node, the time and each file's ledger_index) are changed together. The unit test
// test/unit/market-fixtures.test.ts keeps the two in step. Run it only to refresh the recording on purpose, and never edit a recorded file by hand.
//
// This file does nothing but run the command, every time it is run, however it was reached (a link, a relative path, another working directory),
// as make-http-fixtures.ts does: it exports nothing, and a test does not import it.
//
// It imports only what Node can load: not app/server/node-rpc.ts, which pulls in cache-class.ts and networks.ts (env.ts and react-router) and is
// outside tsconfig.node.json. So the request is written out here, with what node-rpc.ts asks for named at each place.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { nodeFile, type NetworkName } from "../test/support/upstream-core";
import { fixtureText, HTTP } from "./http-fixtures";

/** The nodes the app is configured with (`XRPL_NODE_URL` and `XAHAU_NODE_URL` in wrangler.jsonc). */
const NODES: Record<NetworkName, string> = {
  xrpl: "https://s1.ripple.com:51234/",
  xahau: "https://xahau.network/",
};

/** `BOOK_OFFERS_LIMIT` of app/server/node-rpc.ts: the most offers one call asks for (node-rpc.spec.ts pins it to 60). */
const BOOK_OFFERS_LIMIT = 60;

/** How long a node has to answer before it is called silent. */
const TIMEOUT_MS = 20_000;

interface Asset {
  currency: string;
  issuer?: string;
}

// The currencies as the ledger holds them: RLUSD and LIONS are 40 hex digits, EVR is three characters. The native asset is written XRP on XRPL
// and XAH on Xahau, which answers `dstIsrMalformed` for XRP (node-rpc.ts, the notes above the readers).
const XRP: Asset = { currency: "XRP" };
const XAH: Asset = { currency: "XAH" };
const RLUSD: Asset = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const LIONS: Asset = { currency: "4C494F4E53000000000000000000000000000000", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" };
const EVR: Asset = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };

/** The books: what the owners of the offers give (`taker_gets`), then what they want (`taker_pays`). Both orientations of XRP/RLUSD, XRP/LIONS and XAH/EVR. */
const BOOKS: { net: NetworkName; gets: Asset; pays: Asset }[] = [
  { net: "xrpl", gets: XRP, pays: RLUSD },
  { net: "xrpl", gets: RLUSD, pays: XRP },
  { net: "xrpl", gets: LIONS, pays: XRP },
  { net: "xrpl", gets: XRP, pays: LIONS },
  { net: "xahau", gets: EVR, pays: XAH },
  { net: "xahau", gets: XAH, pays: EVR },
];

interface Recorded {
  net: NetworkName;
  /** The path below test/fixtures/http/. */
  path: string;
  /** The whole answer of the node, as parsed from what it served. */
  answer: { result: { ledger_index: number; offers: unknown[] } };
  /** When the node answered. */
  at: Date;
}

/** One `book_offers` call, with what node-rpc.ts sends: `ledger_index: "validated"` and `limit: BOOK_OFFERS_LIMIT`. */
async function record(book: (typeof BOOKS)[number]): Promise<Recorded> {
  const params = { taker_gets: book.gets, taker_pays: book.pays, ledger_index: "validated", limit: BOOK_OFFERS_LIMIT };
  const path = nodeFile(book.net, "book_offers", params);
  if (path === undefined) throw new Error(`no file for the book ${JSON.stringify(params)}`);

  const url = NODES[book.net];
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ method: "book_offers", params: [params] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const at = new Date();
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status} for ${path}`);

  const answer = (await response.json()) as Recorded["answer"];
  const result = answer?.result as Record<string, unknown> | undefined;
  if (typeof result !== "object" || result === null) throw new Error(`${url} answered no "result" for ${path}`);
  if (result.status !== "success") throw new Error(`${url} answered ${JSON.stringify(result.error ?? result.status)} for ${path}`);
  if (!Array.isArray(result.offers) || typeof result.ledger_index !== "number") throw new Error(`${url} answered no book (offers, ledger_index) for ${path}`);
  return { net: book.net, path, answer, at };
}

async function main(): Promise<number> {
  const started = new Date();
  console.log(`recording ${BOOKS.length} order books at ${started.toISOString()}`);
  for (const [net, url] of Object.entries(NODES)) console.log(`  ${net}: ${url}`);

  const recorded: Recorded[] = [];
  try {
    for (const book of BOOKS) {
      const one = await record(book);
      recorded.push(one);
      console.log(`  ${one.at.toISOString()}  ledger_index ${one.answer.result.ledger_index}  ${String(one.answer.result.offers.length).padStart(2)} offers  ${one.path}`);
    }
  } catch (error) {
    console.error(`not recorded, nothing written: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  for (const { path, answer } of recorded) {
    const target = fileURLToPath(new URL(path, HTTP));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, fixtureText(answer));
  }
  console.log(`${recorded.length} written, from ${started.toISOString()} to ${recorded.at(-1)!.at.toISOString()}`);
  return 0;
}

process.exitCode = await main();
