import { describe, expect, it, vi } from "vitest";

import { MPT_FIXTURE_IDS } from "../../test/support/mpt-case-rules";
import { checkMptRequest, loadMptSource } from "./mpt-route";
import type { MptIssuanceAnswer, NodeMptIssuance } from "./api-types";
import { UpstreamError } from "./upstream";

const ID = MPT_FIXTURE_IDS.htf;
const XRPL = { id: "xrpl", hasMpt: true } as const;
const XAHAU = { id: "xahau", hasMpt: false } as const;
const ON = { mpt: true };
const OFF = { mpt: false };

describe("checkMptRequest", () => {
  it("is off while MPT is off, before anything else: on either network, with any text", () => {
    for (const raw of [ID, ID.toLowerCase(), "xyz", ""]) {
      expect(checkMptRequest(XRPL, raw, OFF), raw).toEqual({ kind: "off" });
      expect(checkMptRequest(XAHAU, raw, OFF), raw).toEqual({ kind: "off" });
    }
  });

  it("is the Xahau page for 48 hex digits in any case on a network without MPT, the ID in capitals, and a 404 for anything else there", () => {
    expect(checkMptRequest(XAHAU, ID, ON)).toEqual({ kind: "no-mpt", id: ID });
    expect(checkMptRequest(XAHAU, ID.toLowerCase(), ON)).toEqual({ kind: "no-mpt", id: ID });
    const mixed = ID.slice(0, 24).toLowerCase() + ID.slice(24);
    expect(checkMptRequest(XAHAU, mixed, ON)).toEqual({ kind: "no-mpt", id: ID });
    expect(checkMptRequest(XAHAU, "xyz", ON)).toEqual({ kind: "bad" });
  });

  it("is bad for text that is not 48 hex digits: short, long, with a prefix or a space, or not hex", () => {
    for (const raw of ["xyz", "", ID.slice(1), `${ID}0`, `0x${ID.slice(2)}`, ` ${ID.slice(1)}`, `${"G".repeat(48)}`, `${ID.slice(0, 47)}.`]) {
      expect(checkMptRequest(XRPL, raw, ON), JSON.stringify(raw)).toEqual({ kind: "bad" });
    }
  });

  it("sends a lower or mixed case ID to the path with the ID in capitals", () => {
    expect(checkMptRequest(XRPL, ID.toLowerCase(), ON)).toEqual({ kind: "case", to: `/xrpl/mpt/${ID}` });
    expect(checkMptRequest(XRPL, ID.slice(0, 10) + ID.slice(10).toLowerCase(), ON)).toEqual({ kind: "case", to: `/xrpl/mpt/${ID}` });
  });

  it("is ok for an ID in capitals on a network with MPT", () => {
    expect(checkMptRequest(XRPL, ID, ON)).toEqual({ kind: "ok", id: ID });
    expect(checkMptRequest({ id: "xrpl", hasMpt: true }, "0".repeat(48), ON)).toEqual({ kind: "ok", id: "0".repeat(48) });
  });
});

describe("loadMptSource", () => {
  const answer = { coverage: { complete: true }, issuance: { mpt_issuance_id: ID } } as unknown as MptIssuanceAnswer;
  const entry = { LedgerEntryType: "MPTokenIssuance", Issuer: "r", Sequence: 1, Flags: 0 } as unknown as NodeMptIssuance;
  const notFound = () => new UpstreamError("not_found", "no such issuance", { status: 404 });
  const outage = (status = 503) => new UpstreamError("server", "unavailable", { status });

  it("is the index's answer when the index has one, and asks the node nothing", async () => {
    const mptIssuance = vi.fn();
    const source = await loadMptSource({ mpt: async () => answer }, { mptIssuance }, ID);
    expect(source).toEqual({ origin: "index", answer });
    expect(mptIssuance).not.toHaveBeenCalled();
  });

  it("reads the node's entry when the index says not found, with the ledger it was read at", async () => {
    const source = await loadMptSource(
      { mpt: () => Promise.reject(notFound()) },
      { mptIssuance: async (id) => ({ node: entry, ledger_index: id === ID ? 107_721_455 : 0 }) },
      ID,
    );
    expect(source).toEqual({ origin: "node", node: entry, ledgerIndex: 107_721_455, id: ID });
  });

  it("is null when neither has the issuance", async () => {
    expect(await loadMptSource({ mpt: () => Promise.reject(notFound()) }, { mptIssuance: () => Promise.reject(notFound()) }, ID)).toBeNull();
  });

  it("throws the index's failure as it was, and does not ask the node", async () => {
    const mptIssuance = vi.fn();
    for (const err of [outage(503), outage(429), new UpstreamError("timeout", "slow"), new UpstreamError("server", "Cannot GET /v2/mpt/X", { status: 404 }), new UpstreamError("rate_limited", "limited", { status: 429 })]) {
      await expect(loadMptSource({ mpt: () => Promise.reject(err) }, { mptIssuance }, ID)).rejects.toBe(err);
    }
    expect(mptIssuance).not.toHaveBeenCalled();
  });

  it("throws the node's failure after the index's not found, a bad request included", async () => {
    for (const err of [outage(), new UpstreamError("timeout", "slow"), new UpstreamError("bad_request", "invalidParams")]) {
      await expect(loadMptSource({ mpt: () => Promise.reject(notFound()) }, { mptIssuance: () => Promise.reject(err) }, ID)).rejects.toBe(err);
    }
  });
});
