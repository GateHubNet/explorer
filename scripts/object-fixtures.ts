// The data API's answers (D5, data-api-new `feat/explorer-data-2` at PIN 0c2e58c3995cb3fdc240c3bf89dea9c4ab1e8adb) for the escrows, checks and payment channels of the ledgers D5
// recorded for its objects (`ledgers/xrpl-objects/`, `ledgers/xahau-objects/`), the lookups of their IDs, the transactions behind them, and the nodes' `ledger_entry` of the objects still
// in the ledger. http-fixtures.ts calls `objectFixtures` from `generate()`, so `pnpm fixtures:sync` writes the files; test/fixtures/PROVENANCE.md ("Ledger object answers") says what
// they are made of, and test/unit/object-fixtures.test.ts checks them.
//
// Derived (scripts/object-derive.ts, the port of D5's parser and answers), for every object of the recordings (XRPL 27 with the delegation, Xahau 9: the 190 escrow cancels of the
// token testers in ledger 106179366 that the manifest does not name are left out of the index, `leftOutOf`), as of the newest ledger of
// the network's set (XRPL 107972102, Xahau 26399329: `asOf`), with the feature's coverage from the set's first ledger, `{ from_ledger_index, complete: false }`, which an object
// whose creation is indexed has complete (D5's `itemCoverage`, C8):
//
//   escrows|checks|payment_channels/<ID>.json               the object and its newest 50 events, newest first, and `history_marker` when there are more
//   escrows|checks|payment_channels/<ID>/history@descending=true&limit=50&marker=<M>.json    the older events behind each marker (only `channel-long` has more than 50)
//   ledger_objects/<ID>.json                                 `{ result, ledger_object }`: the type, the owner and whether the newest row deleted it, for every ID (the delegation's too)
//   transactions/<HASH>.json, …@binary=true.json             the transactions with a tracked node, a `Delegate` field or of type `DelegateSet` (C3), but those `generate()` serves already
//                                                            from `SETS`, and the synthetic ones (the synthetic objects' and C9's)
//   ledgers/<index>@transactions=true.json                   the hashes of a ledger of those transactions that is not among `SETS`, which the transaction page reads for its neighbours,
//                                                            the synthetic transactions last
//   node/ledger_entry/<ID>.json                              xahaud's and rippled's `ledger_entry` of every object still in the ledger at `asOf`
//
// One open recorded escrow and one open recorded check (the first of each by ID) have a node file and no index file: the node fallback (`escrow-node-only`, `check-node-only`).
//
// Synthetic (XRPL, seeded `mulberry32(seedOf("xrpl", "objects", <name>))`, IDs their keylets of their own accounts and sequences, each event a transaction made here and parsed by the
// port, in a recorded ledger that is not among `SETS` at a transaction index past the ledger's own: `placesOf`, its hash that of its serialization): the states the recordings
// cannot give. The active account `OBJECTS_ACCOUNT` owns an escrow that
// can be cancelled, one that was cancelled and a closing channel, and is the destination of an expired check (its Objects tab: C7); an escrow that is pending, one that can be
// finished, an MPT escrow, and a channel with 120 events (three pages). Their transactions have files, as every event's link leads to one, but `channel-long`'s
// (`UNSERVED_SYNTHETIC`: a paging fixture, its events link to transactions that are not served). Synthetic too (C9), D5's `delegatedFrom` and
// `delegate_set_empty` over recorded transactions of the ledger of the recorded `DelegateSet`: a delegated Payment, a delegated `tec`, an empty `DelegateSet` and a failed one. They
// are not rows of the index: D5 never indexed them, and the recorded delegation stays as it is.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { decodeAccountID, encodeAccountID } from "ripple-address-codec";

import type { Coverage, LedgerWithHashes, ObjectApiKind, TxObject } from "../app/server/api-types";
import { escrowPreimage } from "../app/server/keylet";
import { XRPL_ACCOUNT } from "../test/e2e/fixtures";
import { dataApiFile, nodeFile, type NetworkName } from "../test/support/upstream-core";
import {
  binaryTx,
  dataApiLedger,
  dataApiTx,
  fixtureText,
  inLedgerOrder,
  LEDGERS,
  readLedgerSet,
  servedHashes,
  SETS,
  TX_HASH_PREFIX,
  unixOf,
  type RawLedger,
  type RawTx,
} from "./http-fixtures";
import {
  derivedAnswer,
  derivedHistory,
  derivedLookup,
  derivedObjectRows,
  DETAIL_EVENTS,
  rowsOfTransaction,
  type AsOf,
  type DerivedObjectRow,
  type TrackedType,
} from "./object-derive";
import { mulberry32, seedOf } from "./synthetic";

/** The recorded set of each network: not among `SETS` of http-fixtures.ts (Ruling 7), their ledgers are newer than the day the other answers are dated to. */
export const OBJECT_SETS: Record<NetworkName, string> = { xrpl: "xrpl-objects", xahau: "xahau-objects" };

/** The lists whose rows are one line each: an object's events, an account's delegations. */
export const OBJECT_ROW_LISTS: readonly string[] = ["history", "delegations"];

/** The active hand-written XRPL account (test/e2e/fixtures.ts's `XRPL_ACCOUNT`), whose Objects tab and Delegation tab the synthetic objects and the delegations files fill. */
export const OBJECTS_ACCOUNT = XRPL_ACCOUNT;

/** The delegate of D5's synthetic delegated transactions (`SYNTHETIC_DELEGATE` of packages/shared/test/synthetic-delegated.ts at PIN): the genesis account, which no recorded transaction names. */
export const SYNTHETIC_DELEGATE = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

