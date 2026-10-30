import { formatCurrency } from "../../domain/format";
import type { DisplayAmount } from "../../server/ledger-object-view";
import type { PaymentChannelPageData } from "../../server/payment-channel-view";
import { Legend } from "../charts/Legend";
import { ShareBar, shareLegend } from "../charts/ShareBar";
import { Sentence } from "../components/Sentence";
import { AmountValue, LedgerObjectFrame } from "./LedgerObjectFrame";

/** The summary of the bar for a screen reader ends with where the values are, since this card has no table: under the bar. */
const VALUES_UNDER_THE_BAR = "Every value is listed under the bar.";

/** What the bar's total counts, printed after it: the deposit's currency ("1 XRP"), or "units" for an MPT. */
function unitOf(amount: DisplayAmount | null): { one: string; other: string } | undefined {
  if (amount === null) return undefined;
  if ("mpt" in amount) return { one: "unit", other: "units" };
  const currency = formatCurrency(amount.currency);
  return { one: currency, other: currency };
}

/**
 * A payment channel's page (ledger object pages spec 4.1 and 4.4; the PayChannel board): `LedgerObjectFrame` draws the breadcrumb "{Net} / Accounts / {source} / Payment channel", the head, the
 * summary sentence, the status lines with the age of each date they name, the rows and the as-of note; this adds, between the status and the rows, the deposit bar (`ShareBar`: one row of
 * what was paid out and what is left, or returned to the source once the channel is closed) with each part's amount and share under it, and the board's paragraph on claims. Takes what the
 * view builder made (`paymentChannelPage`) and never fetches.
 *
 * With no deposit to share out (D5 could not read the amount or the balance, or they do not add up) the bar and the parts are left out: the rows say what is missing. The ages are the
 * browser's: the page's data holds the dates (`dates`) and the moment it is as of (`asOfAt`), and the Worker prints each date written out with an empty `<time>` beside it.
 */
export function PaymentChannelPage({ data }: { data: PaymentChannelPageData }) {
  const net = data.net;
  return (
    <LedgerObjectFrame data={data} title="Payment channel" moments={data.dates} asOf={data.asOfAt}>
      {data.shares.length > 0 && (
        <div className="object-page__deposit" role="group" aria-label="Deposit paid out and left">
          <Legend items={shareLegend(data.deposit)} />
          <ShareBar title="Paid out and left" data={data.deposit} unit={unitOf(data.amount)} tableHint={VALUES_UNDER_THE_BAR} />
          <div className="object-page__shares">
            {data.shares.map((share) => (
              <p key={share.id} className="object-page__share">
                <span className="object-page__share-name">{share.name}</span>
                <span className="object-page__share-amount">
                  <AmountValue net={net} amount={share.amount} link={false} />
                </span>
                <span className="object-page__share-of">{share.share}</span>
              </p>
            ))}
          </div>
        </div>
      )}
      <p className="sentence object-page__claims">
        <Sentence net={net} segments={data.claimsNote} />
      </p>
    </LedgerObjectFrame>
  );
}
