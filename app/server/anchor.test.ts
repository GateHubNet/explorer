import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { utcDayOf } from "../domain/window";
import type { LastValidated } from "./api-types";
import { anchorOf, anchorOrThrow } from "./anchor";
import { UpstreamError } from "./upstream";

const recorded = JSON.parse(
  readFileSync(new URL("../../test/fixtures/http/xrpl/data-api/last_validated.json", import.meta.url), "utf8"),
) as LastValidated;

describe("anchorOf", () => {
  it("is the ledger index as a number and the close time as unix seconds", () => {
    expect(anchorOf(recorded)).toEqual({ lastValidated: 107721455, closeTime: 1792256472 });
  });

  it("carries only those two", () => {
    expect(Object.keys(anchorOf(recorded)).sort()).toEqual(["closeTime", "lastValidated"]);
  });

  it("reads a close time on the last second of a day as that day, and the next second as the next", () => {
    const at = (close_time: string) => anchorOf({ ...recorded, close_time });
    expect(utcDayOf(at("2026-10-17T23:59:59Z").closeTime)).toBe("2026-10-17");
    expect(utcDayOf(at("2026-10-18T00:00:00Z").closeTime)).toBe("2026-10-18");
  });

  it("gives T of the recorded fixture as 2026-10-17", () => {
    expect(utcDayOf(anchorOf(recorded).closeTime)).toBe("2026-10-17");
  });
});

describe("anchorOrThrow", () => {
  it("is anchorOf for an answer whose ledger and close time are numbers", () => {
    expect(anchorOrThrow(recorded)).toEqual(anchorOf(recorded));
  });

  it.each([
    ["a close time that is not a time", { close_time: "yesterday" }],
    ["a ledger index that is not a number", { ledger_index: "latest" }],
    ["an empty close time", { close_time: "" }],
  ])("is the data API failing for %s: an UpstreamError of kind server, which a live page answers 503", (_what, broken) => {
    let thrown: unknown;
    try {
      anchorOrThrow({ ...recorded, ...broken });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UpstreamError);
    expect(thrown).toMatchObject({
      kind: "server",
      status: 200,
      message: "data API GET /v2/last_validated answered a ledger_index or close_time that is not a number",
    });
  });
});
