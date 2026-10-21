import { describe, expect, it } from "vitest";

import type { FlowStep } from "../domain/describe";
import { shortHash } from "../domain/format";
import { AMM_ID, amendmentDetailSample, SAMPLE_KEYS, UNKNOWN_ID, validatorDetailSample, XCB_ID } from "../../test/support/d1-samples";
import type { AmendmentDetail, ValidatorDetail } from "./api-types";
import { accountCard, amendmentCard, formatCardTime, ledgerCard, transactionCard, transactionFacts, validatorCard } from "./card-data";

// What the link-preview image says (spec 9, the LinkPreview board): the words and numbers of the card for a transaction, a ledger and an
// account, from the same facts the page's tags are built from. The layout is app/og/card.test.ts; the PNG is test/worker/og.spec.ts.

const XRPL = { id: "xrpl", name: "XRPL" } as const;
const XAHAU = { id: "xahau", name: "Xahau" } as const;

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
