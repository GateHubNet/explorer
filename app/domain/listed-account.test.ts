import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../../test/support/value-imports";
import type { AccountNameEntry } from "../server/api-types";
import { shortAddress } from "./format";
import { listedAccount } from "./listed-account";
import { nameViewOf, type NameMap } from "./names";

// Fictional names and `*.example` domains, as the data API's reference writes them.
const A = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const B = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const C = "rrrrrrrrrrrrrrrrrrrrBZbvji";
const D = "rLUEXYuLiQptky37CqLcm9USQpPiz5rkpD";
const E = "rBg5JN5ShW8ZRV1TJhxVJRYcXVbPGC3ARi";

const verified: AccountNameEntry = { address: A, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example" };
const named: AccountNameEntry = {
  address: B,
  display_name: { text: "Harborline Exchange", kind: "account" },
  account_name: "Harborline Exchange",
  account_network_name: "hot wallet",
  labels: { advisory: { description: "Withdrawals paused" } },
};

describe("listedAccount", () => {
  const names: NameMap = {
    [A]: nameViewOf({ ...verified, labels: { scam: { description: "Reported" } } })!,
    [B]: nameViewOf({ ...named, labels: undefined })!,
    [D]: nameViewOf({ address: D, display_name: { text: "lowtide.example", kind: "domain" }, domain: "lowtide.example" })!,
    [E]: { labels: ["scam", "spam"] },
    [C]: { network: "hot wallet", labels: [] },
  };

  it("is the account's name for the label, its short address for the sublabel and the name's kind for the mark, for every kind of name", () => {
    expect(listedAccount(B, names)).toEqual({ label: "Harborline Exchange · hot wallet", sublabel: shortAddress(B), mark: { kind: "account", labels: [] } });
    expect(listedAccount(D, names)).toEqual({ label: "lowtide.example", sublabel: shortAddress(D), mark: { kind: "domain", labels: [] } });
    expect(listedAccount(A, { [A]: nameViewOf(verified)! })).toEqual({ label: "Northpeak Treasury", sublabel: shortAddress(A), mark: { kind: "verified", labels: [] } });
  });

  it("carries the labels of a named account in the same mark", () => {
    expect(listedAccount(A, names)).toEqual({ label: "Northpeak Treasury", sublabel: shortAddress(A), mark: { kind: "verified", labels: ["scam"] } });
  });

  it("keeps the short address for the label of an account that has labels only, and marks them", () => {
    expect(listedAccount(E, names)).toEqual({ label: shortAddress(E), mark: { labels: ["scam", "spam"] } });
  });

  it("is the short address, with no sublabel and no mark, for an account the map does not hold, and for one with nothing to draw but an account network name", () => {
    const plain = { label: shortAddress(E) };
    expect(listedAccount(E, {})).toEqual(plain);
    expect(listedAccount(E, {})).not.toHaveProperty("mark");
    expect(listedAccount(C, names)).toEqual({ label: shortAddress(C) });
    expect(listedAccount(C, names)).not.toHaveProperty("sublabel");
    expect(listedAccount(C, names)).not.toHaveProperty("mark");
  });

  it("does not share the labels of the view it was given", () => {
    const view = names[A]!;
    expect(listedAccount(A, names).mark!.labels).not.toBe(view.labels);
  });
});

describe("the browser bundle", () => {
  // The pair page's merge of a beat is browser code and imports this file, so it is pure: two files of the domain, nothing of app/server.
  const appDir = new URL("../", import.meta.url);

  it("imports no value from the server, and loads only pure files of the domain", () => {
    const source = readFileSync(new URL("domain/listed-account.ts", appDir), "utf8");
    expect(valueImports(source).sort()).toEqual(["./format", "./names"]);
    expect(staticClosure(appDir, "domain/listed-account.ts").filter((file) => file.startsWith("server/"))).toEqual([]);
  });
});
