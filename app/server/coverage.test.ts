import { describe, expect, it } from "vitest";

import { checkCoverage, coverageNote } from "./coverage";
import { UpstreamError } from "./upstream";

// The coverage of an answer of the data API (data-api-new D3, docs/api-reference.md "Coverage"): the key after `result`.

describe("checkCoverage", () => {
  it("returns { from_ledger_index, complete } and { complete } alone", () => {
    const whole = { from_ledger_index: 107874617, complete: false };
    expect(checkCoverage({ result: "success", coverage: whole })).toEqual({ from_ledger_index: 107874617, complete: false });
    // The coverage is the answer's own object, as it is: not a copy, and nothing added.
    expect(checkCoverage({ result: "success", coverage: whole })).toBe(whole);
    // No ledger is stored at all: the key is left out and the coverage is not complete; a feature a network cannot have is complete and has none either.
    expect(checkCoverage({ result: "success", coverage: { complete: false } })).toEqual({ complete: false });
    expect(checkCoverage({ result: "success", coverage: { complete: true } })).toEqual({ complete: true });
    expect(checkCoverage({ result: "success", coverage: { from_ledger_index: 1, complete: true } })).toEqual({ from_ledger_index: 1, complete: true });
  });

  it.each([
    ["complete a string", { complete: "false" }],
    ["complete a number", { from_ledger_index: 5, complete: 0 }],
    ["without complete", { from_ledger_index: 5 }],
    ["a negative ledger", { from_ledger_index: -1, complete: false }],
    ["a fractional ledger", { from_ledger_index: 1.5, complete: false }],
    ["a ledger of zero", { from_ledger_index: 0, complete: false }],
    ["a ledger that is text", { from_ledger_index: "107874617", complete: false }],
    ["a ledger that is null", { from_ledger_index: null, complete: false }],
    ["a ledger beyond the whole numbers", { from_ledger_index: 2 ** 53, complete: false }],
    ["not an object", "x"],
    ["a list", [{ complete: true }]],
    ["null", null],
    ["missing", undefined],
  ])("refuses a coverage that is %s with a server error", (_what, coverage) => {
    let error: unknown;
    try {
      checkCoverage({ result: "success", coverage });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).kind).toBe("server");
    // Status 200: an answer of the upstream that is not what its reference promises.
    expect((error as UpstreamError).status).toBe(200);
    expect((error as UpstreamError).message).toMatch(/^the answer: coverage/);
  });

  it("refuses a body that is no object, as one without a coverage", () => {
    for (const body of [undefined, null, "success", 7, [{ complete: true }]]) {
      expect(() => checkCoverage(body), String(body)).toThrow(UpstreamError);
    }
  });

  it("begins its message with the path it is given, the request of a shape check", () => {
    expect(() => checkCoverage({ result: "success" }, "data API GET /v2/nfts/00 answered something unexpected")).toThrow(
      "data API GET /v2/nfts/00 answered something unexpected: coverage is not an object",
    );
    expect(() => checkCoverage({ coverage: { complete: 1 } })).toThrow("the answer: coverage.complete is not a boolean");
    expect(() => checkCoverage({ coverage: { from_ledger_index: 0, complete: true } })).toThrow("the answer: coverage.from_ledger_index is not a positive whole number");
  });
});

// What a list says of the history the index does not hold (spec 8): the line is made of three parts, so that the page can draw the ledger as a link.

describe("coverageNote", () => {
  it("is null when the coverage is complete, whatever else it holds", () => {
    expect(coverageNote({ from_ledger_index: 75443457, complete: true }, "NFT sales")).toBeNull();
    expect(coverageNote({ complete: true }, "NFT sales")).toBeNull();
    expect(coverageNote({ from_ledger_index: 1, complete: true }, "events of this NFT", "This NFT's history")).toBeNull();
  });

  it("says where the history starts, in three parts around the ledger", () => {
    expect(coverageNote({ from_ledger_index: 96100001, complete: false }, "NFT sales")).toEqual({
      before: "Covers ledger ",
      ledger: 96100001,
      after: " onwards: earlier NFT sales are not in the index yet.",
    });
    expect(coverageNote({ from_ledger_index: 96100001, complete: false }, "collections")).toEqual({
      before: "Covers ledger ",
      ledger: 96100001,
      after: " onwards: earlier collections are not in the index yet.",
    });
  });

  it("starts with the subject when it is given, as on an NFT's page", () => {
    expect(coverageNote({ from_ledger_index: 96100001, complete: false }, "events of this NFT", "This NFT's history")).toEqual({
      before: "This NFT's history in the index starts at ledger ",
      ledger: 96100001,
      after: ": earlier events of this NFT are not in the index yet.",
    });
  });

  it("gives a ledger that the index does not hold yet (the newest stored one plus 1) as any other", () => {
    // D3: `from_ledger_index` is one above the newest ledger an older parser wrote, which can be the ledger after the newest stored one.
    expect(coverageNote({ from_ledger_index: 107874618, complete: false }, "NFT activity")?.ledger).toBe(107874618);
  });

  it("says the index holds no history yet when no ledger is stored (no from_ledger_index), with or without a subject", () => {
    const none = { before: "The index does not hold this history yet.", ledger: null, after: "" };
    expect(coverageNote({ complete: false }, "NFT sales")).toEqual(none);
    expect(coverageNote({ complete: false }, "events of this NFT", "This NFT's history")).toEqual(none);
  });
});
