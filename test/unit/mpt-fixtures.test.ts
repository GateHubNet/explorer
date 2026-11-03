import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { mptIdOf, mptIssuerOf } from "../../app/domain/mpt-id";
import type { MptHolder, MptHoldersPage, MptIssuanceAnswer, MptLookup, MptSummary, MptTokensPage, MptTransfer, MptTransfersPage } from "../../app/server/api-types";
import { checkMptHoldersPage, checkMptIssuance, checkMptLookup, checkMptTokens, checkMptTransfersPage } from "../../app/server/mpt-shape";
import { generate, HTTP, isHandWritten, isMptGenerated, isNftGenerated, isObjectGenerated, isTokenGenerated, LEDGERS, readLedgerSet } from "../../scripts/http-fixtures";
import {
  decodeMptMetadata,
  flagsOf,
  issuanceKey,
  madeUpIdentity,
  metadataConforms,
  MPT_ACCOUNT,
  MPT_COVERAGE_FROM,
  MPT_FIXTURE_IDS,
  MPT_LOCKED_HOLDING,
  MPT_RECORDED,
  MPT_ROW_LISTS,
  MPT_SET,
  mptFixtures,
  mptNodeFixtures,
  mptokenKey,
  mptPaths,
} from "../../scripts/mpt-fixtures";
import {
  MPT_FEE_PAYMENT_ISSUANCE,
  MPT_FIXTURE_IDS as RULES_IDS,
  MPT_LOCKED_HOLDING as RULES_LOCKED_HOLDING,
  MPT_MINT_ISSUANCE,
  MPT_RECORDED as RULES_RECORDED,
} from "../support/mpt-case-rules";
import { dataApiFile, nodeFile } from "../support/upstream-core";

// The MPT fixtures (scripts/mpt-fixtures.ts; test/fixtures/PROVENANCE.md, "MPT answers"), as `generate()` writes them and as they are on disk, against D9's keys and rules (data-api `feat/explorer-data-2` at
// c9a2fc0, its spec's section 7 and `docs/api-reference.md` "MPT") and the client's shape checks, which are the one place that says what an answer of D9 must hold.

type Json = Record<string, any>;

const generated = generate();
const ID = MPT_FIXTURE_IDS;
const ANSWERED = ["htf", "shortKeys", "noMetadata", "rawMetadata", "nonConforming", "destroyed", "lockedAll", "escrow"] as const;
const OTHER_THAN_HTF = ANSWERED.filter((key) => key !== "htf");

/** The text of a generated file of the data API, parsed (the keys in the order the file has them). */
const apiFile = (path: string, query = ""): Json => {
  const file = dataApiFile("xrpl", path, query);
  const text = file === undefined ? undefined : generated.get(file);
  if (text === undefined) throw new Error(`no generated file for ${path}?${query}`);
  return JSON.parse(text) as Json;
};
const hasApiFile = (path: string, query = ""): boolean => generated.has(dataApiFile("xrpl", path, query) ?? "");
const marked = (query: string, marker?: string): string => (marker === undefined ? query : `${query}&marker=${marker}`);

/** The pages of a list, from the first through the marker of each to the last. */
function pagesOf(id: string, route: "holders" | "transfers", query: string): Json[] {
  const pages: Json[] = [];
  for (let marker: string | undefined; ; ) {
    const page = apiFile(`/v2/mpt/${id}/${route}`, marked(query, marker));
    pages.push(page);
    if (page.marker === undefined) return pages;
    marker = page.marker as string;
  }
}
const holdersOf = (id: string, query = "limit=50"): MptHolder[] => pagesOf(id, "holders", query).flatMap((page) => (page as MptHoldersPage).holders);
const transfersOf = (id: string, query = "descending=true&limit=20"): MptTransfer[] => pagesOf(id, "transfers", query).flatMap((page) => (page as MptTransfersPage).transfers);

/** D9's key orders (its reference's "Keys of …"): every key of an object is one of them, in this order. */
const ORDERS = {
  answer: ["result", "coverage", "issuance"],
  issuance: ["mpt_issuance_id", "issuer", "sequence", "ticker", "name", "asset_scale", "maximum_amount", "outstanding_amount", "escrowed_amount", "locked_amount", "locked_holders", "holders", "transfer_fee", "flags", "metadata", "metadata_hex", "metadata_conforms", "created_ledger", "created_time", "created_tx_hash", "last_ledger", "destroyed"],
  flags: ["locked", "can_lock", "require_auth", "can_escrow", "can_trade", "can_transfer", "can_clawback"],
  metadata: ["ticker", "name", "desc", "icon", "asset_class", "asset_subclass", "issuer_name", "uris", "additional_info"],
  uri: ["uri", "category", "title"],
  holders: ["result", "coverage", "count", "marker", "holders"],
  holder: ["holder", "amount", "escrowed_amount", "locked", "authorized"],
  transfers: ["result", "coverage", "count", "marker", "transfers"],
  transfer: ["ledger_index", "tx_index", "tx_hash", "executed_time", "tx_type", "kind", "source", "destination", "amount", "fee"],
  summary: ["mpt_issuance_id", "issuer", "ticker", "name", "asset_scale", "maximum_amount", "outstanding_amount", "holders", "transfer_fee", "flags", "destroyed"],
  list: ["result", "coverage", "kind", "ledger_index", "close_time", "totals", "total", "total_below", "count", "marker", "tokens"],
  row: ["rank", "mpt_issuance_id", "issuer", "ticker", "name", "asset_scale", "maximum_amount", "outstanding_amount", "holders", "transfer_fee", "flags", "transfers_24h"],
  totals: ["issuances", "holders", "transfers_24h"],
} as const;

/** The keys of `value` are some of `order`, in its order. */
const inOrder = (value: object, order: readonly string[]): boolean => {
  const places = Object.keys(value).map((key) => order.indexOf(key));
  return places.every((place, at) => place >= 0 && (at === 0 || place > places[at - 1]!));
};

// ---- What the generator is made of ------------------------------------------------------------------------------------------------

