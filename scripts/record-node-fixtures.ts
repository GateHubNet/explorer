// The command that records the order books of the markets pages from the public nodes into test/fixtures/http/, as the recorder of
// test/fixtures/ledgers/ records ledgers: real answers, kept as the node served them (README.md, "Upstream fixtures"; PROVENANCE.md, "Recorded node
// answers").
//
//   pnpm exec tsx scripts/record-node-fixtures.ts
//
// It posts `book_offers` for six (taker_gets, taker_pays) pairs, both orientations of three pairs, to the XRPL node (Clio at s1.ripple.com) and to
// the Xahau node (xahau.network), and writes each whole JSON-RPC answer, `{ "result": ... }`, with `fixtureText` at the file the upstream mock
// finds for that request (`nodeFile`). It only reads: `book_offers` is a read-only method, and the only thing written is the six files. Nothing is
// ever deleted here.
//
// Nothing is written unless all six answers are good (`acceptAnswer` in test/support/book-fixtures.ts: a success, of a validated ledger, a book with
// offers) and the books of each network are of one ledger (`checkOneLedger`: the pair page shows both orientations of a pair, and they must agree).
// A ledger closes every few seconds, so a network whose books straddle a close is asked once more; a second miss, a silent node or a bad answer
// writes nothing, says which node and which book, and exits 1.
//
// The answers are the books of the moment: running this again records different ledgers and different offers, and the files and the table of
// PROVENANCE.md ("Recorded node answers", which names the node, the time and each file's ledger_index) are changed together. The unit test
// test/unit/market-fixtures.test.ts keeps the two in step. Run it only to refresh the recording on purpose, and never edit a recorded file by hand.
//
// This file does nothing but run the command, every time it is run, however it was reached (a link, a relative path, another working directory),
// as make-http-fixtures.ts does: it exports nothing, and a test does not import it. What can be tested without a network, the six books and the
// rules above, is in test/support/book-fixtures.ts, which is also what the test of the recording reads.
//
// It imports only what Node can load: not app/server/node-rpc.ts, which pulls in cache-class.ts and networks.ts (env.ts and react-router) and is
// outside tsconfig.node.json. So the request is written out here (`requestOf`, `BOOK_OFFERS_LIMIT` in book-fixtures.ts name what node-rpc.ts asks for).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { acceptAnswer, BOOKS, bookFile, checkOneLedger, requestOf, type Book, type Recording } from "../test/support/book-fixtures";
import type { NetworkName } from "../test/support/upstream-core";
import { fixtureText, HTTP } from "./http-fixtures";

/** The nodes the app is configured with (`XRPL_NODE_URL` and `XAHAU_NODE_URL` in wrangler.jsonc). */
const NODES: Record<NetworkName, string> = {
  xrpl: "https://s1.ripple.com:51234/",
  xahau: "https://xahau.network/",
};

/** How long a node has to answer before it is called silent. */
const TIMEOUT_MS = 20_000;

/** How many times the books of a network are asked for when they come back from different ledgers. */
const ATTEMPTS = 2;

interface Answered extends Recording {
  /** When the node answered. */
  at: Date;
}

/**
 * Why a call failed, in words: its message, and what caused it when there is a cause (Node's `fetch failed` says why only in `cause`: its
 * code, `ENOTFOUND`, `ECONNREFUSED`, or its message).
 */
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { cause } = error;
  if (cause === undefined) return error.message;
  const code = typeof cause === "object" && cause !== null && "code" in cause ? String((cause as { code: unknown }).code) : undefined;
  const because = code ?? (cause instanceof Error ? cause.message : String(cause));
  return `${error.message} (${because})`;
}

/** One `book_offers` call. Whatever goes wrong is thrown as `<node url> <file>: <cause>`. */
async function record(book: Book): Promise<Answered> {
  const path = bookFile(book);
  const url = NODES[book.net];
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ method: "book_offers", params: [requestOf(book)] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const at = new Date();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { net: book.net, path, answer: acceptAnswer(await response.json()), at };
  } catch (error) {
    throw new Error(`${url} ${path}: ${reasonOf(error)}`);
  }
}

/** The books of one network, asked for together so that the ledger is unlikely to close between them, and of one ledger or asked for again. */
async function recordNet(net: NetworkName): Promise<Answered[]> {
  for (let attempt = 1; ; attempt++) {
    const answered = await Promise.all(BOOKS.filter((book) => book.net === net).map(record));
    try {
      checkOneLedger(answered);
      return answered;
    } catch (error) {
      if (attempt >= ATTEMPTS) throw new Error(`${NODES[net]} ${error instanceof Error ? error.message : String(error)}`);
      console.log(`  ${net}: the books are of different ledgers, asking for them again`);
    }
  }
}

async function main(): Promise<number> {
  const started = new Date();
  console.log(`recording ${BOOKS.length} order books at ${started.toISOString()}`);
  for (const [net, url] of Object.entries(NODES)) console.log(`  ${net}: ${url}`);

  const recorded: Answered[] = [];
  try {
    for (const net of Object.keys(NODES) as NetworkName[]) {
      for (const one of await recordNet(net)) {
        recorded.push(one);
        console.log(`  ${one.at.toISOString()}  ledger_index ${one.answer.result.ledger_index}  ${String(one.answer.result.offers.length).padStart(2)} offers  ${one.path}`);
      }
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
  console.log(`${recorded.length} written, from ${started.toISOString()} to ${recorded.map((one) => one.at).sort((a, b) => a.getTime() - b.getTime()).at(-1)!.toISOString()}`);
  return 0;
}

process.exitCode = await main();
