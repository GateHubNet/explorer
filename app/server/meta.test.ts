import { describe, expect, it } from "vitest";

import type { FlowStep } from "../domain/describe";
import { accountMeta, homeMeta, imageUrl, ledgerMeta, metaContext, transactionDescription, transactionMeta, type MetaContext } from "./meta";

// The tags of the pages (spec 9) as pure functions over the page data and the origin of the request. The data below is what the
// view builders return for the fields the tags read; the worker specs (test/worker/meta.spec.ts) check the whole way from a
// recorded transaction to the HTML.

const XRPL: MetaContext = { network: { id: "xrpl", name: "XRPL" }, origin: "https://explorer.test" };
const XAHAU: MetaContext = { network: { id: "xahau", name: "Xahau" }, origin: "https://explorer.test" };

type Tag = Record<string, string>;
const tags = (list: ReadonlyArray<unknown>) => list as Tag[];
/** The content of the `<meta>` with this `name` or `property`. */
function content(list: ReadonlyArray<unknown>, key: string): string | undefined {
  return tags(list).find((tag) => tag.name === key || tag.property === key)?.content;
}
/** The `href` of the `<link rel=...>`. */
function link(list: ReadonlyArray<unknown>, rel: string): string | undefined {
  return tags(list).find((tag) => tag.tagName === "link" && tag.rel === rel)?.href;
}
/** Every `name`/`property` the list sets. */
const keys = (list: ReadonlyArray<unknown>) => tags(list).flatMap((tag) => (tag.name ?? tag.property ? [(tag.name ?? tag.property)!] : []));

const SENDER = "rJF2XaTeEvbk3EsoyVnrdeXVcbkXFQvg";
const RECEIVER = "rNYbL8Zz3Nzu5Fr9Q1Wwf1zQ5pQbwUKq5";
const HASH = "67F91E0000000000000000000000000000000000000000000000000000007C31";

const payment = (flow: FlowStep[] | null = [
  { role: "sender", account: SENDER, label: "Sender", amount: { value: "1250.00", currency: "USD", issuer: "rIssuer" } },
  { role: "destination", account: RECEIVER, label: "Destination", amount: { value: "1250.00", currency: "USD", issuer: "rIssuer" } },
]) => ({
  hash: HASH,
  ledgerIndex: 107695660,
  closeTime: 1792251720,
  type: "Payment",
  title: "Payment",
  ok: true,
  account: SENDER,
  summary: "rJF2Xa…FQvg sent 1,250.00 USD to rNYbL8…UKq5.",
  flow,
});

