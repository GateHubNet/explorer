import type { CheckPageData } from "../../server/check-view";
import { AccountLink } from "../components/AccountLink";
import { CheckFlow } from "../components/CheckFlow";
import { Notice } from "../components/Notice";
import { Sentence } from "../components/Sentence";
import { useNetwork } from "../use-network";
import { accountOf, DatedSentence, LedgerObjectFrame, ObjectDetails } from "./LedgerObjectFrame";

/**
 * A check's page (ledger object pages spec 4.1 and 4.3; the Check board): in `LedgerObjectFrame`, the breadcrumb "{Net} / Accounts / {source} / Check" (the source as its link, by its name
 * where the page's names have one, as everywhere), the banner "Expired, but still in the ledger" of a check that expired and was not cancelled, and in the Details card the summary sentence, the
 * status lines with the age of each date they name, the flow of its three boxes (the source, the check, the destination) and the rows and the as-of note. Takes what the view builder made
 * (`checkPage`) and never fetches.
 *
 * The ages are the browser's: the page's data holds the dates (`dates`) and the moment it is as of (`asOfAt`), and the Worker prints each date written out with an empty `<time>` beside it.
 * The flow stands in `.object-page__flow`, which stacks its boxes where the card is too narrow for three in a row (pages.css). The expired banner is a `Notice` whose body has the look of the
 * removed banner's note (`.object-page__removed-note`): the two are the same kind of line, one under the heading.
 */
export function CheckPage({ data }: { data: CheckPageData }) {
  const network = useNetwork();
  const net = data.net;
  const source = accountOf(data.details, "Source");
  return (
    <LedgerObjectFrame
      data={data}
      title="Check"
      breadcrumb={[
        { label: network.name, href: `/${net}` },
        { label: "Accounts" },
        ...(source === undefined ? [] : [{ label: <AccountLink net={net} address={source} /> }]),
        { label: "Check" },
      ]}
      extra={
        data.expiredBanner === null ? undefined : (
          <Notice tone="info" title="Expired, but still in the ledger">
            <p className="object-page__removed-note">
              <Sentence net={net} segments={data.expiredBanner} />
            </p>
          </Notice>
        )
      }
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
      <div className="object-page__flow">
        <CheckFlow net={net} flow={data.flow} />
      </div>
      <ObjectDetails net={net} rows={data.details} asOf={data.asOfAt} />
    </LedgerObjectFrame>
  );
}
