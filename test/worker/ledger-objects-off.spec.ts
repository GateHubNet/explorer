import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { CHANNEL_ID, CHECK_ID, ESCROW_ID, ESCROW_OWNER } from "../support/object-samples";
import { anchors, hrefs, pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The ledger object pages with every switch "off" (the `worker-off` project, README "Switches"), as production has them until the owner turns `LEDGER_OBJECTS` on (ledger object pages
// spec 1.2 and 10): an escrow's page and the owner-and-sequence address of an escrow, a check's page and a payment channel's are the not-found page, a 404 of class `short` made before any call
// (neither the ID nor the query is read: no redirect to the upper-case URL, no "not an ID", no keylet). The `worker` project's cases, with the switch on, are ledger-objects.spec.ts.

const { get, page, storedAs } = pageClient("198.18.91");

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

// The links into the pages (ledger object pages spec 7) with LEDGER_OBJECTS and DELEGATION off: the Objects tab keeps every field, the source of an object the account was sent too, and opens
// nothing; a transaction names its escrow, check or channel in the same words, as text, and the objects it touched lead nowhere. No link to a page that is not there.
describe("the links into the pages with LEDGER_OBJECTS off", () => {
  const ACTIVE = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
  /** A link to an escrow's, a check's or a channel's page, or to a Delegation tab. */
  const OBJECT_LINK = /\/(escrows|checks|payment-channels)\/|tab=delegation/;

  it("draws the Objects tab with its fields, the check's source among them, and no link to an object page or to the delegation", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/account/${ACTIVE}?tab=objects`);
    const text = textOf(html);

    expect(text).toMatch(/Check Send up to 100 XRP From \S+ To \S+ Expires/);
    expect(hrefs(html)).toContain("/xrpl/account/rp8D2s2o2dDHxYNBobMmBmbjmzVEHDMPvp");
    expect(text).toMatch(/Delegate Delegate \S+ On behalf of \S+ Permissions 3 of 10/);
    expect(hrefs(html).filter((href) => OBJECT_LINK.test(href))).toEqual([]);
    expect(text).not.toMatch(/Open (escrow|check|payment channel) →|View delegation →/);
  });

  // Each with the words of its sentence, the one detail that holds its object (its label and text), and its type among the objects it touched. The short forms are the page's own: the raw tabs
  // hold only the full IDs, so that these say what the sentence and the details draw.
  it.each([
    ["an EscrowFinish", "375202E930018352EA63F82A1DCAF7795916DC5117C74D013119E67955C157DA", "released escrow 107945427 of", null, "Escrow"],
    ["a CheckCreate", "DE0C4334780CE8115BCCB7E41371B85D13D284F82F48EFB98BE8D2F894207E0E", "wrote a check to", ["Check", "DA6BE1…30EA"], "Check"],
    ["a PaymentChannelClaim", "886A9054CD78D4C2F1250999F8D65DB3048F8FC9AFB24523AD755B29797AC790", "from channel E22CCE…69EA", ["Channel", "E22CCE8FA636C8BDF1C3C4AA17FD604B8FDE268E4F6BF9022B5336536F5B69EA"], "PayChannel"],
    ["a DelegateSet", "4250B72A5AB63CEB5501CFDDA3B4C9765B85941BB6AECE9720FC6C0D5F524B66", "on its behalf", null, "Delegate"],
  ] as const)("draws %s as text: the words of its sentence, its object's detail where it has one and its type among the objects it touched, and links none of them", async (_name, hash, words, detail, type) => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${hash}`);

    expect(textOf(html)).toContain(words);
    if (detail !== null) {
      const [label, value] = detail;
      expect(textOf(new RegExp(`<dt[^>]*>${label}</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`).exec(html)![1]!)).toBe(value);
    }
    expect(hrefs(html).filter((href) => OBJECT_LINK.test(href))).toEqual([]);

    // The objects touched are there: the type in mono, as text, and each link of the list an account's.
    const at = html.indexOf('aria-label="Ledger objects touched"');
    expect(at, "the list of the objects touched").toBeGreaterThan(-1);
    const touched = html.slice(at, html.indexOf("</ul>", at));
    expect(touched).toContain(`<span class="mono">${type}</span>`);
    const links = anchors(touched);
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((a) => /href="\/xrpl\/account\/r\w+"/.test(a.attrs))).toBe(true);
  });
});
