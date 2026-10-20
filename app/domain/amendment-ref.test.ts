import { describe, expect, it } from "vitest";

import { AMENDMENT_NAME, amendmentSegment, parseAmendmentRef } from "./amendment-ref";

// IDs from D1 3.5: SHA-512Half of the name, upper case.
const AMM_ID = "8CC0774A3BF66D1D22E76BBDA8E8A232E6B6313834301B3B23E8601196AE6455";
const XCB_ID = "C98D98EE9616ACD36E81FDEB8D41D349BF5F1B41DD64A0ABC1FE9AA5EA267E9C";

describe("parseAmendmentRef", () => {
  it("reads 64 hex as an upper-case ID, before the name rule", () => {
    expect(parseAmendmentRef(XCB_ID.toLowerCase())).toEqual({ id: XCB_ID });
  });

  it("reads an upper-case ID as it is, and a mixed-case one in upper case", () => {
    expect(parseAmendmentRef(AMM_ID)).toEqual({ id: AMM_ID });
    expect(parseAmendmentRef(AMM_ID.slice(0, 20).toLowerCase() + AMM_ID.slice(20))).toEqual({ id: AMM_ID });
  });

  it("reads a hex string that starts with a letter as an ID, not as a name", () => {
    expect(AMENDMENT_NAME.test(XCB_ID)).toBe(true); // it would match the name pattern
    expect(parseAmendmentRef(XCB_ID)).toEqual({ id: XCB_ID });
  });

  it("reads 64 characters that are not all hex digits as a name", () => {
    const name = "A" + "b".repeat(62) + "g";
    expect(parseAmendmentRef(name)).toEqual({ name });
  });

  it.each(["fix1201", "NonFungibleTokensV1_1", "fix240819", "XChainBridge", "AMM"])("accepts the name %s", (n) =>
    expect(parseAmendmentRef(n)).toEqual({ name: n }),
  );

  it("keeps a name in the case it was typed", () => {
    expect(parseAmendmentRef("xchainbridge")).toEqual({ name: "xchainbridge" });
  });

  it("accepts a name of 64 characters", () => {
    const name = "Z" + "x".repeat(63);
    expect(parseAmendmentRef(name)).toEqual({ name });
  });

  it.each(["fix-1201", "fix.1201", "fix 1201", "1201fix", "a".repeat(65), "", "AMM\n", " AMM", "_AMM", "fix/1201", "fixé"])(
    "refuses %j",
    (n) => expect(parseAmendmentRef(n)).toBeNull(),
  );

  it("refuses 65 hex digits and 63 hex digits that start with a digit", () => {
    expect(parseAmendmentRef("8" + XCB_ID)).toBeNull();
    expect(parseAmendmentRef(XCB_ID.slice(1).replace(/^./, "8"))).toBeNull();
  });
});

describe("amendmentSegment", () => {
  it("is the name where the row has one, as D1 writes it", () => {
    expect(amendmentSegment({ id: XCB_ID, name: "XChainBridge" })).toBe("XChainBridge");
    expect(amendmentSegment({ id: AMM_ID, name: "AMM" })).toBe("AMM");
  });

  it("is the ID where the row has no name", () => {
    expect(amendmentSegment({ id: XCB_ID })).toBe(XCB_ID);
  });

  it("is a segment parseAmendmentRef reads back", () => {
    expect(parseAmendmentRef(amendmentSegment({ id: XCB_ID, name: "XChainBridge" }))).toEqual({ name: "XChainBridge" });
    expect(parseAmendmentRef(amendmentSegment({ id: XCB_ID }))).toEqual({ id: XCB_ID });
  });
});
