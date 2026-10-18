import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { dropsToNative, formatAmount, formatCurrency, formatUtc, shortAddress, shortHash } from "../../app/domain/format";
import { pageClient } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The tags of the pages (spec 9) on the real Worker against the recorded answers of the data API and the nodes: a `<title>`, a
// description built from the page's data, a canonical URL, Open Graph and Twitter card tags with the image on the origin of the
// request, and `noindex` where the spec says. The builders are tested on their own in app/server/meta.test.ts; the image behind
// `og:image` is test/worker/og.spec.ts.

const { page, get } = pageClient("198.19.1");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

const ORIGIN = "https://explorer.test";

// ---- Reading the head of a page ---------------------------------------------------------------------------------------------

const decode = (text: string) =>
  text.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function attributesOf(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [match[1]!, decode(match[2]!)]));
}

/** The `<title>`, and every `<meta>` and `<link>` of the head of a page. */
function head(html: string) {
  const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((match) => decode(match[1]!));
  const metas = [...html.matchAll(/<meta\s[^>]*>/g)].map((match) => attributesOf(match[0]));
  const links = [...html.matchAll(/<link\s[^>]*>/g)].map((match) => attributesOf(match[0]));
  /** The content of the meta with this `name` or `property`; fails if it is there twice. */
  const content = (key: string) => {
    const found = metas.filter((meta) => meta.name === key || meta.property === key);
    expect(found.length, `${key} is set ${found.length} times`).toBeLessThanOrEqual(1);
    return found[0]?.content;
  };
  const canonical = links.filter((link) => link.rel === "canonical").map((link) => link.href);
  return { titles, metas, links, content, canonical };
}

const SHARING = ["og:title", "og:description", "og:url", "og:type", "og:site_name", "og:image", "og:image:width", "og:image:height", "og:image:alt", "twitter:card", "twitter:title", "twitter:description", "twitter:image"];

// ---- The recorded transactions ------------------------------------------------------------------------------------------------

