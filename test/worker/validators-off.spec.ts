import { afterEach, describe, expect, it } from "vitest";

import { pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The validators list with every switch "off" (the `worker-off` project, README "Switches"): `VALIDATORS` is page-level, so every view of the
// list is the not-found page, a 404 of class `short` made before any call (the query is not even read: no redirect either). The `worker`
// project's cases are validators-page.spec.ts and validators-page-failures.spec.ts.

const { get, storedAs } = pageClient("198.51.111");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

describe("the validators list with VALIDATORS off", () => {
  it.each([
    ["/xrpl/validators", "XRPL"],
    ["/xahau/validators?scope=all", "Xahau"],
    // The query is not read, and not tidied: a made-up one is a 404 as well.
    ["/xrpl/validators?SCOPE=ALL&x=1", "XRPL"],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path, name) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(textOf(html)).toContain(`We couldn’t find the validators on ${name}.`);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });
});
