import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { anchors, pageClient } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The token pages with every switch "off" (the `worker-off` project, README "Switches"), as production has them until the owner turns `TOKENS` on (token pages spec 1.4 and 13). `TOKENS` is
// page-level: the header's Tokens item is the "soon" label, a label and not a link. The `worker` project's cases, with the switch on, are the specs of the token pages; the later tasks add
// their routes' 404s, the token image and the places that link a token to this file.

const { page } = pageClient("198.18.94");

let mock: UpstreamMock | undefined;
afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  expect(unused ?? []).toEqual([]);
});

describe("the project", () => {
  it("is the one with TOKENS off", () => {
    expect((env as unknown as Record<string, string>).TOKENS).toBe("off");
  });
});

describe("the header with TOKENS off", () => {
  const SOON = '<span class="nav-item is-soon" aria-disabled="true"><span>Tokens</span><span class="soon">soon</span></span>';

  it("the header's Tokens item is the soon label", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl");

    expect(html).toContain(SOON);
    expect(html).not.toMatch(/href="\/(xrpl|xahau)\/tokens"/);
    expect(anchors(html).map((a) => a.text)).not.toContain("Tokens");
    // Between Transactions and Network, where the link is when it is on.
    expect(html.indexOf(SOON)).toBeGreaterThan(html.indexOf(">Transactions</a>"));
    expect(html.indexOf(SOON)).toBeLessThan(html.indexOf(">Network</a>"));
  });
});
