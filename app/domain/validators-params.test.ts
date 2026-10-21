import { encodeNodePublic } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import type { AmendmentStatus } from "./amendments-params";
import {
  canonicalValidatorsParams,
  parseValidatorsParams,
  SEARCH_MAX,
  validatorHref,
  validatorsHref,
  type ValidatorsParams,
} from "./validators-params";

const ED = encodeNodePublic(Uint8Array.from([0xed, ...Array(32).fill(0x11)]));

// IDs from D1 3.5.
const AMM_ID = "8CC0774A3BF66D1D22E76BBDA8E8A232E6B6313834301B3B23E8601196AE6455";
const XCB_ID = "C98D98EE9616ACD36E81FDEB8D41D349BF5F1B41DD64A0ABC1FE9AA5EA267E9C";
const UNKNOWN_ID = "98433DD001A5737F773D74F8CA2A25A065089C73B2E611C760BAF369E4FECA76";
const FIX_ID = "A".repeat(64);
const FIX_UPPER_ID = "B".repeat(64);

const row = (id: string, status: AmendmentStatus, name?: string) => (name === undefined ? { id, status } : { id, name, status });
const publishers = ["vl.ripple.com", "unl.xrplf.example"] as const;
const amendments = [
  row(AMM_ID, "enabled", "AMM"),
  row(XCB_ID, "majority", "XChainBridge"),
  row(UNKNOWN_ID, "unknown"),
  row(FIX_ID, "voting", "fooBar"),
  row(FIX_UPPER_ID, "voting", "FOOBAR"),
  row("C".repeat(64), "obsolete", "Retired"),
];

/** The query of an href, as `parseValidatorsParams` is given it. */
const searchOf = (href: string) => (href.includes("?") ? href.slice(href.indexOf("?")) : "");

