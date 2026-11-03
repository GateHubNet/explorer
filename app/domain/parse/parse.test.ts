import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";
import { allTxs, loadManifest, loadTx, type FixtureSet } from "../../../test/support/ledgers";
import { MPT_FEE_PAYMENT_ISSUANCE, MPT_FIXTURE_IDS, MPT_MINT_ISSUANCE } from "../../../test/support/mpt-case-rules";
import { mptIdOf } from "../mpt-id";
import { acceptedNftId, accountsCreated, ammHops, balanceChanges, createdUriTokenIds, mintedNftIds, objectsTouched } from "./index";
import type { AffectedNode, AmmHop, BalanceChange, Native, TxJson, TxMeta } from "./types";

const SETS: FixtureSet[] = ["xrpl", "xrpl-amm", "xahau"];
const nativeOf = (set: FixtureSet): Native => (set === "xahau" ? "XAH" : "XRP");

/** Everything `parse/` makes of one recorded transaction. */
function parseAll(set: FixtureSet, hash: string) {
  const { tx, meta } = loadTx(set, hash);
  const native = nativeOf(set);
  return {
    balanceChanges: balanceChanges(tx, meta, native),
    ammHops: ammHops(meta, native),
    objectsTouched: objectsTouched(meta),
    accountsCreated: accountsCreated(meta),
  };
}

/** The accounts of the `AccountRoot` nodes in the metadata that carry `AMMID`, which is what makes one a pool. */
function poolAccountRoots(meta: TxMeta): string[] {
  const pools: string[] = [];
  for (const affected of meta.AffectedNodes) {
    const body = Object.values(affected)[0]!;
    const fields = body.NewFields ?? body.FinalFields ?? {};
    if (body.LedgerEntryType === "AccountRoot" && "AMMID" in fields) pools.push(fields.Account as string);
  }
  return pools;
}

const isPositive = (value: string) => new BigNumber(value).isGreaterThan(0);
/** A plain decimal: optional minus, digits, optional fraction; never an exponent. */
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

const AMM_DEPOSIT = "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B";
/** A Payment of xrpl-amm that funded a new account: Account rw3rk5xmeUJdujfYBVZNoTn5fZsLEZmxUJ is its Destination. */
const ACCOUNT_CREATING_PAYMENT = "9886513ACD1740029F9ADE0395905F868DE874A50B8E8F7AFD8F918795F6D191";
const AMM_CREATE = "6F152B6ED9514109B5CA4DA5A1050A5C57237BA413A12E46A7CC6E1F8FBCE977";

// The transactions the manifests name: one per recorded type (xrpl, xahau) and one per case (xrpl-amm).
const named: Array<{ set: FixtureSet; label: string; hash: string }> = [
  ...Object.entries<{ hash: string }>(loadManifest("xrpl").found).map(([type, { hash }]) => ({
    set: "xrpl" as const,
    label: type,
    hash,
  })),
  ...Object.entries<{ hash: string }>(loadManifest("xrpl-amm").cases).map(([name, { hash }]) => ({
    set: "xrpl-amm" as const,
    label: name,
    hash,
  })),
  ...Object.entries<{ hash: string }>(loadManifest("xahau").found).map(([type, { hash }]) => ({
    set: "xahau" as const,
    label: type,
    hash,
  })),
  // Not in a manifest, but the plainest Payment of the lot: native, and it creates the receiver's account.
  { set: "xrpl-amm", label: "payment_creates_account", hash: ACCOUNT_CREATING_PAYMENT },
];

describe("the recorded transactions, parsed", () => {
  it("name 9 xrpl, 16 + 1 xrpl-amm and 6 xahau transactions", () => {
    expect(named.filter((n) => n.set === "xrpl")).toHaveLength(9);
    expect(named.filter((n) => n.set === "xrpl-amm")).toHaveLength(17);
    expect(named.filter((n) => n.set === "xahau")).toHaveLength(6);
  });

  // One snapshot per hash (a loop rather than it.each, whose $hash title is cut short).
  for (const { set, label, hash } of named) {
    it(`${set} ${label} ${hash}`, () => {
      expect(parseAll(set, hash)).toMatchSnapshot();
    });
  }
});

describe("every recorded transaction", () => {
  // The snapshots above cover the transactions the manifests name. This pins the totals over all of them (about
  // 3,200), so a change in what any transaction parses to shows up here, as a changed count.
  it("parses to these totals per set", () => {
    const totals: Record<string, Record<string, number>> = {};
    for (const set of SETS) {
      const total = { transactions: 0, balanceChanges: 0, ammHops: 0, objectsTouched: 0, accountsCreated: 0 };
      for (const { tx, meta } of allTxs(set)) {
        total.transactions++;
        total.balanceChanges += balanceChanges(tx, meta, nativeOf(set)).length;
        total.ammHops += ammHops(meta, nativeOf(set)).length;
        total.objectsTouched += objectsTouched(meta).length;
        total.accountsCreated += accountsCreated(meta).length;
      }
      totals[set] = total;
    }
    expect(totals).toMatchSnapshot();
  });
});

describe("the AMMDeposit 83F332E0…0A4B", () => {
  it("is not a swap, and it modified the AMM object", () => {
    const { meta } = loadTx("xrpl", AMM_DEPOSIT);
    expect(ammHops(meta, "XRP")).toEqual([]);
    expect(objectsTouched(meta)).toContainEqual(expect.objectContaining({ change: "modified", type: "AMM" }));
  });
});

