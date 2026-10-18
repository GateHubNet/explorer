import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { nodeFile } from "../support/upstream-core";

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