const files = import.meta.glob("../fixtures/http/*/data-api/transactions/*.json", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
type Net = "xrpl" | "xahau";
interface Recorded {
  hash: string;
  ledger_index: number;
  tx: Record<string, any>;
  meta: Record<string, any>;
}
async function recorded(net: Net, hash: string): Promise<Recorded> {
  const load = files[`../fixtures/http/${net}/data-api/transactions/${hash}.json`];
  if (!load) throw new Error(`no fixture for ${net} ${hash}`);
  return (JSON.parse(await load()) as { transaction: Recorded }).transaction;
}

const NATIVE = { xrpl: "XRP", xahau: "XAH" } as const;
const NAMES = { xrpl: "XRPL", xahau: "Xahau" } as const;

/** The description of a Payment, from the recording's own values: what it delivered, from whom, to whom, and the ledger. */
function paymentDescription(net: Net, rec: Recorded): string {
  const delivered = rec.meta.delivered_amount ?? rec.tx.Amount;
  const amount =
    typeof delivered === "string"
      ? `${formatAmount(dropsToNative(delivered))} ${NATIVE[net]}`
      : `${formatAmount(delivered.value)} ${formatCurrency(delivered.currency)}`;
  return `Payment of ${amount} from ${shortAddress(rec.tx.Account)} to ${shortAddress(rec.tx.Destination)} · ${NAMES[net]} ledger ${formatAmount(String(rec.ledger_index))}`;
}

// XRPL: a plain XRP Payment (ledger 102186243), a Payment of RLUSD that was paid with another currency (107713744), an OfferCreate that
// failed with tecKILLED (107721455). Xahau: a Payment of EVR (26596843) and a Payment that the index does not have yet (the node does).
const PAYMENT = "AACAFCFEBB5C970049A576CBFE6EF544A47EE3ADBA99122FA43234D18D5FFD40";
const CROSS_CURRENCY = "8014250A4FB1AC8859C4743090B7A905F2738253C010B968E272368A3FE59900";
const KILLED = "D05D52934A382E975B131A3E729CDA7CA3C59E94CE9F3DC3DC91A6ADFC5C140F";
const XAHAU_EVR = "704535FB6927CE0E20FBFE00976E5F6A3267C4E4A9099ECB8B534779C74103C7";

describe("a transaction page", () => {
  it("has a title, a description built from the transaction, a canonical URL and the sharing tags", async () => {
    mock = mockUpstream("xrpl");
    const rec = await recorded("xrpl", PAYMENT);
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    const tags = head(html);

    const title = `Payment ${shortHash(PAYMENT)} · XRPL · explorer`;
    const description = paymentDescription("xrpl", rec);
    expect(description).toBe("Payment of 2.306481 XRP from rBbW6i…W5jh to rDFDjd…fy48 · XRPL ledger 102,186,243");
    expect(tags.titles).toEqual([title]);
    expect(tags.content("description")).toBe(description);
    expect(tags.canonical).toEqual([`${ORIGIN}/xrpl/tx/${PAYMENT}`]);

    expect(tags.content("og:title")).toBe(title);
    expect(tags.content("og:description")).toBe(description);
    expect(tags.content("og:url")).toBe(`${ORIGIN}/xrpl/tx/${PAYMENT}`);
    expect(tags.content("og:type")).toBe("website");
    expect(tags.content("og:site_name")).toBe("explorer");
    expect(tags.content("og:image")).toBe(`${ORIGIN}/og/xrpl/tx/${PAYMENT}.png`);
    expect(tags.content("og:image:width")).toBe("1200");
    expect(tags.content("og:image:height")).toBe("630");
    expect(tags.content("og:image:alt")).toBeTruthy();
    expect(tags.content("twitter:card")).toBe("summary_large_image");
    expect(tags.content("twitter:title")).toBe(title);
    expect(tags.content("twitter:description")).toBe(description);
    expect(tags.content("twitter:image")).toBe(`${ORIGIN}/og/xrpl/tx/${PAYMENT}.png`);
    expect(tags.content("robots")).toBeUndefined();
  });

  it("says what a payment of an issued currency delivered, whatever it was paid with", async () => {
    mock = mockUpstream("xrpl");
    const rec = await recorded("xrpl", CROSS_CURRENCY);
    const { html } = await page(`/xrpl/tx/${CROSS_CURRENCY}`);
    const description = head(html).content("description");
    expect(description).toBe(paymentDescription("xrpl", rec));
    expect(description).toContain("Payment of 2.99 RLUSD from");
  });

  it("says the same of a Xahau transaction, on Xahau, with the image of Xahau", async () => {
    mock = mockUpstream("xahau");
    const rec = await recorded("xahau", XAHAU_EVR);
    const { html } = await page(`/xahau/tx/${XAHAU_EVR}`);
    const tags = head(html);
    expect(tags.content("description")).toBe(paymentDescription("xahau", rec));
    expect(tags.content("description")).toMatch(/ · Xahau ledger 26,596,843$/);
    expect(tags.canonical).toEqual([`${ORIGIN}/xahau/tx/${XAHAU_EVR}`]);
    expect(tags.content("og:image")).toBe(`${ORIGIN}/og/xahau/tx/${XAHAU_EVR}.png`);
  });

  it("says the sentence of a transaction that failed, with the reason", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${KILLED}`);
    const tags = head(html);
    const description = tags.content("description");
    expect(description).toMatch(/ tried to /);
    expect(description).toMatch(/ · XRPL ledger 107,721,455$/);
    expect(tags.content("og:image")).toBe(`${ORIGIN}/og/xrpl/tx/${KILLED}.png`);
    expect(tags.content("robots")).toBeUndefined();
  });

  it("is shown from the node with the same tags: the image route can draw it from the node too", async () => {
    const hash = "D437E9B6486965D1E97D3737FD00A4B0C9615DFFF3ECC813EF6A3A6CB44B945F";
    mock = mockUpstream("xahau", { [`GET /v2/transactions/${hash}`]: null });
    const rec = await recorded("xahau", hash);
    const { html } = await page(`/xahau/tx/${hash}`);
    const tags = head(html);
    expect(tags.content("description")).toBe(paymentDescription("xahau", rec));
    expect(tags.canonical).toEqual([`${ORIGIN}/xahau/tx/${hash}`]);
    expect(tags.content("og:image")).toBe(`${ORIGIN}/og/xahau/tx/${hash}.png`);
  });

  it("holds no age and nothing that depends on who looks or when", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    const tags = head(html);
    for (const key of ["description", "og:description", "twitter:description", "og:title", "og:image:alt"]) {
      expect(tags.content(key), key).not.toMatch(/\bago\b|just now|\d+ (s|min|h|d)\b/);
    }
  });

  it("is a page of its own on any origin that asks: the tags name the origin of the request", async () => {
    mock = mockUpstream("xrpl");
    const fetchAt = async (origin: string) => {
      const response = await exports.default.fetch(`${origin}/xrpl/tx/${PAYMENT}`, { headers: { "CF-Connecting-IP": "198.19.1.200" } });
      return head(await response.text());
    };
    const staging = await fetchAt("https://staging.explorer.example");
    expect(staging.canonical).toEqual([`https://staging.explorer.example/xrpl/tx/${PAYMENT}`]);
    expect(staging.content("og:url")).toBe(`https://staging.explorer.example/xrpl/tx/${PAYMENT}`);
    expect(staging.content("og:image")).toBe(`https://staging.explorer.example/og/xrpl/tx/${PAYMENT}.png`);
    expect(staging.content("twitter:image")).toBe(`https://staging.explorer.example/og/xrpl/tx/${PAYMENT}.png`);

    const local = await fetchAt("http://localhost:8788");
    expect(local.content("og:image")).toBe(`http://localhost:8788/og/xrpl/tx/${PAYMENT}.png`);
    expect(local.canonical).toEqual([`http://localhost:8788/xrpl/tx/${PAYMENT}`]);
  });

  it("has no tags to share on the pages that are not the transaction", async () => {
    mock = mockUpstream("xrpl");
    const unknown = head((await page(`/xrpl/tx/${"0D".repeat(32)}`, 404)).html);
    expect(unknown.content("robots")).toBe("noindex");
    expect(unknown.canonical).toEqual([]);
    for (const key of SHARING) expect(unknown.content(key), key).toBeUndefined();

    const redirect = await get(`/xrpl/tx/${PAYMENT.toLowerCase()}`);
    await redirect.text();
    expect(redirect.status).toBe(302);
  });
});

