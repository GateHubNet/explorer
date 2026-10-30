import type { PermissionChipView } from "../../domain/permissions";
import { cx } from "../cx";

/**
 * A permission of a delegation as a word in a box (`permissionChip` makes the view): a transaction type is filled, a narrower right or a permission the explorer does not know is
 * outlined. What it allows is the `title` for a pointer, and the same words in text only a screen reader gets (`.sr`: a title is not read by every one of them, and a keyboard
 * cannot reach it). Not a control: it has no link and takes no focus.
 */
export function PermissionChip({ chip }: { chip: PermissionChipView }) {
  return (
    <span className={cx("permchip", chip.kind !== "transaction" && `permchip--${chip.kind}`)} title={chip.title}>
      {chip.name}
      <span className="sr">: {chip.words}</span>
    </span>
  );
}