/** The MPT issuance of D5's synthetic MPT escrow (`MPT_ISSUANCE` of object-changes.parser.spec.ts at PIN). */
export const SYNTHETIC_MPT_ISSUANCE = "0000012AB5F762798A53D543A014CAF8B297CFF8F2F937E8";

/**
 * The synthetic objects whose transactions have no file (controller ruling of Task 2's second fix round): `channel-long` is a paging fixture, and its 120 transactions (about 250 KB
 * with their binary forms) are links nobody follows; they are in no ledger's list either.
 */
export const UNSERVED_SYNTHETIC: readonly string[] = ["channel-long"];

/** How many events the object page asks for behind a marker: a page of the detail's size. */
export const HISTORY_LIMIT = DETAIL_EVENTS;

const NATIVE: Record<NetworkName, "XRP" | "XAH"> = { xrpl: "XRP", xahau: "XAH" };
const KIND_OF: Readonly<Record<string, ObjectApiKind>> = { Escrow: "escrow", Check: "check", PayChannel: "payment_channel" };
const ROUTE_OF: Readonly<Record<ObjectApiKind, string>> = { escrow: "escrows", check: "checks", payment_channel: "payment_channels" };
const RIPPLE_EPOCH = 946_684_800;
const DAY = 86_400;

// ---- Small things ------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

const HEX = "0123456789ABCDEF";
const hexOf = (next: () => number, digits: number): string => Array.from({ length: digits }, () => HEX[Math.floor(next() * 16)]!).join("");
const accountOf = (next: () => number): string => encodeAccountID(Uint8Array.from({ length: 20 }, () => Math.floor(next() * 256)));
const drawIn = (next: () => number, low: number, high: number): number => low + Math.floor(next() * (high - low + 1));
const drops = (whole: number): string => String(whole * 1_000_000);
/** A Ripple-epoch time from unix seconds. */
const rippleOf = (unix: number): number => unix - RIPPLE_EPOCH;

/** SHA-512Half (the first 32 bytes of SHA-512, upper-case hex) of a keylet's preimage: rippled's `Indexes.cpp`. */
const sha512Half = (preimage: Uint8Array): string => createHash("sha512").update(preimage).digest("hex").slice(0, 64).toUpperCase();
/** A keylet of a namespace and parts, as hex. */
const keylet = (space: string, ...parts: string[]): string => sha512Half(Buffer.from(space + parts.join(""), "hex"));
const accountHex = (address: string): string => Buffer.from(decodeAccountID(address)).toString("hex");
const u32 = (n: number): string => n.toString(16).padStart(8, "0");
/**
 * The keylets of the four types: Escrow `u` (0x75) of owner and sequence, Check `C` (0x43) of owner and sequence, PayChannel `x` (0x78) of owner, destination and sequence, Delegate `E` (0x45)
 * of account and authorize. The escrow's preimage is the Worker's (`escrowPreimage` of app/server/keylet.ts, whose `escrowKeylet` hashes it with Web Crypto, which is asynchronous and this
 * generator is not): the layout is written once, and only the hash is Node's here.
 */
export const escrowKeylet = (owner: string, sequence: number): string => sha512Half(escrowPreimage(owner, sequence));
export const checkKeylet = (owner: string, sequence: number): string => keylet("0043", accountHex(owner), u32(sequence));
export const channelKeylet = (owner: string, destination: string, sequence: number): string => keylet("0078", accountHex(owner), accountHex(destination), u32(sequence));
export const delegateKeylet = (account: string, authorize: string): string => keylet("0045", accountHex(account), accountHex(authorize));

/**
 * The hash of a transaction made here: SHA-512Half of `TXN\0` and its serialization, as every transaction's (its `?binary=true` form re-hashes to it). D5 names its synthetic
 * transactions `syntheticHash(name, base)` instead; these are served beside their binary form, which must agree. A made transaction differs from its base, so it is none of the recorded ones.
 */
function hashOfMade(raw: RawLedger, tx: RawTx): string {
  const blob = binaryTx("xrpl", dataApiTx(raw, tx)).tx as string;
  return createHash("sha512").update(Buffer.from(TX_HASH_PREFIX + blob, "hex")).digest("hex").slice(0, 64).toUpperCase();
}

// ---- The world of a network ---------------------------------------------------------------------------------------------------------

/** A transaction and the ledger it is in (recorded, or made here at a place of its own). */
interface Placed {
  raw: RawLedger;
  tx: RawTx;
}

/** A synthetic transaction of C9: its case and where it is. */
export interface DelegationTx extends Placed {
  name: "delegated-payment" | "delegated-tec" | "delegate-set-empty" | "delegate-set-failed";
}

export interface ObjectWorld {
  net: NetworkName;
  /** The recorded set, oldest first. */
  ledgers: RawLedger[];
  /** The newest ledger of the set, which every answer is as of. */
  head: RawLedger;
  asOf: AsOf;
  /** The feature's coverage: from the set's first ledger, not whole (the networks had these objects before). */
  coverage: Coverage;
  /** The index's rows: the recordings', then the synthetic objects'. */
  rows: DerivedObjectRow[];
  /** Every transaction a row names, and the synthetic ones of C9, by hash. */
  txs: Map<string, Placed>;
  /** The synthetic objects, by name. */
  synthetic: Map<string, string>;
  /** The objects with a node file and no index file. */
  nodeOnly: Set<string>;
  /** The transactions with a file (C3), in ledger order. */
  served: Placed[];
  /** The synthetic transactions of C9. */
  delegation: DelegationTx[];
  /** Every synthetic transaction (C9's and the synthetic objects'), in the order they were placed. */
  made: Placed[];
}

