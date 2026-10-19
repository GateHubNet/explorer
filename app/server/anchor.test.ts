import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { utcDayOf } from "../domain/window";
import type { LastValidated } from "./api-types";
import { anchorOf } from "./anchor";

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
