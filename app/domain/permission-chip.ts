// What a chip of a delegation's permission draws, and how many permissions a delegation holds: the words alone, without the table of the granular permissions (permissions.ts), so that
// `Sentence` and `PermissionChip`, which are on every page that draws a sentence, load only this. Pure: no import at run time.

/** What a chip of a permission draws: the `name` it is labelled with, its `kind`, the `words` that say what it allows and the `title` (the tooltip: the kind of right, then the words). */
export interface PermissionChipView {
  name: string;
  kind: "transaction" | "granular" | "unknown";
  words: string;
  title: string;
}

/**
 * A chip's tooltip, from its kind and words: the kind of right, then the words (a permission this explorer does not know is its words alone, which say so). What a sentence's
 * permission segment, which carries the kind and the words, is drawn with.
 */
export function permissionTitle(kind: PermissionChipView["kind"], words: string): string {
  return kind === "transaction" ? `Transaction type. ${words}` : kind === "granular" ? `Narrower right. ${words}` : words;
}

/** The most permissions one delegation grants (XLS-75). */
const MOST_PERMISSIONS = 10;

/** How many permissions a delegation grants, of the most it can: "3 of 10". */
export const permissionCount = (n: number): string => `${n} of ${MOST_PERMISSIONS}`;
