import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { encodeCtid } from "../domain/ctid";
import { dropsToNative, shortAddress, shortHash } from "../domain/format";
import type { TxJson, TxMeta } from "../domain/parse/types";
import type { TxBinary, TxObject } from "./api-types";
import type { NodeTx } from "./node-rpc";
import {
  binaryOf,
  neighboursOf,
  plainText,
  transactionNotFoundPage,
  transactionPage,
  txFromIndex,
  txFromNode,
  type TransactionPageData,
  type TransactionSource,
} from "./transaction-view";
import { UpstreamError } from "./upstream";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../test/fixtures/http/${path}`, import.meta.url), "utf8"));
const fixtureTx = (net: "xrpl" | "xahau", hash: string): TxObject => read(`${net}/data-api/transactions/${hash}.json`).transaction;
const fixtureBinary = (net: "xrpl" | "xahau", hash: string): TxBinary => read(`${net}/data-api/transactions/${hash}@binary=true.json`).transaction;

// Recorded transactions (test/fixtures/http): a plain XRP Payment, a Payment through an AMM pool (the first in its ledger), a failed
// OfferCreate with a memo, and a Xahau Remit.
const PAYMENT = "AACAFCFEBB5C970049A576CBFE6EF544A47EE3ADBA99122FA43234D18D5FFD40";
const SWAP = "52E2AD5B382D4588BECF6A743E7AE5C84D49A5C06968EC7700E8333BF41E1C60";
const KILLED = "D05D52934A382E975B131A3E729CDA7CA3C59E94CE9F3DC3DC91A6ADFC5C140F";
const REMIT = "8C50C44787A12B785AA62377D0AFA6C4711E8E07EF68BA6E83DC286F7EE79AAF";

const XRPL = { native: "XRP", ctidNetworkId: 0 } as const;
const XAHAU = { native: "XAH", ctidNetworkId: 21337 } as const;

const neighbours = (count: number, position: number) => ({
  count,
  previous: position > 0 ? { position: position - 1, hash: "11".repeat(32) } : null,
  next: position < count - 1 ? { position: position + 1, hash: "22".repeat(32) } : null,
});

function page(hash: string, net: "xrpl" | "xahau" = "xrpl", count = 70): TransactionPageData {
  const object = fixtureTx(net, hash);
  const source = txFromIndex(object, hash);
  return transactionPage(source, {
    network: net === "xrpl" ? XRPL : XAHAU,
    neighbours: neighbours(count, source.meta.TransactionIndex),
    binary: binaryOf(fixtureBinary(net, hash)),
  });
}

const failure = (run: () => unknown): UpstreamError => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(UpstreamError);
    return error as UpstreamError;
  }
  throw new Error("expected a failure");
};

describe("txFromIndex", () => {
  it("takes a transaction of the data API: its place, its time in unix seconds, the hash in upper case", () => {
    const object = fixtureTx("xrpl", PAYMENT);
    const source = txFromIndex(object, PAYMENT.toLowerCase());
    expect(source.origin).toBe("index");
    expect(source.hash).toBe(PAYMENT);
    expect(source.ledgerIndex).toBe(102186243);
    expect(source.closeTime).toBe(Date.parse(object.date) / 1000);
    expect(source.tx).toBe(object.tx);
    expect(source.meta).toBe(object.meta);
  });

  it.each([
    ["a hash that is not the one asked for", (o: any) => ({ ...o, hash: "AB".repeat(32) })],
    ["no hash", (o: any) => ({ ...o, hash: undefined })],
    ["no tx", (o: any) => ({ ...o, tx: undefined })],
    ["a tx that is text", (o: any) => ({ ...o, tx: "Payment" })],
    ["a tx without a type", (o: any) => ({ ...o, tx: { Account: "rX" } })],
    ["a tx without an account", (o: any) => ({ ...o, tx: { TransactionType: "Payment" } })],
    ["no meta", (o: any) => ({ ...o, meta: undefined })],
    ["a meta without a result", (o: any) => ({ ...o, meta: { TransactionIndex: 3, AffectedNodes: [] } })],
    ["a meta without a place in the ledger", (o: any) => ({ ...o, meta: { TransactionResult: "tesSUCCESS", AffectedNodes: [] } })],
    ["a meta whose nodes are not a list", (o: any) => ({ ...o, meta: { ...o.meta, AffectedNodes: "none" } })],
    ["a ledger that is not a number", (o: any) => ({ ...o, ledger_index: "107" })],
    ["a date that is not a date", (o: any) => ({ ...o, date: "yesterday" })],
    ["nothing", () => null],
  ])("is an upstream failure for %s, never a TypeError", (_what, spoil) => {
    const error = failure(() => txFromIndex(spoil(fixtureTx("xrpl", PAYMENT)) as TxObject, PAYMENT));
    expect(error.kind).toBe("server");
  });
});

describe("txFromNode", () => {
  const node = (): NodeTx => {
    const { tx, meta, hash, ledger_index } = fixtureTx("xrpl", PAYMENT);
    return { hash, ledger_index, date: 1792253462, tx, meta, ledger_hash: "CD".repeat(32) };
  };

  it("takes a transaction of the node, whose time is already unix seconds", () => {
    const source = txFromNode(node(), PAYMENT);
    expect(source).toMatchObject({ origin: "node", hash: PAYMENT, ledgerIndex: 102186243, closeTime: 1792253462 });
  });

  it("is an upstream failure for an answer that is not the transaction asked for", () => {
    expect(failure(() => txFromNode({ ...node(), hash: "AB".repeat(32) }, PAYMENT)).kind).toBe("server");
    expect(failure(() => txFromNode({ ...node(), meta: {} as TxMeta }, PAYMENT)).kind).toBe("server");
    expect(failure(() => txFromNode({ ...node(), date: Number.NaN }, PAYMENT)).kind).toBe("server");
  });
});

describe("neighboursOf", () => {
  const hashes = Array.from({ length: 5 }, (_, i) => `${i + 1}`.repeat(64).toLowerCase());

  it("gives the transactions before and after, by their place, and how many there are", () => {
    expect(neighboursOf(hashes, hashes[2]!.toUpperCase(), 2)).toEqual({
      count: 5,
      previous: { position: 1, hash: hashes[1]!.toUpperCase() },
      next: { position: 3, hash: hashes[3]!.toUpperCase() },
    });
  });

  it("has no previous at the start and no next at the end", () => {
    expect(neighboursOf(hashes, hashes[0]!, 0).previous).toBeNull();
    expect(neighboursOf(hashes, hashes[0]!, 0).next?.position).toBe(1);
    expect(neighboursOf(hashes, hashes[4]!, 4).next).toBeNull();
    expect(neighboursOf(hashes, hashes[4]!, 4).previous?.position).toBe(3);
    expect(neighboursOf([hashes[0]], hashes[0]!, 0)).toEqual({ count: 1, previous: null, next: null });
  });

  it.each([
    ["a list that does not hold the transaction at its place", hashes, "AB".repeat(32), 2],
    ["a place past the end", hashes, hashes[0]!, 9],
    ["something that is not a list", "oops", hashes[0]!, 0],
    ["a neighbour that is not a hash", [hashes[0], "junk", hashes[2]], hashes[0]!, 0],
    ["a neighbour that is a number", [7, hashes[1]], hashes[1]!, 1],
  ])("is an upstream failure for %s: an immutable page must not store a wrong neighbour", (_what, list, hash, position) => {
    expect(failure(() => neighboursOf(list, hash, position)).kind).toBe("server");
  });
});

describe("binaryOf", () => {
  it("is the blobs of the answer, when both are hex", () => {
    const answer = fixtureBinary("xrpl", PAYMENT);
    expect(binaryOf(answer)).toEqual({ state: "ready", tx: answer.tx, meta: answer.meta });
  });

  it.each([
    ["nothing", undefined],
    ["a tx that is not text", { tx: 7, meta: "AB" }],
    ["a tx that is not hex", { tx: "XYZ1", meta: "AB" }],
    ["a tx of an odd length", { tx: "ABC", meta: "AB" }],
    ["an empty tx", { tx: "", meta: "AB" }],
    ["a meta that is not hex", { tx: "AB", meta: "zz" }],
    ["no meta", { tx: "AB" }],
  ])("is 'failed' for %s", (_what, answer) => {
    expect(binaryOf(answer)).toEqual({ state: "failed" });
  });
});

describe("plainText", () => {
  it("writes a sentence the way a title wants it: short accounts, amounts with their separators, a pool by its pair", () => {
    expect(
      plainText([
        { t: "account", v: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh" },
        { t: "text", v: " paid " },
        { t: "amount", value: "1250.5", currency: "524C555344000000000000000000000000000000", issuer: "rX" },
        { t: "text", v: " through the " },
        { t: "pool", v: "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3", pair: "XRP/RLUSD" },
        { t: "text", v: " AMM pool." },
      ]),
    ).toBe(`${shortAddress("rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh")} paid 1,250.5 RLUSD through the XRP/RLUSD AMM pool.`);
  });
});

describe("transactionPage over a plain Payment", () => {
  const data = page(PAYMENT);
  const object = fixtureTx("xrpl", PAYMENT);

  it("says what the transaction is and where it sits", () => {
    expect(data).toMatchObject({
      kind: "transaction",
      origin: "index",
      hash: PAYMENT,
      ledgerIndex: 102186243,
      position: { index: 63, count: 70 },
      type: "Payment",
      title: "Payment",
      ok: true,
      result: { code: "tesSUCCESS", ok: true },
      account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh",
    });
    expect(data.closeTime).toBe(Date.parse(object.date) / 1000);
  });

  it("computes the CTID from the ledger, the place in it and the network", () => {
    expect(data.ctid).toBe(encodeCtid(102186243, 63, 0));
    expect(page("8C50C44787A12B785AA62377D0AFA6C4711E8E07EF68BA6E83DC286F7EE79AAF", "xahau", 120).ctid).toBe(encodeCtid(26540613, 88, 21337));
  });

  it("has no CTID for a place that does not fit one", () => {
    const source: TransactionSource = { ...txFromIndex(object, PAYMENT), ledgerIndex: 2 ** 28 };
    expect(transactionPage(source, { network: XRPL, neighbours: null, binary: { state: "failed" } }).ctid).toBeNull();
  });

  it("carries the sentence as segments and as plain text", () => {
    expect(data.sentence[0]).toEqual({ t: "account", v: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh" });
    expect(data.summary).toBe(`${shortAddress("rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh")} sent 2.306481 XRP to ${shortAddress("rDFDjdFgCEGgYoAxdZVp3AepoErfrPfy48")}.`);
  });

  it("has the flow of the money, sender to destination", () => {
    expect(data.flow).toEqual([
      { role: "sender", account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", label: "Sender", amount: { value: "2.306481", currency: "XRP" } },
      { role: "destination", account: "rDFDjdFgCEGgYoAxdZVp3AepoErfrPfy48", label: "Destination", amount: { value: "2.306481", currency: "XRP" } },
    ]);
  });

  it("gives the fee in whole units of the native currency and the sequence", () => {
    expect(data.fee).toBe(dropsToNative(object.tx.Fee));
    expect(data.sequence).toBe(object.tx.Sequence);
  });

  it("puts the Destination first among the details, once, ahead of the type's own", () => {
    expect(data.details.map((d) => d.label)).toEqual(["Destination", "Amount"]);
    expect(data.details[0]!.value).toEqual([{ t: "account", v: "rDFDjdFgCEGgYoAxdZVp3AepoErfrPfy48" }]);
  });

  it("lists the balance changes, the sender's first, with the roles and the balance after", () => {
    expect(data.changes).toEqual([
      { account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", currency: "XRP", value: "-2.306493", after: "6.202021", role: "sender" },
      { account: "rDFDjdFgCEGgYoAxdZVp3AepoErfrPfy48", currency: "XRP", value: "2.306481", after: "6.202034", role: "destination" },
    ]);
  });

  it("lists the ledger objects the transaction touched", () => {
    expect(data.objects).toEqual([
      { change: "modified", type: "AccountRoot", index: "38D2481193DAF7FFBEE59A12FD9F67EE8EE021EAB24385627E4B4BF8957AD724", account: "rDFDjdFgCEGgYoAxdZVp3AepoErfrPfy48" },
      { change: "modified", type: "AccountRoot", index: "C16596D03A5FFAA5F19C67816967D253CAFE24DE6E095675F8E43A38C9CAE9A4", account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh" },
    ]);
  });

  it("passes on the neighbours and the binary form, and the raw JSON as text", () => {
    expect(data.neighbours).toEqual({ previous: { position: 62, hash: "11".repeat(32) }, next: { position: 64, hash: "22".repeat(32) } });
    expect(data.raw.binary).toEqual({ state: "ready", tx: fixtureBinary("xrpl", PAYMENT).tx, meta: fixtureBinary("xrpl", PAYMENT).meta });
    expect(JSON.parse(data.raw.tx)).toEqual(object.tx);
    expect(JSON.parse(data.raw.meta)).toEqual(object.meta);
    expect(data.raw.tx).toBe(JSON.stringify(object.tx, null, 2));
  });

  it("has no memo", () => {
    expect(data.memos).toEqual([]);
  });
});

describe("transactionPage over a Payment through an AMM pool", () => {
  const data = page(SWAP);

  it("has the pool among the steps of the flow, with what it paid out", () => {
    expect(data.flow!.map((step) => step.role)).toEqual(["sender", "pool", "destination"]);
    expect(data.flow![1]).toMatchObject({ account: "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3", label: "XRP/RLUSD AMM pool", amount: { value: "179.448166793" } });
  });

  it("names the pool in the sentence and the summary", () => {
    expect(data.sentence.some((segment) => segment.t === "pool" && segment.pair === "XRP/RLUSD")).toBe(true);
    expect(data.summary).toContain("through the XRP/RLUSD AMM pool");
  });

  it("marks the pool's rows in the balance changes", () => {
    const roles = data.changes.map((change) => `${change.account === "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3" ? "pool" : "other"}:${change.role ?? "-"}`);
    expect(roles.filter((role) => role.startsWith("pool"))).toEqual(["pool:pool", "pool:pool"]);
    // The sender is also the destination of this payment: the sender it is.
    expect(data.changes[0]).toMatchObject({ account: "rMsrQGK9fZ6B2164QGLnjLMxBYSCY5xJ4W", role: "sender" });
    expect(data.changes.filter((change) => change.role === "destination")).toEqual([]);
  });
});

describe("transactionPage over a failed transaction", () => {
  const data = page(KILLED);

  it("says it failed, with the result code and its text, and has no flow", () => {
    expect(data.ok).toBe(false);
    expect(data.result).toEqual({ code: "tecKILLED", ok: false, text: "The offer could not be filled as its flags required, so nothing was traded." });
    expect(data.flow).toBeNull();
    expect(data.sentence.map((segment) => (segment.t === "text" ? segment.v : "")).join("")).toContain("tried to");
  });

  it("still lists the fee it burned", () => {
    expect(data.changes).toEqual([{ account: "rsjsfxKNcgkcGLndpkdLr5CKLvQ8Nntsf1", currency: "XRP", value: "-0.00001", after: "282.556198", role: "sender" }]);
    expect(data.fee).toBe("0.00001");
  });

  it("reads the memo: its data as text", () => {
    expect(data.memos).toEqual([{ text: "34CA34DF1108F4BA", hex: false, note: "" }]);
  });
});

describe("transactionPage over a Xahau transaction", () => {
  const data = page(REMIT, "xahau", 120);

  it("is in the network's currency", () => {
    expect(data.changes.some((change) => change.currency === "XAH")).toBe(true);
    expect(data.summary).toContain("XAH");
  });

  it("does not repeat a Destination the type's own details already list", () => {
    expect(data.details.filter((detail) => detail.label === "Destination")).toHaveLength(1);
    expect(data.details.map((detail) => detail.label)).toEqual(["Destination", "Amount 1", "Amount 2", "Amount 3", "Amount 4"]);
  });
});

describe("transactionPage, the pieces a transaction can have or lack", () => {
  const BOB = "rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5";
  const ALICE = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
  const hex = (text: string) =>
    [...new TextEncoder().encode(text)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();

  function synthetic(tx: Partial<TxJson>, meta: Partial<TxMeta> = {}): TransactionSource {
    return {
      origin: "index",
      hash: "AB".repeat(32),
      ledgerIndex: 107695660,
      closeTime: 1792253462,
      tx: { TransactionType: "Payment", Account: ALICE, Destination: BOB, Amount: "5000000", Fee: "12", Sequence: 46118302, ...tx },
      meta: { TransactionIndex: 12, TransactionResult: "tesSUCCESS", AffectedNodes: [], ...meta },
    };
  }
  const build = (source: TransactionSource) => transactionPage(source, { network: XRPL, neighbours: null, binary: { state: "failed" } });

  it("adds the destination tag to the destination of the flow", () => {
    const data = build(synthetic({ DestinationTag: 104882 }));
    expect(data.flow!.at(-1)).toMatchObject({ role: "destination", label: "Destination · tag 104882" });
  });

  it("decodes memos: text with its format and type, hex when the data is not text", () => {
    const data = build(
      synthetic({
        Memos: [
          { Memo: { MemoData: hex("Invoice 2291"), MemoFormat: hex("text/plain"), MemoType: hex("note") } },
          { Memo: { MemoData: "00FF10" } },
          { Memo: { MemoFormat: hex("text/plain") } },
          { notAMemo: true },
        ],
      }),
    );
    expect(data.memos).toEqual([
      { text: "Invoice 2291", hex: false, note: "note · text/plain" },
      { text: "00FF10", hex: true, note: "" },
      { text: "", hex: false, note: "text/plain" },
    ]);
  });

  it("cuts a long memo, and shows only the first few memos", () => {
    const long = build(synthetic({ Memos: [{ Memo: { MemoData: hex("x".repeat(3000)) } }] }));
    expect(long.memos[0]!.text).toHaveLength(401);
    expect(long.memos[0]!.text.endsWith("…")).toBe(true);

    const many = build(synthetic({ Memos: Array.from({ length: 30 }, (_, i) => ({ Memo: { MemoData: hex(`m${i}`) } })) }));
    expect(many.memos).toHaveLength(10);
    expect(many.memos[9]!.text).toBe("m9");
  });

  it("takes memos that are not a list as no memos", () => {
    expect(build(synthetic({ Memos: "hello" as never })).memos).toEqual([]);
  });

  it("copes with a transaction that has no destination, sequence or fee", () => {
    const source = synthetic({ TransactionType: "AccountSet" });
    // (JSON has no `undefined`: the fields are left out, not set to it.)
    for (const field of ["Destination", "Amount", "Sequence", "Fee"]) delete source.tx[field];
    const data = build(source);
    expect(data.sequence).toBeNull();
    expect(data.fee).toBe("0");
    expect(data.details.map((detail) => detail.label)).not.toContain("Destination");
  });

  it("keeps the type apart from the title when they differ", () => {
    const data = build(synthetic({ TransactionType: "OfferCreate", TakerGets: "5000000", TakerPays: { currency: "USD", issuer: BOB, value: "3" } }));
    expect(data.type).toBe("OfferCreate");
    expect(data.title).not.toBe("");
  });

  it("is shown from the node without neighbours, with the binary form 'pending'", () => {
    const data = transactionPage({ ...synthetic({}), origin: "node" }, { network: XRPL, neighbours: null, binary: { state: "pending" } });
    expect(data.origin).toBe("node");
    expect(data.neighbours).toBeNull();
    expect(data.position).toEqual({ index: 12, count: null });
    expect(data.raw.binary).toEqual({ state: "pending" });
  });
});

describe("what the browser gets", () => {
  // The page data is serialized into the HTML and fetched for client-side navigations. The transaction's JSON is not in it as
  // data: describe/ and parse/ stay in the Worker, and the JSON reaches the browser only as the text of the raw tabs.
  const keysOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap(keysOf)
      : typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
        : [];

  it.each([
    ["a Payment", PAYMENT],
    ["a Payment through a pool", SWAP],
    ["a failed offer", KILLED],
  ])("holds %s only as the text of its raw tabs", (_what, hash) => {
    const data = page(hash);
    const keys = new Set(keysOf(data));
    for (const field of ["AffectedNodes", "TransactionType", "TransactionResult", "TxnSignature", "SigningPubKey", "FinalFields", "PreviousFields", "LedgerEntryType", "Fee", "Account"]) {
      expect(keys.has(field), field).toBe(false);
    }
    // ...while the raw tabs do have it, as text.
    expect(typeof data.raw.tx).toBe("string");
    expect(data.raw.tx).toContain('"TransactionType"');
    expect(data.raw.meta).toContain('"AffectedNodes"');
  });
});

describe("transactionNotFoundPage", () => {
  const HASH = "0D".repeat(32);

  it("is the not-found page of the search, naming the transaction and offering the same search on the other network", () => {
    expect(transactionNotFoundPage(HASH, { id: "xahau", name: "Xahau" })).toEqual({
      kind: "not-found",
      query: HASH,
      what: `transaction ${shortHash(HASH)}`,
      suggestion: { href: `/xahau/search?q=${HASH}`, label: "Search on Xahau" },
    });
  });
});
