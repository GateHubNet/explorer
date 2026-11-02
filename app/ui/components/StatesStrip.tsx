import { useId } from "react";

import { cx } from "../cx";

export interface StateItem {
  /** The state's key, for the list: the status the object's page names. */
  id: string;
  label: string;
  /** What the state means, in one line. */
  meaning: string;
  /** Whether this is the object's state. At most one is; none, for an object another kind of transaction removed. */
  current: boolean;
}

/**
 * The states an object of a kind can be in, in the order they come, each with what it means, and the object's own marked (the board's strip, as a legend: it switches nothing).
 * The current one has `aria-current="true"` and says so in words, "· this escrow", with a frame in the link colour; none is marked for an object that is in none of them.
 * `what` is the kind of object as the words have it ("escrow", "check", "channel").
 */
export function StatesStrip({ states, what }: { states: readonly StateItem[]; what: string }) {
  const titleId = useId();
  return (
    <div className="states">
      <span id={titleId} className="states__title">
        States
      </span>
      <ol className="states__list" aria-labelledby={titleId}>
        {states.map((state) => (
          <li key={state.id} className={cx("states__item", state.current && "is-current")} aria-current={state.current ? "true" : undefined}>
            <span className="states__name">
              {state.label}
              {state.current && <span className="states__here"> · this {what}</span>}
            </span>
            <span className="states__meaning">{state.meaning}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
