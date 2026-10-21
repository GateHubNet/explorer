import { describe, expect, it } from "vitest";

import { AMM_ID, amendmentDetailSample, amendmentsSample, SAMPLE_KEYS, UNKNOWN_ID, validationsSample, validatorDetailSample } from "../../test/support/d1-samples";
import type { AmendmentStatus } from "../domain/amendments-params";
import type { FlowStep } from "../domain/describe";
import { shortHash } from "../domain/format";
import type { ValidatorsParams } from "../domain/validators-params";
import type { NetworkInfo } from "../ui/networks";
import { amendmentPage } from "./amendment-view";
import { amendmentsPage } from "./amendments-view";
import type { AmmListFacts } from "./amm-view";
import type { AmendmentDetail } from "./api-types";
import { imageUrl, metaContext, type MetaContext } from "./meta";
import { accountMeta } from "./meta-account";
import { amendmentMeta } from "./meta-amendment";
import { amendmentsMeta } from "./meta-amendments";
import { ammListMeta } from "./meta-amm-list";
import { homeMeta } from "./meta-home";
import { ledgerMeta } from "./meta-ledger";
import { marketsMeta } from "./meta-markets";
import { networkMeta } from "./meta-network";
import { pairMeta } from "./meta-pair";
import { transactionDescription, transactionMeta } from "./meta-transaction";
import { validatorMeta } from "./meta-validator";
import { validatorsMeta } from "./meta-validators";
import { validatorHistoryPage, validatorPage } from "./validator-view";
import { validatorsPage } from "./validators-view";

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

