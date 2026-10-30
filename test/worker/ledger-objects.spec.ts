import { classicAddressToXAddress } from "ripple-address-codec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shortHash } from "../../app/domain/format";
import { failingNames } from "../support/names";
import { forgetStored, isNoindex, isStored, keysOf, unavailable } from "../support/nft-pages";
import { objectCase } from "../support/object-cases";
import { ESCROW_ID, historySample, OBJECT_MARKER } from "../support/object-samples";
import { anchors, elementText, hrefs, pageClient, textOf } from "../support/pages";
import { cold } from "../support/subrequest-miss";
import { dataApiError, mockUpstream, nodeError, statusesOf, type UpstreamMock } from "../support/upstream";

// An escrow's page, `/{net}/escrows/{ID}`, and the owner-and-sequence address that leads to it, `/{net}/escrows/{owner}/{sequence}` (ledger object pages spec 1.2, 3, 4.1, 4.2 and 9), on
// the real Worker against the generated object answers of the data API and the node (test/fixtures/http/*/data-api/escrows/…, */node/ledger_entry/…): what an index or a node that fails
// does to the page (a 503 that is never stored), a server_state or a names call that fails (the page, not stored), each kind of page with its class, the marker of older events, the node's
// fallback and its redirect to another kind of object, the other network's offer, and the 404s and redirects of the URL itself. The off-case of `LEDGER_OBJECTS` is
// ledger-objects-off.spec.ts (the `worker-off` project); the names are ledger-objects-names.spec.ts.
//
// One Cache API serves the whole file, and what a Worker stores stays there. So the failures come first, every test asks for a URL no other test asks for (an escrow of its own, or a page
// of its own behind a marker), and every test takes the subrequest entries away (`cold`): each call of a render reaches the mock, so an override is always the answer and a list of calls
// does not depend on what an earlier test left. No test reads what another stored, so the order of the tests is free (`--sequence.shuffle`).

const { get, stored, storedAs } = pageClient("198.18.90");

// A test here may ask whether the edge cache holds a copy it must not hold (`isStored` waits up to 2 s for it), on top of a render.
vi.setConfig({ testTimeout: 30_000 });

let mock: UpstreamMock | undefined;

beforeEach(() => {
  cold();
});

afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
  expect(unused ?? []).toEqual([]);
});

/** The page at `path`: its answer, its HTML and its text. */
async function render(path: string) {
  const response = await get(path);
  const html = await response.text();
  return { response, html, text: textOf(html) };
}

// ---- The escrows of the fixtures and the calls, by the keys the mock names them --------------------------------------------------------------------------------------------

const PENDING = await objectCase("xrpl", "escrow-pending");
const FINISHABLE = await objectCase("xrpl", "escrow-finishable");
const FINISHED = await objectCase("xrpl", "escrow-finished");
const CANCELLED = await objectCase("xrpl", "escrow-cancelled");
const MPT = await objectCase("xrpl", "escrow-mpt");
const NODE_ONLY = await objectCase("xrpl", "escrow-node-only");
const CHECK_NODE_ONLY = await objectCase("xrpl", "check-node-only");
const XAHAU = await objectCase("xahau", "xahau-escrow");

/** The ID of an escrow no fixture has and no other test uses: the index says "escrow not found", and so does the node, unless a test says otherwise. */
let made = 0;
const fresh = (): string => `5B9C0E${"0".repeat(54)}${(++made).toString(16).toUpperCase().padStart(4, "0")}`;

/** The requests of an escrow's page as the mock names them (its query sorted), and the key an override of the node's entry is named by (`ENTRY_OVERRIDE`). */
const calls = (id: string, marker?: string) => ({
  ESCROW: `GET /v2/escrows/${id}`,
  HISTORY: `GET /v2/escrows/${id}/history?descending=true&limit=50&marker=${marker}`,
  ENTRY: `node ledger_entry index=${id}&ledger_index=validated`,
  ENTRY_OVERRIDE: `node ledger_entry ${id}`,
  STATE: "node server_state",
});
const nodeEntryAsked = (seen: UpstreamMock) => seen.requests.filter((request) => request.key.startsWith("node ledger_entry"));

const LIVE = { cls: "live", ttl: 5 };
const SLOW = { cls: "slow", ttl: 3600 };
const MARKER_PAGE = { cls: "slow", ttl: 3600 };
const SHORT = { cls: "short", ttl: 30 };
const IMMUTABLE = { cls: "immutable", ttl: 31_536_000 };