describe("the canonical form of a validators query (the pure part)", () => {
  it.each([
    ["", "/xrpl/validators"],
    ["?scope=unl", "/xrpl/validators"],
    ["?scope=ALL", "/xrpl/validators?scope=all"],
    ["?scope=all&publisher=&amendment=&q=", "/xrpl/validators?scope=all"],
    ["?q=%20north%20", "/xrpl/validators?q=north"],
    ["?q=x&scope=all", "/xrpl/validators?scope=all&q=x"],
    ["?scope=all&scope=unl", "/xrpl/validators?scope=all"],
    ["?scope=unl&scope=all", "/xrpl/validators"], // the first one is read
    ["?scope=bogus&x=1", "/xrpl/validators"],
    [`?amendment=${XCB_ID.toLowerCase()}`, `/xrpl/validators?amendment=${XCB_ID}`],
    ["?amendment=no-such!", "/xrpl/validators"],
    ["?q=%20%20", "/xrpl/validators"],
    ["?q=north+star", "/xrpl/validators?q=north+star"],
    ["?q=a%26b%3Dc", "/xrpl/validators?q=a%26b%3Dc"],
    ["?q=a%2Bb", "/xrpl/validators?q=a%2Bb"],
    ["?q=x&amendment=XChainBridge&publisher=vl.ripple.com&scope=all", "/xrpl/validators?scope=all&publisher=vl.ripple.com&amendment=XChainBridge&q=x"],
    ["?publisher=vl.ripple.com&publisher=other.example", "/xrpl/validators?publisher=vl.ripple.com"],
    ["?utm_source=x&q=n&fbclid=1", "/xrpl/validators?q=n"],
    ["scope=all", "/xrpl/validators?scope=all"], // the `?` is not needed
  ])("the canonical form of %j is %s", (s, href) => expect(validatorsHref("xrpl", parseValidatorsParams(s))).toBe(href));

  it("reads the default view as scope unl and nothing else", () => {
    expect(parseValidatorsParams("")).toStrictEqual({ scope: "unl" });
    expect(parseValidatorsParams("?scope=ALL&q=%20x%20&publisher=P&amendment=AMM")).toStrictEqual({
      scope: "all",
      publisher: "P",
      amendment: "AMM",
      q: "x",
    });
  });

  it("writes the network it is given", () => {
    expect(validatorsHref("xahau", { scope: "all" })).toBe("/xahau/validators?scope=all");
  });

  it("cuts q at 100 characters, not UTF-16 units", () => {
    expect(SEARCH_MAX).toBe(100);
    expect(parseValidatorsParams(`?q=${encodeURIComponent("😀".repeat(101))}`).q).toBe("😀".repeat(100));
    expect(parseValidatorsParams(`?q=${encodeURIComponent("😀".repeat(100))}`).q).toBe("😀".repeat(100)); // 200 units, 100 characters
    expect(parseValidatorsParams(`?q=${"a".repeat(101)}`).q).toBe("a".repeat(100));
    expect(parseValidatorsParams(`?q=${"a".repeat(100)}`).q).toBe("a".repeat(100));
  });

  it("trims q before it cuts it, and leaves no space at the cut", () => {
    expect(parseValidatorsParams(`?q=${"%20".repeat(5)}${"a".repeat(100)}`).q).toBe("a".repeat(100));
    // Cut after the 99th letter and the space: a trailing space would not survive a second pass.
    const cut = parseValidatorsParams(`?q=${"a".repeat(99)}%20bbb`);
    expect(cut.q).toBe("a".repeat(99));
    expect(parseValidatorsParams(searchOf(validatorsHref("xrpl", cut)))).toEqual(cut);
  });

  it("reads publisher as it is written, and drops it when empty", () => {
    expect(parseValidatorsParams("?publisher=VL.Ripple.com").publisher).toBe("VL.Ripple.com");
    expect(parseValidatorsParams("?publisher=")).toStrictEqual({ scope: "unl" });
  });

  it("reads amendment as an upper-case ID or as a name in the case typed, and drops what parseAmendmentRef refuses", () => {
    expect(parseValidatorsParams(`?amendment=${UNKNOWN_ID.toLowerCase()}`).amendment).toBe(UNKNOWN_ID);
    expect(parseValidatorsParams("?amendment=xchainbridge").amendment).toBe("xchainbridge");
    expect(parseValidatorsParams("?amendment=fix-1201")).toStrictEqual({ scope: "unl" });
    expect(parseValidatorsParams("?amendment=1201fix")).toStrictEqual({ scope: "unl" });
  });

  it("applies the pure rules to the params it writes, as it does to the ones it reads", () => {
    expect(
      validatorsHref("xrpl", { scope: "unl", publisher: "", amendment: XCB_ID.toLowerCase(), q: "  north star  " }),
    ).toBe(`/xrpl/validators?amendment=${XCB_ID}&q=north+star`);
    expect(validatorsHref("xrpl", { scope: "all", amendment: "no-such!", q: " " })).toBe("/xrpl/validators?scope=all");
    expect(validatorsHref("xrpl", { scope: "unl", q: "😀".repeat(101) })).toBe(`/xrpl/validators?q=${encodeURIComponent("😀".repeat(100))}`);
  });

  it("round-trips validatorsHref through parseValidatorsParams", () => {
    const views: ValidatorsParams[] = [
      { scope: "unl" },
      { scope: "all" },
      { scope: "unl", q: "north star" },
      { scope: "all", q: "a&b=c+d%e#f?g /h" },
      { scope: "all", q: "Zürich 日本語 😀" },
      { scope: "unl", publisher: "vl.ripple.com" },
      { scope: "all", publisher: "unl.xrplf.example", amendment: XCB_ID, q: "x" },
      { scope: "unl", amendment: "XChainBridge" },
      { scope: "unl", q: "😀".repeat(100) },
    ];
    for (const params of views) {
      const href = validatorsHref("xrpl", params);
      expect(parseValidatorsParams(searchOf(href))).toEqual(params);
      // A canonical href is its own canonical form: the loader's redirect settles after one step.
      expect(validatorsHref("xrpl", parseValidatorsParams(searchOf(href)))).toBe(href);
    }
  });
});

