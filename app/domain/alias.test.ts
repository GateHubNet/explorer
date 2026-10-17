import { describe, expect, it } from "vitest";

import { formatAmount } from "~/domain/format";

// vitest.config.ts gives every project the `~/` alias of tsconfig.cloudflare.json; without it a test that
// imports through `~/` fails to resolve (the projects do not read vite.config.ts).
describe("the ~/ alias in the unit project", () => {
  it("resolves to app/", () => {
    expect(formatAmount("1250.00")).toBe("1,250.00");
  });
});
