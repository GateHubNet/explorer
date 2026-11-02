import type { CheckPageData } from "../../server/check-view";
import { CheckFlow } from "../components/CheckFlow";
import { Notice } from "../components/Notice";
import { Sentence } from "../components/Sentence";
import { LedgerObjectFrame } from "./LedgerObjectFrame";

/**
 * A check's page (ledger object pages spec 4.1 and 4.3; the Check board): `LedgerObjectFrame` draws the breadcrumb "{Net} / Accounts / {source} / Check", the head, the summary sentence, the
 * status lines with the age of each date they name, the rows and the as-of note; this adds the banner "Expired, but still in the ledger" of a check that expired and was not cancelled, and
 * the flow of its three boxes (the source, the check, the destination) between the status and the rows. Takes what the view builder made (`checkPage`) and never fetches.
 *
 * The ages are the browser's: the page's data holds the dates (`dates`) and the moment it is as of (`asOfAt`), and the Worker prints each date written out with an empty `<time>` beside it.
 * The flow stands in `.object-page__flow`, which stacks its boxes where the card is too narrow for three in a row (pages.css). The expired banner is a `Notice` whose body has the look of the
 * removed banner's note (`.object-page__removed-note`): the two are the same kind of line, one under the heading.
 */
export function CheckPage({ data }: { data: CheckPageData }) {
  const net = data.net;
  return (
    <LedgerObjectFrame
      data={data}
      title="Check"
      moments={data.dates}
      asOf={data.asOfAt}
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
      <div className="object-page__flow">
        <CheckFlow net={net} flow={data.flow} />
      </div>
    </LedgerObjectFrame>
  );
}
