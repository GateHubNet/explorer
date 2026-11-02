import { describe, expect, it, vi } from "vitest";

import { shortAddress } from "../../app/domain/format";
import { NAMED_PAGE_TTL_SECONDS } from "../../app/server/cache-class";
import xrplTransactions from "../fixtures/http/xrpl/data-api/transactions@descending=true&limit=8.json";
import mintTransaction from "../fixtures/http/xrpl/data-api/transactions/4D9BB2A0B0289D36A995B10AB17D5BE9B19E961B777AFDE29D84CC59384E74F6.json";
import { namesSpec } from "../support/names";
import { expectDegraded, forgetStored, keysOf } from "../support/nft-pages";
import { MPT_FEE_PAYMENT_ISSUANCE, MPT_FIXTURE_IDS, MPT_LOCKED_HOLDING, MPT_MINT_ISSUANCE, MPT_RECORDED } from "../support/mpt-case-rules";
import { anchors, elementText, pageClient, tableRows } from "../support/pages";
import { dataApiError } from "../support/upstream";

// The MPT amounts of the transaction page, `/{net}/tx/{hash}` (E14 spec 2.4 and 5.4, Task 7), on the real Worker against the recorded MPT transactions of D9 (test/fixtures/http/xrpl/data-api/transactions/)
// and the lookup the mock composes from `xrpl/data-api/mpt_lookup.json`: the page asks the lookup once for the sorted IDs of its amounts, shows them scaled with their ticker and a link to the issuance's
// page, and is `immutable` (kept an hour while it shows names) only when every ID was answered with a scale; a lookup that fails leaves units and the page unstored, and one that answers an ID bare leaves
// units and the page `short`. The home page, which polls, asks nothing. The off-case is mpt-off.spec.ts.
//
// What a Worker stores in the Cache API stays there for the rest of the file by the real clock: the tests that fail the lookup come first, a test that stores a page forgets the copy it may find, and
// `namesSpec` takes the subrequest entries away before each test (the lookup is kept an hour, and three of these transactions share one ID) and moves `Date` past the longest keep after it.

const { get, page, storedAs } = pageClient("198.51.129");
const { upstream } = namesSpec({ advance: 301_000 });

const SHORT = { cls: "short", ttl: 30 };
const NAMED = { cls: "immutable", ttl: NAMED_PAGE_TTL_SECONDS };

/** The key of the lookup for these IDs, which the mock names as the request is made (`ids=A%2CB`). */
const LOOKUP = (...ids: string[]) => `GET /v2/mpt?ids=${[...ids].sort().join("%2C")}`;
/** The lookup calls a mock saw. */
const lookupsOf = (mock: { requests: Parameters<typeof keysOf>[0] }) => keysOf(mock.requests).filter((key) => key.startsWith("GET /v2/mpt"));

const FEE_PAYMENT = MPT_RECORDED.payment_transfer_fee.hash;
const MINT = MPT_RECORDED.payment_mint.hash;
const OPT_IN = MPT_RECORDED.authorize_holder.hash;
const CLAWBACK = MPT_RECORDED.clawback_full.hash;

/** The HTML of the sentence. */
const sentenceOf = (html: string) => html.slice(html.indexOf('class="sentence summary__sentence"'), html.indexOf("</p>", html.indexOf('class="sentence summary__sentence"')));
const touchedOf = (html: string) => html.slice(html.indexOf('aria-label="Ledger objects touched"'), html.indexOf("</ul>", html.indexOf('aria-label="Ledger objects touched"')));
/** Each link of some HTML: its text and where it leads. */
const linksOf = (html: string) => anchors(html).map((a) => [a.text, /href="([^"]*)"/.exec(a.attrs)?.[1]]);