// What each swap case of xrpl-amm did to its pools, worked out from the raw metadata: the pool's change of each
// asset between PreviousFields and FinalFields (so with the issuer's transfer fee, not the delivered amount).
const RLUSD = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
const USD = { currency: "USD", issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq" };
const USDC = { currency: "5553444300000000000000000000000000000000", issuer: "rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE" };
const SGB = { currency: "SGB", issuer: "rctArjqVvTHihekzDeecKo6mkTYTUSBNc" };
const XRP = { currency: "XRP" };
const POOL_XRP_RLUSD = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const POOL_XRP_USD = "rs9ineLqrCzeAGS1bxsrW8x2n3bRJYAh3Q";
const POOL_XRP_SGB = "rEaErQ5vEbHXThFedUrjz9YFotG5HHcxoW";
const POOL_RLUSD_USDC = "rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb";

const swaps: Array<{ name: string; hops: AmmHop[] }> = [
  {
    name: "swap_payment_xrp_iou",
    hops: [{ pool: POOL_XRP_RLUSD, in: { ...XRP, value: "134" }, out: { ...RLUSD, value: "179.448166793" } }],
  },
  {
    name: "swap_offercreate_xrp_iou",
    hops: [{ pool: POOL_XRP_RLUSD, in: { ...RLUSD, value: "543.870850376" }, out: { ...XRP, value: "417.277515" } }],
  },
  {
    name: "payment_pool_and_book",
    hops: [{ pool: POOL_XRP_RLUSD, in: { ...XRP, value: "1.015604" }, out: { ...RLUSD, value: "1.325962092" } }],
  },
  {
    name: "offercreate_autobridged_pool_leg",
    hops: [{ pool: POOL_XRP_RLUSD, in: { ...XRP, value: "0.766153" }, out: { ...RLUSD, value: "1" } }],
  },
  {
    // The pool paid 83.28354047857 USD; the receiver got 83.11730586683633 (the issuer keeps its transfer fee).
    name: "swap_issuer_transfer_rate",
    hops: [{ pool: POOL_XRP_USD, in: { ...XRP, value: "54.514846" }, out: { ...USD, value: "83.28354047857" } }],
  },
  {
    // USD -> XRP -> SGB across two pools in series. The second pool is the high account of its SGB line.
    name: "payment_two_pools",
    hops: [
      { pool: POOL_XRP_USD, in: { ...USD, value: "2.04637079847" }, out: { ...XRP, value: "1.455815" } },
      { pool: POOL_XRP_SGB, in: { ...XRP, value: "1.455815" }, out: { ...SGB, value: "2213.26267826" } },
    ],
  },
];

describe("ammHops", () => {
  const manifest = loadManifest("xrpl-amm");
  const hashOf = (name: string): string => manifest.cases[name].hash;

  it.each(swaps)("$name: the pool's change of each asset", ({ name, hops }) => {
    const { meta } = loadTx("xrpl-amm", hashOf(name));
    expect(ammHops(meta, "XRP")).toEqual(hops);
  });

  it.each(swaps)("$name: every hop's pool is the Account of an AccountRoot with AMMID", ({ name }) => {
    const { meta } = loadTx("xrpl-amm", hashOf(name));
    const hops = ammHops(meta, "XRP");
    expect(hops.length).toBeGreaterThan(0);
    for (const hop of hops) {
      expect(poolAccountRoots(meta)).toContain(hop.pool);
      expect(isPositive(hop.in.value)).toBe(true);
      expect(isPositive(hop.out.value)).toBe(true);
    }
  });

  it("a swap through one pool has exactly one hop", () => {
    for (const name of ["swap_payment_xrp_iou", "swap_offercreate_xrp_iou", "swap_issuer_transfer_rate"]) {
      expect(ammHops(loadTx("xrpl-amm", hashOf(name)).meta, "XRP")).toHaveLength(1);
    }
  });

  it("puts the hops of a payment through two pools in path order, whatever the order of the nodes", () => {
    const { meta } = loadTx("xrpl-amm", hashOf("payment_two_pools"));
    const reversed: TxMeta = { ...meta, AffectedNodes: [...meta.AffectedNodes].reverse() };
    expect(ammHops(reversed, "XRP").map((hop) => hop.pool)).toEqual([POOL_XRP_USD, POOL_XRP_SGB]);
  });

  it("finds an IOU/IOU pool by its lsfAMMNode lines, since its AccountRoot is not in the metadata", () => {
    const { meta } = loadTx("xrpl-amm", hashOf("swap_iou_iou"));
    expect(poolAccountRoots(meta)).toEqual([]);
    expect(ammHops(meta, "XRP")).toEqual([
      { pool: POOL_RLUSD_USDC, in: { ...RLUSD, value: "22.19651885465" }, out: { ...USDC, value: "22.21468168488" } },
    ]);
  });

  it("labels the native asset with the network's currency", () => {
    const { meta } = loadTx("xrpl-amm", hashOf("swap_payment_xrp_iou"));
    expect(ammHops(meta, "XAH")[0]!.in).toEqual({ currency: "XAH", value: "134" });
  });

  it("finds no hop in anything that is not a swap", () => {
    const swapNames = new Set(swaps.map((s) => s.name).concat("swap_iou_iou"));
    for (const [name, { hash }] of Object.entries<{ hash: string }>(manifest.cases)) {
      if (swapNames.has(name)) continue;
      // Deposits (both assets in), withdrawals (both out, or one), create, vote, bid, an LP-token transfer.
      expect(ammHops(loadTx("xrpl-amm", hash).meta, "XRP"), name).toEqual([]);
    }
  });

  it("does not take the LP token for a reserve: a single-asset deposit moves one reserve and mints LP tokens", () => {
    // The pool's XRP goes up and the LP token it issues goes up (its line shows as a negative balance of the pool).
    // Counting the LP line as an asset would make this deposit look like a swap.
    expect(ammHops(loadTx("xrpl-amm", hashOf("deposit_single_asset")).meta, "XRP")).toEqual([]);
  });

  it("finds no hop in a failed transaction", () => {
    const { meta } = loadTx("xrpl-amm", hashOf("swap_payment_xrp_iou"));
    expect(ammHops({ ...meta, TransactionResult: "tecPATH_PARTIAL" }, "XRP")).toEqual([]);
  });

  it("finds no hop in a ledger without pools (Xahau has no AMM)", () => {
    for (const { meta } of allTxs("xahau")) expect(ammHops(meta, "XAH")).toEqual([]);
  });
});

describe("balanceChanges", () => {
  // Payments of native currency to another account, without a currency conversion in the middle.
  const nativePayments = SETS.flatMap((set) =>
    allTxs(set)
      .filter(
        ({ tx, meta }) =>
          tx.TransactionType === "Payment" &&
          meta.TransactionResult === "tesSUCCESS" &&
          typeof tx.Amount === "string" &&
          (tx.SendMax === undefined || typeof tx.SendMax === "string") &&
          typeof meta.delivered_amount === "string" &&
          tx.Account !== tx.Destination &&
          tx.Fee !== "0",
      )
      .map((found) => ({ set, ...found })),
  );

  it("has native-to-native payments to check", () => {
    expect(nativePayments.filter((p) => p.set === "xrpl").length).toBeGreaterThan(10);
    expect(nativePayments.filter((p) => p.set === "xrpl-amm").length).toBeGreaterThan(10);
    expect(nativePayments.filter((p) => p.set === "xahau").length).toBeGreaterThan(10);
  });

  it("gives a sender its whole native change, fee included: -(delivered + fee)", () => {
    for (const { set, tx, meta } of nativePayments) {
      const native = nativeOf(set);
      const sender = balanceChanges(tx, meta, native).find(
        (change) => change.account === tx.Account && change.currency === native && change.issuer === undefined,
      );
      const spent = new BigNumber(meta.delivered_amount as string).plus(tx.Fee).shiftedBy(-6).negated();
      expect(sender?.value, `${set} ${tx.hash}`).toBe(spent.toFixed());
    }
  });

  it("shows the fee in that change: the sender's change is the delivered amount and one fee more", () => {
    // 9886513A… sent 10 XRP (the base reserve, to a new account) with a fee of 24 drops: -10.000024 in all.
    const { tx, meta } = loadTx("xrpl-amm", ACCOUNT_CREATING_PAYMENT);
    expect(tx.Fee).toBe("24");
    const changes = balanceChanges(tx, meta, "XRP");
    const sender = changes.find((c) => c.account === tx.Account)!;
    const receiver = changes.find((c) => c.account === tx.Destination)!;
    expect(sender.value).toBe("-10.000024");
    expect(receiver.value).toBe("10");
    expect(new BigNumber(sender.value).plus(receiver.value).toFixed()).toBe("-0.000024");
  });

  it("labels the native currency with the network's: XAH on Xahau, XRP on the XRP Ledger", () => {
    for (const set of SETS) {
      const native = nativeOf(set);
      for (const { tx, meta } of allTxs(set)) {
        for (const change of balanceChanges(tx, meta, native)) {
          if (change.issuer === undefined) expect(change.currency).toBe(native);
        }
      }
    }
    // A Xahau Payment moved 1.5 XAH or more: native entries say XAH and none says XRP.
    const { tx, meta } = allTxs("xahau").find(({ tx }) => tx.TransactionType === "Payment")!;
    const changes = balanceChanges(tx, meta, "XAH");
    expect(changes.length).toBeGreaterThan(1);
    expect(changes.map((c) => c.currency)).toEqual(changes.map(() => "XAH"));
  });

  it("relabels by the empty counterparty, not by the name: an issued currency called XAH stays XAH on XRPL", () => {
    // offercreate_autobridged_pool_leg trades a currency "XAH" issued by rswh1fvyLqHizBS2awu1vs6QcmwTBd9qiv on the
    // XRP Ledger, whose native currency is XRP.
    const { tx, meta } = loadTx("xrpl-amm", "F9F304F7B20FA2B1A340C1AB5DD0D6F410A50E80444EE698A47D556BA78E34FC");
    const issued = balanceChanges(tx, meta, "XRP").filter((c) => c.currency === "XAH");
    expect(issued.length).toBeGreaterThan(0);
    for (const change of issued) expect(change.issuer).toBeDefined();
  });

  it("lists the sender's changes first", () => {
    for (const set of SETS) {
      for (const { tx, meta } of allTxs(set)) {
        const accounts = balanceChanges(tx, meta, nativeOf(set)).map((c) => c.account);
        const firstOther = accounts.findIndex((a) => a !== tx.Account);
        if (firstOther >= 0) expect(accounts.slice(firstOther)).not.toContain(tx.Account);
      }
    }
  });

  it("gives an issued currency from both sides of its trust line, the other side as `issuer`", () => {
    // swap_issuer_transfer_rate: the XRP/USD pool paid 83.28354047857 USD; the pool is the low side of its line.
    const { tx, meta } = loadTx("xrpl-amm", "CB1B7721CCC2C842B86A178A26BF50160F57CEC9E95291A9C5349071B89C3822");
    const changes = balanceChanges(tx, meta, "XRP");
    expect(changes).toContainEqual({
      account: POOL_XRP_USD,
      currency: "USD",
      issuer: USD.issuer,
      value: "-83.28354047857",
      after: "12813.56852898324",
    });
    expect(changes).toContainEqual({
      account: USD.issuer,
      currency: "USD",
      issuer: POOL_XRP_USD,
      value: "83.28354047857",
      after: "-12813.56852898324",
    });
  });

  it("gives native changes of the pool in whole units, with the balance after", () => {
    const { tx, meta } = loadTx("xrpl-amm", "CB1B7721CCC2C842B86A178A26BF50160F57CEC9E95291A9C5349071B89C3822");
    expect(balanceChanges(tx, meta, "XRP")).toContainEqual({
      account: POOL_XRP_USD,
      currency: "XRP",
      value: "54.514846",
      after: "8403.133358",
    });
  });

  it("writes every value as a plain decimal, never an exponent, and no change is zero", () => {
    for (const set of SETS) {
      for (const { tx, meta } of allTxs(set)) {
        for (const change of balanceChanges(tx, meta, nativeOf(set))) {
          expect(change.value, `${set} ${tx.hash}`).toMatch(PLAIN_DECIMAL);
          expect(new BigNumber(change.value).isZero(), `${set} ${tx.hash}`).toBe(false);
          if (change.after !== undefined) expect(change.after, `${set} ${tx.hash}`).toMatch(PLAIN_DECIMAL);
        }
      }
    }
  });

  it("burns exactly the fee: the native changes of a transaction add up to -Fee", () => {
    // True where XRP moves only between accounts. Escrow and payment-channel transactions park it in an object
    // (EscrowFinish releases it), and Xahau's reward, import and hook transactions mint or burn it.
    const closed = new Set([
      "Payment",
      "OfferCreate",
      "OfferCancel",
      "TrustSet",
      "AccountSet",
      "TicketCreate",
      "AccountDelete",
      "CheckCreate",
      "CheckCash",
      "NFTokenMint",
      "NFTokenCreateOffer",
      "NFTokenCancelOffer",
      "NFTokenAcceptOffer",
      "AMMCreate",
      "AMMDeposit",
      "AMMWithdraw",
      "AMMVote",
      "AMMBid",
    ]);
    let checked = 0;
    for (const set of ["xrpl", "xrpl-amm"] as const) {
      for (const { tx, meta } of allTxs(set)) {
        if (!closed.has(tx.TransactionType)) continue;
        const sum = balanceChanges(tx, meta, "XRP")
          .filter((change) => change.issuer === undefined)
          .reduce((total, change) => total.plus(change.value), new BigNumber(0));
        expect(sum.toFixed(), `${set} ${tx.TransactionType} ${tx.hash}`).toBe(
          new BigNumber(tx.Fee).shiftedBy(-6).negated().toFixed(),
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("objectsTouched", () => {
  it("lists the created, modified and deleted nodes in the order of the metadata", () => {
    const { meta } = loadTx("xrpl-amm", ACCOUNT_CREATING_PAYMENT);
    const touched = objectsTouched(meta);
    expect(touched).toHaveLength(meta.AffectedNodes.length);
    meta.AffectedNodes.forEach((affected, i) => {
      const [kind, body] = Object.entries(affected)[0]!;
      expect(touched[i]).toMatchObject({
        change: { CreatedNode: "created", ModifiedNode: "modified", DeletedNode: "deleted" }[kind],
        type: body.LedgerEntryType,
        index: body.LedgerIndex,
      });
    });
  });

  it("gives the account of an AccountRoot, and a created account shows as created", () => {
    const { tx, meta } = loadTx("xrpl-amm", ACCOUNT_CREATING_PAYMENT);
    const roots = objectsTouched(meta).filter((o) => o.type === "AccountRoot");
    expect(roots).toHaveLength(2);
    expect(roots).toContainEqual(expect.objectContaining({ change: "modified", account: tx.Account }));
    expect(roots).toContainEqual(expect.objectContaining({ change: "created", account: tx.Destination }));
  });

  it("shows an offer an OfferCreate left in the book, and a deleted AccountRoot", () => {
    const offerCreate = allTxs("xrpl").find(
      ({ tx, meta }) =>
        tx.TransactionType === "OfferCreate" &&
        meta.TransactionResult === "tesSUCCESS" &&
        objectsTouched(meta).some((o) => o.change === "created" && o.type === "Offer"),
    )!;
    expect(objectsTouched(offerCreate.meta)).toContainEqual(
      expect.objectContaining({ change: "created", type: "Offer", account: offerCreate.tx.Account }),
    );

    const { meta } = loadTx("xrpl", "8F2DCA944394B29981E24DDD6C46192C404D90F7F5FC4EAB6813B0AFD7751A2D");
    expect(objectsTouched(meta)).toContainEqual(expect.objectContaining({ change: "deleted", type: "AccountRoot" }));
  });

  it("names every node, with a 64-hex index", () => {
    for (const set of SETS) {
      for (const { meta, tx } of allTxs(set)) {
        const touched = objectsTouched(meta);
        expect(touched, `${set} ${tx.hash}`).toHaveLength(meta.AffectedNodes.length);
        for (const object of touched) expect(object.index).toMatch(/^[0-9A-F]{64}$/);
      }
    }
  });
});

describe("accountsCreated", () => {
  it("is the Destination of a Payment that creates an account", () => {
    const { tx, meta } = loadTx("xrpl-amm", ACCOUNT_CREATING_PAYMENT);
    expect(accountsCreated(meta)).toEqual([tx.Destination]);
  });

  it("is [] or [Destination] for every successful Payment, on both networks", () => {
    let creating = 0;
    for (const set of SETS) {
      for (const { tx, meta } of allTxs(set)) {
        if (tx.TransactionType !== "Payment" || meta.TransactionResult !== "tesSUCCESS") continue;
        const created = accountsCreated(meta);
        if (created.length > 0) {
          expect(created, `${set} ${tx.hash}`).toEqual([tx.Destination]);
          creating++;
        }
      }
    }
    expect(creating).toBeGreaterThanOrEqual(4);
  });

  it("leaves out an AMM's pseudo-account: nobody opened it", () => {
    const { meta } = loadTx("xrpl", AMM_CREATE);
    expect(objectsTouched(meta)).toContainEqual(expect.objectContaining({ change: "created", type: "AccountRoot" }));
    expect(poolAccountRoots(meta)).toHaveLength(1);
    expect(accountsCreated(meta)).toEqual([]);
  });
});

describe("the parsers", () => {
  it("do not write to their input (the fixtures are deep-frozen) and always return arrays", () => {
    for (const set of SETS) {
      for (const { tx, meta } of allTxs(set)) {
        const native = nativeOf(set);
        expect(Array.isArray(balanceChanges(tx, meta, native))).toBe(true);
        expect(Array.isArray(ammHops(meta, native))).toBe(true);
        expect(Array.isArray(objectsTouched(meta))).toBe(true);
        expect(Array.isArray(accountsCreated(meta))).toBe(true);
      }
    }
  });
});

// The NFT ids a transaction's metadata tells (app/domain/parse/nft-ids.ts), against the ids D3's own cases expect
// (test/unit/nft-fixtures.test.ts, written down from the recorded transactions, not from these helpers).
describe("the NFT ids of a transaction", () => {
  const caseOf = (set: "xrpl-nft" | "xahau-nft", name: string) => loadTx(set, loadManifest(set).cases[name].hash);

  /** The NFT each recorded case is about: D3's expected events name it. */
  const ID = {
    mint: "0019000040FEFE9E7C73D4F8A4DC7A7A09DD13B724827F945B2680E5061B0D4A",
    mintWithOffer: "00181F40AF09C1D4B4D1E8031467F3508DFFADABEA73255FBE9F0F960655EBFA",
    mintOnBehalf: "001861A86D2DF313DD3688E9B156F47B99A8C80F4692DF244CEB911005FC3176",
    splitMint: "00181F40AF09C1D4B4D1E8031467F3508DFFADABEA73255F79ED9C910655EBF7",
    soldBySellOffer: "00081388EA968E3C54EE59C8FFBAF0944A3B8AD4797AB032EF22952605AD2A91",
    soldByBuyOffer: "000803E88ACAA32313BB87F729EF7DA56BD13C57BE46E3C8B0730F290481ED98",
    brokered: "00190BB8DAEF366CB05EE8DCC919EF9A1AA24DD22B3D62C9D848920A0669E96F",
    soldForIssued: "00081388048ECA9BA1C412A6BFFEEA29E21873E92DE6B3F3EA90AAA805041E13",
    transferred: "0018C350C7DEC772B41E9496AA92D148C4FD64D239AA62985D24F44D05B7F6B4",
    uriMinted: "E87FD7E7FDACFA2CE1DC37AD805A7295F84459D4911EAC79160F0D9E34BB6520",
    uriRemitMinted: "099E410166351A8C94AE6D76154CBF301C609282EAE659C1BF08AF46936867BF",
    uriReminted: "E5ECD96D609E8E7C29C967D3D2FA542AE58FC9A05B9C4EAE7BFF608A7D0306A2",
  };

  describe("mintedNftIds", () => {
    it.each([
      ["mint", ID.mint],
      ["mint_with_offer", ID.mintWithOffer],
      ["mint_on_behalf", ID.mintOnBehalf],
      // The page that gains the id is split: the new page holds half of the old one's tokens, which are not minted.
      ["page_split_with_mint", ID.splitMint],
    ])("gives exactly the NFT that %s minted", (name, id) => {
      expect(mintedNftIds(caseOf("xrpl-nft", name).meta)).toEqual([id]);
    });

    it.each(["burn", "burn_removes_offers", "modify", "sell_offer_create", "buy_offer_create", "offer_cancel", "sale_by_sell_offer", "sale_by_buy_offer", "brokered_sale_royalty", "sale_issued_currency", "transfer_zero_amount"])(
      "gives none for %s: no id is new over the union of the pages",
      (name) => {
        expect(mintedNftIds(caseOf("xrpl-nft", name).meta)).toEqual([]);
      },
    );

    it("gives none for a Payment, or on Xahau", () => {
      expect(mintedNftIds(loadTx("xrpl-amm", ACCOUNT_CREATING_PAYMENT).meta)).toEqual([]);
      expect(mintedNftIds(caseOf("xahau-nft", "uritoken_mint").meta)).toEqual([]);
    });

    // The ids of the pages are compared as a whole (D3 §2.1): a page that only changed its links (no `NFTokens` among its
    // `PreviousFields`) held what it holds, and a page's previous array is `PreviousFields.NFTokens` when it has one.
    const ID_A = "00081388AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA00000001";
    const ID_B = "00081388AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA00000002";
    const ID_C = "00081388AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA00000003";
    const token = (id: string) => ({ NFToken: { NFTokenID: id } });
    const page = (change: "CreatedNode" | "ModifiedNode" | "DeletedNode", fields: Record<string, unknown>, previous?: Record<string, unknown>): TxMeta["AffectedNodes"][number] =>
      ({
        [change]: {
          LedgerEntryType: "NFTokenPage",
          LedgerIndex: "AB".repeat(32),
          ...(change === "CreatedNode" ? { NewFields: fields } : { FinalFields: fields }),
          ...(previous ? { PreviousFields: previous } : {}),
        },
      }) as TxMeta["AffectedNodes"][number];
    const meta = (...AffectedNodes: TxMeta["AffectedNodes"]): TxMeta => ({ TransactionIndex: 0, TransactionResult: "tesSUCCESS", AffectedNodes });

    it("does not read a page that only changed its links, or one that merged, as a mint", () => {
      // A neighbour of a split: only its link changed, so its tokens are what it held.
      expect(mintedNftIds(meta(page("ModifiedNode", { NFTokens: [token(ID_A)], NextPageMin: "CD".repeat(32) })))).toEqual([]);
      // Two pages merged into one: the survivor gained B (PreviousFields lists A only), the other, deleted, held B (its FinalFields).
      expect(
        mintedNftIds(meta(page("ModifiedNode", { NFTokens: [token(ID_A), token(ID_B)] }, { NFTokens: [token(ID_A)] }), page("DeletedNode", { NFTokens: [token(ID_B)] }))),
      ).toEqual([]);
    });

    it("gives the id that no page held before: a created page, a modified page's gain", () => {
      expect(mintedNftIds(meta(page("CreatedNode", { NFTokens: [token(ID_A)] })))).toEqual([ID_A]);
      expect(mintedNftIds(meta(page("ModifiedNode", { NFTokens: [token(ID_A), token(ID_B)] }, { NFTokens: [token(ID_A)] })))).toEqual([ID_B]);
      // A split: the old page lost C to the created one, and the mint B landed on the created one.
      expect(
        mintedNftIds(
          meta(
            page("ModifiedNode", { NFTokens: [token(ID_A)] }, { NFTokens: [token(ID_A), token(ID_C)] }),
            page("CreatedNode", { NFTokens: [token(ID_B), token(ID_C)] }),
          ),
        ),
      ).toEqual([ID_B]);
    });

    it("reads an id in lower case as upper case, and ignores a page entry without an id", () => {
      expect(mintedNftIds(meta(page("CreatedNode", { NFTokens: [token(ID_A.toLowerCase()), { NFToken: {} }, {}] })))).toEqual([ID_A.toUpperCase()]);
    });
  });

  describe("acceptedNftId", () => {
    it.each([
      ["sale_by_sell_offer", ID.soldBySellOffer],
      ["sale_by_buy_offer", ID.soldByBuyOffer],
      ["brokered_sale_royalty", ID.brokered],
      ["sale_issued_currency", ID.soldForIssued],
      // A zero amount is no sale but a transfer: the NFT is still the offer's.
      ["transfer_zero_amount", ID.transferred],
    ])("gives the NFT of the offer %s accepted", (name, id) => {
      expect(acceptedNftId(caseOf("xrpl-nft", name).meta)).toBe(id);
    });

    it("gives the NFT of the expired offer a failed accept deleted (tecEXPIRED), as the offer's FinalFields name it", () => {
      const { meta: sale } = caseOf("xrpl-nft", "sale_by_sell_offer");
      expect(acceptedNftId({ ...sale, TransactionResult: "tecEXPIRED" })).toBe(ID.soldBySellOffer);
    });

    it("gives nothing for a transaction that deleted no offer, or deleted offers of more than one NFT", () => {
      expect(acceptedNftId(caseOf("xrpl-nft", "mint").meta)).toBeUndefined();
      expect(acceptedNftId(loadTx("xrpl-amm", ACCOUNT_CREATING_PAYMENT).meta)).toBeUndefined();
      // An offer that was only created or modified is not one that an accept consumed.
      expect(acceptedNftId(caseOf("xrpl-nft", "sell_offer_create").meta)).toBeUndefined();
      const offer = (id: string): TxMeta["AffectedNodes"][number] =>
        ({ DeletedNode: { LedgerEntryType: "NFTokenOffer", LedgerIndex: "CD".repeat(32), FinalFields: { NFTokenID: id } } }) as TxMeta["AffectedNodes"][number];
      const base = { TransactionIndex: 0, TransactionResult: "tesSUCCESS" };
      expect(acceptedNftId({ ...base, AffectedNodes: [offer(ID.brokered), offer(ID.brokered)] })).toBe(ID.brokered);
      expect(acceptedNftId({ ...base, AffectedNodes: [offer(ID.brokered), offer(ID.transferred)] })).toBeUndefined();
    });
  });

  describe("createdUriTokenIds", () => {
    it.each([
      ["uritoken_mint", ID.uriMinted],
      // A Remit's MintURIToken creates the token for the destination.
      ["remit_mint", ID.uriRemitMinted],
      ["uritoken_remint", ID.uriReminted],
    ])("gives the index of the URIToken %s created", (name, id) => {
      expect(createdUriTokenIds(caseOf("xahau-nft", name).meta)).toEqual([id]);
    });

    it.each(["uritoken_sell_offer_create", "uritoken_sell_offer_cancel", "uritoken_buy_above_ask", "remit_transfer"])("gives none for %s, which creates no token", (name) => {
      expect(createdUriTokenIds(caseOf("xahau-nft", name).meta)).toEqual([]);
    });

    it("gives none for a Payment, or on XRPL", () => {
      expect(createdUriTokenIds(loadTx("xrpl-amm", ACCOUNT_CREATING_PAYMENT).meta)).toEqual([]);
      expect(createdUriTokenIds(caseOf("xrpl-nft", "mint").meta)).toEqual([]);
    });
  });

  it("never write to their input (the fixtures are deep-frozen) and always return what their types say", () => {
    for (const set of ["xrpl-nft", "xahau-nft"] as const) {
      for (const { meta } of allTxs(set)) {
        expect(Array.isArray(mintedNftIds(meta))).toBe(true);
        expect(Array.isArray(createdUriTokenIds(meta))).toBe(true);
        expect(["string", "undefined"]).toContain(typeof acceptedNftId(meta));
      }
    }
  });
});

// The MPT amounts of a transaction (spec 5.2, rulings C7 and C9): an `MPToken` node whose `MPTAmount` changed is the holder's entry, an `MPTokenIssuance` node whose `OutstandingAmount` changed (listed) the
// issuer's, negated. The metadata does not list an added field, so a "before" that is not listed is 0 only for the holder a succeeded transaction credits (D9 section 4.1's dated note), else the final value.
describe("the MPT amounts of a transaction", () => {
  const caseOf = (name: string) => loadTx("xrpl-mpt", loadManifest("xrpl-mpt").cases[name].hash);
  const mptChanges = (name: string): BalanceChange[] => {
    const { tx, meta } = caseOf(name);
    return balanceChanges(tx, meta, "XRP").filter((change) => change.mpt);
  };
  /** The compact form of an entry: who, how much, and the balance after. */
  const brief = (changes: BalanceChange[]) => changes.map(({ account, value, after }) => [account, value, after]);

  const FEE_SENDER = "rMPTejgDkDqy92EkAhBo6u7RRPFRfH6MCR";
  const FEE_RECEIVER = "rKSg2VZbw9gRRuSwBjBFAfBoGC5Vs1FmFn";
  const FEE_ISSUER = "rERShrtUSEXkrwtTpugPV4v8E787vpx1kb";
  const MINT_ISSUER = "rwA8orrVtNPuBykRvQdDJzRDQbe7CuxCiR";
  const MINT_HOLDER = "rMNysCkYEX9L3SrSPqavVVXYFT2v5CEVpo";

  it("gives a payment with a transfer fee the sender's fall, the receiver's rise and the issuer's fee, all tagged mpt", () => {
    const changes = mptChanges("payment_transfer_fee");
    expect(changes).toEqual([
      { account: FEE_SENDER, currency: MPT_FEE_PAYMENT_ISSUANCE, issuer: FEE_ISSUER, value: "-1005890", after: "199999997994097", mpt: true },
      { account: FEE_ISSUER, currency: MPT_FEE_PAYMENT_ISSUANCE, value: "5890", mpt: true },
      { account: FEE_RECEIVER, currency: MPT_FEE_PAYMENT_ISSUANCE, issuer: FEE_ISSUER, value: "1000000", after: "1000013", mpt: true },
    ]);
    // Sender first, as for any transaction; the issuer's entry has no `issuer` and no `after` (it is the fee, the outstanding amount's fall negated).
    const { tx, meta } = caseOf("payment_transfer_fee");
    expect(balanceChanges(tx, meta, "XRP")[0]).toMatchObject({ account: FEE_SENDER });
    expect(Object.keys(changes[1]!)).not.toContain("issuer");
    expect(Object.keys(changes[1]!)).not.toContain("after");
  });

  it("gives a mint the receiver's credit and the issuer's equal debit", () => {
    expect(mptChanges("payment_mint")).toEqual([
      { account: MINT_ISSUER, currency: MPT_MINT_ISSUANCE, value: "-1", mpt: true },
      { account: MINT_HOLDER, currency: MPT_MINT_ISSUANCE, issuer: MINT_ISSUER, value: "1", after: "1", mpt: true },
    ]);
  });

  it("gives an escrow create the holder's debit and no issuer entry (the issuance's LockedAmount moved, not its OutstandingAmount)", () => {
    expect(brief(mptChanges("escrow_create"))).toEqual([["rw4tVZXoDHcVm2frmxXJra3EoxHDjp4US4", "-277073", "677146"]]);
  });

  it("gives an escrow finish the destination's credit alone: the owner's MPToken only moved its LockedAmount", () => {
    expect(brief(mptChanges("escrow_finish"))).toEqual([["rBoJ7MWPXiejVbqCRhiVgGcaXAHXVstCD4", "277073", "277073"]]);
  });

  it("gives none for a holder's opt-in (a created MPToken with nothing on it), a lock of one holder or of every balance, and a failed payment", () => {
    for (const name of ["authorize_holder", "issuance_set_lock_holder", "issuance_set_unlock_holder", "issuance_set_lock_all", "authorize_by_issuer", "unauthorize_holder", "issuance_create", "issuance_destroy", "payment_failed"]) {
      expect(mptChanges(name), name).toEqual([]);
    }
  });

  it("reads a field the final fields lack as 0: a redemption and a clawback take the holder to 0 and give the issuer the amount", () => {
    expect(brief(mptChanges("payment_redeem"))).toEqual([
      ["rG4w2E3eHBiJvBSmjwBbJHi7FrCdowtDNd", "-1", "0"],
      ["rBJ2ogWEZvsxkuK7aV4k6H9VAto7k2SsH9", "1", undefined],
    ]);
    // The issuer sent a clawback, so its entry comes first.
    expect(brief(mptChanges("clawback_full"))).toEqual([
      [MINT_ISSUER, "1", undefined],
      [MINT_HOLDER, "-1", "0"],
    ]);
    expect(brief(mptChanges("clawback_partial"))).toEqual([
      ["rNd7q6Wn8hV8Wm6GBhbgSxiibHU2VVFxDF", "1000000", undefined],
      ["rMGADLtve6nS9kg7bqX6Na2S22wSNT1wx4", "-1000000", "3000000"],
    ]);
  });

  it("gives a payment between holders two entries and none for an issuer, the sender's gone to 0", () => {
    expect(brief(mptChanges("payment_holder_to_holder"))).toEqual([
      ["rD9nGmG8wVwguyZcz8rLT4d2MZ1EyFGDSS", "-100000", "0"],
      ["rEPrn4DbXvHNBDJghQWUf92NzLU3MURFC3", "100000", "56327452"],
    ]);
  });

  it("sums to zero per issuance, but for an escrow's move (the amount leaves the balance and is not outstanding-neutral in the metadata)", () => {
    const cases = Object.keys(loadManifest("xrpl-mpt").cases);
    expect(cases).toHaveLength(22);
    for (const name of cases) {
      const total = mptChanges(name).reduce((sum, { value }) => sum.plus(value), new BigNumber(0));
      expect(total.toFixed(), name).toBe(name === "escrow_create" ? "-277073" : name === "escrow_finish" ? "277073" : "0");
    }
  });

  it("leaves every other entry of these transactions what it was: the fee payer's XRP and no `mpt` flag", () => {
    const { tx, meta } = caseOf("payment_transfer_fee");
    const others = balanceChanges(tx, meta, "XRP").filter((change) => !change.mpt);
    expect(others).toEqual([{ account: FEE_SENDER, currency: "XRP", value: "-0.000012", after: expect.stringMatching(/^\d+(\.\d+)?$/) }]);
  });

  describe("on a transaction of its own making", () => {
    const HOLDER = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
    const OTHER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
    const ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
    const ID = mptIdOf(298, ISSUER);
    const PAYER = "rKqqb5QZXVAL3VqXJL6obfRGeHou1DtyBV";

    const node = (kind: "CreatedNode" | "ModifiedNode" | "DeletedNode", type: string, fields: Record<string, unknown>, previous?: Record<string, unknown>): AffectedNode => {
      const body = { LedgerEntryType: type, LedgerIndex: "AB".repeat(32), ...(kind === "CreatedNode" ? { NewFields: fields } : { FinalFields: fields }), ...(previous ? { PreviousFields: previous } : {}) };
      return { [kind]: body } as AffectedNode;
    };
    const meta = (nodes: AffectedNode[], result = "tesSUCCESS"): TxMeta => ({ TransactionIndex: 0, TransactionResult: result, AffectedNodes: nodes });
    const tx = (over: Record<string, unknown>): TxJson => ({ TransactionType: "Payment", Account: PAYER, Fee: "12", ...over }) as TxJson;
    const token = (holder: string, amount: string | undefined, over: Record<string, unknown> = {}) => ({ Account: holder, Flags: 0, ...(amount === undefined ? {} : { MPTAmount: amount }), MPTokenIssuanceID: ID, ...over });
    const mptOf = (t: TxJson, m: TxMeta) => brief(balanceChanges(t, m, "XRP").filter((change) => change.mpt));

    const paying = (to: string, id = ID) => tx({ Destination: to, Amount: { mpt_issuance_id: id, value: "500" } });

    it("credits the Destination of a succeeded Payment from 0 when the node lists nothing before, and shows no change for the same node of a failed one", () => {
      const nodes = [node("ModifiedNode", "MPToken", token(HOLDER, "500"), {})];
      expect(mptOf(paying(HOLDER), meta(nodes))).toEqual([[HOLDER, "500", "500"]]);
      expect(mptOf(paying(HOLDER), meta(nodes, "tecPATH_PARTIAL"))).toEqual([]);
      // A holder the payment does not credit is not credited by a node that lists nothing.
      expect(mptOf(paying(OTHER), meta(nodes))).toEqual([]);
    });

    it("credits the holder of the issuance the transaction moves, not the same holder's token of another (D9's rule: the holder and the issuance)", () => {
      const other = mptIdOf(299, ISSUER);
      const nodes = [node("ModifiedNode", "MPToken", token(HOLDER, "500"), {}), node("ModifiedNode", "MPToken", token(HOLDER, "700", { MPTokenIssuanceID: other }), { Flags: 0 })];
      // The payment is of `other`: its token is credited from 0 and the first, that lists nothing, is no change.
      expect(brief(balanceChanges(paying(HOLDER, other), meta(nodes), "XRP").filter((change) => change.mpt))).toEqual([[HOLDER, "700", "700"]]);
      // A payment whose Amount is not an MPT credits no one.
      expect(mptOf(tx({ Destination: HOLDER, Amount: "10" }), meta(nodes))).toEqual([]);
      // DeliverMax stands in for Amount.
      expect(mptOf(tx({ Destination: HOLDER, DeliverMax: { mpt_issuance_id: ID.toLowerCase(), value: "500" } }), meta(nodes))).toEqual([[HOLDER, "500", "500"]]);
    });

    it("credits an EscrowFinish's destination, the one the escrow names, not whoever finished it", () => {
      const escrow = node("DeletedNode", "Escrow", { Account: OTHER, Destination: HOLDER, Amount: { mpt_issuance_id: ID, value: "500" } });
      const nodes = [node("ModifiedNode", "MPToken", token(HOLDER, "500"), {}), node("ModifiedNode", "MPToken", token(OTHER, "900"), { LockedAmount: "500" }), escrow];
      expect(mptOf(tx({ TransactionType: "EscrowFinish", Owner: OTHER, OfferSequence: 1 }), meta(nodes))).toEqual([[HOLDER, "500", "500"]]);
    });

    it("credits an escrow's holder only in the issuance the escrow holds", () => {
      const other = mptIdOf(299, ISSUER);
      const escrow = node("DeletedNode", "Escrow", { Account: OTHER, Destination: HOLDER, Amount: { mpt_issuance_id: other, value: "500" } });
      const nodes = [node("ModifiedNode", "MPToken", token(HOLDER, "500"), {}), escrow];
      expect(mptOf(tx({ TransactionType: "EscrowFinish", Owner: OTHER, OfferSequence: 1 }), meta(nodes))).toEqual([]);
    });

    it("credits an EscrowCancel's owner, the escrow's account", () => {
      const escrow = node("DeletedNode", "Escrow", { Account: HOLDER, Destination: OTHER, Amount: { mpt_issuance_id: ID, value: "500" } });
      const nodes = [node("ModifiedNode", "MPToken", token(HOLDER, "500"), {}), escrow];
      expect(mptOf(tx({ TransactionType: "EscrowCancel", Owner: HOLDER, OfferSequence: 1 }), meta(nodes))).toEqual([[HOLDER, "500", "500"]]);
    });

    it.each([
      ["Payment", () => paying(HOLDER), []],
      [
        "EscrowFinish",
        () => tx({ TransactionType: "EscrowFinish", Owner: OTHER, OfferSequence: 1 }),
        [node("DeletedNode", "Escrow", { Account: OTHER, Destination: HOLDER, Amount: { mpt_issuance_id: ID, value: "500" } })],
      ],
      [
        "EscrowCancel",
        () => tx({ TransactionType: "EscrowCancel", Owner: HOLDER, OfferSequence: 1 }),
        [node("DeletedNode", "Escrow", { Account: HOLDER, Destination: OTHER, Amount: { mpt_issuance_id: ID, value: "500" } })],
      ],
    ])("credits the holder of a succeeded %s from 0 and shows no change of the same node when the result is a tec", (_type, transaction, escrow) => {
      const nodes = [node("ModifiedNode", "MPToken", token(HOLDER, "500"), {}), ...escrow];
      expect(mptOf(transaction(), meta(nodes))).toEqual([[HOLDER, "500", "500"]]);
      expect(mptOf(transaction(), meta(nodes, "tecNO_PERMISSION"))).toEqual([]);
    });

    it("gives no entry for an MPToken whose Account is empty", () => {
      expect(mptOf(paying(HOLDER), meta([node("ModifiedNode", "MPToken", token("", "500"), { MPTAmount: "1" })]))).toEqual([]);
    });

    it("takes a listed before as it is, and a created MPToken from 0", () => {
      expect(mptOf(tx({ Destination: OTHER }), meta([node("ModifiedNode", "MPToken", token(HOLDER, "70"), { MPTAmount: "100" })]))).toEqual([[HOLDER, "-30", "70"]]);
      expect(mptOf(tx({ Destination: OTHER }), meta([node("CreatedNode", "MPToken", token(HOLDER, "25"))]))).toEqual([[HOLDER, "25", "25"]]);
    });

    it("lists an issuance's OutstandingAmount only when it is listed, and negates the change", () => {
      const issuance = (outstanding: string, previous?: Record<string, unknown>) => node("ModifiedNode", "MPTokenIssuance", { Issuer: ISSUER, Sequence: 298, OutstandingAmount: outstanding }, previous);
      const entries = (m: TxMeta) => balanceChanges(tx({ Destination: OTHER }), m, "XRP").filter((change) => change.mpt);
      expect(entries(meta([issuance("40", { OutstandingAmount: "100" })]))).toEqual([{ account: ISSUER, currency: ID, value: "60", mpt: true }]);
      expect(entries(meta([issuance("100", { OutstandingAmount: "40" })]))).toEqual([{ account: ISSUER, currency: ID, value: "-60", mpt: true }]);
      expect(entries(meta([issuance("100", { Flags: 0 })]))).toEqual([]);
      expect(entries(meta([issuance("100")]))).toEqual([]);
    });

    it("skips a node whose fields do not make an ID or an amount, rather than throwing", () => {
      const nodes = [
        node("ModifiedNode", "MPToken", token(HOLDER, "5", { MPTokenIssuanceID: "00AB" }), { MPTAmount: "1" }),
        node("ModifiedNode", "MPToken", token(HOLDER, "five"), { MPTAmount: "1" }),
        node("ModifiedNode", "MPToken", token(HOLDER, "5"), { MPTAmount: "-1" }),
        node("ModifiedNode", "MPTokenIssuance", { Issuer: "not an address", Sequence: 1, OutstandingAmount: "1" }, { OutstandingAmount: "2" }),
        node("ModifiedNode", "MPTokenIssuance", { Issuer: ISSUER, Sequence: "298", OutstandingAmount: "1" }, { OutstandingAmount: "2" }),
        node("ModifiedNode", "MPTokenIssuance", { Issuer: ISSUER, Sequence: -1, OutstandingAmount: "1" }, { OutstandingAmount: "2" }),
        node("ModifiedNode", "MPTokenIssuance", { Issuer: ISSUER, Sequence: 298, OutstandingAmount: 1 }, { OutstandingAmount: "2" }),
      ];
      expect(mptOf(tx({ Destination: OTHER }), meta(nodes))).toEqual([]);
      // The touched objects name the issuance of a node that has one (the token with a bad amount holds a good ID) and not the others.
      expect(objectsTouched(meta(nodes)).map((touched) => touched.mpt)).toEqual([undefined, ID, ID, undefined, undefined, undefined, ID]);
    });

    it("upper-cases the ID a node holds", () => {
      const lower = ID.toLowerCase();
      const entries = balanceChanges(tx({ Destination: OTHER }), meta([node("ModifiedNode", "MPToken", token(HOLDER, "5", { MPTokenIssuanceID: lower }), { MPTAmount: "1" })]), "XRP");
      expect(entries).toEqual([{ account: HOLDER, currency: ID, issuer: ISSUER, value: "4", after: "5", mpt: true }]);
    });
  });

  describe("the touched objects", () => {
    it("carry the issuance ID of an MPToken (its MPTokenIssuanceID) and of an MPTokenIssuance (mptIdOf of its Sequence and Issuer)", () => {
      const { meta } = caseOf("payment_transfer_fee");
      const touched = objectsTouched(meta);
      expect(touched.filter((object) => object.type === "MPToken")).toEqual([
        expect.objectContaining({ change: "modified", account: FEE_SENDER, mpt: MPT_FEE_PAYMENT_ISSUANCE }),
        expect.objectContaining({ change: "modified", account: FEE_RECEIVER, mpt: MPT_FEE_PAYMENT_ISSUANCE }),
      ]);
      expect(touched.filter((object) => object.type === "MPTokenIssuance")).toEqual([expect.objectContaining({ change: "modified", account: FEE_ISSUER, mpt: MPT_FEE_PAYMENT_ISSUANCE })]);
      // Only these two types carry it.
      expect(touched.filter((object) => object.mpt === undefined).map((object) => object.type)).toEqual(["AccountRoot"]);
    });

    it("name the issuer of a created issuance and its ID, the one the recorded create made", () => {
      const { meta } = caseOf("issuance_create");
      const created = objectsTouched(meta).find((object) => object.type === "MPTokenIssuance")!;
      expect(created).toMatchObject({ change: "created", mpt: MPT_FIXTURE_IDS.htf });
      expect(created.account).toMatch(/^r/);
    });

    it("name the holder of a created MPToken and a deleted one", () => {
      expect(objectsTouched(caseOf("authorize_holder").meta).find((object) => object.type === "MPToken")).toMatchObject({ change: "created", account: MINT_HOLDER, mpt: MPT_MINT_ISSUANCE });
      expect(objectsTouched(caseOf("unauthorize_holder").meta).find((object) => object.type === "MPToken")).toMatchObject({ change: "deleted", account: MINT_HOLDER });
    });
  });
});

describe("the recorded MPT transactions, parsed", () => {
  for (const [name, { hash }] of Object.entries<{ hash: string }>(loadManifest("xrpl-mpt").cases)) {
    it(`xrpl-mpt ${name} ${hash}`, () => {
      expect(parseAll("xrpl-mpt", hash)).toMatchSnapshot();
    });
  }
});
