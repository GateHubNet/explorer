import type { ReactNode } from "react";

import { cx } from "../cx";
import { CheckIcon, CrossIcon } from "./icons";

/** `info` is the accent wash (an amendment about to activate); `off` is the outlined pill (obsolete, unknown, no recent vote). Colour is only for `ok` and `bad`. */
export type PillTone = "ok" | "bad" | "neutral" | "info" | "off";

/**
 * A status: an icon and a word, never colour alone (spec 7.1). `ok` and `bad` come with a check and a cross; the other tones have no
 * icon of their own, so pass one. Pass `icon` to change a default, or `icon={null}` for none. `mono` is for result codes.
 */
export function Pill({
  tone = "neutral",
  icon,
  mono,
  children,
}: {
  tone?: PillTone;
  icon?: ReactNode;
  mono?: boolean;
  children: ReactNode;
}) {
  const own = tone === "ok" ? <CheckIcon /> : tone === "bad" ? <CrossIcon /> : null;
  return (
    <span className={cx("pill", `pill--${tone}`, mono && "mono")}>
      {icon === undefined ? own : icon}
      {children}
    </span>
  );
}

/**
 * The result of a transaction: "Success" for a success (with the code beside it when `showCode`), the result code for a
 * failure. `ok` is `describe(...).result.ok` (the code's class), not a test of `tesSUCCESS`.
 */
export function ResultPill({ ok, code, showCode }: { ok: boolean; code: string; showCode?: boolean }) {
  if (!ok) {
    return (
      <Pill tone="bad" mono>
        {code}
      </Pill>
    );
  }
  return (
    <Pill tone="ok">
      Success
      {showCode && <span className="pill__code mono">{code}</span>}
    </Pill>
  );
}
