import { readdirSync, readFileSync } from "node:fs";
import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { checkPairExchanges } from "../app/server/aggregate-shape";
import type { PairExchange } from "../app/server/api-types";
import { derivedExchanges, invertedExchange } from "./derived-trades";
import { withTx } from "../test/support/ledger-edits";
import { HTTP, LEDGERS, readLedgers } from "./http-fixtures";

// The rows are derived from the recorded ledgers of XRPL (its three sets). The cases are the ones test/fixtures/ledgers/xrpl-amm/manifest.json describes. Their
// amounts are the pool's own change read off the metadata (the manifest's notes round them: "-179.4482 RLUSD" is 179.448166793), the offer's consumed amounts,
// and the rates by the rules of the data API's reference ("GET /v2/exchanges/{base}/{counter}"): a swap's from the pool's amounts, an offer's from its book
// directory. Each number below was worked out apart from the code that derives it.
const ledgers = readLedgers("xrpl");
const rows = derivedExchanges(ledgers);

const POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const RLUSD = "524C555344000000000000000000000000000000";
const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const LIONS = "4C494F4E53000000000000000000000000000000";
const LIONS_ISSUER = "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS";

const rowsOf = (hash: string): PairExchange[] => rows.filter((row) => row.tx_hash === hash);

/** The close time of the transaction's ledger as the data API's recorded answer for the transaction says it (`date`), in the form of an exchange. */
function executed(hash: string): string {
  const served = JSON.parse(readFileSync(new URL(`xrpl/data-api/transactions/${hash}.json`, HTTP), "utf8")) as { date: string };
  return served.date.replace("+00:00", "Z");
}

/** The transaction's own `Account`, from the recording. */
function accountOf(hash: string): string {
  for (const raw of ledgers) {
    const found = raw.ledger.transactions.find((tx) => tx.hash === hash);
    if (found) return found.Account;
  }
  throw new Error(`${hash} is not recorded`);
}

/** The keys of an exchange in the reference's order (the original's row), the optional ones where a row has them. */
const REFERENCE_ORDER = [
  "base_amount",
  "counter_amount",
  "node_index",
  "rate",
  "tx_index",
  "autobridged_currency",
  "autobridged_issuer",
  "buyer",
  "executed_time",
  "ledger_index",
  "offer_sequence",
  "provider",
  "seller",
  "taker",
  "tx_hash",
  "tx_type",
  "base_currency",
  "base_issuer",
  "counter_currency",
  "counter_issuer",
  "amm_account",
];

