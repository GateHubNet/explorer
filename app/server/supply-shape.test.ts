import { describe, expect, it } from "vitest";

import { mintedPageSample, supplySample } from "../../test/support/d7-samples";
import { checkMintedPage, checkSupply } from "./supply-shape";
import { UpstreamError } from "./upstream";

// The examples are the ones of data-api's docs/api-reference.md ("Network", `feat/explorer-data-2` at 31e97efaa1a6e098435b666e8893c79a0c4bee66), in test/support/d7-samples.ts. A defect is one
// change to an example.

/** A body to be broken in some way: a test reaches into it as it likes. */
type Body = any;
/** What is wrong, the field the message must name, and the change that makes it so. */
type Defect = [what: string, field: string, change: (body: Body) => void];

/** The request each check is told it answers, which its message names. */
const SUPPLY_PATH = "/v2/network/supply";
const MINTED_PATH = "/v2/network/supply/minted?interval=day&start=2026-07-20&end=2026-10-17&limit=1000";
/** What every message says between the request and the reason. */
const WHY = "answered something unexpected: ";

type Net = "xrpl" | "xahau";
const NATIVE = { xrpl: "XRP", xahau: "XAH" } as const;

/** The check as the client calls it (`finish` of its call). */
const askSupply = (net: Net) => (body: unknown) => checkSupply(body, SUPPLY_PATH, NATIVE[net]);
const askMinted = (body: unknown) => checkMintedPage(body, MINTED_PATH);

/** The check refuses `body` as an `UpstreamError` of kind `server` that marks an answer of the upstream (status 200), and its message names the request, and `field` in its reason. */
function refuses(check: (body: unknown) => unknown, path: string, body: unknown, field: string): void {
  let error: unknown;
  try {
    check(body);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UpstreamError);
  expect((error as UpstreamError).kind).toBe("server");
  expect((error as UpstreamError).status).toBe(200);
  const { message } = error as UpstreamError;
  expect(message).toContain(`data API GET ${path}`);
  // The field is looked for in the reason alone: every message holds the path, and a field named "supply" or "minted" is in that.
  expect(message).toContain(WHY);
  expect(message.slice(message.indexOf(WHY) + WHY.length)).toContain(field);
}

