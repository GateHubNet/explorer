import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { encodeCtid } from "../domain/ctid";
import { shortAddress } from "../domain/format";
import type { FeeRow, LastValidated, Ledger, TxObject } from "./api-types";
import { homePage, latestLedgerIndex } from "./home-view";

const read = (net: string, path: string): any =>
  JSON.parse(readFileSync(new URL(`../../test/fixtures/http/${net}/data-api/${path}.json`, import.meta.url), "utf8"));

const XRPL = { id: "xrpl", ctidNetworkId: 0, native: "XRP" } as const;

function recorded(net: "xrpl" | "xahau", head: number) {
  return {
    last: read(net, "last_validated") as LastValidated,
    ledger: read(net, `ledgers/${head}`).ledger as Ledger,
    fees: read(net, "network/fees@descending=true&limit=8").rows as FeeRow[],
    transactions: read(net, "transactions@descending=true&limit=8").transactions as TxObject[],
  };
}

describe("homePage over the recorded XRPL answers", () => {
  const page = homePage({ network: XRPL, ...recorded("xrpl", 107721455) });

  it("takes the newest ledger, its hash, close time and supply, from the ledger header, in whole units", () => {
    expect(page.latest).toEqual({
      index: 107721455,
      hash: "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092",
      closeTime: 1792256472,
      supply: "99985590034.332636",
    });
  });

  it("counts the newest ledger's transactions and fees from its row, and averages all the rows", () => {
    expect(page.txCount).toBe(107);
    expect(page.average).toEqual({ transactions: 78, ledgers: 8 });
    expect(page.fees).toEqual({ total: "0.012135", average: "0.000113", max: "0.01" });
  });

  it("lists the ledgers newest first with their close times in unix seconds", () => {
    expect(page.ledgers).toHaveLength(8);
    expect(page.ledgers[0]).toEqual({ index: 107721455, txCount: 107, closeTime: 1792256472 });
    expect(page.ledgers[1]).toEqual({ index: 107720688, txCount: 66, closeTime: 1792253462 });
  });

  it("lists the transactions with their headline amount and result", () => {
    expect(page.transactions).toHaveLength(8);
    expect(page.transactions[0]).toEqual({
      type: "Batch",
      hash: "1A00E4CC5EB143E8BFF4578019BDF45ECEA40C37F113D261ECFB276243858872",
      account: "raBkGGTqmGJE2vQENXhkDsAm2BEXZSQpmj",
      amount: null,
      ok: true,
      code: "tesSUCCESS",
      date: 1792256472,
    });
    expect(page.transactions[2]!.amount).toEqual({ value: "17.296124", currency: "XRP" });
    expect(page.transactions[4]!.amount).toEqual({ value: "417.138606", currency: "XRP" });
    expect(page.transactions[7]).toMatchObject({ type: "OfferCreate", ok: false, code: "tecKILLED" });
  });

  it("suggests the ledger, and the account, hash and CTID of the newest transaction", () => {
    const ctid = encodeCtid(107721455, 106, 0);
    expect(page.examples).toEqual([
      { kind: "Ledger", label: "107,721,455", title: "107721455", href: "/xrpl/ledger/107721455" },
      { kind: "Account", label: shortAddress("raBkGGTqmGJE2vQENXhkDsAm2BEXZSQpmj"), title: "raBkGGTqmGJE2vQENXhkDsAm2BEXZSQpmj", href: "/xrpl/account/raBkGGTqmGJE2vQENXhkDsAm2BEXZSQpmj" },
      {
        kind: "Transaction",
        label: "1A00E4…8872",
        title: "1A00E4CC5EB143E8BFF4578019BDF45ECEA40C37F113D261ECFB276243858872",
        href: "/xrpl/tx/1A00E4CC5EB143E8BFF4578019BDF45ECEA40C37F113D261ECFB276243858872",
      },
      { kind: "CTID", label: `${ctid.slice(0, 9)}…`, title: ctid, href: `/xrpl/tx/${ctid}` },
    ]);
  });

  it("is JSON the browser can have", () => {
    expect(JSON.parse(JSON.stringify(page))).toEqual(page);
  });
});