/** A second marker of the API's alphabet, for the page behind `OBJECT_MARKER`. */
const OLDER_MARKER = "WzEwNzk0NTQzOCw5N10";

/** The text of the `<dd>` of a row of the Details card. */
const rowOf = (html: string, label: string) => {
  const found = new RegExp(`<dt>${label}(?:<span[^>]*>[^<]*</span>)?</dt><dd>([\\s\\S]*?)</dd>`).exec(html)?.[1];
  return found === undefined ? undefined : textOf(found);
};
const AGES = /\b\d+ (?:s|min|h|d) ago\b|\bin (?:under a minute|~?\d+ (?:min|h|days))\b/;

// ---- Failures first ------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("an escrow's page", () => {
  it("answers 503 without asking the node when the index fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    const key = calls(id);
    mock = mockUpstream("xrpl", { [key.ESCROW]: unavailable() });
    const path = `/xrpl/escrows/${id}`;
    const { response } = await render(path);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(statusesOf(mock, key.ESCROW)).toEqual([503]);
    // A failed index never asks the node for the entry: it would be shown as an escrow the index lacks, or as a 404.
    expect(nodeEntryAsked(mock)).toEqual([]);
    expect(await isStored(path)).toBe(false);
  });

  it("answers 503 when the node fails after the index's not found", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = fresh();
    const key = calls(id);
    mock = mockUpstream("xrpl", { [key.ENTRY_OVERRIDE]: unavailable() });
    const path = `/xrpl/escrows/${id}`;
    const { response } = await render(path);

    expect(statusesOf(mock, key.ESCROW)).toEqual([404]);
    expect(statusesOf(mock, key.ENTRY)).toEqual([503]);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(await isStored(path)).toBe(false);
  });

  it("serves the page without Owner reserve when server_state fails, not stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xrpl", { [calls(FINISHABLE.id).STATE]: nodeError("noNetwork") });
    const path = `/xrpl/escrows/${FINISHABLE.id}`;
    await forgetStored(path);
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
    expect(text).toContain("Can be finished");
    expect(rowOf(html, "Owner reserve")).toBeUndefined();
    expect(text).not.toContain("Owner reserve");
  });

  it("serves addresses when the names call fails, not stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock = mockUpstream("xrpl", failingNames());
    const path = `/xrpl/escrows/${CANCELLED.id}`;
    await forgetStored(path);
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await isStored(path)).toBe(false);
    // Its owner is a verified name in the fixtures: it is drawn by its address, as every account of the page is.
    expect(html).not.toContain("acct__name");
    const links = anchors(html).filter((a) => /href="\/xrpl\/account\/r/.test(a.attrs));
    expect(links.length).toBeGreaterThan(2);
    for (const link of links) expect(link.text, link.attrs).toMatch(/^(r[1-9A-HJ-NP-Za-km-z]{24,34}|r[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{4})$/);
  });

  // ---- The pages ----------------------------------------------------------------------------------------------------------------------------------------------------------

  it("serves a pending escrow from the index as live, with every part of the board", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/escrows/${PENDING.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(LIVE);
    // The escrow and the server state side by side, then the names.
    expect(keysOf(mock.requests).sort()).toEqual([calls(PENDING.id).ESCROW, calls(PENDING.id).STATE].sort());

    // The breadcrumb, with the owner as a link, and the one heading.
    expect(textOf(/<nav aria-label="Breadcrumb">[\s\S]*?<\/nav>/.exec(html)![0])).toBe("XRPL / Accounts / rh49Zq…jxvt / Escrow");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(elementText(html, "object-page__title")).toBe("Escrow");
    // The pill (a word and an icon) and the title line: the creation, written out.
    expect(elementText(html, "pill")).toBe("Pending");
    expect(/<span class="pill pill--info"><svg/.test(html)).toBe(true);
    expect(elementText(html, "object-page__titleline")).toBe("Created 2026-10-28 22:14:51 UTC");
    // No banner: it is in the ledger.
    expect(text).not.toContain("Removed from the ledger");
    // The states, the escrow's marked.
    expect(/<ol class="states__list"[\s\S]*?<\/ol>/.exec(html)![0].match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('<li class="states__item is-current" aria-current="true">');
    expect(elementText(html, "is-current")).toBe("Pending · this escrowLocked: FinishAfter has not passed yet.");
    // The summary and the status lines.
    expect(elementText(html, "object-page__summary")).toBe("rh49Zq…jxvt locked 100 XRP for rE8gwQ…5fF3 on Oct 28, 2026.");
    expect(elementText(html, "object-page__status")).toBe(
      "Can be finished by anyone after Jan 1, 2030, 00:00 UTCUntil then the 100 XRP stay locked.",
    );
    // The window bar: a button for each window, named by its range.
    expect(html).toContain('role="group" aria-label="When the escrow can be finished or cancelled"');
    expect(html).toContain('aria-label="Pending: Oct 28, 2026, 22:14 UTC to Jan 1, 2030, 00:00 UTC"');
    expect(html).toContain('aria-label="Can be finished: From Jan 1, 2030, 00:00 UTC, with no end"');
    // The Details card, with the field names of the ledger and the board's hints.
    expect(rowOf(html, "Escrow ID")).toBe(PENDING.id);
    expect(html).toContain('aria-label="Copy escrow ID"');
    expect(rowOf(html, "Owner")).toBe(PENDING.owner);
    expect(rowOf(html, "Destination")).toBe("rE8gwQaAppgYCtmGKF1WjPirzRP5hH5fF3");
    expect(rowOf(html, "Amount")).toBe("100 XRP");
    expect(rowOf(html, "Can be finished after")).toBe("2030-01-01 00:00:00 UTC The earliest time anyone can send an EscrowFinish.");
    expect(rowOf(html, "Can be cancelled after")).toBe("None");
    expect(rowOf(html, "Condition")).toBe("None: time-based only No secret is needed to finish it.");
    expect(rowOf(html, "Destination tag")).toBe("None");
    expect(rowOf(html, "Source tag")).toBe("None");
    expect(rowOf(html, "Owner reserve")).toBe("0.2 XRP Held from the owner’s balance while the escrow exists; released when it is finished or cancelled.");
    expect(elementText(html, "object-page__asof")).toBe("As of ledger #107,972,102, Oct 29, 2026, 03:50 UTC.");
    // The history: the creation, what can still happen, the footnote; no coverage note (the index holds the whole of it) and no pager.
    expect(text).toContain("EscrowCreate Created 2026-10-28 22:14:51 UTC Locked 100 XRP for the destination. by rh49Zq…jxvt");
    expect(text).toContain("EscrowFinish Not finished yet From Jan 1, 2030, 00:00 UTC Anyone can send it then.");
    expect(text).toContain("Oldest first. Filled dots are transactions; dashed ones are what can still happen.");
    expect(html).not.toContain('class="coverage-note"');
    expect(html).not.toContain('aria-label="Pagination"');
  });

  it("serves a finished escrow as slow with the removed banner", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/escrows/${FINISHED.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(SLOW);
    expect(elementText(html, "pill")).toBe("Finished");
    expect(elementText(html, "object-page__removed")).toBe("Removed from the ledger in ledger #107,967,068 by EscrowFinish 375202…57DA");
    expect(hrefs(html)).toContain("/xrpl/tx/375202E930018352EA63F82A1DCAF7795916DC5117C74D013119E67955C157DA");
    expect(html).toContain('aria-label="EscrowFinish transaction 375202…57DA"');
    expect(elementText(html, "object-page__removed-note")).toBe(
      "Finished on Oct 28, 2026, 22:14 UTC; the 75,000 XRB went to the destination. This page shows it from history: its last state before it was removed.",
    );
    // No state is current but the escrow's own, and the as-of note and the reserve say it is history.
    expect(elementText(html, "is-current")).toBe("Finished · this escrowPaid to the destination, then removed.");
    expect(elementText(html, "object-page__asof")).toBe("From history: the escrow’s last state, before ledger #107,967,068 removed it.");
    expect(rowOf(html, "Owner reserve")).toBe("0.2 XRP Released to the owner when the escrow was removed.");
    // A token's issuer is a link in its Amount row.
    expect(rowOf(html, "Amount")).toBe("75,000 XRB issued by rD9ixf…iPKa");
    expect(hrefs(html)).toContain("/xrpl/account/rD9ixf7RRUKuKVFTsZa3fZGAN6HtNziPKa");
    expect(text).toContain("EscrowFinish Finished");
  });

  it("serves a page of older events behind a marker as MARKER_PAGE_CLASS, noindex, with Newer and Older", async () => {
    const key = calls(FINISHED.id, OBJECT_MARKER);
    mock = mockUpstream("xrpl", { [key.HISTORY]: historySample({ marker: OLDER_MARKER }) });
    const path = `/xrpl/escrows/${FINISHED.id}?marker=${OBJECT_MARKER}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(MARKER_PAGE);
    expect(statusesOf(mock, key.HISTORY)).toEqual([200]);
    expect(isNoindex(html)).toBe(true);
    // The page of events: the creation, and no marks (they belong after the newest event, which is on the first page).
    expect(text).toContain("EscrowCreate Created");
    expect(text).not.toContain("FinishAfter Passed");
    // Newer goes back to the first page; Older to the page after this one, with this one in its trail.
    const pager = /<nav[^>]*aria-label="Pagination"[\s\S]*?<\/nav>/.exec(html)![0];
    const links = anchors(pager).map((a) => [a.text, /href="([^"]*)"/.exec(a.attrs)![1]!.replace(/&amp;/g, "&")]);
    expect(links).toEqual([
      ["Newer", `/xrpl/escrows/${FINISHED.id}`],
      ["Older", `/xrpl/escrows/${FINISHED.id}?marker=${OLDER_MARKER}&back=${OBJECT_MARKER}`],
    ]);
  });

  it("404s a marker the API refuses and one past the last event", async () => {
    const [refused, past, none] = ["WzEsMl0", "WzEsM10", "%25"];
    mock = mockUpstream("xrpl", {
      [calls(ESCROW_ID, refused).HISTORY]: dataApiError(400, "invalid marker"),
      [calls(ESCROW_ID, past).HISTORY]: historySample({ count: 0, marker: undefined, history: [] }),
    });
    for (const marker of [refused, past, none]) {
      const path = `/xrpl/escrows/${ESCROW_ID}?marker=${marker}`;
      const { response, text } = await render(path);
      expect(response.status, marker).toBe(404);
      expect(text).toContain("We couldn’t find that page of the escrow on XRPL.");
      expect(await storedAs(path)).toEqual(SHORT);
    }
    // A marker that is none is refused before any call.
    expect(mock.requests.filter((request) => request.url.includes("%25"))).toEqual([]);
  });

  it("falls back to the node for an escrow the index lacks: no history, Read live from the network", async () => {
    mock = mockUpstream("xrpl");
    const key = calls(NODE_ONLY.id);
    const path = `/xrpl/escrows/${NODE_ONLY.id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(LIVE);
    expect(statusesOf(mock, key.ESCROW)).toEqual([404]);
    expect(statusesOf(mock, key.ENTRY)).toEqual([200]);
    expect(elementText(html, "object-page__titleline")).toBe("Last changed in ledger #106,268,539 by transaction 7B1D32…03F6");
    expect(elementText(html, "object-page__asof")).toBe("Read live from the network at ledger #107,972,102.");
    expect(text).toContain("The index does not hold this history yet.");
    // No transaction in its history: the marks and what can still happen only.
    expect(html).not.toContain("timeline__dot--tx");
    expect(text).toContain("EscrowCancel Not cancelled yet");
    expect(rowOf(html, "Escrow ID")).toBe(NODE_ONLY.id);
  });

  it("redirects to the check page when the node holds a Check at that ID", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/escrows/${CHECK_NODE_ONLY.id}`;
    const response = await get(path);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/checks/${CHECK_NODE_ONLY.id}`);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("offers the other network when neither has it", async () => {
    const id = fresh();
    mock = mockUpstream("xrpl");
    const path = `/xrpl/escrows/${id}`;
    const { response, html, text } = await render(path);

    expect(response.status).toBe(404);
    expect(await storedAs(path)).toEqual(SHORT);
    expect(html).toMatch(/<meta name="robots" content="noindex"\/?>/);
    expect(text).toContain(`We couldn’t find escrow ${shortHash(id)} on XRPL.`);
    const offer = anchors(html).find((a) => a.text === "Search on Xahau");
    expect(offer?.attrs).toContain(`href="/xahau/search?q=${id}"`);
    expect(statusesOf(mock, calls(id).ENTRY)).toEqual([200]);
  });

  it.each([["0x" + ESCROW_ID], [ESCROW_ID.slice(1)], ["zz" + ESCROW_ID.slice(2)]])("404s %s without a call", async (asked) => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/escrows/${asked}`;
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find escrow");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("redirects a lower-case ID to the upper-case URL as immutable, with no call", async () => {
    mock = mockUpstream("xrpl");
    const from = `/xrpl/escrows/${PENDING.id.toLowerCase()}?marker=${OBJECT_MARKER}&x=1`;
    const response = await get(from);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/escrows/${PENDING.id}?marker=${OBJECT_MARKER}&x=1`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(from)).toEqual(IMMUTABLE);
  });

  it("redirects /escrows/{owner}/{sequence} to the escrow's ID as immutable, with no call", async () => {
    // The recorded EscrowCreate of the finished escrow: its Account and Sequence, and the node it created.
    const create = await recordedTransaction("3D7F58900F76F6B50D7B5BB1988D9E3C4E33744928B14DE1106848FFA9A3343C");
    const created = create.meta.AffectedNodes.flatMap((node) => (node.CreatedNode?.LedgerEntryType === "Escrow" ? [node.CreatedNode.LedgerIndex] : []));
    expect([create.tx.TransactionType, created]).toEqual(["EscrowCreate", [FINISHED.id]]);
    mock = mockUpstream("xrpl");
    const from = `/xrpl/escrows/${create.tx.Account}/${create.tx.Sequence}`;
    const response = await get(from);
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/escrows/${created[0]}`);
    expect(mock.requests).toEqual([]);
    expect(await storedAs(from)).toEqual(IMMUTABLE);
  });

  it.each([
    ["an X-address", `${classicAddressToXAddress(FINISHED.owner, false, false)}/${FINISHED.sequence}`],
    ["sequence 01", `${FINISHED.owner}/01`],
    ["sequence 4294967296", `${FINISHED.owner}/4294967296`],
  ])("404s the owner/sequence form with %s", async (_what, rest) => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/escrows/${rest}`;
    const { response, text } = await render(path);

    expect(response.status).toBe(404);
    expect(text).toContain("We couldn’t find escrow");
    expect(mock.requests).toEqual([]);
    expect(await storedAs(path)).toEqual(SHORT);
  });

  it("holds no age or countdown in the stored HTML", async () => {
    mock = mockUpstream("xrpl");
    const path = `/xrpl/escrows/${MPT.id}`;
    const { html } = await render(path);
    const copy = await (await stored(path))!.text();

    // Its creation is past and its FinishAfter ahead: each has a `<time>` the browser fills, and the stored page holds neither an age nor a countdown.
    for (const page of [html, copy]) {
      expect(textOf(page)).toContain("Can be finished by anyone after Jun 1, 2030, 00:00 UTC");
      expect(textOf(page)).not.toMatch(AGES);
      expect(page).toMatch(/<time [^>]*class="object-page__age"[^>]*><\/time>/);
    }
  });

  it("serves a Xahau XAH escrow", async () => {
    mock = mockUpstream("xahau");
    const path = `/xahau/escrows/${XAHAU.id}`;
    const { response, html } = await render(path);

    expect(response.status).toBe(200);
    expect(await storedAs(path)).toEqual(LIVE);
    expect(textOf(/<nav aria-label="Breadcrumb">[\s\S]*?<\/nav>/.exec(html)![0])).toMatch(/^Xahau \/ Accounts \/ .+ \/ Escrow$/);
    expect(rowOf(html, "Amount")).toBe("200 XAH");
    expect(rowOf(html, "Owner reserve")).toMatch(/^0\.2 XAH /);
    expect(elementText(html, "object-page__asof")).toBe("As of ledger #26,399,329, Oct 9, 2026, 12:49 UTC.");
  });
});

// ---- The recorded transactions --------------------------------------------------------------------------------------------------------------------------------------------------

interface Recorded {
  tx: { TransactionType: string; Account: string; Sequence: number };
  meta: { AffectedNodes: Array<{ CreatedNode?: { LedgerEntryType: string; LedgerIndex: string } }> };
}
const transactions = import.meta.glob("../fixtures/http/xrpl/data-api/transactions/*.json", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
async function recordedTransaction(hash: string): Promise<Recorded> {
  const load = transactions[`../fixtures/http/xrpl/data-api/transactions/${hash}.json`];
  if (!load) throw new Error(`no fixture for ${hash}`);
  return (JSON.parse(await load()) as { transaction: Recorded }).transaction;
}