describe("checkSupply", () => {
  it.each([
    ["XRPL", "xrpl", "XRP"],
    ["Xahau", "xahau", "XAH"],
  ] as const)("accepts %s's answer and returns it", (_name, net, native) => {
    const body = supplySample(net);
    expect(checkSupply(body, SUPPLY_PATH, native)).toBe(body);
  });

  it("takes a part D7 leaves out: no minted, no amm, no reserves, and the XRP Ledger's burned with no coverage", () => {
    const xrpl = supplySample("xrpl");
    expect("coverage" in xrpl.burned).toBe(false);
    delete xrpl.amm;
    delete xrpl.reserves;
    expect(askSupply("xrpl")(xrpl)).toBe(xrpl);

    const xahau = supplySample("xahau");
    delete xahau.minted;
    delete xahau.reserves;
    expect(askSupply("xahau")(xahau)).toBe(xahau);
  });

  it("takes a part with no coverage of its own, since D7 leaves one out where none is needed", () => {
    const body = supplySample("xahau");
    delete body.escrowed.coverage;
    delete body.circulating.coverage;
    delete body.minted!.coverage;
    expect(askSupply("xahau")(body)).toBe(body);
  });

  it("takes an incomplete coverage and one with no ledger: the page words what it means", () => {
    const body = supplySample("xrpl");
    body.reserves!.coverage = { complete: false };
    body.escrowed.coverage = { from_ledger_index: 28685313, complete: false };
    expect(askSupply("xrpl")(body)).toBe(body);
  });

  it("takes counts of 0 and amounts of 0", () => {
    const body = supplySample("xrpl");
    body.escrowed = { amount: "0", escrows: 0, coverage: { from_ledger_index: 28685313, complete: true } };
    body.amm = { amount: "0", pools: 0 };
    body.circulating.amount = "0.000001";
    expect(askSupply("xrpl")(body)).toBe(body);
  });

  it.each([null, undefined, "success", 7, []])("refuses an answer that is %j, with a server error", (body) => {
    refuses(askSupply("xrpl"), SUPPLY_PATH, body, "answer");
  });

  /** Defects of the XRP Ledger's answer, and of Xahau's (which alone has `minted`, and a `burned` with a coverage). */
  const xrplDefects: Defect[] = [
    ["no result", "result", (b) => delete b.result],
    ["a result that is not success", "result", (b) => (b.result = "error")],
    ["a ledger_index that is text", "ledger_index", (b) => (b.ledger_index = "107747456")],
    ["a ledger_index of 0", "ledger_index", (b) => (b.ledger_index = 0)],
    ["a ledger_index that is negative", "ledger_index", (b) => (b.ledger_index = -1)],
    ["a ledger_index that is fractional", "ledger_index", (b) => (b.ledger_index = 1.5)],
    ["no ledger_index", "ledger_index", (b) => delete b.ledger_index],
    ["a close_time that is not a time", "close_time", (b) => (b.close_time = "2026-10-24")],
    ["a close_time that is a number", "close_time", (b) => (b.close_time = 1792875600)],
    ["a computed_at that is not a time", "computed_at", (b) => (b.computed_at = "yesterday")],
    ["no computed_at", "computed_at", (b) => delete b.computed_at],
    ["a currency of the other network", "currency", (b) => (b.currency = "XAH")],
    ["no currency", "currency", (b) => delete b.currency],
    ["a total that is a number", "total", (b) => (b.total = 99985312374.716318)],
    ["a total that is negative", "total", (b) => (b.total = "-1")],
    ["a total in exponent form", "total", (b) => (b.total = "9.9985312e+10")],
    ["no total", "total", (b) => delete b.total],
    ["an amount that is a number", "burned.amount", (b) => (b.burned.amount = 14687625.283682)],
    ["a negative amount", "escrowed.amount", (b) => (b.escrowed.amount = "-35212847105.402318")],
    ["an amount that is empty", "circulating.amount", (b) => (b.circulating.amount = "")],
    ["an amm amount that is a number", "amm.amount", (b) => (b.amm.amount = 46218377)],
    ["a reserves amount that is negative", "reserves.amount", (b) => (b.reserves.amount = "-9810004")],
    ["a base reserve that is a number", "reserves.base", (b) => (b.reserves.base = 1)],
    ["an increment that is negative", "reserves.increment", (b) => (b.reserves.increment = "-0.2")],
    ["no increment", "reserves.increment", (b) => delete b.reserves.increment],
    ["no burned", "burned", (b) => delete b.burned],
    ["no escrowed", "escrowed", (b) => delete b.escrowed],
    ["no circulating", "circulating", (b) => delete b.circulating],
    ["a burned that is text", "burned", (b) => (b.burned = "14687625.283682")],
    ["an amm that is a list", "amm", (b) => (b.amm = [])],
    ["escrows that is text", "escrowed.escrows", (b) => (b.escrowed.escrows = "12879")],
    ["escrows that is negative", "escrowed.escrows", (b) => (b.escrowed.escrows = -1)],
    ["escrows that is fractional", "escrowed.escrows", (b) => (b.escrowed.escrows = 12879.5)],
    ["no escrows", "escrowed.escrows", (b) => delete b.escrowed.escrows],
    ["pools that is text", "amm.pools", (b) => (b.amm.pools = "14594")],
    ["accounts that is negative", "reserves.accounts", (b) => (b.reserves.accounts = -6410280)],
    ["owner_count that is text", "reserves.owner_count", (b) => (b.reserves.owner_count = "16998620")],
    ["a coverage that is no coverage", "escrowed", (b) => (b.escrowed.coverage = { complete: "yes" })],
    ["a coverage that is text", "circulating", (b) => (b.circulating.coverage = "complete")],
    ["a coverage that is null", "amm", (b) => (b.amm.coverage = null)],
    ["a coverage without complete", "reserves", (b) => (b.reserves.coverage = { from_ledger_index: 28685313 })],
    ["a coverage whose ledger is 0", "coverage.from_ledger_index", (b) => (b.escrowed.coverage = { from_ledger_index: 0, complete: true })],
  ];
  const xahauDefects: Defect[] = [
    ["a currency of the other network", "currency", (b) => (b.currency = "XRP")],
    ["a minted amount that is a number", "minted.amount", (b) => (b.minted.amount = 49425551.616207)],
    ["a rewards amount that is negative", "minted.rewards", (b) => (b.minted.rewards = "-1")],
    ["an import amount that is text with letters", "minted.import", (b) => (b.minted.import = "8102233.104 XAH")],
    ["no genesis_mint", "minted.genesis_mint", (b) => delete b.minted.genesis_mint],
    ["a minted that is null (D7 leaves a key out, never null)", "minted", (b) => (b.minted = null)],
    ["a burned coverage that is no coverage", "burned", (b) => (b.burned.coverage = { complete: "yes" })],
    ["a minted coverage whose ledger is fractional", "minted", (b) => (b.minted.coverage = { from_ledger_index: 1.5, complete: true })],
  ];

  it.each(xrplDefects)("refuses %s from the XRP Ledger with a server error naming %s", (_what, field, change) => {
    const body: Body = supplySample("xrpl");
    change(body);
    refuses(askSupply("xrpl"), SUPPLY_PATH, body, field);
  });

  it.each(xahauDefects)("refuses %s from Xahau with a server error naming %s", (_what, field, change) => {
    const body: Body = supplySample("xahau");
    change(body);
    refuses(askSupply("xahau"), SUPPLY_PATH, body, field);
  });

  it("refuses a coverage that is no coverage", () => {
    const body = supplySample("xrpl");
    (body.escrowed as Body).coverage = { complete: "yes" };
    refuses(askSupply("xrpl"), SUPPLY_PATH, body, "coverage.complete");
    // It names the part it is of, since an answer holds several.
    expect(() => askSupply("xrpl")(body)).toThrow(/escrowed: coverage\.complete is not a boolean/);
  });

  it("is told the native currency by the caller: the same answer is XRPL's or no answer", () => {
    const body = supplySample("xahau");
    expect(checkSupply(body, SUPPLY_PATH, "XAH")).toBe(body);
    refuses(askSupply("xrpl"), SUPPLY_PATH, body, "currency");
  });
});

