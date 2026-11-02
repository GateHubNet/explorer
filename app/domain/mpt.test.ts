import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";

import { staticClosure, valueImports } from "../../test/support/value-imports";
import type { MptFlags, MptTransferKind } from "../server/api-types";
import {
  ASSET_CLASS_WORDS,
  MAX_SCALE,
  MPT_FLAG_PILLS,
  MPT_FLAG_WORDS,
  MPT_FLAGS_LEGEND,
  MPT_KIND_WORDS,
  type MptFlagKey,
  isMptId,
  mptPath,
  percentText,
  safeLink,
  scaleUnits,
  shortMptId,
  superscript,
  transferFeeText,
} from "./mpt";

const ID = "0000012A2ADB0B3959D60A6E6991F729E1918B7163925230";

describe("isMptId and shortMptId", () => {
  it("take exactly 48 hex digits in either case, and no 0x, no other length", () => {
    expect([isMptId("0000012a" + "0".repeat(40)), isMptId("0".repeat(47)), isMptId("0x" + "0".repeat(46)), isMptId("0".repeat(64))]).toEqual([true, false, false, false]);
    expect(isMptId(ID)).toBe(true);
    expect(isMptId(ID.toLowerCase())).toBe(true);
    expect(isMptId(`${ID.slice(0, 20).toLowerCase()}${ID.slice(20)}`)).toBe(true);
    expect(isMptId("0".repeat(49))).toBe(false);
    expect(isMptId("")).toBe(false);
    expect(isMptId("G".repeat(48))).toBe(false);
    expect(isMptId(` ${ID.slice(1)}`)).toBe(false);
    expect(isMptId(`${ID}\n`)).toBe(false);
    expect(isMptId(`${ID.slice(0, 47)}٣`)).toBe(false);
  });

  it("shorten an ID to its first 8 digits, an ellipsis and its last 4, in upper case", () => {
    expect(shortMptId("0000012a" + "0".repeat(36) + "3f09")).toBe("0000012A…3F09");
    expect(shortMptId(ID)).toBe("0000012A…5230");
    expect(shortMptId(ID.toLowerCase())).toBe("0000012A…5230");
  });
});

describe("mptPath", () => {
  it("writes the page's path, and the holders' or the transfers', with the ID in upper case", () => {
    expect(mptPath("xrpl", ID)).toBe(`/xrpl/mpt/${ID}`);
    expect(mptPath("xahau", ID)).toBe(`/xahau/mpt/${ID}`);
    expect(mptPath("xrpl", ID, "holders")).toBe(`/xrpl/mpt/${ID}/holders`);
    expect(mptPath("xrpl", ID, "transfers")).toBe(`/xrpl/mpt/${ID}/transfers`);
    expect(mptPath("xrpl", ID.toLowerCase(), "holders")).toBe(`/xrpl/mpt/${ID}/holders`);
  });
});

