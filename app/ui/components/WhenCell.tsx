// The time cell of the explorer's lists of transactions (the account's tabs, the pool page's activity): the UTC date as a link to the transaction, and the
// time of day under it. It imports nothing of the chart kit, `use-hydrated.ts` or `StatTile.tsx`: the account page loads it, and the page that loads the
// analytics view must load none of the kit (scripts/analytics-kit-copy.ts, P36).

import { Link } from "react-router";

import { formatUtc, shortHash } from "../../domain/format";
import type { NetworkInfo } from "../networks";

/** `2026-10-17 16:11:02 UTC` as the date and the time of day, which the lists print on two lines. */
function whenOf(time: number): { date: string; clock: string; full: string } {
  const full = formatUtc(time);
  return { date: full.slice(0, 10), clock: full.slice(11, 19), full };
}

/**
 * The same two lines with no link, for a list that links the transaction in a cell of its own (the NFT's history, the delegations). `title` is what else the moment belongs to (the
 * delegation's ledger).
 */
export function WhenText({ time, title }: { time: number; title?: string }) {
  const { date, clock } = whenOf(time);
  return (
    <span className="when num" title={title}>
      <span>{date}</span>
      <span className="faint">{clock}</span>
    </span>
  );
}

export function When({ net, hash, time }: { net: NetworkInfo["id"]; hash: string; time: number }) {
  const { date, clock } = whenOf(time);
  return (
    <span className="when num">
      <Link to={`/${net}/tx/${hash}`} aria-label={`${date}, transaction ${shortHash(hash)}`}>
        {date}
      </Link>
      <span className="faint">{clock}</span>
    </span>
  );
}
