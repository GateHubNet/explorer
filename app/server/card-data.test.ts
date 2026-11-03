import { describe, expect, it } from "vitest";

import type { FlowStep } from "../domain/describe";
import { shortAddress, shortHash } from "../domain/format";
import { NO_NAMES, type NamesPart, type NameView } from "../domain/names";
import { AMM_POOL, ammLiquiditySample, ammPoolSample } from "../../test/support/amm-samples";
import { AMM_ID, amendmentDetailSample, SAMPLE_KEYS, UNKNOWN_ID, validatorDetailSample, XCB_ID } from "../../test/support/d1-samples";
import { MPT_SAMPLE_ID, MPT_SAMPLE_ISSUER, mptIssuanceSample, mptSample } from "../../test/support/mpt-samples";
import { TOKEN_SAMPLE_ISSUER, tokenDetailSample } from "../../test/support/token-samples";
import { ammPoolFacts, type AmmPoolFacts } from "./amm-view";
import { mptFacts, type MptSource } from "./mpt-view";
import { type NftFacts } from "./nft-view";
import { tokenFacts, type TokenMetaFacts } from "./token-view";
import type { AmendmentDetail, ValidatorDetail } from "./api-types";
import { accountCard, amendmentCard, formatCardTime, ledgerCard, mptCard, nftCard, nftCardFacts, poolCard, tokenCard, transactionCard, transactionFacts, validatorCard, type NftCardFacts } from "./card-data";

// What the link-preview image says (spec 9, the LinkPreview board): the words and numbers of the card for a transaction, a ledger and an
// account, from the same facts the page's tags are built from. The layout is app/og/card.test.ts; the PNG is test/worker/og.spec.ts.

const XRPL = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX" } as const;
const XAHAU = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX" } as const;
const XRPL_TESTNET = { id: "xrpl", kind: "testnet", name: "XRPL Testnet", label: "XRPL Testnet", longName: "XRPL Testnet", dexName: "the XRPL Testnet DEX" } as const;
const XAHAU_TESTNET = { id: "xahau", kind: "testnet", name: "Xahau Testnet", label: "Xahau Testnet", longName: "Xahau Testnet", dexName: "the Xahau Testnet DEX" } as const;

const SENDER = "rJF2XaTeEvbk3EsoyVnrdeXVcbkXFQvg";
const RECEIVER = "rNYbL8Zz3Nzu5Fr9Q1Wwf1zQ5pQbwUKq5";
const HASH = "67F91E0000000000000000000000000000000000000000000000000000007C31";

const flow: FlowStep[] = [
  { role: "sender", account: SENDER, label: "Sender", amount: { value: "1250.00", currency: "USD" } },
  { role: "destination", account: RECEIVER, label: "Destination", amount: { value: "1250.00", currency: "USD" } },
];

const tx = (over: Record<string, unknown> = {}) => ({
  hash: HASH,
  ledgerIndex: 107695660,
  closeTime: 1792251720,
  title: "Payment",
  ok: true,
  account: SENDER,
  summary: "rJF2Xa…FQvg sent 1,250.00 USD to rNYbL8…UKq5.",
  flow: flow as FlowStep[] | null,
  ...over,
});

describe("formatCardTime", () => {
  it("is the day, month, year and minute in UTC", () => {
    expect(formatCardTime(1792251720)).toBe("17 Oct 2026, 15:42 UTC");
    expect(formatCardTime(1752604243)).toBe("15 Jul 2025, 18:30 UTC");
    expect(formatCardTime(0)).toBe("1 Jan 1970, 00:00 UTC");
  });
});

describe("transactionCard", () => {
  it("is the board: the type and its result, the amount, who to whom, the ledger and the time, the hash", () => {
    expect(transactionCard(tx(), XRPL)).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "Payment",
      status: "success",
      headline: { text: "1,250.00 USD", mono: true },
      parties: ["rJF2Xa…FQvg", "rNYbL8…UKq5"],
      footer: [{ text: "Ledger " }, { text: "#107,695,660", mono: true }, { text: " · 17 Oct 2026, 15:42 UTC" }],
      footerEnd: "67F91E…7C31",
    });
  });

  it("is a Xahau card for a Xahau transaction", () => {
    const card = transactionCard(tx(), XAHAU);
    expect(card.network).toBe("xahau");
    expect(card.networkLabel).toBe("Xahau mainnet");
  });

  it("marks a transaction that failed, and still shows the amount it tried to move", () => {
    const failed = transactionCard(tx({ ok: false, flow: null, amount: { value: "5", currency: "XRP" }, destination: RECEIVER }), XRPL);
    expect(failed.status).toBe("failed");
    expect(failed.headline).toEqual({ text: "5 XRP", mono: true });
    expect(failed.parties).toEqual(["rJF2Xa…FQvg", "rNYbL8…UKq5"]);
  });

  it("takes the amount the page lists first (what a payment delivered) over the ends of the flow", () => {
    const card = transactionCard(tx({ amount: { value: "7", currency: "EUR" } }), XRPL);
    expect(card.headline).toEqual({ text: "7 EUR", mono: true });
  });

  it("writes an MPT's amount as units of the issuance, which the card does not look up", () => {
    const amount = { mpt: "0000012AB5F762798A53D543A014CAF8B297CFF8F2F937E8", issuer: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", units: "2500000" };
    expect(transactionCard(tx({ amount }), XRPL).headline).toEqual({ text: "2,500,000 units of MPT 0000012A…", mono: true });
    const moved: FlowStep[] = [
      { role: "sender", account: SENDER, label: "Sender", amount },
      { role: "destination", account: RECEIVER, label: "Destination", amount },
    ];
    expect(transactionCard(tx({ flow: moved }), XRPL).headline).toEqual({ text: "2,500,000 units of MPT 0000012A…", mono: true });
  });

  it("writes a currency code as the page does", () => {
    const card = transactionCard(tx({ flow: null, amount: { value: "5", currency: "534F4C4F00000000000000000000000000000000" } }), XRPL);
    expect(card.headline.text).toBe("5 SOLO");
  });

  it("says the sentence when the transaction has no amount, which names the accounts, so there is no row of them", () => {
    const card = transactionCard(tx({ title: "Trust line", flow: null, summary: "rJF2Xa…FQvg set a trust line for USD with rIssue…xyz1." }), XRPL);
    expect(card.headline).toEqual({ text: "rJF2Xa…FQvg set a trust line for USD with rIssue…xyz1", mono: false });
    expect(card.parties).toBeUndefined();
    expect(card.kind).toBe("Trust line");
  });

  it("cuts a very long sentence", () => {
    const card = transactionCard(tx({ flow: null, summary: `${"word ".repeat(80)}end.` }), XRPL);
    expect(card.headline.mono).toBe(false);
    expect(Array.from(card.headline.text).length).toBeLessThanOrEqual(100);
    expect(card.headline.text.endsWith("…")).toBe(true);
  });

  it("holds no age and nothing of the visitor", () => {
    const text = JSON.stringify(transactionCard(tx(), XRPL));
    expect(text).not.toMatch(/ago|just now/);
  });
});

