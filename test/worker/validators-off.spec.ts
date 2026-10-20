import { afterEach, describe, expect, it } from "vitest";

import { pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The validators pages with every switch "off" (the `worker-off` project, README "Switches"): `VALIDATORS` is page-level, so every view of the
// list, every validator and every view of the amendments is the not-found page, a 404 of class `short` made before any call (the query and the key are
// not even read: no redirect either). The `worker` project's cases are validators-page.spec.ts, validators-page-failures.spec.ts, validator-page.spec.ts
// and amendments-page.spec.ts.

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

describe("a validator with VALIDATORS off", () => {
  const KEY = "nHUNLk2T5UT5mZ4RzSPCvzUw86BDAqvp3uL8SUJmaa22RZyV71Mg";

  it.each([
    [`/xrpl/validators/${KEY}`, "XRPL"],
    [`/xahau/validators/${KEY}?marker=AAAA`, "Xahau"],
    // Neither the key nor the query is read: what would be a redirect (hex) or a 404 of its own (no key) is the switch's 404.
    [`/xrpl/validators/${"ED".padEnd(66, "0")}?x=1`, "XRPL"],
    ["/xrpl/validators/summary", "XRPL"],
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

describe("the amendments list with VALIDATORS off", () => {
  it.each([
    ["/xrpl/amendments", "XRPL"],
    ["/xahau/amendments", "Xahau"],
    // The query is not read: what would be a redirect to the canonical view is the switch's 404.
    ["/xrpl/amendments?status=VOTING&x=1", "XRPL"],
    ["/xahau/amendments?status=all", "Xahau"],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path, name) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(textOf(html)).toContain(`We couldn’t find the amendments on ${name}.`);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual({ cls: "short", ttl: 30 });
  });
});

