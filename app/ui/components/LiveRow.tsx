import { cx } from "../cx";
import type { LiveControls } from "../use-live-controls";
import { LiveStatus, LiveToggle, PAUSED_AFTER_FAILURES } from "./LiveStatus";

/** What a live row needs of a page's `LiveControls`: no hold handler, which belongs to the parts of the page that hold it. */
export type LiveRowControls = Pick<LiveControls, "paused" | "held" | "notice" | "failures" | "onTogglePause">;

/**
 * The live row of every page that follows the chain: the home hero's parts and classes, a green dot and a line, the status line that
 * says when the updates cannot reach the page, the note that the page waits while the visitor is on a part of it, and the button that
 * pauses and resumes the updates (README, "Live updates"). The row is 44 px high from the start, so the button that joins when the
 * script runs moves nothing below it.
 *
 * It holds no heading and no breadcrumb: the page puts its own beside it. `live` is what the route gives the page: without it (a page drawn
 * with no route, as in tests) there is the dot and the words, and no status, button or note. `heldNote` says why the page waits.
 */
export function LiveRow({
  label,
  live,
  heldNote = "Paused while you look at the table",
}: {
  /** The words beside the dot: "Live · updates every ledger". */
  label: string;
  live?: LiveRowControls;
  heldNote?: string;
}) {
  const stopped = live !== undefined && (live.paused || live.held || live.failures >= PAUSED_AFTER_FAILURES);
  return (
    <div className="hero__status-row">
      <p className="hero__status">
        <span className={cx("hero__dot", stopped && "is-paused")} aria-hidden="true" />
        <span>
          {label}
          {live && <LiveStatus failures={live.failures} paused={live.paused} notice={live.notice} />}
        </span>
      </p>
      {live?.held && <span className="hero__held">{heldNote}</span>}
      {live && <LiveToggle paused={live.paused} onToggle={live.onTogglePause} />}
    </div>
  );
}