describe("scaleUnits", () => {
  it("shifts the units by the scale and writes exactly that many decimals", () => {
    expect([scaleUnits("124000000", 2), scaleUnits("2500000", 0), scaleUnits("1", 15), scaleUnits("9223372036854775807", 19), scaleUnits("5", 20), scaleUnits("-2500", 2)]).toEqual([
      "1240000.00",
      "2500000",
      "0.000000000000001",
      "0.9223372036854775807",
      null,
      "-25.00",
    ]);
  });

  it("is exact at the largest scale, at zero and for an amount bigger than a float holds", () => {
    expect(MAX_SCALE).toBe(19);
    expect(scaleUnits("0", 19)).toBe("0.0000000000000000000");
    expect(scaleUnits("0", 0)).toBe("0");
    expect(scaleUnits("1", 19)).toBe("0.0000000000000000001");
    expect(scaleUnits("123456789012345678901234567890", 2)).toBe("1234567890123456789012345678.90");
    expect(scaleUnits("9007199254740993", 0)).toBe("9007199254740993");
    expect(scaleUnits("9007199254740993", 1)).toBe("900719925474099.3");
    expect(scaleUnits("100", 19)).toBe("0.0000000000000000100");
  });

  it("is null above MAX_SCALE, for what is no scale and for what is no integer: only an integer is ever scaled", () => {
    for (const scale of [20, 25, 255, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(scaleUnits("5", scale), String(scale)).toBeNull();
    for (const units of ["", "1.5", "1e3", "abc", " 5", "5 ", "0x10", "--5", "+5", "NaN", "Infinity", "٣"]) expect(scaleUnits(units, 2), JSON.stringify(units)).toBeNull();
  });
});

describe("transferFeeText", () => {
  it("is None for 0, and the fee in thousandths of a percent otherwise, with two decimals and a third when it needs one", () => {
    expect([0, 1, 100, 1234, 50000].map(transferFeeText)).toEqual(["None", "0.001%", "0.10%", "1.234%", "50.00%"]);
    expect([5, 10, 20, 999, 1000, 1500, 49_999].map(transferFeeText)).toEqual(["0.005%", "0.01%", "0.02%", "0.999%", "1.00%", "1.50%", "49.999%"]);
  });
});

describe("percentText", () => {
  it("is the share of the whole to the decimals asked, half up, from the exact integers", () => {
    expect([percentText("1820451120", "5000000000", 1), percentText("612040000", "1820451120", 2), percentText("1", "1820451120", 2)]).toEqual(["36.4%", "33.62%", "<0.01%"]);
  });

  it("rounds half up and carries into the integer part", () => {
    expect(percentText("1", "16", 1)).toBe("6.3%");
    expect(percentText("1", "16", 2)).toBe("6.25%");
    expect(percentText("1", "8", 1)).toBe("12.5%");
    expect(percentText("3", "8", 2)).toBe("37.50%");
    expect(percentText("9995", "10000", 1)).toBe("100.0%");
    expect(percentText("99995", "100000", 2)).toBe("100.00%");
    expect(percentText("99994", "100000", 2)).toBe("99.99%");
    expect(percentText("5", "10000", 2)).toBe("0.05%");
  });

  it("is `<` the step for a share above 0 and below it, and the step itself from there, in either precision", () => {
    expect(percentText("1", "10000", 2)).toBe("0.01%");
    expect(percentText("1", "10001", 2)).toBe("<0.01%");
    expect(percentText("1", "20000", 2)).toBe("<0.01%");
    expect(percentText("1", "1000", 1)).toBe("0.1%");
    expect(percentText("1", "1001", 1)).toBe("<0.1%");
    expect(percentText("1", "9223372036854775807", 1)).toBe("<0.1%");
  });

  it("is 0 of something for a part of 0, and a whole 100% for a part that is the whole", () => {
    expect(percentText("0", "1820451120", 2)).toBe("0.00%");
    expect(percentText("0", "1820451120", 1)).toBe("0.0%");
    expect(percentText("9223372036854775807", "9223372036854775807", 2)).toBe("100.00%");
    expect(percentText("1820451120", "1820451120", 1)).toBe("100.0%");
  });

  it("is a dash for a whole of 0 (nothing outstanding, a maximum of 0), and for what is no integer, so that no 0/0 reaches a label", () => {
    expect(percentText("0", "0", 1)).toBe("—");
    expect(percentText("5", "0", 2)).toBe("—");
    for (const [part, whole] of [["1.5", "3"], ["1", "3.5"], ["-1", "5"], ["1", "-5"], ["x", "5"], ["1", ""], ["", "5"], ["1e3", "5"], [" 1", "5"]] as const) {
      expect(percentText(part, whole, 1), `${part}/${whole}`).toBe("—");
      expect(percentText(part, whole, 2), `${part}/${whole}`).toBe("—");
    }
  });
});

describe("safeLink", () => {
  it("takes https://… as it is", () => {
    expect(safeLink("https://harborline.example/htf")).toBe("https://harborline.example/htf");
    expect(safeLink("https://harborline.example")).toBe("https://harborline.example");
    expect(safeLink("https://harborline.example/a/b?c=1&d=2#e")).toBe("https://harborline.example/a/b?c=1&d=2#e");
    expect(safeLink("https://sub.harborline.example:8443/x")).toBe("https://sub.harborline.example:8443/x");
    expect(safeLink("https://xn--mnchen-3ya.example/x")).toBe("https://xn--mnchen-3ya.example/x");
  });

  it("takes host/path, with no scheme and a host with a dot, as https://host/path", () => {
    expect(safeLink("harborline.example/htf/icon.png")).toBe("https://harborline.example/htf/icon.png");
    expect(safeLink("harborline.example")).toBe("https://harborline.example");
    expect(safeLink("sub.harborline.example/a?b=1#c")).toBe("https://sub.harborline.example/a?b=1#c");
    expect(safeLink("harborline.example?x=1")).toBe("https://harborline.example?x=1");
  });

  it.each([
    "javascript:alert(1)",
    "http://harborline.example",
    "ipfs://bafybeigd",
    "data:text/html,x",
    "",
    "//evil.example/x",
    "localhost/x",
    "https://",
    // The host-with-a-dot rule meets a scheme whose text has a dot after it; a space or a quote makes the text two things; a capital scheme is not the one scheme the issuer may use.
    "javascript:alert(1).x/y",
    "foo bar.example/x",
    "https://a b.example",
    "HTTPS://x.example",
    "Https://x.example",
  ])("refuses %j", (text) => {
    expect(safeLink(text)).toBeNull();
  });

  it.each([
    "https://localhost/x",
    "https://harborline/x",
    "harborline/x",
    "harborline",
    "https://user:pw@harborline.example/x",
    "https://harborline.example@evil.example/",
    "a@b.example/x",
    "harborline.example:8080/x",
    "https:/harborline.example",
    "https:harborline.example",
    "ftp://harborline.example/f",
    "mailto:a@harborline.example",
    "vbscript:msgbox(1).x",
    " https://harborline.example",
    "https://harborline.example ",
    "https://harborline.example/\n",
    "https://harborline.example/\t",
    "harborline.example/\u0000",
    "harborline.example/\u007f",
    "harborline.example/\u0085",
    "\\\\harborline.example\\x",
    "https://[::1]/x",
    "https://exa$mple.com/x",
    "exa$mple.com/x",
    "https://harborline..example/x",
    "https://.harborline.example/x",
    "https://-",
  ])("refuses %j, which the URL parser would read as another place than the text says, or as none", (text) => {
    expect(safeLink(text)).toBeNull();
  });
});

describe("superscript", () => {
  it("writes a whole number in superscript, a minus sign included", () => {
    expect(superscript(-2)).toBe("⁻²");
    expect(superscript(0)).toBe("⁰");
    expect(superscript(2)).toBe("²");
    expect(superscript(10)).toBe("¹⁰");
    expect(superscript(19)).toBe("¹⁹");
    expect(superscript(255)).toBe("²⁵⁵");
    expect(superscript(-15)).toBe("⁻¹⁵");
  });
});

describe("ASSET_CLASS_WORDS", () => {
  it("has the words of the six classes, in the spec's order", () => {
    expect(Object.entries(ASSET_CLASS_WORDS)).toEqual([
      ["rwa", "rwa (real-world asset)"],
      ["memes", "memes"],
      ["wrapped", "wrapped (a token of another chain)"],
      ["gaming", "gaming"],
      ["defi", "defi (decentralised finance)"],
      ["other", "other"],
    ]);
  });

  it("finds nothing for a class that is none, the prototype's names included: the class is the issuer's text", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "RWA", "", "rwa "]) expect(ASSET_CLASS_WORDS[name], JSON.stringify(name)).toBeUndefined();
    expect(Object.isFrozen(ASSET_CLASS_WORDS)).toBe(true);
  });
});