/** The hashes the manifest of the set names: its cases and its supporting transactions. */
function manifestNamed(net: NetworkName): Set<string> {
  const manifest = JSON.parse(readFileSync(new URL(`${OBJECT_SETS[net]}/manifest.json`, LEDGERS), "utf8")) as { cases?: Record<string, { hash: string }>; txs?: Record<string, unknown> };
  return new Set([...Object.values(manifest.cases ?? {}).map((entry) => entry.hash), ...Object.keys(manifest.txs ?? {})]);
}

/**
 * The transactions the index is left without (controller ruling of E10 Task 2's review): the 190 escrow cancels of ledger 106179366 that the manifest does not name, the token-escrow
 * testers cancelling 190 escrows created before the recordings. Their escrows would be answers no case uses, with links to transaction pages the budget cannot hold (0.9 MB, C4);
 * the case `escrow_cancel` (the third party's cancel of `E81C0A08…`) stays.
 */
function leftOutOf(ledgers: readonly RawLedger[], named: ReadonlySet<string>): Set<string> {
  const left = new Set<string>();
  for (const raw of ledgers) for (const tx of raw.ledger.transactions) if (tx.TransactionType === "EscrowCancel" && !named.has(tx.hash)) left.add(tx.hash);
  return left;
}

/** The indexes of the ledgers of `SETS` (their files' names), whose ledger answers generate() writes. */
function setLedgerIndexes(net: NetworkName): Set<number> {
  const indexes = new Set<number>();
  for (const set of SETS[net]) for (const name of readdirSync(new URL(`${set}/`, LEDGERS))) if (name.endsWith(".json.gz")) indexes.add(Number(name.slice(0, -".json.gz".length)));
  return indexes;
}

/**
 * The places past each ledger's own transactions that synthetic transactions take: the next index of a ledger is its count, then one more for each place given. A ledger of `SETS`
 * gives none: its list of hashes is generate()'s, the recorded one.
 */
function placesOf(ledgers: readonly RawLedger[], inSets: ReadonlySet<number>): (index: number) => { raw: RawLedger; at: number } {
  const given = new Map<number, number>();
  const byIndex = new Map(ledgers.map((raw) => [Number(raw.ledger.ledger_index), raw]));
  return (index) => {
    const raw = byIndex.get(index);
    if (raw === undefined) throw new Error(`no recorded objects ledger ${index}`);
    if (inSets.has(index)) throw new Error(`ledger ${index} is one of SETS: its list is the recorded one`);
    const taken = given.get(index) ?? 0;
    given.set(index, taken + 1);
    return { raw, at: raw.ledger.transactions.length + taken };
  };
}

/** The world of a network's objects. */
export function objectWorld(net: NetworkName): ObjectWorld {
  const ledgers = readLedgerSet(OBJECT_SETS[net]);
  const head = ledgers.at(-1)!;
  const asOf: AsOf = { ledger_index: Number(head.ledger.ledger_index), close_time: unixOf(head.ledger.close_time) };
  const coverage: Coverage = { from_ledger_index: Number(ledgers[0]!.ledger.ledger_index), complete: false };
  const txs = new Map<string, Placed>();
  for (const raw of ledgers) for (const tx of raw.ledger.transactions) txs.set(tx.hash, { raw, tx });

  const named = manifestNamed(net);
  const leftOut = leftOutOf(ledgers, named);
  const recorded = derivedObjectRows(ledgers).filter((row) => !leftOut.has(row.tx_hash));
  const rows = [...recorded];
  const synthetic = new Map<string, string>();
  const delegation: DelegationTx[] = [];
  const made: Placed[] = [];
  const toServe: Placed[] = [];
  if (net === "xrpl") {
    const place = placesOf(ledgers, setLedgerIndexes(net));
    // C9 first: its places are the first past the ledger's own.
    for (const each of delegationTransactions(ledgers, place)) {
      delegation.push(each);
      made.push(each);
      toServe.push(each);
    }
    for (const object of syntheticObjects(place)) {
      synthetic.set(object.name, object.id);
      for (const placed of object.txs) {
        made.push(placed);
        if (!UNSERVED_SYNTHETIC.includes(object.name)) toServe.push(placed);
        rows.push(...rowsOfTransaction(placed.raw, placed.tx));
      }
    }
    for (const placed of made) {
      if (txs.has(placed.tx.hash)) throw new Error(`a made transaction has the hash of another: ${placed.tx.hash}`);
      txs.set(placed.tx.hash, placed);
    }
  }

  // The node fallback (XRPL): the first open recorded escrow and check by ID.
  const nodeOnly = new Set<string>();
  if (net === "xrpl") {
    const recordedIds = new Set(recorded.map((row) => row.object_id));
    const open = openObjects(rows, asOf);
    for (const type of ["Escrow", "Check"] as const) {
      const first = [...open].filter(([id, row]) => row.object_type === type && recordedIds.has(id)).map(([id]) => id).sort()[0];
      if (first === undefined) throw new Error(`no open recorded ${type} for the node fallback`);
      nodeOnly.add(first);
    }
  }

  // The transactions with a file (C3): a row of the index, a `Delegate` field or a `DelegateSet`, but those generate() serves; then the synthetic ones but `UNSERVED_SYNTHETIC`'s.
  const already = servedHashes(net);
  const indexed = new Set(recorded.map((row) => row.tx_hash));
  const served: Placed[] = [];
  for (const raw of ledgers) {
    for (const tx of inLedgerOrder(raw)) {
      const wanted = indexed.has(tx.hash) || typeof tx.Delegate === "string" || tx.TransactionType === "DelegateSet";
      if (wanted && !already.has(tx.hash)) served.push({ raw, tx });
    }
  }
  served.push(...toServe);

  return { net, ledgers, head, asOf, coverage, rows, txs, synthetic, nodeOnly, served, delegation, made };
}

