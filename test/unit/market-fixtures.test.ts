import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fixtureText, HTTP } from "../../scripts/http-fixtures";
import {
  acceptAnswer,
  assetText,
  BOOK_OFFERS_LIMIT as LIMIT,
  BOOKS,
  bookFile as fileOf,
  checkOneLedger,
  type Asset,
  type BookAnswer,
  type Recording,
} from "../support/book-fixtures";
import type { NetworkName } from "../support/upstream-core";

// What the fixtures of the markets pages promise the tests that use them. This is the recorded part: the order books recorded from the public
// nodes by scripts/record-node-fixtures.ts, `<net>/node/book_offers/<gets>_<pays>@limit=60.json`, whole JSON-RPC answers kept as the node served
// them. The six books and the rules an answer must keep are in test/support/book-fixtures.ts, which the recorder reads too; each file is checked
// here against its row of the table in test/fixtures/PROVENANCE.md, "Recorded node answers", which is the independent pin: the request it answers
// (method and parameters) and the validated ledger it was read at.

const NETS: NetworkName[] = ["xrpl", "xahau"];

const read = (path: string): string => readFileSync(new URL(path, HTTP), "utf8");

// ---- The table of PROVENANCE.md --------------------------------------------------------------------------------------

interface Row {
  file: string;
  method: string;
  gets: string;
  pays: string;
  limit: string;
  asked: string;
  ledgerIndex: string;
  offers: string;
}

/** The rows of the table under "Recorded node answers": the cells without their code marks, in the order of the columns. */
function provenanceRows(): Row[] {
  const text = readFileSync(new URL("../fixtures/PROVENANCE.md", import.meta.url), "utf8");
  const section = text.split(/^## /m).find((part) => part.startsWith("Recorded node answers"));
  expect(section, 'PROVENANCE.md has a section "Recorded node answers"').toBeDefined();
  return section!
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      const [file, method, gets, pays, limit, asked, ledgerIndex, offers] = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replaceAll("`", ""));
      return { file: file!, method: method!, gets: gets!, pays: pays!, limit: limit!, asked: asked!, ledgerIndex: ledgerIndex!, offers: offers! };
    });
}

describe("the recorded order books: PROVENANCE.md", () => {
  it("names the six books, each by the file that the request it answers finds", () => {
    const rows = provenanceRows();
    expect(rows).toHaveLength(BOOKS.length);
    BOOKS.forEach((book, at) => {
      const row = rows[at]!;
      expect(row.method, row.file).toBe("book_offers");
      expect(row.gets, row.file).toBe(assetText(book.gets));
      expect(row.pays, row.file).toBe(assetText(book.pays));
      expect(row.limit, row.file).toBe(String(LIMIT));
      expect(row.asked, row.file).toBe("validated");
      expect(row.file, "the file of the request the row names").toBe(`${book.net}/node/book_offers/${assetText(book.gets)}_${assetText(book.pays)}@limit=${LIMIT}.json`);
      expect(row.file, "the file the mock finds for that request").toBe(fileOf(book));
    });
  });

  it("has no other file in the directories of the books", () => {
    const rows = provenanceRows();
    for (const net of NETS) {
      const files = readdirSync(new URL(`${net}/node/book_offers/`, HTTP)).map((name) => `${net}/node/book_offers/${name}`);
      expect(files.sort(), net).toEqual(rows.map((row) => row.file).filter((file) => file.startsWith(`${net}/`)).sort());
    }
  });

  // The pair page shows both orientations of a pair side by side, so the books of a network were read at one ledger.
  it("has the books of a network at one ledger", () => {
    const rows = provenanceRows();
    for (const net of NETS) {
      const mine = rows.filter((row) => row.file.startsWith(`${net}/`));
      expect(mine, net).toHaveLength(BOOKS.filter((book) => book.net === net).length);
      expect(new Set(mine.map((row) => row.ledgerIndex)).size, `the ledger_index of the rows of ${net}`).toBe(1);
    }
  });
});

describe("the recorded order books: one ledger to a network", () => {
  const recordings = (net: NetworkName): Recording[] =>
    BOOKS.filter((book) => book.net === net).map((book) => ({ net, path: fileOf(book), answer: JSON.parse(read(fileOf(book))) as BookAnswer }));

  it.each(NETS)("%s: every book has the same ledger_index and the same ledger_hash", (net) => {
    const all = recordings(net);
    expect(all.length).toBeGreaterThan(1);
    expect(new Set(all.map((one) => one.answer.result.ledger_index)).size, "ledger_index").toBe(1);
    expect(new Set(all.map((one) => one.answer.result.ledger_hash)).size, "ledger_hash").toBe(1);
    // The recorder's own check says the same.
    expect(() => checkOneLedger(all)).not.toThrow();
  });
});