describe("MPT_FLAG_WORDS", () => {
  it("has the six rows in the board's order, each with its two lines and the ticker as {T}", () => {
    expect(MPT_FLAG_WORDS).toEqual([
      { key: "can_lock", label: "Can lock", yes: "The issuer can lock one holder's balance, or all of {T}, so it cannot move.", no: "The issuer cannot lock {T}." },
      { key: "require_auth", label: "Require auth", yes: "An account needs the issuer's approval before it can hold {T}.", no: "Any account can hold {T} without the issuer's approval." },
      { key: "can_escrow", label: "Can escrow", yes: "{T} can be held in escrows.", no: "{T} cannot be held in escrows." },
      { key: "can_trade", label: "Can trade", yes: "The issuer allows {T} on the DEX. MPT trading isn't enabled on XRPL yet.", no: "The issuer does not allow {T} on the DEX." },
      { key: "can_transfer", label: "Can transfer", yes: "Holders can send {T} to each other, not only back to the issuer.", no: "Holders can send {T} only back to the issuer." },
      { key: "can_clawback", label: "Can clawback", yes: "The issuer can take {T} back from a holder.", no: "The issuer cannot take {T} back." },
    ]);
  });

  it("keys each of the flags but `locked`, once, which is the Notice above the card and no row", () => {
    const keys = MPT_FLAG_WORDS.map((row) => row.key);
    expect(new Set(keys).size).toBe(6);
    expect([...keys].sort()).toEqual((["can_clawback", "can_escrow", "can_lock", "can_trade", "can_transfer", "require_auth"] satisfies MptFlagKey[]).sort());
    expectTypeOf<MptFlagKey>().toEqualTypeOf<Exclude<keyof MptFlags, "locked">>();
  });
});

