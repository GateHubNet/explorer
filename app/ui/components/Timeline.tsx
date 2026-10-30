import type { ReactNode } from "react";

import type { Segment } from "../../domain/describe";
import { formatUtc } from "../../domain/format";
import type { NetworkId } from "../../server/networks";
import { cx } from "../cx";
import { AccountLink } from "./AccountLink";
import { Countdown } from "./Countdown";
import { HashLink, LedgerLink } from "./HashLink";
import { Pager } from "./Pager";
import { RelativeTime } from "./RelativeTime";
import { Sentence } from "./Sentence";
import { TypeTag } from "./TypeTag";

/**
 * One line of an object's history: a transaction that happened (`tx`), a time that passed (`mark`: FinishAfter, an Expiration), or something that can still happen (`next`: an
 * EscrowFinish, a CheckCancel). `at` is unix seconds. A `tx` has its `at`, written out and with its age beside it; a `mark` may have one (its age comes beside `whenText`); a `next`
 * has one only when it is in the future, and its countdown comes beside `whenText`. `whenText` is the page's own words for the time ("From Oct 29, 2026, 09:34 UTC"), so that
 * the stored page says it without an age. `by` is the account the transaction is from, `delegate` the account that sent it for it.
 */
export interface TimelineItem {
  kind: "tx" | "mark" | "next";
  type: string;
  title: string;
  at?: number;
  whenText?: string;
  what: Segment[];
  by?: string;
  delegate?: string;
  hash?: string;
  ledger?: number;
}

/**
 * The moment of an item, beside its words: for a transaction the time written out and its age; for a mark the page's words and the age of the time that passed; for a next
 * step the page's words and the countdown to the time, which says "now" once it has come. The ages and the countdown are the browser's: the server prints the words alone.
 * `null` when there is nothing to say.
 */
function whenOf(item: TimelineItem): ReactNode {
  const { at } = item;
  const known = at !== undefined && Number.isFinite(at);
  if (item.kind === "tx") {
    return known ? (
      <>
        <time dateTime={new Date(at * 1000).toISOString()}>{formatUtc(at)}</time>
        <RelativeTime at={at} lead=" · " />
      </>
    ) : null;
  }
  if (item.whenText === undefined) return null;
  return (
    <>
      {item.whenText}
      {known && (item.kind === "mark" ? <RelativeTime at={at} lead=" · " /> : <Countdown at={at} fallback="" past="now" lead=" · " />)}
    </>
  );
}

/**
 * The history of a ledger object, oldest first, as a list with a dot for each line on a rail (the board's): a filled dot for a transaction, an outlined one for a time that
 * passed, a dashed one for what can still happen, whose type tag is a dashed ghost. A transaction names who sent it ("by", and "sent by" for a delegate, both through
 * `AccountLink`), its hash and its ledger. What an event did is `Sentence`'s. `footnote` says how to read it. `newer` and `older` are the hrefs of the other pages of events
 * (the pager keeps the window where it is: the history starts mid-page); none, no pager.
 *
 * Every link in a line is underlined by the stylesheet (`.timeline__line`, except a chip and a named account, which tell themselves): a link in a sentence is told by more than its colour.
 */
export function Timeline({
  net,
  items,
  footnote,
  newer,
  older,
}: {
  net: NetworkId;
  items: readonly TimelineItem[];
  footnote: string;
  newer?: string;
  older?: string;
}) {
  return (
    <div className="timeline">
      <ol className="timeline__list">
        {items.map((item, index) => {
          const when = whenOf(item);
          return (
            <li key={index} className="timeline__item">
              <span className={cx("timeline__dot", `timeline__dot--${item.kind}`)} aria-hidden="true" />
              <div className="timeline__body">
                <div className="timeline__head">
                  {item.kind === "tx" ? <TypeTag type={item.type} /> : <span className="type timeline__type--ghost">{item.type}</span>}
                  <span className="timeline__title">{item.title}</span>
                </div>
                {when !== null && <div className="timeline__when num">{when}</div>}
                {item.what.length > 0 && (
                  <p className="sentence timeline__line timeline__what">
                    <Sentence net={net} segments={item.what} />
                  </p>
                )}
                {item.by !== undefined && (
                  <div className="timeline__line timeline__by">
                    by <AccountLink net={net} address={item.by} />
                    {item.delegate !== undefined && (
                      <>
                        {" · sent by "}
                        <AccountLink net={net} address={item.delegate} />
                      </>
                    )}
                  </div>
                )}
                {(item.hash !== undefined || item.ledger !== undefined) && (
                  <div className="timeline__line timeline__ref">
                    {item.hash !== undefined && <HashLink net={net} kind="tx" hash={item.hash} />}
                    {item.hash !== undefined && item.ledger !== undefined && " · "}
                    {item.ledger !== undefined && (
                      <>
                        ledger <LedgerLink net={net} index={item.ledger} />
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="timeline__footnote">{footnote}</p>
      {(newer !== undefined || older !== undefined) && <Pager newerHref={newer} olderHref={older} preventScrollReset />}
    </div>
  );
}
