import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../../test/support/value-imports";
import { channelStatus, checkStatus, escrowStatus } from "./object-status";

// The rules are D5's (data-api-new `feat/explorer-data-2` at 0c2e58c, `apps/api/src/ledger-objects/object-status.ts`, spec 5.2); these are the cases of its object-status.spec.ts.
// F = 1000, C = 2000, E = 3000 (unix seconds).
describe("escrowStatus", () => {
  it("is pending up to finish_after, can_be_finished after it, and can_be_cancelled after cancel_after", () => {
    expect([999, 1000, 1001, 2000, 2001].map((t) => escrowStatus({ finishAfter: 1000, cancelAfter: 2000 }, t))).toEqual([
      "pending",
      "pending",
      "can_be_finished",
      "can_be_finished",
      "can_be_cancelled",
    ]);
  });

  it("can be finished from its creation without finish_after", () => {
    expect([escrowStatus({ cancelAfter: 2000 }, 1), escrowStatus({}, 1)]).toEqual(["can_be_finished", "can_be_finished"]);
  });

  it("is what the deleting event says once it is deleted, whatever the time", () => {
    expect(["finish", "cancel", "removed"].map((e) => escrowStatus({ finishAfter: 1000, removedBy: e }, 1))).toEqual(["finished", "cancelled", "removed"]);
    expect(escrowStatus({ finishAfter: 1000, cancelAfter: 2000, removedBy: "finish" }, 5000)).toBe("finished");
  });

  it("is can_be_cancelled from cancel_after even when that is before finish_after", () => {
    expect([escrowStatus({ finishAfter: 200, cancelAfter: 100 }, 100), escrowStatus({ finishAfter: 200, cancelAfter: 100 }, 101)]).toEqual(["pending", "can_be_cancelled"]);
  });

  it("is removed for an event it does not know", () => {
    expect(escrowStatus({ removedBy: "update" }, 0)).toBe("removed");
  });
});

describe("checkStatus", () => {
  it("is open until its expiration and expired from it", () => {
    expect([2999, 3000].map((t) => checkStatus({ expiration: 3000 }, t))).toEqual(["open", "expired"]);
    expect(checkStatus({}, 9_999_999_999)).toBe("open");
  });

  it("is what the deleting event says once it is deleted, whatever the time", () => {
    expect(["cash", "cancel", "removed"].map((e) => checkStatus({ removedBy: e }, 1))).toEqual(["cashed", "cancelled", "removed"]);
    expect(checkStatus({ expiration: 3000, removedBy: "cash" }, 5000)).toBe("cashed");
  });
});

describe("channelStatus", () => {
  it("is closing once an expiration is set, or from cancel_after, else open", () => {
    expect([channelStatus({ expiration: 9_999_999 }, 1), channelStatus({ cancelAfter: 2000 }, 1999), channelStatus({ cancelAfter: 2000 }, 2000)]).toEqual(["closing", "open", "closing"]);
    expect(channelStatus({}, 1)).toBe("open");
  });

  it("is closing with an expiration far in the future, whatever the time", () => {
    expect([0, 1e12 - 1].map((t) => channelStatus({ expiration: 1e12 }, t))).toEqual(["closing", "closing"]);
  });

  it("is what the deleting event says once it is deleted, whatever the time", () => {
    expect(["close", "removed"].map((e) => channelStatus({ removedBy: e }, 1))).toEqual(["closed", "removed"]);
    expect(channelStatus({ expiration: 3000, removedBy: "close" }, 5000)).toBe("closed");
  });
});

