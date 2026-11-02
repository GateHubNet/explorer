import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { decodeNodePublic, encodeAccountID } from "ripple-address-codec";

import { linkTextOf, vouchedByOf } from "../../app/domain/names";
import * as render from "../../app/og/render";
import { loader as ogLoader } from "../../app/routes/og.$net.$kind.$id[.png]";
import type { Nft } from "../../app/server/api-types";
import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration, createLoadContext, type Env } from "../../app/server/env";
import xrplAmm from "../fixtures/http/xrpl/data-api/network/amendments/AMM.json";
import { SAMPLE_KEYS } from "../support/d1-samples";
import { recordingMark } from "../support/degraded-mark";
import { failingNames, namesCalls, viewOf, watchNamesLog, withoutNames } from "../support/names";
import { nftCase } from "../support/nft-cases";
import { expectDegraded } from "../support/nft-pages";
import { nftAnswerSample, nftSample } from "../support/nft-samples";
import { decodePng, hex, pngSize } from "../support/png";
import { pageClient } from "../support/pages";
import { tokenCase } from "../support/token-cases";
import { tokenDetailSample, tokenSample } from "../support/token-samples";
import { dataApiError, mockUpstream, nodeError, statusesOf, type Overrides, type UpstreamMock } from "../support/upstream";
import { amendmentCall, validatorCall } from "../support/validators-calls";
import { amendmentCase, fixtureValidator, validatorCase } from "../support/validators-cases";

// The link-preview images, `/og/{net}/{tx|ledger|account|validator|amendment|amm|nft|token}/{id}.png` (spec 2, 9; validators spec 8; AMM spec 5.2; NFT spec 10; token pages spec 7.2), on the real Worker against the
// recorded answers of the data API and the nodes (test/fixtures/http/), and the generated D1 and AMM answers for validators, amendments and pools. The image is drawn by workers-og (Satori and resvg-wasm) with the bundled Geist fonts;
// its layout is tested in app/og/card.test.ts, here it is the answers: what is a PNG of 1200 × 630, in which cache class, from which
// upstream, and what is a 404 or a 503.
//
// What a Worker stores in the Cache API stays there for the rest of the file, subrequests included (an error is never stored), so the
// tests of failing upstreams come first, and each scenario that overrides an answer asks for an object no other scenario asks for. The validator
// and amendment images ask D and AD without the failure hold (no page polls them), so a failure of one is never remembered; each test still takes
// a key of its own, because D is kept for 10 s and AD for 60 s by the Cache API.

const { get, head, stored, storedAs } = pageClient("198.19.0");

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
const FOLLOWED = "8014250A4FB1AC8859C4743090B7A905F2738253C010B968E272368A3FE59900";
const NODE_ONLY = "D437E9B6486965D1E97D3737FD00A4B0C9615DFFF3ECC813EF6A3A6CB44B945F";
const LEDGER_HASH = "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02";
const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const XAHAU_ACTIVE = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";
const DELETED = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";
const NEVER_FUNDED = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";

// The AMM pools of the fixtures (test/fixtures/http/xrpl/data-api/amm/pools/), one test to a pool: what the data API's client keeps (the pool 60 s, the create event 1 h)
// stays for the rest of the file by the real clock, so a test that lists the calls, or fails one, takes a pool that no other test asks for.
/** XRP/RLUSD, stored RLUSD/XRP: the featured pool. The index has its fee and value, and no create event. */
const AMM_POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
/** USDC/RLUSD. */
const AMM_USDC_POOL = "rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb";
/** Pools of the list's fixtures that have no create event file and no fee in the index: FLR/USD and PUPPET/XRP (two to fail #8 with), HODL/XRP (a value), ARK/PLX (neither). */
const AMM_FLR_POOL = "r3H95bncyedqbcTYDGUGSxbnCcTSbK1CyF";
const AMM_PUPPET_POOL = "r3nu9JfF7jdWjJzUuauTWx3KqE7V8VCAaJ";
const AMM_HODL_POOL = "r4e1htydorPRyra5MBV83sVaBtHbYaU8RH";
const AMM_ARK_POOL = "r3KQLa6bNT3LcBsApVqCraMaWGJKwD9faa";
/** DVR/XRP: the pool with a create event (12 Oct 2026). */
const AMM_DVR_POOL = "rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG";
/** SNK/XRP: deleted. */
const AMM_SNK_POOL = "rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz";
/** VOX/XRP: the index's pool with no value and no reserves, whose code has no text. */
const AMM_VOX_POOL = "rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef";
const ammPoolCall = (pool: string) => `GET /v2/amm/pools/${pool}`;
const ammCreateCall = (pool: string) => `GET /v2/amm/pools/${pool}/liquidity?event=create&limit=1`;

// The NFTs of the fixtures (test/fixtures/http/*/data-api/nfts/, */node/nft_info|ledger_entry/): what the image reads of one is the index's NFT (#1) and, where the index lacks it or has
// it without an owner, the node's (#2); never its offers or its history. A test of a failure, or of a card whose facts the fixtures do not have, takes an NFT made up for it: an id no one
// has used (`nftOf`) with the index's answer given as an override. What the data API's client keeps stays for the rest of the file, so each test has an id of its own.
const NFT_FEATURED = await nftCase("xrpl", "featured");
const NFT_BURNED = await nftCase("xrpl", "burned");
const NFT_UNOWNED = await nftCase("xrpl", "unowned");
const NFT_NETWORK = await nftCase("xrpl", "network");
const NFT_NETWORK_BURNED = await nftCase("xrpl", "network-burned");
const NFT_MISSING = await nftCase("xrpl", "missing");
const URI_FEATURED = await nftCase("xahau", "featured");
const URI_NETWORK = await nftCase("xahau", "network");
const nftCall = (id: string) => `GET /v2/nfts/${id}`;
const nftInfoCall = (id: string) => `node nft_info ${id}`;
/** An id of the shape of an XRPL NFT's that no recording has, one to a test (its issuer is the account of 20 zero bytes). */
const nftOf = (n: number) => `00081388${"0".repeat(48)}${n.toString(16).toUpperCase().padStart(8, "0")}`;
/** The index's answer for an NFT made up for a test: the sample held by its owner, with the keys `over` replaces. */
const nftAnswer = (id: string, over: Partial<Nft> = {}) => nftAnswerSample({ nft: nftSample({ nft_id: id, ...over }) });
const UNOWNED_NFT: Partial<Nft> = { owner: undefined, owner_since: undefined, sale_count: 0, last_sale: undefined };

// The tokens of the fixtures (test/fixtures/http/*/data-api/tokens/): what the image reads of one is call #1 of its page, `GET /v2/tokens/{currency}.{issuer}`, alone. A test of a failure, or of a
// card whose facts the fixtures do not have, takes a token made up for it (`madeUp`) with the index's answer given as an override. What the data API's client keeps stays for the rest of the file, so each test has a token of its own.
const TOKEN_RLUSD = await tokenCase("xrpl", "rlusd");
const TOKEN_USD = await tokenCase("xrpl", "usd");
const TOKEN_LIONS = await tokenCase("xrpl", "lions");
const TOKEN_LP = await tokenCase("xrpl", "lp");
const TOKEN_EVR = await tokenCase("xahau", "evr");
type TokenAsset = { currency: string; issuer: string };
const tokenCall = (token: TokenAsset) => `GET /v2/tokens/${token.currency}.${token.issuer}`;
/** A token of a 3-character code and an issuer that no recording has, one to a test (`T1A`, `T2A`, ...): its canonical segment is `T1A.{issuer}`. */
const madeUp = (n: number): TokenAsset & { path: string } => {
  const currency = `T${n}A`;
  const issuer = encodeAccountID(new Uint8Array(20).fill(0x70 + n));
  return { currency, issuer, path: `${currency}.${issuer}` };
};

