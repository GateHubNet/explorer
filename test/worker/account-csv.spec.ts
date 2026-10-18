import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { encodeAccountID } from "ripple-address-codec";

import { edgeCacheKey } from "../../app/server/edge-cache";
import { dataApiError, mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";
import { pageClient } from "../support/pages";

// `/{net}/account/{address}/payments.csv`: one page of an account's payments as CSV, the API's own, streamed. Each test uses an account
// of its own: what a Worker stores in the Cache API stays there for the rest of the file, the edge cache's copies and the subrequests alike.

const { get, stored, storedAs } = pageClient("203.0.113");

let mock: UpstreamMock | undefined;
afterEach(() => {
  // A key that no request used is a typo, or an answer the route never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  expect(unused ?? []).toEqual([]);
});

/** A valid address nothing else in the file uses: the account id is 20 bytes of `n`. */
const account = (n: number) => encodeAccountID(new Uint8Array(20).fill(n));

const CSV = '"amount","currency","destination","source"\n"5","XRP","rDest","rSource"\n"7","USD","rDest2","rSource2"\n';
const key = (address: string, query = "descending=true&format=csv&limit=1000") => `GET /v2/accounts/${address}/payments?${query}`;
const csv = (body: BodyInit = CSV, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="upstream name.csv"', ...headers } });

describe("when the API fails", () => {
  it("answers 503 and stores nothing, and a later good request is answered and stored", async () => {
    const address = account(1);
    let calls = 0;
    mock = mockUpstream("xrpl", { [key(address)]: () => (++calls === 1 ? dataApiError(500, "unable to retrieve payments") : csv()) });

    const failed = await get(`/xrpl/account/${address}/payments.csv`);
    await failed.text();
    expect(failed.status).toBe(503);
    expect(failed.headers.get("Retry-After")).toBeTruthy();
    expect(failed.headers.get("Content-Disposition")).toBeNull();
    expect(statusesOf(mock, key(address))).toEqual([500]);
    // Give a store that should not happen the time to happen.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await caches.default.match(edgeCacheKey(`https://explorer.test/xrpl/account/${address}/payments.csv`, env.BUILD_ID))).toBeUndefined();

    const good = await get(`/xrpl/account/${address}/payments.csv`);
    expect(good.status).toBe(200);
    expect(good.headers.get("X-Cache")).toBe("MISS");
    expect(await good.text()).toBe(CSV);
    expect(await storedAs(`/xrpl/account/${address}/payments.csv`)).toEqual({ cls: "short", ttl: 30 });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("answers 503 for a 200 that is not CSV (a proxy's page)", async () => {
    const address = account(2);
    mock = mockUpstream("xrpl", { [key(address)]: () => new Response("<html>bad gateway</html>", { status: 200, headers: { "Content-Type": "text/html" } }) });
    const response = await get(`/xrpl/account/${address}/payments.csv`);
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).not.toContain("bad gateway");
    expect(await stored(`/xrpl/account/${address}/payments.csv`)).toBeUndefined();
  });

  it("answers 503 when the API is limiting us", async () => {
    const address = account(3);
    mock = mockUpstream("xrpl", { [key(address)]: () => dataApiError(429, "slow down", { "Retry-After": "7" }) });
    const response = await get(`/xrpl/account/${address}/payments.csv`);
    await response.text();
    expect(response.status).toBe(503);
  });
});

describe("the CSV", () => {
  it("is the API's page, with the explorer's own headers and none of the API's", async () => {
    const address = account(10);
    mock = mockUpstream("xrpl", { [key(address)]: () => csv() });
    const response = await get(`/xrpl/account/${address}/payments.csv`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CSV);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${address}-payments.csv"; filename*=UTF-8''${address}-payments.csv`);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Cache")).toBe("MISS");
    // The class headers are the entry's: they do not reach the visitor.
    expect(response.headers.has("X-Cache-Class")).toBe(false);
    expect(response.headers.has("Link")).toBe(false);
    expect([...response.headers.keys()].some((name) => name.toLowerCase().startsWith("x-edge"))).toBe(false);
  });

  it("asks the API once, for one page of the newest payments in CSV, with the key in its header and nowhere else", async () => {
    const address = account(11);
    mock = mockUpstream("xrpl", { [key(address)]: () => csv() });
    const response = await get(`/xrpl/account/${address}/payments.csv`);
    await response.text();
    expect(mock.requests).toHaveLength(1);
    const [seen] = mock.requests;
    expect(seen).toMatchObject({ net: "xrpl", kind: "data-api", method: "GET", source: "override", status: 200 });
    expect(seen!.headers.get("X-API-Key")).toBe("test-key");
    expect(seen!.headers.get("Accept")).toBe("text/csv");
    expect(seen!.url).toBe(`https://xrpl.data.example.invalid/v2/accounts/${address}/payments?descending=true&format=csv&limit=1000`);
    expect(seen!.url).not.toContain("test-key");
    for (const [name, value] of response.headers) expect(`${name}: ${value}`).not.toContain("test-key");
  });

  it("is stored for 30 s (class short) and served from the edge the second time, without asking the API again", async () => {
    const address = account(12);
    mock = mockUpstream("xrpl", { [key(address)]: () => csv() });
    const first = await get(`/xrpl/account/${address}/payments.csv`);
    await first.text();
    expect(await storedAs(`/xrpl/account/${address}/payments.csv`)).toEqual({ cls: "short", ttl: 30 });
    const second = await get(`/xrpl/account/${address}/payments.csv`);
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(await second.text()).toBe(CSV);
    expect(second.headers.get("Content-Disposition")).toContain(`${address}-payments.csv`);
    expect(mock.requests).toHaveLength(1);
  });

  it("streams: the first rows reach the visitor while the API is still sending", async () => {
    const address = account(13);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const encoder = new TextEncoder();
    mock = mockUpstream("xrpl", {
      [key(address)]: () =>
        csv(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(encoder.encode('"a","b"\n"1","2"\n'));
              await gate;
              controller.enqueue(encoder.encode('"3","4"\n'));
              controller.close();
            },
          }),
        ),
    });

    const response = await get(`/xrpl/account/${address}/payments.csv`);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('"a","b"\n"1","2"\n');
    release();
    let rest = "";
    for (let part = await reader.read(); !part.done; part = await reader.read()) rest += new TextDecoder().decode(part.value);
    expect(rest).toBe('"3","4"\n');
  });
});

