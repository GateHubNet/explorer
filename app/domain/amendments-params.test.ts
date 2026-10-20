import { describe, expect, it } from "vitest";

import { AMENDMENT_STATUSES, amendmentHref, amendmentsHref, parseAmendmentsParams } from "./amendments-params";

const XCB_ID = "C98D98EE9616ACD36E81FDEB8D41D349BF5F1B41DD64A0ABC1FE9AA5EA267E9C";

describe("parseAmendmentsParams", () => {
  it.each([
    ["", undefined],
    ["?status=voting", "voting"],
    ["?status=VOTING", "voting"],
    ["?status=voting&status=enabled", "voting"],
    ["?status=voting,enabled", undefined],
    ["?status=", undefined],
    ["?x=1", undefined],
    ["?status=bogus", undefined],
    ["?status=bogus&status=voting", undefined], // the first one is read, and it is not a status
    ["?x=1&status=obsolete&y=2", "obsolete"],
    ["status=unknown", "unknown"], // the `?` is not needed
  ])("status of %j", (s, st) => expect(parseAmendmentsParams(s).status).toBe(st));

  it("answers an object with no `status` key for the default view", () => {
    expect(parseAmendmentsParams("?x=1")).toStrictEqual({});
  });

  it("reads each of the five statuses", () => {
    expect(AMENDMENT_STATUSES).toEqual(["majority", "voting", "enabled", "obsolete", "unknown"]);
    for (const status of AMENDMENT_STATUSES) expect(parseAmendmentsParams(`?status=${status}`)).toEqual({ status });
  });
});

describe("amendment hrefs", () => {
  it("writes the amendment hrefs", () => {
    expect(amendmentsHref("xrpl", {})).toBe("/xrpl/amendments");
    expect(amendmentsHref("xahau", { status: "majority" })).toBe("/xahau/amendments?status=majority");
    expect(amendmentHref("xrpl", "AMM")).toBe("/xrpl/amendments/AMM");
    expect(amendmentHref("xahau", XCB_ID)).toBe(`/xahau/amendments/${XCB_ID}`);
  });

  it("round-trips amendmentsHref through parseAmendmentsParams for every status", () => {
    for (const status of AMENDMENT_STATUSES) {
      const href = amendmentsHref("xrpl", { status });
      expect(parseAmendmentsParams(href.slice(href.indexOf("?")))).toEqual({ status });
    }
    expect(amendmentsHref("xrpl", parseAmendmentsParams("?status=VOTING&x=1"))).toBe("/xrpl/amendments?status=voting");
  });

  it("writes a segment that is not a name as one path segment", () => {
    expect(amendmentHref("xrpl", "a/b?c#d")).toBe("/xrpl/amendments/a%2Fb%3Fc%23d");
  });
});
