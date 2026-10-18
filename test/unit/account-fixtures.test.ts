import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { dataApiFile, nodeFile } from "../support/upstream-core";

// The account page asks the node for the objects of an account with `limit: 400`, and a fixture is found by every parameter of the
// request but its subject (upstream-core.ts), so the active accounts have the file for that request next to the one without a limit.

const ACTIVE = { xrpl: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", xahau: "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto" } as const;
const read = (path: string) => readFileSync(new URL(`../fixtures/http/${path}`, import.meta.url), "utf8");

describe.each(Object.entries(ACTIVE) as Array<["xrpl" | "xahau", string]>)("the objects of the active %s account", (net, address) => {
  it("is found at the file the page's request names, which is a byte copy of the file without a limit", () => {
    const request = { account: address, ledger_index: "validated", limit: 400 };
    const file = nodeFile(net, "account_objects", request);
    expect(file).toBe(`${net}/node/account_objects/${address}@limit=400.json`);
    expect(read(file!)).toBe(read(`${net}/node/account_objects/${address}.json`));
  });
});

// An address neither the index nor the node knows has its history asked for as one row (`?limit=1`, oldest first) before the page says it
// was never activated; the fixtures answer that as the real API does for an address with no rows: an empty list.
const NEVER_FUNDED = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";

describe.each(["xrpl", "xahau"] as const)("the never-funded address on %s", (net) => {
  it("has an empty page for the probe of its history, at the file the page's request names", () => {
    const file = dataApiFile(net, `/v2/accounts/${NEVER_FUNDED}/transactions`, "limit=1");
    expect(file).toBe(`${net}/data-api/accounts/${NEVER_FUNDED}/transactions@limit=1.json`);
    expect(JSON.parse(read(file!))).toEqual({ count: 0, result: "success", transactions: [] });
  });

  // As the account objects' file for `limit=400` is a copy of the one without a limit: one answer, two requests that ask for it.
  it("is a byte copy of the address's history page, which is empty too", () => {
    const history = `${net}/data-api/accounts/${NEVER_FUNDED}/transactions@descending=true&limit=20.json`;
    expect(read(`${net}/data-api/accounts/${NEVER_FUNDED}/transactions@limit=1.json`)).toBe(read(history));
  });
});

// PROVENANCE.md says where each fixture came from; these two are derived by hand, so it says which they are and what keeps them true.
describe("PROVENANCE.md", () => {
  const provenance = readFileSync(new URL("../fixtures/PROVENANCE.md", import.meta.url), "utf8");

  it.each(["rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC", "transactions@limit=1.json", "transactions@descending=true&limit=20.json", "xrpl", "xahau"])(
    "has a row for the one-row probe of the never-funded address's history (%s)",
    (word) => {
      const row = provenance.split("\n").find((line) => line.startsWith("|") && line.includes("transactions@limit=1.json"));
      expect(row, "a table row naming transactions@limit=1.json").toBeDefined();
      expect(row).toContain(word);
    },
  );
});
