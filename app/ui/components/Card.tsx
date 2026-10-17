import { useId, type ReactNode } from "react";

import { cx } from "../cx";

/**
 * A bordered panel (1 px, 12 px radius). With a `title` it is a named section (an `h2`, and `action` at the end of the head
 * row); without one, pass `label` if it should be a landmark. `flush` takes the padding off the body, for a table. `id` is
 * on the root element, for a link to the card (`/{net}#latest-ledgers`, see anchors.ts).
 */
export function Card({
  as: Tag = "section",
  id,
  title,
  action,
  label,
  flush,
  className,
  children,
}: {
  as?: "section" | "aside" | "div";
  id?: string;
  title?: ReactNode;
  action?: ReactNode;
  label?: string;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Tag
      id={id}
      className={cx("card", flush && "card--flush", className)}
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : label}
    >
      {title && (
        <div className="card__head">
          <h2 id={titleId} className="card__title">
            {title}
          </h2>
          {action && <div className="card__action">{action}</div>}
        </div>
      )}
      <div className="card__body">{children}</div>
    </Tag>
  );
}