describe("the recordings", () => {
  const manifest = JSON.parse(readFileSync(new URL(`${MPT_SET}/manifest.json`, LEDGERS), "utf8")) as { source: Json; cases: Record<string, { ledger: number; hash: string; type: string }> };
  const ledgers = readLedgerSet(MPT_SET);

  it("are D9's 27 ledgers, 2,100 transactions, and a manifest that says where they came from and what its 22 cases are", () => {
    expect(ledgers).toHaveLength(27);
    expect(ledgers.reduce((sum, raw) => sum + raw.ledger.transactions.length, 0)).toBe(2100);
    expect(Object.keys(manifest)).toEqual(["source", "cases"]);
    expect(manifest.source).toMatchObject({ commit: "c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30", path: "packages/shared/test/fixtures/xrpl/mpt/", recorded_from: "wss://s2.ripple.com" });
    expect(Object.keys(manifest.cases)).toHaveLength(22);
  });

  it("hold each MPT_RECORDED hash in the ledger it names, as the manifest's case of that name says", () => {
    expect(Object.keys(MPT_RECORDED)).toEqual(["issuance_create", "issuance_create_short_keys", "payment_mint", "payment_transfer_fee", "issuance_set_lock_holder", "authorize_holder", "clawback_full", "escrow_create", "clawback_issued"]);
    for (const [name, { ledger, hash }] of Object.entries(MPT_RECORDED)) {
      expect(manifest.cases[name], name).toMatchObject({ ledger, hash });
      const raw = ledgers.find((each) => Number(each.ledger.ledger_index) === ledger);
      expect(raw?.ledger.transactions.some((tx) => tx.hash === hash), name).toBe(true);
    }
    // The cases the plan left out of MPT_RECORDED are D9's, and are recorded too: none of them is a "not found" (D9's FINDINGS lists none).
    expect(Object.keys(manifest.cases).length - Object.keys(MPT_RECORDED).length).toBe(13);
  });

  it("are the same literals the rules file has (it is pure, so that a Worker spec can import it), and the scripts re-export", () => {
    expect(RULES_IDS).toBe(ID);
    expect(RULES_RECORDED).toBe(MPT_RECORDED);
    expect(RULES_LOCKED_HOLDING).toBe(MPT_LOCKED_HOLDING);
  });

  it("name the issuance of three recorded transactions as each holds it: the lock of a holder, the payment with a transfer fee and the mint (what the active account's page and the transaction page reach)", () => {
    const txOf = (name: keyof typeof MPT_RECORDED) => ledgers.flatMap((raw) => raw.ledger.transactions).find((tx) => tx.hash === MPT_RECORDED[name].hash) as Json;
    expect(txOf("issuance_set_lock_holder").MPTokenIssuanceID).toBe(MPT_LOCKED_HOLDING);
    expect(txOf("payment_transfer_fee").Amount.mpt_issuance_id).toBe(MPT_FEE_PAYMENT_ISSUANCE);
    expect(txOf("payment_mint").Amount.mpt_issuance_id).toBe(MPT_MINT_ISSUANCE);
    // The opt-in and the clawback of the same recordings are of the mint's issuance (D9's FINDINGS).
    expect(txOf("authorize_holder").MPTokenIssuanceID).toBe(MPT_MINT_ISSUANCE);
    expect(txOf("clawback_full").Amount.mpt_issuance_id).toBe(MPT_MINT_ISSUANCE);
    // Each is an ID as the pages write one, and none is one of the ten made-up or recorded-create issuances.
    for (const id of [MPT_LOCKED_HOLDING, MPT_FEE_PAYMENT_ISSUANCE, MPT_MINT_ISSUANCE]) {
      expect(id).toMatch(/^[0-9A-F]{48}$/);
      expect(Object.values(ID)).not.toContain(id);
    }
    expect(new Set([MPT_LOCKED_HOLDING, MPT_FEE_PAYMENT_ISSUANCE, MPT_MINT_ISSUANCE]).size).toBe(3);
  });

  it("make the keys of an issuance and of a holder the way rippled does (SHA-512Half of 0x007E and the ID; of 0x0074, that key and the holder), as a recorded node has them", () => {
    const create = ledgers.flatMap((raw) => raw.ledger.transactions).find((tx) => tx.hash === MPT_RECORDED.issuance_create.hash)!;
    const issuance = (create.metaData.AffectedNodes as Json[]).map((node) => Object.values(node)[0] as Json).find((node) => node.LedgerEntryType === "MPTokenIssuance")!;
    expect(issuanceKey(ID.htf)).toBe(issuance.LedgerIndex);
    const authorize = ledgers.flatMap((raw) => raw.ledger.transactions).find((tx) => tx.hash === MPT_RECORDED.authorize_holder.hash)!;
    const token = (authorize.metaData.AffectedNodes as Json[]).map((node) => Object.values(node)[0] as Json).find((node) => node.LedgerEntryType === "MPToken")!;
    expect(mptokenKey(token.NewFields.MPTokenIssuanceID, token.NewFields.Account)).toBe(token.LedgerIndex);
  });
});

describe("the issuances' IDs", () => {
  it("are the recorded creates' for htf and shortKeys, from the created node and not the transaction's Sequence (a ticket makes that 0)", () => {
    const ledgers = readLedgerSet(MPT_SET);
    for (const [key, name] of [["htf", "issuance_create"], ["shortKeys", "issuance_create_short_keys"]] as const) {
      const tx = ledgers.flatMap((raw) => raw.ledger.transactions).find((each) => each.hash === MPT_RECORDED[name].hash)!;
      const node = (tx.metaData.AffectedNodes as Json[]).map((each) => Object.values(each)[0] as Json).find((each) => each.LedgerEntryType === "MPTokenIssuance")!;
      expect(mptIdOf(node.NewFields.Sequence, node.NewFields.Issuer), key).toBe(ID[key]);
      expect(tx.metaData.mpt_issuance_id, key).toBe(ID[key]);
    }
  });

  it("are, for the made-up ones, those of a seeded issuer and sequence, and for nodeOnly of the active account, written out in the rules file", () => {
    for (const key of ["noMetadata", "rawMetadata", "nonConforming", "destroyed", "lockedAll", "escrow", "nodeOnly", "nowhere"] as const) {
      const { issuer, sequence } = madeUpIdentity(key);
      expect(mptIdOf(sequence, issuer), key).toBe(ID[key]);
      expect(mptIssuerOf(ID[key]), key).toBe(issuer);
    }
    expect(mptIssuerOf(ID.nodeOnly)).toBe(MPT_ACCOUNT);
    expect(new Set(Object.values(ID)).size).toBe(10);
    for (const id of Object.values(ID)) expect(id).toMatch(/^[0-9A-F]{48}$/);
  });
});

