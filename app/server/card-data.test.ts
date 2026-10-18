import { describe, expect, it } from "vitest";

import type { FlowStep } from "../domain/describe";
import { accountCard, formatCardTime, ledgerCard, transactionCard, transactionFacts } from "./card-data";

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
