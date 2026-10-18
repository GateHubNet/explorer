import { useEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "../cx";

/**
 * A button with a visible label that copies text to the clipboard (`Copy link`, `Copy`); `CopyButton` is the icon-only one
 * for a value on the page. `getText` is asked at the click, not at the render, so it may read what only the browser knows (the
 * page's address). The result is announced.
 */
export function CopyTextButton({ getText, className, children }: { getText: () => string; className?: string; children: ReactNode }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(getText());
      setState("copied");
    } catch {
      // No clipboard (an insecure context, an old browser) or no permission.
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <>
      <button type="button" className={cx("btn", className)} onClick={copy}>
        {children}
      </button>
      <span className="sr" role="status">
        {state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : ""}
      </span>
    </>
  );
}
