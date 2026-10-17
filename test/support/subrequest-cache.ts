// Stand-ins for the Worker's subrequest cache (app/server/cache-class.ts), for tests of the upstream clients.

import type { CacheClass, SubrequestCache } from "../../app/server/cache-class";

/** Calls `load` every time and remembers nothing. */
export const passThroughCache: SubrequestCache = { json: (_key, _cls, load) => load() };

export type CacheCall = { key: string; cls: CacheClass; ttlOverride?: number };

/** A pass-through cache that writes down how it was asked: the key, the class and the TTL override of each call. */
export function recordingCache(): SubrequestCache & { calls: CacheCall[] } {
  const calls: CacheCall[] = [];
  return {
    calls,
    json(key, cls, load, ttlOverride) {
      calls.push(ttlOverride === undefined ? { key, cls } : { key, cls, ttlOverride });
      return load();
    },
  };
}
