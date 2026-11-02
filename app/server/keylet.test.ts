import { describe, expect, it } from "vitest";

import { decodeAccountID } from "ripple-address-codec";

import { allTxs } from "../../test/support/ledgers";
import { escrowKeylet, escrowPreimage } from "./keylet";

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

  it("accepts the two ends of the range of a sequence", async () => {
    const owner = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
    const [first, last] = await Promise.all([escrowKeylet(owner, 0), escrowKeylet(owner, 0xffff_ffff)]);
    expect([first, last]).toEqual([expect.stringMatching(/^[0-9A-F]{64}$/), expect.stringMatching(/^[0-9A-F]{64}$/)]);
    expect(first).not.toBe(last);
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

describe("escrowPreimage", () => {
  const owner = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";

  it("is 0x0075, the 20 bytes of the owner's AccountID, and the sequence as four big-endian bytes", () => {
    expect([...escrowPreimage(owner, 0x0102_0304)]).toEqual([0x00, 0x75, ...decodeAccountID(owner), 0x01, 0x02, 0x03, 0x04]);
    expect([...escrowPreimage(owner, 0).slice(22)]).toEqual([0, 0, 0, 0]);
    expect([...escrowPreimage(owner, 0xffff_ffff).slice(22)]).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  it("refuses a sequence that is no unsigned 32-bit integer, and what is no address", () => {
    expect(() => escrowPreimage(owner, 0xffff_ffff + 1)).toThrow(RangeError);
    expect(() => escrowPreimage(owner, -1)).toThrow(RangeError);
    expect(() => escrowPreimage("not-an-address", 1)).toThrow();
  });
});