describe("pairMeta", () => {
  const RLUSD = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
  const NATURAL = `/xrpl/markets/XRP/RLUSD.${RLUSD}`;
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  /** The head of XRP/RLUSD as the view builder writes it (`pairHead`): the fields the tags read. */
  const HEAD = {
    title: "XRP/RLUSD",
    heading: "XRP / RLUSD",
    base: "XRP",
    counter: "RLUSD",
    issuers: [{ code: "RLUSD", address: RLUSD, href: `/xrpl/account/${RLUSD}` }],
    natives: ["XRP"],
    issued: ["RLUSD rMxCKb…m5De"],
    issuedBy: "RLUSD issued by rMxCKb…m5De",
    invert: { label: "Show RLUSD/XRP", href: `/xrpl/markets/RLUSD.${RLUSD}/XRP` },
    firstPage: NATURAL,
  };
  const DESCRIPTION =
    "Price, candles, recent trades, order book and most active traders of XRP/RLUSD on the XRP Ledger DEX. RLUSD issued by rMxCKb…m5De.";
  const LIVE = { head: HEAD, view: [], mode: "live" as const, indexable: true };

  it("has the tags of the natural default view: the pair, its issuers, a canonical URL, Open Graph, a summary card and no image", () => {
    const list = pairMeta(LIVE, XRPL);
    expect(title(list)).toBe("XRP/RLUSD · RLUSD rMxCKb…m5De · XRPL market · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(link(list, "canonical")).toBe(`https://explorer.test${NATURAL}`);
    expect(content(list, "og:title")).toBe("XRP/RLUSD · RLUSD rMxCKb…m5De · XRPL market · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION);
    expect(content(list, "og:url")).toBe(`https://explorer.test${NATURAL}`);
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it.each([
    [["4 h candles"], "XRP/RLUSD · RLUSD rMxCKb…m5De · XRPL market · 4 h candles · explorer"],
    [["order-book trades"], "XRP/RLUSD · RLUSD rMxCKb…m5De · XRPL market · order-book trades · explorer"],
    [["1 d candles", "AMM swaps"], "XRP/RLUSD · RLUSD rMxCKb…m5De · XRPL market · 1 d candles · AMM swaps · explorer"],
  ])("names the view %j in the title, and is noindex, follow with no canonical URL and no Open Graph or card tags", (view, expected) => {
    const list = pairMeta({ ...LIVE, view, indexable: false }, XRPL);
    expect(title(list)).toBe(expected);
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });

  it("says older trades behind a marker and is never indexable there, whatever it is told", () => {
    const list = pairMeta({ head: HEAD, view: ["older trades"], mode: "older", indexable: true }, XRPL);
    expect(title(list)).toBe("XRP/RLUSD · RLUSD rMxCKb…m5De · XRPL market · older trades · explorer");
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(link(list, "canonical")).toBeUndefined();
    const filtered = pairMeta({ head: HEAD, view: ["AMM swaps", "older trades"], mode: "older", indexable: false }, XRPL);
    expect(title(filtered)).toBe("XRP/RLUSD · RLUSD rMxCKb…m5De · XRPL market · AMM swaps · older trades · explorer");
  });

  it("is noindex, follow for a pair the view builder did not make indexable (the inverted pair, one with offers and no trade)", () => {
    const inverted = {
      ...HEAD,
      title: "RLUSD/XRP",
      heading: "RLUSD / XRP",
      base: "RLUSD",
      counter: "XRP",
      natives: ["XRP"],
      invert: { label: "Show XRP/RLUSD", href: NATURAL },
      firstPage: `/xrpl/markets/RLUSD.${RLUSD}/XRP`,
    };
    const list = pairMeta({ head: inverted, view: [], mode: "live", indexable: false }, XRPL);
    expect(title(list)).toBe("RLUSD/XRP · RLUSD rMxCKb…m5De · XRPL market · explorer");
    expect(content(list, "description")).toBe(
      "Price, candles, recent trades, order book and most active traders of RLUSD/XRP on the XRP Ledger DEX. RLUSD issued by rMxCKb…m5De.",
    );
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });

  it("names each issued side of a pair of two issued assets, and is Xahau's on Xahau", () => {
    const EVR = "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8";
    const two = {
      ...HEAD,
      title: "USD/EUR",
      issued: ["USD rhub8V…F3wq", "EUR rLNaPo…dc6w"],
      issuedBy: "USD issued by rhub8V…F3wq, EUR issued by rLNaPo…dc6w",
    };
    const list = pairMeta({ head: two, view: [], mode: "live", indexable: false }, XRPL);
    expect(title(list)).toBe("USD/EUR · USD rhub8V…F3wq · EUR rLNaPo…dc6w · XRPL market · explorer");
    expect(content(list, "description")).toBe(
      "Price, candles, recent trades, order book and most active traders of USD/EUR on the XRP Ledger DEX. USD issued by rhub8V…F3wq, EUR issued by rLNaPo…dc6w.",
    );

    const evr = { ...HEAD, title: "EVR/XAH", issued: ["EVR rEvern…HXr8"], issuedBy: "EVR issued by rEvern…HXr8", firstPage: `/xahau/markets/EVR.${EVR}/XAH` };
    const xahau = pairMeta({ head: evr, view: [], mode: "live", indexable: true }, XAHAU);
    expect(title(xahau)).toBe("EVR/XAH · EVR rEvern…HXr8 · Xahau market · explorer");
    expect(content(xahau, "description")).toBe(
      "Price, candles, recent trades, order book and most active traders of EVR/XAH on the Xahau DEX. EVR issued by rEvern…HXr8.",
    );
    expect(link(xahau, "canonical")).toBe(`https://explorer.test/xahau/markets/EVR.${EVR}/XAH`);
  });

  it("puts no number of the data in the description: the page is stored for a second", () => {
    const description = content(pairMeta(LIVE, XRPL), "description")!;
    // The one digit is the issuer's own (its short address); no price, volume or count.
    expect(description.replace("rMxCKb…m5De", "")).not.toMatch(/\d/);
  });
});

describe("imageUrl", () => {
  it("is the URL of the image route on the origin", () => {
    expect(imageUrl("https://explorer.test", "xrpl", "tx", HASH)).toBe(`https://explorer.test/og/xrpl/tx/${HASH}.png`);
    expect(imageUrl("https://explorer.test", "xahau", "ledger", "26540187")).toBe("https://explorer.test/og/xahau/ledger/26540187.png");
    expect(imageUrl("https://explorer.test", "xrpl", "validator", SAMPLE_KEYS[0])).toBe(`https://explorer.test/og/xrpl/validator/${SAMPLE_KEYS[0]}.png`);
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

describe("validatorsMeta", () => {
  const DESCRIPTION = (name: string) =>
    `The validators of ${name}: the default UNL and every validator seen in the last 24 hours, with their domains, software versions, agreement, and fee and amendment votes.`;
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const view = (params: ValidatorsParams) => ({ params });
  const DEFAULT = view({ scope: "unl" });

  it("has the tags of the default view: a canonical URL on the origin, Open Graph, a summary card and no image", () => {
    const list = validatorsMeta(DEFAULT, XRPL);
    expect(title(list)).toBe("Validators · XRPL · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION("XRPL"));
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/validators");
    expect(content(list, "og:title")).toBe("Validators · XRPL · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION("XRPL"));
    expect(content(list, "og:url")).toBe("https://explorer.test/xrpl/validators");
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("is Xahau's on Xahau, on the request's origin", () => {
    const list = validatorsMeta(DEFAULT, { ...XAHAU, origin: "https://explorer.example" });
    expect(title(list)).toBe("Validators · Xahau · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION("Xahau"));
    expect(link(list, "canonical")).toBe("https://explorer.example/xahau/validators");
    expect(content(list, "og:url")).toBe("https://explorer.example/xahau/validators");
  });

  it.each([
    ["the All scope", { scope: "all" }],
    ["a publisher", { scope: "unl", publisher: "vl.ripple.com" }],
    ["an amendment", { scope: "unl", amendment: "XChainBridge" }],
    ["a search", { scope: "unl", q: "example" }],
    ["the All scope and a search", { scope: "all", q: "example" }],
    ["every filter", { scope: "all", publisher: "vl.ripple.com", amendment: "XChainBridge", q: "example" }],
  ] satisfies Array<[string, ValidatorsParams]>)("is noindex, follow, with no canonical URL and no Open Graph or card tags, on %s", (_name, params) => {
    const list = validatorsMeta(view(params), XRPL);
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(title(list)).toBe("Validators · XRPL · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION("XRPL"));
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });

  it("takes the whole page's data as well as its params, since a route hands it the loader's answer", () => {
    const data = validatorsPage({ network: { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" }, params: { scope: "unl" }, summary: { state: "failed" }, list: { state: "failed" }, amendments: { state: "failed" } });
    expect(link(validatorsMeta(data, XRPL), "canonical")).toBe("https://explorer.test/xrpl/validators");
  });

  it("puts no number of the data in the description: the page is stored for seconds", () => {
    for (const ctx of [XRPL, XAHAU]) expect(content(validatorsMeta(DEFAULT, ctx), "description")!.match(/\d+/g)).toEqual(["24"]);
  });
});

describe("validatorMeta", () => {
  const NET: NetworkInfo = { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" };
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const live = (validator = validatorDetailSample(), network = NET) =>
    validatorPage({ network, validator, recent: { state: "failed" }, summary: { state: "failed" }, amendments: { state: "failed" }, anchor: { lastValidated: 107748183, closeTime: 1792252452 } });
  const KEY = SAMPLE_KEYS[0];
  const TAIL = "Agreement, fee and amendment votes, and recent validations.";

  it("has the tags of the live view: the title, a canonical URL on the origin, Open Graph and the validator's image", () => {
    const list = validatorMeta(live(), XRPL);
    expect(title(list)).toBe("Validator northpeak.example · XRPL · explorer");
    const description = `northpeak.example is a validator of XRPL, on the default UNL (listed by unl.xrplf.org and vl.ripple.com), running rippled 3.4.1. Its domain is verified. ${TAIL}`;
    expect(content(list, "description")).toBe(description);
    expect(link(list, "canonical")).toBe(`https://explorer.test/xrpl/validators/${KEY}`);
    expect(content(list, "og:url")).toBe(`https://explorer.test/xrpl/validators/${KEY}`);
    expect(content(list, "og:title")).toBe("Validator northpeak.example · XRPL · explorer");
    expect(content(list, "og:description")).toBe(description);
    expect(content(list, "og:image")).toBe(`https://explorer.test/og/xrpl/validator/${KEY}.png`);
    expect(content(list, "og:image:alt")).toBe("Validator northpeak.example on XRPL");
    expect(content(list, "twitter:card")).toBe("summary_large_image");
    expect(keys(list)).not.toContain("robots");
  });

  it("says 'not verified', and nothing for a domain not checked yet or for no domain", () => {
    const toml_url = "https://northpeak.example/.well-known/xrp-ledger.toml";
    const unverified = validatorDetailSample({ domain_verification: { status: "unverified", reason: "not_listed", toml_url } });
    expect(content(validatorMeta(live(unverified), XRPL), "description")).toContain("running rippled 3.4.1. Its domain is not verified. Agreement");
    const pending = validatorDetailSample({ domain_verification: { status: "pending", toml_url } });
    expect(content(validatorMeta(live(pending), XRPL), "description")).toContain(`running rippled 3.4.1. ${TAIL}`);
    const nameless = live({ ...validatorDetailSample(), domain: undefined, domain_verification: undefined });
    const list = validatorMeta(nameless, XRPL);
    expect(title(list)).toBe(`Validator ${shortHash(KEY)} · XRPL · explorer`);
    expect(content(list, "description")).toBe(`${shortHash(KEY)} is a validator of XRPL, on the default UNL (listed by unl.xrplf.org and vl.ripple.com), running rippled 3.4.1. ${TAIL}`);
  });

  it("leaves out the UNL off it, and the software without a version", () => {
    const off = validatorDetailSample({ unl: false, unl_lists: [], version: undefined, version_latest: undefined });
    expect(content(validatorMeta(live(off), XRPL), "description")).toBe(`northpeak.example is a validator of XRPL. Its domain is verified. ${TAIL}`);
    const one = validatorDetailSample({ unl_lists: ["vl.xahau.org"], version: "2026.10.13", version_build: 4119 });
    expect(content(validatorMeta(live(one, { id: "xahau", name: "Xahau", native: "XAH", software: "xahaud" }), XAHAU), "description")).toBe(
      `northpeak.example is a validator of Xahau, on the default UNL (listed by vl.xahau.org), running xahaud 2026.10.13. Its domain is verified. ${TAIL}`,
    );
  });

  it("is noindex, follow on a page of older validations, with no canonical URL and no Open Graph or card tags", () => {
    const history = validatorHistoryPage({ network: NET, validator: validatorDetailSample(), recent: validationsSample(), marker: "M1", back: [] });
    const list = validatorMeta(history, XRPL);
    expect(title(list)).toBe("Validator northpeak.example · XRPL · explorer");
    expect(content(list, "description")).toBe("Older validations of the validator northpeak.example on XRPL.");
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });

  it("puts no age and no number that moves with the chain in the description", () => {
    // The version's figures are the only digits: no agreement, no ledger, no time.
    expect(content(validatorMeta(live(), XRPL), "description")!.match(/\d+/g)).toEqual(["3", "4", "1"]);
  });
});

describe("amendmentsMeta", () => {
  const DESCRIPTION = (name: string) => `Every amendment of ${name}: which are enabled, which have a majority and when they activate, and how the default UNL votes on the rest.`;
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const view = (status?: AmendmentStatus) => ({ ...(status !== undefined && { status }) });
  const DEFAULT = view();

  it("has the tags of the default view: a canonical URL on the origin, Open Graph, a summary card and no image", () => {
    const list = amendmentsMeta(DEFAULT, XRPL);
    expect(title(list)).toBe("Amendments · XRPL · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION("XRPL"));
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/amendments");
    expect(content(list, "og:title")).toBe("Amendments · XRPL · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION("XRPL"));
    expect(content(list, "og:url")).toBe("https://explorer.test/xrpl/amendments");
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("is Xahau's on Xahau, on the request's origin", () => {
    const list = amendmentsMeta(DEFAULT, { ...XAHAU, origin: "https://explorer.example" });
    expect(title(list)).toBe("Amendments · Xahau · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION("Xahau"));
    expect(link(list, "canonical")).toBe("https://explorer.example/xahau/amendments");
    expect(content(list, "og:url")).toBe("https://explorer.example/xahau/amendments");
  });

  it.each(["majority", "voting", "enabled", "obsolete", "unknown"] satisfies AmendmentStatus[])(
    "is noindex, follow, with no canonical URL and no Open Graph or card tags, on the view of status %s",
    (status) => {
      const list = amendmentsMeta(view(status), XRPL);
      expect(content(list, "robots")).toBe("noindex, follow");
      expect(title(list)).toBe("Amendments · XRPL · explorer");
      expect(content(list, "description")).toBe(DESCRIPTION("XRPL"));
      expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
      expect(keys(list).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
      expect(keys(list).sort()).toEqual(["description", "robots"]);
    },
  );

  it("takes the whole page's data as well as its status, since a route hands it the loader's answer", () => {
    const data = amendmentsPage({ network: { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" }, amendments: amendmentsSample() });
    expect(link(amendmentsMeta(data, XRPL), "canonical")).toBe("https://explorer.test/xrpl/amendments");
    const voting = amendmentsPage({ network: { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" }, amendments: amendmentsSample(), status: "voting" });
    expect(content(amendmentsMeta(voting, XRPL), "robots")).toBe("noindex, follow");
  });

  it("puts no number of the data in the description: the page is stored for a minute", () => {
    for (const ctx of [XRPL, XAHAU]) expect(content(amendmentsMeta(DEFAULT, ctx), "description")!.match(/\d+/g)).toBeNull();
  });
});

describe("amendmentMeta", () => {
  const NET: NetworkInfo = { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" };
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  /** The sample (XChainBridge, with a majority) as `over` makes it, without D1's description and the keys `absent` (D1 leaves a key out; it never sends `null`). */
  function amendment(over: Partial<AmendmentDetail> = {}, ...absent: (keyof AmendmentDetail)[]): AmendmentDetail {
    const detail: AmendmentDetail = { ...amendmentDetailSample(), ...over };
    for (const key of ["description", ...absent] as const) if (!(key in over) || absent.includes(key)) delete detail[key];
    return detail;
  }
  const page = (detail: AmendmentDetail, network = NET) => amendmentPage({ network, amendment: detail, summary: { state: "failed" } });

  it("has the tags of the page: the builder's title and description, a canonical URL on the origin, Open Graph and the amendment's image", () => {
    const list = amendmentMeta(page(amendmentDetailSample()), XRPL);
    const description =
      "XChainBridge has had a majority of XRPL's default UNL since Oct 17, 2026 and activates on or soon after Oct 31, 2026 if it holds. Made up for the samples: bridges between two ledgers.";
    expect(title(list)).toBe("Amendment XChainBridge · XRPL · explorer");
    expect(content(list, "description")).toBe(description);
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/amendments/XChainBridge");
    expect(content(list, "og:title")).toBe("Amendment XChainBridge · XRPL · explorer");
    expect(content(list, "og:description")).toBe(description);
    expect(content(list, "og:url")).toBe("https://explorer.test/xrpl/amendments/XChainBridge");
    expect(content(list, "og:image")).toBe("https://explorer.test/og/xrpl/amendment/XChainBridge.png");
    expect(content(list, "og:image:alt")).toBe("Amendment XChainBridge on XRPL");
    expect(content(list, "twitter:card")).toBe("summary_large_image");
    expect(content(list, "twitter:image")).toBe("https://explorer.test/og/xrpl/amendment/XChainBridge.png");
    expect(keys(list)).not.toContain("robots");
  });

  it.each([
    [
      "enabled",
      () =>
        amendment(
          { id: AMM_ID, name: "AMM", status: "enabled", enabled: { ledger_index: 86836481, date: "2024-03-22T13:49:51Z", tx_hash: "A".repeat(64), source: "ledger" }, rounds: [] },
          "votes",
          "majority",
        ),
      "AMM is enabled on XRPL since Mar 22, 2024 (ledger 86,836,481).",
    ],
    [
      "majority",
      () => amendment({ id: AMM_ID, name: "AMM", majority: { since: "2026-10-09T09:34:00Z", expected_activation: "2026-10-23T09:34:00Z" } }),
      "AMM has had a majority of XRPL's default UNL since Oct 9, 2026 and activates on or soon after Oct 23, 2026 if it holds.",
    ],
    [
      "voting",
      () => amendment({ status: "voting", votes: { ledger_index: 107748095, yes: 4, trusted: 35, needed: 29, pct: 11.43 } }, "majority"),
      "4 of 35 validators of XRPL's default UNL vote for XChainBridge; 29 are needed.",
    ],
    [
      "obsolete",
      () => amendment({ name: "fixNFTokenNegOffer", status: "obsolete", rounds: [] }, "votes", "majority"),
      "fixNFTokenNegOffer is obsolete on XRPL: current software can no longer vote it in.",
    ],
  ])("says §8's sentence of an amendment that is %s, on its canonical URL and image", (_status, detail, sentence) => {
    const data = page(detail());
    const list = amendmentMeta(data, XRPL);
    expect(content(list, "description")).toBe(sentence);
    expect(content(list, "og:description")).toBe(sentence);
    expect(link(list, "canonical")).toBe(`https://explorer.test/xrpl/amendments/${data.canonical}`);
    expect(content(list, "og:image")).toBe(`https://explorer.test/og/xrpl/amendment/${data.canonical}.png`);
  });

  it("names a nameless amendment by its short ID, and its URLs by the ID in full", () => {
    const list = amendmentMeta(page(amendment({ id: UNKNOWN_ID, status: "unknown", votes: { ledger_index: 107748095, yes: 0, trusted: 35, needed: 29, pct: 0 } }, "name", "majority")), XRPL);
    expect(title(list)).toBe(`Amendment ${shortHash(UNKNOWN_ID)} · XRPL · explorer`);
    expect(content(list, "description")).toBe("An amendment of XRPL with no known name: its votes and history.");
    expect(link(list, "canonical")).toBe(`https://explorer.test/xrpl/amendments/${UNKNOWN_ID}`);
    expect(content(list, "og:image")).toBe(`https://explorer.test/og/xrpl/amendment/${UNKNOWN_ID}.png`);
    expect(content(list, "og:image:alt")).toBe(`Amendment ${shortHash(UNKNOWN_ID)} on XRPL`);
  });

  it("follows the sentence with D1's description when there is one", () => {
    const list = amendmentMeta(page(amendment({ name: "fixNFTokenNegOffer", status: "obsolete", description: "Made up: a description." }, "votes", "majority")), XRPL);
    expect(content(list, "description")).toBe("fixNFTokenNegOffer is obsolete on XRPL: current software can no longer vote it in. Made up: a description.");
  });

  it("is Xahau's on Xahau, on the request's origin", () => {
    const xahau: NetworkInfo = { id: "xahau", name: "Xahau", native: "XAH", software: "xahaud" };
    const list = amendmentMeta(page(amendment({ name: "Remit" }), xahau), { ...XAHAU, origin: "https://explorer.example" });
    expect(title(list)).toBe("Amendment Remit · Xahau · explorer");
    expect(content(list, "description")).toMatch(/^Remit has had a majority of Xahau's default UNL since /);
    expect(link(list, "canonical")).toBe("https://explorer.example/xahau/amendments/Remit");
    expect(content(list, "og:image")).toBe("https://explorer.example/og/xahau/amendment/Remit.png");
    expect(content(list, "og:image:alt")).toBe("Amendment Remit on Xahau");
  });

  it("puts no age and no countdown in the description: the page is stored for a minute", () => {
    const description = content(amendmentMeta(page(amendmentDetailSample()), XRPL), "description")!;
    expect(description).not.toMatch(/\bago\b|\bin \d+ (days?|h|min)\b|~/);
    // The digits are the two dates': no share, no count of votes, no time of day.
    expect(description.match(/\d+/g)).toEqual(["17", "2026", "31", "2026"]);
  });
});

describe("ammListMeta", () => {
  const DESCRIPTION = "Automated market maker pools on the XRP Ledger: the value, reserves, trading fee and swap volume of every pool.";
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  /** The facts of a view as the view builder writes them (`AmmListPageData.meta`): the first page, no filter. */
  const facts = (more: Partial<AmmListFacts> = {}): AmmListFacts => ({ deleted: false, more: false, error: false, ...more });

  it("has the tags of the default view: a canonical URL on the origin, Open Graph, a summary card and no image", () => {
    const list = ammListMeta(facts(), XRPL);
    expect(title(list)).toBe("AMM pools · XRPL · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/amm");
    expect(content(list, "og:title")).toBe("AMM pools · XRPL · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION);
    expect(content(list, "og:url")).toBe("https://explorer.test/xrpl/amm");
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("is on the request's origin", () => {
    const list = ammListMeta(facts(), { ...XRPL, origin: "https://explorer.example" });
    expect(link(list, "canonical")).toBe("https://explorer.example/xrpl/amm");
    expect(content(list, "og:url")).toBe("https://explorer.example/xrpl/amm");
  });

  it.each([
    ["an asset", facts({ assetLabel: "RLUSD" }), "AMM pools with RLUSD · XRPL · explorer"],
    ["the deleted pools", facts({ deleted: true }), "AMM pools (deleted included) · XRPL · explorer"],
    ["an asset and the deleted pools", facts({ assetLabel: "RLUSD", deleted: true }), "AMM pools with RLUSD (deleted included) · XRPL · explorer"],
    ["a marker", facts({ more: true }), "More AMM pools · XRPL · explorer"],
    ["a marker and an asset", facts({ more: true, assetLabel: "RLUSD" }), "More AMM pools with RLUSD · XRPL · explorer"],
    ["a marker, an asset and the deleted pools", facts({ more: true, assetLabel: "SNK", deleted: true }), "More AMM pools with SNK (deleted included) · XRPL · explorer"],
    ["an asset that does not parse", facts({ error: true }), "AMM pools · XRPL · explorer"],
    // The page of an asset error shows no pools, so it does not say the deleted ones are in it.
    ["an asset that does not parse, with the deleted pools", facts({ error: true, deleted: true }), "AMM pools · XRPL · explorer"],
  ] satisfies Array<[string, AmmListFacts, string]>)("is noindex, follow, with no canonical URL and no Open Graph or card tags, with %s", (_name, view, expected) => {
    const list = ammListMeta(view, XRPL);
    expect(title(list)).toBe(expected);
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });

  it("is Xahau's explanation on Xahau: noindex, follow, with no canonical URL and no Open Graph or card tags", () => {
    const list = ammListMeta({ none: true }, XAHAU);
    expect(title(list)).toBe("AMM pools · Xahau · explorer");
    expect(content(list, "description")).toBe("Xahau has no AMM: the AMM amendment is not part of Xahau, so there are no pools to show.");
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });

  it("puts no number in the description: the page is stored for seconds", () => {
    expect(content(ammListMeta(facts(), XRPL), "description")).not.toMatch(/\d/);
    expect(content(ammListMeta({ none: true }, XAHAU), "description")).not.toMatch(/\d/);
  });
});