describe("transactionDescription", () => {
  it("says what moved, from whom and to whom, and where it is", () => {
    expect(transactionDescription(payment(), XRPL.network)).toBe("Payment of 1,250.00 USD from rJF2Xa…FQvg to rNYbL8…UKq5 · XRPL ledger 107,695,660");
  });

  it("names the delivered amount and the two ends of a payment that went through pools", () => {
    const flow: FlowStep[] = [
      { role: "sender", account: SENDER, label: "Sender", amount: { value: "10", currency: "XRP" } },
      { role: "pool", account: "rPool", label: "XRP/USD AMM pool", amount: { value: "1250", currency: "USD" } },
      { role: "destination", account: RECEIVER, label: "Destination · tag 7", amount: { value: "1250", currency: "USD" } },
    ];
    expect(transactionDescription(payment(flow), XAHAU.network)).toBe("Payment of 1,250 USD from rJF2Xa…FQvg to rNYbL8…UKq5 · Xahau ledger 107,695,660");
  });

  it("writes a currency code as the page does", () => {
    const flow: FlowStep[] = [
      { role: "sender", account: SENDER, label: "Sender" },
      { role: "destination", account: RECEIVER, label: "Destination", amount: { value: "5", currency: "534F4C4F00000000000000000000000000000000" } },
    ];
    expect(transactionDescription(payment(flow), XRPL.network)).toContain("Payment of 5 SOLO from");
  });

  it("says the sentence for a payment to oneself (a swap), which has more to say than 'from A to A'", () => {
    const flow: FlowStep[] = [
      { role: "sender", account: SENDER, label: "Sender", amount: { value: "10", currency: "XRP" } },
      { role: "destination", account: SENDER, label: "Destination", amount: { value: "1250", currency: "USD" } },
    ];
    const swap = { ...payment(flow), summary: "rJF2Xa…FQvg paid 1,250 USD to rJF2Xa…FQvg, spending 10 XRP through the XRP/USD AMM pool." };
    expect(transactionDescription(swap, XRPL.network)).toBe(
      "rJF2Xa…FQvg paid 1,250 USD to rJF2Xa…FQvg, spending 10 XRP through the XRP/USD AMM pool · XRPL ledger 107,695,660",
    );
  });

  it("falls back to the sentence of the page for a transaction with no flow, without its full stop", () => {
    const offer = { ...payment(null), title: "Offer", summary: "rJF2Xa…FQvg offered 5 XRP for 3 USD." };
    expect(transactionDescription(offer, XRPL.network)).toBe("rJF2Xa…FQvg offered 5 XRP for 3 USD · XRPL ledger 107,695,660");
  });

  it("falls back to the sentence, with its reason, for a transaction that failed", () => {
    const failed = {
      ...payment(null),
      ok: false,
      summary: "rJF2Xa…FQvg tried to pay 1,250.00 USD to rNYbL8…UKq5. No path had enough liquidity to deliver the amount.",
    };
    expect(transactionDescription(failed, XRPL.network)).toBe(
      "rJF2Xa…FQvg tried to pay 1,250.00 USD to rNYbL8…UKq5. No path had enough liquidity to deliver the amount · XRPL ledger 107,695,660",
    );
  });

  it("falls back when a flow has no amount at its end", () => {
    const flow: FlowStep[] = [
      { role: "sender", account: SENDER, label: "Sender" },
      { role: "destination", account: RECEIVER, label: "Destination" },
    ];
    expect(transactionDescription(payment(flow), XRPL.network)).toBe("rJF2Xa…FQvg sent 1,250.00 USD to rNYbL8…UKq5 · XRPL ledger 107,695,660");
  });

  it("holds no age and nothing of the visitor", () => {
    expect(transactionDescription(payment(), XRPL.network)).not.toMatch(/ago|\d+ (s|min|h|d)\b|just now/);
  });
});

describe("transactionMeta", () => {
  const tx = payment();
  const list = transactionMeta(tx, XRPL);

  it("has a title and a description", () => {
    expect(tags(list).find((tag) => "title" in tag)?.title).toBe("Payment 67F91E…7C31 · XRPL · explorer");
    expect(content(list, "description")).toBe(transactionDescription(tx, XRPL.network));
  });

  it("has a canonical URL on the origin of the request", () => {
    expect(link(list, "canonical")).toBe(`https://explorer.test/xrpl/tx/${HASH}`);
    expect(link(transactionMeta(tx, { ...XRPL, origin: "http://localhost:8788" }), "canonical")).toBe(`http://localhost:8788/xrpl/tx/${HASH}`);
  });

  it("has the Open Graph tags, with the image on the same origin", () => {
    expect(content(list, "og:title")).toBe("Payment 67F91E…7C31 · XRPL · explorer");
    expect(content(list, "og:description")).toBe(content(list, "description"));
    expect(content(list, "og:url")).toBe(`https://explorer.test/xrpl/tx/${HASH}`);
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "og:image")).toBe(`https://explorer.test/og/xrpl/tx/${HASH}.png`);
    expect(content(list, "og:image:width")).toBe("1200");
    expect(content(list, "og:image:height")).toBe("630");
    expect(content(list, "og:image:alt")).toBeTruthy();
  });

  it("has the Twitter card tags", () => {
    expect(content(list, "twitter:card")).toBe("summary_large_image");
    expect(content(list, "twitter:title")).toBe(content(list, "og:title"));
    expect(content(list, "twitter:description")).toBe(content(list, "og:description"));
    expect(content(list, "twitter:image")).toBe(content(list, "og:image"));
  });

  it("is indexable: it says nothing about robots", () => {
    expect(keys(list)).not.toContain("robots");
  });

  it("names the image of a Xahau transaction on Xahau", () => {
    expect(content(transactionMeta(tx, XAHAU), "og:image")).toBe(`https://explorer.test/og/xahau/tx/${HASH}.png`);
    expect(link(transactionMeta(tx, XAHAU), "canonical")).toBe(`https://explorer.test/xahau/tx/${HASH}`);
  });

  it("sets no tag twice", () => {
    const names = keys(list);
    expect(new Set(names).size).toBe(names.length);
  });
});

