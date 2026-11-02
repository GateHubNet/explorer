import type { UIMatch } from "react-router";
import { describe, expect, it } from "vitest";

import { navPageOf } from "./route-handle";

const match = (handle: unknown): UIMatch => ({ id: "route", pathname: "/", params: {}, loaderData: undefined, handle });

describe("navPageOf", () => {
  it("is undefined without matches, and where no match names a page, whatever its handle is", () => {
    expect(navPageOf([])).toBeUndefined();
    expect(navPageOf([match(undefined), match(null), match("supply"), match({}), match({ navSection: "network", heroSearch: true })])).toBeUndefined();
  });

  it("names the deepest navPage, or none", () => {
    expect(navPageOf([match({ navSection: "network", navPage: "validators" }), match(undefined), match({ heroSearch: true })])).toBe("validators");
    expect(navPageOf([match(undefined), match({ navSection: "network", navPage: "supply" })])).toBe("supply");
    // Two different names, so that the order shows: the deeper route wins.
    expect(navPageOf([match({ navPage: "overview" }), match({ navPage: "amendments" })])).toBe("amendments");
    expect(navPageOf([match({ navPage: "amendments" }), match({ navPage: "overview" })])).toBe("overview");
    // A deeper route that names none leaves the parent's.
    expect(navPageOf([match({ navPage: "validators" }), match({ navSection: "network" })])).toBe("validators");
  });
});