/** A valid address that no recording has: 20 bytes of `n`. */
const account = (n: number) => encodeAccountID(new Uint8Array(20).fill(n));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the edge cache holds a copy of `path` now (for after the answer has been read; waits a moment for a store that is not wanted). */
async function isStored(path: string) {
  await sleep(120);
  return (await caches.default.match(edgeCacheKey(`https://explorer.test${path}`, cacheGeneration(env)))) !== undefined;
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
const keys = (m: Pick<UpstreamMock, "requests">) => m.requests.map((request) => `${request.net} ${request.key}`).sort();

/** The 66 hex digits, in upper case, that a base58 node public key spells. */
const keyHex = (key: string) => Array.from(decodeNodePublic(key), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();

// First in the file: a failed call is never stored, but the answers that worked are, so a failing one is asked for before anything has
// been, and for objects that nothing else in the file asks for.
describe("when an upstream fails", () => {
  it("answers 503 with Retry-After when the data API fails for a transaction, does not ask the node in its place, and stores nothing", async () => {
    const hash = "2C9538843C61FE4120577EDCD885C9B4E6AC6694C9DF3603528B81A2D9FC084A";
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: () => dataApiError(503, "unavailable") });
    const { response } = await image(`/og/xrpl/tx/${hash}.png`);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(await isStored(`/og/xrpl/tx/${hash}.png`)).toBe(false);
  });

  it("answers 503 when the data API is limiting us", async () => {
    const hash = "9C4D48A7F44A7A58DEBE2F31525966684E74A51F407BD7A837A41326BB3C9743";
    mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: () => dataApiError(429, "slow down", { "Retry-After": "7" }) });
    const { response } = await image(`/og/xrpl/tx/${hash}.png`);
    expect(response.status).toBe(503);
    // The route answers with the API's own wait (7 s), but a 503 the entry has no stored copy to replace is answered with the entry's own
    // page, whose Retry-After is 30: the upstream's is not what a visitor sees (the ruling of Task 9: a thrown 503's Retry-After is dead).
    expect(response.headers.get("Retry-After")).toBe("30");
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

  it("draws today's card of an account whose names call fails, and serves it without storing it: the picture is the account's, with no name on it", async () => {
    // Xahau's verified account: the XRPL one is asked for by the success test of the account group, which reads the calls of its first render.
    const view = (await viewOf("xahau", XAHAU_ACTIVE))!;
    expect(view.name?.kind).toBe("verified");
    const logged = watchNamesLog();
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xahau", failingNames());
      const path = `/og/xahau/account/${XAHAU_ACTIVE}.png`;
      const answer = await image(path);

      expectPng(answer);
      // Degraded, as a page whose names call failed is: 200, never kept by the browser or the edge, and one log line.
      await expectDegraded(path, answer.response);
      expect(logged()).toBe(1);
      expect(namesCalls(mock)[0]).toEqual([XAHAU_ACTIVE]);
      expect(drawing).toHaveBeenCalledTimes(1);
      const card = drawing.mock.calls[0]![0];
      expect(card.headline).toEqual({ text: XAHAU_ACTIVE, mono: true });
      expect(card.parties).toBeUndefined();
      expect(card.note).toMatch(/^Activated \d{1,2} [A-Z][a-z]{2} \d{4}$/);
      expect(card.kind).toBe("Account");
    } finally {
      vi.restoreAllMocks();
    }
  });

  // A never-funded address draws no card, so it makes no names call: its 404 is the one it always was, stored as short, whatever a names call would do (a failed one marks the
  // request degraded, which would make the 404 no-store; a slow one would hold it up to 1.5 s). An address of its own, which neither the index nor the node has.
  it("answers a never-funded address with today's 404, stored as short, and makes no names call, so that a failing names call cannot change it", async () => {
    const logged = watchNamesLog();
    const address = account(0x34);
    mock = mockUpstream("xrpl", {
      [`GET /v2/accounts/${address}`]: null,
      [`GET /v2/accounts/${address}/balances`]: null,
      [`node account_info ${address}`]: nodeError("actNotFound"),
      ...failingNames(),
    });
    const path = `/og/xrpl/account/${address}.png`;
    const { response, bytes } = await image(path);

    expect(response.status).toBe(404);
    expect(new TextDecoder().decode(bytes)).toBe("There is no such image.\n");
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await storedAs(path)).toEqual(SHORT);
    expect(namesCalls(mock)).toEqual([]);
    expect(logged()).toBe(0);
    // The failing names call was never made.
    expect(mock.unusedOverrides()).toEqual(["GET /v2/account_names"]);
    mock.restore();
    mock = undefined;
  });

  it("marks the answer degraded once for a failed names call, and leaves its class slow: the edge cache is what keeps it from storing it", async () => {
    watchNamesLog();
    const { mark, marks } = recordingMark();
    try {
      mock = mockUpstream("xrpl", failingNames());
      const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
      const response = (await ogLoader({
        request: new Request(`https://explorer.test/og/xrpl/account/${DELETED}.png`),
        params: { net: "xrpl", kind: "account", id: DELETED },
        context: createLoadContext(env as unknown as Env, ctx, mark),
      } as never)) as Response;

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(response.headers.get("X-Cache-Class")).toBe("slow");
      expect(marks).toEqual(["names could not be loaded"]);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

// D1's two routes have no node to ask in their place: a route that does not exist (`Cannot GET`, an API that has not merged D1 behind a switch that is on) is
// an outage and not a missing image, and is never stored.
describe("when a D1 route fails", () => {
  it("answers 503 with Retry-After when D says Cannot GET, draws nothing and stores nothing", async () => {
    const key = SAMPLE_KEYS[2];
    const path = `/og/xrpl/validator/${key}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl", { [validatorCall(key)]: dataApiError(404, `Cannot GET /v2/network/validators/${key}`) });
      const { response } = await image(path);

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBeTruthy();
      expect(response.headers.get("Content-Type")).not.toBe("image/png");
      expect(statusesOf(mock, validatorCall(key))).toEqual([404]);
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
      expect(drawing).not.toHaveBeenCalled();
      expect(await isStored(path)).toBe(false);
    } finally {
      drawing.mockRestore();
    }
  });

  it("answers 503 with Retry-After when AD says Cannot GET, draws nothing and stores nothing", async () => {
    const path = "/og/xahau/amendment/Cannotget.png";
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xahau", { [amendmentCall("Cannotget")]: dataApiError(404, "Cannot GET /v2/network/amendments/Cannotget") });
      const { response } = await image(path);

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBeTruthy();
      expect(response.headers.get("Content-Type")).not.toBe("image/png");
      expect(statusesOf(mock, amendmentCall("Cannotget"))).toEqual([404]);
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
      expect(drawing).not.toHaveBeenCalled();
      expect(await isStored(path)).toBe(false);
    } finally {
      drawing.mockRestore();
    }
  });

  it.each([
    ["D", "validator", SAMPLE_KEYS[3], validatorCall(SAMPLE_KEYS[3])],
    ["AD", "amendment", "Failing", amendmentCall("Failing")],
  ] as const)("answers 503 when %s is down, and the next request asks again", async (_route, kind, id, call) => {
    const path = `/og/xrpl/${kind}/${id}.png`;
    mock = mockUpstream("xrpl", { [call]: () => dataApiError(500, "boom") });
    expect((await image(path)).response.status).toBe(503);
    expect(await isStored(path)).toBe(false);
    // Not remembered: the image route does not ask for the failure hold, and an error is never kept by the Cache API either.
    expect((await image(path)).response.status).toBe(503);
    expect(statusesOf(mock, call)).toEqual([500, 500]);
  });
});

// A 400 of the data API for an id the route has checked (64 hex digits, an index, a valid address) is the API's fault, not a missing image:
// the same 503 as the transaction and ledger pages give, and not a 404 that would be stored for 30 s. The node is not asked in its place.
describe("when the data API refuses an id that is well formed", () => {
  const hash = "A6D2AB0623B1874F35E0884BC42A82A18389627317EE1A93E61A4CF0B43E915B";
  // On Xahau: the newest ledger the page asks beside it is kept by the subrequest cache for 5 s, and a later test of XRPL's counts its requests.
  const ledger = "26540199";
  const refused = account(0x33);

  it.each([
    ["xrpl", "a transaction", `/og/xrpl/tx/${hash}.png`, { [`GET /v2/transactions/${hash}`]: () => dataApiError(400, "invalid hash") }],
    [
      "xahau",
      "a ledger",
      `/og/xahau/ledger/${ledger}.png`,
      { [`GET /v2/ledgers/${ledger}?expand=true&transactions=true`]: () => dataApiError(400, "invalid ledger identifier") },
    ],
    [
      "xrpl",
      "an account",
      `/og/xrpl/account/${refused}.png`,
      { [`GET /v2/accounts/${refused}`]: () => dataApiError(400, "invalid account"), [`GET /v2/accounts/${refused}/balances`]: null },
    ],
    // D1's routes: a key that passed `parseValidatorKey` and a ref that passed `parseAmendmentRef` are well formed, so D1 refusing one is its fault too.
    ["xrpl", "a validator", `/og/xrpl/validator/${SAMPLE_KEYS[4]}.png`, { [validatorCall(SAMPLE_KEYS[4])]: () => dataApiError(400, "invalid validator public key") }],
    ["xahau", "an amendment", "/og/xahau/amendment/Refused.png", { [amendmentCall("Refused")]: () => dataApiError(400, "invalid amendment") }],
  ] as const)("on %s, answers 503 for %s, stores nothing, and does not ask the node", async (net, _what, path, overrides) => {
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream(net, overrides as Overrides);
      const { response } = await image(path);
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBeTruthy();
      expect(response.headers.get("Content-Type")).not.toBe("image/png");
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
      expect(drawing).not.toHaveBeenCalled();
      expect(await isStored(path)).toBe(false);
    } finally {
      drawing.mockRestore();
    }
  });
});

// An AMM pool's image (AMM spec 5.2) asks the index alone: #1 (the pool) and #8 (its create event) side by side, never the node. The pool's own "not found" is the 404;
// every other failure of #1, a 400 and an API without the AMM routes (`Cannot GET`) included, is an outage, and never a stored 404 (AMM spec 1.3). A failed #8 only
// leaves the day of the creation out. Each test takes a pool no other test asks for.
describe("when an upstream fails for an AMM pool", () => {
  /** A valid account that no recording has, one to a test. */
  const pool = (n: number) => account(0x60 + n);

  it("answers 503 with Retry-After when the index fails for the pool, draws nothing, asks no node, and stores nothing", async () => {
    const id = pool(1);
    const path = `/og/xrpl/amm/${id}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl", { [ammPoolCall(id)]: () => dataApiError(503, "unavailable") });
      const { response } = await image(path);

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBeTruthy();
      expect(response.headers.get("Content-Type")).not.toBe("image/png");
      expect(statusesOf(mock, ammPoolCall(id))).toEqual([503]);
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
      expect(drawing).not.toHaveBeenCalled();
      expect(await isStored(path)).toBe(false);
    } finally {
      drawing.mockRestore();
    }
  });

  it("answers 503 with Retry-After when the data API is limiting us", async () => {
    const id = pool(2);
    const path = `/og/xrpl/amm/${id}.png`;
    mock = mockUpstream("xrpl", { [ammPoolCall(id)]: () => dataApiError(429, "slow down", { "Retry-After": "7" }) });
    expect((await image(path)).response.status).toBe(503);
    expect(await isStored(path)).toBe(false);
  });

  it("answers 503 for a 400 of the index: the address is checked, so the refusal is the API's fault and not a missing image", async () => {
    const id = pool(3);
    const path = `/og/xrpl/amm/${id}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl", { [ammPoolCall(id)]: () => dataApiError(400, "invalid account") });
      const { response } = await image(path);

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBeTruthy();
      expect(response.headers.get("Content-Type")).not.toBe("image/png");
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
      expect(drawing).not.toHaveBeenCalled();
      expect(await isStored(path)).toBe(false);
    } finally {
      drawing.mockRestore();
    }
  });

  it("answers 503, logged and not stored, for an API without the AMM routes (its Cannot GET 404), never a stored 404", async () => {
    const id = pool(4);
    const path = `/og/xrpl/amm/${id}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mock = mockUpstream("xrpl", { [ammPoolCall(id)]: dataApiError(404, `Cannot GET /v2/amm/pools/${id}`) });
      const { response } = await image(path);

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBeTruthy();
      expect(response.headers.get("Content-Type")).not.toBe("image/png");
      expect(statusesOf(mock, ammPoolCall(id))).toEqual([404]);
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
      expect(drawing).not.toHaveBeenCalled();
      expect(await isStored(path)).toBe(false);
      const logged = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("the data API serves no AMM pools"));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain("Cannot GET");
      expect(logged[0]).toContain(path);
    } finally {
      errors.mockRestore();
      drawing.mockRestore();
    }
  });

  it("answers 503 for a 500 of the index, and asks again the next time: the failure is not remembered", async () => {
    const id = pool(5);
    const path = `/og/xrpl/amm/${id}.png`;
    mock = mockUpstream("xrpl", { [ammPoolCall(id)]: () => dataApiError(500, "boom") });
    expect((await image(path)).response.status).toBe(503);
    expect(await isStored(path)).toBe(false);
    // The image route does not ask for the failure hold, and an error is never kept by the Cache API either.
    expect((await image(path)).response.status).toBe(503);
    expect(statusesOf(mock, ammPoolCall(id))).toEqual([500, 500]);
  });

  it.each([
    ["a 503", AMM_FLR_POOL, () => dataApiError(503, "unavailable")],
    // The index lists the pool, so a "pool not found" of its create event is no 404 of the image: the creation is left out.
    ["a pool not found", AMM_PUPPET_POOL, () => dataApiError(404, "pool not found")],
  ] as const)("is drawn without the day of its creation when #8 fails with %s, and then stored as short, to be asked again soon", async (_what, id, failure) => {
    const path = `/og/xrpl/amm/${id}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mock = mockUpstream("xrpl", { [ammCreateCall(id)]: failure });
      const answer = await image(path);

      expectPng(answer);
      expect(answer.response.headers.get("Cache-Control")).toBe("max-age=0");
      expect(await storedAs(path)).toEqual(SHORT);
      expect(statusesOf(mock, ammPoolCall(id))).toEqual([200]);
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
      expect(drawing).toHaveBeenCalledTimes(1);
      expect(drawing.mock.calls[0]![0]).toMatchObject({ kind: "AMM pool", parties: [id], footer: [{ text: "AMM pool on XRPL" }] });
      // Told, as the page tells a line it left out.
      const logged = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("an AMM pool's link-preview image left out its creation"));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain(path);
    } finally {
      errors.mockRestore();
      drawing.mockRestore();
    }
  });
});

// An NFT's image (NFT spec 10) asks #1 (the NFT) and, only where the index lacks it or has it without an owner, #2 (the node's): the page's own reads, with the same modes (`nftModeOf`).
// A failure of the index, or of the node while the index has none, leaves the answer open: a 503 that is never stored, and a 400 for an id the route has checked and a "Cannot GET" of an
// API without D3 included. It is a 404 only when both say there is no such NFT (a node that is not Clio says so with `unknownCmd`). Each test takes an NFT no other test asks for.
describe("when an upstream fails for an NFT", () => {
  let drawing: MockInstance<typeof render.renderCard>;
  beforeEach(() => {
    drawing = vi.spyOn(render, "renderCard");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    drawing.mockRestore();
    vi.restoreAllMocks();
  });

  it("answers 503 with Retry-After when the index fails for the NFT, draws nothing, asks no node, and stores nothing", async () => {
    const id = nftOf(1);
    const path = `/og/xrpl/nft/${id}.png`;
    mock = mockUpstream("xrpl", { [nftCall(id)]: () => dataApiError(503, "unavailable") });
    const { response } = await image(path);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(statusesOf(mock, nftCall(id))).toEqual([503]);
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(drawing).not.toHaveBeenCalled();
    expect(await isStored(path)).toBe(false);
  });

  it.each([
    [2, "the data API is limiting us", () => dataApiError(429, "slow down", { "Retry-After": "7" })],
    [3, "the data API refuses an id the route has checked (a 400 is its fault, not a missing image)", () => dataApiError(400, "invalid nft id")],
    [4, "the data API is one without D3 (Cannot GET)", null],
    [5, "the data API answers something that is no NFT", () => new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } })],
  ])("answers 503 when %s, never a 404, asks no node and stores nothing", async (n, _what, answer) => {
    const id = nftOf(n);
    const path = `/og/xrpl/nft/${id}.png`;
    mock = mockUpstream("xrpl", { [nftCall(id)]: answer === null ? dataApiError(404, `Cannot GET /v2/nfts/${id}`) : answer });
    const { response } = await image(path);

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(drawing).not.toHaveBeenCalled();
    expect(await isStored(path)).toBe(false);
  });

  it("answers 503, never stored, when the index has no such NFT and the node fails: a 404 would be stored", async () => {
    const id = nftOf(100);
    const path = `/og/xrpl/nft/${id}.png`;
    mock = mockUpstream("xrpl", { [nftInfoCall(id)]: () => dataApiError(503, "unavailable") });
    const { response } = await image(path);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(statusesOf(mock, nftCall(id))).toEqual([404]);
    expect(drawing).not.toHaveBeenCalled();
    expect(await isStored(path)).toBe(false);
  });

  it("answers 404 of class short when the index has no such NFT and the node is not Clio (unknownCmd is not found too)", async () => {
    const id = nftOf(101);
    const path = `/og/xrpl/nft/${id}.png`;
    mock = mockUpstream("xrpl", { [nftInfoCall(id)]: nodeError("unknownCmd") });
    const { response } = await image(path);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await storedAs(path)).toEqual(SHORT);
    expect(drawing).not.toHaveBeenCalled();
  });

  it("is drawn without an owner when the index has the NFT without one and the node failed, and is class short: asked again soon", async () => {
    const id = nftOf(102);
    const path = `/og/xrpl/nft/${id}.png`;
    mock = mockUpstream("xrpl", { [nftCall(id)]: nftAnswer(id, UNOWNED_NFT), [nftInfoCall(id)]: () => dataApiError(503, "unavailable") });
    const answer = await image(path);

    expectPng(answer);
    expect(await storedAs(path)).toEqual(SHORT);
    expect(drawing).toHaveBeenCalledTimes(1);
    const card = drawing.mock.calls[0]![0];
    expect("parties" in card).toBe(false);
    expect(card.note).toBe("Never sold");
  });
});

// A token's image (token pages spec 7.2) asks #1, the token, and nothing else: the page's own key, never the node. A failure of the data API leaves the question open, so it is a 503 that is never
// stored: a 400 for an id the route has checked, a "Cannot GET" of an API without D6 and an answer for another token included. Only its own `token not found` is a 404. Each test takes a token of its own.
describe("when an upstream fails for a token", () => {
  let drawing: MockInstance<typeof render.renderCard>;
  let errors: MockInstance<typeof console.error>;
  beforeEach(() => {
    drawing = vi.spyOn(render, "renderCard");
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    drawing.mockRestore();
    vi.restoreAllMocks();
  });

  it("answers 503 with Retry-After when the index fails for the token, draws nothing, asks no node, stores nothing, and tells what happened", async () => {
    const token = madeUp(1);
    const path = `/og/xrpl/token/${token.path}.png`;
    mock = mockUpstream("xrpl", { [tokenCall(token)]: () => dataApiError(503, "unavailable") });
    const { response } = await image(path);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(statusesOf(mock, tokenCall(token))).toEqual([503]);
    expect(keys(mock)).toEqual([`xrpl ${tokenCall(token)}`]);
    expect(drawing).not.toHaveBeenCalled();
    expect(await isStored(path)).toBe(false);
    const logged = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("a token's link-preview image could not read the token"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(path);
  });

  it.each([
    [2, "the data API is limiting us", () => dataApiError(429, "slow down", { "Retry-After": "7" })],
    [3, "the data API refuses an id the route has checked (a 400 is its fault, not a missing image)", () => dataApiError(400, "invalid token")],
    [4, "the data API is one without D6 (Cannot GET)", null],
    [5, "the data API answers something that is no token", () => new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } })],
    // A 200 for another token than the one asked for: the client refuses it (`checkToken` compares the currency and the issuer strictly), so the card is never of the wrong token.
    [6, "the data API answers for another token", (token: TokenAsset) => tokenSample({ token: tokenDetailSample({ currency: "ZZZ", code: "ZZZ", issuer: token.issuer }) })],
  ])("answers 503 when %s, never a 404, asks no node and stores nothing", async (n, _what, answer) => {
    const token = madeUp(n);
    const path = `/og/xrpl/token/${token.path}.png`;
    const failing = answer === null ? dataApiError(404, `Cannot GET /v2/tokens/${token.path}`) : typeof answer === "function" ? answer(token) : answer;
    mock = mockUpstream("xrpl", { [tokenCall(token)]: failing });
    const { response } = await image(path);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
    expect(drawing).not.toHaveBeenCalled();
    expect(await isStored(path)).toBe(false);
  });

  it("asks again the next time: a failure is not remembered", async () => {
    const token = madeUp(7);
    const path = `/og/xrpl/token/${token.path}.png`;
    mock = mockUpstream("xrpl", { [tokenCall(token)]: () => dataApiError(500, "boom") });
    expect((await image(path)).response.status).toBe(503);
    expect((await image(path)).response.status).toBe(503);
    expect(statusesOf(mock, tokenCall(token))).toEqual([500, 500]);
  });
});

// A card the renderer cannot draw is an outage of this answer, not a missing image: the same 503 as a failing upstream.
describe("when the card cannot be drawn", () => {
  it("answers 503 with Retry-After, stores nothing, and logs what happened", async () => {
    const hash = "52FC2BE167D21568A673B62B98559721C5991FDB4B4654DCD4C955306D3892EB";
    const path = `/og/xrpl/tx/${hash}.png`;
    const drawing = vi.spyOn(render, "renderCard").mockRejectedValue(new Error("the renderer cannot draw this"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mock = mockUpstream("xrpl");
      const { response } = await image(path);

      expect(drawing).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("30");
      expect(response.headers.get("Content-Type")).not.toBe("image/png");
      expect(await isStored(path)).toBe(false);

      const lines = logged.mock.calls.flatMap(([line]) => {
        try {
          return [JSON.parse(String(line)) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
      expect(lines.filter((line) => line.what === "a link-preview image could not be drawn")).toEqual([
        { level: "error", what: "a link-preview image could not be drawn", path, error: "the renderer cannot draw this" },
      ]);
    } finally {
      drawing.mockRestore();
      logged.mockRestore();
    }
  });
});

// A HEAD (unfurlers and monitors send them) is the GET of the same URL without the body: answered from the stored copy, or, on a miss, by
// one render as a GET that is stored as a GET would be. It never draws an image only to throw it away.
describe("HEAD", () => {
  it("draws the image once, answers without a body, and leaves a copy that a GET and a second HEAD are served from", async () => {
    const hash = "10CEF6273B6C4476E86169B7BB1723BF3CD2CFD948B1A732450543B2270AD87E";
    const path = `/og/xrpl/tx/${hash}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const first = await head(path);
      expect(first.status).toBe(200);
      expect(first.headers.get("Content-Type")).toBe("image/png");
      expect(first.headers.get("Cache-Control")).toBe("max-age=31536000, immutable");
      expect(first.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(first.headers.get("X-Cache")).toBe("MISS");
      expect((await first.arrayBuffer()).byteLength).toBe(0);
      expect(drawing).toHaveBeenCalledTimes(1);
      expect(keys(mock)).toEqual([`xrpl GET /v2/transactions/${hash}`]);
      expect(await storedAs(path)).toEqual(IMMUTABLE);

      // The copy is the image: a GET is a hit, whole, and draws and asks for nothing.
      const full = await image(path);
      expectPng(full);
      expect(full.response.headers.get("X-Cache")).toBe("HIT");
      expect(full.response.headers.get("Cache-Control")).toBe("max-age=31536000, immutable");

      const again = await head(path);
      expect(again.status).toBe(200);
      expect(again.headers.get("X-Cache")).toBe("HIT");
      expect(again.headers.get("Content-Type")).toBe("image/png");
      expect(again.headers.get("Content-Length")).toBe(String(full.bytes.length));
      expect((await again.arrayBuffer()).byteLength).toBe(0);

      expect(drawing).toHaveBeenCalledTimes(1);
      expect(keys(mock)).toEqual([`xrpl GET /v2/transactions/${hash}`]);
    } finally {
      drawing.mockRestore();
    }
  });

  it("is served from the copy a GET stored, without drawing or asking anyone", async () => {
    const hash = "1A00E4CC5EB143E8BFF4578019BDF45ECEA40C37F113D261ECFB276243858872";
    const path = `/og/xrpl/tx/${hash}.png`;
    mock = mockUpstream("xrpl");
    expectPng(await image(path));
    await storedAs(path);
    const before = mock.requests.length;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      const response = await head(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Cache")).toBe("HIT");
      expect((await response.arrayBuffer()).byteLength).toBe(0);
      expect(drawing).not.toHaveBeenCalled();
      expect(mock.requests.length).toBe(before);
    } finally {
      drawing.mockRestore();
    }
  });

  it("answers a redirect and a 404 as the GET does, without a body, from the copy once there is one", async () => {
    mock = mockUpstream("xrpl");
    const lower = `/og/xrpl/tx/${PAYMENT.toLowerCase()}.png`;
    const redirected = await head(lower);
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("Location")).toBe(`/og/xrpl/tx/${PAYMENT}.png`);
    expect((await redirected.arrayBuffer()).byteLength).toBe(0);
    expect(await storedAs(lower)).toEqual(IMMUTABLE);
    expect((await head(lower)).headers.get("X-Cache")).toBe("HIT");

    const bad = "/og/xrpl/tx/ABC123.png";
    const missing = await head(bad);
    expect(missing.status).toBe(404);
    expect((await missing.arrayBuffer()).byteLength).toBe(0);
    expect(await storedAs(bad)).toEqual(SHORT);
    const text = await (await get(bad)).text();
    expect(text).toContain("There is no such image.");
    expect(mock.requests).toEqual([]);
  });

  it("answers 503 without a body and stores nothing when the upstream fails, and does not draw", async () => {
    const hash = "92EC1EA8B38B7242F07591AB4BF1AAB5E6B2E3015CE6E15AAAADAC05E6B74046";
    const path = `/og/xrpl/tx/${hash}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl", { [`GET /v2/transactions/${hash}`]: () => dataApiError(500, "boom") });
      const response = await head(path);
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBeTruthy();
      expect((await response.arrayBuffer()).byteLength).toBe(0);
      expect(drawing).not.toHaveBeenCalled();
      expect(await isStored(path)).toBe(false);
    } finally {
      drawing.mockRestore();
    }
  });
});

// The cache key holds the query string, so a query on an image URL would be a copy of its own, drawn again, for as long as its class says.
// Every URL with one is a 302 to the bare path instead, before anything is looked at, asked for or drawn.
describe("a query string", () => {
  it.each([
    ["a transaction", `/og/xrpl/tx/${PAYMENT}.png`],
    ["a ledger", "/og/xrpl/ledger/107720688.png"],
    ["an account", `/og/xrpl/account/${ACTIVE}.png`],
    ["a validator", `/og/xrpl/validator/${SAMPLE_KEYS[0]}.png`],
    ["an amendment", "/og/xrpl/amendment/AMM.png"],
    ["an AMM pool", `/og/xrpl/amm/${AMM_POOL}.png`],
    ["an AMM pool that is not an address", "/og/xrpl/amm/nope.png"],
    ["an NFT", `/og/xrpl/nft/${NFT_FEATURED.id}.png`],
    ["an NFT that is not an id", "/og/xrpl/nft/nope.png"],
    ["an id that is not one", "/og/xrpl/tx/ABC123.png"],
    ["a network that does not exist", "/og/bitcoin/tx/ABC123.png"],
  ])("on the image of %s is a 302 to the bare path, class immutable, with no call and nothing drawn", async (_what, bare) => {
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      for (const query of ["?a=1", "?a=2", "?a=1&b=2", "?utm_source=chat"]) {
        const response = await get(`${bare}${query}`);
        await response.arrayBuffer();
        expect(response.status, query).toBe(302);
        expect(response.headers.get("Location"), query).toBe(bare);
        expect(response.headers.get("Content-Type"), query).not.toBe("image/png");
      }
      expect(mock.requests).toEqual([]);
      expect(drawing).not.toHaveBeenCalled();
      expect(await storedAs(`${bare}?a=1`)).toEqual(IMMUTABLE);
    } finally {
      drawing.mockRestore();
    }
  });

  it("sends a lower-case hash to the bare path as it is, and the bare path to the upper-case one", async () => {
    mock = mockUpstream("xrpl");
    const lower = await get(`/og/xrpl/tx/${PAYMENT.toLowerCase()}.png?a=1`);
    await lower.arrayBuffer();
    expect(lower.status).toBe(302);
    expect(lower.headers.get("Location")).toBe(`/og/xrpl/tx/${PAYMENT.toLowerCase()}.png`);
    expect(mock.requests).toEqual([]);
  });

  it("is followed to the image", async () => {
    mock = mockUpstream("xrpl");
    const redirect = await get(`/og/xrpl/tx/${FOLLOWED}.png?a=1`);
    await redirect.arrayBuffer();
    expect(redirect.headers.get("Location")).toBe(`/og/xrpl/tx/${FOLLOWED}.png`);
    expectPng(await image(redirect.headers.get("Location")!));
  });

  it("is not there when the URL only ends in a question mark: that is the bare URL, one copy", async () => {
    mock = mockUpstream("xrpl");
    expectPng(await image(`/og/xrpl/tx/${FOLLOWED}.png?`));
  });
});

describe("an id that is not one", () => {
  it.each([
    ["a network that does not exist", "/og/bitcoin/tx/" + PAYMENT + ".png"],
    ["a network in upper case", "/og/XRPL/tx/" + PAYMENT + ".png"],
    ["a kind that does not exist", "/og/xrpl/payment/" + PAYMENT + ".png"],
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
    ["a word in place of a validator key", "/og/xrpl/validator/summary.png"],
    ["an account in place of a validator key", `/og/xrpl/validator/${ACTIVE}.png`],
    ["a validator key cut short", `/og/xrpl/validator/${SAMPLE_KEYS[0].slice(0, -1)}.png`],
    ["a validator key with a wrong checksum", `/og/xrpl/validator/${SAMPLE_KEYS[0].slice(0, -1)}x.png`],
    ["66 hex digits of a key that starts with a byte no key does", `/og/xrpl/validator/04${"0".repeat(64)}.png`],
    ["an amendment name with a dash", "/og/xrpl/amendment/fix-1201.png"],
    ["an amendment name of 65 characters", `/og/xrpl/amendment/${"a".repeat(65)}.png`],
    ["an amendment name that starts with a digit", "/og/xrpl/amendment/1fix.png"],
    ["an AMM pool that is a word and not an address", "/og/xrpl/amm/nope.png"],
    ["an AMM pool with a wrong checksum", `/og/xrpl/amm/${AMM_POOL.slice(0, -1)}x.png`],
    ["an X-address in place of an AMM pool (a pool takes no tag)", "/og/xrpl/amm/XVMgJSRJAMekfCw3mHHsRUbqYqWuZ26KqXMt3GKX2eENgJ9.png"],
    ["an AMM pool on Xahau, which has no AMM", `/og/xahau/amm/${AMM_POOL}.png`],
    ["an AMM pool in the place of a kind that does not exist", `/og/xrpl/pool/${AMM_POOL}.png`],
    ["an NFT id of 63 hex digits", `/og/xrpl/nft/${NFT_FEATURED.id.slice(1)}.png`],
    ["an NFT id of 65 hex digits", `/og/xrpl/nft/${NFT_FEATURED.id}A.png`],
    ["an NFT id with a non-hex letter", `/og/xrpl/nft/${"G".repeat(64)}.png`],
    ["a CTID in place of an NFT id", "/og/xrpl/nft/C0000001000A0000.png"],
    ["a transaction hash with a sign in place of an NFT id", `/og/xrpl/nft/-${PAYMENT.slice(1)}.png`],
    ["a token that is a hash", `/og/xrpl/token/${PAYMENT}.png`],
    ["a token that is an address with no code", `/og/xrpl/token/${TOKEN_RLUSD.issuer}.png`],
    ["a token that is a code with no issuer", "/og/xrpl/token/RLUSD.png"],
    ["a token whose issuer has a wrong checksum", `/og/xrpl/token/RLUSD.${TOKEN_RLUSD.issuer.slice(0, -1)}x.png`],
    ["a token whose issuer is an X-address", "/og/xrpl/token/RLUSD.XVMgJSRJAMekfCw3mHHsRUbqYqWuZ26KqXMt3GKX2eENgJ9.png"],
    ["a token with three parts", `/og/xrpl/token/RLUSD.USD.${TOKEN_RLUSD.issuer}.png`],
    ["the native currency alone, which is no token", "/og/xrpl/token/XRP.png"],
    ["the native currency with an issuer, which is no token's code", `/og/xrpl/token/XRP.${TOKEN_RLUSD.issuer}.png`],
    ["an AMM pool's LP token, whose page is the pool's", `/og/xrpl/token/${TOKEN_LP.path}.png`],
    ["the native currency with an issuer, spelled with a plus", `/og/xrpl/token/xrp+${TOKEN_RLUSD.issuer}.png`],
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
    expect(hex(png.pixel(600, 4))).toBe("#0A6CF1");
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
  it("is a PNG of 1200 × 630, class slow, from the data API alone: the account, its balances and one names call of its address", async () => {
    const view = (await viewOf("xrpl", ACTIVE))!;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const path = `/og/xrpl/account/${ACTIVE}.png`;
      const answer = await image(path);

      expectPng(answer);
      expect(answer.response.headers.get("Cache-Control")).toBe("max-age=300");
      expect(await storedAs(path)).toEqual(SLOW);
      expect(keys({ requests: withoutNames(mock.requests) })).toEqual([`xrpl GET /v2/accounts/${ACTIVE}`, `xrpl GET /v2/accounts/${ACTIVE}/balances`]);
      expect(namesCalls(mock)).toEqual([[ACTIVE]]);

      // The fixtures' verified name is the headline, in the text font, with the whole address under it; the note says who verified it and when the account was activated.
      expect(view.name?.kind).toBe("verified");
      expect(drawing).toHaveBeenCalledTimes(1);
      expect(drawing.mock.calls[0]![0]).toEqual({
        network: "xrpl",
        networkLabel: "XRPL mainnet",
        kind: "Account",
        headline: { text: linkTextOf(view), mono: false },
        parties: [ACTIVE],
        note: `Verified by ${view.domain} · Activated 15 Jul 2025`,
        footer: [{ text: "Balance " }, { text: "10.001625 XRP", mono: true }],
      });
    } finally {
      drawing.mockRestore();
    }
  });

  it("is a Xahau card for a Xahau account, named from Xahau's own table", async () => {
    const view = (await viewOf("xahau", XAHAU_ACTIVE))!;
    expect(view.name?.kind).toBe("verified");
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xahau");
      const answer = await image(`/og/xahau/account/${XAHAU_ACTIVE}.png`);
      expectPng(answer);
      expect(await storedAs(`/og/xahau/account/${XAHAU_ACTIVE}.png`)).toEqual(SLOW);
      expect(hex((await decodePng(answer.bytes)).pixel(600, 4))).toBe("#B45309");

      expect(namesCalls(mock)).toEqual([[XAHAU_ACTIVE]]);
      expect(drawing.mock.calls[0]![0]).toMatchObject({
        network: "xahau",
        headline: { text: linkTextOf(view), mono: false },
        parties: [XAHAU_ACTIVE],
        note: expect.stringMatching(new RegExp(`^${vouchedByOf(view)} · Activated `)),
      });
    } finally {
      drawing.mockRestore();
    }
  });

  it("is drawn for an account that was deleted (the index knows it), without a balance, and warns that GateHub has labelled it, keeping its address for the headline", async () => {
    const view = (await viewOf("xrpl", DELETED))!;
    expect(view.name?.kind).toBe("account");
    expect(view.labels).toEqual(["advisory"]);
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const path = `/og/xrpl/account/${DELETED}.png`;
      expectPng(await image(path));
      expect(await storedAs(path)).toEqual(SLOW);

      // A name beside a warning is not put first: the headline is the address, as today's, and the note's first words are the warning.
      const card = drawing.mock.calls[0]![0];
      expect(card.headline).toEqual({ text: DELETED, mono: true });
      expect(card.parties).toBeUndefined();
      expect(card.note).toMatch(/^Warning: labelled advisory by GateHub · Named by GateHub(?: · Activated \d{1,2} [A-Z][a-z]{2} \d{4})?$/);
      expect(card.footer).toEqual([{ text: "Account on XRPL" }]);
    } finally {
      drawing.mockRestore();
    }
  });

  it("makes no names call and draws today's card while NAMES is off: the route reads the switch of its environment", async () => {
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
      const off = createLoadContext({ ...(env as unknown as Env), NAMES: "off" }, ctx);
      const response = (await ogLoader({
        request: new Request(`https://explorer.test/og/xrpl/account/${ACTIVE}.png`),
        params: { net: "xrpl", kind: "account", id: ACTIVE },
        context: off,
      } as never)) as Response;

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Cache-Class")).toBe("slow");
      expect(namesCalls(mock)).toEqual([]);
      expect(drawing.mock.calls[0]![0]).toMatchObject({ headline: { text: ACTIVE, mono: true }, note: "Activated 15 Jul 2025" });
      expect(drawing.mock.calls[0]![0].parties).toBeUndefined();
    } finally {
      drawing.mockRestore();
    }
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