const ledger = (index = 107720688) => ({
  header: { index, hash: "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02", closeTime: 1792251720 },
  txCount: 66,
  succeeded: 64,
});

describe("ledgerMeta", () => {
  const list = ledgerMeta(ledger(), XRPL);

  it("has a title, a description from the ledger's data and the tags", () => {
    expect(tags(list).find((tag) => "title" in tag)?.title).toBe("Ledger #107,720,688 · XRPL · explorer");
    expect(content(list, "description")).toBe("Ledger 107,720,688 on XRPL closed 2026-10-17 15:42:00 UTC with 66 transactions.");
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/ledger/107720688");
    expect(content(list, "og:url")).toBe("https://explorer.test/xrpl/ledger/107720688");
    expect(content(list, "og:image")).toBe("https://explorer.test/og/xrpl/ledger/107720688.png");
    expect(content(list, "twitter:card")).toBe("summary_large_image");
    expect(keys(list)).not.toContain("robots");
  });

  it("names a ledger by its index, whatever the URL that was asked for", () => {
    // The page for a ledger reached by its hash has the one canonical URL, the index's.
    expect(link(list, "canonical")).not.toContain("11EF78");
  });

  it("counts one transaction in the singular", () => {
    expect(content(ledgerMeta({ ...ledger(), txCount: 1, succeeded: 1 }, XRPL), "description")).toContain("with 1 transaction.");
  });
});

const account = (over: Record<string, unknown> = {}) => ({
  address: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh",
  native: "XRP" as const,
  tab: "transactions" as const,
  header: {
    status: "active" as const,
    activation: { time: 1752604243, parent: "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ", initialBalance: "25", txHash: "9B10" },
    balance: { native: "10.001625", available: "8.8", reserve: null },
  },
  ...over,
});

