import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { encodeAccountID } from "ripple-address-codec";

import { edgeCacheKey } from "../../app/server/edge-cache";
import { decodePng, hex, pngSize } from "../support/png";
import { pageClient } from "../support/pages";
import { dataApiError, mockUpstream, nodeError, type UpstreamMock } from "../support/upstream";

// The link-preview images, `/og/{net}/{tx|ledger|account}/{id}.png` (spec 2, 9), on the real Worker against the recorded answers of the
// data API and the nodes (test/fixtures/http/). The image is drawn by workers-og (Satori and resvg-wasm) with the bundled Geist fonts;
// its layout is tested in app/og/card.test.ts, here it is the answers: what is a PNG of 1200 × 630, in which cache class, from which
// upstream, and what is a 404 or a 503.
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included (an error is never stored), so the
// tests of failing upstreams come first, and each scenario that overrides an answer asks for an object no other scenario asks for.

const { get, stored, storedAs } = pageClient("198.19.0");

let mock: UpstreamMock | undefined;
afterEach(() => {
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  expect(unused ?? []).toEqual([]);
});

const IMMUTABLE = { cls: "immutable", ttl: 31_536_000 };
const SHORT = { cls: "short", ttl: 30 };
const SLOW = { cls: "slow", ttl: 3600 };
const FROM_NODE = { cls: "short", ttl: 60 };

// Recorded: XRPL transactions (a plain Payment of ledger 102186243, a Payment through an AMM pool), ledgers 107720688 and the head
// 107721455; an active account. Xahau: a Remit, ledgers 26540187, 26540188 and the head, an active account. See the README.
const PAYMENT = "AACAFCFEBB5C970049A576CBFE6EF544A47EE3ADBA99122FA43234D18D5FFD40";
const SWAP = "52E2AD5B382D4588BECF6A743E7AE5C84D49A5C06968EC7700E8333BF41E1C60";
const REMIT = "8C50C44787A12B785AA62377D0AFA6C4711E8E07EF68BA6E83DC286F7EE79AAF";
const NODE_ONLY = "D437E9B6486965D1E97D3737FD00A4B0C9615DFFF3ECC813EF6A3A6CB44B945F";
const LEDGER_HASH = "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02";
const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const XAHAU_ACTIVE = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";
const DELETED = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";
const NEVER_FUNDED = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";

/** A valid address that no recording has: 20 bytes of `n`. */
const account = (n: number) => encodeAccountID(new Uint8Array(20).fill(n));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the edge cache holds a copy of `path` now (for after the answer has been read; waits a moment for a store that is not wanted). */
async function isStored(path: string) {
  await sleep(120);
  return (await caches.default.match(edgeCacheKey(`https://explorer.test${path}`, env.BUILD_ID))) !== undefined;
}

/** The answer for `path`, its body read whole. */
async function image(path: string) {
  const response = await get(path);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes };
}

/** What a PNG answer must be, whatever it shows: a PNG of 1200 × 630, not empty. */
function expectPng({ response, bytes }: Awaited<ReturnType<typeof image>>) {
  expect(response.status, new TextDecoder().decode(bytes.slice(0, 300))).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
  // A 1200 × 630 card with text is tens of kilobytes; an empty one would be a few.
  expect(bytes.length).toBeGreaterThan(8_000);
}

/** The requests a mock has seen, as `net key`, in a stable order. */
const keys = (m: UpstreamMock) => m.requests.map((request) => `${request.net} ${request.key}`).sort();