// ---- A validator (validators spec 8) ----------------------------------------------------------------------------------------------------

describe("a validator", () => {
  it("is a PNG of 1200 × 630, class slow, from D alone, drawn from D's answer", async () => {
    const { key, domain } = await validatorCase("xrpl", "verified-unl");
    const path = `/og/xrpl/validator/${key}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    const puts: Array<string | null> = [];
    const put = caches.default.put.bind(caches.default);
    const storing = vi.spyOn(caches.default, "put").mockImplementation(async (request, response) => {
      puts.push((response as Response).headers.get("Cache-Control"));
      return put(request, response);
    });
    try {
      mock = mockUpstream("xrpl");
      const answer = await image(path);

      expectPng(answer);
      expect(answer.response.headers.get("Cache-Control")).toBe("max-age=300");
      expect(answer.response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(await storedAs(path)).toEqual(SLOW);
      // One call: D, the node is not asked, and nothing else of the validators.
      expect(keys(mock)).toEqual([`xrpl ${validatorCall(key)}`]);
      // D is kept for the page's 10 s (the page and the image share the entry).
      await vi.waitFor(() => expect(puts).toContain("public, max-age=10"));

      expect(drawing).toHaveBeenCalledTimes(1);
      expect(drawing.mock.calls[0]![0]).toMatchObject({
        network: "xrpl",
        networkLabel: "XRPL mainnet",
        kind: "Validator",
        headline: { text: domain, mono: false },
        parties: [key],
        note: "On the default UNL · domain verified · rippled 3.4.1",
        footer: [{ text: "XRPL" }],
      });
    } finally {
      storing.mockRestore();
      drawing.mockRestore();
    }
  });

  it("is a different card for a validator with no domain, with the short key in mono, and the same one again from the edge cache", async () => {
    const { key } = await validatorCase("xrpl", "no-domain");
    const path = `/og/xrpl/validator/${key}.png`;
    const detail = await fixtureValidator("xrpl", key);
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const first = await image(path);
      expectPng(first);
      expect(first.response.headers.get("X-Cache")).toBe("MISS");
      expect(drawing.mock.calls[0]![0]).toMatchObject({
        kind: "Validator",
        headline: { text: `${key.slice(0, 6)}…${key.slice(-4)}`, mono: true },
        parties: [key],
      });
      expect(drawing.mock.calls[0]![0].note ?? "").not.toContain("domain verified");
      expect(detail.domain).toBeUndefined();

      await storedAs(path);
      const again = await image(path);
      expect(again.response.headers.get("X-Cache")).toBe("HIT");
      expect(again.bytes).toEqual(first.bytes);
      expect(drawing).toHaveBeenCalledTimes(1);
    } finally {
      drawing.mockRestore();
    }
  });

  it("does not call a domain verified that D says is not", async () => {
    const { key } = await validatorCase("xrpl", "unverified");
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      expectPng(await image(`/og/xrpl/validator/${key}.png`));
      expect(drawing.mock.calls[0]![0].note ?? "").not.toContain("domain verified");
    } finally {
      drawing.mockRestore();
    }
  });

  it("is a Xahau card in Xahau's accent, with xahaud's version, for a Xahau validator", async () => {
    const { key } = await validatorCase("xahau", "xahau-build");
    const path = `/og/xahau/validator/${key}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xahau");
      const answer = await image(path);

      expectPng(answer);
      expect(await storedAs(path)).toEqual(SLOW);
      expect(hex((await decodePng(answer.bytes)).pixel(600, 4))).toBe("#B45309");
      expect(keys(mock)).toEqual([`xahau ${validatorCall(key)}`]);
      expect(drawing.mock.calls[0]![0]).toMatchObject({ network: "xahau", networkLabel: "Xahau mainnet", kind: "Validator", footer: [{ text: "Xahau" }] });
      expect(drawing.mock.calls[0]![0].note).toMatch(/xahaud \S+$/);
    } finally {
      drawing.mockRestore();
    }
  });

  it("is a 404 of class short for a key D does not know, after asking D", async () => {
    // A key no fixture has: D answers its own not-found message, "Validator not found".
    const key = SAMPLE_KEYS[5];
    const path = `/og/xrpl/validator/${key}.png`;
    mock = mockUpstream("xrpl");
    const { response } = await image(path);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await storedAs(path)).toEqual(SHORT);
    expect(statusesOf(mock, validatorCall(key))).toEqual([404]);
  });

  it("is a 302 of class immutable to the base58 key for 66 hex digits, in either case, without a call", async () => {
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const base58 = SAMPLE_KEYS[6];
      for (const spelled of [keyHex(base58), keyHex(base58).toLowerCase()]) {
        const path = `/og/xrpl/validator/${spelled}.png`;
        const response = await get(path);
        await response.arrayBuffer();

        expect(response.status, spelled).toBe(302);
        expect(response.headers.get("Location"), spelled).toBe(`/og/xrpl/validator/${base58}.png`);
        expect(response.headers.get("Content-Type"), spelled).not.toBe("image/png");
        expect(await storedAs(path)).toEqual(IMMUTABLE);
      }
      expect(mock.requests).toEqual([]);
      expect(drawing).not.toHaveBeenCalled();
    } finally {
      drawing.mockRestore();
    }
  });

  it("is a 302 of class slow to the master key's image for a signing key, after asking D, and draws nothing", async () => {
    const { key, signing } = await validatorCase("xrpl", "signing-key");
    const path = `/og/xrpl/validator/${signing}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const response = await get(path);
      await response.arrayBuffer();

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/og/xrpl/validator/${key}.png`);
      expect(response.headers.get("Cache-Control")).toBe("max-age=300");
      expect(response.headers.get("Content-Type")).not.toBe("image/png");
      expect(await storedAs(path)).toEqual(SLOW);
      expect(keys(mock)).toEqual([`xrpl ${validatorCall(signing!)}`]);
      expect(drawing).not.toHaveBeenCalled();
    } finally {
      drawing.mockRestore();
    }
  });

  it("is followed from a signing key to the master key's image", async () => {
    const { key, signing } = await validatorCase("xrpl", "signing-key");
    mock = mockUpstream("xrpl");
    const redirect = await get(`/og/xrpl/validator/${signing}.png`);
    await redirect.arrayBuffer();
    expect(redirect.headers.get("Location")).toBe(`/og/xrpl/validator/${key}.png`);
    expectPng(await image(redirect.headers.get("Location")!));
  });
});