const ledger = (over: Record<string, unknown> = {}) => ({
  header: { index: 107720688, hash: "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02", closeTime: 1792251720 },
  txCount: 66,
  succeeded: 64,
  ...over,
});

describe("ledgerCard", () => {
  it("shows the index, how many transactions and how many failed, when it closed and its hash", () => {
    expect(ledgerCard(ledger(), XRPL)).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "Ledger",
      headline: { text: "#107,720,688", mono: true },
      note: "66 transactions · 2 failed",
      footer: [{ text: "Closed " }, { text: "17 Oct 2026, 15:42 UTC" }],
      footerEnd: "11EF78…BC02",
    });
  });

  it("counts in the singular and says when nothing failed or happened", () => {
    expect(ledgerCard(ledger({ txCount: 1, succeeded: 1 }), XRPL).note).toBe("1 transaction");
    expect(ledgerCard(ledger({ txCount: 66, succeeded: 66 }), XRPL).note).toBe("66 transactions");
    expect(ledgerCard(ledger({ txCount: 0, succeeded: 0 }), XRPL).note).toBe("No transactions");
  });
});

const account = (over: Record<string, unknown> = {}) => ({
  address: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh",
  native: "XRP" as const,
  activatedAt: 1752604243 as number | null,
  balance: "10.001625" as string | null,
  ...over,
});

describe("accountCard", () => {
  it("shows the whole address, when it was activated and its balance", () => {
    expect(accountCard(account(), XRPL)).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "Account",
      headline: { text: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", mono: true },
      note: "Activated 15 Jul 2025",
      footer: [{ text: "Balance " }, { text: "10.001625 XRP", mono: true }],
    });
  });

  it("leaves out what is not known", () => {
    const card = accountCard(account({ activatedAt: null, balance: null }), XAHAU);
    expect(card.note).toBeUndefined();
    expect(card.footer).toEqual([{ text: "Account on Xahau" }]);
    expect(card.network).toBe("xahau");
  });

  it("writes the balance as the page does", () => {
    expect(accountCard(account({ balance: "1234567.5", native: "XAH" }), XAHAU).footer).toEqual([{ text: "Balance " }, { text: "1,234,567.5 XAH", mono: true }]);
  });

  describe("for an account that has a name or a label (display names spec 7)", () => {
    const ADDRESS = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
    const NORTHPEAK: NameView = { name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example", labels: [] };
    const HARBORLINE: NameView = { name: { text: "Harborline Exchange", kind: "account" }, network: "hot wallet", labels: [] };
    const LOWTIDE: NameView = { name: { text: "lowtide.example", kind: "domain" }, domain: "lowtide.example", labels: [] };

    it("has the plain name for a headline, in the text font, and the whole address under it", () => {
      const card = accountCard(account({ name: NORTHPEAK }), XRPL);
      expect(card.headline).toEqual({ text: "Northpeak Treasury", mono: false });
      expect(card.parties).toEqual([ADDRESS]);
      expect(card.note).toBe("Verified by northpeak.example · Activated 15 Jul 2025");
      expect(card.footer).toEqual([{ text: "Balance " }, { text: "10.001625 XRP", mono: true }]);
      // What is not about the name is as it was.
      expect(card).toEqual({ ...accountCard(account(), XRPL), headline: card.headline, parties: [ADDRESS], note: card.note });
    });

    it("says a name GateHub gave as a link reads it, with the account network name", () => {
      const card = accountCard(account({ name: HARBORLINE }), XRPL);
      expect(card.headline).toEqual({ text: "Harborline Exchange · hot wallet", mono: false });
      expect(card.parties).toEqual([ADDRESS]);
      expect(card.note).toBe("Named by GateHub · Activated 15 Jul 2025");
    });

    it("says the parts of the note in the order the board has them: the warning, how the name is known, the activation", () => {
      const card = accountCard(account({ name: { ...NORTHPEAK, labels: ["scam", "spam"] } }), XRPL);
      expect(card.note).toBe("Warning: labelled scam and spam by GateHub · Verified by northpeak.example · Activated 15 Jul 2025");
      expect(accountCard(account({ name: { ...HARBORLINE, labels: ["advisory"] } }), XRPL).note).toBe(
        "Warning: labelled advisory by GateHub · Named by GateHub · Activated 15 Jul 2025",
      );
    });

    it("keeps the address for a headline when the account is labelled, and warns in the note", () => {
      const card = accountCard(account({ name: { ...HARBORLINE, labels: ["advisory"] } }), XRPL);
      expect(card.headline).toEqual({ text: ADDRESS, mono: true });
      expect(card.parties).toBeUndefined();
      const labelsOnly = accountCard(account({ name: { labels: ["scam", "spam", "advisory"] } }), XRPL);
      expect(labelsOnly.headline).toEqual({ text: ADDRESS, mono: true });
      expect(labelsOnly.parties).toBeUndefined();
      expect(labelsOnly.note).toBe("Warning: labelled scam, spam and advisory by GateHub · Activated 15 Jul 2025");
    });

    it("says only the parts that apply: no activation, no warning, no claim of a name nothing vouches for", () => {
      expect(accountCard(account({ name: NORTHPEAK, activatedAt: null }), XRPL).note).toBe("Verified by northpeak.example");
      expect(accountCard(account({ name: { labels: ["scam"] }, activatedAt: null }), XRPL).note).toBe("Warning: labelled scam by GateHub");
    });

    it("is today's card for a name only the account's domain gives, a network name alone, no name, and a view that is not there", () => {
      const today = accountCard(account(), XRPL);
      expect(accountCard(account({ name: LOWTIDE }), XRPL)).toEqual(today);
      expect(accountCard(account({ name: { network: "cold", labels: [] } }), XRPL)).toEqual(today);
      expect(accountCard(account({ name: undefined }), XRPL)).toEqual(today);
      expect(today.headline).toEqual({ text: ADDRESS, mono: true });
      expect(today.parties).toBeUndefined();
    });
  });
});

