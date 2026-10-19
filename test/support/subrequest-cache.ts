// Stand-ins for the Worker's subrequest cache (app/server/cache-class.ts), for tests of the upstream clients.

import type { CacheClass, SubrequestCache } from "../../app/server/cache-class";

/** Calls `load` every time and remembers nothing. */
export const passThroughCache: SubrequestCache = { json: (_key, _cls, load) => load() };

export type CacheCall = { key: string; cls: CacheClass; ttlOverride?: number; holdFailure?: true };

/** A pass-through cache that writes down how it was asked: the key, the class, the TTL override and whether the call asked for the failure hold. */
export function recordingCache(): SubrequestCache & { calls: CacheCall[] } {
  const calls: CacheCall[] = [];
  return {
    calls,
    json(key, cls, load, ttlOverride, opts) {
      calls.push({ key, cls, ...(ttlOverride === undefined ? {} : { ttlOverride }), ...(opts?.holdFailure ? { holdFailure: true as const } : {}) });
      return load();
    },
  };
}
