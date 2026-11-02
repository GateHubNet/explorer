import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { shortAddress } from "../../app/domain/format";
import * as render from "../../app/og/render";
import { cacheGeneration } from "../../app/server/env";
import { FEATURE_VARS } from "../../app/ui/features";
import { dataUrlOf, expectDrawn, expectNoNames, namesOffSpec, namesPartOf } from "../support/names";
import { elementText, textOf } from "../support/pages";
import { allSwitches } from "../support/switches";

// The pages that no other switch gates, with `NAMES` off (display names spec 2.2 and 6.1; global constraints), as the `worker-off` project has them (vitest.config.ts: every switch off): the
// home, the ledger, the transaction, the account's first five tabs and its link-preview image make no `account_names` request and no toml request, whatever they hold that a name could be made
// of (the account's node gives its Domain, which is the toml the page asks for with the switch on); draw no name and no mark (no `acct__name`); give an account the title and the heading it had
// before names; and a page of class `immutable` (a ledger that is closed, a transaction) is kept the year it had and not the hour it is kept while names are shown (`NAMED_PAGE_TTL_SECONDS`,
// whose pages ledger.spec.ts and transaction.spec.ts say are stored an hour with the switch on). The pages another switch gates are the next file's (pages-names-off.spec.ts): with every switch
// off they would be 404s or redirects before any call, and "no names request" of a 404 says nothing. What the two files check of each page, and their setup (`cold` lookups, one upstream mock a
// test, the pages asked for through the project's Worker and never through its entry), are test/support/names.ts's: `namesOffSpec`, `expectDrawn`, `expectNoNames`.

const { get, serve, storedAs, upstream } = namesOffSpec("198.18.80");
const YEAR = { cls: "immutable", ttl: 31_536_000 };

describe("the project", () => {
  it("has every switch off, NAMES among them", () => {
    for (const name of FEATURE_VARS) expect(env[name], name).toBe(allSwitches("off")[name]);
    expect(env.NAMES).toBe("off");
    // The pages below are kept under this generation of the cache.
    expect(cacheGeneration(env)).toContain("NAMES=off");
  });
});

const PAYMENT = "AACAFCFEBB5C970049A576CBFE6EF544A47EE3ADBA99122FA43234D18D5FFD40";
const REMIT = "8C50C44787A12B785AA62377D0AFA6C4711E8E07EF68BA6E83DC286F7EE79AAF";
const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const DELETED = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";
const XAHAU_ACTIVE = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";
const XAHAU_DELETED = "rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD";

describe("the home, ledger, transaction and account pages", () => {
  it.each([
    ["the XRPL home page", "xrpl", "/xrpl"],
    ["the Xahau home page", "xahau", "/xahau"],
  ] as const)("draws %s by addresses, and asks for no name", async (_, net, path) => {
    const mock = upstream(net);
    const { response, html } = await serve(path);

    expectDrawn(response, mock);
    expect((await expectNoNames(html, net)).length, "the page has accounts the fixtures name").toBeGreaterThan(0);
  });

  it("gives the home page's beat the names part off, with no names", async () => {
    const mock = upstream("xrpl");
    const { response, html } = await serve(dataUrlOf("/xrpl.data?beat=off", "routes/net._index"));

    expectDrawn(response, mock);
    expect(namesPartOf(html, "routes/net._index")).toEqual({ state: "off", map: {} });
  });

  it.each([
    ["a closed XRPL ledger", "xrpl", "/xrpl/ledger/107720688"],
    ["a closed Xahau ledger", "xahau", "/xahau/ledger/26540187"],
    ["an XRPL payment", "xrpl", `/xrpl/tx/${PAYMENT}`],
    ["a Xahau Remit", "xahau", `/xahau/tx/${REMIT}`],
  ] as const)("draws %s by addresses, asks for no name, and keeps it a year", async (_, net, path) => {
    const mock = upstream(net);
    const { response, html } = await serve(path);

    expectDrawn(response, mock);
    expect((await expectNoNames(html, net)).length, "the page has accounts the fixtures name").toBeGreaterThan(0);
    expect(await storedAs(path)).toEqual(YEAR);
  });

  it.each([
    ["transactions", ""],
    ["payments", "?tab=payments"],
    ["trades", "?tab=trades"],
    ["offers", "?tab=offers"],
    ["objects", "?tab=objects"],
  ])("draws the account's %s tab by addresses, with the address as its title and its heading, and asks for no name and no toml", async (_, query) => {
    const mock = upstream("xrpl");
    const { response, html } = await serve(`/xrpl/account/${ACTIVE}${query}`);

    expectDrawn(response, mock);
    await expectNoNames(html, "xrpl");
    // The account the fixtures name is the page's own; the Domain its node gives (northpeak.example) is what the toml is asked for with the switch on.
    expect(mock.requests.some((request) => request.key.startsWith(`node account_info account=${ACTIVE}`)), "the node is asked for the account").toBe(true);
    expect(html).toContain(`<title>Account ${shortAddress(ACTIVE)} · XRPL · explorer</title>`);
    expect(html).toContain(`<meta property="og:title" content="Account ${shortAddress(ACTIVE)} · XRPL · explorer"/>`);
    expect(textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)![1]!)).toBe(ACTIVE);
    expect(html).not.toContain("Northpeak");
    expect(html).not.toContain('class="disc"');
    expect(elementText(html, "account-head__kind")).toBeUndefined();
  });

  it.each([
    ["a deleted XRPL account", "xrpl", DELETED, "Harborline"],
    ["an active Xahau account", "xahau", XAHAU_ACTIVE, "Tidewater"],
    ["a deleted Xahau account", "xahau", XAHAU_DELETED, "scam"],
  ] as const)("draws %s with no name, no label's banner and no call", async (_, net, address, word) => {
    const mock = upstream(net);
    const { response, html } = await serve(`/${net}/account/${address}`);

    expectDrawn(response, mock);
    await expectNoNames(html, net);
    expect(textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)![1]!)).toBe(address);
    expect(html).not.toContain(word);
    expect(html).not.toMatch(/Labelled \w+ by GateHub/);
  });

  it("draws today's card for the account's image, and asks for no name and no toml", async () => {
    // The card is drawn from what the route asks of the upstreams (the drawing itself, Satori and resvg, is og.spec.ts's, in the `worker` project: a drawing in this project's runtime, with the
    // others running beside it, takes the Worker's memory down): `renderCard` is given the card and answers a few bytes.
    const drawing = vi.spyOn(render, "renderCard").mockResolvedValue(new Uint8Array([137, 80, 78, 71]).buffer);
    const mock = upstream("xrpl");
    const response = await get(`/og/xrpl/account/${ACTIVE}.png`);
    // An image is read as bytes: `text()` of a PNG makes the runtime warn.
    await response.arrayBuffer();

    expectDrawn(response, mock);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(mock.requests.some((request) => request.key.startsWith(`GET /v2/accounts/${ACTIVE}`)), "the card reads the account").toBe(true);
    // The headline is the address, as before names, and no party is named.
    expect(drawing).toHaveBeenCalledTimes(1);
    expect(drawing.mock.calls[0]![0]).toMatchObject({ headline: { text: ACTIVE, mono: true } });
    expect(drawing.mock.calls[0]![0].parties).toBeUndefined();
    expect(await storedAs(`/og/xrpl/account/${ACTIVE}.png`)).toEqual({ cls: "slow", ttl: 3600 });
  });
});
