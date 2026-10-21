import { afterEach, describe, expect, it, vi } from "vitest";

import type { AmendmentDetail, AmendmentsList, ValidatorDetail } from "../../app/server/api-types";
import xrplAmendments from "../fixtures/http/xrpl/data-api/network/amendments.json";
import xrplDynamicNft from "../fixtures/http/xrpl/data-api/network/amendments/DynamicNFT.json";
import { elementText, pageClient, tableRows, textOf } from "../support/pages";
import { cold } from "../support/subrequest-miss";
import { mockUpstream, statusesOf, type UpstreamMock } from "../support/upstream";
import { AMENDMENTS, amendmentCall, validatorCall } from "../support/validators-calls";
import { fixtureValidator, validatorCase } from "../support/validators-cases";

// A word a newer D1 adds (an amendment's status, a domain check's status, the status of a validator's vote, a history event), through the real Worker: the
// shape check lets it through (validators-shape.ts), the builders read it as their default, and the page is a 200 that shows it as "Unknown", "not
// verified" or leaves it out, never a 503. Each answer is a fixture with one word changed.
//
// A Worker keeps what it is answered in the Cache API for the rest of the file: AD and A for 60 s, D for 10 s. So each test overrides a key no other test
// asks for (one amendment, one validator), and the one test that changes A asks for both pages that read it.

const { get } = pageClient("198.51.115");

let mock: UpstreamMock | undefined;

afterEach(() => {
  // A key that no request used is a typo, or an answer the page never asked for.
  const unused = mock?.unusedOverrides();
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
  expect(unused ?? []).toEqual([]);
});

/** The page at `path`: its response, HTML and visible text. */
async function render(path: string) {
  const response = await get(path);
  const html = await response.text();
  return { response, html, text: textOf(html) };
}

const clone = <T>(value: T): T => structuredClone(value);

describe("a word a newer D1 sends", () => {
  it("an amendment's status and a history event: the page is Unknown, still voted on, and leaves the event out", async () => {
    const detail = clone(xrplDynamicNft) as AmendmentDetail;
    expect(detail.status).toBe("voting");
    const named = detail.history.length;
    detail.status = "frozen";
    detail.history = [...detail.history, { event: "vetoed", ledger_index: 107_748_000, date: "2026-10-19T12:00:00Z", tx_hash: "A".repeat(64) }];
    mock = mockUpstream("xrpl", { [amendmentCall("DynamicNFT")]: detail });
    const { response, html, text } = await render("/xrpl/amendments/DynamicNFT");

    expect(response.status, text.slice(0, 300)).toBe(200);
    expect(statusesOf(mock, amendmentCall("DynamicNFT"))).toEqual([200]);
    // The status pill of the identity, the page's first outlined pill: the question and "Unknown".
    expect(elementText(html, "amendment__marks")).toMatch(/^DynamicNFT/);
    expect(elementText(html, "pill--off")).toBe("Unknown");
    // A name is known: the grid does not say otherwise.
    expect(text).not.toContain("No name is known");
    // Read as D1's unknown, which validators vote on: the tables of the votes are there.
    expect(html).toContain('aria-label="Votes of the UNL validators"');
    // The event this build has no word for is not drawn, under a wrong name or any other.
    expect(html.split('class="amendment__event"').length - 1).toBe(named);
    expect(text).not.toContain("vetoed");
  });

  it("a domain check's status and a vote's status: not verified, the note's default, and an Unknown pill", async () => {
    const { key } = await validatorCase("xrpl", "verified-unl");
    const detail = clone(await fixtureValidator("xrpl", key)) as ValidatorDetail;
    detail.domain_verification!.status = "revoked";
    // A vote on an amendment A does not have, so that the page draws D's status.
    const [first, ...rest] = detail.amendment_votes.votes;
    detail.amendment_votes.votes = [{ ...first!, id: "8".repeat(64), name: "Frozen", status: "frozen" }, ...rest];
    mock = mockUpstream("xrpl", { [validatorCall(key)]: detail });
    const { response, html, text } = await render(`/xrpl/validators/${key}`);

    expect(response.status, text.slice(0, 300)).toBe(200);
    expect(statusesOf(mock, validatorCall(key))).toEqual([200]);
    expect(elementText(html, "validator__marks")).toContain("not verified");
    expect(elementText(html, "validator__note")).toBe("The domain could not be verified.");
    // The TOML is never linked for a domain that did not verify.
    expect(html).not.toContain("/.well-known/xrp-ledger.toml");
    const votes = tableRows(html, "Amendment votes").slice(1);
    expect(votes[0]!.slice(0, 2)).toEqual(["Frozen", "Unknown"]);
  });

  it("an amendment's status in the list: the amendments list draws it as Unknown, and the validators list does not offer it to filter by", async () => {
    const list = clone(xrplAmendments) as AmendmentsList;
    const row = list.amendments.find((amendment) => amendment.name === "DynamicNFT")!;
    expect(row.status).toBe("voting");
    row.status = "frozen";
    cold();
    mock = mockUpstream("xrpl", { [AMENDMENTS]: list });

    const amendments = await render("/xrpl/amendments");
    expect(amendments.response.status, amendments.text.slice(0, 300)).toBe(200);
    // The row, from its key to the next row (its consensus cell holds a `div`, which `tableRows` would stop at): the outlined pill says "Unknown".
    const from = amendments.html.indexOf(`data-key="${row.id}"`);
    expect(from).toBeGreaterThan(0);
    const drawn = amendments.html.slice(from, amendments.html.indexOf('role="row"', from));
    expect(elementText(drawn, "pill--off")).toBe("Unknown");
    expect(textOf(drawn)).not.toContain("Voting");
    // A's counts are D1's five: the chips stand as they were.
    expect(amendments.text).toContain(`Voting ${list.counts.voting}`);

    // "Votes yes for" lists what this build can say is being voted on; the word it does not know is not among them, and a URL that names it loses it.
    const validators = await render("/xrpl/validators");
    expect(validators.response.status, validators.text.slice(0, 300)).toBe(200);
    expect(validators.html).toContain('<option value="XChainBridge">');
    expect(validators.html).not.toContain('<option value="DynamicNFT">');
    const named = await get("/xrpl/validators?amendment=DynamicNFT");
    await named.text();
    expect(named.status).toBe(302);
    expect(named.headers.get("Location")).toBe("/xrpl/validators");
  });
});
