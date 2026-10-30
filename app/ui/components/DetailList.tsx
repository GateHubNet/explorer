import type { ReactNode } from "react";

export interface DetailRow {
  label: string;
  /** The ledger's name for the field, a small mono line under the label (the object pages' "FinishAfter"), when it has one. */
  field?: string;
  value: ReactNode;
}

/** The label/value rows of a ledger header or a transaction's details (`<dl>`). */
export function DetailList({ rows }: { rows: readonly DetailRow[] }) {
  return (
    <dl className="kv-list">
      {rows.map((row, index) => (
        // The index too: a transaction can have two rows of the same name (Memo).
        <div key={`${index}:${row.label}`} className="kv">
          <dt>
            {row.label}
            {row.field !== undefined && <span className="kv__field mono">{row.field}</span>}
          </dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
