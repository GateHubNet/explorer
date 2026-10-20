import type { ReactNode } from "react";

import { useRetry } from "../use-retry";
import { AlertIcon } from "./icons";

/**
 * The note of a page whose node could not be asked: a warning with a title, what is missing and what is not, and a Retry that loads
 * the route's data again. `role="status"` makes it a live region; a page passes it when the note is the one announcement it makes.
 */
export function LiveStateNotice({
  title = "Live state unavailable",
  children,
  role,
}: {
  title?: string;
  children: ReactNode;
  role?: "status";
}) {
  const { retry, retrying } = useRetry();
  return (
    <div className="notice notice--warning" role={role}>
      <span className="notice__icon">
        <AlertIcon />
      </span>
      <div className="notice__body">
        <strong className="notice__title">{title}</strong>
        {children}
      </div>
      <button type="button" className="btn" onClick={retry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
