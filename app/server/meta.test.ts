import { describe, expect, it } from "vitest";

import type { FlowStep } from "../domain/describe";
import { imageUrl, metaContext, type MetaContext } from "./meta";
import { accountMeta } from "./meta-account";
import { homeMeta } from "./meta-home";
import { ledgerMeta } from "./meta-ledger";
import { marketsMeta } from "./meta-markets";
import { networkMeta } from "./meta-network";
import { transactionDescription, transactionMeta } from "./meta-transaction";

// The tags of the pages (spec 9) as pure functions over the page data and the origin of the request. The data below is what the
// view builders return for the fields the tags read; the worker specs (test/worker/meta.spec.ts) check the whole way from a
// recorded transaction to the HTML. Each page's builder is in a module of its own (`meta-<page>.ts`, beside meta.ts, which has the
// helpers): test/unit/meta-bundle.test.ts says why.

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

  it("is a page of old history: noindex, follow, with no canonical URL (Google advises against noindex with a canonical to another page) and no sharing tags", () => {
    for (const tab of ["transactions", "payments", "trades"] as const) {
      const history = accountMeta(account({ header: { status: "history" }, tab }), XRPL);
      expect(content(history, "robots"), tab).toBe("noindex, follow");
      expect(link(history, "canonical"), tab).toBeUndefined();
      expect(tags(history).some((tag) => tag.tagName === "link"), tab).toBe(false);
      expect(content(history, "description"), tab).toBe(`Older ${tab} of the account ${ADDRESS} on XRPL.`);
      expect(keys(history).filter((key) => /^(og|twitter):/.test(key)), tab).toEqual([]);
    }
  });

  describe("on the Analytics tab", () => {
    const view = (period: "30d" | "90d" | "1y" | "all") => account({ tab: "analytics", analytics: { period } });
    const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
    const DESCRIPTION = `Account value, transactions sent, balances, money in and out, counterparties and DEX trading of ${ADDRESS} on XRPL.`;

    it.each([
      ["30d", "Analytics · Account rBbW6i…W5jh · XRPL · explorer"],
      ["90d", "Analytics, last 90 days · Account rBbW6i…W5jh · XRPL · explorer"],
      ["1y", "Analytics, last 52 weeks · Account rBbW6i…W5jh · XRPL · explorer"],
      ["all", "Analytics, all time · Account rBbW6i…W5jh · XRPL · explorer"],
    ] as const)("names the period %s in the title", (period, expected) => {
      expect(title(accountMeta(view(period), XRPL))).toBe(expected);
    });

    it("names the network in the title and the description", () => {
      const xahau = accountMeta({ ...view("90d"), native: "XAH" as const }, XAHAU);
      expect(title(xahau)).toBe("Analytics, last 90 days · Account rBbW6i…W5jh · Xahau · explorer");
      expect(content(xahau, "description")).toBe(DESCRIPTION.replace("XRPL", "Xahau"));
    });

    it.each(["30d", "90d", "1y", "all"] as const)("is noindex, follow, with no canonical URL and no Open Graph or card tags, on the view %s", (period) => {
      const list = accountMeta(view(period), XRPL);
      expect(content(list, "description")).toBe(DESCRIPTION);
      expect(content(list, "robots")).toBe("noindex, follow");
      expect(link(list, "canonical")).toBeUndefined();
      expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
      expect(keys(list).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
      expect(keys(list).sort()).toEqual(["description", "robots"]);
      expect(title(list)).toBeDefined();
    });

    it("does not carry the figures of the account: the balance and the activation are not in the description", () => {
      expect(content(accountMeta(view("30d"), XRPL), "description")).not.toMatch(/10\.001625|2025-07-15/);
    });

    it("leaves the list tabs' tags as they were", () => {
      // A list tab's data has no `analytics`, so the tab alone does not make the Analytics tags.
      const list = accountMeta(account({ tab: "payments" }), XRPL);
      expect(title(list)).toBe("Account rBbW6i…W5jh · XRPL · explorer");
      expect(link(list, "canonical")).toBe(`https://explorer.test/xrpl/account/${ADDRESS}?tab=payments`);
      expect(keys(list)).not.toContain("robots");
    });
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

describe("networkMeta", () => {
  const DESCRIPTION = (name: string) => `Transactions by type, fees, payment and DEX volume, and the validators of ${name}, updated with every ledger.`;
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;

  it("has the tags of the default view: a canonical URL, Open Graph, a summary card and no image", () => {
    const list = networkMeta({ period: "30d", display: "native" }, XRPL);
    expect(title(list)).toBe("XRPL network · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION("XRPL"));
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/network");
    expect(content(list, "og:title")).toBe("XRPL network · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION("XRPL"));
    expect(content(list, "og:url")).toBe("https://explorer.test/xrpl/network");
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("is Xahau's on Xahau", () => {
    const list = networkMeta({ period: "30d", display: "native" }, XAHAU);
    expect(title(list)).toBe("Xahau network · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION("Xahau"));
    expect(link(list, "canonical")).toBe("https://explorer.test/xahau/network");
  });

  it("names the view in the title of any other: the period, then the currency", () => {
    expect(title(networkMeta({ period: "90d", display: "usd" }, XRPL))).toBe("XRPL network · last 90 days · in USD · explorer");
    expect(title(networkMeta({ period: "7d", display: "native" }, XRPL))).toBe("XRPL network · last 7 days · explorer");
    expect(title(networkMeta({ period: "1y", display: "native" }, XRPL))).toBe("XRPL network · last 52 weeks · explorer");
    // The default period is not named: the view differs by its currency only.
    expect(title(networkMeta({ period: "30d", display: "usd" }, XRPL))).toBe("XRPL network · in USD · explorer");
    expect(title(networkMeta({ period: "1y", display: "native" }, XAHAU))).toBe("Xahau network · last 52 weeks · explorer");
  });

  it.each([
    { period: "90d", display: "usd" },
    { period: "7d", display: "native" },
    { period: "1y", display: "native" },
    { period: "30d", display: "usd" },
  ] as const)("is noindex, follow, with no canonical URL and no Open Graph or card tags, on the view $period $display", (view) => {
    const list = networkMeta(view, XRPL);
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(content(list, "description")).toBe(DESCRIPTION("XRPL"));
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });
});

describe("marketsMeta", () => {
  const DESCRIPTION = (dex: string, period = "last 24 hours") =>
    `Every pair traded on ${dex} with at least 10 trades in the ${period}: last price, change, range, volume and a 7-day trend.`;
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const DEFAULT = { view: [], periodWords: "last 24 hours", indexable: true };

  it("has the tags of the default view: a canonical URL, Open Graph, a summary card and no image", () => {
    const list = marketsMeta(DEFAULT, XRPL);
    expect(title(list)).toBe("XRPL markets · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION("the XRP Ledger DEX"));
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/markets");
    expect(content(list, "og:title")).toBe("XRPL markets · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION("the XRP Ledger DEX"));
    expect(content(list, "og:url")).toBe("https://explorer.test/xrpl/markets");
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("is Xahau's on Xahau: the Xahau DEX", () => {
    const list = marketsMeta(DEFAULT, XAHAU);
    expect(title(list)).toBe("Xahau markets · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION("the Xahau DEX"));
    expect(link(list, "canonical")).toBe("https://explorer.test/xahau/markets");
  });

  it("names the view in the title of any other, in the view builder's words, and its period (periodWords) in the description", () => {
    const list = marketsMeta({ view: ["last 7 days", "USD", "AMM swaps"], periodWords: "last 7 days", indexable: false }, XRPL);
    expect(title(list)).toBe("XRPL markets · last 7 days · USD · AMM swaps · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION("the XRP Ledger DEX", "last 7 days"));
    // The period is the builder's `periodWords`, not a title word read back.
    expect(content(marketsMeta({ view: ["USD"], periodWords: "last 30 days", indexable: false }, XRPL), "description")).toBe(
      DESCRIPTION("the XRP Ledger DEX", "last 30 days"),
    );
    const eur = { view: ["EUR"], periodWords: "last 24 hours", indexable: false };
    expect(title(marketsMeta(eur, XRPL))).toBe("XRPL markets · EUR · explorer");
    expect(content(marketsMeta(eur, XRPL), "description")).toBe(DESCRIPTION("the XRP Ledger DEX"));
    expect(content(marketsMeta({ view: ["last 30 days", "order-book trades"], periodWords: "last 30 days", indexable: false }, XAHAU), "description")).toBe(
      DESCRIPTION("the Xahau DEX", "last 30 days"),
    );
  });

  it.each([[["last 7 days", "USD", "AMM swaps"]], [["USD"]], [["last 30 days"]], [["order-book trades"]]])(
    "is noindex, follow, with no canonical URL and no Open Graph or card tags, on the view %j",
    (view) => {
      const list = marketsMeta({ view, periodWords: "last 24 hours", indexable: false }, XRPL);
      expect(content(list, "robots")).toBe("noindex, follow");
      expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
      expect(keys(list).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
      expect(keys(list).sort()).toEqual(["description", "robots"]);
    },
  );

  it("puts no number of the data in the description: the page is stored for a minute", () => {
    for (const ctx of [XRPL, XAHAU]) {
      const description = content(marketsMeta(DEFAULT, ctx), "description")!;
      // The fixed words of the spec only: "10 trades", "24 hours", "7-day".
      expect(description.match(/\d+/g)).toEqual(["10", "24", "7"]);
    }
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
