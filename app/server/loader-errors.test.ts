import { describe, expect, it } from "vitest";

import { UpstreamError, type UpstreamErrorKind } from "./upstream";
import { upstreamFailure } from "./loader-errors";

/** What `upstreamFailure` throws. */
function thrownBy(fn: () => never): unknown {
  try {
    fn();
  } catch (thrown) {
    return thrown;
  }
  throw new Error("nothing was thrown");
}

/** The status, headers and payload of a thrown `data()` (React Router's `DataWithResponseInit`). */
function asData(thrown: unknown) {
  const { data, init } = thrown as { data: unknown; init: { status?: number; headers?: HeadersInit } | null };
  return { data, status: init?.status, headers: new Headers(init?.headers) };
}

describe("upstreamFailure", () => {
  it("turns a not_found into a 404 of class short that says what was not found", () => {
    const { data, status, headers } = asData(
      thrownBy(() => upstreamFailure(new UpstreamError("not_found", "no such ledger", { status: 404 }), "ledger 99")),
    );
    expect(status).toBe(404);
    expect(data).toEqual({ notFound: "ledger 99" });
    expect(headers.get("X-Cache-Class")).toBe("short");
  });

  it("turns a bad_request into the same 404 (the id was not well-formed for the API)", () => {
    const { data, status, headers } = asData(
      thrownBy(() => upstreamFailure(new UpstreamError("bad_request", "bad", { status: 400 }), "transaction XYZ")),
    );
    expect(status).toBe(404);
    expect(data).toEqual({ notFound: "transaction XYZ" });
    expect(headers.get("X-Cache-Class")).toBe("short");
  });

  it.each<UpstreamErrorKind>(["rate_limited", "server", "timeout", "network"])(
    "turns %s into a 503 with Retry-After, so the edge cache serves a stale copy or its busy page",
    (kind) => {
      const { status, headers, data } = asData(thrownBy(() => upstreamFailure(new UpstreamError(kind), "ledger 99")));
      expect(status).toBe(503);
      expect(headers.get("Retry-After")).toBe("30");
      expect(headers.has("X-Cache-Class")).toBe(false); // a 503 is never stored
      expect(data).toEqual({ unavailable: "ledger 99" });
    },
  );

  it("passes on the Retry-After the upstream asked for", () => {
    const err = new UpstreamError("rate_limited", "slow down", { status: 429, retryAfter: 7 });
    expect(asData(thrownBy(() => upstreamFailure(err, "x"))).headers.get("Retry-After")).toBe("7");
  });

  it("falls back to 30 s when the upstream's Retry-After is not a usable number", () => {
    for (const retryAfter of [0, -3, Number.NaN]) {
      const err = new UpstreamError("rate_limited", "slow down", { retryAfter });
      expect(asData(thrownBy(() => upstreamFailure(err, "x"))).headers.get("Retry-After")).toBe("30");
    }
  });

  it("rethrows anything else untouched", () => {
    const bug = new TypeError("x is not a function");
    expect(thrownBy(() => upstreamFailure(bug, "ledger 99"))).toBe(bug);
    const response = new Response("already a response", { status: 418 });
    expect(thrownBy(() => upstreamFailure(response, "ledger 99"))).toBe(response);
    expect(thrownBy(() => upstreamFailure("a string", "ledger 99"))).toBe("a string");
  });
});