describe("a swap against a pool", () => {
  it("is stored RLUSD/XRP when the pool paid RLUSD out (52E2AD5B…: 134 XRP in, 179.448166793 RLUSD out): the taker buys", () => {
    const hash = "52E2AD5B382D4588BECF6A743E7AE5C84D49A5C06968EC7700E8333BF41E1C60";
    const taker = accountOf(hash);
    expect(rowsOf(hash)).toEqual([
      {
        base_amount: "179.448166793",
        counter_amount: "134",
        // The pool's AccountRoot is the second node of the metadata (the first is its RLUSD line).
        node_index: 1,
        // 134 / 179.448166793, 8 significant digits.
        rate: "0.74673374",
        tx_index: 0,
        buyer: taker,
        executed_time: "2026-10-16T12:13:51Z",
        ledger_index: 107694747,
        offer_sequence: 0,
        provider: POOL,
        seller: POOL,
        taker,
        tx_hash: hash,
        tx_type: "Payment",
        base_currency: RLUSD,
        base_issuer: RLUSD_ISSUER,
        counter_currency: "XRP",
        amm_account: POOL,
      },
    ]);
    // The manifest's note gives the amounts to 4 decimals.
    expect(new BigNumber(rowsOf(hash)[0]!.base_amount).toFixed(4)).toBe("179.4482");
  });

  it("is the other way round when the pool paid the counter out (5081561D…: 417.277515 XRP out, 543.870850376 RLUSD in): the taker sells", () => {
    const hash = "5081561D02260B321E16B9C3EF2840D6C5D32E6D62C74DADD7428F40C73D2793";
    const taker = accountOf(hash);
    expect(rowsOf(hash)).toEqual([
      {
        base_amount: "543.870850376",
        counter_amount: "417.277515",
        node_index: 3,
        // 417.277515 / 543.870850376: the pool received RLUSD, so the stored quality (received per paid) is inverted.
        rate: "0.76723640",
        tx_index: 14,
        buyer: POOL,
        executed_time: "2026-10-16T17:34:11Z",
        ledger_index: 107699656,
        offer_sequence: 0,
        provider: POOL,
        seller: taker,
        taker,
        tx_hash: hash,
        tx_type: "OfferCreate",
        base_currency: RLUSD,
        base_issuer: RLUSD_ISSUER,
        counter_currency: "XRP",
        amm_account: POOL,
      },
    ]);
    expect(new BigNumber(rowsOf(hash)[0]!.base_amount).toFixed(4)).toBe("543.8709");
  });

  it("between two issued currencies has no pool AccountRoot to point at: node_index is the pool's first reserve line (B9C56D94…)", () => {
    // The metadata names the pool rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb only by its two lsfAMMNode lines: nodes 1 (USDC) and 2 (RLUSD).
    const hash = "B9C56D941C726140DCDE385A5045EDF976745F434153EA49908AAE92969B1469";
    const taker = accountOf(hash);
    const pool = "rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb";
    expect(rowsOf(hash)).toEqual([
      {
        base_amount: "22.19651885465",
        counter_amount: "22.21468168488",
        node_index: 1,
        // 22.21468168488 / 22.19651885465
        rate: "1.0008183",
        tx_index: 35,
        buyer: pool,
        executed_time: "2026-02-12T01:07:50Z",
        ledger_index: 102186243,
        offer_sequence: 0,
        provider: pool,
        seller: taker,
        taker,
        tx_hash: hash,
        tx_type: "Payment",
        base_currency: RLUSD,
        base_issuer: RLUSD_ISSUER,
        counter_currency: "5553444300000000000000000000000000000000",
        counter_issuer: "rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE",
        amm_account: pool,
      },
    ]);
  });

  it("is one row for each pool a payment crosses, each at its own node (2C953884…, USD to XRP to SGB)", () => {
    const hash = "2C9538843C61FE4120577EDCD885C9B4E6AC6694C9DF3603528B81A2D9FC084A";
    const taker = accountOf(hash);
    const found = rowsOf(hash);
    expect(found.map((row) => [row.amm_account, row.node_index])).toEqual([
      ["rEaErQ5vEbHXThFedUrjz9YFotG5HHcxoW", 0],
      ["rs9ineLqrCzeAGS1bxsrW8x2n3bRJYAh3Q", 5],
    ]);
    // The XRP/SGB pool took 1.455815 XRP in and paid 2213.26267826 SGB out: SGB sorts before XRP, so it is the base and the taker buys it.
    expect(found[0]).toMatchObject({
      base_amount: "2213.26267826",
      counter_amount: "1.455815",
      rate: "0.00065776874",
      base_currency: "SGB",
      counter_currency: "XRP",
      buyer: taker,
      seller: "rEaErQ5vEbHXThFedUrjz9YFotG5HHcxoW",
    });
    // The XRP/USD pool took 2.04637079847 USD in (issued by rhub8…, which sorts before XRP) and paid 1.455815 XRP out: the taker sells USD.
    expect(found[1]).toMatchObject({
      base_amount: "2.04637079847",
      counter_amount: "1.455815",
      rate: "0.71141310",
      base_currency: "USD",
      base_issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq",
      counter_currency: "XRP",
      buyer: "rs9ineLqrCzeAGS1bxsrW8x2n3bRJYAh3Q",
      seller: taker,
      taker,
    });
  });

  it("carries the bridge of an autobridged OfferCreate (F9F304F7…, 1000 XAH for 1 RLUSD through XRP): the offer leg and the pool leg", () => {
    const hash = "F9F304F7B20FA2B1A340C1AB5DD0D6F410A50E80444EE698A47D556BA78E34FC";
    const taker = accountOf(hash);
    const found = rowsOf(hash);
    // Node 0 is the offer of the XAH/XRP leg, node 7 the XRP/RLUSD pool.
    expect(found.map((row) => [row.node_index, row.amm_account])).toEqual([
      [0, undefined],
      [7, POOL],
    ]);
    const [offer, swap] = found as [PairExchange, PairExchange];
    // The RLUSD side of the pool leg is on the transaction's TakerPays, so the far side is its TakerGets (XAH); the XAH side of the offer leg is on
    // its TakerGets, so the far side is its TakerPays (RLUSD).
    expect(swap).toMatchObject({
      base_amount: "1",
      counter_amount: "0.766153",
      rate: "0.76615300",
      autobridged_currency: "XAH",
      autobridged_issuer: "rswh1fvyLqHizBS2awu1vs6QcmwTBd9qiv",
      base_currency: RLUSD,
      counter_currency: "XRP",
    });
    expect(offer).toMatchObject({
      base_amount: "75.74716665999",
      counter_amount: "0.766153",
      // From the offer's book directory: 98.86689298350874 XAH per XRP.
      rate: "0.010114609",
      autobridged_currency: RLUSD,
      autobridged_issuer: RLUSD_ISSUER,
      base_currency: "XAH",
      base_issuer: "rswh1fvyLqHizBS2awu1vs6QcmwTBd9qiv",
      counter_currency: "XRP",
      provider: "rUfp2CFb3nP1zEqTzXhCkMXrHVnf4ciuwe",
      // The owner receives the base: it is the buyer, the taker the seller.
      buyer: "rUfp2CFb3nP1zEqTzXhCkMXrHVnf4ciuwe",
      seller: taker,
      offer_sequence: 99976298,
    });
    // The autobridged keys sit after tx_index, as in the reference.
    expect(Object.keys(swap).slice(0, 7)).toEqual(["base_amount", "counter_amount", "node_index", "rate", "tx_index", "autobridged_currency", "autobridged_issuer"]);
  });
});

