// The account route's loader run directly, for the Worker specs that read what it hands the page (the header's name, the names parts, a list or a card that is still
// a promise) rather than the HTML: a `.data` body has the streamed parts as promises that `decodeLoaderData` does not decode. The load context is the Worker's own
// (`createLoadContext`, over the Cache API and the upstream mock), with a degraded mark that records each reason. For the Workers runtime: `env` and the Cache API.

import { env } from "cloudflare:workers";

import { loader } from "../../app/routes/net.account.$address";
import type { AccountPageData } from "../../app/server/account-view";
import { createLoadContext, type Env } from "../../app/server/env";
import { recordingMark } from "./degraded-mark";

const ORIGIN = "https://explorer.test";

/** A request's `waitUntil`: what the Worker hands it (a subrequest's store) runs on, and is not awaited. */
const executionContext = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

/**
 * The data the account route's loader gives for `path` (`/xrpl/account/r…?tab=…`), with `switches` over the Worker's own, and every reason the request was marked degraded
 * for, in order: a part that streams marks it when it settles, so read `marks` after awaiting it. `path` must be an account page (not a redirect or a 404).
 */
export async function loadAccountPage<T extends AccountPageData>(path: string, switches: Partial<Env> = {}): Promise<{ data: T; marks: string[] }> {
  const { mark, marks } = recordingMark();
  const url = new URL(path, ORIGIN);
  const [, net, , address] = url.pathname.split("/");
  const context = createLoadContext({ ...(env as unknown as Env), ...switches }, executionContext, mark);
  const result = (await loader({ request: new Request(url), params: { net, address }, context } as never)) as { data?: T };
  if (result.data?.kind !== "account") throw new Error(`${path} is not an account page`);
  return { data: result.data, marks };
}
