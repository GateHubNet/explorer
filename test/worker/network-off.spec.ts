import { afterEach, describe, expect, it } from "vitest";

import { elementText, pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";

// The network page with every switch "off" (the `worker-off` project, README "Switches"): the AMM line is left out and so is the call that
// feeds it, the wording is the `off` one that claims neither that the DEX trades include AMM swaps nor that they do not, "All validators"
// is the header's "soon" style, and so are the header's Markets and AMM. The `worker` project's cases are network-page.spec.ts.

const { get } = pageClient("198.51.106");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

describe("/xrpl/network with the switches off", () => {
  async function render() {
    mock = mockUpstream("xrpl");
    const response = await get("/xrpl/network");
    const html = await response.text();
    expect(response.status, html.slice(0, 400)).toBe(200);
    return { html, text: textOf(html) };
  }

  it("does not ask for amm_volume, and draws no AMM line: Payments and DEX trades, tracked markets", async () => {
    const { html, text } = await render();

    expect(mock!.requests.map((request) => request.key).filter((key) => key.includes("amm_volume"))).toEqual([]);
    // Everything else is asked for, as with the switch on.
    const asked = mock!.requests.map((request) => request.key);
    expect(asked).toContain("GET /v2/network/exchange_volume?end=2026-10-17&interval=day&limit=1000&start=2026-09-18");

    // The cards are `section.card.chart`; the volume card is the one titled "Volume per day".
    const volume = html.split('<section class="card chart').find((card) => card.includes("Volume per day"));
    expect(volume).toBeDefined();
    const legend = [...volume!.matchAll(/class="legend__item"><span[^>]*><\/span>([^<]*)</g)].map((match) => match[1]);
    expect(legend).toEqual(["Payments", "DEX trades, tracked markets"]);
    expect(text).not.toContain("AMM swaps");
    expect(text).toContain("DEX trades count the trades of the markets the data API tracks.");
    expect(text).not.toContain("not parts of one total");
    expect(html).not.toContain("amm_volume");
  });

  it("says 'tracked markets' under the DEX volume, and nothing of AMM swaps", async () => {
    const { html } = await render();
    const tiles = [...html.matchAll(/<div class="stat stat--figure">([\s\S]*?)<\/div>/g)].map((match) => match[1]!);
    const dex = tiles.find((tile) => elementText(tile, "stat__label") === "DEX volume");
    expect(elementText(dex!, "stat__sub")).toBe("tracked markets; to Oct 16; Oct 17 not computed yet");
  });

  it("shows 'All validators' in the header's 'soon' style, as a span and not a link", async () => {
    const { html } = await render();
    expect(html).toContain('<span class="nav-item is-soon" aria-disabled="true">All validators <span class="soon">soon</span></span>');
    expect(html).not.toContain("validators?scope=all");
  });

  it("shows Markets and AMM in the header as 'soon'", async () => {
    const { html } = await render();
    expect(html).toContain('<span class="nav-item is-soon" aria-disabled="true"><span>Markets</span><span class="soon">soon</span></span>');
    expect(html).toContain('<span class="nav-item is-soon" aria-disabled="true"><span>AMM</span><span class="soon">soon</span></span>');
    // Network is a page.
    expect(html).toMatch(/<a class="nav-item is-current" aria-current="page" href="\/xrpl\/network"/);
  });
});
