import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createLoadContext, getSubrequestCache } from "../../app/server/env";

// The subrequest cache of a load context, on the runtime's real Cache API: what one request stored, the next reads.

describe("getSubrequestCache", () => {
  it("is backed by the Cache API: a second request in the data centre does not load again", async () => {
    const waiting: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waiting.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const key = `GET https://upstream.example.invalid/${crypto.randomUUID()}`;
    let loads = 0;
    const load = async () => ({ n: ++loads });

    const first = getSubrequestCache(createLoadContext(env, ctx));
    expect(await first.json(key, "short", load)).toEqual({ n: 1 });
    await Promise.all(waiting);

    const second = getSubrequestCache(createLoadContext(env, ctx));
    expect(await second.json(key, "short", load)).toEqual({ n: 1 });
    expect(loads).toBe(1);
  });
});
