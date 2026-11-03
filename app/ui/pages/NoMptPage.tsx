import { Link } from "react-router";

import type { NoMptPageData } from "../../server/mpt-view";
import { Breadcrumbs } from "../components/Breadcrumbs";

/**
 * The page for an issuance ID on a network without MPT (spec 3.6, the board's Xahau state; a 404 of class `short`, `noindex`, and no call was made): the breadcrumb, the heading, a sentence that
 * says MPTs exist only on the other network, the ID in mono, the way back to the tokens and the link that opens it on the other network (the board's button, as a link: the network is in the path;
 * in the sandbox it leads to XRPL Testnet). Takes the view builder's data (`noMptPage`) and never fetches.
 */
export function NoMptPage({ data }: { data: NoMptPageData }) {
  const { network, other, id } = data;
  return (
    <div className="tokens token-page mpt">
      <Breadcrumbs items={[{ label: network.name, href: `/${network.id}` }, { label: "Tokens", href: `/${network.id}/tokens` }, { label: "MPT" }]} />
      <section className="card mpt__none" aria-labelledby="mpt-none-title">
        <h1 id="mpt-none-title" className="token-page__title">
          {`MPT isn't enabled on ${network.name}`}
        </h1>
        <p className="mpt__none-text">{`MPTs exist only on ${other.name}, so there is nothing at this issuance ID on ${network.name}.`}</p>
        <p className="mono mpt__idtext">{id}</p>
        <div className="token-page__buttons">
          <Link className="btn" to={`/${network.id}/tokens`}>
            ← Back to tokens
          </Link>
          <Link className="btn" to={`/${other.id}/mpt/${id}`}>
            {`Open it on ${other.name}`}
          </Link>
        </div>
      </section>
    </div>
  );
}
