import { describe, expect, it } from "vitest";

import {
  coverageSample,
  NFT_ID,
  nftAnswerSample,
  nftCollectionAnswerSample,
  nftEventsPageSample,
  nftSample,
  nodeNftInfoSample,
  nodeUriTokenSample,
  NODE_NFT_ID,
  uriTokenSample,
  URI_TOKEN_ID,
  URI_TOKEN_OWNER,
  nftCollectionsPageSample,
  nftSalesPageSample,
  nftsPageSample,
  NFT_ISSUER,
  NFT_OWNER,
  URI_TOKEN_ISSUER,
  uriTokenCollectionSample,
} from "../../test/support/nft-samples";
import { holdersSample, tokenDetailSample, tokenSample, TOKEN_SAMPLE_CURRENCY, TOKEN_SAMPLE_ISSUER, transfersSample } from "../../test/support/token-samples";
import { AMM_ID, amendmentDetailSample, amendmentsSample, SAMPLE_KEYS, UNKNOWN_ID, validationsSample, validatorDetailSample } from "../../test/support/d1-samples";
import type { AmendmentStatus } from "../domain/amendments-params";
import type { CollectionKey, CollectionQuery, NftsQuery } from "../domain/nft-params";
import type { FlowStep } from "../domain/describe";
import { shortAddress, shortHash } from "../domain/format";
import { NAMES_OFF, NO_NAMES, type NameMap, type NamesPart, type NameView } from "../domain/names";
import { tokenHoldersHref, tokenHref, tokensHref } from "../domain/token-params";
import type { ValidatorsParams } from "../domain/validators-params";
import { NO_FEATURES } from "../ui/features";
import type { NetworkInfo } from "../ui/networks";
import { amendmentPage } from "./amendment-view";
import { amendmentsPage } from "./amendments-view";
import type { AmmListFacts, AmmPoolMeta } from "./amm-view";
import type { AmendmentDetail } from "./api-types";
import type { CheckMeta } from "./check-view";
import type { EscrowMeta } from "./escrow-view";
import { imageUrl, metaContext, suffixOf, type MetaContext } from "./meta";
import { accountMeta } from "./meta-account";
import { amendmentMeta } from "./meta-amendment";
import { amendmentsMeta } from "./meta-amendments";
import { ammListMeta } from "./meta-amm-list";
import { ammPoolMeta } from "./meta-amm-pool";
import { checkMeta } from "./meta-check";
import { escrowMeta } from "./meta-escrow";
import { nftMeta } from "./meta-nft";
import { nftCollectionMeta } from "./meta-nft-collection";
import { nftSalesMeta } from "./meta-nft-sales";
import { nftsMeta } from "./meta-nfts";
import { mptMeta, noMptMeta } from "./meta-mpt";
import { mptFacts, noMptPage, type MptSource } from "./mpt-view";
import { tokenMeta } from "./meta-token";
import { tokenHoldersMeta } from "./meta-token-holders";
import { supplyMeta } from "./meta-supply";
import { tokensMeta } from "./meta-tokens";
import { homeMeta } from "./meta-home";
import { ledgerMeta } from "./meta-ledger";
import { marketsMeta } from "./meta-markets";
import { networkMeta } from "./meta-network";
import { pairMeta } from "./meta-pair";
import { paymentChannelMeta } from "./meta-payment-channel";
import { transactionDescription, transactionMeta } from "./meta-transaction";
import { validatorMeta } from "./meta-validator";
import { validatorsMeta } from "./meta-validators";
import { collectionMarkerPage, nftCollectionPage, type CollectionNet, type NftCollectionPageData } from "./nft-collection-view";
import { nftMarkerPage, nftPage, type NftNet, type NftPageData } from "./nft-view";
import { nftSalesPage, nftsListPage, nftsMarkerPage, type NftSalesPageData, type NftsNet, type NftsPageData } from "./nfts-view";
import { pairPage } from "./pair-view";
import { tokenFacts, tokenHoldersPage, tokenPage, type TokenHoldersMetaFacts, type TokenMetaFacts, type TokensMetaFacts } from "./token-view";
import type { PaymentChannelMeta } from "./payment-channel-view";
import { validatorHistoryPage, validatorPage, type ValidatorLiveData } from "./validator-view";
import { validatorsPage } from "./validators-view";

// The tags of the pages (spec 9) as pure functions over the page data and the origin of the request. The data below is what the
// view builders return for the fields the tags read; the worker specs (test/worker/meta.spec.ts) check the whole way from a
// recorded transaction to the HTML. Each page's builder is in a module of its own (`meta-<page>.ts`, beside meta.ts, which has the
// helpers): test/unit/meta-bundle.test.ts says why.