/** The objects still in the ledger at `asOf`: their newest row, by ID (a deleted one is gone). */
function openObjects(rows: readonly DerivedObjectRow[], asOf: AsOf): Map<string, DerivedObjectRow> {
  const newest = new Map<string, DerivedObjectRow>();
  for (const row of rows) {
    if (row.ledger_index > asOf.ledger_index) continue;
    const seen = newest.get(row.object_id);
    if (seen === undefined || row.ledger_index > seen.ledger_index || (row.ledger_index === seen.ledger_index && row.tx_index > seen.tx_index)) newest.set(row.object_id, row);
  }
  for (const [id, row] of newest) if (row.action === "deleted") newest.delete(id);
  return newest;
}

// ---- C9: the synthetic delegation transactions --------------------------------------------------------------------------------------

/** The node of `type` in a transaction's metadata, and its wrapper's key. */
function nodeIn(tx: RawTx, type: string): { op: string; node: Json } {
  for (const wrapper of tx.metaData.AffectedNodes as Json[]) {
    const [op, node] = Object.entries(wrapper)[0] as [string, Json];
    if (node.LedgerEntryType === type) return { op, node };
  }
  throw new Error(`${tx.hash}: no ${type} node`);
}

/** A recorded transaction made into another one at a place of its own: a copy, edited, at the place's index, with the hash of what it is now (`hashOfMade`). */
function madeFrom(base: Placed, at: number, edit: (tx: Json, meta: Json) => void): RawTx {
  const copy = structuredClone(base.tx) as RawTx;
  edit(copy as unknown as Json, copy.metaData as unknown as Json);
  copy.metaData.TransactionIndex = at;
  copy.hash = hashOfMade(base.raw, copy);
  if (copy.hash === base.tx.hash) throw new Error(`${base.tx.hash}: a made transaction is its base`);
  return copy;
}

/** The sender's root after a transaction of its next sequence: the sequence it used before, and the one after it. */
function nextSequence(tx: Json, root: Json): void {
  (root.FinalFields as Json).Sequence = Number(tx.Sequence) + 1;
  (root.PreviousFields as Json).Sequence = Number(tx.Sequence);
}

/** D5's `delegatedFrom`: the transaction as if its `Account` had delegated it, the fee paid by the delegate (its `AccountRoot` appended), the sender's balance keeping it. */
function delegatedEdit(tx: Json, meta: Json): void {
  const fee = BigInt(tx.Fee as string);
  if (fee === 0n) throw new Error("a transaction that pays no fee has none for a delegate to take");
  const sender = (meta.AffectedNodes as Json[])
    .map((wrapper) => Object.values(wrapper)[0] as Json)
    .find((node) => node.LedgerEntryType === "AccountRoot" && (node.FinalFields as Json | undefined)?.Account === tx.Account);
  if (sender === undefined) throw new Error("the metadata has no AccountRoot of the sender");
  const final = sender.FinalFields as Json;
  const previous = sender.PreviousFields as Json | undefined;
  const balance = BigInt(final.Balance as string) + fee;
  final.Balance = String(balance);
  if (previous !== undefined && String(balance) === previous.Balance) delete previous.Balance;
  tx.Delegate = SYNTHETIC_DELEGATE;
  const held = 100_000_000n;
  (meta.AffectedNodes as Json[]).push({
    ModifiedNode: {
      FinalFields: { Account: SYNTHETIC_DELEGATE, Balance: String(held), Flags: 0, OwnerCount: 0, Sequence: 1 },
      LedgerEntryType: "AccountRoot",
      // Every node of the ledger's metadata has its index; the delegate's is seeded, so the two delegated transactions name one node.
      LedgerIndex: hexOf(mulberry32(seedOf("xrpl", "objects", "delegate-root")), 64),
      PreviousFields: { Balance: String(held + fee) },
    },
  });
}

/**
 * C9, in the ledger of the recorded `DelegateSet` (`delegate_set_create`, 107558036), past its own transactions: a delegated Payment and a delegated `tec` (D5's `delegatedFrom`
 * over the ledger's first successful XRP Payment between two accounts and its first `tec` Payment between two accounts), the `DelegateSet` with an empty list that deletes the
 * recorded delegation (D5's `delegate_set_empty`), and the same `DelegateSet` failed with `tecINSUFFICIENT_RESERVE` (it touched the sender's root alone: its fee and sequence).
 */