// ---- A ledger -----------------------------------------------------------------------------------------------------------------------

const ledgerFiles = import.meta.glob("../fixtures/http/xrpl/data-api/ledgers/107720688@expand=true&transactions=true.json", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

describe("a ledger page", () => {
  const HASH = "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02";

  it("has a title, a description built from the ledger, a canonical URL and the sharing tags", async () => {
    mock = mockUpstream("xrpl");
    const recordedLedger = JSON.parse(await Object.values(ledgerFiles)[0]!()) as { ledger: { close_time: number; transactions: unknown[] } };
    const { html } = await page("/xrpl/ledger/107720688");
    const tags = head(html);

    const description = `Ledger 107,720,688 on XRPL closed ${formatUtc(recordedLedger.ledger.close_time)} with ${recordedLedger.ledger.transactions.length} transactions.`;
    expect(description).toMatch(/with 66 transactions\.$/);
    expect(tags.titles).toEqual(["Ledger #107,720,688 · XRPL · explorer"]);
    expect(tags.content("description")).toBe(description);
    expect(tags.canonical).toEqual([`${ORIGIN}/xrpl/ledger/107720688`]);
    expect(tags.content("og:title")).toBe("Ledger #107,720,688 · XRPL · explorer");
    expect(tags.content("og:description")).toBe(description);
    expect(tags.content("og:url")).toBe(`${ORIGIN}/xrpl/ledger/107720688`);
    expect(tags.content("og:image")).toBe(`${ORIGIN}/og/xrpl/ledger/107720688.png`);
    expect(tags.content("og:image:width")).toBe("1200");
    expect(tags.content("og:image:height")).toBe("630");
    expect(tags.content("twitter:card")).toBe("summary_large_image");
    expect(tags.content("twitter:image")).toBe(`${ORIGIN}/og/xrpl/ledger/107720688.png`);
    expect(tags.content("robots")).toBeUndefined();
  });

  it("is the same page, with the same canonical URL and image, reached by its hash", async () => {
    mock = mockUpstream("xrpl");
    const tags = head((await page(`/xrpl/ledger/${HASH}`)).html);
    expect(tags.canonical).toEqual([`${ORIGIN}/xrpl/ledger/107720688`]);
    expect(tags.content("og:image")).toBe(`${ORIGIN}/og/xrpl/ledger/107720688.png`);
  });

  it("is a Xahau page on Xahau", async () => {
    mock = mockUpstream("xahau");
    const tags = head((await page("/xahau/ledger/26540187")).html);
    expect(tags.titles).toEqual(["Ledger #26,540,187 · Xahau · explorer"]);
    expect(tags.content("og:image")).toBe(`${ORIGIN}/og/xahau/ledger/26540187.png`);
    expect(tags.canonical).toEqual([`${ORIGIN}/xahau/ledger/26540187`]);
  });
});

// ---- An account ---------------------------------------------------------------------------------------------------------------------

describe("an account page", () => {
  const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";

  it("has a title, a description built from the account, a canonical URL and the sharing tags", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}`);
    const tags = head(html);

    const description = `${ACTIVE} on XRPL: Balance 10.001625 XRP, activated 2025-07-15. Transactions, payments, trades, offers and objects.`;
    expect(tags.titles).toEqual([`Account ${shortAddress(ACTIVE)} · XRPL · explorer`]);
    expect(tags.content("description")).toBe(description);
    expect(tags.canonical).toEqual([`${ORIGIN}/xrpl/account/${ACTIVE}`]);
    expect(tags.content("og:title")).toBe(`Account ${shortAddress(ACTIVE)} · XRPL · explorer`);
    expect(tags.content("og:description")).toBe(description);
    expect(tags.content("og:url")).toBe(`${ORIGIN}/xrpl/account/${ACTIVE}`);
    expect(tags.content("og:image")).toBe(`${ORIGIN}/og/xrpl/account/${ACTIVE}.png`);
    expect(tags.content("twitter:card")).toBe("summary_large_image");
    expect(tags.content("robots")).toBeUndefined();
  });

  it("keeps a tab that is not the default in the canonical URL, and shares the account's image", async () => {
    mock = mockUpstream("xrpl");
    const tags = head((await page(`/xrpl/account/${ACTIVE}?tab=payments`)).html);
    expect(tags.canonical).toEqual([`${ORIGIN}/xrpl/account/${ACTIVE}?tab=payments`]);
    expect(tags.content("og:url")).toBe(`${ORIGIN}/xrpl/account/${ACTIVE}?tab=payments`);
    expect(tags.content("og:image")).toBe(`${ORIGIN}/og/xrpl/account/${ACTIVE}.png`);
  });

  it("drops the destination tag, and the default tab when the URL names it, from the canonical URL", async () => {
    mock = mockUpstream("xrpl");
    const tagged = head((await page(`/xrpl/account/${ACTIVE}?tag=7`)).html);
    expect(tagged.canonical).toEqual([`${ORIGIN}/xrpl/account/${ACTIVE}`]);
    expect(tagged.content("og:url")).toBe(`${ORIGIN}/xrpl/account/${ACTIVE}`);

    const named = head((await page(`/xrpl/account/${ACTIVE}?tab=transactions&tag=7`)).html);
    expect(named.canonical).toEqual([`${ORIGIN}/xrpl/account/${ACTIVE}`]);
  });

  it("is noindex, follow on a page of old history, with no canonical URL and nothing to share", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?marker=WzEwNzYxMjU3MywyNV0`);
    const tags = head(html);
    expect(tags.content("robots")).toBe("noindex, follow");
    expect(tags.canonical).toEqual([]);
    for (const key of SHARING) expect(tags.content(key), key).toBeUndefined();
    expect(tags.content("description")).toBe(`Older transactions of the account ${ACTIVE} on XRPL.`);
  });

  it("has no canonical URL on a page of old history of another tab either", async () => {
    mock = mockUpstream("xrpl");
    const tags = head((await page(`/xrpl/account/${ACTIVE}?tab=payments&marker=WzEwNzYzNjY3Myw3OF0`)).html);
    expect(tags.content("robots")).toBe("noindex, follow");
    expect(tags.canonical).toEqual([]);
    expect(tags.content("description")).toBe(`Older payments of the account ${ACTIVE} on XRPL.`);
  });

  it("is noindex and shares nothing for an address that was never activated", async () => {
    mock = mockUpstream("xrpl");
    const tags = head((await page("/xrpl/account/rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC", 404)).html);
    expect(tags.content("robots")).toBe("noindex");
    expect(tags.canonical).toEqual([]);
    for (const key of SHARING) expect(tags.content(key), key).toBeUndefined();
  });
});

