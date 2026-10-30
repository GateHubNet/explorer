import { describe, expect, it } from "vitest";

import { allTxs } from "../../test/support/ledgers";
import { escrowKeylet } from "./keylet";

// The escrows of the recordings D5 made (test/fixtures/ledgers/xrpl-objects and xahau-objects): the ID the ledger gave each one is the truth the keylet is held to.
const SETS = ["xrpl-objects", "xahau-objects"] as const;

/** The sequence an escrow created by `tx` takes: its own `Sequence`, else (a ticket) its `TicketSequence`. */
const sequenceOf = (tx: Record<string, unknown>): number => (typeof tx.Sequence === "number" && tx.Sequence > 0 ? tx.Sequence : (tx.TicketSequence as number));

describe("escrowKeylet", () => {
  it("is the LedgerIndex of the Escrow node every recorded EscrowCreate created, from its owner and sequence", async () => {
    let checked = 0;
    for (const set of SETS) {
      for (const { tx, meta } of allTxs(set)) {
        if (tx.TransactionType !== "EscrowCreate") continue;
        const created = meta.AffectedNodes.flatMap((node) => ("CreatedNode" in node && node.CreatedNode.LedgerEntryType === "Escrow" ? [node.CreatedNode] : []));
        // A failed EscrowCreate (a tec) created nothing.
        if (created.length === 0) continue;
        expect(created, `${set} ${tx.hash}`).toHaveLength(1);
        expect(await escrowKeylet(tx.Account, sequenceOf(tx)), `${set} ${tx.hash}`).toBe(created[0]!.LedgerIndex);
        // The node says whose it is and (where the ledger writes it) which sequence.
        expect(created[0]!.NewFields?.Account).toBe(tx.Account);
        if (created[0]!.NewFields?.Sequence !== undefined) expect(created[0]!.NewFields.Sequence).toBe(sequenceOf(tx));
        checked++;
      }
    }
    // The recordings hold escrows on both networks, so that neither network's rule was assumed from the other's.
    expect(checked).toBeGreaterThanOrEqual(10);
    expect(allTxs("xahau-objects").filter(({ tx }) => tx.TransactionType === "EscrowCreate").length).toBeGreaterThan(0);
  });

  it("writes 64 upper-case hex digits", async () => {
    expect(await escrowKeylet("rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", 97531438)).toMatch(/^[0-9A-F]{64}$/);
  });

  it("refuses a sequence that is no unsigned 32-bit integer, which a byte write would wrap into another escrow's", async () => {
    const owner = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
    for (const sequence of [-1, 0xffff_ffff + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(escrowKeylet(owner, sequence), String(sequence)).rejects.toThrow(RangeError);
    }
  });

  it("refuses what is no address", async () => {
    await expect(escrowKeylet("not-an-address", 1)).rejects.toThrow();
  });
});