function delegationTransactions(ledgers: readonly RawLedger[], place: ReturnType<typeof placesOf>): DelegationTx[] {
  let base: Placed | undefined;
  for (const raw of ledgers) for (const tx of raw.ledger.transactions) if (tx.TransactionType === "DelegateSet" && tx.metaData.TransactionResult === "tesSUCCESS") base ??= { raw, tx };
  if (base === undefined) throw new Error("the recordings have no DelegateSet");
  const ledger = base.raw;
  const own = inLedgerOrder(ledger);
  const payment = own.find((tx) => tx.TransactionType === "Payment" && tx.metaData.TransactionResult === "tesSUCCESS" && typeof tx.Amount === "string" && tx.Destination !== tx.Account && !("ParentBatchID" in tx.metaData) && tx.Fee !== "0");
  const tec = own.find((tx) => tx.TransactionType === "Payment" && tx.metaData.TransactionResult.startsWith("tec") && tx.Destination !== tx.Account && tx.Fee !== "0");
  if (payment === undefined || tec === undefined) throw new Error(`ledger ${ledger.ledger_index} has no Payment to delegate`);
  const index = Number(ledger.ledger.ledger_index);
  const at = () => place(index).at;
  const set = base;

  const made: DelegationTx[] = [
    { name: "delegated-payment", raw: ledger, tx: madeFrom({ raw: ledger, tx: payment }, at(), delegatedEdit) },
    { name: "delegated-tec", raw: ledger, tx: madeFrom({ raw: ledger, tx: tec }, at(), delegatedEdit) },
    {
      name: "delegate-set-empty",
      raw: ledger,
      tx: madeFrom(set, at(), (tx, meta) => {
        const nodes = meta.AffectedNodes as Json[];
        const created = nodeIn(set.tx, "Delegate").node;
        tx.Permissions = [];
        // The account's next transaction.
        tx.Sequence = Number(tx.Sequence) + 1;
        const delegate = nodes.findIndex((wrapper) => (Object.values(wrapper)[0] as Json).LedgerEntryType === "Delegate");
        nodes[delegate] = {
          DeletedNode: {
            LedgerEntryType: "Delegate",
            LedgerIndex: created.LedgerIndex,
            FinalFields: { ...(created.NewFields as Json), Flags: 0, OwnerNode: "0", PreviousTxnID: set.tx.hash, PreviousTxnLgrSeq: index },
          },
        };
        // The entry and its directory page exist already: no new directory.
        meta.AffectedNodes = nodes.filter((wrapper) => !("CreatedNode" in wrapper && (wrapper.CreatedNode as Json).LedgerEntryType === "DirectoryNode"));
        const root = nodeIn({ ...set.tx, metaData: meta } as unknown as RawTx, "AccountRoot").node;
        const final = root.FinalFields as Json;
        const previous = (root.PreviousFields ??= {}) as Json;
        previous.OwnerCount = final.OwnerCount;
        final.OwnerCount = Number(final.OwnerCount) - 1;
        nextSequence(tx, root);
      }),
    },
    {
      name: "delegate-set-failed",
      raw: ledger,
      tx: madeFrom(set, at(), (tx, meta) => {
        // The account's transaction after the empty one.
        tx.Sequence = Number(tx.Sequence) + 2;
        const root = nodeIn(set.tx, "AccountRoot").node;
        const final = { ...(root.FinalFields as Json) };
        const previous = { ...(root.PreviousFields as Json) };
        // A tec keeps the fee and the sequence, and nothing else: the owner count is as it was.
        if (previous.OwnerCount !== undefined) final.OwnerCount = previous.OwnerCount;
        delete previous.OwnerCount;
        const failed = { ...root, FinalFields: final, PreviousFields: previous };
        nextSequence(tx, failed);
        meta.AffectedNodes = [{ ModifiedNode: failed }];
        meta.TransactionResult = "tecINSUFFICIENT_RESERVE";
      }),
    },
  ];
  return made;
}

// ---- The synthetic objects ------------------------------------------------------------------------------------------------------------

/** A synthetic object: its name (its case), its ID, and its transactions. */
interface SyntheticObject {
  name: string;
  id: string;
  txs: Placed[];
}

/**
 * One synthetic transaction at a place of its own: its fields (the type's own, a fee, flags and a `LastLedgerSequence`; no signature) and the nodes of its metadata, the object's
 * alone, and the hash of its serialization (`hashOfMade`).
 */
function placedTx(at: { raw: RawLedger; at: number }, tx: Json, nodes: Json[]): Placed {
  const made = {
    ...tx,
    Fee: "12",
    Flags: tx.Flags ?? 0,
    LastLedgerSequence: Number(at.raw.ledger.ledger_index) + 20,
    hash: "",
    metaData: { AffectedNodes: nodes, TransactionIndex: at.at, TransactionResult: "tesSUCCESS" },
  } as unknown as RawTx;
  made.hash = hashOfMade(at.raw, made);
  return { raw: at.raw, tx: made };
}

/** The close time (Ripple epoch) of a recorded ledger. */
const closeOf = (raw: RawLedger): number => raw.ledger.close_time;

/**
 * The synthetic objects of XRPL (module header): each made of transactions in the recorded ledgers, so that the port derives them as it does the recorded ones. The three live ones of
 * `OBJECTS_ACCOUNT` and the cancelled one are made in ledgers before the explorer's newest (107721455), whose `account_objects` they are in (by hand).
 */
