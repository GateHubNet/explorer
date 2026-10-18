// The upstream mock of the Worker tests: `mockUpstream()` replaces `fetch` so that the data API and the node of both
// networks answer from test/fixtures/http/ (see upstream-core.ts for the layout and the override keys). For the
// Workers runtime; the Node HTTP server of the end-to-end suite is in fixture-server.ts.
//
//   const mock = mockUpstream("xrpl", {
//     "GET /v2/transactions/ABC...": dataApiError(503, "unavailable"),   // the data API fails
//     "node account_info rXXX": nodeError("actNotFound"),                // the node says the account is gone
//     "GET /v2/last_validated": (req) => new Response("...", { status: 200 }),
//   });
//   ...
//   expect(mock.requests.map((r) => r.key)).toEqual([...]);
//   mock.restore();                                                      // or vi.restoreAllMocks()

import { env } from "cloudflare:workers";
import { vi } from "vitest";

import type { Env } from "../../app/server/env";
import { networkOf, type NetworkId } from "../../app/server/networks";
import {
  createUpstream,
  NETWORK_NAMES,
  type FixtureFiles,
  type Overrides,
  type SeenRequest,
  type UpstreamBases,
} from "./upstream-core";

export { dataApiError, nodeError, type Override, type Overrides, type SeenRequest } from "./upstream-core";

/** The fixture files, bundled by Vite into the test module graph (the Workers runtime has no disk to read). */
const loaders = import.meta.glob("../fixtures/http/**/*.json", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;
const PREFIX = "../fixtures/http/";

const bundled: FixtureFiles = {
  async read(path) {
    const load = loaders[`${PREFIX}${path}`];
    return load === undefined ? undefined : await load();
  },
};

/** Where the Worker under test sends each network's requests: the URLs of its `env`, which `vitest.config.ts` pins. */
function configuredBases(): UpstreamBases {
  const bases = {} as UpstreamBases;
  for (const name of NETWORK_NAMES) {
    const network = networkOf(name, env as unknown as Env);
    bases[name] = { dataApi: network.dataApiUrl, node: network.nodeUrl };
  }
  return bases;
}

/**
 * The statuses the mock answered the requests for `key` with (`GET /v2/last_validated`, `node tx <HASH>`, ...), in order. An
 * override that did not reach the Worker as the response it was shows as `0`: the answer was never made.
 */
export function statusesOf(mock: Pick<UpstreamMock, "requests">, key: string): number[] {
  return mock.requests.filter((request) => request.key === key).map((request) => request.status);
}

export interface UpstreamMock {
  /** Every request the mock answered, in order. */
  requests: SeenRequest[];
  /** The override keys no request has used: a typo in a key shows up here. */
  unusedOverrides(): string[];
  /** Puts the real `fetch` back. */
  restore(): void;
}

/**
 * Stubs `globalThis.fetch` for the data API and the node of both networks, as `env` configures them, so a test may
 * call either network. `net` is the network the unprefixed keys of `overrides` belong to; prefix a key with a
 * network (`"xahau GET /v2/last_validated"`) for the other. Anything else that is fetched throws.
 */
export function mockUpstream(net: NetworkId, overrides: Overrides = {}): UpstreamMock {
  const upstream = createUpstream({ files: bundled, bases: configuredBases(), primary: net, overrides });

  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const pending = upstream.handle(request);
    // A request that is aborted while its answer is pending (a deadline, a test's controller) fails as fetch does.
    const aborted = new Promise<never>((_resolve, reject) => {
      const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (request.signal.aborted) abort();
      else request.signal.addEventListener("abort", abort, { once: true });
    });
    const response = await Promise.race([pending, aborted]);
    if (response === undefined) throw new Error(`unexpected network call: ${request.method} ${request.url}`);
    return response;
  });

  return {
    requests: upstream.requests,
    unusedOverrides: () => upstream.unusedOverrides(),
    restore: () => spy.mockRestore(),
  };
}
