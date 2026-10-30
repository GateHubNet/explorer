import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { CHANNEL_ID, CHECK_ID, ESCROW_ID, ESCROW_OWNER } from "../support/object-samples";
import { pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The ledger object pages with every switch "off" (the `worker-off` project, README "Switches"), as production has them until the owner turns `LEDGER_OBJECTS` on (ledger object pages
// spec 1.2 and 10): an escrow's page and the owner-and-sequence address of an escrow, a check's page and a payment channel's are the not-found page, a 404 of class `short` made before any call
// (neither the ID nor the query is read: no redirect to the upper-case URL, no "not an ID", no keylet). The `worker` project's cases, with the switch on, are ledger-objects.spec.ts.

const { get, storedAs } = pageClient("198.18.91");

const SHORT = { cls: "short", ttl: 30 };

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

describe("the escrow pages with LEDGER_OBJECTS off", () => {
  it("is the project's: LEDGER_OBJECTS is off", () => {
    expect((env as unknown as Record<string, string>).LEDGER_OBJECTS).toBe("off");
  });

  it.each([
    [`/xrpl/escrows/${ESCROW_ID}`],
    [`/xahau/escrows/${ESCROW_ID}`],
    // The ID in lower case, a marker, an ID that is none: none of them is read.
    [`/xrpl/escrows/${ESCROW_ID.toLowerCase()}`],
    [`/xrpl/escrows/${ESCROW_ID}?marker=WzEwNzk0NTQzOCw5OF0`],
    ["/xrpl/escrows/nope"],
    // The owner and the sequence: no keylet is worked out, and a form the switch on would refuse is the same 404.
    [`/xrpl/escrows/${ESCROW_OWNER}/107896555`],
    [`/xrpl/escrows/${ESCROW_OWNER}/01`],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    const text = textOf(await response.text());

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find the escrow pages on");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });
});

describe("the check pages with LEDGER_OBJECTS off", () => {
  it.each([
    [`/xrpl/checks/${CHECK_ID}`],
    [`/xahau/checks/${CHECK_ID}`],
    // The ID in lower case, a marker, an ID that is none: none of them is read.
    [`/xrpl/checks/${CHECK_ID.toLowerCase()}`],
    [`/xrpl/checks/${CHECK_ID}?marker=WzEwNzk0NTQzOCw5OF0`],
    ["/xrpl/checks/nope"],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    const text = textOf(await response.text());

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find the check pages on");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });
});

describe("the payment channel pages with LEDGER_OBJECTS off", () => {
  it.each([
    [`/xrpl/payment-channels/${CHANNEL_ID}`],
    [`/xahau/payment-channels/${CHANNEL_ID}`],
    [`/xrpl/payment-channels/${CHANNEL_ID.toLowerCase()}`],
    [`/xrpl/payment-channels/${CHANNEL_ID}?marker=WzEwNzk0NTQzOCw5OF0`],
    ["/xrpl/payment-channels/nope"],
  ])("answers %s with the not-found page, a 404 of class short, and asks nothing upstream", async (path) => {
    mock = mockUpstream("xrpl");
    const response = await get(path);
    const text = textOf(await response.text());

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find the payment channel pages on");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });
});