describe("transactionFacts", () => {
  const payment = (over: Record<string, unknown> = {}) => ({
    origin: "index" as const,
    hash: HASH,
    ledgerIndex: 107695660,
    closeTime: 1792251720,
    tx: { TransactionType: "Payment", Account: SENDER, Destination: RECEIVER, Amount: "1250000000", Fee: "12", Sequence: 7, ...over },
    meta: { TransactionIndex: 0, TransactionResult: "tesSUCCESS", AffectedNodes: [], delivered_amount: "1250000000" },
  });

  it("is what describe makes of a payment: the page's title, sentence and flow, and its headline amount", () => {
    const facts = transactionFacts(payment() as never, "XRP");
    expect(facts).toMatchObject({
      hash: HASH,
      ledgerIndex: 107695660,
      closeTime: 1792251720,
      title: "Payment",
      ok: true,
      account: SENDER,
      destination: RECEIVER,
      amount: { value: "1250", currency: "XRP" },
    });
    expect(facts.summary).toBe("rJF2Xa…FQvg sent 1,250 XRP to rNYbL8…UKq5.");
    expect(facts.flow?.map((step) => step.role)).toEqual(["sender", "destination"]);
    expect(transactionCard(facts, XRPL).headline).toEqual({ text: "1,250 XRP", mono: true });
  });

  it("keeps the amount of a payment that failed, and has no flow", () => {
    const failed = payment() as { meta: { TransactionResult: string; delivered_amount?: string } };
    failed.meta = { ...failed.meta, TransactionResult: "tecPATH_DRY" };
    delete failed.meta.delivered_amount;
    const facts = transactionFacts(failed as never, "XRP");
    expect(facts.ok).toBe(false);
    expect(facts.flow).toBeNull();
    expect(facts.amount).toEqual({ value: "1250", currency: "XRP" });
    const card = transactionCard(facts, XRPL);
    expect(card.status).toBe("failed");
    expect(card.headline).toEqual({ text: "1,250 XRP", mono: true });
    expect(card.parties).toEqual(["rJF2Xa…FQvg", "rNYbL8…UKq5"]);
  });

  it("has no amount and no destination for a transaction that names neither", () => {
    const facts = transactionFacts(payment({ TransactionType: "AccountSet", Destination: undefined, Amount: undefined }) as never, "XRP");
    expect(facts.amount).toBeUndefined();
    expect(facts.destination).toBeUndefined();
    expect(facts.flow).toBeNull();
  });
});

// ---- A validator and an amendment (validators spec 8, "Images") ------------------------------------------------------------------------------

const RIPPLED = { ...XRPL, software: "rippled" } as const;
const XAHAUD = { ...XAHAU, software: "xahaud" } as const;

/** D's answer for a validator without the keys named: the sample has them all, a validator that has not been seen or has no domain lacks them. */
function validator(over: Partial<ValidatorDetail> = {}, without: readonly (keyof ValidatorDetail)[] = []): ValidatorDetail {
  const detail = validatorDetailSample(over);
  for (const key of without) delete detail[key];
  return detail;
}

describe("validatorCard", () => {
  const MASTER = SAMPLE_KEYS[0];

  it("is the board: the domain, the master key, and what is known of it, in the network's footer", () => {
    expect(validatorCard(validator(), RIPPLED)).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "Validator",
      headline: { text: "northpeak.example", mono: false },
      parties: [MASTER],
      note: "On the default UNL · domain verified · rippled 3.4.1",
      footer: [{ text: "XRPL" }],
    });
  });

  it("is the short key in mono for a validator with no domain, and has only the parts that apply", () => {
    const card = validatorCard(validator({ unl: false }, ["domain", "domain_verification"]), RIPPLED);
    expect(card.headline).toEqual({ text: shortHash(MASTER), mono: true });
    expect(card.parties).toEqual([MASTER]);
    expect(card.note).toBe("rippled 3.4.1");
  });

  it("takes an empty domain for none", () => {
    const card = validatorCard(validator({ domain: "" }, ["domain_verification"]), RIPPLED);
    expect(card.headline).toEqual({ text: shortHash(MASTER), mono: true });
  });

  it.each(["unverified", "pending"] as const)("does not say the domain is verified when it is %s", (status) => {
    const base = validatorDetailSample();
    const card = validatorCard(validator({ domain_verification: { ...base.domain_verification!, status } }), RIPPLED);
    expect(card.headline).toEqual({ text: "northpeak.example", mono: false });
    expect(card.note).toBe("On the default UNL · rippled 3.4.1");
  });

  it("does not say the domain is verified when D sent no check of it", () => {
    expect(validatorCard(validator({}, ["domain_verification"]), RIPPLED).note).toBe("On the default UNL · rippled 3.4.1");
  });

  it("has no note for a validator that is off the UNL, has no verified domain and reported no version", () => {
    const card = validatorCard(validator({ unl: false }, ["domain", "domain_verification", "version", "version_build", "version_latest"]), RIPPLED);
    expect(card.note).toBeUndefined();
    expect("note" in card).toBe(false);
    expect(card.footer).toEqual([{ text: "XRPL" }]);
  });

  it("names the software of the network, and leaves the build number to the page", () => {
    const card = validatorCard(validator({ version: "2025.10.3", version_build: 4119 }), XAHAUD);
    expect(card.network).toBe("xahau");
    expect(card.networkLabel).toBe("Xahau mainnet");
    expect(card.note).toBe("On the default UNL · domain verified · xahaud 2025.10.3");
    expect(card.footer).toEqual([{ text: "Xahau" }]);
  });

  it("takes a version that is empty for none", () => {
    expect(validatorCard(validator({ version: "" }), RIPPLED).note).toBe("On the default UNL · domain verified");
  });
});