// ---- The files -------------------------------------------------------------------------------------------------------------------------

describe("the files", () => {
  const files = [...generated.keys()].filter(isMptGenerated);

  it("are named by isMptGenerated, which is true of no other generator's file and of none written by hand, and which no other predicate names", () => {
    const own = [...mptPaths()];
    expect([...files].sort()).toEqual([...own].sort());
    expect(files.length).toBeGreaterThan(60);
    for (const path of files) {
      expect(isHandWritten(path), path).toBe(false);
      expect(isTokenGenerated(path), path).toBe(false);
      expect(isObjectGenerated(path), path).toBe(false);
      expect(isNftGenerated(path), path).toBe(false);
      expect(path.startsWith("xrpl/"), path).toBe(true);
    }
    expect(isMptGenerated("xrpl/data-api/tokens@kind=issued&limit=20.json")).toBe(false);
    expect(isMptGenerated("xrpl/data-api/transactions/AACAFCFEBB5C970049A576CBFE6EF544A47EE3ADBA99122FA43234D18D5FFD40.json")).toBe(false);
    expect(isMptGenerated("xrpl/node/ledger_entry/B95064B1A92F02EE009E6BDFB369CF476FB925BB8615456970E38774034A5D30.json")).toBe(false);
    expect(isMptGenerated("xahau/data-api/mpt_lookup.json")).toBe(false);
  });

  it("are XRPL's alone: Xahau has no MPT, and none is written for it", () => {
    expect(mptFixtures("xahau")).toEqual([]);
    expect(mptNodeFixtures("xahau")).toEqual([]);
    expect([...generated.keys()].filter((path) => path.startsWith("xahau/") && /\/mpt(\/|_)|kind=mpt|mpt_issuance_/.test(path))).toEqual([]);
  });

  it("are on disk as the generator writes them (the rows of the lists a line each, D9's key orders), and the list of rows is the one MPT_ROW_LISTS names", () => {
    expect(MPT_ROW_LISTS).toEqual(["holders", "transfers", "tokens"]);
    for (const path of files) expect(readFileSync(new URL(path, HTTP), "utf8"), path).toBe(generated.get(path));
    const holders = generated.get(dataApiFile("xrpl", `/v2/mpt/${ID.htf}/holders`, "limit=10")!)!;
    expect(holders.split("\n").filter((line) => line.includes('"holder"'))).toHaveLength(10);
  });

  it("name no answer for nowhere, and none of the index's for nodeOnly: the node's entry alone", () => {
    for (const path of files) {
      expect(path, "nowhere").not.toContain(ID.nowhere);
      if (path.includes(ID.nodeOnly)) expect(path).toBe(`xrpl/node/ledger_entry/mpt_issuance_${ID.nodeOnly}.json`);
    }
    expect(nodeFile("xrpl", "ledger_entry", { mpt_issuance: ID.nodeOnly, ledger_index: "validated" })).toBe(`xrpl/node/ledger_entry/mpt_issuance_${ID.nodeOnly}.json`);
    expect(nodeFile("xrpl", "ledger_entry", { mpt_issuance: ID.nowhere, ledger_index: "validated" })).toBe(`xrpl/node/ledger_entry/mpt_issuance_${ID.nowhere}.json`);
    expect(generated.has(`xrpl/node/ledger_entry/mpt_issuance_${ID.nowhere}.json`)).toBe(false);
  });

  it("add nothing to the files of the other sets: ledger-hashes.json is as the recordings of the network's sets make it, and none of its ledgers is one of the MPT set's", () => {
    expect(readFileSync(new URL("xrpl/ledger-hashes.json", HTTP), "utf8")).toBe(generated.get("xrpl/ledger-hashes.json"));
    const hashes = JSON.parse(generated.get("xrpl/ledger-hashes.json")!) as Record<string, number>;
    const mpt = new Set<number>(Object.values(MPT_RECORDED).map(({ ledger }) => ledger));
    for (const index of Object.values(hashes)) expect(mpt.has(index), `${index} is a recorded MPT ledger`).toBe(false);
  });
});

describe("the nine recorded transactions", () => {
  const recorded = readLedgerSet(MPT_SET);
  const ledgerOf = (index: number) => recorded.find((raw) => Number(raw.ledger.ledger_index) === index)!;

  it("are served as every recorded transaction is: the data API's, its binary form and the node's, and the hashes of their nine ledgers, 747 of them in ledger order", () => {
    const ledgers = new Set(Object.values(MPT_RECORDED).map(({ ledger }) => ledger));
    expect(ledgers.size).toBe(9);
    let hashes = 0;
    for (const { ledger, hash } of Object.values(MPT_RECORDED)) {
      const served = apiFile(`/v2/transactions/${hash}`).transaction as Json;
      expect(served.hash).toBe(hash);
      expect(served.ledger_index).toBe(ledger);
      expect(apiFile(`/v2/transactions/${hash}`, "binary=true").transaction.hash).toBe(hash);
      expect(JSON.parse(generated.get(nodeFile("xrpl", "tx", { transaction: hash })!)!).result).toMatchObject({ hash, ledger_index: ledger, validated: true });
    }
    for (const ledger of ledgers) {
      const list = (apiFile(`/v2/ledgers/${ledger}`, "transactions=true").ledger.transactions as string[]).slice();
      const raw = ledgerOf(ledger);
      expect(list).toHaveLength(raw.ledger.transactions.length);
      list.forEach((hash, at) => expect(raw.ledger.transactions.find((tx) => tx.hash === hash)!.metaData.TransactionIndex, hash).toBe(at));
      hashes += list.length;
    }
    expect(hashes).toBe(747);
  });

  it("have no mpt_issuance_id in the metadata the data API serves, as it has no delivered_amount of the node's: the ID is the created node's (E14 ruling C10)", () => {
    const { hash } = MPT_RECORDED.issuance_create;
    const recordedMeta = ledgerOf(MPT_RECORDED.issuance_create.ledger).ledger.transactions.find((tx) => tx.hash === hash)!.metaData;
    expect(recordedMeta.mpt_issuance_id).toBe(ID.htf);
    const served = apiFile(`/v2/transactions/${hash}`).transaction as Json;
    expect(served.meta).not.toHaveProperty("mpt_issuance_id");
    // The node's own answer keeps it: it is what a node says.
    expect(JSON.parse(generated.get(nodeFile("xrpl", "tx", { transaction: hash })!)!).result.meta.mpt_issuance_id).toBe(ID.htf);
  });
});

