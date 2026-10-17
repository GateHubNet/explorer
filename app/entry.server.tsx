// React Router's server entry. The render is the framework's default (streaming, and waiting for everything for bots);
// the only addition is `handleError`, which reports the errors loaders throw (bugs, not 404s or 503s) to the log and,
// with a SENTRY_DSN, to Sentry.

import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import type { EntryContext, HandleErrorFunction, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";

import { handleLoaderError } from "./server/capture";

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
    signal: AbortSignal.timeout(streamTimeout + 1000),
    onError(error: unknown) {
      responseStatusCode = 500;
      // Errors inside the shell reject and are handled by handleDocumentRequest; only those from streaming are logged here.
      if (shellRendered) console.error(error);
    },
  });
  shellRendered = true;

  // Bots (and SPA mode) wait for all the content, so crawlers and link previews see the whole page.
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}

export const handleError: HandleErrorFunction = (error, args) => {
  handleLoaderError(error, args);
};
