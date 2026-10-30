import { formatCurrency } from "../../domain/format";
import type { DisplayAmount } from "../../server/ledger-object-view";
import type { PaymentChannelPageData } from "../../server/payment-channel-view";
import { Legend } from "../charts/Legend";
import { ShareBar, shareLegend } from "../charts/ShareBar";
import { AccountLink } from "../components/AccountLink";
import { Amount } from "../components/Amount";
import { MptAmount } from "../components/MptAmount";
import { Sentence } from "../components/Sentence";
import { useNetwork } from "../use-network";
import { accountOf, DatedSentence, LedgerObjectFrame, ObjectDetails } from "./LedgerObjectFrame";

/** An amount under the deposit bar: `Amount` (its issuer in a title, and no link: the Deposited row has it) or `MptAmount`. */
function ShareAmount({ amount }: { amount: DisplayAmount }) {
  return "mpt" in amount ? <MptAmount id={amount.mpt.id} units={amount.mpt.units} /> : <Amount value={amount.value} currency={amount.currency} issuer={amount.issuer} />;
}

/** What the bar's total counts, printed after it: the deposit's currency ("1 XRP"), or "units" for an MPT. */
function unitOf(amount: DisplayAmount | null): { one: string; other: string } | undefined {
  if (amount === null) return undefined;
  if ("mpt" in amount) return { one: "unit", other: "units" };
  const currency = formatCurrency(amount.currency);
  return { one: currency, other: currency };
}

/**
 * A payment channel's page (ledger object pages spec 4.1 and 4.4; the PayChannel board): in `LedgerObjectFrame`, the breadcrumb "{Net} / Accounts / {source} / Payment channel" (the source as
 * its link, by its name where the page's names have one, as everywhere), and in the Details card the summary sentence, the status lines with the age of each date they name, the deposit bar
 * (`ShareBar`: one row of what was paid out and what is left, or returned to the source once the channel is closed) with each part's amount and share under it, the board's paragraph on
 * claims, the rows and the as-of note. Takes what the view builder made (`paymentChannelPage`) and never fetches.
 *
 * With no deposit to share out (D5 could not read the amount or the balance, or they do not add up) the bar and the parts are left out: the rows say what is missing. The ages are the
 * browser's: the page's data holds the dates (`dates`) and the moment it is as of (`asOfAt`), and the Worker prints each date written out with an empty `<time>` beside it.
 */
export function PaymentChannelPage({ data }: { data: PaymentChannelPageData }) {
  const network = useNetwork();
  const net = data.net;
  const source = accountOf(data.details, "Source");
  return (
    <LedgerObjectFrame
      data={data}
      title="Payment channel"
      breadcrumb={[
        { label: network.name, href: `/${net}` },
        { label: "Accounts" },
        ...(source === undefined ? [] : [{ label: <AccountLink net={net} address={source} /> }]),
        { label: "Payment channel" },
      ]}
    >
      <p className="sentence object-page__summary">
        <Sentence net={net} segments={data.summary} />
      </p>
      <div className="object-page__status">
        {data.statusLines.map((line, index) => (
          <p key={index} className={index === 0 ? "object-page__headline" : undefined}>
            <DatedSentence net={net} segments={line} moments={data.dates} asOf={data.asOfAt} />
          </p>
        ))}
      </div>
      {data.shares.length > 0 && (
        <div className="object-page__deposit" role="group" aria-label="Deposit paid out and left">
          <Legend items={shareLegend(data.deposit)} />
          <ShareBar title="Paid out and left" data={data.deposit} unit={unitOf(data.amount)} />
          <div className="object-page__shares">
            {data.shares.map((share) => (
              <p key={share.id} className="object-page__share">
                <span className="object-page__share-name">{share.name}</span>
                <span className="object-page__share-amount">
                  <ShareAmount amount={share.amount} />
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
      <ObjectDetails net={net} rows={data.details} asOf={data.asOfAt} />
    </LedgerObjectFrame>
  );
}
