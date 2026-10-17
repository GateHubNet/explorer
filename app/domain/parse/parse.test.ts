import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";
import { allTxs, loadManifest, loadTx, type FixtureSet } from "../../../test/support/ledgers";
import { accountsCreated, ammHops, balanceChanges, objectsTouched } from "./index";
import type { AmmHop, Native, TxMeta } from "./types";

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