describe("MPT_FLAG_PILLS and MPT_FLAGS_LEGEND", () => {
  it("have the six pills in the list's order, each with its title", () => {
    expect(MPT_FLAG_PILLS).toEqual([
      { key: "can_transfer", label: "Transfer", title: "Holders can send it to each other" },
      { key: "can_trade", label: "Trade", title: "The issuer allows it on the DEX. MPT trading isn't enabled on XRPL yet." },
      { key: "can_lock", label: "Lock", title: "The issuer can lock balances" },
      { key: "can_clawback", label: "Clawback", title: "The issuer can take it back" },
      { key: "can_escrow", label: "Escrow", title: "It can be held in escrows" },
      { key: "require_auth", label: "Auth", title: "Holders need the issuer's approval" },
    ]);
  });

  it("have a legend that says each pill's words, in the pills' order", () => {
    expect(MPT_FLAGS_LEGEND).toBe(
      "Flags: Transfer, holders can send it to each other · Trade, the issuer allows it on the DEX (MPT trading isn't enabled on XRPL yet) · Lock, the issuer can lock balances · Clawback, the issuer can take it back · Escrow, it can be held in escrows · Auth, holders need the issuer's approval.",
    );
    expect(MPT_FLAG_PILLS.map((pill) => pill.label)).toEqual(["Transfer", "Trade", "Lock", "Clawback", "Escrow", "Auth"]);
    const at = MPT_FLAG_PILLS.map((pill) => MPT_FLAGS_LEGEND.indexOf(`${pill.label}, `));
    expect(at.every((place, index) => place > 0 && (index === 0 || place > at[index - 1]!))).toBe(true);
  });

  // C28: the spec's and E11's apostrophes are straight, in every string.
  it("write every apostrophe straight, in these words and in the flags'", () => {
    const text = JSON.stringify([MPT_FLAG_WORDS, MPT_FLAG_PILLS, MPT_FLAGS_LEGEND, MPT_KIND_WORDS, ASSET_CLASS_WORDS]);
    expect(text).toContain("'");
    expect(text).not.toMatch(/[‘’‛ʼ]/);
  });
});

describe("MPT_KIND_WORDS", () => {
  it("names the seven kinds of transfer, in D9's order", () => {
    expect(Object.entries(MPT_KIND_WORDS)).toEqual([
      ["payment", "Transfer"],
      ["clawback", "Clawback"],
      ["lock", "Lock"],
      ["unlock", "Unlock"],
      ["escrow_create", "Escrow"],
      ["escrow_finish", "Escrow finished"],
      ["escrow_cancel", "Escrow cancelled"],
    ]);
    expectTypeOf(MPT_KIND_WORDS).toEqualTypeOf<Readonly<Record<MptTransferKind, string>>>();
  });
});

describe("the browser bundle", () => {
  // mpt.ts is drawn in the browser (the MPT pages and their components import it). It has no codec: its one import at run time is bignumber.js, which format.ts loads in the shell anyway; the
  // types it names (the data API's, the network ids) are erased.
  const appDir = new URL("../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

  it("imports bignumber.js and nothing else at run time, and so loads no file but itself", () => {
    expect(valueImports(read("domain/mpt.ts"))).toEqual(["bignumber.js"]);
    expect(staticClosure(appDir, "domain/mpt.ts")).toEqual(["domain/mpt.ts"]);
  });
});