function syntheticObjects(place: ReturnType<typeof placesOf>): SyntheticObject[] {
  const objects: SyntheticObject[] = [];
  const draw = (name: string) => mulberry32(seedOf("xrpl", "objects", name));

  /** An escrow: `finishAfter` and `cancelAfter` are seconds after its creation, `finishAt` a Ripple-epoch time; `cancelled` the ledger of its `EscrowCancel` by the owner. */
  const escrow = (
    name: string,
    o: { owner?: string; amount: unknown; created: number; finishAfter?: number; finishAt?: number; cancelAfter?: number; cancelled?: number },
  ) => {
    const next = draw(name);
    const owner = o.owner ?? accountOf(next);
    const destination = accountOf(next);
    const sequence = drawIn(next, 90_000_000, 99_000_000);
    const id = escrowKeylet(owner, sequence);
    const where = place(o.created);
    const start = closeOf(where.raw);
    const finishAfter = o.finishAt ?? (o.finishAfter === undefined ? undefined : start + o.finishAfter);
    const fields: Json = {
      Account: owner,
      Amount: o.amount,
      ...(o.cancelAfter !== undefined && { CancelAfter: start + o.cancelAfter }),
      Destination: destination,
      DestinationNode: "0",
      ...(finishAfter !== undefined && { FinishAfter: finishAfter }),
      Sequence: sequence,
    };
    const create = placedTx(
      where,
      {
        TransactionType: "EscrowCreate",
        Account: owner,
        Amount: o.amount,
        ...(fields.CancelAfter !== undefined && { CancelAfter: fields.CancelAfter }),
        Destination: destination,
        ...(fields.FinishAfter !== undefined && { FinishAfter: fields.FinishAfter }),
        Sequence: sequence,
      },
      [{ CreatedNode: { LedgerEntryType: "Escrow", LedgerIndex: id, NewFields: fields } }],
    );
    const txs = [create];
    if (o.cancelled !== undefined) {
      txs.push(
        placedTx(place(o.cancelled), { TransactionType: "EscrowCancel", Account: owner, Owner: owner, OfferSequence: sequence, Sequence: sequence + 7 }, [
          {
            DeletedNode: {
              LedgerEntryType: "Escrow",
              LedgerIndex: id,
              FinalFields: { ...fields, Flags: 0, OwnerNode: "0", PreviousTxnID: create.tx.hash, PreviousTxnLgrSeq: Number(where.raw.ledger.ledger_index) },
            },
          },
        ]),
      );
    }
    objects.push({ name, id, txs });
  };

  // The account's: an escrow that can be cancelled (both times passed before the as-of ledger), and one that was cancelled.
  escrow("escrow-cancellable", { owner: OBJECTS_ACCOUNT, amount: drops(25), created: 107641123, finishAfter: 3_600, cancelAfter: DAY });
  escrow("escrow-cancelled", { owner: OBJECTS_ACCOUNT, amount: drops(40), created: 107558036, finishAfter: 3_600, cancelAfter: DAY, cancelled: 107624182 });
  // Others': pending until 2030 (it stays pending whenever a page reads it from the node), one that can be finished and has no CancelAfter, and an MPT escrow (D5's issuance).
  escrow("escrow-pending", { amount: drops(100), created: 107967068, finishAt: rippleOf(Date.UTC(2030, 0, 1) / 1000) });
  escrow("escrow-finishable", { amount: drops(10), created: 107897249, finishAfter: DAY });
  escrow("escrow-mpt", { amount: { mpt_issuance_id: SYNTHETIC_MPT_ISSUANCE, value: "250" }, created: 107945438, finishAt: rippleOf(Date.UTC(2030, 5, 1) / 1000) });

  // A check to the account that expired a day after it was written, before the as-of ledger.
  {
    const name = "check-expired";
    const next = draw(name);
    const owner = accountOf(next);
    const sequence = drawIn(next, 90_000_000, 99_000_000);
    const id = checkKeylet(owner, sequence);
    const where = place(107641123);
    const fields: Json = { Account: owner, Destination: OBJECTS_ACCOUNT, DestinationNode: "0", Expiration: closeOf(where.raw) + DAY, SendMax: drops(100), Sequence: sequence };
    const tx = placedTx(
      where,
      { TransactionType: "CheckCreate", Account: owner, Destination: OBJECTS_ACCOUNT, Expiration: fields.Expiration, SendMax: drops(100), Sequence: sequence },
      [{ CreatedNode: { LedgerEntryType: "Check", LedgerIndex: id, NewFields: fields } }],
    );
    objects.push({ name, id, txs: [tx] });
  }

  const channel = (name: string, o: { owner?: string; amount: number; settleDelay: number; created: number }, events: (c: ChannelState) => void) => {
    const next = draw(name);
    const owner = o.owner ?? accountOf(next);
    const destination = accountOf(next);
    const sequence = drawIn(next, 90_000_000, 99_000_000);
    const id = channelKeylet(owner, destination, sequence);
    const where = place(o.created);
    const fields: Json = {
      Account: owner,
      Amount: drops(o.amount),
      Destination: destination,
      DestinationNode: "0",
      PublicKey: `03${hexOf(next, 64)}`,
      Sequence: sequence,
      SettleDelay: o.settleDelay,
    };
    const create = placedTx(
      where,
      {
        TransactionType: "PaymentChannelCreate",
        Account: owner,
        Amount: drops(o.amount),
        Destination: destination,
        PublicKey: fields.PublicKey,
        SettleDelay: o.settleDelay,
        Sequence: sequence,
      },
      [{ CreatedNode: { LedgerEntryType: "PayChannel", LedgerIndex: id, NewFields: fields } }],
    );
    const sequences = { owner: sequence + 1, destination: drawIn(next, 1_000_000, 9_000_000) };
    const state: ChannelState = { id, owner, destination, fields: { ...fields, Balance: "0", Flags: 0, OwnerNode: "0" }, txs: [create], last: create, next, place, sequences };
    events(state);
    objects.push({ name, id, txs: state.txs });
  };

  // The account's channel, asked to close: claimed once, then the owner's close request sets its Expiration a settle delay (30 days) on, after the as-of ledger.
  channel("channel-closing", { owner: OBJECTS_ACCOUNT, amount: 50, settleDelay: 30 * DAY, created: 107296498 }, (c) => {
    claim(c, 107558036, drops(12));
    closeRequest(c, 107641123);
  });
  // A channel with 120 events: its creation in the first recorded ledger, then claims spread over the later ones until there are 120, a fund every tenth.
  channel("channel-long", { amount: 1_000, settleDelay: DAY, created: 102145584 }, (c) => {
    const later = [106179366, 106268539, 106970128, 107107437, 107218583, 107220098, 107296498, 107558036, 107624182, 107641123, 107897249, 107945438, 107967068, 107968411];
    let balance = 0;
    for (let n = 1; n < 120; n++) {
      const ledger = later[Math.floor(((n - 1) * later.length) / 119)]!;
      if (n % 10 === 0) fund(c, ledger, drops(100));
      else {
        balance += drawIn(c.next, 1, 5) * 1_000_000;
        claim(c, ledger, String(balance));
      }
    }
  });
  return objects;
}

