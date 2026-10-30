import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allSwitches } from "../../test/support/switches";
import { staticClosure, valueImports } from "../../test/support/value-imports";
import { featuresOf, NO_FEATURES } from "../ui/features";
import { ledgerId as leafLedgerId, objectHref as leafHref } from "./object-href";
import { delegationHref, kindOfType, ledgerId, OBJECT_KINDS, objectHref } from "./object-link";

const ID = "090539D4CC40DE307852D4EA97EFAE492E975525B4F8091D75542883A9D0AFB6";
const A = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const ON = { ...NO_FEATURES, ledgerObjects: true, delegation: true };
const OFF = NO_FEATURES;

describe("OBJECT_KINDS and kindOfType", () => {
  it("name the three objects that have a page: the ledger's type, the path's segment, the data API's kind and the words", () => {
    expect(OBJECT_KINDS).toEqual([
      { type: "Escrow", kind: "escrow", segment: "escrows", api: "escrow", words: "escrow" },
      { type: "Check", kind: "check", segment: "checks", api: "check", words: "check" },
      { type: "PayChannel", kind: "payment-channel", segment: "payment-channels", api: "payment_channel", words: "payment channel" },
    ]);
  });

  it("find the kind of a ledger entry type, and none for another (a Delegate has no page of its own)", () => {
    expect(["Escrow", "Check", "PayChannel"].map(kindOfType)).toEqual(["escrow", "check", "payment-channel"]);
    expect(["Delegate", "AccountRoot", "URIToken", "escrow", "payment-channel", ""].map(kindOfType)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("objectHref", () => {
  it("is an object's page by its ID, on either network, with the segment of its kind", () => {
    expect(objectHref("xrpl", "payment-channel", { id: ID }, ON)).toBe(`/xrpl/payment-channels/${ID}`);
    expect(objectHref("xrpl", "escrow", { id: ID }, ON)).toBe(`/xrpl/escrows/${ID}`);
    expect(objectHref("xahau", "check", { id: ID }, ON)).toBe(`/xahau/checks/${ID}`);
  });

  it("is an escrow's owner and sequence where the ID is not known", () => {
    expect(objectHref("xrpl", "escrow", { owner: A, sequence: 57978925 }, ON)).toBe(`/xrpl/escrows/${A}/57978925`);
    expect(objectHref("xahau", "escrow", { owner: A, sequence: 1 }, ON)).toBe(`/xahau/escrows/${A}/1`);
  });

  it("is none for the owner and sequence of a check or a channel, which have no such address", () => {
    expect(objectHref("xrpl", "check", { owner: A, sequence: 5 }, ON)).toBeNull();
    expect(objectHref("xrpl", "payment-channel", { owner: A, sequence: 5 }, ON)).toBeNull();
  });

  it("is null, the plain text, while LEDGER_OBJECTS is off", () => {
    expect([objectHref("xrpl", "check", { id: ID }, OFF), delegationHref("xrpl", A, OFF)]).toEqual([null, null]);
    expect(objectHref("xrpl", "escrow", { owner: A, sequence: 1 }, OFF)).toBeNull();
    expect(objectHref("xrpl", "payment-channel", { id: ID }, OFF)).toBeNull();
  });

  it("follows LEDGER_OBJECTS alone: no other switch turns it on, and none turns it off", () => {
    expect(objectHref("xrpl", "escrow", { id: ID }, { ...featuresOf(allSwitches("on")), ledgerObjects: false })).toBeNull();
    expect(objectHref("xrpl", "escrow", { id: ID }, { ...featuresOf(allSwitches("off")), ledgerObjects: true })).toBe(`/xrpl/escrows/${ID}`);
    expect(objectHref("xrpl", "escrow", { id: ID }, featuresOf({ ...allSwitches("off"), LEDGER_OBJECTS: "on" }))).toBe(`/xrpl/escrows/${ID}`);
    expect(objectHref("xrpl", "escrow", { id: ID }, featuresOf({ ...allSwitches("off"), DELEGATION: "on" }))).toBeNull();
  });
});

describe("ledgerId", () => {
  it("is 64 hexadecimal digits in capitals, whatever their case", () => {
    expect(ledgerId(ID)).toBe(ID);
    expect(ledgerId(ID.toLowerCase())).toBe(ID);
  });

  it("is none for anything else: one digit short or long, a character that is no digit, a field left out", () => {
    for (const raw of [ID.slice(1), `${ID}0`, `${ID.slice(1)}G`, `0x${ID.slice(2)}`, "", "nope", 5, null, undefined]) expect(ledgerId(raw), String(raw)).toBeUndefined();
  });
});

describe("delegationHref", () => {
  it("is the delegator's Delegation tab while DELEGATION is on", () => {
    expect(delegationHref("xrpl", A, ON)).toBe(`/xrpl/account/${A}?tab=delegation`);
    expect(delegationHref("xahau", A, ON)).toBe(`/xahau/account/${A}?tab=delegation`);
  });

  it("is null, the plain text, while DELEGATION is off", () => {
    expect(delegationHref("xrpl", A, OFF)).toBeNull();
    expect(delegationHref("xrpl", A, { ...featuresOf(allSwitches("on")), delegation: false })).toBeNull();
  });

  it("follows DELEGATION alone: LEDGER_OBJECTS neither turns it on nor off", () => {
    expect(delegationHref("xrpl", A, { ...NO_FEATURES, ledgerObjects: true })).toBeNull();
    expect(delegationHref("xrpl", A, { ...NO_FEATURES, delegation: true })).toBe(`/xrpl/account/${A}?tab=delegation`);
  });
});

describe("the browser bundle", () => {
  // object-link.ts is what a page with a link to an object or a delegation loads (the transaction page's objects touched). It is pure: it imports types, which the compiler erases, and at
  // run time only the leaf object-href.ts, `objectHref` and the paths' segments, which imports nothing. Sentence, on every page that draws a sentence, loads the leaf alone (ledger object
  // pages spec 7), not the kinds' other facts nor the delegation's link.
  const appDir = new URL("../", import.meta.url);

  it("loads no file but itself and the leaf, which imports nothing at run time", () => {
    expect(valueImports(readFileSync(new URL("domain/object-link.ts", appDir), "utf8"))).toEqual(["./object-href", "./object-href"]);
    expect(staticClosure(appDir, "domain/object-link.ts")).toEqual(["domain/object-href.ts", "domain/object-link.ts"]);
    expect(valueImports(readFileSync(new URL("domain/object-href.ts", appDir), "utf8"))).toEqual([]);
  });

  it("Sentence reaches the leaf, never object-link.ts", () => {
    const closure = staticClosure(appDir, "ui/components/Sentence.tsx");
    expect(closure).toContain("domain/object-href.ts");
    expect(closure).not.toContain("domain/object-link.ts");
  });

  it("re-exports the leaf's objectHref and ledgerId, so that a file of the Worker or a page can ask either, and the kinds' segments are the leaf's", () => {
    expect(objectHref).toBe(leafHref);
    expect(ledgerId).toBe(leafLedgerId);
    expect(OBJECT_KINDS.map((each) => leafHref("xrpl", each.kind, { id: ID }, ON))).toEqual(OBJECT_KINDS.map((each) => `/xrpl/${each.segment}/${ID}`));
  });
});