describe("homePage when the data is thin", () => {
  const base = recorded("xrpl", 107721455);

  it("has no count and no fees when the fees have not reached the newest ledger yet", () => {
    const page = homePage({ network: XRPL, ...base, fees: base.fees.slice(1) });
    expect(page.txCount).toBeNull();
    expect(page.fees).toBeNull();
    expect(page.average).toEqual({ transactions: 73, ledgers: 7 });
  });

  it("has nothing to average without fee rows", () => {
    const page = homePage({ network: XRPL, ...base, fees: [] });
    expect(page.average).toBeNull();
    expect(page.ledgers).toEqual([]);
  });

  it("suggests only the ledger when there are no transactions", () => {
    const page = homePage({ network: XRPL, ...base, transactions: [] });
    expect(page.examples.map((example) => example.kind)).toEqual(["Ledger"]);
    expect(page.transactions).toEqual([]);
  });

  it("suggests no CTID for a position that does not fit in one", () => {
    const [first] = base.transactions;
    const odd = { ...first!, meta: { ...first!.meta, TransactionIndex: 70000 } };
    const page = homePage({ network: XRPL, ...base, transactions: [odd] });
    expect(page.examples.map((example) => example.kind)).toEqual(["Ledger", "Account", "Transaction"]);
  });
});

// last_validated and the fees list are read from different places and can disagree for a moment: the fees list is computed from the ledger table,
// and the ledger last_validated names may not be in it yet. Then the page used to say "—" for the newest ledger's transactions and fees for a
// beat, and the next beat had them: the tiles flickered. The page takes as its latest the newest ledger the fees list has, so it is at most one
// ledger behind and never has a hole (the loader asks for that ledger's header, so that everything on the page is about one ledger).
describe("latestLedgerIndex", () => {
  const rows = (...indexes: number[]) => indexes.map((ledger_index) => ({ ledger_index }) as FeeRow);
  const last = (index: number) => ({ ledger_index: String(index) }) as LastValidated;

  it("is last_validated's when the fees list has that ledger", () => {
    expect(latestLedgerIndex(last(107), rows(107, 106, 105))).toBe(107);
  });

  it("is the newest ledger the fees list has when last_validated is ahead of it", () => {
    expect(latestLedgerIndex(last(108), rows(107, 106, 105))).toBe(107);
    expect(latestLedgerIndex(last(110), rows(105, 107, 106))).toBe(107);
  });

  it("is last_validated's when the fees list is ahead of it, and when there is no list", () => {
    expect(latestLedgerIndex(last(106), rows(107, 106, 105))).toBe(106);
    expect(latestLedgerIndex(last(106), [])).toBe(106);
  });

  it("gives a page with no hole: with the header of the ledger it picks, every figure and the hero are about that ledger", () => {
    const fees = recorded("xrpl", 107721455).fees;
    // last_validated says 107721456; the list's newest row is 107721455.
    expect(latestLedgerIndex(last(107721456), fees)).toBe(107721455);
    // And with the list one row shorter, the ledger before it.
    const picked = latestLedgerIndex(last(107721455), fees.slice(1));
    expect(picked).toBe(107720688);
    const page = homePage({ network: XRPL, ...recorded("xrpl", picked), fees: fees.slice(1) });
    expect(page.latest.index).toBe(107720688);
    expect(page.latest.hash).toBe("11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02");
    expect(page.txCount).toBe(66);
    expect(page.fees).toEqual({ total: "0.006252", average: "0.000095", max: "0.005" });
    expect(page.examples[0]).toMatchObject({ kind: "Ledger", title: "107720688" });
  });
});

describe("homePage for Xahau", () => {
  const page = homePage({ network: { id: "xahau", ctidNetworkId: 21337, native: "XAH" }, ...recorded("xahau", 26596843) });

  it("is in the network's currency and CTID network id", () => {
    expect(page.latest.supply).toBe("656916534.912954");
    expect(page.txCount).toBe(9);
    expect(page.transactions[5]!.amount).toEqual({
      value: "1.432450858916131",
      currency: "EVR",
      issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8",
    });
    expect(page.transactions[3]!.amount).toEqual({ value: "0.000001", currency: "XAH" });
    const ctid = page.examples.find((example) => example.kind === "CTID")!;
    expect(ctid.title).toBe(encodeCtid(26596843, 8, 21337));
    expect(ctid.href).toBe(`/xahau/tx/${ctid.title}`);
  });
});
