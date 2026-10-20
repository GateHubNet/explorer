import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fixtureText, HTTP } from "../../scripts/http-fixtures";
import { nodeFile } from "../support/upstream-core";

// What the fixtures of the markets pages promise the tests that use them. This is the recorded part: the order books recorded from the public
// nodes by scripts/record-node-fixtures.ts, `<net>/node/book_offers/<gets>_<pays>@limit=60.json`, whole JSON-RPC answers kept as the node served
// them. Each is checked against its row of the table in test/fixtures/PROVENANCE.md, "Recorded node answers": the request it answers (method and
// parameters) and the validated ledger it was read at.

type Net = "xrpl" | "xahau";
interface Asset {
  currency: string;
  issuer?: string;
}

const RLUSD: Asset = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const LIONS: Asset = { currency: "4C494F4E53000000000000000000000000000000", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" };
const EVR: Asset = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };
const XRP: Asset = { currency: "XRP" };
const XAH: Asset = { currency: "XAH" };

/** The books the pair page reads: both orientations of three pairs. `gets` is `taker_gets`, `pays` is `taker_pays`. */
const BOOKS: { net: Net; gets: Asset; pays: Asset }[] = [
  { net: "xrpl", gets: XRP, pays: RLUSD },
  { net: "xrpl", gets: RLUSD, pays: XRP },
  { net: "xrpl", gets: LIONS, pays: XRP },
  { net: "xrpl", gets: XRP, pays: LIONS },
  { net: "xahau", gets: EVR, pays: XAH },
  { net: "xahau", gets: XAH, pays: EVR },
];

/** What the app asks a node for (`BOOK_OFFERS_LIMIT` in app/server/node-rpc.ts, pinned to 60 by node-rpc.spec.ts). */
const LIMIT = 60;

const assetText = (asset: Asset): string => (asset.issuer === undefined ? asset.currency : `${asset.currency}+${asset.issuer}`);
const requestOf = (book: { gets: Asset; pays: Asset }) => ({ taker_gets: book.gets, taker_pays: book.pays, ledger_index: "validated", limit: LIMIT });
const fileOf = (book: { net: Net; gets: Asset; pays: Asset }): string => nodeFile(book.net, "book_offers", requestOf(book))!;

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
    for (const net of ["xrpl", "xahau"] as const) {
      const files = readdirSync(new URL(`${net}/node/book_offers/`, HTTP)).map((name) => `${net}/node/book_offers/${name}`);
      expect(files.sort(), net).toEqual(rows.map((row) => row.file).filter((file) => file.startsWith(`${net}/`)).sort());
    }
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

  it("is the text the recorder writes: the answer as served, in fixtureText's layout", () => {
    expect(read(file)).toBe(fixtureText(answer()));
  });
});
