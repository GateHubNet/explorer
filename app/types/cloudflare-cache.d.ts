// `caches.default`, the cache of the data centre the Worker runs in (spec 4). tsconfig.cloudflare.json includes the
// DOM lib, and its `CacheStorage` has only the browser's `open`, so the `default` of the generated runtime types
// (worker-configuration.d.ts) does not reach `caches`.
interface CacheStorage {
  readonly default: Cache;
}
