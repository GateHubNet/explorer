import { describe, expect, it } from "vitest";

import { UpstreamError, type UpstreamErrorKind } from "./upstream";
import { notFound, upstreamFailure, upstreamOutage } from "./loader-errors";

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

describe("upstreamOutage", () => {
  it.each<UpstreamErrorKind>(["not_found", "bad_request"])(
    "turns %s into a 503: the API lacking a thing the page needs is an outage, not a missing page",
    (kind) => {
      const { status, headers, data } = asData(
        thrownBy(() => upstreamOutage(new UpstreamError(kind, "no such thing", { status: 404 }), "the newest ledger")),
      );
      expect(status).toBe(503);
      expect(headers.get("Retry-After")).toBe("30");
      expect(headers.has("X-Cache-Class")).toBe(false);
      expect(data).toEqual({ unavailable: "the newest ledger" });
    },
  );

  it.each<UpstreamErrorKind>(["rate_limited", "server", "timeout", "network"])("treats %s as upstreamFailure does", (kind) => {
    const { status, headers } = asData(thrownBy(() => upstreamOutage(new UpstreamError(kind, "x", { retryAfter: 9 }), "x")));
    expect(status).toBe(503);
    expect(headers.get("Retry-After")).toBe("9");
  });

  it("rethrows anything else untouched", () => {
    const bug = new TypeError("x is not a function");
    expect(thrownBy(() => upstreamOutage(bug, "x"))).toBe(bug);
  });
});

describe("notFound", () => {
  it("throws a 404 of class short with what was not found, the note and the offer, as the not-found page reads them", () => {
    const found = {
      notFound: "AMM pool rGLnUK…mqdz",
      suggestion: { href: "/xrpl/amm/rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz", label: "Open it on XRPL" },
      note: "Xahau has no AMM, so this pool exists only on the XRP Ledger.",
    };
    const { data, status, headers } = asData(thrownBy(() => notFound(found)));
    expect(status).toBe(404);
    expect(data).toEqual(found);
    expect(Object.keys(data as object)).toEqual(["notFound", "suggestion", "note"]);
    expect(headers.get("X-Cache-Class")).toBe("short");
  });

  it("carries only what it is given: no note and no offer are no keys", () => {
    expect(asData(thrownBy(() => notFound({ notFound: "the AMM pages" }))).data).toEqual({ notFound: "the AMM pages" });
    expect(Object.keys(asData(thrownBy(() => notFound({ notFound: "x", note: "y" }))).data as object)).toEqual(["notFound", "note"]);
  });

  it("is the 404 that upstreamFailure throws for a not_found, with the offer", () => {
    const offer = { href: "/xahau/ledger/99", label: "Open it on Xahau" };
    const failed = asData(thrownBy(() => upstreamFailure(new UpstreamError("not_found", "no such ledger", { status: 404 }), "ledger 99", offer)));
    const thrown = asData(thrownBy(() => notFound({ notFound: "ledger 99", suggestion: offer })));
    expect(failed).toEqual(thrown);
  });
});