/** D's answer for an amendment: the sample is XChainBridge with a majority, so what a case lacks is named. */
function amendment(over: Partial<AmendmentDetail>, without: readonly (keyof AmendmentDetail)[] = []): AmendmentDetail {
  const detail = amendmentDetailSample(over);
  for (const key of without) delete detail[key];
  return detail;
}

/** AMM as the list has it: enabled from the ledger. */
const enabledAmm = (over: Partial<AmendmentDetail> = {}, without: readonly (keyof AmendmentDetail)[] = []) =>
  amendment(
    {
      id: AMM_ID,
      name: "AMM",
      status: "enabled",
      introduced: "1.12.0",
      xls: "XLS-30",
      xls_url: "https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0030-automated-market-maker",
      enabled: { ledger_index: 107747841, date: "2026-10-19T15:31:24Z", tx_hash: "F".repeat(64), source: "ledger" },
      ...over,
    },
    ["votes", "majority", ...without],
  );

describe("amendmentCard", () => {
  it("is the board for an enabled amendment: its name in mono, the day it was enabled, its XLS and the software that introduced it, the short ID", () => {
    expect(amendmentCard(enabledAmm(), RIPPLED)).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "Amendment",
      headline: { text: "AMM", mono: true },
      note: "Enabled on Oct 19, 2026",
      footer: [{ text: "XLS-30 · introduced in rippled 1.12.0" }],
      footerEnd: shortHash(AMM_ID),
    });
  });

  it("says the day an amendment enabled from the metadata file was enabled, and only that it is enabled when the file has no day", () => {
    expect(amendmentCard(enabledAmm({ enabled: { source: "metadata", date: "2025-02-03" } }), RIPPLED).note).toBe("Enabled on Feb 3, 2025");
    expect(amendmentCard(enabledAmm({ enabled: { source: "metadata" } }), RIPPLED).note).toBe("Enabled");
  });

  it("reads a retired amendment that D1 serves an enabling for as an enabled one, and one that it does not as always on", () => {
    expect(amendmentCard(enabledAmm({ retired: true }), RIPPLED).note).toBe("Enabled on Oct 19, 2026");
    expect(amendmentCard(enabledAmm({ retired: true }, ["enabled"]), XAHAUD).note).toBe("Always on");
    // Without a retired mark an enabled amendment that has no enabling is enabled, and no more is said.
    expect(amendmentCard(enabledAmm({}, ["enabled"]), RIPPLED).note).toBe("Enabled");
  });

  it("says since when a majority holds, and when it activates", () => {
    const card = amendmentCard(amendment({}), RIPPLED);
    expect(card.headline).toEqual({ text: "XChainBridge", mono: true });
    expect(card.note).toBe("Majority since Oct 17, 2026 · activates on or soon after Oct 31, 2026");
    expect(card.footer).toEqual([{ text: "XLS-38 · introduced in rippled 3.4.1" }]);
    expect(card.footerEnd).toBe(shortHash(XCB_ID));
  });

  it("says only that there is a majority when D1 sent no majority", () => {
    expect(amendmentCard(amendment({}, ["majority"]), RIPPLED).note).toBe("Majority");
  });

  it("says how many of the UNL validators vote yes for an amendment still being voted on", () => {
    const voting = amendment({ status: "voting", votes: { ledger_index: 107748095, yes: 4, trusted: 35, needed: 29, pct: 11.43 } }, ["majority"]);
    expect(amendmentCard(voting, RIPPLED).note).toBe("Voting · 4 of 35 UNL validators vote yes");
    // The counts have separators, as the pages write them.
    const many = amendment({ status: "voting", votes: { ledger_index: 1, yes: 1200, trusted: 1500, needed: 1201, pct: 80 } }, ["majority"]);
    expect(amendmentCard(many, RIPPLED).note).toBe("Voting · 1,200 of 1,500 UNL validators vote yes");
    expect(amendmentCard(amendment({ status: "voting" }, ["majority", "votes"]), RIPPLED).note).toBe("Voting");
  });

  it("is obsolete for an amendment that current software can no longer vote in", () => {
    expect(amendmentCard(amendment({ status: "obsolete" }, ["majority", "votes"]), RIPPLED).note).toBe("Obsolete");
  });

  it("is the short ID in mono for an amendment nobody has named, which is unknown", () => {
    const card = amendmentCard(amendment({ id: UNKNOWN_ID, status: "unknown" }, ["name", "majority", "votes", "xls", "xls_url", "introduced"]), RIPPLED);
    expect(card.headline).toEqual({ text: shortHash(UNKNOWN_ID), mono: true });
    expect(card.note).toBe("Unknown amendment");
    expect(card.footer).toEqual([{ text: "XRPL" }]);
    expect(card.footerEnd).toBe(shortHash(UNKNOWN_ID));
  });

  it("names the parts of the footer that apply, and the network when none does", () => {
    expect(amendmentCard(enabledAmm({}, ["xls", "xls_url"]), RIPPLED).footer).toEqual([{ text: "introduced in rippled 1.12.0" }]);
    expect(amendmentCard(enabledAmm({}, ["introduced"]), RIPPLED).footer).toEqual([{ text: "XLS-30" }]);
    expect(amendmentCard(enabledAmm({}, ["xls", "xls_url", "introduced"]), RIPPLED).footer).toEqual([{ text: "XRPL" }]);
    // An empty text is no text.
    expect(amendmentCard(enabledAmm({ xls: "", introduced: "" }), RIPPLED).footer).toEqual([{ text: "XRPL" }]);
  });

  it("names Xahau's software and writes its versions as xahaud does", () => {
    const card = amendmentCard(enabledAmm({ introduced: "2024.2.1" }, ["xls", "xls_url"]), XAHAUD);
    expect(card.network).toBe("xahau");
    expect(card.networkLabel).toBe("Xahau mainnet");
    expect(card.footer).toEqual([{ text: "introduced in xahaud 2024.2.1" }]);
  });
});

// ---- An AMM pool (AMM spec 5.2) --------------------------------------------------------------------------------------------------------------

/** What the page's tags are made of (`ammPoolFacts`): the card is made of the same facts, so a link's text and its picture agree. */
const poolFacts = (over: Partial<AmmPoolFacts> = {}): AmmPoolFacts => ({
  pool: AMM_POOL,
  net: "xrpl",
  native: "XRP",
  pair: "XRP/RLUSD",
  text: "XRP / RLUSD",
  deleted: false,
  fee: "0.300%",
  value: "3.61M",
  created: { date: "2024-03-22", at: Date.UTC(2024, 2, 22, 9, 30) / 1000 },
  ...over,
});

