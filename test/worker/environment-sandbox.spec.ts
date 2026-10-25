import { afterEach, describe, expect, it } from "vitest";

import { encodeCtid } from "../../app/domain/ctid";
import { shortAddress, shortHash } from "../../app/domain/format";
import { recordedHashes } from "../support/ledger-hashes";
import { anchors, hrefs, pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";
import { fixtureValidatorKeys } from "../support/validators-cases";

// The Worker with `ENVIRONMENT` "sandbox" (the `worker-sandbox` project of vitest.config.ts): it shows XRPL Testnet and Xahau Testnet, so a
// page says their names and a CTID carries their network ids (1 and 21338). The data is the recorded mainnet data of test/fixtures/http/
// standing in for the testnets' (the bindings are the top level's), so only what a page says per kind of network is asserted here.

const { page, get } = pageClient("198.51.100");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

// The same transactions as transaction.spec.ts: a plain XRP Payment (ledger 102186243, place 63) and a Xahau Remit (26540613, place 88).
const PAYMENT = "AACAFCFEBB5C970049A576CBFE6EF544A47EE3ADBA99122FA43234D18D5FFD40";
const REMIT = "8C50C44787A12B785AA62377D0AFA6C4711E8E07EF68BA6E83DC286F7EE79AAF";

const search = (net: "xrpl" | "xahau", q: string) => `/${net}/search?q=${encodeURIComponent(q)}`;

// The places that draw the names with no `/:net` data of their own: the network switch (the root's environment decides what it lists), the tags of
// a page (the layout's network decides what they say) and the error pages.
describe("the names where there is no layout data", () => {
  /** The network switch of a page: where each of its links goes, and what it says. */
  const switchOf = (html: string) =>
    anchors(html)
      .filter((a) => a.attrs.includes("netswitch__item"))
      .map((a) => [/href="([^"]*)"/.exec(a.attrs)?.[1], a.text]);

  /** The `<title>` of a page and the content of its `<meta name="description">`. */
  const tagsOf = (html: string) => ({
    title: /<title>([^<]*)<\/title>/.exec(html)?.[1],
    description: /<meta\s[^>]*name="description"[^>]*content="([^"]*)"/.exec(html)?.[1] ?? /<meta\s[^>]*content="([^"]*)"[^>]*name="description"/.exec(html)?.[1],
  });

  it("/xrpl: the switch reads XRPL Testnet and Xahau Testnet", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl");
    expect(switchOf(html)).toEqual([
      ["/xrpl", "XRPL Testnet"],
      ["/xahau", "Xahau Testnet"],
    ]);
  });

  it("/xrpl/tx: the title ends XRPL Testnet · explorer and the description says XRPL Testnet ledger", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    const { title, description } = tagsOf(html);

    expect(title).toBe(`Payment ${shortHash(PAYMENT)} · XRPL Testnet · explorer`);
    expect(description).toMatch(/ · XRPL Testnet ledger 102,186,243$/);
  });

  it("/xrp: the unknown network's page names the testnets in its switch", async () => {
    const { html } = await page("/xrp", 404);
    expect(switchOf(html)).toEqual([
      ["/xrpl", "XRPL Testnet"],
      ["/xahau", "Xahau Testnet"],
    ]);
    // The page is the default network's (the first of the switch): its home link names it.
    expect(anchors(html).map((a) => a.text)).toContain("Go to the XRPL Testnet home");
  });

  it("/xahau/nothing: the not-found page keeps Xahau Testnet and names the testnets in its switch", async () => {
    const { html } = await page("/xahau/nothing", 404);
    expect(textOf(html)).toContain("There is no page at /xahau/nothing.");
    expect(switchOf(html)).toEqual([
      ["/xrpl", "XRPL Testnet"],
      ["/xahau", "Xahau Testnet"],
    ]);
    expect(anchors(html).map((a) => a.text)).toContain("Go to the Xahau Testnet home");
  });
});