// ---- The issuances ---------------------------------------------------------------------------------------------------------------

describe("the issuances", () => {
  const answerOf = (key: keyof typeof MPT_FIXTURE_IDS): MptIssuanceAnswer & { result: string } => apiFile(`/v2/mpt/${ID[key]}`) as never;

  it.each(ANSWERED)("%s: the answer, the holders and the transfers pass the client's checks, in D9's key orders", (key) => {
    const answer = answerOf(key);
    expect(checkMptIssuance(answer)).toBe(answer);
    expect(inOrder(answer, ORDERS.answer)).toBe(true);
    expect(inOrder(answer.issuance, ORDERS.issuance)).toBe(true);
    expect(inOrder(answer.issuance.flags, ORDERS.flags)).toBe(true);
    if (answer.issuance.metadata !== undefined) {
      expect(inOrder(answer.issuance.metadata, ORDERS.metadata)).toBe(true);
      for (const uri of answer.issuance.metadata.uris ?? []) expect(inOrder(uri, ORDERS.uri)).toBe(true);
    }
    for (const [route, order, row] of [["holders", ORDERS.holders, ORDERS.holder], ["transfers", ORDERS.transfers, ORDERS.transfer]] as const) {
      const query = route === "holders" ? "limit=10" : "descending=true&limit=8";
      const page = apiFile(`/v2/mpt/${ID[key]}/${route}`, query);
      expect(inOrder(page, order)).toBe(true);
      expect(route === "holders" ? checkMptHoldersPage(page) : checkMptTransfersPage(page)).toBe(page);
      for (const each of page[route] as object[]) expect(inOrder(each, row)).toBe(true);
      expect(page.count).toBe(page[route].length);
      expect(page.coverage).toEqual({ from_ledger_index: MPT_COVERAGE_FROM, complete: key !== "escrow" });
    }
    expect(answer.coverage).toEqual({ from_ledger_index: MPT_COVERAGE_FROM, complete: key !== "escrow" });
  });

  it("say about their holders what the holders say: the count, the escrowed amount, the outstanding amount and what is locked", () => {
    for (const key of ANSWERED) {
      const { issuance } = answerOf(key);
      const holders = pagesOf(ID[key], "holders", key === "htf" ? "limit=50" : "limit=10").flatMap((page) => (page as MptHoldersPage).holders);
      const sum = (pick: (holder: MptHolder) => string) => holders.reduce((total, holder) => total + BigInt(pick(holder)), 0n);
      expect(issuance.holders, key).toBe(holders.length);
      expect(issuance.escrowed_amount, key).toBe(String(sum((holder) => holder.escrowed_amount)));
      expect(issuance.outstanding_amount, key).toBe(String(sum((holder) => String(BigInt(holder.amount) + BigInt(holder.escrowed_amount)))));
      if (issuance.maximum_amount !== undefined) expect(BigInt(issuance.outstanding_amount), key).toBeLessThanOrEqual(BigInt(issuance.maximum_amount));
      const locked = issuance.flags.locked ? holders : holders.filter((holder) => holder.locked && BigInt(holder.amount) > 0n);
      expect(issuance.locked_holders, key).toBe(locked.length);
      expect(issuance.locked_amount, key).toBe(String(locked.reduce((total, holder) => total + BigInt(holder.amount), 0n)));
      // The largest balance first (amount and escrow together), then by address.
      const balances = holders.map((holder) => BigInt(holder.amount) + BigInt(holder.escrowed_amount));
      balances.forEach((balance, at) => at > 0 && expect(balance <= balances[at - 1]!, key).toBe(true));
    }
  });

  it("htf: the recorded create's XAU, with D9's decoding of its metadata, its creation, and 63 holders over two pages whose marker chains: one locked, one with escrow", () => {
    const { issuance } = answerOf("htf");
    expect(issuance).toMatchObject({ mpt_issuance_id: ID.htf, issuer: "rBEERdzDHqDyYmfw2jqzyMNBZu31yzfg6q", sequence: 66652146, ticker: "XAU", name: "Tokenized Gold (XAU)", asset_scale: 4, transfer_fee: 192, holders: 63 });
    expect(issuance).toMatchObject({ created_ledger: 99337721, created_tx_hash: MPT_RECORDED.issuance_create.hash, metadata_conforms: true, destroyed: false });
    expect(issuance.flags).toEqual({ locked: false, can_lock: true, require_auth: true, can_escrow: true, can_trade: true, can_transfer: true, can_clawback: true });
    expect(issuance.metadata).toEqual(decodeMptMetadata(issuance.metadata_hex!));
    expect(issuance.metadata?.asset_class).toBe("rwa");
    const pages = pagesOf(ID.htf, "holders", "limit=50") as MptHoldersPage[];
    expect(pages.map((page) => page.count)).toEqual([50, 13]);
    expect(pages[0]!.marker).toBeDefined();
    expect(pages[1]!.marker).toBeUndefined();
    const all = pages.flatMap((page) => page.holders);
    expect(new Set(all.map((holder) => holder.holder)).size).toBe(63);
    expect(all.filter((holder) => holder.locked)).toHaveLength(1);
    expect(all.filter((holder) => BigInt(holder.escrowed_amount) > 0n)).toHaveLength(1);
    // The card's first ten are the page's first ten, and the marker of a page is the balance and the address of its last row, as D9's example is.
    const first = apiFile(`/v2/mpt/${ID.htf}/holders`, "limit=10") as MptHoldersPage;
    expect(first.holders).toEqual(all.slice(0, 10));
    for (const [page, count] of [[first, 10], [pages[0]!, 50]] as const) {
      const last = page.holders[count - 1]!;
      expect(JSON.parse(Buffer.from(page.marker!, "base64url").toString("utf8"))).toEqual([String(BigInt(last.amount) + BigInt(last.escrowed_amount)), last.holder]);
    }
  });

  it("htf: 28 transfers over three files, every kind of D9's seven, a lock of every balance without a destination, the newest first and the marker of a page the position of its last row", () => {
    const rows = transfersOf(ID.htf);
    expect(rows).toHaveLength(28);
    expect(new Set(rows.map((row) => row.kind))).toEqual(new Set(["payment", "clawback", "lock", "unlock", "escrow_create", "escrow_finish", "escrow_cancel"]));
    expect(rows.filter((row) => row.kind === "lock" && row.destination === undefined).length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.kind === "lock" && row.destination !== undefined).length).toBeGreaterThan(0);
    const places = rows.map((row) => [row.ledger_index, row.tx_index] as const);
    expect(places).toEqual([...places].sort(([la, ta], [lb, tb]) => lb - la || tb - ta));
    expect(new Set(places.map((place) => place.join("."))).size).toBe(28);
    expect(new Set(rows.map((row) => row.tx_hash)).size).toBe(28);
    const pages = pagesOf(ID.htf, "transfers", "descending=true&limit=20") as MptTransfersPage[];
    expect(pages.map((page) => page.count)).toEqual([20, 8]);
    expect(JSON.parse(Buffer.from(pages[0]!.marker!, "base64url").toString("utf8"))).toEqual([rows[19]!.ledger_index, rows[19]!.tx_index]);
    expect(apiFile(`/v2/mpt/${ID.htf}/transfers`, "descending=true&limit=8").transfers).toEqual(rows.slice(0, 8));
    // A lock's amount is the outstanding amount; a payment between two holders pays the transfer fee on top, and a mint and a redemption pay none.
    const outstanding = answerOf("htf").issuance.outstanding_amount;
    for (const row of rows.filter((each) => each.kind === "lock" && each.destination === undefined)) expect(row.amount).toBe(outstanding);
    for (const row of rows.filter((each) => each.kind === "payment")) {
      const issuer = row.source === answerOf("htf").issuance.issuer || row.destination === answerOf("htf").issuance.issuer;
      expect(row.fee !== undefined, `${row.tx_hash} ${issuer ? "pays no fee" : "pays the fee"}`).toBe(!issuer);
      if (row.fee !== undefined) expect(BigInt(row.fee)).toBe((BigInt(row.amount) * 192n) / 100_000n);
    }
  });

  // The whole-branch review's M7: the issuance's "Older →" is the marker of the card's eight, and the page of twenty behind it is a file (rows 9 to 28, the last of the 28), so the e2e can follow the link.
  it("htf: the page of 20 behind the marker of the card's 8 is the transfers 9 to 28, with none behind it", () => {
    const rows = transfersOf(ID.htf);
    const card = apiFile(`/v2/mpt/${ID.htf}/transfers`, "descending=true&limit=8") as MptTransfersPage;
    expect(JSON.parse(Buffer.from(card.marker!, "base64url").toString("utf8"))).toEqual([rows[7]!.ledger_index, rows[7]!.tx_index]);
    const behind = apiFile(`/v2/mpt/${ID.htf}/transfers`, `descending=true&limit=20&marker=${card.marker}`) as MptTransfersPage;
    expect(checkMptTransfersPage(behind)).toBe(behind);
    expect(behind.transfers).toEqual(rows.slice(8));
    expect(behind.count).toBe(20);
    expect(behind.marker).toBeUndefined();
    expect(inOrder(behind, ORDERS.transfers)).toBe(true);
  });

  it("htf is the only one with more than a first page: every other has its holders and transfers whole in the card's", () => {
    for (const key of OTHER_THAN_HTF) {
      const holders = apiFile(`/v2/mpt/${ID[key]}/holders`, "limit=10") as MptHoldersPage;
      const transfers = apiFile(`/v2/mpt/${ID[key]}/transfers`, "descending=true&limit=8") as MptTransfersPage;
      expect(holders.marker, key).toBeUndefined();
      expect(transfers.marker, key).toBeUndefined();
      expect(hasApiFile(`/v2/mpt/${ID[key]}/holders`, "limit=50"), key).toBe(false);
      expect(hasApiFile(`/v2/mpt/${ID[key]}/transfers`, "descending=true&limit=20"), key).toBe(false);
      expect(transfers.transfers.length, key).toBeGreaterThan(1);
    }
  });

  it("make the states the pages draw: no metadata, metadata that is not JSON, metadata that does not conform, destroyed, every balance locked, and escrow", () => {
    const noMetadata = answerOf("noMetadata").issuance;
    for (const key of ["ticker", "name", "metadata", "metadata_hex", "metadata_conforms", "created_ledger"]) expect(noMetadata, key).not.toHaveProperty(key);

    const raw = answerOf("rawMetadata").issuance;
    expect(raw).not.toHaveProperty("metadata");
    expect(raw.metadata_conforms).toBe(false);
    expect(Buffer.from(raw.metadata_hex!, "hex").toString("utf8")).toMatch(/^https:\/\//);

    const long = answerOf("nonConforming").issuance;
    expect(long.metadata_conforms).toBe(false);
    expect(long.name).toHaveLength(128);
    expect(long.name).not.toMatch(/\s/);
    expect(long.metadata?.desc).toHaveLength(200);
    expect(long.metadata?.uris?.some((uri) => (uri.title ?? "").length === 100)).toBe(true);
    // The links an issuer can write that a page must not trust, among them.
    expect(long.metadata?.uris?.map((uri) => uri.uri)).toEqual(expect.arrayContaining(["javascript:alert(1)", "http://mixed.example/plain", "mixed.example/about", "https://mixed.example/docs"]));
    expect(Buffer.byteLength(Buffer.from(long.metadata_hex!, "hex"))).toBeLessThanOrEqual(1024);

    const destroyed = answerOf("destroyed").issuance;
    expect([destroyed.destroyed, destroyed.holders, destroyed.outstanding_amount]).toEqual([true, 0, "0"]);
    expect((apiFile(`/v2/mpt/${ID.destroyed}/holders`, "limit=10") as MptHoldersPage).holders).toEqual([]);

    const lockedAll = answerOf("lockedAll").issuance;
    expect(lockedAll.flags.locked).toBe(true);
    expect(lockedAll.locked_amount).toBe(lockedAll.outstanding_amount);
    expect(holdersOf(ID.lockedAll, "limit=10").every((holder) => holder.locked)).toBe(true);
    expect(transfersOf(ID.lockedAll, "descending=true&limit=8").some((row) => row.kind === "lock" && row.destination === undefined)).toBe(true);

    const escrow = answerOf("escrow").issuance;
    expect(escrow).toMatchObject({ ticker: "HTF", name: "Harborline Treasury Fund", metadata_conforms: true });
    expect(BigInt(escrow.escrowed_amount)).toBeGreaterThan(0n);
    expect(holdersOf(ID.escrow, "limit=10").filter((holder) => BigInt(holder.escrowed_amount) > 0n)).toHaveLength(2);
    expect([...new Set(transfersOf(ID.escrow, "descending=true&limit=8").map((row) => row.kind))]).toEqual(expect.arrayContaining(["escrow_create", "escrow_finish", "escrow_cancel"]));
  });

  it("have D9's decoding of their metadata: a port of its decoder, long and short keys, and the issuer's word kept as it is written", () => {
    const short = decodeMptMetadata(answerOf("shortKeys").issuance.metadata_hex!)!;
    expect(Object.keys(short)).toEqual(["ticker", "name", "desc", "icon", "asset_class", "issuer_name", "uris"]);
    expect(short.ticker).toBe("XDRAGO");
    expect(answerOf("shortKeys").issuance.metadata).toEqual(short);
    expect(decodeMptMetadata("")).toBeUndefined();
    expect(decodeMptMetadata(Buffer.from("not json").toString("hex"))).toBeUndefined();
    expect(decodeMptMetadata(Buffer.from('"a string"').toString("hex"))).toBeUndefined();
    expect(decodeMptMetadata(Buffer.from('{"t":"A","n":1,"x":2,"urls":[{"url":"u","type":"c"},{"nothing":1}]}').toString("hex"))).toEqual({ ticker: "A", uris: [{ uri: "u", category: "c" }] });
    expect(metadataConforms(Buffer.from('{"t":"A","n":"A","i":"https://x","ac":"other","in":"X"}').toString("hex"))).toBe(true);
    expect(metadataConforms(Buffer.from('{"t":"a","n":"A","i":"https://x","ac":"other","in":"X"}').toString("hex"))).toBe(false);
    // A uris item with no uri is dropped by the decoding and still breaks the rule (D9's dated note).
    expect(metadataConforms(Buffer.from('{"t":"A","n":"A","i":"https://x","ac":"other","in":"X","uris":[{"c":"docs"}]}').toString("hex"))).toBe(false);
    expect(flagsOf(126)).toEqual({ locked: false, can_lock: true, require_auth: true, can_escrow: true, can_trade: true, can_transfer: true, can_clawback: true });
    expect(flagsOf(1).locked).toBe(true);
  });
});