/** A synthetic channel as its transactions are made: its node's fields now, the transactions so far and the last. */
interface ChannelState {
  id: string;
  owner: string;
  destination: string;
  fields: Json;
  txs: Placed[];
  last: Placed;
  next: () => number;
  place: ReturnType<typeof placesOf>;
  /** The next sequence of the owner and of the destination. */
  sequences: { owner: number; destination: number };
}

/** A change of a synthetic channel: a `ModifiedNode` with the fields after it and before it. */
function changeChannel(c: ChannelState, ledger: number, tx: Json, after: Json): void {
  const at = c.place(ledger);
  const before: Json = {};
  for (const key of Object.keys(after)) before[key] = c.fields[key];
  for (const [key, value] of Object.entries(before)) if (value === undefined) delete before[key];
  const fields = { ...c.fields, ...after };
  const placed = placedTx(at, tx, [
    {
      ModifiedNode: {
        FinalFields: fields,
        LedgerEntryType: "PayChannel",
        LedgerIndex: c.id,
        PreviousFields: before,
        PreviousTxnID: c.last.tx.hash,
        PreviousTxnLgrSeq: Number(c.last.raw.ledger.ledger_index),
      },
    },
  ]);
  c.fields = fields;
  c.txs.push(placed);
  c.last = placed;
}

/** The destination claims up to `balance` drops. */
function claim(c: ChannelState, ledger: number, balance: string): void {
  const tx = { TransactionType: "PaymentChannelClaim", Account: c.destination, Amount: balance, Balance: balance, Channel: c.id, Sequence: c.sequences.destination++ };
  changeChannel(c, ledger, tx, { Balance: balance });
}

/** The owner adds `amount` drops. */
function fund(c: ChannelState, ledger: number, amount: string): void {
  const total = String(BigInt(c.fields.Amount as string) + BigInt(amount));
  changeChannel(c, ledger, { TransactionType: "PaymentChannelFund", Account: c.owner, Amount: amount, Channel: c.id, Sequence: c.sequences.owner++ }, { Amount: total });
}

/** The owner asks to close: the channel holds unclaimed funds, so it closes a settle delay after the request's ledger (its `Expiration`, which `PreviousFields` does not hold: it is new). */
function closeRequest(c: ChannelState, ledger: number): void {
  const at = c.place(ledger);
  const fields = { ...c.fields, Expiration: closeOf(at.raw) + Number(c.fields.SettleDelay) };
  const placed = placedTx(at, { TransactionType: "PaymentChannelClaim", Account: c.owner, Channel: c.id, Flags: 0x00020000, Sequence: c.sequences.owner++ }, [
    {
      ModifiedNode: {
        FinalFields: fields,
        LedgerEntryType: "PayChannel",
        LedgerIndex: c.id,
        PreviousFields: {},
        PreviousTxnID: c.last.tx.hash,
        PreviousTxnLgrSeq: Number(c.last.raw.ledger.ledger_index),
      },
    },
  ]);
  c.fields = fields;
  c.txs.push(placed);
  c.last = placed;
}

// ---- The files ------------------------------------------------------------------------------------------------------------------------

/** A file before serialization (`fixtureText` sorts its keys, so the tests check the reference's key orders on this): its path below test/fixtures/http/ and its body. */
export interface ObjectFile {
  path: string;
  value: unknown;
}

/** The delegations the hand-written files of a network list (`data-api/accounts/<A>/delegations@direction=…&limit=200.json`, "Upstream fixtures"), by ID. */
export function handWrittenDelegations(net: NetworkName): Map<string, { account: string; ledger_index: number }> {
  const found = new Map<string, { account: string; ledger_index: number }>();
  const dir = new URL(`../test/fixtures/http/${net}/data-api/accounts/`, import.meta.url);
  let accounts: string[];
  try {
    accounts = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return found;
  }
  for (const account of accounts.sort()) {
    for (const direction of ["given", "held"]) {
      let text: string;
      try {
        text = readFileSync(new URL(`${account}/delegations@direction=${direction}&limit=200.json`, dir), "utf8");
      } catch {
        continue;
      }
      const page = JSON.parse(text) as { delegations: Array<{ delegation_id: string; account: string; updated: { ledger_index: number } }> };
      for (const each of page.delegations) found.set(each.delegation_id, { account: each.account, ledger_index: each.updated.ledger_index });
    }
  }
  return found;
}

/** The node's entry of an open object: the node as the newest transaction left it, with the fields a node fills in (the directory pages, a channel's zero balance) and its thread. */
function nodeEntryOf(world: ObjectWorld, newest: DerivedObjectRow): Json {
  const placed = world.txs.get(newest.tx_hash);
  if (placed === undefined) throw new Error(`no transaction ${newest.tx_hash}`);
  let fields: Json | undefined;
  for (const wrapper of placed.tx.metaData.AffectedNodes as Json[]) {
    const node = Object.values(wrapper)[0] as Json;
    if (typeof node.LedgerIndex === "string" && node.LedgerIndex.toUpperCase() === newest.object_id) fields = (node.NewFields ?? node.FinalFields) as Json;
  }
  if (fields === undefined) throw new Error(`${newest.tx_hash}: no node ${newest.object_id}`);
  const node: Json = { Flags: 0, OwnerNode: "0", ...fields };
  if (newest.object_type !== "Delegate" && fields.Destination !== fields.Account) node.DestinationNode ??= "0";
  if (newest.object_type === "PayChannel" && node.Balance === undefined) {
    node.Balance = typeof fields.Amount === "string" ? "0" : { ...(fields.Amount as Json), value: "0" };
  }
  return { ...node, LedgerEntryType: newest.object_type, PreviousTxnID: newest.tx_hash, PreviousTxnLgrSeq: newest.ledger_index, index: newest.object_id };
}