describe("poolCard", () => {
  it("is the board: the pair in the text font, the pool's whole account, its value and trading fee, the day it was created", () => {
    expect(poolCard(poolFacts(), XRPL)).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "AMM pool",
      headline: { text: "XRP / RLUSD", mono: false },
      parties: [AMM_POOL],
      note: "Value 3.61M XRP · trading fee 0.300%",
      footer: [{ text: "Created 22 Mar 2024" }],
    });
  });

  it("says only the part of the note that is known, and has no note when none is", () => {
    expect(poolCard(poolFacts({ value: undefined }), XRPL).note).toBe("Trading fee 0.300%");
    expect(poolCard(poolFacts({ fee: undefined }), XRPL).note).toBe("Value 3.61M XRP");
    const bare = poolCard(poolFacts({ fee: undefined, value: undefined }), XRPL);
    expect(bare.note).toBeUndefined();
    expect("note" in bare).toBe(false);
  });

  it("says that a deleted pool is deleted, and nothing of a value or a fee it no longer has", () => {
    const card = poolCard(poolFacts({ deleted: true, value: undefined }), XRPL);
    expect(card.note).toBe("Deleted pool");
    expect(card.headline).toEqual({ text: "XRP / RLUSD", mono: false });
    expect(card.parties).toEqual([AMM_POOL]);
    expect(poolCard(poolFacts({ deleted: true, value: undefined, fee: undefined }), XRPL).note).toBe("Deleted pool");
  });

  it("names the network where the creation is not known", () => {
    expect(poolCard(poolFacts({ created: undefined }), XRPL).footer).toEqual([{ text: "AMM pool on XRPL" }]);
    const { created: _created, ...without } = poolFacts();
    expect(poolCard(without, XRPL).footer).toEqual([{ text: "AMM pool on XRPL" }]);
  });

  it("is a Xahau card in Xahau's words, with its native currency", () => {
    const card = poolCard(poolFacts({ net: "xahau", native: "XAH", created: undefined }), XAHAU);
    expect(card.network).toBe("xahau");
    expect(card.networkLabel).toBe("Xahau mainnet");
    expect(card.note).toBe("Value 3.61M XAH · trading fee 0.300%");
    expect(card.footer).toEqual([{ text: "AMM pool on Xahau" }]);
  });

  it("heads the card with the facts' text, whatever the codes are (a code with no text is its first eight digits)", () => {
    expect(poolCard(poolFacts({ pair: "USDC/RLUSD", text: "USDC / RLUSD" }), XRPL).headline).toEqual({ text: "USDC / RLUSD", mono: false });
    expect(poolCard(poolFacts({ pair: "564F58F0…/XRP", text: "564F58F0… / XRP" }), XRPL).headline).toEqual({ text: "564F58F0… / XRP", mono: false });
  });

  it("keeps a \"/\" of a code's own text: the headline is the display pair as the page writes it, not the slug split again", () => {
    // "USD/EUR" in 40 hex digits (55 53 44 2F 45 55 52, then zeros): a code that is not 3 characters, whose text formatCurrency decodes, slash included.
    const slashed = "5553442F455552".padEnd(40, "0");
    const facts = ammPoolFacts({ id: "xrpl", native: "XRP" }, AMM_POOL, ammPoolSample({ base_currency: slashed }), null, null);
    expect([facts.pair, facts.text]).toEqual(["USD/EUR/XRP", "USD/EUR / XRP"]);
    // The slug split again at each "/" would be "USD / EUR / XRP".
    expect(poolCard(facts, XRPL).headline).toEqual({ text: "USD/EUR / XRP", mono: false });
  });

  it("is made of the page's own facts: the day, the value and the fee are the ones the tags say, and none is written as a float or with an exponent", () => {
    const net = { id: "xrpl", native: "XRP" } as const;
    const create = ammLiquiditySample({ event: "create", executed_time: "2024-03-22T09:30:00Z" });
    const cases = [
      ["123456789012345678901234567890.5", "Value 123,000,000,000,000,000T XRP · trading fee 0.205%"],
      ["0.00000000012", "Value 0.00000000012 XRP · trading fee 0.205%"],
      ["1250.5", "Value 1,250.5 XRP · trading fee 0.205%"],
    ] as const;
    for (const [value, note] of cases) {
      const card = poolCard(ammPoolFacts(net, AMM_POOL, ammPoolSample({ value_native: value, trading_fee: 205 }), null, create), XRPL);
      expect(card.note, value).toBe(note);
      expect(card.footer, value).toEqual([{ text: "Created 22 Mar 2024" }]);
      expect(JSON.stringify(card), value).not.toMatch(/\d[eE][+-]?\d/);
    }
  });
});

// ---- An NFT -----------------------------------------------------------------------------------------------------------------------------------

describe("nftCard", () => {
  const OWNER = "rHciXfRHv3jNfNAFsiHMrHpUmoLrPAJrHC";
  const nftFacts = (over: Partial<NftCardFacts> = {}): NftCardFacts => ({
    kind: "nftoken",
    headline: "#4,127",
    collection: "rLULtF…mB3R · taxon 1",
    owner: OWNER,
    note: "Last sale 1,250 XRP",
    footer: "Minted 14 Mar 2024",
    ...over,
  });

  it("is the board: the kind, the number, the owner, the last sale, the day of the mint, the collection", () => {
    expect(nftCard(nftFacts(), XRPL)).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "NFT",
      headline: { text: "#4,127", mono: true },
      parties: [OWNER],
      note: "Last sale 1,250 XRP",
      footer: [{ text: "Minted 14 Mar 2024" }],
      footerEnd: "rLULtF…mB3R · taxon 1",
    });
  });

  it("is a URIToken on Xahau, headed by its short id", () => {
    const card = nftCard(nftFacts({ kind: "uritoken", headline: "A1F04C77…3D10", collection: "rodinG…zKyb" }), XAHAU);
    expect(card).toMatchObject({ network: "xahau", networkLabel: "Xahau mainnet", kind: "URIToken", headline: { text: "A1F04C77…3D10", mono: true }, footerEnd: "rodinG…zKyb" });
  });

  it("has no owner under the headline when there is none (a burned NFT), and names the network where the day of the mint is not known", () => {
    const card = nftCard(nftFacts({ owner: undefined, note: "Burned", footer: undefined }), XRPL);
    expect("parties" in card).toBe(false);
    expect(card.note).toBe("Burned");
    expect(card.footer).toEqual([{ text: "NFT on XRPL" }]);
    expect(nftCard(nftFacts({ kind: "uritoken", footer: undefined }), XAHAU_TESTNET).footer).toEqual([{ text: "URIToken on Xahau Testnet" }]);
  });
});

