import { describe, expect, it } from "vitest";

import { formatAmount } from "~/domain/format";

// The same alias in the worker project (see vitest.config.ts).
describe("the ~/ alias in the worker project", () => {
  it("resolves to app/", () => {
    expect(formatAmount("1250.00")).toBe("1,250.00");
  });
});
