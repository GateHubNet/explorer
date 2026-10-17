import type { ReactNode } from "react";

import { cx } from "../cx";
import { AlertIcon, CheckIcon, InfoIcon } from "./icons";

export type NoticeTone = "info" | "success" | "warning" | "error";

const ICONS = { info: InfoIcon, success: CheckIcon, warning: AlertIcon, error: AlertIcon } as const;

/** A note above or inside a page: "Not in the index yet, shown from the network", a "Deleted" banner. Icon, optional title, text. */
export function Notice({ tone = "info", title, children }: { tone?: NoticeTone; title?: string; children?: ReactNode }) {
  const Icon = ICONS[tone];
  return (
    <div className={cx("notice", `notice--${tone}`)}>
      <span className="notice__icon">
        <Icon />
      </span>
      <div className="notice__body">
        {title && <strong className="notice__title">{title}</strong>}
        {children}
      </div>
    </div>
  );
}
