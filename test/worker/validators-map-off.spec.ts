import { afterEach, describe, expect, it } from "vitest";

import { pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// A `country` with every switch "off" (the `worker-off` project, README "Switches"). That project turns `VALIDATORS` off as well, and then every validators view is
// E6's not-found page, a 404 of class `short` made before the query is read and before any call (validators-off.spec.ts): this file pins that a `country` changes
// nothing of it, not even into a redirect. The case production runs first, `VALIDATORS` on and `VALIDATORS_MAP` off, is validators-page.spec.ts, which calls the route's
// loader with a load context of its own (E13 plan, ruling R2).

const { get, storedAs } = pageClient("198.18.115");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

describe("a country view with VALIDATORS_MAP off", () => {
  it.each([
    ["/xrpl/validators?country=DE", "XRPL"],
    ["/xahau/validators?country=unknown", "Xahau"],
    // What would be a redirect with the switch on (a lower-case code, an order, a second country) is the 404 as well.
    ["/xrpl/validators?q=x&country=de&scope=all&country=FR", "XRPL"],
  ])("leaves E6's 404 for %s, class short, with no call and no redirect", async (path, name) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("Location")).toBeNull();
    expect(textOf(html)).toContain(`We couldn’t find the validators on ${name}.`);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });
});
