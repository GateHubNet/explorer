// The head the MPT holders' and transfers' pages share (E14 spec 3.4): the first line of the MPT page's header card (the coin, the name, the ticker and "MPT", the issuer), as a link back to the
// issuance's page, then the heading of the list and the line under it. Browser code: it imports nothing of the Worker at run time (test/unit/mpt-bundle.test.ts).

import { Link } from "react-router";

import type { MptListPageBase } from "../../server/mpt-view";
import { AccountLink } from "../components/AccountLink";
import { Notice } from "../components/Notice";
import { PairCoins } from "../components/PairCoins";

/**
 * The head of a list page: the issuance as a line that leads back to its page (the name is the link; the coin, the tags and the issuer sit beside it), the `<h1>` of the list ("Holders of HTF"),
 * the line of what is held, and a button back. A notice says an issuance read from the network is not in the index yet. Everything the issuer wrote (the name, the ticker) is React text.
 */
export function MptListHead({ data }: { data: MptListPageBase }) {
  const { head, network } = data;
  return (
    <>
      <section className="card token-page__card" aria-labelledby="mpt-list-title">
        <div className="token-page__head">
          <PairCoins codes={[head.letter]} className="token-page__coin" />
          <div className="token-page__titles">
            <p className="token-page__name mpt__headline">
              <Link to={data.back.href} className="mpt__headlink">
                {head.heading}
              </Link>
              {head.ticker !== undefined && <span className="tag mono token-page__code">{head.ticker}</span>}
              <span className="tag">MPT</span>
            </p>
            <h1 id="mpt-list-title" className="token-page__title">
              {data.title}
            </h1>
            <p className="tokens__intro">{data.summary}</p>
            <p className="token-page__issuer">
              <span>Issued by</span> <AccountLink net={network.id} address={head.issuer} full />
            </p>
          </div>
          <div className="token-page__buttons">
            <Link className="btn" to={data.back.href}>
              {data.back.label}
            </Link>
          </div>
        </div>
      </section>
      {data.notices.map((notice) => (
        <Notice key={notice.text} tone={notice.tone}>
          {notice.text}
        </Notice>
      ))}
    </>
  );
}
