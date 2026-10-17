import { afterEach, describe, expect, it, vi } from "vitest";

import { clientsFor } from "./clients";
import { createLoadContext, type Env } from "./env";
import { networkOf } from "./networks";

const env: Env = {
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};

afterEach(() => vi.unstubAllGlobals());

/** A Cache API that remembers what was put in it, and a `fetch` that answers every request with `body`. */
function stubRuntime(body: unknown) {
  const stored = new Map<string, Response>();
  const cacheDefault = {
    match: vi.fn(async (request: Request) => stored.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => void stored.set(request.url, response)),
  };
  vi.stubGlobal("caches", { default: cacheDefault });
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { cacheDefault, fetchMock };
}

describe("clientsFor", () => {
  it("builds the data API client and the node client of a network", () => {
    stubRuntime({});
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const { api, node } = clientsFor(createLoadContext(env, ctx), networkOf("xahau", env));
    expect(typeof api.lastValidated).toBe("function");
    expect(typeof api.transaction).toBe("function");
    expect(typeof node.accountInfo).toBe("function");
    expect(typeof node.serverState).toBe("function");
  });

  it("gives both clients the request's subrequest cache: a second page of the same request does not call upstream again", async () => {
    const answer = {
      result: "success",
      ledger_index: "107695660",
      ledger_hash: "AB".repeat(32),
      parent_hash: "CD".repeat(32),
      close_time: "2026-10-17T15:42:51Z",
    };
    const { fetchMock, cacheDefault } = stubRuntime(answer);
    const waiting: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waiting.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const net = networkOf("xrpl", env);

    const first = clientsFor(createLoadContext(env, ctx), net);
    await expect(first.api.lastValidated()).resolves.toEqual(answer);
    await Promise.all(waiting);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://xrpl.data.example.invalid/v2/last_validated");
    expect(cacheDefault.put).toHaveBeenCalledTimes(1);

    // Another request, in the same data centre: the stored answer is used.
    const second = clientsFor(createLoadContext(env, ctx), net);
    await expect(second.api.lastValidated()).resolves.toEqual(answer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
