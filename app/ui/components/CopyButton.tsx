import { useEffect, useRef, useState } from "react";

import { CheckIcon, CopyIcon } from "./icons";

/** Copies `value` to the clipboard. `label` names it for screen readers ("Copy hash"); the result is announced. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      // No clipboard (an insecure context) or no permission.
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <>
      <button type="button" className="copy" aria-label={`Copy ${label}`} onClick={copy}>
        {state === "copied" ? <CheckIcon size={14} /> : <CopyIcon />}
      </button>
      <span className="sr" role="status">
        {state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : ""}
      </span>
    </>
  );
}
