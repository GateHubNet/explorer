import { afterEach, describe, expect, it, vi } from "vitest";

import { recordingMark } from "../../test/support/degraded-mark";
import { MPT_FIXTURE_IDS } from "../../test/support/mpt-case-rules";
import { allSwitches } from "../../test/support/switches";
import type { MptLookup, MptSummary } from "./api-types";
import { createLoadContext, type Env } from "./env";
import { loadMptLookup, type MptLookupContext } from "./mpt-load";
import { MPT_LOOKUP_MAX } from "./mpt-view";
import { UpstreamError } from "./upstream";

// loadMptLookup over a fake data API and a load context whose degraded mark and `console.error` (where `logProblem` writes) record what they are given. The Worker's own runs of it are
// test/worker/transaction-mpt.spec.ts and its likes.

const env: Env = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("off"),
  MPT: "on",
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};

const HTF = MPT_FIXTURE_IDS.htf;
const OTHER = MPT_FIXTURE_IDS.noMetadata;

const summary = (id: string): MptSummary => ({
  mpt_issuance_id: id,
  issuer: "rIssuer",
  ticker: "HTF",
  asset_scale: 2,
  outstanding_amount: "1",
  holders: 1,
  transfer_fee: 0,
  flags: { locked: false, can_lock: false, require_auth: false, can_escrow: false, can_trade: false, can_transfer: true, can_clawback: false },
  destroyed: false,
});

function world(call?: (ids: readonly string[]) => Promise<MptLookup>) {
  const { mark, marks } = recordingMark();
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  const mptLookup = vi.fn(call ?? ((ids: readonly string[]) => Promise.resolve({ count: ids.length, issuances: ids.map((id) => (id === OTHER ? { mpt_issuance_id: id } : summary(id))) })));
  const request = new Request("https://explorer.test/xrpl/tx/ABC");
  const lookup = (ids: readonly string[], over: Partial<MptLookupContext> = {}) =>
    loadMptLookup({ mptLookup }, ids, { context: createLoadContext(env, ctx, mark), request, features: { mpt: true }, net: { hasMpt: true }, ...over });
  const logged = () => logs.mock.calls.map(([line]) => JSON.parse(String(line)) as { level: string; what: string; path?: string; error: string });
  return { lookup, mptLookup, logged, marks };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("loadMptLookup: when it asks", () => {
  it("makes no call and is off while MPT is off", async () => {
    const { lookup, mptLookup, marks, logged } = world();
    expect(await lookup([HTF], { features: { mpt: false } })).toEqual({ state: "off" });
    expect(mptLookup).not.toHaveBeenCalled();
    expect(marks).toEqual([]);
    expect(logged()).toEqual([]);
  });

  it("makes no call on a network without MPT (Xahau)", async () => {
    const { lookup, mptLookup } = world();
    expect(await lookup([HTF], { net: { hasMpt: false } })).toEqual({ state: "off" });
    expect(mptLookup).not.toHaveBeenCalled();
  });

  it("makes no call, and never asks for no issuance, when the page shows none", async () => {
    const { lookup, mptLookup } = world();
    expect(await lookup([])).toEqual({ state: "off" });
    expect(mptLookup).not.toHaveBeenCalled();
  });
});

describe("loadMptLookup: what it makes of the answer", () => {
  it("asks once for the IDs it was given and keeps each answer by its ID: the summary of one the index knows, the bare entry of one it has no state for", async () => {
    const { lookup, mptLookup, marks } = world();
    const result = await lookup([HTF, OTHER]);
    expect(mptLookup).toHaveBeenCalledTimes(1);
    expect(mptLookup).toHaveBeenCalledWith([HTF, OTHER]);
    const expected = new Map<string, MptSummary | { mpt_issuance_id: string }>([
      [HTF, summary(HTF)],
      [OTHER, { mpt_issuance_id: OTHER }],
    ]);
    expect(result).toEqual({ state: "ok", map: expected });
    expect(marks).toEqual([]);
  });

  it("asks for the first 100 of more", async () => {
    const { lookup, mptLookup } = world();
    const ids = Array.from({ length: 120 }, (_, at) => at.toString(16).padStart(48, "0").toUpperCase());
    await lookup(ids);
    expect(mptLookup.mock.calls[0]![0]).toEqual(ids.slice(0, MPT_LOOKUP_MAX));
  });
});

describe("loadMptLookup: when the call fails", () => {
  it("never rejects: it is failed, marks the request degraded and logs one line", async () => {
    const { lookup, marks, logged } = world(() => Promise.reject(new UpstreamError("server", "data API GET /v2/mpt answered 500", { status: 500 })));
    expect(await lookup([HTF])).toEqual({ state: "failed" });
    expect(marks).toEqual(["MPT amounts could not be loaded"]);
    expect(logged()).toEqual([{ level: "error", what: "MPT amounts could not be loaded", path: "/xrpl/tx/ABC", error: "data API GET /v2/mpt answered 500" }]);
  });

  it("is failed for a call that throws at once, and for an answer the client refused", async () => {
    const thrown = world(() => {
      throw new RangeError("a lookup of MPT issuances takes 1 to 100 distinct IDs");
    });
    expect(await thrown.lookup([HTF])).toEqual({ state: "failed" });
    expect(thrown.marks).toHaveLength(1);
  });

  it("is failed when the call has not answered by the deadline it was given", async () => {
    vi.useFakeTimers();
    const { lookup, marks } = world(() => new Promise<MptLookup>(() => {}));
    const pending = lookup([HTF], { deadlineMs: 700 });
    await vi.advanceTimersByTimeAsync(701);
    expect(await pending).toEqual({ state: "failed" });
    expect(marks).toEqual(["MPT amounts could not be loaded"]);
  });

  it("answers inside the deadline when the call does", async () => {
    vi.useFakeTimers();
    const { lookup } = world((ids) => new Promise((resolve) => setTimeout(() => resolve({ count: ids.length, issuances: ids.map(summary) }), 300)));
    const pending = lookup([HTF], { deadlineMs: 700 });
    await vi.advanceTimersByTimeAsync(301);
    expect(await pending).toMatchObject({ state: "ok" });
  });
});