// First in the file: a failed call is never stored, but the answers that worked are, so a failing one is asked for before anything has
// been, and for objects that nothing else in the file asks for.
describe("when an upstream fails", () => {
  it("answers 503 with Retry-After when the data API fails for a transaction, does not ask the node in its place, and stores nothing", async () => {
    const hash = "2C9538843C61FE4120577EDCD885C9B4E6AC6694C9DF3603528B81A2D9FC084A";
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: () => dataApiError(503, "unavailable") });
    const { response } = await image(`/og/xrpl/tx/${hash}.png`);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(await isStored(`/og/xrpl/tx/${hash}.png`)).toBe(false);
  });

  it("answers 503 when the data API is limiting us", async () => {
    const hash = "9C4D48A7F44A7A58DEBE2F31525966684E74A51F407BD7A837A41326BB3C9743";
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: () => dataApiError(429, "slow down", { "Retry-After": "7" }) });
    const { response } = await image(`/og/xrpl/tx/${hash}.png`);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(await isStored(`/og/xrpl/tx/${hash}.png`)).toBe(false);
  });

  it("answers 503 when it cannot tell whether a ledger is the newest, and stores nothing", async () => {
    mock = mockUpstream("xrpl", { "GET /v2/last_validated": () => dataApiError(500, "boom") });
    const { response } = await image("/og/xrpl/ledger/107720549.png");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(await isStored("/og/xrpl/ledger/107720549.png")).toBe(false);
  });

  it("answers 503 when the data API fails for a ledger", async () => {
    mock = mockUpstream("xahau", { "GET /v2/ledgers/26540188?expand=true&transactions=true": () => dataApiError(500, "boom") });
    const { response } = await image("/og/xahau/ledger/26540188.png");
    expect(response.status).toBe(503);
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(await isStored("/og/xahau/ledger/26540188.png")).toBe(false);
  });

  it("answers 503 when the data API fails for an account, and when the node is down for one the index does not know", async () => {
    const down = account(0x31);
    mock = mockUpstream("xrpl", { [`GET /v2/accounts/${down}`]: () => dataApiError(500, "boom"), [`GET /v2/accounts/${down}/balances`]: null });
    expect((await image(`/og/xrpl/account/${down}.png`)).response.status).toBe(503);
    expect(await isStored(`/og/xrpl/account/${down}.png`)).toBe(false);
    mock.restore();
    mock = undefined;

    const unknown = account(0x32);
    mock = mockUpstream("xrpl", {
      [`GET /v2/accounts/${unknown}`]: null,
      [`GET /v2/accounts/${unknown}/balances`]: null,
      [`node account_info ${unknown}`]: () => new Response("down", { status: 500 }),
    });
    const { response } = await image(`/og/xrpl/account/${unknown}.png`);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(await isStored(`/og/xrpl/account/${unknown}.png`)).toBe(false);
  });
});

describe("an id that is not one", () => {
  it.each([
    ["a network that does not exist", "/og/bitcoin/tx/" + PAYMENT + ".png"],
    ["a network in upper case", "/og/XRPL/tx/" + PAYMENT + ".png"],
    ["a kind that does not exist", "/og/xrpl/nft/" + PAYMENT + ".png"],
    ["a transaction id that is not 64 hex digits", "/og/xrpl/tx/ABC123.png"],
    ["a transaction id of 63 digits", `/og/xrpl/tx/${PAYMENT.slice(1)}.png`],
    ["a CTID in place of a hash", "/og/xrpl/tx/C0000001000A0000.png"],
    ["a transaction id with a non-hex letter", `/og/xrpl/tx/${"G".repeat(64)}.png`],
    ["a ledger that is neither an index nor a hash", "/og/xrpl/ledger/latest.png"],
    ["a ledger index of eleven digits", "/og/xrpl/ledger/12345678901.png"],
    ["a ledger index with a sign", "/og/xrpl/ledger/-5.png"],
    ["an address with a wrong checksum", `/og/xrpl/account/${ACTIVE.slice(0, -1)}x.png`],
    ["a word in place of an address", "/og/xrpl/account/hello.png"],
    ["an X-address", "/og/xrpl/account/XVMgJSRJAMekfCw3mHHsRUbqYqWuZ26KqXMt3GKX2eENgJ9.png"],
    ["an address of a hash's length", `/og/xrpl/account/${PAYMENT}.png`],
  ])("is a 404 of class short without asking anyone: %s", async (_what, path) => {
    mock = mockUpstream("xrpl");
    const { response } = await image(path);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("is not an image route without the .png", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/og/xrpl/tx/${PAYMENT}`);
    await response.text();
    expect(response.status).toBe(404);
    expect(mock.requests).toEqual([]);
  });

  it("answers only GET: a POST is a 405 and asks no one", async () => {
    mock = mockUpstream("xrpl");
    const response = await exports.default.fetch(`https://explorer.test/og/xrpl/tx/${PAYMENT}.png`, {
      method: "POST",
      headers: { "CF-Connecting-IP": "198.19.0.251" },
    });
    await response.text();
    expect(response.status).toBe(405);
    expect(mock.requests).toEqual([]);
  });
});