// ---- An amendment (validators spec 8) ---------------------------------------------------------------------------------------------------

describe("an amendment", () => {
  it.each([
    ["enabled from the ledger", "enabled-ledger", /^Enabled on \w{3} \d{1,2}, \d{4}$/],
    ["enabled from the metadata file", "enabled-metadata", /^Enabled on \w{3} \d{1,2}, \d{4}$/],
    ["with a majority", "majority", /^Majority since .+ · activates on or soon after .+$/],
    ["being voted on", "voting", /^Voting · [\d,]+ of [\d,]+ UNL validators vote yes$/],
    ["obsolete", "obsolete", /^Obsolete$/],
    ["nameless", "unknown", /^Unknown amendment$/],
  ] as const)("is a PNG of 1200 × 630, class slow, from AD alone, for an amendment %s", async (_what, which, note) => {
    const { id, name } = await amendmentCase("xrpl", which);
    // The URL of an amendment is its name, else its ID.
    const segment = name ?? id;
    const path = `/og/xrpl/amendment/${segment}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const answer = await image(path);

      expectPng(answer);
      expect(answer.response.headers.get("Cache-Control")).toBe("max-age=300");
      expect(answer.response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(await storedAs(path)).toEqual(SLOW);
      expect(keys(mock)).toEqual([`xrpl ${amendmentCall(segment)}`]);

      expect(drawing).toHaveBeenCalledTimes(1);
      const card = drawing.mock.calls[0]![0];
      expect(card).toMatchObject({ network: "xrpl", kind: "Amendment", footerEnd: `${id.slice(0, 6)}…${id.slice(-4)}` });
      expect(card.headline).toEqual(name === undefined ? { text: `${id.slice(0, 6)}…${id.slice(-4)}`, mono: true } : { text: name, mono: true });
      expect(card.note).toMatch(note);
    } finally {
      drawing.mockRestore();
    }
  });

  it("is a PNG for a name AD holds in another case, once the redirect is followed (D1 takes a name in any case when it is unique)", async () => {
    mock = mockUpstream("xrpl", { [amendmentCall("amm")]: xrplAmm });
    const redirect = await get("/og/xrpl/amendment/amm.png");
    await redirect.arrayBuffer();

    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe("/og/xrpl/amendment/AMM.png");
    expect(redirect.headers.get("Cache-Control")).toBe("max-age=300");
    expect(redirect.headers.get("Content-Type")).not.toBe("image/png");
    expect(await storedAs("/og/xrpl/amendment/amm.png")).toEqual(SLOW);
    expect(statusesOf(mock, amendmentCall("amm"))).toEqual([200]);
    expectPng(await image(redirect.headers.get("Location")!));
  });

  it("is a 302 of class slow to the name for the ID of a named amendment in lower case, asked for in upper case", async () => {
    const { id, name } = await amendmentCase("xahau", "majority");
    expect(name).toBeDefined();
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xahau");
      const path = `/og/xahau/amendment/${id.toLowerCase()}.png`;
      const response = await get(path);
      await response.arrayBuffer();

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/og/xahau/amendment/${name}.png`);
      expect(response.headers.get("Cache-Control")).toBe("max-age=300");
      expect(await storedAs(path)).toEqual(SLOW);
      expect(statusesOf(mock, amendmentCall(id))).toEqual([200]);
      expect(drawing).not.toHaveBeenCalled();
    } finally {
      drawing.mockRestore();
    }
  });

  it("is a 302 of class slow to the upper-case ID for the lower-case ID of a nameless amendment, and for the ID of a named amendment to its name", async () => {
    const { id: nameless } = await amendmentCase("xrpl", "unknown");
    mock = mockUpstream("xrpl");
    const lower = await get(`/og/xrpl/amendment/${nameless.toLowerCase()}.png`);
    await lower.arrayBuffer();
    expect(lower.status).toBe(302);
    expect(lower.headers.get("Location")).toBe(`/og/xrpl/amendment/${nameless}.png`);
    expect(await storedAs(`/og/xrpl/amendment/${nameless.toLowerCase()}.png`)).toEqual(SLOW);

    // The ID in upper case is a named amendment's, not its canonical URL either.
    const { id, name } = await amendmentCase("xrpl", "obsolete");
    const byId = await get(`/og/xrpl/amendment/${id}.png`);
    await byId.arrayBuffer();
    expect(byId.status).toBe(302);
    expect(byId.headers.get("Location")).toBe(`/og/xrpl/amendment/${name}.png`);
    expect(await storedAs(`/og/xrpl/amendment/${id}.png`)).toEqual(SLOW);
  });

  it("is a Xahau card in Xahau's accent for a Xahau amendment, and a retired one is drawn too", async () => {
    const { name } = await amendmentCase("xahau", "retired");
    const path = `/og/xahau/amendment/${name}.png`;
    mock = mockUpstream("xahau");
    const answer = await image(path);

    expectPng(answer);
    expect(await storedAs(path)).toEqual(SLOW);
    expect(hex((await decodePng(answer.bytes)).pixel(600, 4))).toBe("#B45309");
    expect(keys(mock)).toEqual([`xahau ${amendmentCall(name!)}`]);
  });

  it("is a 404 of class short for an amendment AD does not know, after asking AD", async () => {
    // XChainBridge is XRPL's: Xahau's AD answers its own not-found message, "amendment not found".
    const path = "/og/xahau/amendment/XChainBridge.png";
    mock = mockUpstream("xahau");
    const { response } = await image(path);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await storedAs(path)).toEqual(SHORT);
    expect(statusesOf(mock, amendmentCall("XChainBridge"))).toEqual([404]);
  });
});

