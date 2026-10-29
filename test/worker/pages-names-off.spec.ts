import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { linkTextOf } from "../../app/domain/names";
import { FEATURE_VARS } from "../../app/ui/features";
import { dataUrlOf, isNamesRequest, isTomlRequest, linkedAccounts, linksTo, namedAmong, namesPartOf, viewOf } from "../support/names";
import { collectionCase, nftCase } from "../support/nft-cases";
import { pageClient, textOf } from "../support/pages";
import { cold } from "../support/subrequest-miss";
import { mockUpstream, type UpstreamMock } from "../support/upstream";
import { validatorCase } from "../support/validators-cases";

// The pages that another switch gates, with only `NAMES` off (display names spec 2.2 and 6.1; global constraints): the account's Analytics view and NFTs tab, the markets and a pair, the AMM
// list and a pool, a swap through it, the validators, the NFT pages. They make no `account_names` request and no toml request, whatever they hold that a name could be made of, and draw no
// name or mark (no `acct__name`). The `worker-off` project (names-off.spec.ts) has every switch off, where each of these is a 404 or a redirect before any call, and "no names request" of a
// 404 says nothing; the `worker-names-off` project (vitest.config.ts) has every switch on but this one, so that each page is there. Each page also says what a name would have been made
// of: an account the fixtures name that it links, or a short address it draws (the tables that write an issuer as text).
//
// Every lookup of a subrequest entry misses (`cold`), so that a call the page would make reaches the mock whatever an earlier render of the file kept: a names request that is missing is the
// switch's doing, not the cache's.

vi.setConfig({ testTimeout: 20_000 });

const { get } = pageClient("198.18.81");

let mock: UpstreamMock | undefined;
beforeEach(() => {
  cold();
});
afterEach(() => {
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
  expect(unused ?? []).toEqual([]);
});

/** The names and toml requests a mock saw: none, with the switch off, whatever the page. */
const nameCalls = (seen: UpstreamMock) => seen.requests.filter((request) => isNamesRequest(request) || isTomlRequest(request)).map((request) => request.url);

/** The page as the Worker answers it: read to its end (a page streams). */
async function serve(path: string) {
  const response = await get(path);
  const html = await response.text();
  return { response, html };
}

/**
 * Says that the page in `html` draws no name: no `acct__name`, no mark (`namemark`), and every link to an account the fixtures name, which the page has, is not what `linkTextOf` makes of its
 * name and has not the title that says how the name is known. Returns the accounts it linked that the fixtures name: with the switch on those links would be names.
 */
async function expectNoNames(html: string, net: "xrpl" | "xahau"): Promise<string[]> {
  expect(html).not.toContain("acct__name");
  expect(html).not.toContain("namemark");
  const named = await namedAmong(net, linkedAccounts(html, net));
  for (const address of named) {
    const view = (await viewOf(net, address))!;
    for (const link of linksTo(html, net, address)) {
      expect(link.text, `the link to ${address}`).not.toContain(linkTextOf(view));
      expect(link.attrs, `the link to ${address}`).not.toContain("Verified by");
    }
  }
  return named;
}

/** What a page has to say for itself: it was drawn, from the mock, and the calls of names and toml were not made. */
function expectDrawn(response: Response, seen: UpstreamMock) {
  expect(response.status).toBe(200);
  expect(seen.requests.length, "the page was drawn from the upstream").toBeGreaterThan(0);
  expect(nameCalls(seen)).toEqual([]);
}

const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const SWAP = "52E2AD5B382D4588BECF6A743E7AE5C84D49A5C06968EC7700E8333BF41E1C60";
const FEATURED_COLLECTION = await collectionCase("xrpl", "featured");
const FEATURED_NFT = await nftCase("xrpl", "featured");
const URI_COLLECTION = await collectionCase("xahau", "featured");
const URI_NFT = await nftCase("xahau", "featured");
const VALIDATOR = await validatorCase("xrpl", "with-accounts");
const URI_VALIDATOR = await validatorCase("xahau", "with-accounts");

/** What a page that names nothing says for itself when it links no account the fixtures name: a short address it draws. */
const SHORT_ADDRESS = /\br[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4}\b/;

describe("the project", () => {
  it("has every switch on but NAMES", () => {
    for (const name of FEATURE_VARS) expect(env[name], name).toBe(name === "NAMES" ? "off" : "on");
  });
});

describe("the pages the other switches gate", () => {
  it.each([
    ["the account's Analytics view", "xrpl", `/xrpl/account/${ACTIVE}?tab=analytics`, "linked"],
    ["the account's NFTs tab", "xrpl", `/xrpl/account/${ACTIVE}?tab=nfts`, "linked"],
    ["the markets", "xrpl", "/xrpl/markets", "short"],
    ["the Xahau markets", "xahau", "/xahau/markets", "short"],
    ["the pair XRP/RLUSD", "xrpl", `/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}`, "short"],
    ["the AMM pools", "xrpl", "/xrpl/amm", "short"],
    ["a pool", "xrpl", `/xrpl/amm/${POOL}`, "short"],
    ["a pool's liquidity", "xrpl", `/xrpl/amm/${POOL}?tab=liquidity`, "short"],
    ["a swap through the pool", "xrpl", `/xrpl/tx/${SWAP}`, "short"],
    ["the XRPL validator with accounts", "xrpl", `/xrpl/validators/${VALIDATOR.key}`, "linked"],
    ["the Xahau validator with accounts", "xahau", `/xahau/validators/${URI_VALIDATOR.key}`, "short"],
    ["the NFTs", "xrpl", "/xrpl/nfts", "short"],
    ["the Xahau URITokens", "xahau", "/xahau/nfts", "short"],
    ["the older sales", "xrpl", "/xrpl/nfts/sales", "short"],
    ["an NFT collection", "xrpl", `/xrpl/nfts/${FEATURED_COLLECTION.issuer}/${FEATURED_COLLECTION.taxon}`, "short"],
    ["a URIToken collection", "xahau", `/xahau/nfts/${URI_COLLECTION.issuer}`, "short"],
    ["an NFT", "xrpl", `/xrpl/nft/${FEATURED_NFT.id}`, "short"],
    ["a URIToken", "xahau", `/xahau/nft/${URI_NFT.id}`, "short"],
  ] as const)("draws %s by addresses, with the page there, and asks for no name and no toml", async (_, net, path, says) => {
    mock = mockUpstream(net);
    const { response, html } = await serve(path);

    expectDrawn(response, mock);
    const named = await expectNoNames(html, net);
    // The page is there (the switch it is gated by is on): not the 404 or the redirect the `worker-off` project's Worker would have given it.
    expect(html).not.toContain("Page not found");
    // And it has what a name would be made of.
    if (says === "linked") expect(named.length, `${path} links accounts the fixtures name`).toBeGreaterThan(0);
    else expect(textOf(html), `${path} draws a short address`).toMatch(SHORT_ADDRESS);
  });

  it.each([
    ["the pair's beat", `/xrpl/markets/XRP/RLUSD.${RLUSD_ISSUER}.data?interval=4h`, "routes/net.markets.$base.$counter"],
    ["the validator's beat", `/xrpl/validators/${VALIDATOR.key}.data`, "routes/net.validators.$key"],
  ])("gives %s the names part off, with no names", async (_, path, route) => {
    mock = mockUpstream("xrpl");
    const { response, html } = await serve(dataUrlOf(path, route));

    expectDrawn(response, mock);
    expect(namesPartOf(html, route)).toEqual({ state: "off", map: {} });
  });
});
