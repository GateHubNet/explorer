import { afterEach, describe, expect, it } from "vitest";

import { pageClient, textOf } from "../support/pages";
import { mockUpstream, type UpstreamMock } from "../support/upstream";
import { validatorCase } from "../support/validators-cases";

// What the validators map and the toml card say per kind of network, in the sandbox (the `worker-sandbox` project: `ENVIRONMENT` "sandbox", README "Switches", E13 spec 7): the page's
// network is XRPL Testnet or Xahau Testnet, so a toml that says `testnet` (or `21338`) names the page's own network and is not "not this network", and one that says `main` (or Xahau's ID,
// `21337`) names another's. The data is the recorded mainnet data standing in for the testnets' (the bindings are the top level's, `VALIDATORS_MAP` on), so only what a page says per
// network is asserted here. The words of every value are pinned at view level (validator-view.test.ts); this file pins the kind that reaches them in a Worker.

const { page } = pageClient("198.51.104");

let mock: UpstreamMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

/** The text of the toml card's facts grid: label, value and sub of each fact, in order. */
function factsOf(html: string): string {
  const card = /<section[^>]*validator__toml[\s\S]*?<\/section>/.exec(html)?.[0];
  if (card === undefined) throw new Error("the page has no toml card");
  return textOf(card);
}

describe("the toml card in the sandbox", () => {
  it("/xrpl/validators/{key}: a file that says testnet names XRPL Testnet and is not 'not this network'", async () => {
    const { key } = await validatorCase("xrpl", "toml-other-network");
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/validators/${key}`);

    const facts = factsOf(html);
    expect(facts).toMatch(/Network testnet XRPL Testnet(?! ?, not this network)/);
    expect(facts).not.toContain("not this network");
  });

  it("/xrpl/validators/{key}: a file that says main names XRPL mainnet, not this network", async () => {
    const { key } = await validatorCase("xrpl", "toml-full");
    mock = mockUpstream("xrpl");
    const { html } = await page(`/xrpl/validators/${key}`);

    expect(factsOf(html)).toContain("Network main XRPL mainnet, not this network");
  });

  it("/xahau/validators/{key}: a file that says 21337 names Xahau mainnet, not this network", async () => {
    const { key } = await validatorCase("xahau", "toml-network-id");
    mock = mockUpstream("xahau");
    const { html } = await page(`/xahau/validators/${key}`);

    const facts = factsOf(html);
    expect(facts).toContain("Network 21337 Xahau mainnet, not this network");
    expect(facts).toContain("xahau.toml");
  });
});

describe("the countries card in the sandbox", () => {
  it("/xahau/validators: the title and the attribution name Xahau Testnet and its own toml file", async () => {
    mock = mockUpstream("xahau");
    const { html } = await page("/xahau/validators");
    const text = textOf(html);

    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe("Validators · Xahau Testnet · explorer");
    expect(text).toContain("Validator locations come from server_country in each validator's verified xahau.toml.");
    expect(text).not.toContain("xrp-ledger.toml");
    expect(text).not.toContain("mainnet");
  });

  it("/xrpl/validators: the attribution names XRPL's file", async () => {
    mock = mockUpstream("xrpl");
    const { html } = await page("/xrpl/validators");

    expect(textOf(html)).toContain("Validator locations come from server_country in each validator's verified xrp-ledger.toml.");
  });
});