describe("a Payment through a pool and the order book (8014250A…)", () => {
  const hash = "8014250A4FB1AC8859C4743090B7A905F2738253C010B968E272368A3FE59900";
  const taker = accountOf(hash);

  it("gives two rows, the pool's swap and the book's trade, by node", () => {
    const found = rowsOf(hash);
    expect(found).toHaveLength(2);
    expect(found.map((row) => row.node_index)).toEqual([5, 6]);
    const [swap, trade] = found as [PairExchange, PairExchange];

    // The pool paid 1.325962092 RLUSD out and took in 1.015604 XRP (the manifest's note: 1.3260 and 1.015604).
    expect(swap).toEqual({
      base_amount: "1.325962092",
      counter_amount: "1.015604",
      node_index: 5,
      rate: "0.76593743",
      tx_index: 55,
      buyer: taker,
      executed_time: "2026-10-17T08:42:50Z",
      ledger_index: 107713744,
      offer_sequence: 0,
      provider: POOL,
      seller: POOL,
      taker,
      tx_hash: hash,
      tx_type: "Payment",
      base_currency: RLUSD,
      base_issuer: RLUSD_ISSUER,
      counter_currency: "XRP",
      amm_account: POOL,
    });
    expect(new BigNumber(swap.base_amount).toFixed(3)).toBe("1.326");

    // The offer of rKrVTQChbm1761udZt18u9Aq9onJwEyvZw (the seventh node, deleted) gave its last 1.664037908479139 RLUSD for 1.27451 XRP. Its owner is the
    // seller of the base and its provider; the taker is the buyer. It has no `amm_account`.
    expect(trade).toEqual({
      base_amount: "1.664037908479139",
      counter_amount: "1.27451",
      node_index: 6,
      // The offer's quality from its book directory (0.765914791927856), not the ratio of what was consumed (0.76591404).
      rate: "0.76591479",
      tx_index: 55,
      buyer: taker,
      executed_time: "2026-10-17T08:42:50Z",
      ledger_index: 107713744,
      offer_sequence: 107195225,
      provider: "rKrVTQChbm1761udZt18u9Aq9onJwEyvZw",
      seller: "rKrVTQChbm1761udZt18u9Aq9onJwEyvZw",
      taker,
      tx_hash: hash,
      tx_type: "Payment",
      base_currency: RLUSD,
      base_issuer: RLUSD_ISSUER,
      counter_currency: "XRP",
    });
    expect(new BigNumber(trade.base_amount).toFixed(3)).toBe("1.664");
  });
});

