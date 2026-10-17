import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { encodeCtid } from "../domain/ctid";
import { shortAddress } from "../domain/format";
import type { FeeRow, LastValidated, Ledger, TxObject } from "./api-types";
import { homePage } from "./home-view";

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

  it("takes the newest ledger from last_validated and its supply from the ledger header, in whole units", () => {
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
