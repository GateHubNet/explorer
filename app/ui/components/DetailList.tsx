import type { ReactNode } from "react";

export interface DetailRow {
  label: string;
  value: ReactNode;
}

/** The label/value rows of a ledger header or a transaction's details (`<dl>`). */
export function DetailList({ rows }: { rows: readonly DetailRow[] }) {
  return (
    <dl className="kv-list">
      {rows.map((row, index) => (
        // The index too: a transaction can have two rows of the same name (Memo).
        <div key={`${index}:${row.label}`} className="kv">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