describe("checkMintedPage", () => {
  it("accepts a minted page and refuses a row without genesis_mint, or a page without coverage", () => {
    const good = mintedPageSample();
    expect(askMinted(good)).toBe(good);

    const row: Body = mintedPageSample();
    delete row.rows[1].genesis_mint;
    refuses(askMinted, MINTED_PATH, row, "rows[1].genesis_mint");

    const page: Body = mintedPageSample();
    delete page.coverage;
    refuses(askMinted, MINTED_PATH, page, "coverage");
  });

  it("takes the last page (no marker), an empty page of a network that cannot mint, and the empty page of an index with no ledger", () => {
    const last = mintedPageSample();
    delete last.marker;
    expect(askMinted(last)).toBe(last);

    const none = mintedPageSample({ coverage: { from_ledger_index: 32570, complete: true }, count: 0, rows: [] });
    delete none.marker;
    expect(askMinted(none)).toBe(none);

    const empty = mintedPageSample({ coverage: { complete: false }, count: 0, rows: [] });
    delete empty.marker;
    expect(askMinted(empty)).toBe(empty);
  });

  it.each([null, undefined, "success", 7, []])("refuses an answer that is %j, with a server error", (body) => {
    refuses(askMinted, MINTED_PATH, body, "answer");
  });

  const defects: Defect[] = [
    ["no result", "result", (b) => delete b.result],
    ["a result that is not success", "result", (b) => (b.result = "error")],
    ["a coverage that is text", "coverage", (b) => (b.coverage = "complete")],
    ["a coverage without complete", "coverage.complete", (b) => (b.coverage = { from_ledger_index: 1 })],
    ["a coverage whose ledger is 0", "coverage.from_ledger_index", (b) => (b.coverage = { from_ledger_index: 0, complete: true })],
    ["rows that are an object", "rows", (b) => (b.rows = {})],
    ["no rows", "rows", (b) => delete b.rows],
    ["a row that is text", "rows[0]", (b) => (b.rows[0] = "2026-10-20")],
    ["a count that is text", "count", (b) => (b.count = "3")],
    ["a count that is negative", "count", (b) => (b.count = -3)],
    ["no count", "count", (b) => delete b.count],
    ["a marker that is no marker", "marker", (b) => (b.marker = "not a marker!")],
    ["a date that is not a time", "rows[0].date", (b) => (b.rows[0].date = "2026-10-20")],
    ["a date that is a number", "rows[2].date", (b) => (b.rows[2].date = 1792454400)],
    ["no date", "rows[1].date", (b) => delete b.rows[1].date],
    ["an amount that is a number", "rows[0].amount", (b) => (b.rows[0].amount = 3.75)],
    ["a negative amount", "rows[1].amount", (b) => (b.rows[1].amount = "-1")],
    ["rewards that is empty", "rows[2].rewards", (b) => (b.rows[2].rewards = "")],
    ["no import", "rows[0].import", (b) => delete b.rows[0].import],
    ["no genesis_mint", "rows[1].genesis_mint", (b) => delete b.rows[1].genesis_mint],
    ["a genesis_mint in exponent form", "rows[2].genesis_mint", (b) => (b.rows[2].genesis_mint = "6e0")],
  ];

  it.each(defects)("refuses %s with a server error naming %s", (_what, field, change) => {
    const body: Body = mintedPageSample();
    change(body);
    refuses(askMinted, MINTED_PATH, body, field);
  });
});
