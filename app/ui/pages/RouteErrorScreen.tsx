import { isRouteErrorResponse, useLocation, type MetaDescriptor } from "react-router";

import { PRODUCT_NAME } from "../brand";
import type { NetworkBrief } from "../networks";
import { NotFoundPage } from "./NotFoundPage";

type Shown =
  | { kind: "not-found"; title: string; what?: string }
  | { kind: "unavailable"; title: string }
  | { kind: "error"; title: string };

/** What a loader threw with `{ notFound: "ledger 99" }` (`upstreamFailure`, `requireNetwork`), if it is that. */
function notFoundPhrase(data: unknown): string | undefined {
  if (typeof data === "object" && data !== null && "notFound" in data && typeof data.notFound === "string") {
    return data.notFound;
  }
  return undefined;
}

function shownFor(error: unknown, unknownNetwork: string | undefined): Shown {
  if (unknownNetwork !== undefined) return { kind: "not-found", title: "Network not found" };
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      const what = notFoundPhrase(error.data);
      return what === undefined ? { kind: "not-found", title: "Page not found" } : { kind: "not-found", title: "Not found", what };
    }
    if (error.status === 503) return { kind: "unavailable", title: "Temporarily unavailable" };
  }
  return { kind: "error", title: "Something went wrong" };
}

/** The `meta` of a route that shows `RouteErrorScreen`: the title, and no indexing of an error page. */
export function errorMeta(error: unknown, unknownNetwork?: string): MetaDescriptor[] {
  return [{ title: `${shownFor(error, unknownNetwork).title} · ${PRODUCT_NAME}` }, { name: "robots", content: "noindex" }];
}

/**
 * What an error boundary shows: the not-found page for a 404, a "try again" page for a 503, and a plain apology for
 * everything else (the error is logged and reported by the server, and its message is not shown to visitors).
 * `unknownNetwork` is the `:net` segment when it names no network.
 */
export function RouteErrorScreen({
  error,
  net,
  unknownNetwork,
}: {
  error: unknown;
  net: NetworkBrief;
  unknownNetwork?: string;
}) {
  const location = useLocation();
  const shown = shownFor(error, unknownNetwork);

  if (shown.kind === "not-found") {
    if (unknownNetwork !== undefined) {
      return (
        <NotFoundPage
          net={net}
          title={shown.title}
          message={`There is no network called “${unknownNetwork.slice(0, 80)}”. This explorer covers XRPL and Xahau.`}
        />
      );
    }
    return <NotFoundPage net={net} title={shown.title} what={shown.what} />;
  }

  return (
    <div className="notfound">
      <h1>{shown.title}</h1>
      <p>
        {shown.kind === "unavailable"
          ? "The data for this page could not be loaded just now. Try again in a minute."
          : "The page could not be shown. Try again, or go back to the home page."}
      </p>
      <p>
        <a href={`${location.pathname}${location.search}`}>Try again</a>
      </p>
      <p>
        <a href={`/${net.id}`}>Go to the {net.name} home</a>
      </p>
    </div>
  );
}