describe("accountMeta", () => {
  const ADDRESS = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";

  it("has a title, a description from the account's data and the tags", () => {
    const list = accountMeta(account(), XRPL);
    expect(tags(list).find((tag) => "title" in tag)?.title).toBe("Account rBbW6i…W5jh · XRPL · explorer");
    expect(content(list, "description")).toBe(
      `${ADDRESS} on XRPL: Balance 10.001625 XRP, activated 2025-07-15. Transactions, payments, trades, offers and objects.`,
    );
    expect(link(list, "canonical")).toBe(`https://explorer.test/xrpl/account/${ADDRESS}`);
    expect(content(list, "og:url")).toBe(`https://explorer.test/xrpl/account/${ADDRESS}`);
    expect(content(list, "og:image")).toBe(`https://explorer.test/og/xrpl/account/${ADDRESS}.png`);
    expect(content(list, "twitter:card")).toBe("summary_large_image");
    expect(keys(list)).not.toContain("robots");
  });

  it("drops the tab from the canonical URL only when it is the default tab", () => {
    expect(link(accountMeta(account({ tab: "transactions" }), XRPL), "canonical")).toBe(`https://explorer.test/xrpl/account/${ADDRESS}`);
    expect(link(accountMeta(account({ tab: "payments" }), XRPL), "canonical")).toBe(`https://explorer.test/xrpl/account/${ADDRESS}?tab=payments`);
    expect(content(accountMeta(account({ tab: "objects" }), XRPL), "og:url")).toBe(`https://explorer.test/xrpl/account/${ADDRESS}?tab=objects`);
    // The image is the account's, whatever its tab.
    expect(content(accountMeta(account({ tab: "objects" }), XRPL), "og:image")).toBe(`https://explorer.test/og/xrpl/account/${ADDRESS}.png`);
  });

  it("describes a deleted account as one", () => {
    const deleted = account({ header: { status: "deleted", activation: null, balance: null } });
    expect(content(accountMeta(deleted, XRPL), "description")).toContain("Deleted account");
  });

  it("is a page of old history: noindex, follow, with a canonical URL that is the first page of its tab and no sharing tags", () => {
    const history = accountMeta(account({ header: { status: "history" }, tab: "payments" }), XRPL);
    expect(content(history, "robots")).toBe("noindex, follow");
    expect(link(history, "canonical")).toBe(`https://explorer.test/xrpl/account/${ADDRESS}?tab=payments`);
    expect(content(history, "description")).toBe(`Older payments of the account ${ADDRESS} on XRPL.`);
    expect(keys(history).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);

    const first = accountMeta(account({ header: { status: "history" }, tab: "transactions" }), XRPL);
    expect(link(first, "canonical")).toBe(`https://explorer.test/xrpl/account/${ADDRESS}`);
  });
});

describe("homeMeta", () => {
  it("has the tags of the network's home page, without an image", () => {
    const list = homeMeta("Explore the XRP Ledger", XRPL);
    expect(tags(list).find((tag) => "title" in tag)?.title).toBe("Explore the XRP Ledger · explorer");
    expect(content(list, "description")).toBe("Look up any ledger, transaction or account on XRPL from validated history.");
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl");
    expect(content(list, "og:url")).toBe("https://explorer.test/xrpl");
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
    expect(link(homeMeta("Explore Xahau", XAHAU), "canonical")).toBe("https://explorer.test/xahau");
  });
});

describe("imageUrl", () => {
  it("is the URL of the image route on the origin", () => {
    expect(imageUrl("https://explorer.test", "xrpl", "tx", HASH)).toBe(`https://explorer.test/og/xrpl/tx/${HASH}.png`);
    expect(imageUrl("https://explorer.test", "xahau", "ledger", "26540187")).toBe("https://explorer.test/og/xahau/ledger/26540187.png");
  });
});

describe("metaContext", () => {
  const layout = { id: "routes/net", loaderData: { network: { id: "xrpl", name: "XRPL" }, origin: "https://explorer.test" } };

  it("is the network of the URL and the origin the /:net layout read from the request", () => {
    expect(metaContext("xrpl", [{ id: "root" }, layout, { id: "routes/net.tx.$id" }])).toEqual({ network: { id: "xrpl", name: "XRPL" }, origin: "https://explorer.test" });
    expect(metaContext("xahau", [layout])?.network).toEqual({ id: "xahau", name: "Xahau" });
  });

  it("is nothing without a network, a layout, or an origin in it", () => {
    expect(metaContext("bitcoin", [layout])).toBeUndefined();
    expect(metaContext(undefined, [layout])).toBeUndefined();
    expect(metaContext("xrpl", [{ id: "root" }])).toBeUndefined();
    expect(metaContext("xrpl", [undefined])).toBeUndefined();
    expect(metaContext("xrpl", [{ id: "routes/net", loaderData: { network: {} } }])).toBeUndefined();
    expect(metaContext("xrpl", [{ id: "routes/net", loaderData: { origin: 5 } }])).toBeUndefined();
  });
});