describe("an order-book trade", () => {
  // The recorded answer for the account rBbW6… (the data API's own rows, kept as they are) is the oracle: the account took one of these trades and owned
  // the offer the other took.
  const recorded = JSON.parse(
    readFileSync(new URL("xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/exchanges@descending=true&limit=20.json", HTTP), "utf8"),
  ) as { exchanges: PairExchange[] };

  it("equals, key by key, the rows the data API recorded for LIONS/XRP in ledgers 107720115 and 107720688", () => {
    const lions = rows.filter(
      (row) => row.base_currency === LIONS && row.counter_currency === "XRP" && [107720115, 107720688].includes(row.ledger_index),
    );
    expect(lions).toHaveLength(2);
    expect(lions.map((row) => row.base_issuer)).toEqual([LIONS_ISSUER, LIONS_ISSUER]);
    // The recorded answer is newest first.
    expect([...lions].reverse()).toEqual(recorded.exchanges);
  });
});

describe("derivedExchanges", () => {
  it("lists the rows oldest first by ledger, transaction and node, and the three are a unique key", () => {
    const keys = rows.map((row) => `${row.ledger_index}:${row.tx_index}:${row.node_index}`);
    expect(new Set(keys).size).toBe(keys.length);
    const sorted = [...rows].sort((a, b) => a.ledger_index - b.ledger_index || a.tx_index - b.tx_index || a.node_index - b.node_index);
    expect(rows).toEqual(sorted);
    // The ledgers in another order give the same rows.
    expect(derivedExchanges([...ledgers].reverse())).toEqual(rows);
  });

  it("finds the swaps and the order-book trades of the AMM recordings that the data API's own tests count (138 and 39)", () => {
    const ammLedgers = new Set(
      readdirSync(new URL("xrpl-amm/", LEDGERS))
        .filter((name) => name.endsWith(".json.gz"))
        .map((name) => Number(name.replace(".json.gz", ""))),
    );
    const here = derivedExchanges(ledgers.filter((raw) => ammLedgers.has(Number(raw.ledger.ledger_index))));
    expect(here.filter((row) => row.amm_account !== undefined)).toHaveLength(138);
    expect(here.filter((row) => row.amm_account === undefined)).toHaveLength(39);
  });

  it("writes each row's keys in the reference's order, without an issuer for the native currency, and amm_account on a swap only", () => {
    for (const row of rows) {
      const keys = Object.keys(row);
      expect(keys).toEqual(REFERENCE_ORDER.filter((key) => keys.includes(key)));
      // Only the native currency is without an issuer.
      for (const side of ["base", "counter"] as const) {
        expect(row[`${side}_issuer`] === undefined).toBe(row[`${side}_currency`] === "XRP");
      }
      // A swap's provider is the pool and there is no offer behind it; a trade's provider owns the offer.
      if (row.amm_account !== undefined) expect([row.provider, row.offer_sequence]).toEqual([row.amm_account, 0]);
      else expect(row.offer_sequence).toBeGreaterThan(0);
    }
    expect(rows.some((row) => row.autobridged_currency !== undefined)).toBe(true);
  });

  it("stores each pair in the data API's order: the side with the lower currency+issuer key is the base", () => {
    const key = (currency: string, issuer?: string) => (currency + (issuer ?? "undefined")).toLowerCase();
    for (const row of rows) {
      expect(key(row.base_currency, row.base_issuer) < key(row.counter_currency, row.counter_issuer)).toBe(true);
    }
  });

  it("has a rate of 8 significant digits (toPrecision(8)) and exact amounts, and passes the client's check of a pair's trades", () => {
    for (const row of rows) {
      expect(new BigNumber(row.rate).toPrecision(8)).toBe(row.rate);
      expect(row.rate.replace(/e.*$/, "").replace(".", "").replace(/^0+/, "")).toHaveLength(8);
      // Exact decimal texts: no exponent, and the amount of a swap is the pool's change, never zero.
      for (const amount of [row.base_amount, row.counter_amount]) {
        expect(amount).toMatch(/^\d+(\.\d+)?$/);
        expect(new BigNumber(amount).gt(0)).toBe(true);
      }
    }
    expect(() => checkPairExchanges({ result: "success", count: rows.length, exchanges: rows })).not.toThrow();
  });

  it("leaves out a transaction that did not succeed, and one that is neither a Payment nor an OfferCreate", () => {
    const hash = "8014250A4FB1AC8859C4743090B7A905F2738253C010B968E272368A3FE59900";
    const failed = derivedExchanges(
      withTx(ledgers, hash, (tx) => {
        tx.metaData.TransactionResult = "tecPATH_PARTIAL";
      }),
    );
    expect(failed.filter((row) => row.tx_hash === hash)).toEqual([]);
    expect(failed).toHaveLength(rows.length - 2);

    const other = derivedExchanges(
      withTx(ledgers, hash, (tx) => {
        tx.TransactionType = "OfferCancel";
      }),
    );
    expect(other.filter((row) => row.tx_hash === hash)).toEqual([]);
    expect(other).toHaveLength(rows.length - 2);
  });

  it("leaves out a trade whose rate cannot be derived: a book directory without a quality and nothing consumed on a side", () => {
    // The offer of 8014250A…: its book directory zeroed (quality 0) and its TakerGets left as it was (nothing consumed, so the amounts give 1.27451 / 0).
    const hash = "8014250A4FB1AC8859C4743090B7A905F2738253C010B968E272368A3FE59900";
    type Body = { LedgerEntryType: string; FinalFields: Record<string, unknown>; PreviousFields: Record<string, unknown> };
    const changed = derivedExchanges(
      withTx(ledgers, hash, (tx) => {
        const nodes = tx.metaData.AffectedNodes as Array<{ DeletedNode?: Body }>;
        const offer = nodes.map((node) => node.DeletedNode).find((node) => node?.LedgerEntryType === "Offer")!;
        offer.FinalFields.BookDirectory = "0".repeat(64);
        offer.PreviousFields.TakerGets = offer.FinalFields.TakerGets;
      }),
    );
    expect(changed.filter((row) => row.tx_hash === hash).map((row) => row.amm_account)).toEqual([POOL]);
    expect(changed).toHaveLength(rows.length - 1);
  });

  it("takes the rate of a trade from the amounts when its book directory has no quality but the amounts do", () => {
    const hash = "8014250A4FB1AC8859C4743090B7A905F2738253C010B968E272368A3FE59900";
    type Body = { LedgerEntryType: string; FinalFields: Record<string, unknown> };
    const changed = derivedExchanges(
      withTx(ledgers, hash, (tx) => {
        const nodes = tx.metaData.AffectedNodes as Array<{ DeletedNode?: Body }>;
        nodes.map((node) => node.DeletedNode).find((node) => node?.LedgerEntryType === "Offer")!.FinalFields.BookDirectory = "0".repeat(64);
      }),
    );
    // 1.27451 XRP over 1.664037908479139 RLUSD
    expect(changed.find((row) => row.tx_hash === hash && row.amm_account === undefined)?.rate).toBe("0.76591404");
  });
});