/** Every object file of a network, before serialization (the module header). */
export function objectAnswers(net: NetworkName): ObjectFile[] {
  const world = objectWorld(net);
  const native = NATIVE[net];
  const answers: ObjectFile[] = [];
  const seen = new Set<string>();
  const write = (path: string | undefined, value: unknown): void => {
    if (path === undefined) throw new Error("no file for an object fixture");
    if (seen.has(path)) throw new Error(`${path} is written twice`);
    seen.add(path);
    answers.push({ path, value });
  };
  const api = (path: string, query: string, value: unknown): void => write(dataApiFile(net, path, query), value);

  // The objects of the index and their lookups, by ID (but the node fallback's).
  const types = new Map<string, TrackedType>();
  for (const row of world.rows) types.set(row.object_id, row.object_type);
  for (const id of [...types.keys()].sort()) {
    if (world.nodeOnly.has(id)) continue;
    api(`/v2/ledger_objects/${id}`, "", { result: "success", ledger_object: derivedLookup(world.rows, id, world.asOf) });
    const type = types.get(id)!;
    if (type === "Delegate") continue;
    const kind = KIND_OF[type]!;
    const route = ROUTE_OF[kind];
    const answer = derivedAnswer(kind, world.rows, id, world.asOf, native, world.coverage);
    api(`/v2/${route}/${id}`, "", answer);
    for (let marker = answer.history_marker; marker !== undefined; ) {
      const page = derivedHistory(kind, world.rows, id, world.asOf, native, world.coverage, { limit: HISTORY_LIMIT, marker });
      api(`/v2/${route}/${id}/history`, `descending=true&limit=${HISTORY_LIMIT}&marker=${marker}`, page);
      marker = page.marker;
    }
  }
  // The lookups of the delegations the hand-written files list (the active account's Delegation tab), which the index would hold too.
  for (const [id, { account, ledger_index }] of [...handWrittenDelegations(net)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (types.has(id)) continue;
    api(`/v2/ledger_objects/${id}`, "", { result: "success", ledger_object: { object_id: id, object_type: "Delegate", account, deleted: false, ledger_index } });
  }

  // The node's entries of the objects still in the ledger.
  for (const [id, newest] of [...openObjects(world.rows, world.asOf)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const result = { index: id, ledger_hash: world.head.ledger_hash, ledger_index: world.asOf.ledger_index, node: nodeEntryOf(world, newest), status: "success", validated: true };
    write(nodeFile(net, "ledger_entry", { index: id, ledger_index: "validated" }), { result });
  }

  // The transactions (C3, C9) and the ledgers they are in that generate() does not serve.
  for (const { raw, tx } of world.served) {
    const served: TxObject = dataApiTx(raw, tx);
    api(`/v2/transactions/${tx.hash}`, "", { result: "success", transaction: served });
    api(`/v2/transactions/${tx.hash}`, "binary=true", { result: "success", transaction: binaryTx(net, served) });
  }
  const inSets = setLedgerIndexes(net);
  const lists = new Map<number, RawLedger>();
  for (const { raw } of world.served) if (!inSets.has(Number(raw.ledger.ledger_index))) lists.set(Number(raw.ledger.ledger_index), raw);
  for (const [index, raw] of [...lists].sort(([a], [b]) => a - b)) {
    // The synthetic transactions served of the ledger, after its own: `channel-long`'s, which have no file, took the places after them (it is made last), so they are left out of the
    // list without a gap.
    const madeHashes = new Set(world.made.map((made) => made.tx.hash));
    const extra = world.served.filter((made) => made.raw === raw && madeHashes.has(made.tx.hash)).sort((a, b) => a.tx.metaData.TransactionIndex - b.tx.metaData.TransactionIndex);
    const hashes = [...inLedgerOrder(raw).map((tx) => tx.hash), ...extra.map((made) => made.tx.hash)];
    extra.forEach((made, at) => {
      if (made.tx.metaData.TransactionIndex !== raw.ledger.transactions.length + at) throw new Error(`${made.tx.hash} is not at its place in ledger ${index}`);
    });
    const ledger: LedgerWithHashes = { ...dataApiLedger(raw), transactions: hashes };
    api(`/v2/ledgers/${index}`, "transactions=true", { result: "success", ledger });
  }
  return answers;
}

/** Every object file of a network: path below test/fixtures/http/ and text (an object's events and an account's delegations a row to a line). */
export function objectFixtures(net: NetworkName): Array<[path: string, text: string]> {
  return objectAnswers(net).map(({ path, value }) => [path, fixtureText(value, OBJECT_ROW_LISTS)]);
}

let pathsCache: Set<string> | undefined;

/** The paths every object file of both networks has (`isObjectGenerated` of http-fixtures.ts); worked out once. */
export function objectPaths(): ReadonlySet<string> {
  return (pathsCache ??= new Set((["xrpl", "xahau"] as const).flatMap((net) => objectAnswers(net).map(({ path }) => path))));
}

/** The ID of a synthetic object of a world, by its name. */
export function syntheticId(net: NetworkName, name: string): string {
  const id = objectWorld(net).synthetic.get(name);
  if (id === undefined) throw new Error(`${net} has no synthetic ${name}`);
  return id;
}
