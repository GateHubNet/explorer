import { classicAddressToXAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import {
  MPT_SAMPLE_HOLDER,
  MPT_SAMPLE_ID,
  MPT_SAMPLE_ISSUER,
  MPT_SAMPLE_SECOND_ID,
  MPT_SAMPLE_THIRD_ID,
  mptHolderSample,
  mptHoldersSample,
  mptIssuanceSample,
  mptLockSample,
  mptLookupSample,
  mptSample,
  mptSummarySample,
  mptTokenRowSample,
  mptTokensSample,
  mptTransferSample,
  mptTransfersSample,
} from "../../test/support/mpt-samples";
import { checkMptHoldersPage, checkMptIssuance, checkMptLookup, checkMptTokens, checkMptTransfersPage } from "./mpt-shape";
import { UpstreamError } from "./upstream";

// The examples are the ones of D9's spec section 7 (data-api `feat/explorer-data-2` at c9a2fc0), with IDs and addresses that exist (test/support/mpt-samples.ts). A defect is one change to an
// example.

/** A body to be broken in some way: a test reaches into it as it likes. */
type Body = any;
/** What is wrong, the field the message must name, and the change that makes it so. */
type Defect = [what: string, field: string, change: (body: Body) => void];

const clone = <T>(value: T): T => structuredClone(value);

/** Each of these is a thing an amount is not: a decimal, a sign, an exponent, nothing, 20 digits (past a signed 64-bit value), a number where text belongs. */
const NOT_AMOUNTS: unknown[] = ["1.5", "-1", "1e3", "", "12345678901234567890", 15, null];

/**
 * The check refuses `body` as an `UpstreamError` of kind `server` that marks an answer of the upstream (status 200), in the words of `what`, and names `field` in its message.
 */
function refuses(check: (body: unknown) => unknown, body: unknown, field: string, what: RegExp): void {
  let error: unknown;
  try {
    check(body);
  } catch (caught) {
    error = caught;
  }
  expect(error, `${field} was accepted`).toBeInstanceOf(UpstreamError);
  expect((error as UpstreamError).kind).toBe("server");
  expect((error as UpstreamError).status).toBe(200);
  expect((error as UpstreamError).message).toMatch(what);
  expect((error as UpstreamError).message).toContain(field);
}

/** `good` is taken and returned as it is, and every change in `defects` makes it a refused answer. */
function pins(check: (body: unknown) => unknown, what: RegExp, good: () => unknown, defects: Defect[]): void {
  it("takes the example, and returns it as it is", () => {
    const body = good();
    expect(check(body)).toBe(body);
  });
  it.each(defects)("refuses %s", (_what, field, change) => {
    const body = clone(good());
    change(body);
    refuses(check, body, field, what);
  });
}

/** Each of `values` as a field's value is refused; `set` puts one in a fresh body. */
function refusesEach(check: (body: unknown) => unknown, what: RegExp, good: () => unknown, field: string, set: (body: Body, value: unknown) => void, values: readonly unknown[]): void {
  it(`refuses ${field} that is none of ${values.map((value) => JSON.stringify(value)).join(", ")}`, () => {
    for (const value of values) {
      const body = clone(good());
      set(body, value);
      refuses(check, body, field, what);
    }
  });
}

const ISSUANCE = /^data API MPT issuance answered something unexpected: /;
const HOLDERS = /^data API MPT holders answered something unexpected: /;
const TRANSFERS = /^data API MPT transfers answered something unexpected: /;
const LOOKUP = /^data API MPT lookup answered something unexpected: /;
const TOKENS = /^data API MPT tokens answered something unexpected: /;

const ASKED = [MPT_SAMPLE_ID, MPT_SAMPLE_SECOND_ID];
const checkLookup = (body: unknown) => checkMptLookup(body, ASKED);

/** An X-address (a classic address with a tag flag): it holds a tag, and a page links accounts. */
const X_ADDRESS = classicAddressToXAddress(MPT_SAMPLE_ISSUER, 4242, false);

describe("checkMptIssuance", () => {
  const good = () => mptSample();
  pins(checkMptIssuance, ISSUANCE, good, [
    ["a missing coverage", "coverage", (body) => delete body.coverage],
    ["a coverage that says nothing of being complete", "coverage.complete", (body) => delete body.coverage.complete],
    ["no issuance", "issuance", (body) => delete body.issuance],
    ["a lower-case ID", "mpt_issuance_id", (body) => (body.issuance.mpt_issuance_id = MPT_SAMPLE_ID.toLowerCase())],
    ["an ID of 47 digits", "mpt_issuance_id", (body) => (body.issuance.mpt_issuance_id = MPT_SAMPLE_ID.slice(1))],
    ["an issuer that is no address", "issuer", (body) => (body.issuance.issuer = "rBad")],
    ["an X-address as the issuer", "issuer", (body) => (body.issuance.issuer = X_ADDRESS)],
    ["a sequence that is not 32 bits", "sequence", (body) => (body.issuance.sequence = 4_294_967_296)],
    ["a ticker that is no text", "ticker", (body) => (body.issuance.ticker = 7)],
    ["a missing outstanding amount", "outstanding_amount", (body) => delete body.issuance.outstanding_amount],
    ["a missing escrowed amount", "escrowed_amount", (body) => delete body.issuance.escrowed_amount],
    ["a locked amount that is a decimal", "locked_amount", (body) => (body.issuance.locked_amount = "1.5")],
    ["a maximum amount of 20 digits", "maximum_amount", (body) => (body.issuance.maximum_amount = "12345678901234567890")],
    ["holders that are not a whole number", "holders", (body) => (body.issuance.holders = 3412.5)],
    ["locked holders that are negative", "locked_holders", (body) => (body.issuance.locked_holders = -1)],
    ["a transfer fee above 50000", "transfer_fee", (body) => (body.issuance.transfer_fee = 50_001)],
    ["a flag that is no boolean", "flags", (body) => (body.issuance.flags.can_lock = "yes")],
    ["a flag that is missing", "flags", (body) => delete body.issuance.flags.can_clawback],
    ["no flags", "flags", (body) => delete body.issuance.flags],
    ["metadata that is no object", "issuance.metadata", (body) => (body.issuance.metadata = "text")],
    ["a metadata name that is no text", "issuance.metadata.name", (body) => (body.issuance.metadata.name = 7)],
    ["a uri that is no text", "uris[0]", (body) => (body.issuance.metadata.uris[0].uri = 7)],
    ["a uri item with no uri", "uris[0]", (body) => delete body.issuance.metadata.uris[0].uri],
    ["metadata uris that are no list", "uris", (body) => (body.issuance.metadata.uris = "harborline.example")],
    ["metadata_hex that is not hex", "metadata_hex", (body) => (body.issuance.metadata_hex = "not hex")],
    ["metadata_hex of an odd number of digits", "metadata_hex", (body) => (body.issuance.metadata_hex = "7B2")],
    ["metadata_conforms that is no boolean", "metadata_conforms", (body) => (body.issuance.metadata_conforms = 1)],
    ["a creation ledger that is not whole", "created_ledger", (body) => (body.issuance.created_ledger = "99412004")],
    ["a creation time that is no time", "created_time", (body) => (body.issuance.created_time = "2025-10-09")],
    ["a creation hash that is no hash", "created_tx_hash", (body) => (body.issuance.created_tx_hash = "ABC")],
    ["a missing last ledger", "last_ledger", (body) => delete body.issuance.last_ledger],
    ["a missing destroyed", "destroyed", (body) => delete body.issuance.destroyed],
  ]);

  refusesEach(checkMptIssuance, ISSUANCE, good, "outstanding_amount", (body, value) => (body.issuance.outstanding_amount = value), NOT_AMOUNTS);
  refusesEach(checkMptIssuance, ISSUANCE, good, "asset_scale", (body, value) => (body.issuance.asset_scale = value), [1.5, -1, 256, "2", null]);

  it("takes an asset scale of 0, 19, 25 and 255 (the ledger allows 255; a page shows one above 19 unscaled)", () => {
    for (const scale of [0, 19, 25, 255]) {
      const body = mptSample({ issuance: mptIssuanceSample({ asset_scale: scale }) });
      expect(checkMptIssuance(body), String(scale)).toBe(body);
    }
  });

  it("takes a transfer fee of 0 and of 50000, and an amount of 1 and of 19 digits", () => {
    for (const fee of [0, 50_000]) {
      const body = mptSample({ issuance: mptIssuanceSample({ transfer_fee: fee }) });
      expect(checkMptIssuance(body), String(fee)).toBe(body);
    }
    for (const amount of ["0", "1", "9223372036854775807"]) {
      const body = mptSample({ issuance: mptIssuanceSample({ outstanding_amount: amount, maximum_amount: amount }) });
      expect(checkMptIssuance(body), amount).toBe(body);
    }
  });

  it("takes an issuance with none of the keys the API leaves out: no ticker, name, maximum, metadata, hex, conformance or creation", () => {
    const issuance: Body = mptIssuanceSample({ destroyed: true });
    for (const key of ["ticker", "name", "maximum_amount", "metadata", "metadata_hex", "metadata_conforms", "created_ledger", "created_time", "created_tx_hash"]) delete issuance[key];
    const body = mptSample({ issuance });
    expect(checkMptIssuance(body)).toBe(body);
  });

  it("takes an issuance whose metadata decoded to nothing the page reads (an empty object), and one with a flag beside the seven", () => {
    for (const issuance of [mptIssuanceSample({ metadata: {}, metadata_conforms: false }), mptIssuanceSample({ flags: { ...mptSample().issuance.flags, can_mutate: true } as never })]) {
      const body = mptSample({ issuance });
      expect(checkMptIssuance(body)).toBe(body);
    }
  });

  it("takes metadata the issuer wrote as it likes, as long as D9's decoding left text where it keeps text: any additional_info, and a uri with no category or title", () => {
    for (const metadata of [
      { additional_info: { fund: [1, 2, { three: null }] } },
      { additional_info: "free text" },
      { uris: [{ uri: "x" }, { uri: "", category: "other", title: "" }] },
      { name: "", desc: "<script>alert(1)</script>" },
    ]) {
      const body = mptSample({ issuance: mptIssuanceSample({ metadata }) });
      expect(checkMptIssuance(body)).toBe(body);
    }
  });

  it("names the request in its message when the client gives the path, and the route when it does not", () => {
    const body = clone(good()) as Body;
    delete body.coverage;
    expect(() => checkMptIssuance(body, `/v2/mpt/${MPT_SAMPLE_ID}`)).toThrow(`data API GET /v2/mpt/${MPT_SAMPLE_ID} answered something unexpected: coverage is not an object`);
    expect(() => checkMptIssuance(body)).toThrow("data API MPT issuance answered something unexpected: coverage is not an object");
  });

  it.each([[null], [undefined], ["success"], [3], [[]], [[{ coverage: { complete: true } }]]])("refuses %j, which is no answer at all", (body) => {
    expect(() => checkMptIssuance(body)).toThrow(UpstreamError);
  });
});

describe("checkMptHoldersPage", () => {
  const good = () => mptHoldersSample();
  pins(checkMptHoldersPage, HOLDERS, good, [
    ["a missing coverage", "coverage", (body) => delete body.coverage],
    ["a count that is not whole", "count", (body) => (body.count = "2")],
    ["a marker that is none", "marker", (body) => (body.marker = "not a marker!")],
    ["no holders", "holders", (body) => delete body.holders],
    ["a holder that is no object", "holders[1]", (body) => (body.holders[1] = "r")],
    ["a holder that is no address", "holders[0].holder", (body) => (body.holders[0].holder = "rBad")],
    ["a holder that is an X-address", "holders[0].holder", (body) => (body.holders[0].holder = X_ADDRESS)],
    ["an amount that is a decimal", "holders[0].amount", (body) => (body.holders[0].amount = "1.5")],
    ["a missing escrowed amount", "holders[1].escrowed_amount", (body) => delete body.holders[1].escrowed_amount],
    ["a locked that is no boolean", "holders[0].locked", (body) => (body.holders[0].locked = 0)],
    ["an authorized that is missing", "holders[0].authorized", (body) => delete body.holders[0].authorized],
  ]);

  refusesEach(checkMptHoldersPage, HOLDERS, good, "holders[0].amount", (body, value) => (body.holders[0].amount = value), NOT_AMOUNTS);

  it("takes the last page, with no marker, and a page with no holders at all", () => {
    for (const body of [mptHoldersSample({ marker: undefined }), mptHoldersSample({ count: 0, marker: undefined, holders: [] }), mptHoldersSample({ holders: [mptHolderSample({ amount: "0", escrowed_amount: "0" })] })]) {
      expect(checkMptHoldersPage(body)).toBe(body);
    }
  });

  it("names the request when the client gives the path", () => {
    const body = clone(good()) as Body;
    delete body.holders;
    expect(() => checkMptHoldersPage(body, `/v2/mpt/${MPT_SAMPLE_ID}/holders?limit=10`)).toThrow(`data API GET /v2/mpt/${MPT_SAMPLE_ID}/holders?limit=10 answered something unexpected: no list of holders`);
  });
});

describe("checkMptTransfersPage", () => {
  const good = () => mptTransfersSample();
  pins(checkMptTransfersPage, TRANSFERS, good, [
    ["a missing coverage", "coverage", (body) => delete body.coverage],
    ["no transfers", "transfers", (body) => delete body.transfers],
    ["a ledger that is not whole", "transfers[0].ledger_index", (body) => (body.transfers[0].ledger_index = 1.5)],
    ["a missing transaction index", "transfers[0].tx_index", (body) => delete body.transfers[0].tx_index],
    ["a hash that is no hash", "transfers[0].tx_hash", (body) => (body.transfers[0].tx_hash = "ABC")],
    ["a time that is no time", "transfers[1].executed_time", (body) => (body.transfers[1].executed_time = "2026-10-24 14:10:41")],
    ["a type that is empty", "transfers[0].tx_type", (body) => (body.transfers[0].tx_type = "")],
    ["a kind that is mint", "transfers[0].kind", (body) => (body.transfers[0].kind = "mint")],
    ["a missing kind", "transfers[0].kind", (body) => delete body.transfers[0].kind],
    ["a source that is no address", "transfers[0].source", (body) => (body.transfers[0].source = "rBad")],
    ["a destination that is an X-address", "transfers[0].destination", (body) => (body.transfers[0].destination = X_ADDRESS)],
    ["a missing amount", "transfers[0].amount", (body) => delete body.transfers[0].amount],
    ["a fee that is a decimal", "transfers[0].fee", (body) => (body.transfers[0].fee = "0.5")],
  ]);

  refusesEach(checkMptTransfersPage, TRANSFERS, good, "transfers[0].amount", (body, value) => (body.transfers[0].amount = value), NOT_AMOUNTS);

  it("takes every kind D9 has, a lock with no destination, a row with no source, and a fee", () => {
    const kinds = ["payment", "clawback", "lock", "unlock", "escrow_create", "escrow_finish", "escrow_cancel"] as const;
    const transfers = kinds.map((kind, index) => mptTransferSample({ kind, tx_index: index }));
    const body = mptTransfersSample({ count: 9, transfers: [...transfers, mptLockSample(), mptTransferSample({ source: undefined, fee: "5890" })] });
    expect(checkMptTransfersPage(body)).toBe(body);
    expect(mptLockSample()).not.toHaveProperty("destination");
  });
});

describe("checkMptLookup", () => {
  const good = () => mptLookupSample();
  const lookups: Defect[] = [
    ["a count that is not whole", "count", (body) => (body.count = 2.5)],
    ["no issuances", "issuances", (body) => delete body.issuances],
    ["one entry fewer than IDs asked", "1 issuances where 2 were asked for", (body) => body.issuances.pop()],
    ["one entry more than IDs asked", "3 issuances where 2 were asked for", (body) => body.issuances.push({ mpt_issuance_id: MPT_SAMPLE_THIRD_ID })],
    ["a second entry that is another ID", "issuances[1]", (body) => (body.issuances[1] = { mpt_issuance_id: MPT_SAMPLE_THIRD_ID })],
    ["the entries in another order", "issuances[0]", (body) => body.issuances.reverse()],
    ["an entry that is no object", "issuances[1]", (body) => (body.issuances[1] = MPT_SAMPLE_SECOND_ID)],
    ["a summary with a lower-case ID", "issuances[0]", (body) => (body.issuances[0].mpt_issuance_id = MPT_SAMPLE_ID.toLowerCase())],
    ["a summary with no issuer", "issuances[0].issuer", (body) => delete body.issuances[0].issuer],
    ["a summary with an issuer that is no address", "issuances[0].issuer", (body) => (body.issuances[0].issuer = "rBad")],
    ["a summary with an amount of 1.5", "issuances[0].outstanding_amount", (body) => (body.issuances[0].outstanding_amount = "1.5")],
    ["a summary with an asset scale of 256", "issuances[0].asset_scale", (body) => (body.issuances[0].asset_scale = 256)],
    ["a summary with a transfer fee of 50001", "issuances[0].transfer_fee", (body) => (body.issuances[0].transfer_fee = 50_001)],
    ["a summary with no flags", "issuances[0].flags", (body) => delete body.issuances[0].flags],
    ["a summary with no destroyed", "issuances[0].destroyed", (body) => delete body.issuances[0].destroyed],
    ["a bare entry with a key of a summary but not the rest", "issuances[1].issuer", (body) => (body.issuances[1].asset_scale = 2)],
  ];
  it("takes the example, and returns it as it is", () => {
    const body = good();
    expect(checkLookup(body)).toBe(body);
  });
  it.each(lookups)("refuses %s", (_what, field, change) => {
    const body = clone(good());
    change(body);
    refuses(checkLookup, body, field, LOOKUP);
  });

  it("has no coverage, and takes none", () => {
    expect(good()).not.toHaveProperty("coverage");
  });

  it("takes an entry for each ID asked, bare or a summary, and a destroyed one", () => {
    const asked = [MPT_SAMPLE_ID, MPT_SAMPLE_SECOND_ID, MPT_SAMPLE_THIRD_ID];
    const body = mptLookupSample({
      count: 3,
      issuances: [{ mpt_issuance_id: MPT_SAMPLE_ID }, mptSummarySample({ mpt_issuance_id: MPT_SAMPLE_SECOND_ID, destroyed: true, ticker: undefined, name: undefined, maximum_amount: undefined }), { mpt_issuance_id: MPT_SAMPLE_THIRD_ID }],
    });
    expect(checkMptLookup(body, asked)).toBe(body);
  });

  it("takes one ID asked, and refuses an answer for more than that", () => {
    const one = mptLookupSample({ count: 1, issuances: [mptSummarySample()] });
    expect(checkMptLookup(one, [MPT_SAMPLE_ID])).toBe(one);
    expect(() => checkMptLookup(good(), [MPT_SAMPLE_ID])).toThrow("2 issuances where 1 were asked for");
  });

  it("names the request when the client gives the path", () => {
    const body = clone(good()) as Body;
    body.issuances.pop();
    expect(() => checkMptLookup(body, ASKED, "/v2/mpt?ids=x")).toThrow("data API GET /v2/mpt?ids=x answered something unexpected: 1 issuances where 2 were asked for");
  });

  it.each([[null], [undefined], ["success"], [3], [[]]])("refuses %j, which is no answer at all", (body) => {
    expect(() => checkLookup(body)).toThrow(UpstreamError);
  });
});

describe("checkMptTokens", () => {
  const good = () => mptTokensSample();
  pins(checkMptTokens, TOKENS, good, [
    ["a missing coverage", "coverage", (body) => delete body.coverage],
    ["a body of issued tokens", "kind", (body) => (body.kind = "issued")],
    ["a missing kind", "kind", (body) => delete body.kind],
    ["a ledger that is not whole", "ledger_index", (body) => (body.ledger_index = "107795512")],
    ["a close time that is no time", "close_time", (body) => (body.close_time = "yesterday")],
    ["totals that are no object", "totals", (body) => (body.totals = 214)],
    ["totals with no holders", "totals.holders", (body) => delete body.totals.holders],
    ["totals with transfers that are not whole", "totals.transfers_24h", (body) => (body.totals.transfers_24h = 2415.5)],
    ["a total that is not whole", "total", (body) => (body.total = -1)],
    ["a total below that is not whole", "total_below", (body) => (body.total_below = "3")],
    ["a count that is not whole", "count", (body) => (body.count = null)],
    ["a marker that is none", "marker", (body) => (body.marker = "not a marker!")],
    ["no tokens", "tokens", (body) => delete body.tokens],
    ["a rank that is not whole", "tokens[0].rank", (body) => (body.tokens[0].rank = 1.5)],
    ["a missing rank", "tokens[0].rank", (body) => delete body.tokens[0].rank],
    ["a lower-case ID", "tokens[0].mpt_issuance_id", (body) => (body.tokens[0].mpt_issuance_id = MPT_SAMPLE_ID.toLowerCase())],
    ["an issuer that is no address", "tokens[0].issuer", (body) => (body.tokens[0].issuer = "rBad")],
    ["a name that is no text", "tokens[0].name", (body) => (body.tokens[0].name = 7)],
    ["an asset scale of 1.5", "tokens[0].asset_scale", (body) => (body.tokens[0].asset_scale = 1.5)],
    ["a maximum of 20 digits", "tokens[0].maximum_amount", (body) => (body.tokens[0].maximum_amount = "12345678901234567890")],
    ["an outstanding amount of -1", "tokens[0].outstanding_amount", (body) => (body.tokens[0].outstanding_amount = "-1")],
    ["holders that are not whole", "tokens[0].holders", (body) => (body.tokens[0].holders = 3412.5)],
    ["a transfer fee of 50001", "tokens[0].transfer_fee", (body) => (body.tokens[0].transfer_fee = 50_001)],
    ["flags that are missing", "tokens[0].flags", (body) => delete body.tokens[0].flags],
    ["transfers in 24 hours that are missing", "tokens[0].transfers_24h", (body) => delete body.tokens[0].transfers_24h],
  ]);

  refusesEach(checkMptTokens, TOKENS, good, "tokens[0].outstanding_amount", (body, value) => (body.tokens[0].outstanding_amount = value), NOT_AMOUNTS);

  it("takes a list before the first generation exists: no totals, no total, no ledger and no tokens (D9's `nothing to list`)", () => {
    const body: Body = mptTokensSample({ count: 0, tokens: [] });
    for (const key of ["totals", "total", "ledger_index", "close_time"]) delete body[key];
    expect(checkMptTokens(body)).toBe(body);
  });

  it("takes a search that matched nothing, a row with no ticker, name or maximum, a total below, and a page with a marker", () => {
    const row: Body = mptTokenRowSample({ rank: 2 });
    for (const key of ["ticker", "name", "maximum_amount"]) delete row[key];
    for (const body of [mptTokensSample({ total: 0, count: 0, tokens: [] }), mptTokensSample({ count: 2, total: 25, total_below: 3, marker: "WzMsImkiXQ", tokens: [mptTokenRowSample(), row] })]) {
      expect(checkMptTokens(body)).toBe(body);
    }
  });

  it("takes an incomplete coverage, which is the page's to say, and refuses one that is no coverage", () => {
    const incomplete = mptTokensSample({ coverage: { from_ledger_index: 99226369, complete: false } });
    expect(checkMptTokens(incomplete)).toBe(incomplete);
    const body = clone(good()) as Body;
    body.coverage = { complete: "no" };
    refuses(checkMptTokens, body, "coverage.complete", TOKENS);
  });
});
