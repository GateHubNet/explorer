import type { EscrowPageData } from "../../server/escrow-view";
import { WindowBar } from "../charts/WindowBar";
import { AccountLink } from "../components/AccountLink";
import { Sentence } from "../components/Sentence";
import { useNetwork } from "../use-network";
import { accountOf, DatedSentence, LedgerObjectFrame, ObjectDetails } from "./LedgerObjectFrame";

/**
 * An escrow's page (ledger object pages spec 4.1 and 4.2; the Escrow board): in `LedgerObjectFrame`, the breadcrumb "{Net} / Accounts / {owner} / Escrow" (the owner as its link, by its name
 * where the page's names have one, as everywhere), and in the Details card the summary sentence, the status lines with the age of each date they name, the window bar, the rows and the as-of note.
 * Takes what the view builder made (`escrowPage`) and never fetches.
 *
 * The window bar comes after the summary and the status lines: its tooltip opens over it, and the card, which clips what is outside it, has their room above the bar for it. The page's moment,
 * which the ages are told against, is the bar's mark: the ledger the page is as of, or the escrow's removal.
 */
export function EscrowPage({ data }: { data: EscrowPageData }) {
  const network = useNetwork();
  const net = data.net;
  const owner = accountOf(data.details, "Owner");
  const asOf = Number(data.windowBar.mark.at);
  const moments = [...data.windowBar.bounds.map((bound) => Number(bound.at)), asOf];
  return (
    <LedgerObjectFrame
      data={data}
      title="Escrow"
      breadcrumb={[
        { label: network.name, href: `/${net}` },
        { label: "Accounts" },
        ...(owner === undefined ? [] : [{ label: <AccountLink net={net} address={owner} /> }]),
        { label: "Escrow" },
      ]}
    >
      <p className="sentence object-page__summary">
        <Sentence net={net} segments={data.summary} />
      </p>
      <div className="object-page__status">
        {data.statusLines.map((line, index) => (
          <p key={index} className={index === 0 ? "object-page__headline" : undefined}>
            <DatedSentence net={net} segments={line} moments={moments} asOf={asOf} />
          </p>
        ))}
      </div>
      <div className="object-page__figure">
        <WindowBar data={data.windowBar} />
      </div>
      <ObjectDetails net={net} rows={data.details} asOf={asOf} />
    </LedgerObjectFrame>
  );
}