// The rules of the recorder (test/support/book-fixtures.ts), tried without the network: what it refuses before it writes anything.
describe("what the recorder accepts: acceptAnswer", () => {
  const HASH = "6362E55E66FFC49651601E7F9ED75905F0E98CF18CD50FC1DD0398806C319940";
  const offer = { Account: "rA", Sequence: 1, TakerGets: "1000000", TakerPays: { currency: "USD", issuer: "rB", value: "1" } };
  const good = (): any => ({ result: { ledger_hash: HASH, ledger_index: 107780245, offers: [offer], status: "success" } });
  const with_ = (change: (answer: any) => void): any => {
    const answer = good();
    change(answer);
    return answer;
  };

  it("takes Clio's answer (no validated, a warnings list) and xahaud's (validated: true), and returns it as it is", () => {
    const clio = with_((answer) => (answer.warnings = [{ id: 2001, message: "This is a clio server." }]));
    expect(acceptAnswer(clio)).toBe(clio);
    const xahaud = with_((answer) => (answer.result.validated = true));
    expect(acceptAnswer(xahaud)).toBe(xahaud);
    expect(acceptAnswer(good())).toEqual(good());
  });

  it("takes as many offers as were asked for, not one more", () => {
    expect(() => acceptAnswer(with_((answer) => (answer.result.offers = Array.from({ length: LIMIT }, () => offer))))).not.toThrow();
    expect(() => acceptAnswer(with_((answer) => (answer.result.offers = Array.from({ length: LIMIT + 1 }, () => offer))))).toThrow(/61 offers where 60 were asked for/);
  });

  it.each([
    ["validated: false", (answer: any) => (answer.result.validated = false), /not of a validated ledger.*false/],
    ["validated: null", (answer: any) => (answer.result.validated = null), /not of a validated ledger.*null/],
    ['validated: "true"', (answer: any) => (answer.result.validated = "true"), /not of a validated ledger/],
    ["validated: 1", (answer: any) => (answer.result.validated = 1), /not of a validated ledger/],
    ["validated: undefined, present", (answer: any) => (answer.result.validated = undefined), /not of a validated ledger/],
    ["an empty book", (answer: any) => (answer.result.offers = []), /the book is empty/],
    ["no offers", (answer: any) => delete answer.result.offers, /no "offers" list/],
    ["offers that are not a list", (answer: any) => (answer.result.offers = { 0: offer }), /no "offers" list/],
    ["an error", (answer: any) => Object.assign(answer.result, { status: "error", error: "dstIsrMalformed" }), /not a success: "dstIsrMalformed"/],
    ["no status", (answer: any) => delete answer.result.status, /not a success/],
    ["no result", (answer: any) => delete answer.result, /no "result"/],
    ["a result that is a list", (answer: any) => (answer.result = []), /no "result"/],
    ["another key beside result", (answer: any) => (answer.id = 1), /"id" beside "result"/],
    ["warnings that are no list", (answer: any) => (answer.warnings = "careful"), /"warnings" is not a list/],
    ["a ledger_index of text", (answer: any) => (answer.result.ledger_index = "107780245"), /ledger_index is not a ledger index/],
    ["a ledger_index of 0", (answer: any) => (answer.result.ledger_index = 0), /ledger_index is not a ledger index/],
    ["a ledger_index with a fraction", (answer: any) => (answer.result.ledger_index = 1.5), /ledger_index is not a ledger index/],
    ["no ledger_hash", (answer: any) => delete answer.result.ledger_hash, /ledger_hash is not a ledger hash/],
    ["a ledger_hash of lower case", (answer: any) => (answer.result.ledger_hash = HASH.toLowerCase()), /ledger_hash is not a ledger hash/],
  ])("refuses %s", (_name, change, message) => {
    expect(() => acceptAnswer(with_(change))).toThrow(message);
  });

  it.each([[null], [undefined], ["{}"], [[]], [5]])("refuses %j, which is no JSON object", (value) => {
    expect(() => acceptAnswer(value)).toThrow(/not a JSON object/);
  });
});

