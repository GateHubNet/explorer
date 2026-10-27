import type { CoverageNoteText } from "../../server/coverage";
import type { NetworkId } from "../../server/networks";
import { LedgerLink } from "./HashLink";
import { InfoIcon } from "./icons";

/**
 * What the index does not hold of a list's or a figure's history (`coverageNote`, spec 8): one faint line with the info icon, directly under the list or figure it
 * is about, the ledger its history starts at as a link to the ledger's page. Nothing for `null` (the coverage is complete). The icon is decoration; `role="note"`
 * marks the line as an aside to what it follows.
 */
export function CoverageNote({ net, note }: { net: NetworkId; note: CoverageNoteText | null }) {
  if (note === null) return null;
  return (
    <p className="coverage-note" role="note">
      <InfoIcon size={14} />
      <span>
        {note.before}
        {note.ledger !== null && <LedgerLink net={net} index={note.ledger} />}
        {note.after}
      </span>
    </p>
  );
}