describe("when the lookup fails", () => {
  it("serves a failed lookup in units, short and not stored", async () => {
    const path = `/xrpl/tx/${FEE_PAYMENT}`;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const mock = upstream("xrpl", { [LOOKUP(MPT_FEE_PAYMENT_ISSUANCE)]: dataApiError(503, "unavailable") });
    const first = await get(path);
    const html = await first.text();

    // A page in units: the amount as the ledger holds it, the issuance by the start of its ID, and a link to its page all the same.
    await expectDegraded(path, first);
    expect(elementText(html, "summary__sentence")).toMatch(/ sent 1,000,000 units of MPT 0598F6E0… to /);
    expect(linksOf(sentenceOf(html))).toContainEqual(["0598F6E0…", `/xrpl/mpt/${MPT_FEE_PAYMENT_ISSUANCE}`]);
    expect(lookupsOf(mock)).toEqual([LOOKUP(MPT_FEE_PAYMENT_ISSUANCE)]);
    // One log line says why.
    const lines = logged.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("MPT amounts could not be loaded"));
    expect(lines).toHaveLength(1);

    // Not stored, so the next visitor asks again.
    const second = await get(path);
    await second.text();
    expect(second.headers.get("X-Cache")).toBe("MISS");
    expect(lookupsOf(mock)).toEqual([LOOKUP(MPT_FEE_PAYMENT_ISSUANCE), LOOKUP(MPT_FEE_PAYMENT_ISSUANCE)]);
  });

  it("takes a lookup that answers another issuance than the one asked for as a failed one: units, and not stored", async () => {
    const path = `/xrpl/tx/${MINT}`;
    vi.spyOn(console, "error").mockImplementation(() => {});
    upstream("xrpl", { [LOOKUP(MPT_MINT_ISSUANCE)]: { count: 1, issuances: [{ mpt_issuance_id: MPT_FIXTURE_IDS.htf }] } });
    const response = await get(path);
    const html = await response.text();

    await expectDegraded(path, response);
    expect(elementText(html, "summary__sentence")).toMatch(/ issued 1 units of MPT 064E273A… to /);
  });
});

describe("when the lookup answers an issuance bare", () => {
  it("shows the units and is short, not immutable", async () => {
    const path = `/xrpl/tx/${CLAWBACK}`;
    await forgetStored(path);
    const mock = upstream("xrpl", { [LOOKUP(MPT_MINT_ISSUANCE)]: { count: 1, issuances: [{ mpt_issuance_id: MPT_MINT_ISSUANCE }] } });
    const { html } = await page(path);

    expect(elementText(html, "summary__sentence")).toMatch(/ clawed back 1 units of MPT 064E273A… from /);
    expect(lookupsOf(mock)).toEqual([LOOKUP(MPT_MINT_ISSUANCE)]);
    expect(await storedAs(path)).toEqual(SHORT);
  });
});