// The pages that name their network in their own words (a headline, a status line, a note, a link preview): from the layout's network, not a literal.
describe("the pages that name their network", () => {
  it("/xrpl: Explore XRPL Testnet, and the status line says XRPL Testnet · ledger", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl");
    const text = textOf(html);

    expect(/<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1]).toBe("Explore XRPL Testnet");
    expect(text).toContain("XRPL Testnet · ledger");
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe("Explore XRPL Testnet · explorer");
    expect(text).not.toContain("mainnet");
    expect(text).not.toContain("XRP Ledger");
  });

  it("/xahau/amm/{pool}: Xahau Testnet has no AMM, so this pool exists only on XRPL Testnet.", async () => {
    mock = mockUpstream("xahau");
    // The pool of amm-pool.spec.ts's Xahau case.
    const { html } = await page("/xahau/amm/rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3", 404);
    const text = textOf(html);

    expect(text).toContain("Xahau Testnet has no AMM, so this pool exists only on XRPL Testnet.");
    expect(text).not.toContain("XRP Ledger");
    expect(mock.requests).toEqual([]);
  });

  it("/og/xrpl/tx/{hash}.png renders", async () => {
    mock = mockUpstream("xrpl");
    const response = await get(`/og/xrpl/tx/${PAYMENT}.png`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(bytes.length).toBeGreaterThan(8_000);
  });
});

describe("a transaction in the sandbox", () => {
  it("/xrpl/tx: the breadcrumb says XRPL Testnet and the CTID ends 0001", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${PAYMENT}`);
    const text = textOf(html);

    const ctid = encodeCtid(102186243, 63, 1);
    expect(ctid.endsWith("0001")).toBe(true);
    expect(text).toContain(`CTID ${ctid}`);
    expect(text).not.toContain(`CTID ${encodeCtid(102186243, 63, 0)}`);
    expect(text).toContain(`XRPL Testnet / Ledger 102,186,243 / ${shortHash(PAYMENT)}`);
  });

  it("/xahau/tx: the CTID ends 535A", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/tx/${REMIT}`);
    const text = textOf(html);

    const ctid = encodeCtid(26540613, 88, 21338);
    expect(ctid.endsWith("535A")).toBe(true);
    expect(text).toContain(`CTID ${ctid}`);
    expect(text).not.toContain(`CTID ${encodeCtid(26540613, 88, 21337)}`);
    expect(text).toContain("Xahau Testnet / Ledger 26,540,613");
  });

  it("/xrpl/tx: a mainnet CTID is not covered", async () => {
    mock = mockUpstream("xrpl");
    const ctid = encodeCtid(107506489, 22, 0);
    const { html } = await page(`/xrpl/tx/${ctid}`, 404);
    expect(textOf(html)).toContain(`${ctid} is for network id 0, which this explorer does not cover.`);
    expect(mock.requests).toEqual([]);
  });
});