const XRPL: MetaContext = {
  network: { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX" },
  origin: "https://explorer.test",
};
const XAHAU: MetaContext = {
  network: { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX" },
  origin: "https://explorer.test",
};

/** The sandbox's networks: the testnets' names, as the layout's loader reads them in the sandbox. */
const XRPL_TESTNET: MetaContext = {
  network: { id: "xrpl", kind: "testnet", name: "XRPL Testnet", label: "XRPL Testnet", longName: "XRPL Testnet", dexName: "the XRPL Testnet DEX" },
  origin: "https://explorer.test",
};
const XAHAU_TESTNET: MetaContext = {
  network: { id: "xahau", kind: "testnet", name: "Xahau Testnet", label: "Xahau Testnet", longName: "Xahau Testnet", dexName: "the Xahau Testnet DEX" },
  origin: "https://explorer.test",
};

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

  it("names an MPT's units and the start of its ID, as the card does", () => {
    const amount = { mpt: "0000012AB5F762798A53D543A014CAF8B297CFF8F2F937E8", issuer: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", units: "2500000" };
    const flow: FlowStep[] = [
      { role: "sender", account: SENDER, label: "Sender", amount },
      { role: "destination", account: RECEIVER, label: "Destination", amount },
    ];
    expect(transactionDescription(payment(flow), XRPL.network)).toBe("Payment of 2,500,000 units of MPT 0000012A… from rJF2Xa…FQvg to rNYbL8…UKq5 · XRPL ledger 107,695,660");
  });

  it("names an MPT's scaled value and ticker once the transaction page's lookup filled them, 'units' for an issuance with no ticker", () => {
    const amount = { mpt: "0000012AB5F762798A53D543A014CAF8B297CFF8F2F937E8", issuer: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", units: "2500000", value: "25000.00" };
    const flowOf = (filled: typeof amount & { ticker?: string }): FlowStep[] => [
      { role: "sender", account: SENDER, label: "Sender", amount: filled },
      { role: "destination", account: RECEIVER, label: "Destination", amount: filled },
    ];
    expect(transactionDescription(payment(flowOf({ ...amount, ticker: "HTF" })), XRPL.network)).toBe("Payment of 25,000.00 HTF from rJF2Xa…FQvg to rNYbL8…UKq5 · XRPL ledger 107,695,660");
    expect(transactionDescription(payment(flowOf(amount)), XRPL.network)).toBe("Payment of 25,000.00 units from rJF2Xa…FQvg to rNYbL8…UKq5 · XRPL ledger 107,695,660");
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
  names: NO_NAMES,
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

  it("words the older rows of the NFTs tab as the network does: 'Older NFTs', and 'Older URITokens' on Xahau", () => {
    const older = (ctx: MetaContext) => accountMeta(account({ header: { status: "history" }, tab: "nfts" }), ctx);
    expect(content(older(XRPL), "description")).toBe(`Older NFTs of the account ${ADDRESS} on XRPL.`);
    expect(content(older(XAHAU), "description")).toBe(`Older URITokens of the account ${ADDRESS} on Xahau.`);
    // The testnets take their mainnet's words (and say their own name).
    expect(content(older(XRPL_TESTNET), "description")).toBe(`Older NFTs of the account ${ADDRESS} on XRPL Testnet.`);
    expect(content(older(XAHAU_TESTNET), "description")).toBe(`Older URITokens of the account ${ADDRESS} on Xahau Testnet.`);
    expect(content(older(XRPL), "robots")).toBe("noindex, follow");
    expect(link(older(XRPL), "canonical")).toBeUndefined();
  });

  it("names the NFTs tab in the canonical URL of its first page", () => {
    expect(link(accountMeta(account({ tab: "nfts" }), XRPL), "canonical")).toBe(`https://explorer.test/xrpl/account/${ADDRESS}?tab=nfts`);
  });

  describe("for an account that has a name or a label (display names spec 7)", () => {
    const NORTHPEAK: NameView = { name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example", labels: [] };
    const HARBORLINE: NameView = { name: { text: "Harborline Exchange", kind: "account" }, network: "hot wallet", labels: [] };
    const LABELLED_HARBORLINE: NameView = { ...HARBORLINE, labels: ["advisory"] };
    const LOWTIDE: NameView = { name: { text: "lowtide.example", kind: "domain" }, domain: "lowtide.example", labels: [] };
    const named = (view: NameView, over: Record<string, unknown> = {}) => account({ names: { state: "ok", map: { [ADDRESS]: view } }, ...over });
    const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
    const TODAYS = `${ADDRESS} on XRPL: Balance 10.001625 XRP, activated 2025-07-15. Transactions, payments, trades, offers and objects.`;

    it("puts a verified name in the title, the short address after it, and says who verified it at the end of the description", () => {
      const list = accountMeta(named(NORTHPEAK), XRPL);
      expect(title(list)).toBe(`Account Northpeak Treasury (${shortAddress(ADDRESS)}) · XRPL · explorer`);
      expect(content(list, "description")).toBe(`${TODAYS} Verified by northpeak.example.`);
      // The tags that repeat them, and the image, are the page's own.
      expect(content(list, "og:title")).toBe(title(list));
      expect(content(list, "og:description")).toBe(content(list, "description"));
      expect(content(list, "og:image")).toBe(`https://explorer.test/og/xrpl/account/${ADDRESS}.png`);
      expect(content(list, "og:image:alt")).toBe(`Account ${shortAddress(ADDRESS)} on XRPL`);
    });

    it("does the same for a name GateHub gave, with the account network name as a link has it, and for the description of a deleted account", () => {
      const list = accountMeta(named(HARBORLINE), XRPL);
      expect(title(list)).toBe(`Account Harborline Exchange · hot wallet (${shortAddress(ADDRESS)}) · XRPL · explorer`);
      expect(content(list, "description")).toBe(`${TODAYS} Named by GateHub.`);
      const deleted = accountMeta(named(HARBORLINE, { header: { status: "deleted", activation: null, balance: null } }), XRPL);
      expect(content(deleted, "description")).toBe(`${ADDRESS} on XRPL: Deleted account. Transactions, payments, trades, offers and objects. Named by GateHub.`);
    });

    it("keeps today's title for a labelled account whose name it has, and says the label in words before the description", () => {
      const list = accountMeta(named(LABELLED_HARBORLINE), XRPL);
      expect(title(list)).toBe(`Account ${shortAddress(ADDRESS)} · XRPL · explorer`);
      expect(content(list, "description")).toBe(`GateHub has labelled this address advisory. ${TODAYS} Named by GateHub.`);
      expect(content(list, "og:title")).toBe(`Account ${shortAddress(ADDRESS)} · XRPL · explorer`);
    });

    it("says every label of an account with labels only, before today's description and with nothing after it", () => {
      const list = accountMeta(named({ labels: ["scam", "spam", "advisory"] }), XRPL);
      expect(title(list)).toBe(`Account ${shortAddress(ADDRESS)} · XRPL · explorer`);
      expect(content(list, "description")).toBe(`GateHub has labelled this address scam, spam and advisory. ${TODAYS}`);
      expect(content(accountMeta(named({ labels: ["scam", "spam"] }), XRPL), "description")).toBe(`GateHub has labelled this address scam and spam. ${TODAYS}`);
    });

    it("has today's tags for a name only the account's domain gives, for a network name alone, and for an address with no entry", () => {
      const today = accountMeta(account(), XRPL);
      expect(accountMeta(named(LOWTIDE), XRPL)).toEqual(today);
      expect(accountMeta(named({ network: "cold", labels: [] }), XRPL)).toEqual(today);
      expect(accountMeta(account({ names: { state: "ok", map: { rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC: NORTHPEAK } } }), XRPL)).toEqual(today);
    });

    it("has today's tags with NAMES off, and when the names call failed", () => {
      const today = accountMeta(account(), XRPL);
      expect(accountMeta(account({ names: NAMES_OFF }), XRPL)).toEqual(today);
      expect(accountMeta(account({ names: { state: "failed", map: {} } }), XRPL)).toEqual(today);
    });

    it("says the names of the account's own entry, not of another's on the page", () => {
      const list = accountMeta(account({ names: { state: "ok", map: { rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ: { labels: ["spam"] }, [ADDRESS]: NORTHPEAK } } }), XRPL);
      expect(title(list)).toBe(`Account Northpeak Treasury (${shortAddress(ADDRESS)}) · XRPL · explorer`);
      expect(content(list, "description")).not.toContain("labelled");
    });

    it("names the account in the title of a page of old history and of the Analytics view, and leaves their descriptions as they are", () => {
      const history = accountMeta(named(NORTHPEAK, { header: { status: "history" } }), XRPL);
      expect(title(history)).toBe(`Account Northpeak Treasury (${shortAddress(ADDRESS)}) · XRPL · explorer`);
      expect(content(history, "description")).toBe(`Older transactions of the account ${ADDRESS} on XRPL.`);
      const analytics = accountMeta(named(LABELLED_HARBORLINE, { tab: "analytics", analytics: { period: "90d" } }), XRPL);
      expect(title(analytics)).toBe(`Analytics, last 90 days · Account ${shortAddress(ADDRESS)} · XRPL · explorer`);
      const namedAnalytics = accountMeta(named(NORTHPEAK, { tab: "analytics", analytics: { period: "90d" } }), XRPL);
      expect(title(namedAnalytics)).toBe(`Analytics, last 90 days · Account Northpeak Treasury (${shortAddress(ADDRESS)}) · XRPL · explorer`);
      expect(content(namedAnalytics, "description")).toBe(
        `Account value, transactions sent, balances, money in and out, counterparties and DEX trading of ${ADDRESS} on XRPL.`,
      );
    });
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

  it("names the network's DEX in the sandbox's words: the XRPL Testnet DEX, the Xahau Testnet DEX", () => {
    const xrpl = marketsMeta(DEFAULT, XRPL_TESTNET);
    expect(title(xrpl)).toBe("XRPL Testnet markets · explorer");
    expect(content(xrpl, "description")).toBe(DESCRIPTION("the XRPL Testnet DEX"));
    expect(content(xrpl, "og:description")).toBe(DESCRIPTION("the XRPL Testnet DEX"));
    expect(link(xrpl, "canonical")).toBe("https://explorer.test/xrpl/markets");
    const xahau = marketsMeta({ ...DEFAULT, indexable: false }, XAHAU_TESTNET);
    expect(title(xahau)).toBe("Xahau Testnet markets · explorer");
    expect(content(xahau, "description")).toBe(DESCRIPTION("the Xahau Testnet DEX"));
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
    issuers: [{ code: "RLUSD", address: RLUSD, href: `/xrpl/account/${RLUSD}`, tokenHref: null }],
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

  it("names the network's DEX in the sandbox's words: the XRPL Testnet DEX, the Xahau Testnet DEX", () => {
    const xrpl = pairMeta(LIVE, XRPL_TESTNET);
    expect(title(xrpl)).toBe("XRP/RLUSD · RLUSD rMxCKb…m5De · XRPL Testnet market · explorer");
    expect(content(xrpl, "description")).toBe(
      "Price, candles, recent trades, order book and most active traders of XRP/RLUSD on the XRPL Testnet DEX. RLUSD issued by rMxCKb…m5De.",
    );
    const evr = { ...HEAD, title: "EVR/XAH", issued: ["EVR rEvern…HXr8"], issuedBy: "EVR issued by rEvern…HXr8", firstPage: "/xahau/markets/EVR.rEvernodee8dJLaFsujS6q1EiXvZYmHXr8/XAH" };
    expect(content(pairMeta({ head: evr, view: [], mode: "live", indexable: true }, XAHAU_TESTNET), "description")).toBe(
      "Price, candles, recent trades, order book and most active traders of EVR/XAH on the Xahau Testnet DEX. EVR issued by rEvern…HXr8.",
    );
  });

  describe("for a pair whose issuer has a name (display names spec 7)", () => {
    // The page is built with the names of its accounts, the issuer's among them (verified, which the body of a page would write by name), and its tags are read from what the
    // view builder made: the short issuers stay in the title and the description, which are shared out of context, with no room for a mark.
    const NORTHPEAK = { name: { text: "Northpeak Treasury", kind: "verified" as const }, domain: "northpeak.example", labels: [] };
    const NAMES: NameMap = { [RLUSD]: NORTHPEAK };
    const NETWORK = { id: "xrpl" as const, name: "XRPL", native: "XRP" as const, hasAmm: true, features: { ...NO_FEATURES, ammData: true, markets: true } };
    const input = {
      network: NETWORK,
      base: { currency: "XRP" },
      counter: { currency: "RLUSD", issuer: RLUSD },
      params: { interval: "1h" as const, trades: null, back: [] },
      closeTime: 1_792_256_472,
      trades: { result: "success" as const, count: 0, exchanges: [] },
      hasTrade: true,
      stats: { state: "failed" as const },
      candles: { state: "failed" as const },
      traders: { state: "failed" as const },
      asks: { state: "failed" as const },
      bids: { state: "failed" as const },
      pool: null,
      share: null,
    };

    it("keeps the short issuer in the title and the description of the live page built with the issuer's name", () => {
      const { page } = pairPage({ ...input, names: NAMES });
      const list = pairMeta({ head: page.head, view: page.view, mode: page.mode, indexable: page.indexable }, XRPL);
      const short = `XRP/RLUSD · RLUSD ${shortAddress(RLUSD)} · XRPL market · explorer`;
      expect(title(list)).toBe(short);
      expect(content(list, "description")).toBe(DESCRIPTION);
      expect(content(list, "description")).toContain(`RLUSD issued by ${shortAddress(RLUSD)}.`);
      expect(content(list, "og:title")).toBe(short);
      expect(content(list, "og:description")).toBe(DESCRIPTION);
      expect(JSON.stringify(list)).not.toContain("Northpeak");
      // The page itself draws the issuer in full, through the names (`AccountLink full`); its head holds the whole address, which the tags do not.
      expect(page.head.issuers).toEqual([{ code: "RLUSD", address: RLUSD, href: `/xrpl/account/${RLUSD}`, tokenHref: null }]);
      // The tags are the same as those of the page built without names.
      const plain = pairPage(input).page;
      expect(pairMeta({ head: plain.head, view: plain.view, mode: plain.mode, indexable: plain.indexable }, XRPL)).toEqual(list);
    });
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
    expect(imageUrl("https://explorer.test", "xahau", "nft", URI_TOKEN_ID)).toBe(`https://explorer.test/og/xahau/nft/${URI_TOKEN_ID}.png`);
  });
});

describe("metaContext", () => {
  // What the /:net layout's loader gives `meta`: its `PublicNetwork` (the words of the environment's kind) and the origin of the request.
  const layoutOf = (network: unknown) => ({ id: "routes/net", loaderData: { network, origin: "https://explorer.test" } });
  const layout = layoutOf(XRPL.network);
  const TESTNET = { id: "xrpl", kind: "testnet", name: "XRPL Testnet", label: "XRPL Testnet", longName: "XRPL Testnet", dexName: "the XRPL Testnet DEX" };

  it("is the network the /:net layout read, and the origin it read from the request", () => {
    expect(metaContext("xrpl", [{ id: "root" }, layout, { id: "routes/net.tx.$id" }])).toEqual({ network: XRPL.network, origin: "https://explorer.test" });
    expect(metaContext("xahau", [layoutOf(XAHAU.network)])).toEqual({ network: XAHAU.network, origin: "https://explorer.test" });
  });

  it("takes the layout's network, with its testnet names", () => {
    const ctx = metaContext("xrpl", [{ id: "root" }, layoutOf(TESTNET), { id: "routes/net.tx.$id" }]);
    expect(ctx?.network.name).toBe("XRPL Testnet");
    expect(suffixOf(ctx!.network)).toBe("XRPL Testnet · explorer");
    const list = transactionMeta({ ...payment(), ledgerIndex: 102186243 }, ctx!);
    expect(content(list, "description")).toMatch(/ · XRPL Testnet ledger 102,186,243$/);
    expect(tags(list).find((tag) => "title" in tag)?.title).toBe("Payment 67F91E…7C31 · XRPL Testnet · explorer");
  });

  it("is nothing without a network, a layout, or an origin in it", () => {
    expect(metaContext("bitcoin", [layout])).toBeUndefined();
    expect(metaContext(undefined, [layout])).toBeUndefined();
    expect(metaContext("xrpl", [{ id: "root" }])).toBeUndefined();
    expect(metaContext("xrpl", [undefined])).toBeUndefined();
    expect(metaContext("xrpl", [{ id: "routes/net", loaderData: { network: {} } }])).toBeUndefined();
    expect(metaContext("xrpl", [{ id: "routes/net", loaderData: { origin: 5 } }])).toBeUndefined();
  });

  it("is nothing when the layout is of another network than the URL's", () => {
    expect(metaContext("xahau", [layout])).toBeUndefined();
    expect(metaContext("xrpl", [layoutOf(XAHAU.network)])).toBeUndefined();
    // A layout with no id in its network does not stand in for an absent segment either.
    expect(metaContext(undefined, [{ id: "routes/net", loaderData: { network: {}, origin: "https://explorer.test" } }])).toBeUndefined();
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

  // A country view (E13 spec 2 and 8) is a view of the page, whatever else the query holds: the UNL scope alone would be indexable, and the country is all that makes this not.
  it("makes a country view noindex, follow without canonical or og", () => {
    for (const params of [{ scope: "unl", country: "DE" }, { scope: "unl", country: "unknown" }, { scope: "all", country: "DE" }, { scope: "unl", country: "DE", q: "example" }] satisfies ValidatorsParams[]) {
      for (const ctx of [XRPL, XAHAU]) {
        const list = validatorsMeta(view(params), ctx);
        const label = `${ctx.network.id} ${JSON.stringify(params)}`;
        expect(content(list, "robots"), label).toBe("noindex, follow");
        expect(tags(list).some((tag) => tag.tagName === "link"), label).toBe(false);
        expect(keys(list).filter((key) => /^(og|twitter):/.test(key)), label).toEqual([]);
        expect(keys(list).sort(), label).toEqual(["description", "robots"]);
      }
    }
    // The default view beside it is still the indexable one.
    expect(content(validatorsMeta(DEFAULT, XRPL), "robots")).toBeUndefined();
    expect(link(validatorsMeta(DEFAULT, XRPL), "canonical")).toBe("https://explorer.test/xrpl/validators");
  });

  it("takes the whole page's data as well as its params, since a route hands it the loader's answer", () => {
    const data = validatorsPage({ network: { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" }, params: { scope: "unl" }, summary: { state: "failed" }, list: { state: "failed" }, amendments: { state: "failed" }, features: { validatorsMap: false } });
    expect(link(validatorsMeta(data, XRPL), "canonical")).toBe("https://explorer.test/xrpl/validators");
  });

  it("puts no number of the data in the description: the page is stored for seconds", () => {
    for (const ctx of [XRPL, XAHAU]) expect(content(validatorsMeta(DEFAULT, ctx), "description")!.match(/\d+/g)).toEqual(["24"]);
  });
});

describe("validatorMeta", () => {
  const NET: NetworkInfo = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" };
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const live = (validator = validatorDetailSample(), network = NET): ValidatorLiveData => ({
    ...validatorPage({ network, validator, recent: { state: "failed" }, summary: { state: "failed" }, amendments: { state: "failed" }, anchor: { lastValidated: 107748183, closeTime: 1792252452 }, features: NO_FEATURES }),
    names: NO_NAMES,
  });
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
    expect(content(validatorMeta(live(one, { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud" }), XAHAU), "description")).toBe(
      `northpeak.example is a validator of Xahau, on the default UNL (listed by vl.xahau.org), running xahaud 2026.10.13. Its domain is verified. ${TAIL}`,
    );
  });

  it("words a validator on Xahau Testnet's fixed list as 'on the fixed list', and one on a testnet's published list as listed by it", () => {
    const xahauTestnet: NetworkInfo = { id: "xahau", kind: "testnet", name: "Xahau Testnet", label: "Xahau Testnet", longName: "Xahau Testnet", dexName: "the Xahau Testnet DEX", native: "XAH", software: "xahaud" };
    const fixed = validatorDetailSample({ unl_lists: ["local"], version: "2026.10.13", version_build: 4119 });
    expect(content(validatorMeta(live(fixed, xahauTestnet), XAHAU_TESTNET), "description")).toBe(
      `northpeak.example is a validator of Xahau Testnet, on the default UNL (on the fixed list), running xahaud 2026.10.13. Its domain is verified. ${TAIL}`,
    );
    const xrplTestnet: NetworkInfo = { id: "xrpl", kind: "testnet", name: "XRPL Testnet", label: "XRPL Testnet", longName: "XRPL Testnet", dexName: "the XRPL Testnet DEX", native: "XRP", software: "rippled" };
    const published = validatorDetailSample({ unl_lists: ["vl.altnet.rippletest.net"] });
    expect(content(validatorMeta(live(published, xrplTestnet), XRPL_TESTNET), "description")).toContain("on the default UNL (listed by vl.altnet.rippletest.net), running rippled 3.4.1.");
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

  it("reads no name (display names spec 7): the tags of a page that names the accounts it lists are those of one that does not", () => {
    const listed = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
    const names: NamesPart = { state: "ok", map: { [listed]: { name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example", labels: [] } } };
    expect(live().grid.accounts?.map((account) => account.address)).toEqual([listed]);
    const list = validatorMeta({ ...live(), names }, XRPL);
    expect(list).toEqual(validatorMeta(live(), XRPL));
    expect(JSON.stringify(list)).not.toContain("Northpeak Treasury");
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
    const data = amendmentsPage({ network: { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" }, amendments: amendmentsSample() });
    expect(link(amendmentsMeta(data, XRPL), "canonical")).toBe("https://explorer.test/xrpl/amendments");
    const voting = amendmentsPage({ network: { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" }, amendments: amendmentsSample(), status: "voting" });
    expect(content(amendmentsMeta(voting, XRPL), "robots")).toBe("noindex, follow");
  });

  it("puts no number of the data in the description: the page is stored for a minute", () => {
    for (const ctx of [XRPL, XAHAU]) expect(content(amendmentsMeta(DEFAULT, ctx), "description")!.match(/\d+/g)).toBeNull();
  });
});

describe("amendmentMeta", () => {
  const NET: NetworkInfo = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" };
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
    const xahau: NetworkInfo = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud" };
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
  const TESTNET_DESCRIPTION = "Automated market maker pools on XRPL Testnet: the value, reserves, trading fee and swap volume of every pool.";
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

  it("names the network of the sandbox in its description: XRPL Testnet, in every view", () => {
    const list = ammListMeta(facts(), XRPL_TESTNET);
    expect(title(list)).toBe("AMM pools · XRPL Testnet · explorer");
    expect(content(list, "description")).toBe(TESTNET_DESCRIPTION);
    expect(content(list, "og:description")).toBe(TESTNET_DESCRIPTION);
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/amm");
    for (const view of [facts({ assetLabel: "RLUSD" }), facts({ deleted: true }), facts({ more: true }), facts({ error: true })]) {
      expect(content(ammListMeta(view, XRPL_TESTNET), "description")).toBe(TESTNET_DESCRIPTION);
    }
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

  it("is Xahau Testnet's explanation on Xahau Testnet", () => {
    const list = ammListMeta({ none: true }, XAHAU_TESTNET);
    expect(title(list)).toBe("AMM pools · Xahau Testnet · explorer");
    expect(content(list, "description")).toBe("Xahau Testnet has no AMM: the AMM amendment is not part of Xahau Testnet, so there are no pools to show.");
  });

  it("puts no number in the description: the page is stored for seconds", () => {
    expect(content(ammListMeta(facts(), XRPL), "description")).not.toMatch(/\d/);
    expect(content(ammListMeta({ none: true }, XAHAU), "description")).not.toMatch(/\d/);
  });
});

describe("nftsMeta", () => {
  const DESCRIPTION = "NFTs on the XRP Ledger: the sales volume, the largest collections and the latest sales.";
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const failed = (): PromiseRejectedResult => ({ status: "rejected", reason: new Error("not asked in this test") });
  /** The page data of a view of the list, as the view builder writes it: the tags read what the page says of its view. */
  const view = (query: Partial<NftsQuery> = {}, net: NftsNet = { id: "xrpl", native: "XRP", longName: "the XRP Ledger" }): NftsPageData => ({
    ...nftsListPage({ net, query: { period: "day", sort: "volume", order: "desc", back: [], ...query }, last: failed(), live: failed(), daily: null, sales: failed(), collections: failed() }),
    names: NO_NAMES,
  });
  const marked = (query: Partial<NftsQuery> = {}, net: NftsNet = { id: "xrpl", native: "XRP", longName: "the XRP Ledger" }): NftsPageData => ({
    ...nftsMarkerPage(net, { period: "day", sort: "volume", order: "desc", marker: "M1", back: [], ...query }, nftCollectionsPageSample({ collections: [], count: 0, total: 0 })),
    names: NO_NAMES,
  });

  it("has the tags of the default view: a canonical URL on the origin, Open Graph, a summary card and no image", () => {
    const list = nftsMeta(view(), XRPL);
    expect(title(list)).toBe("NFTs · XRPL · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/nfts");
    expect(content(list, "og:title")).toBe("NFTs · XRPL · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION);
    expect(content(list, "og:url")).toBe("https://explorer.test/xrpl/nfts");
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("is Xahau's on Xahau: URITokens, in the network's words", () => {
    const list = nftsMeta(view({}, { id: "xahau", native: "XAH", longName: "Xahau" }), XAHAU);
    expect(title(list)).toBe("URITokens · Xahau · explorer");
    expect(content(list, "description")).toBe("URITokens on Xahau: the sales volume, the largest collections and the latest sales.");
    expect(link(list, "canonical")).toBe("https://explorer.test/xahau/nfts");
  });

  it("names the network of the sandbox, in the title and in the description", () => {
    const list = nftsMeta(view({}, { id: "xrpl", native: "XRP", longName: "XRPL Testnet" }), XRPL_TESTNET);
    expect(title(list)).toBe("NFTs · XRPL Testnet · explorer");
    expect(content(list, "description")).toBe("NFTs on XRPL Testnet: the sales volume, the largest collections and the latest sales.");
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/nfts");
    expect(title(nftsMeta(view({}, { id: "xahau", native: "XAH", longName: "Xahau Testnet" }), XAHAU_TESTNET))).toBe("URITokens · Xahau Testnet · explorer");
  });

  it("is on the request's origin", () => {
    const list = nftsMeta(view(), { ...XRPL, origin: "https://explorer.example" });
    expect(link(list, "canonical")).toBe("https://explorer.example/xrpl/nfts");
    expect(content(list, "og:url")).toBe("https://explorer.example/xrpl/nfts");
  });

  it.each([
    ["another period", view({ period: "7day" }), "NFTs · XRPL · explorer"],
    ["an issuer", view({ issuer: "rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy" }), "NFTs · XRPL · explorer"],
    ["an issuer that is no address", view({ issuer: "nope" }), "NFTs · XRPL · explorer"],
    ["another sort", view({ sort: "supply" }), "NFTs · XRPL · explorer"],
    ["the ascending order", view({ order: "asc" }), "NFTs · XRPL · explorer"],
    ["a marker", marked(), "More NFT collections · XRPL · explorer"],
    ["a marker and another sort", marked({ sort: "holders" }), "More NFT collections · XRPL · explorer"],
  ] satisfies Array<[string, NftsPageData, string]>)("is noindex, follow, with no canonical URL and no Open Graph or card tags, with %s", (_name, data, expected) => {
    const list = nftsMeta(data, XRPL);
    expect(title(list)).toBe(expected);
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });

  it("says URIToken collections behind a marker on Xahau", () => {
    const list = nftsMeta(marked({}, { id: "xahau", native: "XAH", longName: "Xahau" }), XAHAU);
    expect(title(list)).toBe("More URIToken collections · Xahau · explorer");
    expect(content(list, "robots")).toBe("noindex, follow");
  });

  it("puts no number in the description: the page is stored for a minute", () => {
    expect(content(nftsMeta(view(), XRPL), "description")).not.toMatch(/\d/);
    expect(content(nftsMeta(view({}, { id: "xahau", native: "XAH", longName: "Xahau" }), XAHAU), "description")).not.toMatch(/\d/);
  });
});

describe("tokensMeta", () => {
  const DESCRIPTION = "Issued tokens on the XRP Ledger, ranked by holders: supply, price, 24-hour volume and whether each issuer's toml lists it.";
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  /** The facts of a view as the view builder writes them (`TokensPageData.meta`): the first page, no search. */
  const facts = (more: Partial<TokensMetaFacts> = {}): TokensMetaFacts => ({ all: false, more: false, error: false, ...more });

  it("has the tags of the default view: a canonical URL on the origin, Open Graph, a summary card and no image", () => {
    const list = tokensMeta(facts(), XRPL);
    expect(title(list)).toBe("Tokens · XRPL · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/tokens");
    expect(content(list, "og:title")).toBe("Tokens · XRPL · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION);
    expect(content(list, "og:url")).toBe("https://explorer.test/xrpl/tokens");
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("is the path the page's own links write", () => {
    expect(new URL(link(tokensMeta(facts(), XAHAU), "canonical")!).pathname).toBe(tokensHref("xahau"));
  });

  it("is Xahau's on Xahau, in the network's words", () => {
    const list = tokensMeta(facts(), XAHAU);
    expect(title(list)).toBe("Tokens · Xahau · explorer");
    expect(content(list, "description")).toBe("Issued tokens on Xahau, ranked by holders: supply, price, 24-hour volume and whether each issuer's toml lists it.");
    expect(link(list, "canonical")).toBe("https://explorer.test/xahau/tokens");
  });

  it("names the network of the sandbox, in the title and in the description", () => {
    const list = tokensMeta(facts(), XRPL_TESTNET);
    expect(title(list)).toBe("Tokens · XRPL Testnet · explorer");
    expect(content(list, "description")).toBe("Issued tokens on XRPL Testnet, ranked by holders: supply, price, 24-hour volume and whether each issuer's toml lists it.");
    expect(title(tokensMeta(facts(), XAHAU_TESTNET))).toBe("Tokens · Xahau Testnet · explorer");
  });

  it("is on the request's origin", () => {
    const list = tokensMeta(facts(), { ...XRPL, origin: "https://explorer.example" });
    expect(link(list, "canonical")).toBe("https://explorer.example/xrpl/tokens");
    expect(content(list, "og:url")).toBe("https://explorer.example/xrpl/tokens");
  });

  it.each([
    ["a search", facts({ q: "USD" }), "Tokens matching “USD” · XRPL · explorer"],
    ["all", facts({ all: true }), "All tokens · XRPL · explorer"],
    ["a search and all", facts({ q: "USD", all: true }), "Tokens matching “USD” · XRPL · explorer"],
    ["a marker", facts({ more: true }), "More tokens · XRPL · explorer"],
    ["a marker and a search", facts({ more: true, q: "USD" }), "More tokens matching “USD” · XRPL · explorer"],
    ["a marker and all", facts({ more: true, all: true }), "More tokens · XRPL · explorer"],
    ["a search that was too long", facts({ error: true }), "Tokens · XRPL · explorer"],
  ] satisfies Array<[string, TokensMetaFacts, string]>)("is noindex, follow, with no canonical URL and no Open Graph or card tags, with %s", (_name, view, expected) => {
    const list = tokensMeta(view, XRPL);
    expect(title(list)).toBe(expected);
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });

  it("puts no figure of the data in the description: the page is stored for a minute", () => {
    expect(content(tokensMeta(facts(), XRPL), "description")?.replace("24-hour", "")).not.toMatch(/\d/);
  });
});

describe("tokenMeta", () => {
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const ISSUER = TOKEN_SAMPLE_ISSUER;
  const ASSET = { currency: TOKEN_SAMPLE_CURRENCY, issuer: ISSUER };
  /** The facts of a token as the view builder writes them (`TokenPageData.meta`): RLUSD with its toml's name, listed. */
  const facts = (over: Partial<TokenMetaFacts> = {}): TokenMetaFacts => ({ ...tokenFacts({ id: "xrpl" }, tokenDetailSample(), false), ...over });
  const withoutName = (): TokenMetaFacts => {
    const { name: _name, ...rest } = facts();
    return rest;
  };
  const DESCRIPTION = `RLUSD, issued by ${shortAddress(ISSUER)} on XRPL: holders, supply, price, markets, the issuer's settings and recent transfers.`;
  const IMAGE = `https://explorer.test/og/xrpl/token/RLUSD.${ISSUER}.png`;

  it("has the tags of the token's page: the name and the code in the title, a description with no figure, the canonical URL on the origin, Open Graph, the image and a large card", () => {
    const list = tokenMeta(facts(), XRPL);
    expect(title(list)).toBe("Ripple USD (RLUSD) · XRPL · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(link(list, "canonical")).toBe(`https://explorer.test/xrpl/token/RLUSD.${ISSUER}`);
    expect(content(list, "og:title")).toBe("Ripple USD (RLUSD) · XRPL · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION);
    expect(content(list, "og:url")).toBe(`https://explorer.test/xrpl/token/RLUSD.${ISSUER}`);
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "og:image")).toBe(IMAGE);
    expect(content(list, "og:image:width")).toBe("1200");
    expect(content(list, "og:image:height")).toBe("630");
    expect(content(list, "og:image:alt")).toBe(`Ripple USD, an issued token of ${shortAddress(ISSUER)} on XRPL`);
    expect(content(list, "twitter:card")).toBe("summary_large_image");
    expect(content(list, "twitter:image")).toBe(IMAGE);
    expect(keys(list)).not.toContain("robots");
    expect(content(list, "description")).not.toMatch(/\d{3}/);
  });

  it("is headed by the code and the short issuer when the toml gives no name", () => {
    const list = tokenMeta(withoutName(), XRPL);
    expect(title(list)).toBe(`RLUSD by ${shortAddress(ISSUER)} · XRPL · explorer`);
    expect(content(list, "og:image:alt")).toBe(`RLUSD, an issued token of ${shortAddress(ISSUER)} on XRPL`);
  });

  it("is on the path the page's own links write and the image's, whatever the code holds", () => {
    expect(new URL(link(tokenMeta(facts(), XRPL), "canonical")!).pathname).toBe(tokenHref("xrpl", ASSET));
    const usd = { currency: "USD", issuer: ISSUER };
    const list = tokenMeta({ ...tokenFacts({ id: "xrpl" }, tokenDetailSample({ currency: "USD", code: "USD" }), false) }, XRPL);
    expect(new URL(link(list, "canonical")!).pathname).toBe(tokenHref("xrpl", usd));
    expect(content(list, "og:image")).toBe(`https://explorer.test/og/xrpl/token/USD.${ISSUER}.png`);
    // A text code that holds a character a path escapes: the segment is the path's, escaped once.
    const odd = tokenDetailSample({ currency: "5A2F23405E2A2F2F000000000000000000000000" });
    const escaped = tokenMeta(tokenFacts({ id: "xrpl" }, odd, false), XRPL);
    expect(new URL(link(escaped, "canonical")!).pathname).toBe(tokenHref("xrpl", { currency: odd.currency, issuer: ISSUER }));
    expect(new URL(content(escaped, "og:image")!).pathname).toBe(`/og/xrpl/token/${tokenFacts({ id: "xrpl" }, odd, false).segment}.png`);
  });

  it("is Xahau's on Xahau, and the sandbox's names, in the title and in the description", () => {
    const xahau = tokenMeta(tokenFacts({ id: "xahau" }, tokenDetailSample(), false), XAHAU);
    expect(title(xahau)).toBe("Ripple USD (RLUSD) · Xahau · explorer");
    expect(content(xahau, "description")).toBe(`RLUSD, issued by ${shortAddress(ISSUER)} on Xahau: holders, supply, price, markets, the issuer's settings and recent transfers.`);
    expect(link(xahau, "canonical")).toBe(`https://explorer.test/xahau/token/RLUSD.${ISSUER}`);
    expect(content(xahau, "og:image")).toBe(`https://explorer.test/og/xahau/token/RLUSD.${ISSUER}.png`);
    const testnet = tokenMeta(facts(), XRPL_TESTNET);
    expect(title(testnet)).toBe("Ripple USD (RLUSD) · XRPL Testnet · explorer");
    expect(content(testnet, "description")).toContain("on XRPL Testnet:");
  });

  it("is on the request's origin", () => {
    const list = tokenMeta(facts(), { ...XRPL, origin: "https://explorer.example" });
    expect(link(list, "canonical")).toBe(`https://explorer.example/xrpl/token/RLUSD.${ISSUER}`);
    expect(content(list, "og:image")).toBe(`https://explorer.example/og/xrpl/token/RLUSD.${ISSUER}.png`);
  });

  it("is noindex, follow behind a marker, with no canonical URL and no Open Graph or card tags", () => {
    const list = tokenMeta(facts({ more: true }), XRPL);
    expect(title(list)).toBe("Older transfers of RLUSD · XRPL · explorer");
    expect(content(list, "description")).toBe(`Older transfers of RLUSD, issued by ${shortAddress(ISSUER)} on XRPL.`);
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
    // Whether it has a name or not: the title is the code's.
    expect(title(tokenMeta({ ...withoutName(), more: true }, XRPL))).toBe("Older transfers of RLUSD · XRPL · explorer");
  });

  it("is written from the page the builder made", () => {
    const page = tokenPage({
      net: { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled", hasAmm: true, features: NO_FEATURES },
      asset: ASSET,
      answer: tokenSample(),
      mode: "first",
      params: { back: [] },
      holders: { state: "ok", value: holdersSample() },
      transfers: { state: "ok", value: transfersSample() },
      pools: { state: "ok", value: { result: "success", count: 0, pools: [] } },
      ammVolume: null,
      accountInfo: null,
      names: NO_NAMES,
    }).page;
    expect(title(tokenMeta(page.meta, XRPL))).toBe("Ripple USD (RLUSD) · XRPL · explorer");
  });
});

describe("tokenHoldersMeta", () => {
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const ISSUER = TOKEN_SAMPLE_ISSUER;
  const ASSET = { currency: TOKEN_SAMPLE_CURRENCY, issuer: ISSUER };
  /** The facts of the holders page as the view builder writes them (`TokenHoldersPageData.meta`): the first page of RLUSD's holders. */
  const facts = (over: Partial<TokenHoldersMetaFacts> = {}): TokenHoldersMetaFacts => ({ code: "RLUSD", issuer: ISSUER, href: tokenHoldersHref("xrpl", ASSET), more: false, ...over });
  const DESCRIPTION = `Every account that holds RLUSD, issued by ${shortAddress(ISSUER)} on XRPL, the largest balance first, with each holder's limit and status.`;

  it("has the tags of an indexable first page: Holders of the code in the title, the canonical URL on the origin, Open Graph, a summary card and no image", () => {
    const list = tokenHoldersMeta(facts(), XRPL);
    expect(title(list)).toBe("Holders of RLUSD · XRPL · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(link(list, "canonical")).toBe(`https://explorer.test/xrpl/token/RLUSD.${ISSUER}/holders`);
    expect(content(list, "og:title")).toBe("Holders of RLUSD · XRPL · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION);
    expect(content(list, "og:url")).toBe(`https://explorer.test/xrpl/token/RLUSD.${ISSUER}/holders`);
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("puts no figure of the data in the description: the page is stored for a minute", () => {
    expect(content(tokenHoldersMeta(facts(), XRPL), "description")?.replace(shortAddress(ISSUER), "")).not.toMatch(/\d/);
  });

  it("is on the path the page's own links write, whatever the code holds", () => {
    expect(new URL(link(tokenHoldersMeta(facts(), XRPL), "canonical")!).pathname).toBe(tokenHoldersHref("xrpl", ASSET));
    const odd = { currency: "5A2F23405E2A2F2F000000000000000000000000", issuer: ISSUER };
    const list = tokenHoldersMeta(facts({ href: tokenHoldersHref("xrpl", odd) }), XRPL);
    expect(new URL(link(list, "canonical")!).pathname).toBe(tokenHoldersHref("xrpl", odd));
  });

  it("is Xahau's on Xahau, and the sandbox's names, in the title and in the description", () => {
    const xahau = tokenHoldersMeta(facts({ href: tokenHoldersHref("xahau", ASSET) }), XAHAU);
    expect(title(xahau)).toBe("Holders of RLUSD · Xahau · explorer");
    expect(content(xahau, "description")).toBe(`Every account that holds RLUSD, issued by ${shortAddress(ISSUER)} on Xahau, the largest balance first, with each holder's limit and status.`);
    expect(link(xahau, "canonical")).toBe(`https://explorer.test/xahau/token/RLUSD.${ISSUER}/holders`);
    const testnet = tokenHoldersMeta(facts(), XRPL_TESTNET);
    expect(title(testnet)).toBe("Holders of RLUSD · XRPL Testnet · explorer");
    expect(content(testnet, "description")).toContain("on XRPL Testnet,");
  });

  it("is on the request's origin", () => {
    const list = tokenHoldersMeta(facts(), { ...XRPL, origin: "https://explorer.example" });
    expect(link(list, "canonical")).toBe(`https://explorer.example/xrpl/token/RLUSD.${ISSUER}/holders`);
    expect(content(list, "og:url")).toBe(`https://explorer.example/xrpl/token/RLUSD.${ISSUER}/holders`);
  });

  it("is noindex, follow behind a marker, with the same title, no canonical URL and no Open Graph or card tags", () => {
    const list = tokenHoldersMeta(facts({ more: true }), XRPL);
    expect(title(list)).toBe("Holders of RLUSD · XRPL · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });

  it("is written from the page the builder made", () => {
    const net = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled", hasAmm: true, features: NO_FEATURES } as const;
    const first = tokenHoldersPage({ net, asset: ASSET, answer: tokenSample(), holders: { state: "ok", value: holdersSample() }, params: { back: [] }, names: NO_NAMES }).page;
    expect(title(tokenHoldersMeta(first.meta, XRPL))).toBe("Holders of RLUSD · XRPL · explorer");
    expect(link(tokenHoldersMeta(first.meta, XRPL), "canonical")).toBe(`https://explorer.test/xrpl/token/RLUSD.${ISSUER}/holders`);
    const second = tokenHoldersPage({ net, asset: ASSET, answer: tokenSample(), holders: { state: "ok", value: holdersSample() }, params: { marker: "M2", back: [] }, names: NO_NAMES }).page;
    expect(content(tokenHoldersMeta(second.meta, XRPL), "robots")).toBe("noindex, follow");
  });
});

describe("nftSalesMeta", () => {
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const sales = (net: NftsNet = { id: "xrpl", native: "XRP", longName: "the XRP Ledger" }): NftSalesPageData => ({
    ...nftSalesPage(net, { back: [] }, nftSalesPageSample({ sales: [], count: 0 })),
    names: NO_NAMES,
  });

  it("is noindex, follow with no canonical URL and no Open Graph or card tags, whichever page of the sales it is", () => {
    const list = nftSalesMeta(sales(), XRPL);
    expect(title(list)).toBe("NFT sales · XRPL · explorer");
    expect(content(list, "description")).toBe("The latest NFT sales on the XRP Ledger, newest first.");
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });

  it("is Xahau's on Xahau, and the sandbox's names", () => {
    const list = nftSalesMeta(sales({ id: "xahau", native: "XAH", longName: "Xahau" }), XAHAU);
    expect(title(list)).toBe("URIToken sales · Xahau · explorer");
    expect(content(list, "description")).toBe("The latest URIToken sales on Xahau, newest first.");
    expect(title(nftSalesMeta(sales(), XRPL_TESTNET))).toBe("NFT sales · XRPL Testnet · explorer");
    expect(content(nftSalesMeta(sales({ id: "xrpl", native: "XRP", longName: "XRPL Testnet" }), XRPL_TESTNET), "description")).toBe("The latest NFT sales on XRPL Testnet, newest first.");
  });

  it("puts no number in the description", () => {
    expect(content(nftSalesMeta(sales(), XRPL), "description")).not.toMatch(/\d/);
  });
});

describe("nftCollectionMeta", () => {
  const KEY: CollectionKey = { issuer: NFT_ISSUER, taxon: 10 };
  const URI_KEY: CollectionKey = { issuer: URI_TOKEN_ISSUER };
  const LABEL = "r4PP7g…CzT3 · taxon 10";
  const URL = `https://explorer.test/xrpl/nfts/${NFT_ISSUER}/10`;
  const DESCRIPTION = `NFT collection ${LABEL} on the XRP Ledger: its sales, NFTs and holders.`;
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const failed = (): PromiseRejectedResult => ({ status: "rejected", reason: new Error("not asked in this test") });
  const NET: CollectionNet = { id: "xrpl", name: "XRPL", native: "XRP", longName: "the XRP Ledger" };
  const URI_NET: CollectionNet = { id: "xahau", name: "Xahau", native: "XAH", longName: "Xahau" };
  const QUERY: CollectionQuery = { measure: "volume", tab: "sales", burned: false, back: [] };
  const WHOLE = coverageSample({ complete: true });
  /** The page data of a view of the collection, as the view builder writes it: the tags read what the page says of its view. */
  const view = (query: Partial<CollectionQuery> = {}, over: { net?: CollectionNet; key?: CollectionKey; ownerError?: string } = {}): NftCollectionPageData => ({
    ...nftCollectionPage({
      net: over.net ?? NET,
      key: over.key ?? KEY,
      query: { ...QUERY, ...query },
      ...(over.ownerError === undefined ? {} : { ownerError: over.ownerError }),
      collection: nftCollectionAnswerSample({ ...(over.key === undefined ? {} : { collection: uriTokenCollectionSample() }), coverage: WHOLE }),
      last: failed(),
      stats: null,
      list: query.tab === "nfts" ? { status: "fulfilled", value: nftsPageSample({ coverage: WHOLE }) } : { status: "fulfilled", value: nftSalesPageSample({ coverage: WHOLE }) },
    }),
    names: NO_NAMES,
  });
  const marked = (query: Partial<CollectionQuery> = {}, net: CollectionNet = NET, key: CollectionKey = KEY): NftCollectionPageData => ({
    ...collectionMarkerPage({
      net,
      key,
      query: { ...QUERY, marker: "M1", ...query },
      collection: nftCollectionAnswerSample({ coverage: WHOLE }),
      list: { status: "fulfilled", value: nftSalesPageSample({ coverage: WHOLE }) },
    }),
    names: NO_NAMES,
  });

  it("has the tags of the first page: the title, a canonical URL on the origin that names the collection, Open Graph, a summary card and no image", () => {
    const tagsOf = nftCollectionMeta(view(), XRPL);
    expect(title(tagsOf)).toBe(`Collection ${LABEL} · XRPL · explorer`);
    expect(content(tagsOf, "description")).toBe(DESCRIPTION);
    expect(link(tagsOf, "canonical")).toBe(URL);
    expect(content(tagsOf, "og:title")).toBe(`Collection ${LABEL} · XRPL · explorer`);
    expect(content(tagsOf, "og:description")).toBe(DESCRIPTION);
    expect(content(tagsOf, "og:url")).toBe(URL);
    expect(content(tagsOf, "og:type")).toBe("website");
    expect(content(tagsOf, "twitter:card")).toBe("summary");
    expect(keys(tagsOf)).not.toContain("og:image");
    expect(keys(tagsOf)).not.toContain("twitter:image");
    expect(keys(tagsOf)).not.toContain("robots");
  });

  it("keeps the issuer's short address (display names spec 7): a page that names its issuer has the tags of one that does not", () => {
    const names: NamesPart = { state: "ok", map: { [NFT_ISSUER]: { name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example", labels: [] } } };
    const list = nftCollectionMeta({ ...view(), names }, XRPL);
    expect(title(list)).toBe(`Collection ${LABEL} · XRPL · explorer`);
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(list).toEqual(nftCollectionMeta(view(), XRPL));
    expect(JSON.stringify(list)).not.toContain("Northpeak Treasury");
  });

  it("keeps the tab in the canonical URL unless it is the first, and the measure and a filter's absence", () => {
    expect(link(nftCollectionMeta(view({ tab: "sales" }), XRPL), "canonical")).toBe(URL);
    expect(link(nftCollectionMeta(view({ tab: "nfts" }), XRPL), "canonical")).toBe(`${URL}?tab=nfts`);
    expect(link(nftCollectionMeta(view({ tab: "holders" }), XRPL), "canonical")).toBe(`${URL}?tab=holders`);
    expect(content(nftCollectionMeta(view({ tab: "nfts" }), XRPL), "robots")).toBeUndefined();
  });

  it("is on the request's origin", () => {
    const tagsOf = nftCollectionMeta(view(), { ...XRPL, origin: "https://explorer.example" });
    expect(link(tagsOf, "canonical")).toBe(`https://explorer.example/xrpl/nfts/${NFT_ISSUER}/10`);
    expect(content(tagsOf, "og:url")).toBe(`https://explorer.example/xrpl/nfts/${NFT_ISSUER}/10`);
  });

  it("is Xahau's on Xahau: URITokens of the issuer, no taxon in the canonical URL, URIToken words in the description", () => {
    const tagsOf = nftCollectionMeta(view({}, { net: URI_NET, key: URI_KEY }), XAHAU);
    expect(title(tagsOf)).toBe("URITokens of rodinG…zKyb · Xahau · explorer");
    expect(content(tagsOf, "description")).toBe("URIToken collection rodinG…zKyb on Xahau: its sales, URITokens and holders.");
    expect(link(tagsOf, "canonical")).toBe(`https://explorer.test/xahau/nfts/${URI_TOKEN_ISSUER}`);
    expect(link(nftCollectionMeta(view({ tab: "nfts" }, { net: URI_NET, key: URI_KEY }), XAHAU), "canonical")).toBe(`https://explorer.test/xahau/nfts/${URI_TOKEN_ISSUER}?tab=nfts`);
  });

  it("names the network of the sandbox, in the title and in the description", () => {
    const tagsOf = nftCollectionMeta(view({}, { net: { ...NET, name: "XRPL Testnet", longName: "XRPL Testnet" } }), XRPL_TESTNET);
    expect(title(tagsOf)).toBe(`Collection ${LABEL} · XRPL Testnet · explorer`);
    expect(content(tagsOf, "description")).toBe(`NFT collection ${LABEL} on XRPL Testnet: its sales, NFTs and holders.`);
    expect(title(nftCollectionMeta(view({}, { net: { ...URI_NET, name: "Xahau Testnet", longName: "Xahau Testnet" }, key: URI_KEY }), XAHAU_TESTNET))).toBe("URITokens of rodinG…zKyb · Xahau Testnet · explorer");
  });

  it.each([
    ["another measure", view({ measure: "avg" }), `Collection ${LABEL} · XRPL · explorer`],
    ["the lowest price", view({ measure: "low", tab: "holders" }), `Collection ${LABEL} · XRPL · explorer`],
    ["an owner", view({ tab: "nfts", owner: NFT_OWNER }), `Collection ${LABEL} · XRPL · explorer`],
    ["an owner that is no address", view({ tab: "nfts", owner: "rNope" }, { ownerError: "Write a classic address (r…)." }), `Collection ${LABEL} · XRPL · explorer`],
    ["burned NFTs", view({ tab: "nfts", burned: true }), `Collection ${LABEL} · XRPL · explorer`],
    ["a marker", marked(), `Older sales of ${LABEL} · XRPL · explorer`],
    ["a marker on the NFTs tab", marked({ tab: "nfts", owner: NFT_OWNER }), `Older NFTs of ${LABEL} · XRPL · explorer`],
  ] satisfies Array<[string, NftCollectionPageData, string]>)("is noindex, follow, with no canonical URL and no Open Graph or card tags, with %s", (_name, data, expected) => {
    const tagsOf = nftCollectionMeta(data, XRPL);
    expect(title(tagsOf)).toBe(expected);
    expect(content(tagsOf, "description")).toBe(DESCRIPTION);
    expect(content(tagsOf, "robots")).toBe("noindex, follow");
    expect(tags(tagsOf).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(tagsOf).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
    expect(keys(tagsOf).sort()).toEqual(["description", "robots"]);
  });

  it("says the tab's older rows behind a marker on Xahau", () => {
    const tagsOf = nftCollectionMeta(marked({ tab: "holders" }, URI_NET, URI_KEY), XAHAU);
    expect(title(tagsOf)).toBe("Older holders of rodinG…zKyb · Xahau · explorer");
    expect(content(tagsOf, "robots")).toBe("noindex, follow");
  });

  it("puts no figure in the description, the taxon in the label aside: the page is stored for a minute", () => {
    expect(content(nftCollectionMeta(view(), XRPL), "description")?.replace(LABEL, "")).not.toMatch(/\d/);
    expect(content(nftCollectionMeta(view({}, { net: URI_NET, key: URI_KEY }), XAHAU), "description")).not.toMatch(/\d/);
  });
});

describe("nftMeta", () => {
  const NET: NftNet = { id: "xrpl", name: "XRPL", native: "XRP", longName: "the XRP Ledger", other: "xahau" };
  const URI_NET: NftNet = { id: "xahau", name: "Xahau", native: "XAH", longName: "Xahau", other: "xrpl" };
  const NOW = Date.UTC(2026, 9, 25) / 1000;
  const LABEL = "r4PP7g…CzT3 · taxon 10";
  const URL = `https://explorer.test/xrpl/nft/${NFT_ID}`;
  const IMAGE = `https://explorer.test/og/xrpl/nft/${NFT_ID}.png`;
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const ALT = `NFT #95,234,705 of ${LABEL} on XRPL`;

  /** The page data of an indexed NFT (sold once for 10 XRP, held by the sample owner), as the view builder writes it: the tags read what the page says. */
  const view = (over: Partial<Parameters<typeof nftPage>[0]> = {}): NftPageData => ({
    ...nftPage({
      net: NET,
      id: NFT_ID,
      query: { offers: false, back: [] },
      mode: "indexed",
      now: NOW,
      index: nftAnswerSample(),
      offers: { status: "fulfilled", value: { coverage: coverageSample(), count: 0, offers: [] } },
      history: { status: "fulfilled", value: nftEventsPageSample() },
      ...over,
    }),
    names: NO_NAMES,
  });
  /** The page the loader answers: the builder's page with its names part, which no tag reads. */
  const named = (page: Omit<NftPageData, "names">): NftPageData => ({ ...page, names: NO_NAMES });

  it("has the tags of an NFT: the title, the description with its owner and last sale, a canonical URL on the origin, Open Graph, the link-preview image and a large card", () => {
    const tagsOf = nftMeta(view(), XRPL);
    expect(title(tagsOf)).toBe(`NFT #95,234,705 of ${LABEL} · XRPL · explorer`);
    expect(content(tagsOf, "description")).toBe("Owned by rnKd8C…FrTx · last sold for 10 XRP · XRPL");
    expect(link(tagsOf, "canonical")).toBe(URL);
    expect(content(tagsOf, "og:title")).toBe(`NFT #95,234,705 of ${LABEL} · XRPL · explorer`);
    expect(content(tagsOf, "og:description")).toBe("Owned by rnKd8C…FrTx · last sold for 10 XRP · XRPL");
    expect(content(tagsOf, "og:url")).toBe(URL);
    expect(content(tagsOf, "og:type")).toBe("website");
    expect(content(tagsOf, "og:image")).toBe(IMAGE);
    expect(content(tagsOf, "og:image:width")).toBe("1200");
    expect(content(tagsOf, "og:image:height")).toBe("630");
    expect(content(tagsOf, "og:image:alt")).toBe(ALT);
    expect(content(tagsOf, "twitter:card")).toBe("summary_large_image");
    expect(content(tagsOf, "twitter:image")).toBe(IMAGE);
    expect(content(tagsOf, "twitter:image:alt")).toBe(ALT);
    expect(keys(tagsOf)).not.toContain("robots");
  });

  it("is on the request's origin", () => {
    const tagsOf = nftMeta(view(), { ...XRPL, origin: "https://explorer.example" });
    expect(link(tagsOf, "canonical")).toBe(`https://explorer.example/xrpl/nft/${NFT_ID}`);
    expect(content(tagsOf, "og:image")).toBe(`https://explorer.example/og/xrpl/nft/${NFT_ID}.png`);
  });

  it("keeps the canonical URL of the NFT for the view with offer events, which is a view of the same NFT", () => {
    const tagsOf = nftMeta(view({ query: { offers: true, back: [] } }), XRPL);
    expect(link(tagsOf, "canonical")).toBe(URL);
    expect(keys(tagsOf)).not.toContain("robots");
  });

  it("says '(burned)' after the name, and Burned in place of an owner", () => {
    const burned = nftSample({ owner: undefined, owner_since: undefined, burned: true });
    const tagsOf = nftMeta(view({ mode: "burned", index: nftAnswerSample({ nft: burned }) }), XRPL);
    expect(title(tagsOf)).toBe(`NFT #95,234,705 (burned) of ${LABEL} · XRPL · explorer`);
    expect(content(tagsOf, "description")).toBe("Burned · last sold for 10 XRP · XRPL");
    expect(link(tagsOf, "canonical")).toBe(URL);
  });

  it("says that an NFT was never sold, or how often when no price is there, and leaves out an owner the index does not have", () => {
    const never = nftSample({ sale_count: 0, last_sale: undefined });
    expect(content(nftMeta(view({ index: nftAnswerSample({ nft: never }) }), XRPL), "description")).toBe("Owned by rnKd8C…FrTx · never sold · XRPL");
    const unowned = nftSample({ owner: undefined, owner_since: undefined, sale_count: 3, last_sale: undefined });
    expect(content(nftMeta(view({ mode: "indexed-owner-unknown", index: nftAnswerSample({ nft: unowned }) }), XRPL), "description")).toBe("sold 3 times · XRPL");
    const read = nodeNftInfoSample();
    expect(content(nftMeta(view({ mode: "indexed-network-owner", index: nftAnswerSample({ nft: unowned }), node: read }), XRPL), "description")).toBe(`Owned by ${shortAddress(read.owner)} · sold 3 times · XRPL`);
  });

  it("is Xahau's on Xahau: URIToken and its short id in the title, its token's price in XAH", () => {
    const tagsOf = nftMeta(named(nftPage({ net: URI_NET, id: URI_TOKEN_ID, query: { offers: false, back: [] }, mode: "indexed", now: NOW, index: nftAnswerSample({ nft: uriTokenSample() }), offers: null, history: null })), XAHAU);
    expect(title(tagsOf)).toBe("URIToken 96133366… of rodinG…zKyb · Xahau · explorer");
    expect(content(tagsOf, "description")).toBe(`Owned by ${shortAddress(URI_TOKEN_OWNER)} · last sold for 4,200 XAH · Xahau`);
    expect(link(tagsOf, "canonical")).toBe(`https://explorer.test/xahau/nft/${URI_TOKEN_ID}`);
    expect(content(tagsOf, "og:image")).toBe(`https://explorer.test/og/xahau/nft/${URI_TOKEN_ID}.png`);
  });

  it("names the network of the sandbox, in the title and in the description", () => {
    const tagsOf = nftMeta(view({ net: { ...NET, name: "XRPL Testnet", longName: "XRPL Testnet" } }), XRPL_TESTNET);
    expect(title(tagsOf)).toBe(`NFT #95,234,705 of ${LABEL} · XRPL Testnet · explorer`);
    expect(content(tagsOf, "description")).toBe("Owned by rnKd8C…FrTx · last sold for 10 XRP · XRPL Testnet");
    expect(content(tagsOf, "og:image:alt")).toBe(`NFT #95,234,705 of ${LABEL} on XRPL Testnet`);
    const xahau = nftMeta(named(nftPage({ net: { ...URI_NET, name: "Xahau Testnet", longName: "Xahau Testnet" }, id: URI_TOKEN_ID, query: { offers: false, back: [] }, mode: "indexed", now: NOW, index: nftAnswerSample({ nft: uriTokenSample() }), offers: null, history: null })), XAHAU_TESTNET);
    expect(title(xahau)).toBe("URIToken 96133366… of rodinG…zKyb · Xahau Testnet · explorer");
  });

  it.each([
    ["from the network", () => view({ mode: "network", index: undefined, node: nodeNftInfoSample(), id: NODE_NFT_ID, offers: null, history: null })],
    ["a URIToken from the network", () => named(nftPage({ net: URI_NET, id: URI_TOKEN_ID, query: { offers: false, back: [] }, mode: "network", now: NOW, node: nodeUriTokenSample(), offers: null, history: null }))],
  ])("is noindex, with no canonical URL and nothing to share, %s", (_name, make) => {
    const tagsOf = nftMeta(make(), XRPL);
    expect(content(tagsOf, "robots")).toBe("noindex");
    expect(tags(tagsOf).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(tagsOf).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
    expect(keys(tagsOf).sort()).toEqual(["description", "robots"]);
    expect(title(tagsOf)).toMatch(/ · XRPL · explorer$/);
  });

  it("keeps the owner's short address (display names spec 7): the tags of a page that names its accounts are those of one that does not, the title and the description in out-of-context shares", () => {
    const names: NamesPart = { state: "ok", map: { [NFT_OWNER]: { name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example", labels: [] } } };
    const list = nftMeta({ ...view(), names }, XRPL);
    expect(content(list, "description")).toBe(`Owned by ${shortAddress(NFT_OWNER)} · last sold for 10 XRP · XRPL`);
    expect(list).toEqual(nftMeta(view(), XRPL));
    expect(JSON.stringify(list)).not.toContain("Northpeak Treasury");
  });

  it("says Owned by the node's owner from the network", () => {
    const node = nodeNftInfoSample();
    const tagsOf = nftMeta(view({ mode: "network", index: undefined, node, id: NODE_NFT_ID, offers: null, history: null }), XRPL);
    expect(content(tagsOf, "description")).toBe(`Owned by ${shortAddress(node.owner)} · XRPL`);
    const burned = nftMeta(view({ mode: "network-burned", index: undefined, node: nodeNftInfoSample({ is_burned: true }), id: NODE_NFT_ID, offers: null, history: null }), XRPL);
    expect(title(burned)).toContain("(burned)");
    expect(content(burned, "description")).toBe("Burned · XRPL");
  });

  it("is noindex, follow behind a marker, with no canonical URL or sharing tags, and titled for the older history", () => {
    const marked = named(nftMarkerPage({ net: NET, id: NFT_ID, query: { offers: false, marker: "M1", back: [] }, index: nftAnswerSample(), history: nftEventsPageSample() }));
    const tagsOf = nftMeta(marked, XRPL);
    expect(title(tagsOf)).toBe("Older history of NFT #95,234,705 · XRPL · explorer");
    expect(content(tagsOf, "description")).toBe(`Older history of NFT #95,234,705 of ${LABEL} on XRPL.`);
    expect(content(tagsOf, "robots")).toBe("noindex, follow");
    expect(tags(tagsOf).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(tagsOf).sort()).toEqual(["description", "robots"]);
    const token = nftMeta(named(nftMarkerPage({ net: URI_NET, id: URI_TOKEN_ID, query: { offers: false, marker: "M1", back: [] }, index: nftAnswerSample({ nft: uriTokenSample() }), history: nftEventsPageSample() })), XAHAU);
    expect(title(token)).toBe("Older history of URIToken 96133366… · Xahau · explorer");
  });
});

describe("ammPoolMeta", () => {
  const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
  const DESCRIPTION = "XRP/RLUSD AMM pool on XRPL, account rhWTXC…tcS3: trading fee 0.300%, created 2024-03-22. Reserves, price, swaps, liquidity and votes.";
  const URL = `https://explorer.test/xrpl/amm/${POOL}`;
  const IMAGE = `https://explorer.test/og/xrpl/amm/${POOL}.png`;
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  /** The facts of the first page of an indexed pool, as the view builder writes them (`AmmPoolPageData.meta`). */
  const facts = (more: Partial<AmmPoolMeta> = {}): AmmPoolMeta => ({
    pool: POOL,
    net: "xrpl",
    native: "XRP",
    pair: "XRP/RLUSD",
    text: "XRP / RLUSD",
    deleted: false,
    fee: "0.300%",
    value: "3.61M",
    created: { date: "2024-03-22", at: 1711065600 },
    tab: "swaps",
    period: "90d",
    marker: false,
    mode: "indexed",
    ...more,
  });
  /** Whether the tags are those of a page that is not shared: no canonical URL, no Open Graph or card tags. */
  const unshared = (list: ReadonlyArray<unknown>) => {
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).filter((key) => /^(og|twitter):/.test(key))).toEqual([]);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  };

  it("has the tags of the default view: the pair's title, its facts, the canonical URL, Open Graph with the pool's image and a large card", () => {
    const list = ammPoolMeta(facts(), XRPL);
    expect(title(list)).toBe("XRP/RLUSD AMM pool · XRPL · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(link(list, "canonical")).toBe(URL);
    expect(content(list, "og:title")).toBe("XRP/RLUSD AMM pool · XRPL · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION);
    expect(content(list, "og:url")).toBe(URL);
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:image")).toBe(IMAGE);
    expect(content(list, "og:image:alt")).toBe("XRP/RLUSD AMM pool on XRPL");
    expect(content(list, "twitter:card")).toBe("summary_large_image");
    expect(content(list, "twitter:image")).toBe(IMAGE);
    expect(keys(list)).not.toContain("robots");
    // The image is the og route's kind `amm`.
    expect(imageUrl("https://explorer.test", "xrpl", "amm", POOL)).toBe(IMAGE);
  });

  it("is on the request's origin", () => {
    const list = ammPoolMeta(facts(), { ...XRPL, origin: "https://explorer.example" });
    expect(link(list, "canonical")).toBe(`https://explorer.example/xrpl/amm/${POOL}`);
    expect(content(list, "og:image")).toBe(`https://explorer.example/og/xrpl/amm/${POOL}.png`);
  });

  it.each([
    ["no fee", { fee: undefined }, "XRP/RLUSD AMM pool on XRPL, account rhWTXC…tcS3: created 2024-03-22. Reserves, price, swaps, liquidity and votes."],
    ["no creation", { created: undefined }, "XRP/RLUSD AMM pool on XRPL, account rhWTXC…tcS3: trading fee 0.300%. Reserves, price, swaps, liquidity and votes."],
    ["neither", { fee: undefined, created: undefined }, "XRP/RLUSD AMM pool on XRPL, account rhWTXC…tcS3. Reserves, price, swaps, liquidity and votes."],
  ] satisfies Array<[string, Partial<AmmPoolMeta>, string]>)("leaves out a fact the page lacks, with its words: %s", (_what, more, expected) => {
    expect(content(ammPoolMeta(facts(more), XRPL), "description")).toBe(expected);
  });

  it.each([
    ["liquidity", "XRP/RLUSD AMM pool · liquidity · XRPL · explorer", `${URL}?tab=liquidity`],
    ["governance", "XRP/RLUSD AMM pool · votes and bids · XRPL · explorer", `${URL}?tab=governance`],
  ] as const)("names the %s tab in the title and in the canonical URL", (tab, expected, url) => {
    const list = ammPoolMeta(facts({ tab }), XRPL);
    expect(title(list)).toBe(expected);
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(link(list, "canonical")).toBe(url);
    expect(content(list, "og:url")).toBe(url);
    expect(content(list, "og:image")).toBe(IMAGE);
  });

  it("says a deleted pool is deleted, after pool", () => {
    const list = ammPoolMeta(facts({ deleted: true, pair: "SNK/XRP", value: undefined }), XRPL);
    expect(title(list)).toBe("SNK/XRP AMM pool (deleted) · XRPL · explorer");
    expect(content(list, "description")).toBe("SNK/XRP AMM pool (deleted) on XRPL, account rhWTXC…tcS3: trading fee 0.300%, created 2024-03-22. Reserves, price, swaps, liquidity and votes.");
    expect(link(list, "canonical")).toBe(URL);
  });

  it.each([
    ["30d", "swaps", "XRP/RLUSD AMM pool · last 30 days · XRPL · explorer"],
    ["1y", "swaps", "XRP/RLUSD AMM pool · last year · XRPL · explorer"],
    ["30d", "governance", "XRP/RLUSD AMM pool · votes and bids · last 30 days · XRPL · explorer"],
  ] as const)("is noindex, follow, with no canonical URL and no Open Graph or card tags, at the period %s (tab %s)", (period, tab, expected) => {
    const list = ammPoolMeta(facts({ period, tab }), XRPL);
    expect(title(list)).toBe(expected);
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(content(list, "robots")).toBe("noindex, follow");
    unshared(list);
  });

  it.each([
    ["swaps", "Older swaps of the XRP/RLUSD AMM pool · XRPL · explorer"],
    ["liquidity", "Older liquidity events of the XRP/RLUSD AMM pool · XRPL · explorer"],
    ["governance", "Older votes and bids of the XRP/RLUSD AMM pool · XRPL · explorer"],
  ] as const)("names the older %s behind a marker: noindex, follow, with no canonical URL and nothing to share", (tab, expected) => {
    const list = ammPoolMeta(facts({ tab, marker: true, fee: undefined, created: undefined, value: undefined }), XRPL);
    expect(title(list)).toBe(expected);
    expect(content(list, "description")).toBe(`${expected.split(" · ")[0]} on XRPL, account rhWTXC…tcS3.`);
    expect(content(list, "robots")).toBe("noindex, follow");
    unshared(list);
  });

  it("names a deleted pool's older rows as deleted", () => {
    expect(title(ammPoolMeta(facts({ deleted: true, pair: "SNK/XRP", marker: true }), XRPL))).toBe("Older swaps of the SNK/XRP AMM pool (deleted) · XRPL · explorer");
  });

  it("keeps a pool shown from the network out of the index: the default title and description, noindex, no canonical URL, nothing to share", () => {
    const list = ammPoolMeta(facts({ mode: "network", value: undefined, created: undefined }), XRPL);
    expect(title(list)).toBe("XRP/RLUSD AMM pool · XRPL · explorer");
    expect(content(list, "description")).toBe("XRP/RLUSD AMM pool on XRPL, account rhWTXC…tcS3: trading fee 0.300%. Reserves, price, swaps, liquidity and votes.");
    expect(content(list, "robots")).toBe("noindex");
    unshared(list);
    // Another period of it too: a stand-in for 60 s, whatever its view.
    expect(content(ammPoolMeta(facts({ mode: "network", period: "30d" }), XRPL), "robots")).toBe("noindex");
  });

  it.each(["node-down", "gone"] as const)("indexes the first page of a pool in the %s mode, as the indexed one", (mode) => {
    const list = ammPoolMeta(facts({ mode }), XRPL);
    expect(title(list)).toBe("XRP/RLUSD AMM pool · XRPL · explorer");
    expect(link(list, "canonical")).toBe(URL);
    expect(keys(list)).not.toContain("robots");
  });

  it("puts no figure of the pool's state in the description: its value changes with each swap", () => {
    expect(content(ammPoolMeta(facts(), XRPL), "description")).not.toContain("3.61M");
  });
});

describe("escrowMeta", () => {
  const ID = "5B9C0E2A0D5C8B7F6E1A3D4C5B6A79880F1E2D3C4B5A69788796A5B4C3D2D21F";
  const URL = `https://explorer.test/xrpl/escrows/${ID}`;
  const facts = (over: Partial<EscrowMeta> = {}): EscrowMeta => ({
    id: ID,
    amount: "1,000 XRP",
    owner: "rJF2Xa…fQvg",
    destination: "rNYbL8…UKq5",
    status: "pending",
    marker: false,
    ...over,
  });
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;

  it("is the escrow's short ID in the title, and what it holds, from whom, to whom and its status in the description, with short addresses (C14)", () => {
    const list = escrowMeta(facts(), XRPL);
    expect(title(list)).toBe("Escrow 5B9C0E…D21F · XRPL · explorer");
    expect(content(list, "description")).toBe("Escrow of 1,000 XRP from rJF2Xa…fQvg to rNYbL8…UKq5 · pending · XRPL");
  });

  it("reads well without an amount D5 could not read", () => {
    expect(content(escrowMeta(facts({ amount: "" }), XRPL), "description")).toBe("Escrow from rJF2Xa…fQvg to rNYbL8…UKq5 · pending · XRPL");
  });

  it("has the canonical URL and the sharing tags with no image: a summary card (decision 9)", () => {
    const list = escrowMeta(facts({ status: "can be cancelled" }), XRPL);
    expect(link(list, "canonical")).toBe(URL);
    expect(content(list, "og:url")).toBe(URL);
    expect(content(list, "og:title")).toBe("Escrow 5B9C0E…D21F · XRPL · explorer");
    expect(content(list, "og:description")).toBe("Escrow of 1,000 XRP from rJF2Xa…fQvg to rNYbL8…UKq5 · can be cancelled · XRPL");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("is Xahau's on Xahau", () => {
    const list = escrowMeta(facts({ amount: "200 XAH" }), XAHAU);
    expect(title(list)).toBe("Escrow 5B9C0E…D21F · Xahau · explorer");
    expect(content(list, "description")).toBe("Escrow of 200 XAH from rJF2Xa…fQvg to rNYbL8…UKq5 · pending · Xahau");
    expect(link(list, "canonical")).toBe(`https://explorer.test/xahau/escrows/${ID}`);
  });

  it("is noindex, follow behind a marker, with no canonical URL and nothing to share", () => {
    const list = escrowMeta(facts({ marker: true }), XRPL);
    expect(title(list)).toBe("Escrow 5B9C0E…D21F · XRPL · explorer");
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(link(list, "canonical")).toBeUndefined();
    expect(keys(list).filter((key) => key.startsWith("og:") || key.startsWith("twitter:"))).toEqual([]);
  });
});

describe("checkMeta", () => {
  const ID = "60FCB1E8C72A695CBB6BDF718D30AF2310A9BED6D3F6D92F54C0E429186D1A42";
  const URL = `https://explorer.test/xrpl/checks/${ID}`;
  const facts = (over: Partial<CheckMeta> = {}): CheckMeta => ({
    id: ID,
    amount: "1,000 XRP",
    owner: "rJF2Xa…fQvg",
    destination: "rNYbL8…UKq5",
    status: "open",
    marker: false,
    ...over,
  });
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;

  it("is the check's short ID in the title, and what it allows, from whom, to whom and its status in the description, with short addresses (C14)", () => {
    const list = checkMeta(facts(), XRPL);
    expect(title(list)).toBe("Check 60FCB1…1A42 · XRPL · explorer");
    expect(content(list, "description")).toBe("Check for up to 1,000 XRP from rJF2Xa…fQvg to rNYbL8…UKq5 · open · XRPL");
  });

  it("reads well without a SendMax D5 could not read", () => {
    expect(content(checkMeta(facts({ amount: "" }), XRPL), "description")).toBe("Check from rJF2Xa…fQvg to rNYbL8…UKq5 · open · XRPL");
  });

  it("has the canonical URL and the sharing tags with no image: a summary card (decision 9)", () => {
    const list = checkMeta(facts({ status: "expired" }), XRPL);
    expect(link(list, "canonical")).toBe(URL);
    expect(content(list, "og:url")).toBe(URL);
    expect(content(list, "og:title")).toBe("Check 60FCB1…1A42 · XRPL · explorer");
    expect(content(list, "og:description")).toBe("Check for up to 1,000 XRP from rJF2Xa…fQvg to rNYbL8…UKq5 · expired · XRPL");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("is Xahau's on Xahau", () => {
    const list = checkMeta(facts({ amount: "200 XAH" }), XAHAU);
    expect(title(list)).toBe("Check 60FCB1…1A42 · Xahau · explorer");
    expect(content(list, "description")).toBe("Check for up to 200 XAH from rJF2Xa…fQvg to rNYbL8…UKq5 · open · Xahau");
    expect(link(list, "canonical")).toBe(`https://explorer.test/xahau/checks/${ID}`);
  });

  it("is noindex, follow behind a marker, with no canonical URL and nothing to share", () => {
    const list = checkMeta(facts({ marker: true }), XRPL);
    expect(title(list)).toBe("Check 60FCB1…1A42 · XRPL · explorer");
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(link(list, "canonical")).toBeUndefined();
    expect(keys(list).filter((key) => key.startsWith("og:") || key.startsWith("twitter:"))).toEqual([]);
  });
});

describe("paymentChannelMeta", () => {
  const ID = "E22CCE8FA636C8BDF1C3C4AA17FD604B8FDE268E4F6BF9022B5336536F5B69EA";
  const URL = `https://explorer.test/xrpl/payment-channels/${ID}`;
  const facts = (over: Partial<PaymentChannelMeta> = {}): PaymentChannelMeta => ({
    id: ID,
    amount: "1 XRP",
    owner: "rQQQrU…3ZrM",
    destination: "rLggTE…KrtR",
    status: "open",
    marker: false,
    ...over,
  });
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;

  it("is the channel's short ID in the title, and what was deposited, from whom, to whom and its status in the description, with short addresses (C14)", () => {
    const list = paymentChannelMeta(facts(), XRPL);
    expect(title(list)).toBe("Payment channel E22CCE…69EA · XRPL · explorer");
    expect(content(list, "description")).toBe("Payment channel of 1 XRP from rQQQrU…3ZrM to rLggTE…KrtR · open · XRPL");
  });

  it("reads well without a deposit D5 could not read", () => {
    expect(content(paymentChannelMeta(facts({ amount: "" }), XRPL), "description")).toBe("Payment channel from rQQQrU…3ZrM to rLggTE…KrtR · open · XRPL");
  });

  it("has the canonical URL and the sharing tags with no image: a summary card (decision 9)", () => {
    const list = paymentChannelMeta(facts({ status: "closing" }), XRPL);
    expect(link(list, "canonical")).toBe(URL);
    expect(content(list, "og:url")).toBe(URL);
    expect(content(list, "og:title")).toBe("Payment channel E22CCE…69EA · XRPL · explorer");
    expect(content(list, "og:description")).toBe("Payment channel of 1 XRP from rQQQrU…3ZrM to rLggTE…KrtR · closing · XRPL");
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("is Xahau's on Xahau", () => {
    const list = paymentChannelMeta(facts({ amount: "200 DHA" }), XAHAU);
    expect(title(list)).toBe("Payment channel E22CCE…69EA · Xahau · explorer");
    expect(content(list, "description")).toBe("Payment channel of 200 DHA from rQQQrU…3ZrM to rLggTE…KrtR · open · Xahau");
    expect(link(list, "canonical")).toBe(`https://explorer.test/xahau/payment-channels/${ID}`);
  });

  it("is noindex, follow behind a marker, with no canonical URL and nothing to share", () => {
    const list = paymentChannelMeta(facts({ marker: true }), XRPL);
    expect(title(list)).toBe("Payment channel E22CCE…69EA · XRPL · explorer");
    expect(content(list, "robots")).toBe("noindex, follow");
    expect(link(list, "canonical")).toBeUndefined();
    expect(keys(list).filter((key) => key.startsWith("og:") || key.startsWith("twitter:"))).toEqual([]);
  });
});

describe("supplyMeta", () => {
  // What the view builder writes for the tags (`SupplyPageData.description`): the snapshot's own figures.
  const DESCRIPTION = "XRP supply at ledger #107,720,688: 99.99B total, 14.69M burned, 35.21B escrowed, 64.77B circulating.";
  const page = { description: DESCRIPTION };
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;

  it("has the tags of the page: Supply, the network and the product, the snapshot's description, a canonical URL on the origin, Open Graph, a summary card and no image", () => {
    const list = supplyMeta(page, XRPL);
    expect(title(list)).toBe("Supply · XRPL · explorer");
    expect(content(list, "description")).toBe(DESCRIPTION);
    expect(link(list, "canonical")).toBe("https://explorer.test/xrpl/supply");
    expect(content(list, "og:title")).toBe("Supply · XRPL · explorer");
    expect(content(list, "og:description")).toBe(DESCRIPTION);
    expect(content(list, "og:url")).toBe("https://explorer.test/xrpl/supply");
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "og:site_name")).toBe("explorer");
    // No image of its own, and the site has no default one (ruling C14): the plain summary card.
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("twitter:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("is Xahau's on Xahau, and the sandbox's names in the title", () => {
    const list = supplyMeta({ description: "XAH supply at ledger #26,596,843: 613.40M total, 49.43M minted, 2.32K burned, 18.41M escrowed, 595.00M circulating." }, XAHAU);
    expect(title(list)).toBe("Supply · Xahau · explorer");
    expect(link(list, "canonical")).toBe("https://explorer.test/xahau/supply");
    expect(title(supplyMeta(page, XRPL_TESTNET))).toBe("Supply · XRPL Testnet · explorer");
    expect(title(supplyMeta(page, XAHAU_TESTNET))).toBe("Supply · Xahau Testnet · explorer");
  });

  it("is on the request's origin", () => {
    const list = supplyMeta(page, { ...XRPL, origin: "https://explorer.example" });
    expect(link(list, "canonical")).toBe("https://explorer.example/xrpl/supply");
    expect(content(list, "og:url")).toBe("https://explorer.example/xrpl/supply");
  });
});

// ---- E14: the MPT page ----------------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("mptMeta", () => {
  const title = (list: ReadonlyArray<unknown>) => tags(list).find((tag) => "title" in tag)?.title;
  const ID = "0000012AB5F762798A53D543A014CAF8B297CFF8F2F937E8";
  const ISSUER_ADDRESS = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
  const NET = { id: "xrpl", name: "XRPL" } as const;
  const issuance = (over: Record<string, unknown> = {}) => ({
    mpt_issuance_id: ID,
    issuer: ISSUER_ADDRESS,
    sequence: 298,
    ticker: "HTF",
    name: "Harborline Treasury Fund",
    asset_scale: 2,
    maximum_amount: "5000000000",
    outstanding_amount: "1820451120",
    escrowed_amount: "0",
    locked_amount: "0",
    locked_holders: 0,
    holders: 3412,
    transfer_fee: 100,
    flags: { locked: false, can_lock: true, require_auth: false, can_escrow: true, can_trade: false, can_transfer: true, can_clawback: true },
    last_ledger: 107721455,
    destroyed: false,
    ...over,
  });
  const indexed = (over: Record<string, unknown> = {}) => ({ origin: "index", answer: { coverage: { complete: true }, issuance: issuance(over) } }) as unknown as MptSource;
  const fromNode: MptSource = { origin: "node", node: { LedgerEntryType: "MPTokenIssuance", Issuer: ISSUER_ADDRESS, Sequence: 298, Flags: 0x22, AssetScale: 2, OutstandingAmount: "1820451120" }, ledgerIndex: 1, id: ID };
  const SHORT_ISSUER = shortAddress(ISSUER_ADDRESS);

  it("has the tags of an indexed issuance: the ticker and the name in the title, the figures in the description, the canonical URL on the origin, Open Graph and a summary card", () => {
    const list = mptMeta(mptFacts(NET, indexed(), NO_NAMES), XRPL);
    expect(title(list)).toBe("HTF · Harborline Treasury Fund · MPT · XRPL · explorer");
    const description = `MPT issued by ${SHORT_ISSUER}: 18,204,511.20 HTF outstanding, 3,412 holders · XRPL`;
    expect(content(list, "description")).toBe(description);
    expect(link(list, "canonical")).toBe(`https://explorer.test/xrpl/mpt/${ID}`);
    expect(content(list, "og:title")).toBe("HTF · Harborline Treasury Fund · MPT · XRPL · explorer");
    expect(content(list, "og:description")).toBe(description);
    expect(content(list, "og:url")).toBe(`https://explorer.test/xrpl/mpt/${ID}`);
    expect(content(list, "og:type")).toBe("website");
    expect(content(list, "twitter:title")).toBe("HTF · Harborline Treasury Fund · MPT · XRPL · explorer");
    // The link-preview image is Task 14's: until it exists no tag points at it.
    expect(content(list, "twitter:card")).toBe("summary");
    expect(keys(list)).not.toContain("og:image");
    expect(keys(list)).not.toContain("robots");
  });

  it("names the issuer by its display name in the description", () => {
    const named: NamesPart = { state: "ok", map: { [ISSUER_ADDRESS]: { name: { text: "Harborline", kind: "verified" }, labels: [] } satisfies NameView } };
    const list = mptMeta(mptFacts(NET, indexed(), named), XRPL);
    expect(content(list, "description")).toBe("MPT issued by Harborline: 18,204,511.20 HTF outstanding, 3,412 holders · XRPL");
  });

  it("is headed by the ID's start and end where the issuance has no ticker or name", () => {
    const list = mptMeta(mptFacts(NET, indexed({ ticker: undefined, name: undefined }), NO_NAMES), XRPL);
    expect(title(list)).toBe(`MPT 0000012A…${ID.slice(-4)} · XRPL · explorer`);
    expect(content(list, "description")).toContain("units outstanding");
  });

  it("is noindex from the network: title, description and robots, with no canonical URL, Open Graph or card", () => {
    const list = mptMeta(mptFacts(NET, fromNode, NO_NAMES), XRPL);
    expect(title(list)).toBe(`MPT 0000012A…${ID.slice(-4)} · XRPL · explorer`);
    expect(content(list, "robots")).toBe("noindex");
    expect(content(list, "description")).toBe(`MPT issued by ${SHORT_ISSUER}: 18,204,511.20 units outstanding · XRPL`);
    expect(tags(list).some((tag) => tag.tagName === "link")).toBe(false);
    expect(keys(list).sort()).toEqual(["description", "robots"]);
  });

  it("has the sandbox's names, and the origin of the request", () => {
    const facts = mptFacts({ id: "xrpl", name: "XRPL Testnet" }, indexed(), NO_NAMES);
    const list = mptMeta(facts, { ...XRPL_TESTNET, origin: "https://explorer.example" });
    expect(title(list)).toBe("HTF · Harborline Treasury Fund · MPT · XRPL Testnet · explorer");
    expect(content(list, "description")).toMatch(/ · XRPL Testnet$/);
    expect(link(list, "canonical")).toBe(`https://explorer.example/xrpl/mpt/${ID}`);
  });

  it("holds the issuer's text only in the content of a tag: a ticker that closes a quote stays one string", () => {
    const hostile = '"><script>alert(1)</script>';
    const list = mptMeta(mptFacts(NET, indexed({ ticker: undefined, name: hostile }), NO_NAMES), XRPL);
    expect(title(list)).toBe(`${hostile} · MPT · XRPL · explorer`);
    expect(tags(list).every((tag) => Object.values(tag).every((value) => typeof value === "string"))).toBe(true);
  });
});

describe("noMptMeta", () => {
  it("is titled for the network and noindex, with nothing else", () => {
    const data = noMptPage({ id: "xahau", kind: "mainnet", other: "xrpl" }, "0".repeat(48));
    const list = noMptMeta(data, XAHAU);
    expect(tags(list).find((tag) => "title" in tag)?.title).toBe("MPT isn't enabled on Xahau · Xahau · explorer");
    expect(content(list, "robots")).toBe("noindex");
    expect(keys(list)).toEqual(["robots"]);
    const sandbox = noMptMeta(noMptPage({ id: "xahau", kind: "testnet", other: "xrpl" }, "0".repeat(48)), XAHAU_TESTNET);
    expect(tags(sandbox).find((tag) => "title" in tag)?.title).toBe("MPT isn't enabled on Xahau Testnet · Xahau Testnet · explorer");
  });
});