describe("nftCardFacts", () => {
  const OWNER = "rHciXfRHv3jNfNAFsiHMrHpUmoLrPAJrHC";
  const facts = (over: Partial<NftFacts> = {}): NftFacts => ({
    kind: "nftoken",
    name: "NFT #4,127",
    headline: "#4,127",
    burned: false,
    collection: "rLULtF…mB3R · taxon 1",
    owner: OWNER,
    lastSale: "1,250 XRP",
    minted: Date.UTC(2024, 2, 14, 9) / 1000,
    ...over,
  });

  it("says Last sale and the price, and Minted and the day, in the card's own date form", () => {
    expect(nftCardFacts(facts())).toEqual({ kind: "nftoken", headline: "#4,127", collection: "rLULtF…mB3R · taxon 1", owner: OWNER, note: "Last sale 1,250 XRP", footer: "Minted 14 Mar 2024" });
  });

  it("says Burned for a burned NFT, whatever it sold for, and has no owner to show", () => {
    const burned = nftCardFacts(facts({ burned: true, owner: undefined }));
    expect(burned.note).toBe("Burned");
    expect("owner" in burned).toBe(false);
  });

  it("says how often an NFT without a price was sold, with a capital", () => {
    expect(nftCardFacts(facts({ lastSale: undefined, sold: "never sold" })).note).toBe("Never sold");
    expect(nftCardFacts(facts({ lastSale: undefined, sold: "sold 3 times" })).note).toBe("Sold 3 times");
  });

  it("says that an NFT shown from the network is not in the index yet, and has no mint to tell", () => {
    const fromNetwork = nftCardFacts(facts({ lastSale: undefined, minted: undefined }));
    expect(fromNetwork.note).toBe("Not in the index yet");
    expect("footer" in fromNetwork).toBe(false);
  });

  it("is the same card from the page's facts as from the words", () => {
    expect(nftCard(nftCardFacts(facts()), XRPL).note).toBe("Last sale 1,250 XRP");
  });
});

// ---- A token ---------------------------------------------------------------------------------------------------------------------------

describe("tokenCard", () => {
  /** What the page's tags are made of (`tokenFacts`): RLUSD with its toml's name, listed by ripple.com, 120 holders and a supply of 7,320. */
  const facts = (over: Partial<TokenMetaFacts> = {}): TokenMetaFacts => ({ ...tokenFacts({ id: "xrpl" }, tokenDetailSample(), false), ...over });
  /** The same token as an index that has no toml for it says it: no name, and no domain that lists it. */
  const unlisted = (): TokenMetaFacts => tokenFacts({ id: "xrpl" }, tokenDetailSample({ toml: undefined, listed: false }), false);

  it("is the board of a listed token: the kind, the toml's name in the text font, the issuer's whole account, the holders and the supply, the domain that lists it", () => {
    expect(tokenCard(facts(), XRPL)).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "Issued token",
      headline: { text: "Ripple USD", mono: false },
      parties: [TOKEN_SAMPLE_ISSUER],
      note: "120 holders · supply 7,320 RLUSD",
      footer: [{ text: "Listed in ripple.com's toml" }],
    });
  });

  it("is headed by the code in mono when there is no name, and names the network where no toml lists the token", () => {
    const card = tokenCard(unlisted(), XRPL);
    expect(card.headline).toEqual({ text: "RLUSD", mono: true });
    expect(card.footer).toEqual([{ text: "Issued token on XRPL" }]);
    expect(card.parties).toEqual([TOKEN_SAMPLE_ISSUER]);
    expect(card.note).toBe("120 holders · supply 7,320 RLUSD");
  });

  it("names the network, not the domain, for a token with a domain that its toml does not list", () => {
    // The facts say `listedBy` only for a token the issuer's toml lists; an issuer's domain alone is not that.
    const withDomain = tokenFacts({ id: "xrpl" }, tokenDetailSample({ listed: false }), false);
    expect(withDomain.listedBy).toBeUndefined();
    expect(tokenCard(withDomain, XRPL).footer).toEqual([{ text: "Issued token on XRPL" }]);
    // And a name without a listing (a toml that names the token but is not listed) still heads the card.
    expect(tokenCard(withDomain, XRPL).headline).toEqual({ text: "Ripple USD", mono: false });
  });

  it("says holder, not holders, of a token with one, groups the thousands as the page does, and reads the supply as a compact figure", () => {
    expect(tokenCard(facts({ holders: "1" }), XRPL).note).toBe("1 holder · supply 7,320 RLUSD");
    expect(tokenCard(facts({ holders: "0" }), XRPL).note).toBe("0 holders · supply 7,320 RLUSD");
    expect(tokenCard(facts({ holders: "12,345", supply: "21.9M", code: "EUR" }), XRPL).note).toBe("12,345 holders · supply 21.9M EUR");
  });

  it("is the card of a code that decodes to no text: the first eight digits and an ellipsis, as the page says it", () => {
    const odd = tokenFacts({ id: "xrpl" }, tokenDetailSample({ currency: "ABCDEF0123456789ABCDEF0123456789ABCDEF01", code: "ABCDEF01…", toml: undefined, listed: false }), false);
    expect(tokenCard(odd, XRPL).headline).toEqual({ text: "ABCDEF01…", mono: true });
    expect(tokenCard(odd, XRPL).note).toContain("supply 7,320 ABCDEF01…");
  });

  it("is Xahau's: its accent, its label and its name where the footer names the network", () => {
    const card = tokenCard(tokenFacts({ id: "xahau" }, tokenDetailSample({ toml: undefined, listed: false }), false), XAHAU);
    expect(card.network).toBe("xahau");
    expect(card.networkLabel).toBe("Xahau mainnet");
    expect(card.footer).toEqual([{ text: "Issued token on Xahau" }]);
    expect(tokenCard(unlisted(), XAHAU_TESTNET).footer).toEqual([{ text: "Issued token on Xahau Testnet" }]);
  });

  it("cuts a domain that runs on (the issuer writes it) so that the footer stays on the card, and leaves a reasonable one whole", () => {
    const long = `${"a".repeat(80)}.example`;
    const card = tokenCard(facts({ listedBy: long }), XRPL);
    expect(card.footer).toHaveLength(1);
    const text = card.footer[0]!.text;
    expect(text).toBe(`Listed in ${"a".repeat(49)}…'s toml`);
    expect(Array.from(text).length).toBeLessThanOrEqual(70);
    expect(tokenCard(facts({ listedBy: "a".repeat(50) }), XRPL).footer[0]!.text).toBe(`Listed in ${"a".repeat(50)}'s toml`);
  });

  it("cuts a note that runs on (a supply near 1e96, which `compactNumber` has no unit for) to one line of the card, so that the footer stays in place, and leaves one that fits whole (final review M4)", () => {
    const huge = tokenFacts({ id: "xrpl" }, tokenDetailSample({ supply: `1${"0".repeat(95)}` }), false);
    expect(huge.supply.length, "the facts' supply is long, as the review's case").toBeGreaterThan(60);
    const note = tokenCard(huge, XRPL).note!;
    expect(Array.from(note)).toHaveLength(46);
    expect(note).toMatch(/^120 holders · supply 1\S*…$/);
    // A note of 46 characters is whole; one of 47 is cut to 46, with the ellipsis in the last place.
    const whole = facts({ holders: "1,234,567", supply: "123.45B", code: "ABCDEF" });
    expect(tokenCard(whole, XRPL).note).toBe("1,234,567 holders · supply 123.45B ABCDEF");
    const exact = facts({ holders: "1,234,567", supply: "123.45B", code: "ABCDEFGHIJK" });
    expect(Array.from(tokenCard(exact, XRPL).note!)).toHaveLength(46);
    expect(tokenCard(exact, XRPL).note).toBe("1,234,567 holders · supply 123.45B ABCDEFGHIJK");
    expect(tokenCard(facts({ holders: "1,234,567", supply: "123.45B", code: "ABCDEFGHIJKL" }), XRPL).note).toBe("1,234,567 holders · supply 123.45B ABCDEFGHIJ…");
  });

  it("has a card with no status, no note of its own beyond the figures and no end to the footer", () => {
    const card = tokenCard(facts(), XRPL);
    expect("status" in card).toBe(false);
    expect("footerEnd" in card).toBe(false);
  });
});

