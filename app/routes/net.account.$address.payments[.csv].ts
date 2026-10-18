import { isValidClassicAddress } from "ripple-address-codec";
import type { LoaderFunctionArgs } from "react-router";

import { clientsFor } from "../server/clients";
import { cacheClassHeaders } from "../server/edge-cache";
import { getEnv } from "../server/env";
import { isMarker } from "../server/marker";
import { isNetworkId, networkOf } from "../server/networks";
import { UpstreamError } from "../server/upstream";
import type { CsvPage } from "../server/data-api";

// `/{net}/account/{address}/payments.csv`: the Payments tab's "Download CSV". A resource route, not a page: one page of the data API's
// own CSV of the account's payments (`format=csv`, newest first, at the most the API serves in a page), passed on as it arrives.
//
// Out go the body, a Content-Type, the explorer's own file name, `X-Robots-Tag: noindex` and, when there is a next page, a `Link`
// that names the explorer's own URL for it. Nothing else of the API's answer is passed on: its `Link` names the API's own URL, and
// its Content-Disposition its own file name. The API key goes to the API in its header and nowhere else.
//
// Class `short`: the edge keeps a copy for 30 s, so a download that is repeated does not ask the API again. A failure is never stored
// (a 503 names no class), and what is not a CSV page of an account (an address that is not one, a marker that is not one) is a 404
// without a call.

const NO_INDEX = "noindex";

function notFound(why: string): Response {
  const headers = cacheClassHeaders("short");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("X-Robots-Tag", NO_INDEX);
  return new Response(`${why}\n`, { status: 404, headers });
}

function unavailable(error: UpstreamError): Response {
  const wait = error.retryAfter !== undefined && Number.isInteger(error.retryAfter) && error.retryAfter > 0 ? error.retryAfter : 30;
  return new Response("The payments could not be loaded just now. Try again in a minute.\n", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(wait), "X-Robots-Tag": NO_INDEX },
  });
}

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const segment = params.net ?? "";
  if (!isNetworkId(segment)) return notFound("There is no such network.");
  const network = networkOf(segment, getEnv(context));

  const address = params.address ?? "";
  if (!isValidClassicAddress(address)) return notFound("That is not an account address.");

  const marker = new URL(request.url).searchParams.get("marker");
  if (marker !== null && !isMarker(marker)) return notFound("That is not a page of this list.");

  let page: CsvPage;
  try {
    page = await clientsFor(context, network).api.accountPaymentsCsv(address, { marker: marker ?? undefined });
  } catch (err) {
    if (err instanceof UpstreamError) {
      // The API refuses a marker that is not one (a 400).
      return err.kind === "bad_request" ? notFound("That is not a page of this list.") : unavailable(err);
    }
    throw err;
  }

  const file = `${address}-payments.csv`;
  const headers = cacheClassHeaders("short");
  headers.set("Content-Type", "text/csv; charset=utf-8");
  // An address is base58, so the name needs no escaping.
  headers.set("Content-Disposition", `attachment; filename="${file}"; filename*=UTF-8''${file}`);
  headers.set("X-Robots-Tag", NO_INDEX);
  headers.set("X-Content-Type-Options", "nosniff");
  if (page.nextMarker !== undefined) {
    headers.set("Link", `</${network.id}/account/${address}/payments.csv?marker=${encodeURIComponent(page.nextMarker)}>; rel="next"`);
  }
  return new Response(page.body, { status: 200, headers });
}
