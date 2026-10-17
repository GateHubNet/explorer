import type { ReactNode } from "react";
import { Link } from "react-router";

import { SearchBox } from "../components/SearchBox";
import type { NetworkBrief } from "../networks";

export interface NotFoundSuggestion {
  href: string;
  label: string;
}

/**
 * The page for something that does not exist (spec 10): what was asked for, the search box with what was typed in it, and a
 * way home. Used by the `*` route, by the unknown-network 404, and by the error boundaries for a 404 that a loader threw.
 *
 * - `what` is the thing as a phrase (`ledger 107695660`, `transaction 67F91E…7C31`): "We couldn't find {what} on {network}."
 *   `message` replaces that sentence.
 * - `suggestion` is one more link, for "the same search on the other network".
 * - `children` follow the message, for anything the case needs besides.
 */
export function NotFoundPage({
  net,
  what,
  title = "Not found",
  message,
  query,
  suggestion,
  children,
}: {
  net: NetworkBrief;
  what?: string;
  title?: string;
  message?: ReactNode;
  query?: string;
  suggestion?: NotFoundSuggestion;
  children?: ReactNode;
}) {
  return (
    <div className="notfound">
      <h1>{title}</h1>
      <p>{message ?? (what ? `We couldn’t find ${what} on ${net.name}.` : `That page does not exist on ${net.name}.`)}</p>
      {children}
      <SearchBox net={net} variant="hero" shortcut={false} landmark={false} initialQuery={query} />
      {suggestion && (
        <p>
          <Link to={suggestion.href}>{suggestion.label}</Link>
        </p>
      )}
      <p>
        <Link to={`/${net.id}`}>Go to the {net.name} home</Link>
      </p>
    </div>
  );
}