describe("an offer the transaction took", () => {
  const hash = "8014250A4FB1AC8859C4743090B7A905F2738253C010B968E272368A3FE59900";
  type Body = { LedgerEntryType: string; FinalFields: Record<string, unknown> };

  it("must have a Sequence that is a number: a node without one, or with text, is an error and not a row with an undefined offer_sequence", () => {
    for (const sequence of [undefined, "107195225"]) {
      const broken = withTx(ledgers, hash, (tx) => {
        const nodes = tx.metaData.AffectedNodes as Array<{ DeletedNode?: Body }>;
        const offer = nodes.map((node) => node.DeletedNode).find((node) => node?.LedgerEntryType === "Offer")!;
        if (sequence === undefined) delete offer.FinalFields.Sequence;
        else offer.FinalFields.Sequence = sequence;
      });
      expect(() => derivedExchanges(broken)).toThrow(new RegExp(`${hash}: node 6, an Offer whose Sequence is ${sequence === undefined ? "undefined" : '"107195225"'}`));
    }
  });

  it("is not looked at when its trade is left out for want of a rate", () => {
    const broken = withTx(ledgers, hash, (tx) => {
      const nodes = tx.metaData.AffectedNodes as Array<{ DeletedNode?: Body & { PreviousFields: Record<string, unknown> } }>;
      const offer = nodes.map((node) => node.DeletedNode).find((node) => node?.LedgerEntryType === "Offer")!;
      delete offer.FinalFields.Sequence;
      offer.FinalFields.BookDirectory = "0".repeat(64);
      offer.PreviousFields.TakerGets = offer.FinalFields.TakerGets;
    });
    expect(derivedExchanges(broken).filter((row) => row.tx_hash === hash)).toHaveLength(1);
  });
});