// ---- An MPT ----------------------------------------------------------------------------------------------------------------------------

describe("mptCard", () => {
  const MPT_NET = { id: "xrpl", name: "XRPL" } as const;
  const SHORT_ID = `${MPT_SAMPLE_ID.slice(0, 8)}…${MPT_SAMPLE_ID.slice(-4)}`;
  /** HTF as the index has it (the board's figures: 18,204,511.20 outstanding over 3,412 holders, created on 9 Oct 2025), with the keys `over` replaces. */
  const indexed = (over: Parameters<typeof mptIssuanceSample>[0] = {}): MptSource => ({ origin: "index", answer: mptSample({ issuance: mptIssuanceSample(over) }) });
  /** The same issuance as only the node has it: no metadata, no holders, no creation time. */
  const fromNode: MptSource = { origin: "node", node: { LedgerEntryType: "MPTokenIssuance", Issuer: MPT_SAMPLE_ISSUER, Sequence: 298, Flags: 0x22, AssetScale: 2, OutstandingAmount: "1820451120" }, ledgerIndex: 107721455, id: MPT_SAMPLE_ID };
  const named: NamesPart = { state: "ok", map: { [MPT_SAMPLE_ISSUER]: { name: { text: "Harborline", kind: "verified" }, labels: [] } satisfies NameView } };
  const cardOf = (source: MptSource, names: NamesPart = NO_NAMES, network: typeof XRPL | typeof XRPL_TESTNET = XRPL) => mptCard(mptFacts(network, source, names), network);

  it("is the board: the kind MPT, the ticker as the big line, the issuer, the name and the figures, the day it was created", () => {
    expect(cardOf(indexed(), named)).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "MPT",
      headline: { text: "HTF", mono: true },
      parties: ["Harborline"],
      note: "Harborline Treasury Fund · 18.2M HTF outstanding · 3,412 holders",
      footer: [{ text: "Created 9 Oct 2025" }],
    });
  });

  it("names the issuer by its short address where the names say nothing of it", () => {
    expect(cardOf(indexed()).parties).toEqual([shortAddress(MPT_SAMPLE_ISSUER)]);
  });

  it("leaves the name out of the note of an issuance that has none, and keeps the figures", () => {
    const card = cardOf(indexed({ name: undefined, metadata: undefined }));
    expect(card.headline).toEqual({ text: "HTF", mono: true });
    expect(card.note).toBe("18.2M HTF outstanding · 3,412 holders");
  });

  it("is headed by the start and end of the ID, in mono, where the issuance has no ticker, and counts its amount in units", () => {
    const card = cardOf(indexed({ ticker: undefined, name: undefined, metadata: undefined }));
    expect(card.headline).toEqual({ text: SHORT_ID, mono: true });
    expect(card.note).toBe("18.2M units outstanding · 3,412 holders");
  });

  it("reads an issuance only the network has: units, no holders, no creation, and the network in the footer", () => {
    expect(cardOf(fromNode)).toEqual({
      network: "xrpl",
      networkLabel: "XRPL mainnet",
      kind: "MPT",
      headline: { text: SHORT_ID, mono: true },
      parties: [shortAddress(MPT_SAMPLE_ISSUER)],
      note: "18.2M units outstanding",
      footer: [{ text: "MPT on XRPL" }],
    });
    expect(cardOf(fromNode, NO_NAMES, XRPL_TESTNET).footer).toEqual([{ text: "MPT on XRPL Testnet" }]);
    expect(cardOf(indexed({ created_time: undefined })).footer).toEqual([{ text: "MPT on XRPL" }]);
  });

  it("says holder of an issuance with one, 0 holders of one with none, and groups the thousands as the page does", () => {
    expect(cardOf(indexed({ holders: 1 })).note).toBe("Harborline Treasury Fund · 18.2M HTF outstanding · 1 holder");
    expect(cardOf(indexed({ holders: 0 })).note).toBe("Harborline Treasury Fund · 18.2M HTF outstanding · 0 holders");
    expect(cardOf(indexed({ holders: 1234567 })).note).toBe("Harborline Treasury Fund · 18.2M HTF outstanding · 1,234,567 holders");
  });

  it("reads the day in UTC as the cards do: the last second of a day and the first of the next", () => {
    expect(cardOf(indexed({ created_time: "2025-10-09T23:59:59Z" })).footer).toEqual([{ text: "Created 9 Oct 2025" }]);
    expect(cardOf(indexed({ created_time: "2025-10-10T00:00:00Z" })).footer).toEqual([{ text: "Created 10 Oct 2025" }]);
  });

  it("cuts a name that runs on (the issuer writes up to 128 characters) so that the figures stay whole on the card, and leaves one that fits", () => {
    const long = `Harborline ${"Treasury ".repeat(14)}Fund`;
    const card = cardOf(indexed({ name: long }));
    expect(card.note).toBe(`${Array.from(long).slice(0, 39).join("").trimEnd()}… · 18.2M HTF outstanding · 3,412 holders`);
    const fits = "x".repeat(40);
    expect(cardOf(indexed({ name: fits })).note).toBe(`${fits} · 18.2M HTF outstanding · 3,412 holders`);
    expect(cardOf(indexed({ name: "x".repeat(41) })).note).toBe(`${"x".repeat(39)}… · 18.2M HTF outstanding · 3,412 holders`);
  });

  // One rule for the issuer's text (the whole-branch review's I1): the tab, the pages, the tags and the card read it without its bidi controls.
  it("draws the issuer's ticker and name without their bidi controls, as the tab does, and a ticker of nothing else as none", () => {
    const hostile = cardOf(indexed({ ticker: "H\u202ETF", name: "Harbor\u2066line\u200F Fund" }));
    expect(hostile.headline).toEqual({ text: "HTF", mono: true });
    expect(hostile.note).toBe("Harborline Fund · 18.2M HTF outstanding · 3,412 holders");
    const nothing = cardOf(indexed({ ticker: "\u202E\u202C", name: "\u2066\u2069", metadata: undefined }));
    expect(nothing.headline).toEqual({ text: SHORT_ID, mono: true });
    expect(nothing.note).toBe("18.2M units outstanding · 3,412 holders");
    for (const text of [hostile.headline.text, hostile.note!, nothing.headline.text, nothing.note!]) expect(text).not.toMatch(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/);
  });

  it("reads the ticker as every page does: cut to 16 code points, and a blank one is none", () => {
    const long = cardOf(indexed({ ticker: "ABCDEFGHIJKLMNOPQRST" }));
    expect(long.headline.text).toBe("ABCDEFGHIJKLMNOP");
    expect(long.note).toContain("18.2M ABCDEFGHIJKLMNOP outstanding");
    const blank = cardOf(indexed({ ticker: "   ", metadata: undefined }));
    expect(blank.headline.text).toBe(SHORT_ID);
    expect(blank.note).toContain("18.2M units outstanding");
  });

  // The whole-branch review's M1: above asset scale 19 the amount is the ledger's integers, not the token's, so the card counts it in units whatever the ticker is.
  it("counts the amount in units above scale 19, and keeps the ticker as the headline", () => {
    const card = cardOf(indexed({ asset_scale: 25, outstanding_amount: "1820451120" }));
    expect(card.headline).toEqual({ text: "HTF", mono: true });
    expect(card.note).toBe("Harborline Treasury Fund · 1.82B units outstanding · 3,412 holders");
    expect(cardOf(indexed({ asset_scale: 19, outstanding_amount: "1820451120" })).note).toContain("HTF outstanding");
  });

  it("has a card with no status and no end to the footer", () => {
    const card = cardOf(indexed());
    expect("status" in card).toBe(false);
    expect("footerEnd" in card).toBe(false);
  });
});

