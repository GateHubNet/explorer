import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import xrplTransactions from "../fixtures/http/xrpl/data-api/transactions@descending=true&limit=8.json";
import mintTransaction from "../fixtures/http/xrpl/data-api/transactions/4D9BB2A0B0289D36A995B10AB17D5BE9B19E961B777AFDE29D84CC59384E74F6.json";
import { MPT_MINT_ISSUANCE, MPT_RECORDED } from "../support/mpt-case-rules";
import { anchors, elementText, pageClient, tableRows } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The MPT amounts of the pages with every switch "off" (the `worker-off` project, README "Switches"), as production has them until the owner turns `MPT` on (E14 spec 7): the pages draw what they drew
// before E14 — an MPT amount in units and the start of its issuance's ID, with no link to a page that is not there — and make no lookup (spec 2.4). The `worker` project's cases, with the switch on,
// are transaction-mpt.spec.ts and its likes. Later tasks add the account, escrow, MPT and tab pages here.

const { page, storedAs } = pageClient("198.18.116");

const IMMUTABLE = { cls: "immutable", ttl: 31_536_000 };

let mock: UpstreamMock | undefined;
afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  expect(unused ?? []).toEqual([]);
});

/** The `/v2/mpt` requests a mock saw: the lookup, and any other call of the MPT routes. */
const mptCalls = (seen: UpstreamMock) => seen.requests.filter((request) => new URL(request.url).pathname.startsWith("/v2/mpt")).map((request) => request.key);

describe("the project", () => {
  it("is the one with MPT off", () => {
    expect((env as unknown as Record<string, string>).MPT).toBe("off");
  });
});

describe("the transaction page with MPT off", () => {
  it("makes no lookup while MPT is off: the amount in units, with no link, the class immutable", async () => {
    const path = `/xrpl/tx/${MPT_RECORDED.payment_transfer_fee.hash}`;
    mock = mockUpstream("xrpl");
    const { html } = await page(path);

    expect(mptCalls(mock)).toEqual([]);
    expect(elementText(html, "summary__sentence")).toMatch(/ sent 1,000,000 units of MPT 0598F6E0… to /);
    // Nothing on the page leads to an MPT page: not the amount, not the balance changes' currency, not the touched objects.
    expect(anchors(html).filter((a) => /href="[^"]*\/mpt\//.test(a.attrs))).toEqual([]);
    const rows = tableRows(html, "Balance changes").slice(1).filter((cells) => cells[1]!.startsWith("MPT 0598F6E0…"));
    expect(rows.map((cells) => cells[2]!.replace(/^\+ /, "+"))).toEqual(["−1,005,890 units of MPT 0598F6E0…", "+5,890 units of MPT 0598F6E0…", "+1,000,000 units of MPT 0598F6E0…"]);
    expect(await storedAs(path)).toEqual(IMMUTABLE);
  });

  it("names an issuance a transaction created by 'MPT' and the start of its ID, with no link", async () => {
    const path = `/xrpl/tx/${MPT_RECORDED.issuance_create.hash}`;
    mock = mockUpstream("xrpl");
    const { html } = await page(path);

    expect(mptCalls(mock)).toEqual([]);
    expect(elementText(html, "summary__sentence")).toMatch(/ created the MPT MPT 03F907F2…\.$/);
    expect(anchors(html).filter((a) => /href="[^"]*\/mpt\//.test(a.attrs))).toEqual([]);
    expect(await storedAs(path)).toEqual(IMMUTABLE);
  });
});

describe("the home page with MPT off", () => {
  it("lists an MPT amount in units with no link, and makes no lookup", async () => {
    const listed = { ...xrplTransactions, transactions: [mintTransaction.transaction, ...xrplTransactions.transactions.slice(1)] };
    mock = mockUpstream("xrpl", { "GET /v2/transactions?descending=true&limit=8": listed });
    const { html } = await page("/xrpl?mpt-off-home");

    expect(tableRows(html, "Latest transactions").slice(1).map((cells) => cells[3])).toContain("1 units of MPT 064E273A…");
    expect(anchors(html).filter((a) => a.attrs.includes(`/mpt/${MPT_MINT_ISSUANCE}`))).toEqual([]);
    expect(mptCalls(mock)).toEqual([]);
  });
});
