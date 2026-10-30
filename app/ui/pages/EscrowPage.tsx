import type { EscrowPageData } from "../../server/escrow-view";
import { WindowBar } from "../charts/WindowBar";
import { LedgerObjectFrame } from "./LedgerObjectFrame";

/**
 * An escrow's page (ledger object pages spec 4.1 and 4.2; the Escrow board): `LedgerObjectFrame` draws the breadcrumb "{Net} / Accounts / {owner} / Escrow", the head, the summary sentence, the
 * status lines with the age of each date they name, the rows and the as-of note; this adds the window bar between the status and the rows. Takes what the view builder made (`escrowPage`) and
 * never fetches.
 *
 * The window bar comes after the summary and the status lines: its tooltip opens over it, and the card, which clips what is outside it, has their room above the bar for it. The page's moment,
 * which the ages are told against, is the bar's mark: the ledger the page is as of, or the escrow's removal.
 */
export function EscrowPage({ data }: { data: EscrowPageData }) {
  const asOf = Number(data.windowBar.mark.at);
  const moments = [...data.windowBar.bounds.map((bound) => Number(bound.at)), asOf];
  return (
    <LedgerObjectFrame data={data} title="Escrow" moments={moments} asOf={asOf}>
      <div className="object-page__figure">
        <WindowBar data={data.windowBar} />
      </div>
    </LedgerObjectFrame>
  );
}