// ---- An AMM pool (AMM spec 5.2) ---------------------------------------------------------------------------------------------------------

describe("an AMM pool", () => {
  it("is a PNG of 1200 × 630, class slow, from the index alone: the pool and its create event, the page's keys, never the node", async () => {
    const path = `/og/xrpl/amm/${AMM_POOL}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const first = await image(path);

      expectPng(first);
      expect(first.response.headers.get("Cache-Control")).toBe("max-age=300");
      expect(first.response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(first.response.headers.get("X-Cache")).toBe("MISS");
      expect(await storedAs(path)).toEqual(SLOW);
      // Two calls, side by side, the page's own: the node is not asked, so an image costs no node call.
      expect(keys(mock)).toEqual([`xrpl ${ammCreateCall(AMM_POOL)}`, `xrpl ${ammPoolCall(AMM_POOL)}`].sort());

      // The pair as the page's heading has it (the pool is stored RLUSD/XRP), the whole account, the index's value and fee; the index has no creation of it.
      expect(drawing).toHaveBeenCalledTimes(1);
      expect(drawing.mock.calls[0]![0]).toEqual({
        network: "xrpl",
        networkLabel: "XRPL mainnet",
        kind: "AMM pool",
        headline: { text: "XRP / RLUSD", mono: false },
        parties: [AMM_POOL],
        note: "Value 3.7M XRP · trading fee 0.205%",
        footer: [{ text: "AMM pool on XRPL" }],
      });

      // The same card again from the edge cache: nothing drawn, nothing asked.
      const again = await image(path);
      expect(again.response.headers.get("X-Cache")).toBe("HIT");
      expect(again.bytes).toEqual(first.bytes);
      expect(drawing).toHaveBeenCalledTimes(1);
      expect(mock.requests.length).toBe(2);
    } finally {
      drawing.mockRestore();
    }
  });

  it("is drawn in XRPL's accent, with text on it", async () => {
    mock = mockUpstream("xrpl");
    const png = await decodePng((await image(`/og/xrpl/amm/${AMM_POOL}.png`)).bytes);
    expect(hex(png.pixel(600, 4))).toBe("#0A6CF1");
    expect(hex(png.pixel(10, 300))).toBe("#FFFFFF");
    let dark = 0;
    for (let y = 200; y < 420; y += 2) for (let x = 60; x < 1140; x += 2) if (png.pixel(x, y)[0]! < 80) dark += 1;
    expect(dark).toBeGreaterThan(300);
  });

  it("says the day of the creation where the index has the create event, and the pair in the page's orientation", async () => {
    const path = `/og/xrpl/amm/${AMM_DVR_POOL}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const answer = await image(path);

      expectPng(answer);
      expect(await storedAs(path)).toEqual(SLOW);
      expect(keys(mock)).toEqual([`xrpl ${ammCreateCall(AMM_DVR_POOL)}`, `xrpl ${ammPoolCall(AMM_DVR_POOL)}`].sort());
      expect(drawing.mock.calls[0]![0]).toMatchObject({
        headline: { text: "DVR / XRP", mono: false },
        parties: [AMM_DVR_POOL],
        note: "Value 1,000 XRP · trading fee 1.000%",
        footer: [{ text: "Created 12 Oct 2026" }],
      });
    } finally {
      drawing.mockRestore();
    }
  });

  it("is a card of two tokens in display order", async () => {
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      expectPng(await image(`/og/xrpl/amm/${AMM_USDC_POOL}.png`));
      expect(drawing.mock.calls[0]![0]).toMatchObject({ headline: { text: "USDC / RLUSD", mono: false }, kind: "AMM pool" });
    } finally {
      drawing.mockRestore();
    }
  });

  it("says only the part of the note the index has: a value without a fee, and neither", async () => {
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      expectPng(await image(`/og/xrpl/amm/${AMM_ARK_POOL}.png`));
      expectPng(await image(`/og/xrpl/amm/${AMM_HODL_POOL}.png`));
      const [neither, valueOnly] = drawing.mock.calls.map(([card]) => card);
      expect(neither).toMatchObject({ headline: { text: "ARK / PLX", mono: false }, parties: [AMM_ARK_POOL] });
      expect("note" in neither!).toBe(false);
      expect(valueOnly).toMatchObject({ headline: { text: "HODL / XRP", mono: false }, note: "Value 4,550.13 XRP", footer: [{ text: "AMM pool on XRPL" }] });
    } finally {
      drawing.mockRestore();
    }
  });

  it("is a card of a deleted pool, class slow like a live one, that says it is deleted and nothing of a value", async () => {
    const path = `/og/xrpl/amm/${AMM_SNK_POOL}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const answer = await image(path);

      expectPng(answer);
      expect(await storedAs(path)).toEqual(SLOW);
      expect(drawing.mock.calls[0]![0]).toMatchObject({ headline: { text: "SNK / XRP", mono: false }, note: "Deleted pool", parties: [AMM_SNK_POOL] });
      expect(drawing.mock.calls[0]![0].note).not.toContain("Value");
    } finally {
      drawing.mockRestore();
    }
  });

  it("is drawn for a pool whose code has no text, with the digits the page shows, and for a pool with no value, with only its fee", async () => {
    const path = `/og/xrpl/amm/${AMM_VOX_POOL}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const answer = await image(path);

      expectPng(answer);
      expect(await storedAs(path)).toEqual(SLOW);
      const card = drawing.mock.calls[0]![0];
      // The code is 40 hex digits that are no text: its first eight and an ellipsis, as everywhere (formatCurrency). Not the name it was given by hand.
      expect(card.headline.text).toMatch(/^[0-9A-F]{8}… \/ XRP$/);
      expect(card.headline.mono).toBe(false);
      expect(card.note).toBe("Trading fee 1.000%");
    } finally {
      drawing.mockRestore();
    }
  });

  it("is a 404 of class short when the index has no such pool, and the node is not asked in its place", async () => {
    // A pool younger than the aggregator's minute has no image for that minute: the page shows it from the node, the image does not.
    const id = account(0x71);
    const path = `/og/xrpl/amm/${id}.png`;
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const { response } = await image(path);

      expect(response.status).toBe(404);
      expect(response.headers.get("Content-Type")).not.toBe("image/png");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(await storedAs(path)).toEqual(SHORT);
      expect(statusesOf(mock, ammPoolCall(id))).toEqual([404]);
      expect(mock.requests.filter((r) => r.kind === "node")).toEqual([]);
      expect(drawing).not.toHaveBeenCalled();
    } finally {
      drawing.mockRestore();
    }
  });

  it("is a 404 of class short, with no call, whenever AMM_PAGES is off: the route reads the switch of its environment", async () => {
    const drawing = vi.spyOn(render, "renderCard");
    try {
      mock = mockUpstream("xrpl");
      const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
      const off = createLoadContext({ ...(env as unknown as Env), AMM_PAGES: "off" }, ctx);
      const path = `/og/xrpl/amm/${AMM_POOL}.png`;
      const response = (await ogLoader({
        request: new Request(`https://explorer.test${path}`),
        params: { net: "xrpl", kind: "amm", id: AMM_POOL },
        context: off,
      } as never)) as Response;

      expect(response.status).toBe(404);
      expect(response.headers.get("Content-Type")).not.toBe("image/png");
      expect(response.headers.get("X-Cache-Class")).toBe("short");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(mock.requests).toEqual([]);
      expect(drawing).not.toHaveBeenCalled();
    } finally {
      drawing.mockRestore();
    }
  });
});