// ---- The lookup ------------------------------------------------------------------------------------------------------------------

describe("the lookup table", () => {
  const table = apiFile("/v2/mpt_lookup") as Record<string, MptSummary>;
  /** What the mock would answer for these IDs: the table's entry or the ID alone. */
  const lookup = (ids: readonly string[]): MptLookup => ({ count: ids.length, issuances: ids.map((id) => table[id] ?? { mpt_issuance_id: id }) });

  it("holds a summary, as the client checks it, for each of the eight answered issuances and four more that the recorded transactions touch, and none for nodeOnly, nowhere or E10's synthetic one", () => {
    const ids = Object.keys(table).sort();
    expect(ids).toHaveLength(12);
    expect(Object.keys(table)).toEqual(ids);
    expect(checkMptLookup(lookup(ids), ids)).toEqual(lookup(ids));
    for (const key of ANSWERED) expect(table[ID[key]], key).toBeDefined();
    expect(table).not.toHaveProperty(ID.nodeOnly);
    expect(table).not.toHaveProperty(ID.nowhere);
    expect(table).not.toHaveProperty("0000012AB5F762798A53D543A014CAF8B297CFF8F2F937E8");
    for (const [id, summary] of Object.entries(table)) {
      expect(summary.mpt_issuance_id).toBe(id);
      expect(inOrder(summary, ORDERS.summary), id).toBe(true);
      expect(summary.issuer, id).toBe(mptIssuerOf(id));
    }
  });

  it("agrees with the answers: each answered issuance's summary is what its issuance and its holders say", () => {
    for (const key of ANSWERED) {
      const { issuance } = apiFile(`/v2/mpt/${ID[key]}`) as MptIssuanceAnswer;
      const { destroyed, flags, holders, issuer, ticker, name, asset_scale, maximum_amount, outstanding_amount, transfer_fee } = issuance;
      expect(table[ID[key]], key).toEqual({ mpt_issuance_id: ID[key], issuer, ...(ticker !== undefined && { ticker }), ...(name !== undefined && { name }), asset_scale, ...(maximum_amount !== undefined && { maximum_amount }), outstanding_amount, holders, transfer_fee, flags, destroyed });
    }
  });

  it("answers the active account's page: its holdings and payment rows with a summary, and the issuance it made (nodeOnly) bare", () => {
    const objects = JSON.parse(readFileSync(new URL(`xrpl/node/account_objects/${MPT_ACCOUNT}.json`, HTTP), "utf8")).result.account_objects as Json[];
    const holdings = objects.filter((object) => object.LedgerEntryType === "MPToken").map((object) => object.MPTokenIssuanceID as string);
    const owned = objects.filter((object) => object.LedgerEntryType === "MPTokenIssuance").map((object) => mptIdOf(object.Sequence, object.Issuer));
    const payments = JSON.parse(readFileSync(new URL(`xrpl/data-api/accounts/${MPT_ACCOUNT}/payments@descending=true&limit=20&marker=WzEwMjE4NjI0Myw2M10.json`, HTTP), "utf8")).payments as Json[];
    const paid = payments.map((row) => row.mpt_issuance_id as string);
    expect(holdings.sort()).toEqual([ID.htf, MPT_LOCKED_HOLDING].sort());
    expect(owned).toEqual([ID.nodeOnly]);
    expect(paid).toHaveLength(1);
    for (const id of [...holdings, ...paid]) expect(table[id], id).toBeDefined();
    const all = [...new Set([...holdings, ...owned, ...paid])].sort();
    const answered = lookup(all);
    expect(answered.issuances.filter((entry) => !("issuer" in entry)).map((entry) => entry.mpt_issuance_id)).toEqual([ID.nodeOnly]);
    expect(checkMptLookup(answered, all)).toBe(answered);
  });
});