describe("a CTID searched in the sandbox", () => {
  it("search: a CTID of XRPL Testnet redirects to its transaction", async () => {
    mock = mockUpstream("xrpl");
    const hashes = await recordedHashes("xrpl", 107720688);
    const response = await get(search("xrpl", encodeCtid(107720688, 17, 1)));
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/xrpl/tx/${hashes[17]}`);
  });

  it("search: a mainnet CTID is not covered", async () => {
    mock = mockUpstream("xrpl");
    const ctid = encodeCtid(107720688, 17, 0);
    for (const net of ["xrpl", "xahau"] as const) {
      const { html } = await page(search(net, ctid), 404);
      const text = textOf(html);
      expect(text).toContain(`${ctid} is for network id 0, which this explorer does not cover.`);
      expect(hrefs(html).filter((href) => href.includes("/tx/"))).toEqual([]);
    }
    expect(mock.requests).toEqual([]);
  });

  it("search: a CTID of Xahau Testnet on /xrpl offers Xahau Testnet", async () => {
    mock = mockUpstream("xrpl");
    const ctid = encodeCtid(26540187, 5, 21338);
    const { html } = await page(search("xrpl", ctid));
    const text = textOf(html);

    expect(text).toContain("That CTID is on Xahau Testnet");
    expect(text).toContain(`${ctid} belongs to Xahau Testnet, so it is not a transaction on XRPL Testnet.`);
    expect(anchors(html).find((a) => a.attrs.includes(`href="/xahau/tx/${ctid}"`))?.text).toBe("Open the transaction on Xahau Testnet");
    expect(mock.requests).toEqual([]);
  });
});

// The pages that offer the same thing on the other network name it from the environment: Xahau Testnet from XRPL Testnet and the other way round.
describe("the other network an offer names", () => {
  const UNKNOWN = "0D".repeat(32);
  const LEDGER_HASH = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456780";

  /** The text and the `href` of the anchor of an offer. */
  const offer = (html: string, text: string) => /href="([^"]*)"/.exec(anchors(html).find((a) => a.text === text)?.attrs ?? "")?.[1];

  it("search: a hash nothing has offers the same search on Xahau Testnet", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(search("xrpl", UNKNOWN), 404);
    expect(textOf(html)).toContain(`We couldn’t find transaction or ledger ${shortHash(UNKNOWN)} on XRPL Testnet.`);
    expect(offer(html, "Search on Xahau Testnet")).toBe(`/xahau/search?q=${UNKNOWN}`);
  });

  it("/xrpl/tx: a transaction nobody has offers the same search on Xahau Testnet", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/tx/${UNKNOWN}`, 404);
    expect(textOf(html)).toContain(`We couldn’t find transaction ${shortHash(UNKNOWN)} on XRPL Testnet.`);
    expect(offer(html, "Search on Xahau Testnet")).toBe(`/xahau/search?q=${UNKNOWN}`);
  });

  it("/xrpl/ledger: a hash nobody has offers the same search on Xahau Testnet", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/ledger/${LEDGER_HASH}`, 404);
    expect(offer(html, "Search on Xahau Testnet")).toBe(`/xahau/search?q=${LEDGER_HASH}`);
  });

  it("/xahau/ledger: it offers XRPL Testnet from Xahau Testnet", async () => {
    mock = mockUpstream("xahau");
    const hash = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456781";
    const { html } = await page(`/xahau/ledger/${hash}`, 404);
    expect(offer(html, "Search on XRPL Testnet")).toBe(`/xrpl/search?q=${hash}`);
  });

  it("/xahau/account: an address never activated is on XRPL Testnet, perhaps", async () => {
    mock = mockUpstream("xahau");
    const address = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";
    const { html } = await page(`/xahau/account/${address}`, 404);
    expect(textOf(html)).toContain("This address has never been activated on Xahau Testnet");
    expect(offer(html, `Look for ${shortAddress(address)} on XRPL Testnet`)).toBe(`/xrpl/account/${address}`);
  });

  it("/xahau/amm: a pool, which Xahau Testnet has none of, can be opened on XRPL Testnet", async () => {
    mock = mockUpstream("xahau");
    const pool = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
    const { html } = await page(`/xahau/amm/${pool}`, 404);
    expect(offer(html, "Open it on XRPL Testnet")).toBe(`/xrpl/amm/${pool}`);
    expect(mock.requests).toEqual([]);
  });

  it("/xrpl/validators: a key the network does not know can be looked for on Xahau Testnet", async () => {
    const [key] = await fixtureValidatorKeys("xahau");
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/validators/${key}`, 404);
    expect(offer(html, "Look for it on Xahau Testnet")).toBe(`/xahau/validators/${key}`);
  });

  it("/xahau/amendments: an amendment the network does not know can be looked for on XRPL Testnet", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/amendments/XChainBridge", 404);
    expect(offer(html, "Look for it on XRPL Testnet")).toBe("/xrpl/amendments/XChainBridge");
  });
});
