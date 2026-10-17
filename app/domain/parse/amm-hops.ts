import BigNumber from "bignumber.js";
import { isPoolAccountRoot, nodesOf, type Node } from "./objects";
import type { AmmHop, Asset, Native, TxMeta } from "./types";

/** `RippleState` flags: the line belongs to an AMM, and which side counts it against its reserve. */
const LSF_AMM_NODE = 0x01000000;
const LSF_LOW_RESERVE = 0x00010000;
const LSF_HIGH_RESERVE = 0x00020000;

/** An LP token's currency: 40 hex digits starting with `03`. The pool issues it; it is not one of its reserves. */
const LP_TOKEN = /^03[0-9A-Fa-f]{38}$/;

const ZERO = new BigNumber(0);

const sameAsset = (a: Asset, b: Asset): boolean => a.currency === b.currency && (a.issuer ?? "") === (b.issuer ?? "");

const flagsOf = (node: Node): number => Number(node.fields.Flags ?? 0) | Number(node.previous.Flags ?? 0);

type Limit = { issuer?: string } | undefined;
const limits = (node: Node) => ({
  low: (node.fields.LowLimit as Limit)?.issuer,
  high: (node.fields.HighLimit as Limit)?.issuer,
});

/**
 * The pool an `lsfAMMNode` trust line belongs to: the side that has its reserve bit. A line with neither bit (a
 * line a withdrawal removes loses it) belongs to whichever of its two sides is a pool the transaction names by
 * an `AccountRoot`; if that is not exactly one side, the line says nothing about a pool.
 */
function reserveSide(line: Node, named: ReadonlySet<string>): string | undefined {
  const flags = flagsOf(line);
  const { low, high } = limits(line);
  const lowReserve = (flags & LSF_LOW_RESERVE) !== 0;
  const highReserve = (flags & LSF_HIGH_RESERVE) !== 0;
  if (lowReserve !== highReserve) return lowReserve ? low : high;
  const sides = [low, high].filter((side): side is string => side !== undefined && named.has(side));
  return sides.length === 1 ? sides[0] : undefined;
}

/**
 * The pools a transaction's metadata shows, in the order they first appear. A pool is an `AccountRoot` with
 * `AMMID`. A pool between two issued currencies shows no `AccountRoot` in a swap, only its two reserve lines
 * (`lsfAMMNode`), so those name a pool too.
 */
function poolsOf(nodes: readonly Node[]): string[] {
  const pools = new Set<string>();
  for (const node of nodes) {
    if (isPoolAccountRoot(node) && typeof node.fields.Account === "string") pools.add(node.fields.Account);
  }
  const named = new Set(pools);
  for (const node of nodes) {
    if (node.type !== "RippleState" || (flagsOf(node) & LSF_AMM_NODE) === 0) continue;
    const pool = reserveSide(node, named);
    if (pool !== undefined) pools.add(pool);
  }
  return [...pools];
}

type Delta = { asset: Asset; change: BigNumber };

/**
 * How the transaction changed what a pool holds of each asset: the `AccountRoot` balance for the native
 * currency (drops, converted to whole units), and for an issued currency its trust line with the issuer, from
 * the pool's side of the line (the line's balance is the low account's, so it is negated when the pool is the
 * high account). Unchanged assets and LP-token lines are left out.
 */
function deltasOf(pool: string, nodes: readonly Node[], native: Native): Delta[] {
  const deltas: Delta[] = [];

  for (const node of nodes) {
    if (isPoolAccountRoot(node) && node.fields.Account === pool && node.fields.Balance !== undefined) {
      const after = new BigNumber(node.fields.Balance as string);
      const previous = node.previous.Balance as string | undefined;
      const before = node.change === "created" ? ZERO : previous === undefined ? after : new BigNumber(previous);
      deltas.push({ asset: { currency: native }, change: after.minus(before).shiftedBy(-6) });
      continue;
    }

    if (node.type !== "RippleState") continue;
    const { low, high } = limits(node);
    if (low !== pool && high !== pool) continue;
    const balance = node.fields.Balance as { currency: string; value: string } | undefined;
    if (!balance || LP_TOKEN.test(balance.currency)) continue;

    const asPool = (value: BigNumber) => (low === pool ? value : value.negated());
    const after = asPool(new BigNumber(balance.value));
    const previous = (node.previous.Balance as { value: string } | undefined)?.value;
    const before = node.change === "created" ? ZERO : previous === undefined ? after : asPool(new BigNumber(previous));
    deltas.push({ asset: { currency: balance.currency, issuer: low === pool ? high : low }, change: after.minus(before) });
  }

  return deltas.filter(({ change }) => !change.isZero());
}

/**
 * Puts the hops of a payment through several pools in the order of its path: a hop comes after the hop whose
 * output is its input. The metadata lists nodes by ledger key, not by path. Hops that no asset connects, or that
 * form a loop, keep their order in the metadata.
 */
function inPathOrder(hops: readonly AmmHop[]): AmmHop[] {
  const waiting = [...hops];
  const ordered: AmmHop[] = [];
  while (waiting.length > 0) {
    const next = waiting.findIndex((hop) => !waiting.some((other) => other !== hop && sameAsset(other.out, hop.in)));
    ordered.push(...waiting.splice(next < 0 ? 0 : next, 1));
  }
  return ordered;
}

/**
 * The swaps through AMM pools a transaction made: one hop per pool that took in one asset and paid out another.
 * `in` and `out` are the pool's own changes (positive, whole units), so an issuer's transfer fee shows as the
 * difference between `out` and what the receiver got. A pool that took in or paid out both of its assets (a
 * deposit, a withdrawal, a creation), only one (a single-asset deposit or withdrawal), or none is not a hop.
 * A transaction that did not succeed has no hops.
 */
export function ammHops(meta: TxMeta, native: Native): AmmHop[] {
  if (meta.TransactionResult !== "tesSUCCESS") return [];

  const nodes = nodesOf(meta);
  const hops: AmmHop[] = [];
  for (const pool of poolsOf(nodes)) {
    const deltas = deltasOf(pool, nodes, native);
    const into = deltas.filter(({ change }) => change.isPositive());
    const out = deltas.filter(({ change }) => change.isNegative());
    if (deltas.length !== 2 || into.length !== 1 || out.length !== 1) continue;
    hops.push({
      pool,
      in: { ...into[0]!.asset, value: into[0]!.change.toFixed() },
      out: { ...out[0]!.asset, value: out[0]!.change.abs().toFixed() },
    });
  }
  return inPathOrder(hops);
}