describe("canonicalValidatorsParams (the part that needs data)", () => {
  const known = { publishers, amendments };
  const canonical = (search: string, k = known) => canonicalValidatorsParams(parseValidatorsParams(search), k);

  it("tidies publisher and amendment with S's and A's data", () => {
    expect(canonical("?publisher=VL.Ripple.com").publisher).toBe("vl.ripple.com");
    expect(canonical("?publisher=vl.ripple.com").publisher).toBe("vl.ripple.com");
    expect(canonical("?publisher=nope.example")).toStrictEqual({ scope: "unl" });
    expect(canonical(`?amendment=${XCB_ID}`).amendment).toBe("XChainBridge");
    expect(canonical(`?amendment=${XCB_ID.toLowerCase()}`).amendment).toBe("XChainBridge");
    expect(canonical("?amendment=xchainbridge").amendment).toBe("XChainBridge");
    expect(canonical("?amendment=XChainBridge").amendment).toBe("XChainBridge");
    expect(canonical("?amendment=AMM")).toStrictEqual({ scope: "unl" }); // enabled
    expect(canonical(`?amendment=${AMM_ID}`)).toStrictEqual({ scope: "unl" }); // enabled, by ID
    expect(canonical("?amendment=Retired")).toStrictEqual({ scope: "unl" }); // obsolete
    expect(canonical("?amendment=NoSuchName")).toStrictEqual({ scope: "unl" });
    expect(canonical(`?amendment=${UNKNOWN_ID}`).amendment).toBe(UNKNOWN_ID); // unknown, named by its ID
    expect(canonical(`?amendment=${UNKNOWN_ID.toLowerCase()}`).amendment).toBe(UNKNOWN_ID);
  });

  it("takes an exact name before a case-insensitive one, and refuses a case-insensitive match that is not unique", () => {
    expect(canonical("?amendment=fooBar").amendment).toBe("fooBar");
    expect(canonical("?amendment=FOOBAR").amendment).toBe("FOOBAR");
    expect(canonical("?amendment=foobar")).toStrictEqual({ scope: "unl" });
    expect(canonical("?amendment=FooBar")).toStrictEqual({ scope: "unl" });
  });

  it("drops an amendment of a status a newer D1 sends, by name or by ID: the filter does not offer it", () => {
    const frozen = { id: "8".repeat(64), name: "Frozen", status: "frozen" };
    const withFrozen = (search: string) => canonicalValidatorsParams(parseValidatorsParams(search), { publishers, amendments: [...amendments, frozen] });
    expect(withFrozen("?amendment=Frozen")).toStrictEqual({ scope: "unl" });
    expect(withFrozen(`?amendment=${frozen.id}`)).toStrictEqual({ scope: "unl" });
    // The rows of the statuses it knows still match beside it.
    expect(withFrozen("?amendment=xchainbridge").amendment).toBe("XChainBridge");
  });

  it("matches a name among the rows of the statuses the filter has, not among all rows", () => {
    const list = [row(AMM_ID, "enabled", "Twin"), row(XCB_ID, "voting", "TWIN")];
    expect(canonical("?amendment=twin", { publishers, amendments: list }).amendment).toBe("TWIN");
  });

  it("leaves scope and q as they are, and keeps the other parameters out", () => {
    expect(canonical("?scope=ALL&q=%20north%20&publisher=VL.Ripple.com&amendment=nope&x=1")).toStrictEqual({
      scope: "all",
      publisher: "vl.ripple.com",
      q: "north",
    });
  });

  it("keeps a parameter as given when its list is null", () => {
    const given = parseValidatorsParams(`?scope=all&publisher=VL.Ripple.com&amendment=xchainbridge&q=x`);
    expect(canonicalValidatorsParams(given, { publishers: null, amendments: null })).toEqual(given);
    // One list null does not keep the other's parameter.
    expect(canonicalValidatorsParams(given, { publishers: null, amendments })).toEqual({ ...given, amendment: "XChainBridge" });
    expect(canonicalValidatorsParams(given, { publishers, amendments: null })).toEqual({ ...given, publisher: "vl.ripple.com" });
  });

  it("drops everything it cannot match against an empty list, which is a list that answered", () => {
    const given = parseValidatorsParams("?publisher=vl.ripple.com&amendment=XChainBridge");
    expect(canonicalValidatorsParams(given, { publishers: [], amendments: [] })).toStrictEqual({ scope: "unl" });
  });

  it("does not change its input", () => {
    const given = parseValidatorsParams("?publisher=VL.Ripple.com&amendment=xchainbridge");
    const before = { ...given };
    canonicalValidatorsParams(given, known);
    expect(given).toEqual(before);
  });

  it("gives a canonical form that writes the href the loader redirects to", () => {
    const params = canonical(`?q=x&amendment=${XCB_ID.toLowerCase()}&publisher=VL.RIPPLE.COM&scope=ALL&x=1`);
    expect(validatorsHref("xrpl", params)).toBe("/xrpl/validators?scope=all&publisher=vl.ripple.com&amendment=XChainBridge&q=x");
    expect(canonicalValidatorsParams(params, known)).toEqual(params); // settled after one pass
  });
});

describe("validatorHref", () => {
  it("writes validatorHref with marker and back, and drops back alone", () => {
    expect(validatorHref("xrpl", ED)).toBe(`/xrpl/validators/${ED}`);
    expect(validatorHref("xrpl", ED, {})).toBe(`/xrpl/validators/${ED}`);
    expect(validatorHref("xrpl", ED, { marker: "M3", back: ["M2", "M1"] })).toBe(`/xrpl/validators/${ED}?marker=M3&back=M2.M1`);
    expect(validatorHref("xahau", ED, { marker: "M1" })).toBe(`/xahau/validators/${ED}?marker=M1`);
    expect(validatorHref("xrpl", ED, { back: ["M1"] })).toBe(`/xrpl/validators/${ED}`);
    expect(validatorHref("xrpl", ED, { marker: "M1", back: [] })).toBe(`/xrpl/validators/${ED}?marker=M1`);
    expect(validatorHref("xrpl", ED, { marker: undefined, back: undefined })).toBe(`/xrpl/validators/${ED}`);
  });

  it("writes the trail as the account page does, markers encoded and joined with a dot", () => {
    expect(validatorHref("xrpl", ED, { marker: "ab==", back: ["c-d_e=", "f"] })).toBe(
      `/xrpl/validators/${ED}?marker=ab%3D%3D&back=c-d_e%3D.f`,
    );
  });
});