// ---- An NFT (NFT spec 10) --------------------------------------------------------------------------------------------------------------------

describe("an NFT", () => {
  let drawing: MockInstance<typeof render.renderCard>;
  beforeEach(() => {
    drawing = vi.spyOn(render, "renderCard");
  });
  afterEach(() => {
    drawing.mockRestore();
  });

  const OWNER = "rLCscV9iDJpvje4ZCKxGjYAMNtBA1Ltauk";

  it("is a PNG of 1200 × 630, class slow, from the index alone: the NFT, never its offers or history; the card is the page's own facts", async () => {
    const path = `/og/xrpl/nft/${NFT_FEATURED.id}.png`;
    mock = mockUpstream("xrpl");
    const first = await image(path);

    expectPng(first);
    expect(first.response.headers.get("Cache-Control")).toBe("max-age=300");
    expect(first.response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(first.response.headers.get("X-Cache")).toBe("MISS");
    expect(await storedAs(path)).toEqual(SLOW);
    // One call: an NFT with an owner needs no node, and an image needs neither the offers nor the history.
    expect(keys(mock)).toEqual([`xrpl ${nftCall(NFT_FEATURED.id)}`]);

    // The kind, the number, the owner in full, the last sale, the collection; the index does not tell the mint, so the footer names the network.
    expect(drawing).toHaveBeenCalledTimes(1);
    expect(drawing.mock.calls[0]![0]).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "NFT",
      headline: { text: "#107,604,335", mono: true },
      parties: [OWNER],
      note: "Last sale 150 XRP",
      footer: [{ text: "NFT on XRPL" }],
      footerEnd: "rLxc1b…rwMy · taxon 0",
    });

    // The same card again from the edge cache: nothing drawn, nothing asked.
    const again = await image(path);
    expect(again.response.headers.get("X-Cache")).toBe("HIT");
    expect(again.bytes).toEqual(first.bytes);
    expect(drawing).toHaveBeenCalledTimes(1);
    expect(mock.requests.length).toBe(1);
  });

  it("is drawn in XRPL's accent, with text on it", async () => {
    mock = mockUpstream("xrpl");
    const png = await decodePng((await image(`/og/xrpl/nft/${NFT_FEATURED.id}.png`)).bytes);
    expect(hex(png.pixel(600, 4))).toBe("#0A6CF1");
    expect(hex(png.pixel(10, 300))).toBe("#FFFFFF");
    let dark = 0;
    for (let y = 200; y < 420; y += 2) for (let x = 60; x < 1140; x += 2) if (png.pixel(x, y)[0]! < 80) dark += 1;
    expect(dark).toBeGreaterThan(300);
  });

  it("says the day of the mint where the index has it, and the price in the NFT's own currency", async () => {
    const id = nftOf(200);
    const minted = { ledger_index: 86201334, tx_hash: "A".repeat(64), executed_time: "2024-03-14T09:00:00Z", by: "rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy", to: OWNER };
    mock = mockUpstream("xrpl", {
      [nftCall(id)]: nftAnswer(id, {
        minted,
        last_sale: { amount: "1250.5", currency: "USD", amount_issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq", converted_amount: "1200", ledger_index: 1, tx_hash: "B".repeat(64), executed_time: "2026-10-20T17:01:12Z" },
        sale_count: 3,
      }),
    });
    const answer = await image(`/og/xrpl/nft/${id}.png`);

    expectPng(answer);
    expect(await storedAs(`/og/xrpl/nft/${id}.png`)).toEqual(SLOW);
    // (The sample's own serial, taxon and issuer: only its id is made up.)
    expect(drawing.mock.calls[0]![0]).toMatchObject({ note: "Last sale 1,250.5 USD", footer: [{ text: "Minted 14 Mar 2024" }], headline: { text: "#95,234,705", mono: true }, footerEnd: "r4PP7g…CzT3 · taxon 10" });
  });

  it("says Never sold for an NFT that was not, and how often for one with no price", async () => {
    const [never, some] = [nftOf(201), nftOf(202)];
    mock = mockUpstream("xrpl", {
      [nftCall(never)]: nftAnswer(never, { sale_count: 0, last_sale: undefined }),
      [nftCall(some)]: nftAnswer(some, { sale_count: 3, last_sale: undefined }),
    });
    expectPng(await image(`/og/xrpl/nft/${never}.png`));
    expectPng(await image(`/og/xrpl/nft/${some}.png`));
    expect(drawing.mock.calls.map(([card]) => card.note)).toEqual(["Never sold", "Sold 3 times"]);
  });

  it("is a burned NFT's card, class slow like a live one's: the note says Burned and there is no owner; the node is not asked", async () => {
    const path = `/og/xrpl/nft/${NFT_BURNED.id}.png`;
    mock = mockUpstream("xrpl");
    const answer = await image(path);

    expectPng(answer);
    expect(await storedAs(path)).toEqual(SLOW);
    expect(keys(mock)).toEqual([`xrpl ${nftCall(NFT_BURNED.id)}`]);
    const card = drawing.mock.calls[0]![0];
    expect(card).toMatchObject({ kind: "NFT", headline: { text: "#102,436,236", mono: true }, note: "Burned", footerEnd: "ravC5c…abec · taxon 0" });
    expect("parties" in card).toBe(false);
  });

  it("asks the node for the owner of an NFT the index has without one, after the index, and draws it", async () => {
    const path = `/og/xrpl/nft/${NFT_UNOWNED.id}.png`;
    mock = mockUpstream("xrpl");
    const answer = await image(path);

    expectPng(answer);
    expect(await storedAs(path)).toEqual(SLOW);
    expect(keys(mock)).toEqual([`xrpl ${nftCall(NFT_UNOWNED.id)}`, `xrpl node nft_info ledger_index=validated&nft_id=${NFT_UNOWNED.id}`].sort());
    expect(drawing.mock.calls[0]![0]).toMatchObject({ parties: ["rHhvUexKKSJZG9vuZKX2kNendG2TXoavG9"], note: "Never sold" });
  });

  it.each([
    [300, "does not have the NFT (objectNotFound)", () => nodeError("objectNotFound")],
    [301, "is not Clio (unknownCmd is not found too)", () => nodeError("unknownCmd")],
  ])("is drawn without an owner, class slow and not degraded, for an NFT the index has without one when the node %s: an answer, not a failure", async (n, _what, answer) => {
    const id = nftOf(n);
    const path = `/og/xrpl/nft/${id}.png`;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mock = mockUpstream("xrpl", { [nftCall(id)]: nftAnswer(id, UNOWNED_NFT), [nftInfoCall(id)]: answer() });
      const drawn = await image(path);

      expectPng(drawn);
      // The node was asked after the index, and its "not found" is an answer: the card is kept as long as any other (a failure of the node would make it `short`).
      expect(keys(mock)).toEqual([`xrpl ${nftCall(id)}`, `xrpl node nft_info ledger_index=validated&nft_id=${id}`].sort());
      expect(await storedAs(path)).toEqual(SLOW);
      const card = drawing.mock.calls[0]![0];
      expect("parties" in card).toBe(false);
      expect(card.note).toBe("Never sold");
      expect(errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("left out its owner"))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it("is drawn from the node for an NFT only it has, class short kept 60 s: the index takes over after that; the note says it is not in the index yet", async () => {
    const path = `/og/xrpl/nft/${NFT_NETWORK.id}.png`;
    mock = mockUpstream("xrpl");
    const answer = await image(path);

    expectPng(answer);
    expect(await storedAs(path)).toEqual(FROM_NODE);
    // The node's NFT only (never its offers): the index answered "not found" to #1.
    expect(keys(mock)).toEqual([`xrpl ${nftCall(NFT_NETWORK.id)}`, `xrpl node nft_info ledger_index=validated&nft_id=${NFT_NETWORK.id}`].sort());
    expect(statusesOf(mock, nftCall(NFT_NETWORK.id))).toEqual([404]);
    expect(drawing.mock.calls[0]![0]).toMatchObject({
      kind: "NFT",
      headline: { text: "#98,894,589", mono: true },
      parties: ["r4Xgqy68ykjLEJAkFQ7EaFs8VEdSiWkSeX"],
      note: "Not in the index yet",
      footer: [{ text: "NFT on XRPL" }],
      footerEnd: "raNypR…RV92 · taxon 123,589,321",
    });
  });

  it("is a burned NFT's card from the node, class short kept 60 s", async () => {
    const path = `/og/xrpl/nft/${NFT_NETWORK_BURNED.id}.png`;
    mock = mockUpstream("xrpl");
    expectPng(await image(path));
    expect(await storedAs(path)).toEqual(FROM_NODE);
    const card = drawing.mock.calls[0]![0];
    expect(card.note).toBe("Burned");
    expect("parties" in card).toBe(false);
  });

  it("is a 404 of class short, drawn nothing, for an id neither the index nor the node has", async () => {
    const path = `/og/xrpl/nft/${NFT_MISSING.id}.png`;
    mock = mockUpstream("xrpl");
    const { response } = await image(path);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await storedAs(path)).toEqual(SHORT);
    expect(keys(mock)).toEqual([`xrpl ${nftCall(NFT_MISSING.id)}`, `xrpl node nft_info ledger_index=validated&nft_id=${NFT_MISSING.id}`].sort());
    expect(drawing).not.toHaveBeenCalled();
  });

  it("is a 302 of class immutable to the upper-case id, with no call and nothing drawn, for an id in lower or mixed case", async () => {
    mock = mockUpstream("xrpl");
    for (const written of [NFT_FEATURED.id.toLowerCase(), `${NFT_FEATURED.id.slice(0, 20).toLowerCase()}${NFT_FEATURED.id.slice(20)}`]) {
      const path = `/og/xrpl/nft/${written}.png`;
      const response = await get(path);
      await response.arrayBuffer();
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/og/xrpl/nft/${NFT_FEATURED.id}.png`);
      expect(await storedAs(path)).toEqual(IMMUTABLE);
    }
    expect(mock.requests).toEqual([]);
    expect(drawing).not.toHaveBeenCalled();
  });

  it("is a URIToken's card on Xahau: the kind, the short id for a headline, and Xahau's accent", async () => {
    const path = `/og/xahau/nft/${URI_FEATURED.id}.png`;
    mock = mockUpstream("xahau");
    const answer = await image(path);

    expectPng(answer);
    expect(await storedAs(path)).toEqual(SLOW);
    expect(keys(mock)).toEqual([`xahau ${nftCall(URI_FEATURED.id)}`]);
    expect(drawing.mock.calls[0]![0]).toMatchObject({
      network: "xahau",
      networkLabel: "Xahau mainnet",
      kind: "URIToken",
      headline: { text: "96133366…AAE9", mono: true },
      parties: ["rBkEp8W1yhBGLrvHFKKyrmSvniMFVJbPPg"],
      note: "Last sale 4,200 XAH",
      footer: [{ text: "URIToken on Xahau" }],
      footerEnd: "rodinG…zKyb",
    });
    const png = await decodePng(answer.bytes);
    expect(hex(png.pixel(600, 4))).toBe("#B45309");
  });

  it("is drawn from the entry for a URIToken only the node has, class short kept 60 s", async () => {
    const path = `/og/xahau/nft/${URI_NETWORK.id}.png`;
    mock = mockUpstream("xahau");
    expectPng(await image(path));
    expect(await storedAs(path)).toEqual(FROM_NODE);
    expect(keys(mock)).toEqual([`xahau ${nftCall(URI_NETWORK.id)}`, `xahau node ledger_entry index=${URI_NETWORK.id}&ledger_index=validated`].sort());
    expect(drawing.mock.calls[0]![0]).toMatchObject({ kind: "URIToken", note: "Not in the index yet", footerEnd: "rodinG…zKyb" });
  });

  it("is a 404 of class short while NFTS is off, with no call: the route reads the switch of its environment", async () => {
    mock = mockUpstream("xrpl");
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const off = createLoadContext({ ...(env as unknown as Env), NFTS: "off" }, ctx);
    const response = (await ogLoader({
      request: new Request(`https://explorer.test/og/xrpl/nft/${NFT_FEATURED.id}.png`),
      params: { net: "xrpl", kind: "nft", id: NFT_FEATURED.id },
      context: off,
    } as never)) as Response;

    expect(response.status).toBe(404);
    expect(response.headers.get("X-Cache-Class")).toBe("short");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(mock.requests).toEqual([]);
    expect(drawing).not.toHaveBeenCalled();
  });
});