describe("what the recorder checks across the books of a network: checkOneLedger", () => {
  const HASH_A = "A".repeat(64);
  const HASH_B = "B".repeat(64);
  const recording = (net: NetworkName, name: string, ledger_index: number, ledger_hash: string): Recording => ({
    net,
    path: `${net}/node/book_offers/${name}.json`,
    answer: { result: { status: "success", ledger_hash, ledger_index, offers: [{}] } },
  });

  it("passes books of one ledger, a single book, nothing, and networks that are at their own ledgers", () => {
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xrpl", "b", 10, HASH_A), recording("xrpl", "c", 10, HASH_A)])).not.toThrow();
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A)])).not.toThrow();
    expect(() => checkOneLedger([])).not.toThrow();
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xahau", "x", 77, HASH_B), recording("xrpl", "b", 10, HASH_A), recording("xahau", "y", 77, HASH_B)])).not.toThrow();
  });

  it("refuses books of different ledgers, and names the network and the two files", () => {
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xrpl", "b", 11, HASH_B)])).toThrow(
      new RegExp(`books of xrpl are not of one ledger: xrpl/node/book_offers/a\\.json is ledger 10 \\(${HASH_A}\\), xrpl/node/book_offers/b\\.json is ledger 11 \\(${HASH_B}\\)`),
    );
  });

  it("refuses the same index with another hash, and the same hash with another index, and the third book that strays", () => {
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xrpl", "b", 10, HASH_B)])).toThrow(/not of one ledger/);
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xrpl", "b", 11, HASH_A)])).toThrow(/not of one ledger/);
    expect(() => checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xrpl", "b", 10, HASH_A), recording("xrpl", "c", 11, HASH_B)])).toThrow(/xrpl\/node\/book_offers\/c\.json is ledger 11/);
  });

  it("holds each network to its own books: a stray book of xahau is refused although xrpl is at one ledger", () => {
    expect(() =>
      checkOneLedger([recording("xrpl", "a", 10, HASH_A), recording("xahau", "x", 77, HASH_B), recording("xrpl", "b", 10, HASH_A), recording("xahau", "y", 78, HASH_B)]),
    ).toThrow(/books of xahau are not of one ledger/);
  });
});

describe.each(BOOKS)("the recorded book $net $gets.currency for $pays.currency", (book) => {
  const file = fileOf(book);
  const row = () => provenanceRows().find((candidate) => candidate.file === file);
  const answer = (): any => JSON.parse(read(file));

  // As served: `result`, and beside it only what the node adds of its own (Clio's `warnings`, a list).
  it("is a whole JSON-RPC answer, { result }, of a successful call", () => {
    const { result, warnings, ...other } = answer();
    expect(other).toEqual({});
    expect(warnings === undefined || Array.isArray(warnings)).toBe(true);
    expect(result.status).toBe("success");
  });

  // Clio, which the configured XRPL node is, leaves `validated` out of a book read at ledger_index "validated" (it serves validated ledgers only);
  // xahaud says `validated: true`. Never false.
  it("is of a validated ledger: validated is true or absent", () => {
    const { validated } = answer().result;
    expect(validated === undefined || validated === true, `validated: ${String(validated)}`).toBe(true);
  });

  it("is read at the ledger its row of PROVENANCE.md names", () => {
    const { ledger_index } = answer().result;
    expect(Number.isSafeInteger(ledger_index) && ledger_index > 0, `ledger_index: ${String(ledger_index)}`).toBe(true);
    expect(row(), `a row for ${file}`).toBeDefined();
    expect(String(ledger_index)).toBe(row()!.ledgerIndex);
  });

  it("holds the offers of the book, as many as its row says and no more than were asked for", () => {
    const { offers } = answer().result;
    expect(Array.isArray(offers)).toBe(true);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.length).toBeLessThanOrEqual(LIMIT);
    expect(String(offers.length)).toBe(row()!.offers);
  });

  it("holds offers of the assets asked: they give taker_gets and want taker_pays", () => {
    const side = (amount: unknown, asset: Asset): boolean =>
      asset.issuer === undefined
        ? typeof amount === "string" && /^\d+$/.test(amount)
        : typeof amount === "object" && amount !== null && (amount as Asset).currency === asset.currency && (amount as Asset).issuer === asset.issuer;
    for (const offer of answer().result.offers) {
      expect(side(offer.TakerGets, book.gets), JSON.stringify(offer.TakerGets)).toBe(true);
      expect(side(offer.TakerPays, book.pays), JSON.stringify(offer.TakerPays)).toBe(true);
    }
  });

  it("is an answer the recorder accepts: success, validated, offers", () => {
    expect(() => acceptAnswer(answer())).not.toThrow();
  });

  it("is the text the recorder writes: the answer as served, in fixtureText's layout", () => {
    expect(read(file)).toBe(fixtureText(answer()));
  });
});