describe("the rules over the recordings", () => {
  // The files `pnpm fixtures:sync` wrote, as they are: the node's entry of each object still in the ledger (`node/ledger_entry/<ID>.json`, a time in the Ripple epoch as the node writes
  // it) and the index's answer for the same ID (`data-api/{escrows|checks|payment_channels}/<ID>.json`, whose `close_time` is the point both are as of).
  const HTTP = new URL("../../test/fixtures/http/", import.meta.url);
  const RIPPLE_EPOCH = 946_684_800;
  const ROUTE = { Escrow: "escrows", Check: "checks", PayChannel: "payment_channels" } as const;
  const KEY = { Escrow: "escrow", Check: "check", PayChannel: "payment_channel" } as const;
  type Type = keyof typeof ROUTE;
  type Json = Record<string, any>;
  const isType = (type: unknown): type is Type => typeof type === "string" && type in ROUTE;
  const json = (url: URL): Json => JSON.parse(readFileSync(url, "utf8")) as Json;
  const unix = (ripple: unknown): number | undefined => (typeof ripple === "number" ? ripple + RIPPLE_EPOCH : undefined);

  /** The files of the index's answers of a type on a network (an object's history is a directory beside its answer, and is not a file of the answers). */
  const answered = (net: string, type: Type): Set<string> => new Set(readdirSync(new URL(`${net}/data-api/${ROUTE[type]}/`, HTTP)));

  /** The status the rules give a node's entry (nothing in it says it was deleted) at `t`. */
  function statusOf(type: Type, node: Json, t: number): string {
    if (type === "Escrow") return escrowStatus({ finishAfter: unix(node.FinishAfter), cancelAfter: unix(node.CancelAfter) }, t);
    if (type === "Check") return checkStatus({ expiration: unix(node.Expiration) }, t);
    return channelStatus({ expiration: unix(node.Expiration), cancelAfter: unix(node.CancelAfter) }, t);
  }

  // What the node's files hold, pinned (a generator change that moves them is read here, not passed over):
  // - COMPARED: the entries that have an answer of the index, whose statuses are held to it;
  // - NODE_ONLY: XRPL's node fallback, an open escrow and an open check the generator leaves out of the index on purpose, so that a page reads them from the node alone (the "Ledger object
  //   answers" of test/fixtures/PROVENANCE.md): their entries have no answer of the index to agree with;
  // - NOT_OBJECTS: the entries of a type that has no status, by type (the Delegate of the delegation, the MPTokenIssuance of E14's `nodeOnly`, Xahau's URITokens).
  const COMPARED = { xrpl: 21, xahau: 4 } as const;
  const NODE_ONLY = { xrpl: 2, xahau: 0 } as const;
  const NOT_OBJECTS = { xrpl: { Delegate: 1, MPTokenIssuance: 1 }, xahau: { URIToken: 2 } } as const;

  it("agrees with every derived answer of the recordings", () => {
    const seen = new Set<string>();
    for (const net of ["xrpl", "xahau"] as const) {
      const dir = new URL(`${net}/node/ledger_entry/`, HTTP);
      let compared = 0;
      let nodeOnly = 0;
      const notObjects: Record<string, number> = {};
      for (const name of readdirSync(dir).filter((each) => each.endsWith(".json"))) {
        const entry = json(new URL(name, dir)).result;
        const node = entry.node as Json;
        if (!isType(node.LedgerEntryType)) {
          notObjects[node.LedgerEntryType] = (notObjects[node.LedgerEntryType] ?? 0) + 1;
          continue;
        }
        const type = node.LedgerEntryType;
        if (!answered(net, type).has(`${node.index}.json`)) {
          nodeOnly++;
          continue;
        }
        const answer = json(new URL(`${net}/data-api/${ROUTE[type]}/${node.index}.json`, HTTP));
        // Both are as of the same ledger, and the answer says when it closed.
        expect(answer.ledger_index, name).toBe(entry.ledger_index);
        const closeTime = Date.parse(answer.close_time as string) / 1000;
        expect(Number.isInteger(closeTime), name).toBe(true);
        const status = statusOf(type, node, closeTime);
        expect(status, `${net} ${type} ${node.index}`).toBe(answer[KEY[type]].status);
        seen.add(`${type}:${status}`);
        compared++;
      }
      expect(compared, `${net}: entries compared`).toBe(COMPARED[net]);
      expect(nodeOnly, `${net}: entries with no answer of the index`).toBe(NODE_ONLY[net]);
      expect(notObjects, `${net}: entries that are no escrow, check or channel`).toEqual(NOT_OBJECTS[net]);
    }
    // Not a test of one status: the recordings hold every status an object in the ledger can have.
    expect([...seen].sort()).toEqual([
      "Check:expired",
      "Check:open",
      "Escrow:can_be_cancelled",
      "Escrow:can_be_finished",
      "Escrow:pending",
      "PayChannel:closing",
      "PayChannel:open",
    ]);
  });
});

describe("the browser bundle", () => {
  // The rules are drawn in the browser too (a node-read object's status comes from them): pure, with the types of the data API client and nothing at run time.
  const appDir = new URL("../", import.meta.url);

  it("imports nothing at run time, and so loads no file but itself", () => {
    expect(valueImports(readFileSync(new URL("domain/object-status.ts", appDir), "utf8"))).toEqual([]);
    expect(staticClosure(appDir, "domain/object-status.ts")).toEqual(["domain/object-status.ts"]);
  });
});