describe("invertedExchange", () => {
  const hash = "5081561D02260B321E16B9C3EF2840D6C5D32E6D62C74DADD7428F40C73D2793";
  const [row] = rowsOf(hash) as [PairExchange];

  it("swaps the sides, the amounts, the buyer and the seller, and inverts the rate (200 decimals, then 8 significant digits)", () => {
    const inverted = invertedExchange(row);
    expect(inverted).toEqual({
      base_amount: "417.277515",
      counter_amount: "543.870850376",
      node_index: 3,
      // 543.870850376 / 417.277515
      rate: "1.3033792",
      tx_index: 14,
      buyer: row.seller,
      executed_time: "2026-10-16T17:34:11Z",
      ledger_index: 107699656,
      offer_sequence: 0,
      provider: POOL,
      seller: row.buyer,
      taker: row.taker,
      tx_hash: hash,
      tx_type: "OfferCreate",
      base_currency: "XRP",
      counter_currency: RLUSD,
      counter_issuer: RLUSD_ISSUER,
      amm_account: POOL,
    });
    // The keys are in the reference's order, with no issuer for the native base.
    expect(Object.keys(inverted)).toEqual(REFERENCE_ORDER.filter((key) => key in inverted));
    // The row itself is not changed.
    expect(row.base_currency).toBe(RLUSD);
  });

  it("keeps what is of the transaction and not of the side: the autobridged keys, the pool, the offer sequence and the provider", () => {
    const [offer, swap] = rowsOf("F9F304F7B20FA2B1A340C1AB5DD0D6F410A50E80444EE698A47D556BA78E34FC") as [PairExchange, PairExchange];
    expect(invertedExchange(swap)).toMatchObject({
      autobridged_currency: "XAH",
      autobridged_issuer: "rswh1fvyLqHizBS2awu1vs6QcmwTBd9qiv",
      amm_account: POOL,
      provider: POOL,
      offer_sequence: 0,
      base_currency: "XRP",
      counter_currency: RLUSD,
    });
    expect(invertedExchange(offer)).toMatchObject({ provider: "rUfp2CFb3nP1zEqTzXhCkMXrHVnf4ciuwe", offer_sequence: 99976298, base_currency: "XRP", counter_currency: "XAH" });
    expect(invertedExchange(offer)).not.toHaveProperty("amm_account");
  });

  it("inverts the rate the row stored, as the API does, not the 8 digits it served: they differ in the last digit for a row of 93663334", () => {
    // Ledger 93663334, transaction 25, node 0: the rate it stored is 0.23712701492493160389 and was served as 0.23712701. 1 / 0.23712701492… is 4.2171492…,
    // and 1 / 0.23712701 would be 4.2171493…
    const trade = rows.find((found) => found.ledger_index === 93663334 && found.tx_index === 25 && found.node_index === 0)!;
    expect(trade.rate).toBe("0.23712701");
    expect(invertedExchange(trade).rate).toBe("4.2171492");
  });

  it("refuses a row that derivedExchanges did not return, a copy included, instead of inverting its 8 digits", () => {
    expect(() => invertedExchange({ ...row })).toThrow(/not one that derivedExchanges returned/);
    expect(() => invertedExchange(JSON.parse(JSON.stringify(row)) as PairExchange)).toThrow(/pass the derived row itself/);
    // The row itself inverts, and so does a row that invertedExchange returned.
    expect(() => invertedExchange(row)).not.toThrow();
    expect(() => invertedExchange(invertedExchange(row))).not.toThrow();
  });

  it("is its own inverse on every derived row", () => {
    for (const found of rows) expect(invertedExchange(invertedExchange(found))).toEqual(found);
  });

  it("writes the exponent form where toPrecision(8) does: a rate of 1e-10 inverts to 9e9, one of 3e8 to 3e-9", () => {
    // Stored 1.0641306943e-10 (ledger 107720115, transaction 29, node 7) and 329516868.4608556733031000199 (ledger 102186243, transaction 40, node 1).
    const find = (ledger: number, tx: number, node: number) => rows.find((found) => [found.ledger_index, found.tx_index, found.node_index].join() === [ledger, tx, node].join())!;
    const small = find(107720115, 29, 7);
    expect([small.rate, invertedExchange(small).rate]).toEqual(["1.0641307e-10", "9.3973419e+9"]);
    const large = find(102186243, 40, 1);
    expect([large.rate, invertedExchange(large).rate]).toEqual(["3.2951687e+8", "3.0347460e-9"]);
  });
});