// A token's image (token pages spec 7.2): the page's own call #1, alone, and the card made of the facts of the page's tags (`tokenFacts`). Class `slow`: its figures change. It is a 404 of class
// `short`, before any call, while `TOKENS` is off (tokens-off.spec.ts) and for an id the token page would not read; another spelling of a token is a 302 to the canonical image.
describe("a token", () => {
  let drawing: MockInstance<typeof render.renderCard>;
  beforeEach(() => {
    drawing = vi.spyOn(render, "renderCard");
  });
  afterEach(() => {
    drawing.mockRestore();
  });

  it("is a PNG of 1200 × 630, class slow, from the index alone: the token's own call, never the node; the card is the page's own facts", async () => {
    const path = `/og/xrpl/token/${TOKEN_RLUSD.path}.png`;
    mock = mockUpstream("xrpl");
    const first = await image(path);

    expectPng(first);
    expect(first.response.headers.get("Cache-Control")).toBe("max-age=300");
    expect(first.response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(first.response.headers.get("X-Cache")).toBe("MISS");
    expect(await storedAs(path)).toEqual(SLOW);
    // One call, the page's #1 under its key: the holders, the transfers, the pools and the issuer's settings are not an image's business.
    expect(keys(mock)).toEqual([`xrpl ${tokenCall(TOKEN_RLUSD)}`]);

    // The toml's name for the headline, the issuer in full, the holders and the supply as the page's tags have them, the domain that lists it.
    expect(drawing).toHaveBeenCalledTimes(1);
    expect(drawing.mock.calls[0]![0]).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "Issued token",
      headline: { text: "Ripple USD", mono: false },
      parties: [TOKEN_RLUSD.issuer],
      note: "96 holders · supply 21.9M RLUSD",
      footer: [{ text: "Listed in ripple.com's toml" }],
    });

    // The same card again from the edge cache: nothing drawn, nothing asked.
    const again = await image(path);
    expect(again.response.headers.get("X-Cache")).toBe("HIT");
    expect(again.bytes).toEqual(first.bytes);
    expect(drawing).toHaveBeenCalledTimes(1);
    expect(mock.requests.length).toBe(1);
  });

  it("is drawn in XRPL's accent, with text on it", async () => {
    mock = mockUpstream("xrpl");
    const png = await decodePng((await image(`/og/xrpl/token/${TOKEN_RLUSD.path}.png`)).bytes);
    expect(hex(png.pixel(600, 4))).toBe("#0A6CF1");
    expect(hex(png.pixel(10, 300))).toBe("#FFFFFF");
    let dark = 0;
    for (let y = 200; y < 420; y += 2) for (let x = 60; x < 1140; x += 2) if (png.pixel(x, y)[0]! < 80) dark += 1;
    expect(dark).toBeGreaterThan(300);
  });

  it("is the code in mono and the network in the footer for a token its issuer's toml does not list", async () => {
    mock = mockUpstream("xrpl");
    const path = `/og/xrpl/token/${TOKEN_USD.path}.png`;
    const answer = await image(path);

    expectPng(answer);
    expect(await storedAs(path)).toEqual(SLOW);
    expect(keys(mock)).toEqual([`xrpl ${tokenCall(TOKEN_USD)}`]);
    expect(drawing.mock.calls[0]![0]).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "Issued token",
      headline: { text: "USD", mono: true },
      parties: [TOKEN_USD.issuer],
      note: "72 holders · supply 8.06M USD",
      footer: [{ text: "Issued token on XRPL" }],
    });
  });

  it("is Xahau's card on Xahau, in Xahau's accent, asked of Xahau's data API", async () => {
    mock = mockUpstream("xahau");
    const path = `/og/xahau/token/${TOKEN_EVR.path}.png`;
    const answer = await image(path);

    expectPng(answer);
    expect(await storedAs(path)).toEqual(SLOW);
    expect(keys(mock)).toEqual([`xahau ${tokenCall(TOKEN_EVR)}`]);
    expect(drawing.mock.calls[0]![0]).toMatchObject({
      network: "xahau",
      networkLabel: "Xahau mainnet",
      kind: "Issued token",
      headline: { text: "Evernode", mono: false },
      parties: [TOKEN_EVR.issuer],
      note: "88 holders · supply 16.3M EVR",
      footer: [{ text: "Listed in evernode.org's toml" }],
    });
    expect(hex((await decodePng(answer.bytes)).pixel(600, 4))).toBe("#B45309");
  });

  it("is a different card for a different token", async () => {
    mock = mockUpstream("xrpl");
    const rlusd = await image(`/og/xrpl/token/${TOKEN_RLUSD.path}.png`);
    const usd = await image(`/og/xrpl/token/${TOKEN_USD.path}.png`);
    expect(usd.bytes).not.toEqual(rlusd.bytes);
  });

  it("is drawn for a name that holds emoji, a script Geist lacks and more than a card has room for: never a 503 that a visitor would meet on every try", async () => {
    const token = madeUp(8);
    const path = `/og/xrpl/token/${token.path}.png`;
    const name = `🔥 火 ${"Long name ".repeat(30)}`;
    const detail = tokenDetailSample({ currency: token.currency, code: token.currency, issuer: token.issuer, domain: `${"d".repeat(120)}.example`, toml: { name } });
    mock = mockUpstream("xrpl", { [tokenCall(token)]: tokenSample({ token: detail }) });
    const answer = await image(path);

    expectPng(answer);
    expect(await storedAs(path)).toEqual(SLOW);
    const [card] = drawing.mock.calls[0]!;
    expect(card.headline.text).toBe(name);
    expect(card.footer[0]!.text).toMatch(/^Listed in d{49}…'s toml$/);
  });

  it("says holder of a token with one holder, and is drawn", async () => {
    const token = madeUp(9);
    mock = mockUpstream("xrpl", { [tokenCall(token)]: tokenSample({ token: tokenDetailSample({ currency: token.currency, code: token.currency, issuer: token.issuer, holders: 1, toml: undefined, listed: false }) }) });
    const answer = await image(`/og/xrpl/token/${token.path}.png`);

    expectPng(answer);
    expect(drawing.mock.calls[0]![0].note).toBe("1 holder · supply 7,320 T9A");
  });

  it.each([
    ["a code in lower case", "usd.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B", `/og/xrpl/token/${TOKEN_USD.path}.png`],
    ["a plus for the dot", "usd+rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B", `/og/xrpl/token/${TOKEN_USD.path}.png`],
    ["the 40 hex digits of a text code", `${TOKEN_RLUSD.currency}.${TOKEN_RLUSD.issuer}`, `/og/xrpl/token/${TOKEN_RLUSD.path}.png`],
    ["the 40 hex digits of a text code in lower case", `${TOKEN_RLUSD.currency.toLowerCase()}.${TOKEN_RLUSD.issuer}`, `/og/xrpl/token/${TOKEN_RLUSD.path}.png`],
    ["the ledger's own hex of a standard code", `${"0".repeat(24)}555344${"0".repeat(10)}.${TOKEN_USD.issuer}`, `/og/xrpl/token/${TOKEN_USD.path}.png`],
  ])("redirects %s to the canonical image, for good, without asking anyone or drawing", async (_what, id, location) => {
    mock = mockUpstream("xrpl");
    const path = `/og/xrpl/token/${id}.png`;
    const response = await get(path);
    await response.arrayBuffer();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(location);
    expect(mock.requests).toEqual([]);
    expect(drawing).not.toHaveBeenCalled();
    expect(await storedAs(path)).toEqual(IMMUTABLE);
  });

  it("is followed from another spelling to the image", async () => {
    mock = mockUpstream("xrpl");
    // LIONS's 40 hex digits in lower case: the token no earlier test has asked for, so that the image is drawn here and the call is seen.
    const redirect = await get(`/og/xrpl/token/${TOKEN_LIONS.currency.toLowerCase()}.${TOKEN_LIONS.issuer}.png`);
    await redirect.arrayBuffer();
    expect(redirect.headers.get("Location")).toBe(`/og/xrpl/token/${TOKEN_LIONS.path}.png`);
    const followed = await image(redirect.headers.get("Location")!);
    expectPng(followed);
    expect(keys(mock)).toEqual([`xrpl ${tokenCall(TOKEN_LIONS)}`]);
  });

  it("takes a text code for its bytes: rlusd is another token than RLUSD, and the index says it has none", async () => {
    const issuer = TOKEN_RLUSD.issuer;
    const path = `/og/xrpl/token/rlusd.${issuer}.png`;
    mock = mockUpstream("xrpl");
    const { response } = await image(path);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    // Asked once, under the currency of the text `rlusd` (its bytes, in hex), and not redirected to RLUSD.
    const bytes = `GET /v2/tokens/726C757364${"0".repeat(30)}.${issuer}`;
    expect(keys(mock)).toEqual([`xrpl ${bytes}`]);
    expect(statusesOf(mock, bytes)).toEqual([404]);
    expect(drawing).not.toHaveBeenCalled();
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("is a 404 of class short when the index says token not found, drawn nothing, the node not asked", async () => {
    const token = madeUp(3);
    const path = `/og/xrpl/token/${token.path}.png`;
    mock = mockUpstream("xrpl", { [tokenCall(token)]: dataApiError(404, "token not found") });
    const { response } = await image(path);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("max-age=0");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(keys(mock)).toEqual([`xrpl ${tokenCall(token)}`]);
    expect(drawing).not.toHaveBeenCalled();
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("is a 404 of class short, with no call, whenever TOKENS is off: the route reads the switch of its environment", async () => {
    mock = mockUpstream("xrpl");
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const off = createLoadContext({ ...(env as unknown as Env), TOKENS: "off" }, ctx);
    const response = (await ogLoader({
      request: new Request(`https://explorer.test/og/xrpl/token/${TOKEN_RLUSD.path}.png`),
      params: { net: "xrpl", kind: "token", id: TOKEN_RLUSD.path },
      context: off,
    } as never)) as Response;

    expect(response.status).toBe(404);
    expect(response.headers.get("X-Cache-Class")).toBe("short");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(mock.requests).toEqual([]);
    expect(drawing).not.toHaveBeenCalled();
  });
});