describe("pages of the CSV", () => {
  it("passes the visitor's marker on, and points Link at the explorer's own next page, never at the API's", async () => {
    const address = account(20);
    const upstreamLink = `<https://xrpl.data.example.com/v2/accounts/${address}/payments?limit=1000&marker=SECOND&format=csv>; rel="next"`;
    mock = mockUpstream("xrpl", { [key(address, "descending=true&format=csv&limit=1000&marker=FIRST")]: () => csv(CSV, { Link: upstreamLink }) });
    const response = await get(`/xrpl/account/${address}/payments.csv?marker=FIRST`);
    await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Link")).toBe(`</xrpl/account/${address}/payments.csv?marker=SECOND>; rel="next"`);
    for (const [name, value] of response.headers) expect(`${name}: ${value}`, name).not.toMatch(/data\.example|\.invalid/);
    expect(await storedAs(`/xrpl/account/${address}/payments.csv?marker=FIRST`)).toMatchObject({ cls: "short" });
    expect(mock.unusedOverrides()).toEqual([]);
  });

  it("drops a Link it cannot read, rather than pass it on", async () => {
    const address = account(21);
    mock = mockUpstream("xrpl", { [key(address)]: () => csv(CSV, { Link: "<https://elsewhere.example/steal?marker=%3Cx%3E>; rel=\"next\"" }) });
    const response = await get(`/xrpl/account/${address}/payments.csv`);
    await response.text();
    expect(response.headers.has("Link")).toBe(false);
  });

  it("is a 404 for a marker the API refuses", async () => {
    const address = account(22);
    mock = mockUpstream("xrpl", { [key(address, "descending=true&format=csv&limit=1000&marker=NOPE")]: () => dataApiError(400, "invalid marker") });
    const response = await get(`/xrpl/account/${address}/payments.csv?marker=NOPE`);
    await response.text();
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(response.headers.get("Content-Disposition")).toBeNull();
  });
});

describe("what is refused before the API is asked", () => {
  it.each([
    ["an address with a bad checksum", "/xrpl/account/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jX/payments.csv"],
    ["not an address", "/xrpl/account/hello/payments.csv"],
    ["an X-address", "/xrpl/account/XVMgJSRJAMekfCw3mHHsRUbqYqWuZ2qXW7DhMWWpGmjhqyr/payments.csv"],
    ["an address of the wrong case", "/xrpl/account/rbbw6idaiqyjzuuk76fyqr347pbx9ow5jh/payments.csv"],
    ["a marker that is not one", `/xrpl/account/${account(30)}/payments.csv?marker=%3Cscript%3E`],
    ["an empty marker", `/xrpl/account/${account(31)}/payments.csv?marker=`],
    ["a marker that is far too long", `/xrpl/account/${account(32)}/payments.csv?marker=${"A".repeat(600)}`],
    ["a network that does not exist", `/bitcoin/account/${account(33)}/payments.csv`],
  ])("a 404 for %s, noindex, without a call", async (_what, path) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    const body = await response.text();
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body).not.toContain("<html");
    expect(mock.requests).toEqual([]);
  });

  it("works for Xahau too, on its own API", async () => {
    const address = account(40);
    mock = mockUpstream("xahau", { [key(address)]: () => csv() });
    const response = await get(`/xahau/account/${address}/payments.csv`);
    expect(await response.text()).toBe(CSV);
    expect(mock.requests[0]).toMatchObject({ net: "xahau", kind: "data-api" });
  });
});