describe("the recorded MPT transactions", () => {
  // Each recorded page asks the lookup once, for the sorted IDs of its amounts, and says its amounts as the lookup scaled them (`mpt_lookup.json`): the sentence in the ticker's words, the
  // issuance a link to its page, the class `immutable` (kept an hour while the page shows names). Three of them are of one issuance (064E…), so each starts from no copy of its own page.
  it.each([
    ["issuance_create", MPT_FIXTURE_IDS.htf, / created the MPT XAU\.$/, "XAU"],
    ["issuance_create_short_keys", MPT_FIXTURE_IDS.shortKeys, / created the MPT XDRAGO\.$/, "XDRAGO"],
    ["payment_mint", MPT_MINT_ISSUANCE, / issued 1 USDPEND to /, "USDPEND"],
    ["payment_transfer_fee", MPT_FEE_PAYMENT_ISSUANCE, / sent 1\.000000 units to /, "units"],
    ["issuance_set_lock_holder", MPT_LOCKED_HOLDING, / balance of MPT 0663EACA…\.$/, "MPT 0663EACA…"],
    ["authorize_holder", MPT_MINT_ISSUANCE, / opted in to hold USDPEND\.$/, "USDPEND"],
    ["clawback_full", MPT_MINT_ISSUANCE, / clawed back 1 USDPEND from /, "USDPEND"],
    ["escrow_create", "0663EB64E8DDA74A98C6C70B740E67C7A2D1509EE78C163A", / locked 2,770\.73 units for /, "units"],
  ] as const)("%s: asks the lookup once and draws its amounts scaled, linked, and is immutable", async (name, id, says, linked) => {
    const path = `/xrpl/tx/${MPT_RECORDED[name].hash}`;
    await forgetStored(path);
    const mock = upstream("xrpl");
    const { html } = await page(path);

    expect(lookupsOf(mock)).toEqual([LOOKUP(id)]);
    expect(elementText(html, "summary__sentence")).toMatch(says);
    // The amount (or the reference) in the sentence leads to the issuance's page.
    expect(linksOf(sentenceOf(html))).toContainEqual([linked, `/xrpl/mpt/${id}`]);
    expect(await storedAs(path)).toEqual(NAMED);
  });

  it("scales the flow, the balance changes and the touched objects, tags the issuer's row, and links the objects to the issuance's page", async () => {
    const path = `/xrpl/tx/${FEE_PAYMENT}`;
    await forgetStored(path);
    upstream("xrpl");
    const { html } = await page(path);

    // The flow: the destination got 1.000000, the sender's side names no amount (a send max may have spent more).
    expect(elementText(html, "flow__amount")).toBe("+1.000000 units");
    // The balance changes: the units the ledger holds become the scaled change and balance (scale 6), the currency the issuance by the start of its ID, a link, the issuer under it.
    const rows = tableRows(html, "Balance changes").slice(1);
    const mpt = rows.filter((cells) => cells[1]!.startsWith("MPT 0598F6E0…"));
    // (`tableRows` puts a space where a tag was: the plus sign is outside the amount's element.)
    expect(mpt.map((cells) => [cells[0]!.replace(/^.*?(sender|Issuer|destination)$/, "$1"), cells[2]!.replace(/^\+ /, "+"), cells[3]])).toEqual([
      ["sender", "−1.005890 units", "199,999,997.994097 units"],
      ["Issuer", "+0.005890 units", "—"],
      ["destination", "+1.000000 units", "1.000013 units"],
    ]);
    const issuer = shortAddress("rERShrtUSEXkrwtTpugPV4v8E787vpx1kb");
    expect(mpt.map((cells) => cells[1])).toEqual([`MPT 0598F6E0… issued by ${issuer}`, "MPT 0598F6E0…", `MPT 0598F6E0… issued by ${issuer}`]);
    // The touched MPToken and MPTokenIssuance entries lead to the issuance's page.
    const objects = linksOf(touchedOf(html)).filter(([, href]) => href?.startsWith("/xrpl/mpt/"));
    expect(objects).toEqual([
      ["MPToken", `/xrpl/mpt/${MPT_FEE_PAYMENT_ISSUANCE}`],
      ["MPTokenIssuance", `/xrpl/mpt/${MPT_FEE_PAYMENT_ISSUANCE}`],
      ["MPToken", `/xrpl/mpt/${MPT_FEE_PAYMENT_ISSUANCE}`],
    ]);
  });

  it("asks nothing for a recorded transaction that has no MPT amount", async () => {
    const path = `/xrpl/tx/${MPT_RECORDED.clawback_issued.hash}`;
    const mock = upstream("xrpl");
    const { html } = await page(path);
    expect(elementText(html, "summary__sentence")).toMatch(/ clawed back 1 YOINK from /);
    expect(lookupsOf(mock)).toEqual([]);
  });
});

describe("the home page", () => {
  it("makes no /v2/mpt request, however many MPT amounts its rows hold: they read in units, with a link", async () => {
    // The newest transaction of the recorded list is replaced by a recorded MPT mint.
    const listed = { ...xrplTransactions, transactions: [mintTransaction.transaction, ...xrplTransactions.transactions.slice(1)] };
    const mock = upstream("xrpl", { "GET /v2/transactions?descending=true&limit=8": listed });
    const { html } = await page("/xrpl?mpt-home");

    expect(tableRows(html, "Latest transactions").slice(1).map((cells) => cells[3])).toContain("1 units of MPT 064E273A…");
    expect(linksOf(html)).toContainEqual(["064E273A…", `/xrpl/mpt/${MPT_MINT_ISSUANCE}`]);
    expect(lookupsOf(mock)).toEqual([]);
  });
});
