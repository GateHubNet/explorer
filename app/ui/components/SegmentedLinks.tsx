import { useId } from "react";
import { Link } from "react-router";

export interface SegmentLink {
  label: string;
  href: string;
  /** The view the page is showing: marked with `aria-current="true"`. */
  current: boolean;
  /** The link's `rel`: `nofollow` for a view crawlers are kept off (the account's analytics). */
  rel?: string;
}

/**
 * A segmented control of links, the one of every filter row of the explorer's pages (a period, a currency): a visible label, then the
 * network switch's pill of segments, each a link to the page's view of that choice. The links work without script; with it a click is a
 * client-side navigation that keeps the window where it is (`preventScrollReset`), so the page does not jump to the top for a change of period.
 *
 * The group is named by the visible label itself (`aria-labelledby`), so the name a screen reader says is the one the eye reads. The
 * segments are 32 px to look at with a 44 px target (the `netswitch` styles).
 *
 * `hideLabel` keeps the label for screen readers only (`.sr`), where the place of the control says what it is (the candle interval in a
 * chart card): the group is still named by it, and there is no other group around it.
 */
export function SegmentedLinks({ label, links, hideLabel = false }: { label: string; links: readonly SegmentLink[]; hideLabel?: boolean }) {
  const labelId = useId();
  return (
    <div className="seglinks">
      <span id={labelId} className={hideLabel ? "seglinks__label sr" : "seglinks__label"}>
        {label}
      </span>
      <div role="group" aria-labelledby={labelId} className="netswitch">
        {links.map((link) => (
          <Link
            key={link.href}
            to={link.href}
            preventScrollReset
            rel={link.rel}
            className="netswitch__item"
            aria-current={link.current ? "true" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