// ---- Home, search, errors ------------------------------------------------------------------------------------------------------------

describe("the home page", () => {
  it("has the tags of its network: a description that does not change, a canonical URL, and no image", async () => {
    mock = mockUpstream("xrpl");
    const tags = head((await page("/xrpl")).html);
    expect(tags.titles).toEqual(["Explore the XRP Ledger · explorer"]);
    expect(tags.content("description")).toBe("Look up any ledger, transaction or account on XRPL from validated history.");
    expect(tags.canonical).toEqual([`${ORIGIN}/xrpl`]);
    expect(tags.content("og:title")).toBe("Explore the XRP Ledger · explorer");
    expect(tags.content("og:url")).toBe(`${ORIGIN}/xrpl`);
    expect(tags.content("og:type")).toBe("website");
    expect(tags.content("og:site_name")).toBe("explorer");
    expect(tags.content("twitter:card")).toBe("summary");
    expect(tags.content("og:image")).toBeUndefined();
    expect(tags.content("twitter:image")).toBeUndefined();
    expect(tags.content("robots")).toBeUndefined();
  });

  it("is Xahau's on Xahau", async () => {
    mock = mockUpstream("xahau");
    const tags = head((await page("/xahau")).html);
    expect(tags.titles).toEqual(["Explore Xahau · explorer"]);
    expect(tags.canonical).toEqual([`${ORIGIN}/xahau`]);
    expect(tags.content("description")).toContain("on Xahau");
  });
});

describe("the pages that are not for a search engine", () => {
  it("keeps a search page noindex, follow, without a canonical URL or sharing tags", async () => {
    mock = mockUpstream("xrpl");
    const tags = head((await page("/xrpl/search?q=hello")).html);
    expect(tags.content("robots")).toBe("noindex, follow");
    expect(tags.canonical).toEqual([]);
    for (const key of SHARING) expect(tags.content(key), key).toBeUndefined();
  });

  it("keeps the 404 page noindex, without a canonical URL or sharing tags", async () => {
    mock = mockUpstream("xrpl");
    const tags = head((await page("/nowhere/at/all", 404)).html);
    expect(tags.content("robots")).toBe("noindex");
    expect(tags.canonical).toEqual([]);
    for (const key of SHARING) expect(tags.content(key), key).toBeUndefined();
  });

  it("keeps the page of a ledger nobody has noindex", async () => {
    mock = mockUpstream("xrpl");
    const tags = head((await page("/xrpl/ledger/99999999", 404)).html);
    expect(tags.content("robots")).toBe("noindex");
    for (const key of SHARING) expect(tags.content(key), key).toBeUndefined();
  });
});
