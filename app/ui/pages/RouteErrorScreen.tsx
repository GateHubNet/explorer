import { isRouteErrorResponse, useLocation, type MetaDescriptor } from "react-router";

import { PRODUCT_NAME } from "../brand";
import type { NetworkBrief } from "../networks";
import { NotFoundPage, type NotFoundSuggestion } from "./NotFoundPage";

type Shown =
  | { kind: "not-found"; title: string; what?: string; suggestion?: NotFoundSuggestion }
  | { kind: "unavailable"; title: string }
  | { kind: "rate-limited"; title: string; retryAfter?: number }
  | { kind: "error"; title: string };

/** What a loader threw with `{ notFound: "ledger 99" }` (`upstreamFailure`, `requireNetwork`), if it is that. */
function notFoundPhrase(data: unknown): string | undefined {
  if (typeof data === "object" && data !== null && "notFound" in data && typeof data.notFound === "string") {
    return data.notFound;
  }
  return undefined;
}

/** The "on the other network" offer a loader threw with a 404 (`{ notFound, suggestion: { href, label } }`), if it threw one. */
function notFoundSuggestion(data: unknown): NotFoundSuggestion | undefined {
  if (typeof data !== "object" || data === null || !("suggestion" in data)) return undefined;
  const { suggestion } = data;
  if (typeof suggestion !== "object" || suggestion === null) return undefined;
  const { href, label } = suggestion as Record<string, unknown>;
  // A link that stays on this site: the data came from the Worker, but a path is all a suggestion is.
  if (typeof href !== "string" || typeof label !== "string" || !href.startsWith("/") || href.startsWith("//")) return undefined;
  return { href, label };
}

/** The longest wait the screen names. A longer one (or none) is "a moment": the screen is for a limit counted in seconds. */
const MAX_NAMED_WAIT = 120;

/** `value` as a wait in whole seconds, if it is one the screen names. */
function asWait(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_NAMED_WAIT ? value : undefined;
}

/**
 * How long a 429 says to wait, if it says. A client-side navigation over the visitor limit is answered with the Worker's own 429 page, which
 * React Router turns into an `ErrorResponse` whose `data` is the page's text and whose headers are gone, so the page names the wait in a
 * meta tag (`<meta name="retry-after" content="10">`, edge-cache.ts). A 429 a loader threw with `{ retryAfter }` is read too.
 */
function retryAfterOf(data: unknown): number | undefined {
  if (typeof data === "string") {
    const named = /<meta name="retry-after" content="(\d{1,6})">/.exec(data);
    return named ? asWait(Number(named[1])) : undefined;
  }
  if (typeof data === "object" && data !== null && "retryAfter" in data) return asWait(data.retryAfter);
  return undefined;
}

function shownFor(error: unknown, unknownNetwork: string | undefined): Shown {
  if (unknownNetwork !== undefined) return { kind: "not-found", title: "Network not found" };
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      const what = notFoundPhrase(error.data);
      if (what === undefined) return { kind: "not-found", title: "Page not found" };
      const suggestion = notFoundSuggestion(error.data);
      return suggestion ? { kind: "not-found", title: "Not found", what, suggestion } : { kind: "not-found", title: "Not found", what };
    }
    if (error.status === 429) {
      const retryAfter = retryAfterOf(error.data);
      return retryAfter === undefined ? { kind: "rate-limited", title: "Too many requests" } : { kind: "rate-limited", title: "Too many requests", retryAfter };
    }
    if (error.status === 503) return { kind: "unavailable", title: "Temporarily unavailable" };
  }
  return { kind: "error", title: "Something went wrong" };
}

function messageFor(shown: Exclude<Shown, { kind: "not-found" }>): string {
  switch (shown.kind) {
    case "unavailable":
      return "The data for this page could not be loaded just now. Try again in a minute.";
    case "rate-limited":
      return `You are asking for pages faster than we can serve them. Try again in ${
        shown.retryAfter === undefined ? "a moment" : `${shown.retryAfter} ${shown.retryAfter === 1 ? "second" : "seconds"}`
      }.`;
    case "error":
      return "The page could not be shown. Try again, or go back to the home page.";
  }
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
    return <NotFoundPage net={net} title={shown.title} what={shown.what} suggestion={shown.suggestion} />;
  }

  return (
    <div className="notfound">
      <h1>{shown.title}</h1>
      <p>{messageFor(shown)}</p>
      <p>
        <a href={`${location.pathname}${location.search}`}>Try again</a>
      </p>
      <p>
        <a href={`/${net.id}`}>Go to the {net.name} home</a>
      </p>
    </div>
  );
}