describe("the active account's hand-written files", () => {
  const read = (path: string): Json => JSON.parse(readFileSync(new URL(path, HTTP), "utf8"));
  const objects = read(`xrpl/node/account_objects/${MPT_ACCOUNT}.json`).result.account_objects as Json[];

  it("hold two MPToken entries (one locked by the issuer, one with an amount in escrow) and the MPTokenIssuance it made, after the five of E10, with the keys rippled gives them", () => {
    expect(objects.map((object) => object.LedgerEntryType)).toEqual(["RippleState", "Escrow", "Check", "PayChannel", "Delegate", "MPToken", "MPToken", "MPTokenIssuance"]);
    const [escrowed, locked, issuance] = objects.slice(5) as [Json, Json, Json];
    expect(escrowed).toMatchObject({ Account: MPT_ACCOUNT, MPTokenIssuanceID: ID.htf, MPTAmount: "2500000", LockedAmount: "500000" });
    expect(escrowed.Flags & 1).toBe(0);
    expect(locked).toMatchObject({ Account: MPT_ACCOUNT, MPTokenIssuanceID: MPT_LOCKED_HOLDING, MPTAmount: "45000000" });
    expect(locked.Flags & 1).toBe(1);
    expect(locked).not.toHaveProperty("LockedAmount");
    expect(escrowed.index).toBe(mptokenKey(ID.htf, MPT_ACCOUNT));
    expect(locked.index).toBe(mptokenKey(MPT_LOCKED_HOLDING, MPT_ACCOUNT));
    expect(issuance).toMatchObject({ Issuer: MPT_ACCOUNT, index: issuanceKey(ID.nodeOnly) });
    expect(mptIdOf(issuance.Sequence, issuance.Issuer)).toBe(ID.nodeOnly);
    // The node's entry of nodeOnly is this entry, as the node writes it.
    const node = read(`xrpl/node/ledger_entry/mpt_issuance_${ID.nodeOnly}.json`).result;
    expect(node).toMatchObject({ index: issuanceKey(ID.nodeOnly), validated: true, status: "success" });
    expect(node.node).toEqual(issuance);
  });

  it("make the node's entry of nodeOnly from the recorded create's fields with another sequence and the active account as the issuer", () => {
    const { node } = read(`xrpl/node/ledger_entry/mpt_issuance_${ID.nodeOnly}.json`).result;
    const created = readLedgerSet(MPT_SET).flatMap((raw) => raw.ledger.transactions).find((tx) => tx.hash === MPT_RECORDED.issuance_create.hash)!;
    const fields = (created.metaData.AffectedNodes as Json[]).map((each) => Object.values(each)[0] as Json).find((each) => each.LedgerEntryType === "MPTokenIssuance")!.NewFields as Json;
    for (const key of ["AssetScale", "Flags", "MPTokenMetadata", "MaximumAmount", "TransferFee"]) expect(node[key], key).toEqual(fields[key]);
    expect(node.Sequence).not.toBe(fields.Sequence);
    expect(node.Issuer).toBe(MPT_ACCOUNT);
    expect(node.LedgerEntryType).toBe("MPTokenIssuance");
  });

  it("have a second page of payments that goes on with a marker (the position of its last row) to a third that holds an MPT payment of the recordings, with mpt_issuance_id last", () => {
    const dir = `xrpl/data-api/accounts/${MPT_ACCOUNT}/`;
    const second = read(`${dir}payments@descending=true&limit=20&marker=WzEwNzYzNjY3Myw3OF0.json`);
    expect(second.marker).toBe("WzEwMjE4NjI0Myw2M10");
    expect(JSON.parse(Buffer.from(second.marker, "base64url").toString("utf8"))).toEqual([second.payments[0].ledger_index, second.payments[0].tx_index]);
    const third = read(`${dir}payments@descending=true&limit=20&marker=${second.marker}.json`);
    expect(third).not.toHaveProperty("marker");
    expect(third.count).toBe(third.payments.length);
    const [row] = third.payments as Json[];
    expect(Object.keys(row!).at(-1)).toBe("mpt_issuance_id");
    expect(row).toMatchObject({ tx_hash: MPT_RECORDED.payment_transfer_fee.hash, ledger_index: MPT_RECORDED.payment_transfer_fee.ledger, currency: row!.mpt_issuance_id, issuer: mptIssuerOf(row!.mpt_issuance_id) });
    expect(row!.ledger_index).toBeLessThan(second.payments[0].ledger_index);
    // Its amounts are the integer units of the transaction, as D9 serves them: the amount, what it delivered, the most it could send and the balance changes of its two sides.
    const tx = (apiFile(`/v2/transactions/${row!.tx_hash}`).transaction as Json).tx as Json;
    expect(row).toMatchObject({ amount: tx.Amount.value, delivered_amount: tx.Amount.value, max_amount: tx.SendMax.value });
    expect(row!.destination_balance_changes).toEqual([{ counterparty: row!.issuer, currency: row!.currency, value: tx.Amount.value }]);
    expect(row!.source_balance_changes[0].value).toMatch(/^-\d+$/);
  });
});