// ---- The pill: the network's label, whatever its kind ----------------------------------------------------------------------------------------

describe("the pill of every card", () => {
  it("reads the label of the card's network: 'XRPL mainnet' on the mainnet, 'XRPL Testnet' and 'Xahau Testnet' on the testnets", () => {
    const labels = (network: typeof XRPL | typeof XRPL_TESTNET | typeof XAHAU | typeof XAHAU_TESTNET) => [
      transactionCard(tx(), network).networkLabel,
      ledgerCard(ledger(), network).networkLabel,
      accountCard(account(), network).networkLabel,
      validatorCard(validator(), { ...network, software: "rippled" }).networkLabel,
      amendmentCard(enabledAmm(), { ...network, software: "rippled" }).networkLabel,
      poolCard(poolFacts(), network).networkLabel,
      nftCard({ kind: "nftoken", headline: "#1", collection: "r…", note: "Never sold" }, network).networkLabel,
      tokenCard(tokenFacts({ id: network.id }, tokenDetailSample(), false), network).networkLabel,
      mptCard(mptFacts(network, { origin: "index", answer: mptSample() }, NO_NAMES), network).networkLabel,
    ];
    expect(labels(XRPL)).toEqual(Array(9).fill("XRPL mainnet"));
    expect(labels(XAHAU)).toEqual(Array(9).fill("Xahau mainnet"));
    expect(labels(XRPL_TESTNET)).toEqual(Array(9).fill("XRPL Testnet"));
    expect(labels(XAHAU_TESTNET)).toEqual(Array(9).fill("Xahau Testnet"));
  });

  it("says the testnet's name where the footer names the network", () => {
    expect(accountCard(account({ balance: null }), XAHAU_TESTNET).footer).toEqual([{ text: "Account on Xahau Testnet" }]);
    expect(poolCard(poolFacts({ created: undefined }), XRPL_TESTNET).footer).toEqual([{ text: "AMM pool on XRPL Testnet" }]);
    expect(tokenCard(tokenFacts({ id: "xrpl" }, tokenDetailSample({ toml: undefined, listed: false }), false), XRPL_TESTNET).footer).toEqual([{ text: "Issued token on XRPL Testnet" }]);
  });
});