describe("an id in another form", () => {
  it("redirects a transaction hash in lower case to the upper-case URL, for good, without asking anyone", async () => {
    mock = mockUpstream("xrpl");
    const path = `/og/xrpl/tx/${PAYMENT.toLowerCase()}.png`;
    const response = await get(path);
    await response.arrayBuffer();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/og/xrpl/tx/${PAYMENT}.png`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(IMMUTABLE);
  });

  it("redirects a ledger hash in lower case, and an index with leading zeros, to the one URL a ledger has", async () => {
    mock = mockUpstream("xrpl");
    const lower = await get(`/og/xrpl/ledger/${LEDGER_HASH.toLowerCase()}.png`);
    await lower.arrayBuffer();
    expect(lower.status).toBe(302);
    expect(lower.headers.get("Location")).toBe(`/og/xrpl/ledger/${LEDGER_HASH}.png`);

    const padded = await get("/og/xrpl/ledger/0107720688.png");
    await padded.arrayBuffer();
    expect(padded.status).toBe(302);
    expect(padded.headers.get("Location")).toBe("/og/xrpl/ledger/107720688.png");
    expect(mock.requests).toEqual([]);
  });
});

describe("a transaction", () => {
  it("is a PNG of 1200 × 630, class immutable, from the data API alone", async () => {
    mock = mockUpstream("xrpl");
    const path = `/og/xrpl/tx/${PAYMENT}.png`;
    const answer = await image(path);

    expectPng(answer);
    expect(answer.response.headers.get("Cache-Control")).toBe("max-age=31536000, immutable");
    expect(answer.response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await storedAs(path)).toEqual(IMMUTABLE);
    // One call: not the ledger's list, not the binary form, not the node.
    expect(keys(mock)).toEqual([`xrpl GET /v2/transactions/${PAYMENT}`]);
  });

  it("is drawn in the accent of its network: XRPL's blue bar, the white card", async () => {
    mock = mockUpstream("xrpl");
    const png = await decodePng((await image(`/og/xrpl/tx/${PAYMENT}.png`)).bytes);
    expect(hex(png.pixel(600, 4))).toBe("#2F5BEA");
    expect(hex(png.pixel(10, 300))).toBe("#FFFFFF");
    // Text was drawn: the card has dark pixels (the amount, in the colour of the text) in its middle.
    let dark = 0;
    for (let y = 200; y < 420; y += 2) for (let x = 60; x < 1140; x += 2) if (png.pixel(x, y)[0]! < 80) dark += 1;
    expect(dark).toBeGreaterThan(300);
  });

  it("is a different card for a different transaction, and the same one when it is asked for again (from the edge cache)", async () => {
    mock = mockUpstream("xrpl");
    const first = await image(`/og/xrpl/tx/${SWAP}.png`);
    expectPng(first);
    expect(first.response.headers.get("X-Cache")).toBe("MISS");
    const other = await image(`/og/xrpl/tx/${PAYMENT}.png`);
    expect(other.bytes).not.toEqual(first.bytes);

    await storedAs(`/og/xrpl/tx/${SWAP}.png`);
    const again = await image(`/og/xrpl/tx/${SWAP}.png`);
    expect(again.response.headers.get("X-Cache")).toBe("HIT");
    expect(again.bytes).toEqual(first.bytes);
  });

  it("is a Xahau card in Xahau's accent for a Xahau transaction", async () => {
    mock = mockUpstream("xahau");
    const answer = await image(`/og/xahau/tx/${REMIT}.png`);
    expectPng(answer);
    expect(await storedAs(`/og/xahau/tx/${REMIT}.png`)).toEqual(IMMUTABLE);
    expect(hex((await decodePng(answer.bytes)).pixel(600, 4))).toBe("#B45309");
    expect(keys(mock)).toEqual([`xahau GET /v2/transactions/${REMIT}`]);
  });

  it("does not exist on the other network: 404 of class short, after asking the data API and the node of that network", async () => {
    mock = mockUpstream("xahau");
    const path = `/og/xahau/tx/${PAYMENT}.png`;
    const { response } = await image(path);
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(await storedAs(path)).toEqual(SHORT);
    expect(keys(mock).map((key) => key.split(" ").slice(0, 3).join(" "))).toEqual([`xahau GET /v2/transactions/${PAYMENT}`, "xahau node tx"]);
  });

  it("comes from the node when the index does not have it yet, and is stored for 60 s as short", async () => {
    mock = mockUpstream("xahau", { [`GET /v2/transactions/${NODE_ONLY}`]: null });
    const path = `/og/xahau/tx/${NODE_ONLY}.png`;
    const answer = await image(path);

    expectPng(answer);
    expect(answer.response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(await storedAs(path)).toEqual(FROM_NODE);
    expect(mock.requests.filter((r) => r.kind === "node").map((r) => r.key.split(" ").slice(0, 2).join(" "))).toEqual(["node tx"]);
  });
});

describe("a ledger", () => {
  it("is a PNG of 1200 × 630, class immutable once a newer one is validated", async () => {
    mock = mockUpstream("xrpl");
    const path = "/og/xrpl/ledger/107720688.png";
    const answer = await image(path);

    expectPng(answer);
    expect(answer.response.headers.get("Cache-Control")).toBe("max-age=31536000, immutable");
    expect(await storedAs(path)).toEqual(IMMUTABLE);
    expect(keys(mock)).toEqual(["xrpl GET /v2/last_validated", "xrpl GET /v2/ledgers/107720688?expand=true&transactions=true"]);
  });

  it("is class short while it is the newest, since its page is live", async () => {
    mock = mockUpstream("xrpl");
    const path = "/og/xrpl/ledger/107721455.png";
    const answer = await image(path);

    expectPng(answer);
    expect(answer.response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("is the same card whether it is asked for by its index or by its hash", async () => {
    mock = mockUpstream("xrpl");
    const byHash = await image(`/og/xrpl/ledger/${LEDGER_HASH}.png`);
    expectPng(byHash);
    expect(await storedAs(`/og/xrpl/ledger/${LEDGER_HASH}.png`)).toEqual(IMMUTABLE);
    const byIndex = await image("/og/xrpl/ledger/107720688.png");
    expect(byIndex.bytes).toEqual(byHash.bytes);
  });

  it("is a Xahau card for a Xahau ledger", async () => {
    mock = mockUpstream("xahau");
    const answer = await image("/og/xahau/ledger/26540187.png");
    expectPng(answer);
    expect(await storedAs("/og/xahau/ledger/26540187.png")).toEqual(IMMUTABLE);
    expect(hex((await decodePng(answer.bytes)).pixel(600, 4))).toBe("#B45309");
  });

  it("comes from the node when the index does not have it yet, and is stored for 60 s as short", async () => {
    mock = mockUpstream("xahau", { "GET /v2/ledgers/26540188?expand=true&transactions=true": null });
    const path = "/og/xahau/ledger/26540188.png";
    const answer = await image(path);

    expectPng(answer);
    expect(await storedAs(path)).toEqual(FROM_NODE);
    expect(mock.requests.filter((r) => r.kind === "node").map((r) => r.key.split(" ").slice(0, 2).join(" "))).toEqual(["node ledger"]);
  });

  it("is a 404 of class short when neither has it", async () => {
    mock = mockUpstream("xrpl");
    const path = "/og/xrpl/ledger/99999999.png";
    const { response } = await image(path);
    expect(response.status).toBe(404);
    expect(await storedAs(path)).toEqual(SHORT);
  });
});

describe("an account", () => {
  it("is a PNG of 1200 × 630, class slow, from the data API alone", async () => {
    mock = mockUpstream("xrpl");
    const path = `/og/xrpl/account/${ACTIVE}.png`;
    const answer = await image(path);

    expectPng(answer);
    expect(answer.response.headers.get("Cache-Control")).toBe("max-age=300");
    expect(await storedAs(path)).toEqual(SLOW);
    expect(keys(mock)).toEqual([`xrpl GET /v2/accounts/${ACTIVE}`, `xrpl GET /v2/accounts/${ACTIVE}/balances`]);
  });

  it("is a Xahau card for a Xahau account", async () => {
    mock = mockUpstream("xahau");
    const answer = await image(`/og/xahau/account/${XAHAU_ACTIVE}.png`);
    expectPng(answer);
    expect(await storedAs(`/og/xahau/account/${XAHAU_ACTIVE}.png`)).toEqual(SLOW);
    expect(hex((await decodePng(answer.bytes)).pixel(600, 4))).toBe("#B45309");
  });

  it("is drawn for an account that was deleted (the index knows it), without a balance", async () => {
    mock = mockUpstream("xrpl");
    const path = `/og/xrpl/account/${DELETED}.png`;
    expectPng(await image(path));
    expect(await storedAs(path)).toEqual(SLOW);
  });

  it("is drawn without its balance when the balances cannot be read, and then stored as short, to be asked again soon", async () => {
    const address = account(0x41);
    mock = mockUpstream("xrpl", {
      [`GET /v2/accounts/${address}`]: { result: "success", account_data: { account: address, inception: "2025-07-15T18:30:43Z", initial_balance: "25", ledger_index: 97500000, parent: ACTIVE, tx_hash: PAYMENT } },
      [`GET /v2/accounts/${address}/balances`]: () => dataApiError(500, "boom"),
    });
    const path = `/og/xrpl/account/${address}.png`;
    expectPng(await image(path));
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("comes from the node when the index has no record of the account, and is stored for 60 s as short", async () => {
    const address = account(0x42);
    mock = mockUpstream("xrpl", {
      [`GET /v2/accounts/${address}`]: null,
      [`GET /v2/accounts/${address}/balances`]: null,
      [`node account_info ${address}`]: {
        account_data: { Account: address, Balance: "25000000", Flags: 0, LedgerEntryType: "AccountRoot", OwnerCount: 0, Sequence: 12 },
        ledger_index: 107721455,
        validated: true,
      },
    });
    const path = `/og/xrpl/account/${address}.png`;
    expectPng(await image(path));
    expect(await storedAs(path)).toEqual(FROM_NODE);
    expect(mock.requests.filter((r) => r.kind === "node").map((r) => r.key.split(" ").slice(0, 2).join(" "))).toEqual(["node account_info"]);
  });

  it("is a 404 of class short for an address that was never funded", async () => {
    mock = mockUpstream("xrpl");
    const path = `/og/xrpl/account/${NEVER_FUNDED}.png`;
    const { response } = await image(path);
    expect(response.status).toBe(404);
    expect(await storedAs(path)).toEqual(SHORT);
  });
});

describe("what the failing node says", () => {
  it("is 404 for a node that says the account is not there", async () => {
    const address = account(0x51);
    mock = mockUpstream("xrpl", {
      [`GET /v2/accounts/${address}`]: null,
      [`GET /v2/accounts/${address}/balances`]: null,
      [`node account_info ${address}`]: nodeError("actNotFound"),
    });
    const { response } = await image(`/og/xrpl/account/${address}.png`);
    expect(response.status).toBe(404);
  });
});