// ---- The MPT tab -----------------------------------------------------------------------------------------------------------------

describe("the MPT tab's lists", () => {
  const first = apiFile("/v2/tokens", "kind=mpt&limit=20") as MptTokensPage;
  const second = apiFile("/v2/tokens", `kind=mpt&limit=20&marker=${first.marker}`) as MptTokensPage;
  const rows = [...first.tokens, ...second.tokens];
  const table = apiFile("/v2/mpt_lookup") as Record<string, MptSummary>;

  it("pass the client's check in D9's key orders, and have 25 issuances over two pages whose marker chains", () => {
    for (const page of [first, second, apiFile("/v2/tokens", "kind=mpt&limit=20&q=HTF") as MptTokensPage, apiFile("/v2/tokens", "kind=mpt&limit=20&q=zzz") as MptTokensPage]) {
      expect(checkMptTokens(page)).toBe(page);
      expect(inOrder(page, ORDERS.list)).toBe(true);
      expect(inOrder(page.totals!, ORDERS.totals)).toBe(true);
      for (const row of page.tokens) expect(inOrder(row, ORDERS.row)).toBe(true);
    }
    expect([first.count, second.count]).toEqual([20, 5]);
    expect(first.marker).toBeDefined();
    expect(second.marker).toBeUndefined();
    expect(first.total).toBe(25);
    expect(second.total).toBe(25);
    expect(rows.map((row) => row.rank)).toEqual(Array.from({ length: 25 }, (_, at) => at + 1));
    // The marker is D9's `["mpt", holders, issuer, id]` of the last row of the page.
    const last = first.tokens[19]!;
    expect(JSON.parse(Buffer.from(first.marker!, "base64url").toString("utf8"))).toEqual(["mpt", last.holders, last.issuer, last.mpt_issuance_id]);
  });

  it("rank the issuances by holders, then issuer, then ID, list the live ones with a known state and no more (not destroyed, not nodeOnly), and say what the summaries say", () => {
    for (let at = 1; at < rows.length; at += 1) {
      const [a, b] = [rows[at - 1]!, rows[at]!];
      expect(a.holders > b.holders || (a.holders === b.holders && (a.issuer < b.issuer || (a.issuer === b.issuer && a.mpt_issuance_id < b.mpt_issuance_id)))).toBe(true);
    }
    expect(rows[0]!.mpt_issuance_id).toBe(ID.htf);
    const ids = rows.map((row) => row.mpt_issuance_id);
    expect(new Set(ids).size).toBe(25);
    expect(ids).not.toContain(ID.destroyed);
    expect(ids).not.toContain(ID.nodeOnly);
    for (const id of ids) {
      const summary = table[id];
      if (summary === undefined) continue;
      const { destroyed: _destroyed, ...rest } = summary;
      expect(rows.find((row) => row.mpt_issuance_id === id), id).toMatchObject(rest);
    }
    // Every issuance that has an answer and is live is listed: they are what a visitor opens from the tab.
    for (const key of ANSWERED.filter((each) => each !== "destroyed")) expect(ids, key).toContain(ID[key]);
  });

  it("say totals of the whole kind: the issuances, the holders (no more than the rows' sum) and the payments of the day, the sum of the rows'", () => {
    expect(first.totals).toEqual(second.totals);
    expect(first.totals!.issuances).toBe(25);
    expect(first.totals!.transfers_24h).toBe(rows.reduce((sum, row) => sum + row.transfers_24h, 0));
    expect(first.totals!.holders).toBeLessThanOrEqual(rows.reduce((sum, row) => sum + row.holders, 0));
    expect(first.totals!.holders).toBeGreaterThan(rows[0]!.holders);
    // htf's `transfers_24h` is the payments of its list within 24 hours of the newest ledger.
    const day = Date.parse(first.close_time!) / 1000 - 86_400;
    expect(rows[0]!.transfers_24h).toBe(transfersOf(ID.htf).filter((row) => row.kind === "payment" && Date.parse(row.executed_time) / 1000 > day).length);
    expect(rows[0]!.transfers_24h).toBeGreaterThan(0);
  });

  it("search HTF finds the one issuance that says so, whose coverage is not complete, ranked among the match; zzz finds none, and both keep the totals of the whole kind", () => {
    const found = apiFile("/v2/tokens", "kind=mpt&limit=20&q=HTF") as MptTokensPage;
    expect(found.tokens.map((row) => row.mpt_issuance_id)).toEqual([ID.escrow]);
    expect([found.total, found.count, found.tokens[0]!.rank]).toEqual([1, 1, 1]);
    expect(found.coverage).toEqual({ from_ledger_index: MPT_COVERAGE_FROM, complete: false });
    expect(found.tokens[0]).toMatchObject({ ...rows.find((row) => row.mpt_issuance_id === ID.escrow)!, rank: 1 });
    expect(found.totals).toEqual(first.totals);

    const none = apiFile("/v2/tokens", "kind=mpt&limit=20&q=zzz") as MptTokensPage;
    expect([none.total, none.count, none.tokens]).toEqual([0, 0, []]);
    expect(none.coverage).toEqual({ from_ledger_index: MPT_COVERAGE_FROM, complete: true });
    expect(none.totals).toEqual(first.totals);
    // No issuance of the list says zzz, and htf (XAU) is not what HTF finds.
    for (const row of rows) expect(`${row.ticker ?? ""}${row.name ?? ""}`.toLowerCase(), row.mpt_issuance_id).not.toContain("zzz");
  });

  it("are as of the newest ledger the fixtures record", () => {
    for (const page of [first, second]) {
      expect(page.coverage).toEqual({ from_ledger_index: MPT_COVERAGE_FROM, complete: true });
      expect(page.ledger_index).toBe(107721455);
      expect(page.close_time).toBe("2026-10-17T17:01:12Z");
    }
  });
});
