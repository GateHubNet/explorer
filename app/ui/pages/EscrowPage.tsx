import type { EscrowPageData } from "../../server/escrow-view";
import { WindowBar } from "../charts/WindowBar";
import { LedgerObjectFrame } from "./LedgerObjectFrame";

/**
 * An escrow's page (ledger object pages spec 4.1 and 4.2; the Escrow board): `LedgerObjectFrame` draws the breadcrumb "{Net} / Accounts / {owner} / Escrow", the head, the summary sentence, the
 * status lines with the age of each date they name, the rows and the as-of note; this adds the window bar between the status and the rows. Takes what the view builder made (`escrowPage`) and
 * never fetches.
 *
 * The window bar comes after the summary and the status lines: its tooltip opens over it, and the card, which clips what is outside it, has their room above the bar for it. The dates the
 * status lines write out are the bar's bounds and its mark (the escrow's removal, when it has one), and the ages beside them are told against the moment the page is as of (`asOfAt`), as a
 * check's and a channel's are.
 */
export function EscrowPage({ data }: { data: EscrowPageData }) {
  const moments = [...data.windowBar.bounds, data.windowBar.mark].map((moment) => Number(moment.at));
  return (
    <LedgerObjectFrame data={data} title="Escrow" moments={moments} asOf={data.asOfAt}>
      <div className="object-page__figure">
        <WindowBar data={data.windowBar} />
      </div>
    </LedgerObjectFrame>
  );
}
