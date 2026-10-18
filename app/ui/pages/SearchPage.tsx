import type { SearchPageData } from "../../server/search-view";
import type { NetworkBrief } from "../networks";
import { NotFoundPage } from "./NotFoundPage";
import { SearchChoicePage } from "./SearchChoicePage";

/** What the search box takes, for a visitor who typed something it does not know (the wording of the box's own hint). */
function SearchHelp() {
  return (
    <>
      <p>You can search for:</p>
      <ul className="notfound__help">
        <li>An account address, starting with r, or an X-address</li>
        <li>A transaction or ledger hash: 64 hexadecimal characters</li>
        <li>A ledger index, such as 107695660</li>
        <li>A CTID: C followed by 15 hexadecimal characters</li>
      </ul>
    </>
  );
}

/** The pages of `/{net}/search` that are not a redirect (see `SearchPageData`). */
export function SearchPage({ network, data }: { network: NetworkBrief; data: SearchPageData }) {
  switch (data.kind) {
    case "choice":
      return <SearchChoicePage net={network} data={data} />;

    case "help":
      return (
        <NotFoundPage
          net={network}
          title={data.query ? "No match" : `Search ${network.name}`}
          message={
            data.query
              ? `Nothing on ${network.name} looks like “${data.query}”.`
              : "Enter an address, a transaction or ledger hash, a ledger index or a CTID."
          }
          query={data.query}
        >
          <SearchHelp />
        </NotFoundPage>
      );

    case "other-network":
      return (
        <NotFoundPage
          net={network}
          title={`That CTID is on ${data.other.name}`}
          message={`${data.ctid} belongs to ${data.other.name}, so it is not a transaction on ${network.name}.`}
          query={data.query}
          suggestion={{ href: `/${data.other.id}/tx/${data.ctid}`, label: `Open the transaction on ${data.other.name}` }}
        />
      );

    case "not-found":
      return <NotFoundPage net={network} what={data.what} message={data.message} query={data.query} suggestion={data.suggestion} />;
  }
}
