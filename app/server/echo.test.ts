import { describe, expect, it } from "vitest";

import { ECHO_LENGTH, echoOf } from "./echo";

describe("echoOf", () => {
  it("quotes what was asked, escaped as JSON.stringify escapes a string", () => {
    expect(echoOf("rNotAnAddress")).toBe('"rNotAnAddress"');
    expect(echoOf('a"b\\c')).toBe('"a\\"b\\\\c"');
    // A C0 control is escaped, not dropped.
    expect(echoOf("a\u0001b")).toBe('"a\\u0001b"');
    expect(echoOf("")).toBe('""');
  });

  it("leaves out the bidi controls, which would reorder the sentence the echo is put in (U+202E among them)", () => {
    // `/xrpl/markets/%E2%80%AE…`: a right-to-left override would draw what follows it backwards.
    expect(echoOf("XRP/‮DSU.rhub")).toBe('"XRP/DSU.rhub"');
    for (const control of ["‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩", "‎", "‏", "​", "⁠", "﻿", "­"]) {
      expect(echoOf(`a${control}b`), control.codePointAt(0)!.toString(16)).toBe('"ab"');
    }
  });

  it("leaves out the C1 controls, U+0080 to U+009F", () => {
    expect(echoOf("a\u0085b\u009Bc\u0080d\u009Fe")).toBe('"abcde"');
    // U+00A0 is no control: it is kept.
    expect(echoOf("a b")).toBe('"a b"');
  });

  it("cuts what is left to 40 code points, between characters, after leaving the controls out", () => {
    expect(ECHO_LENGTH).toBe(40);
    expect(echoOf("z".repeat(100))).toBe(`"${"z".repeat(40)}"`);
    const smiley = "\u{1F600}";
    const echoed = JSON.parse(echoOf(`XRP/${smiley.repeat(50)}`)) as string;
    expect([...echoed]).toHaveLength(40);
    expect(echoed).toBe(`XRP/${smiley.repeat(36)}`);
    expect(echoed).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    // The controls do not count: 40 letters are shown whatever stood between them.
    expect(echoOf("‮a".repeat(50))).toBe(`"${"a".repeat(40)}"`);
  });

  it("cuts to the length it is given: the ledger's and the transaction's 80 keep a hash of 64 with a character too many whole", () => {
    const id = `${"A".repeat(64)}Z`;
    expect(id).toHaveLength(65);
    expect(echoOf(id, 80)).toBe(`"${id}"`);
    expect(echoOf("z".repeat(100), 80)).toBe(`"${"z".repeat(80)}"`);
    // The default is 40: the account's and the pair's.
    expect(echoOf(id)).toBe(`"${"A".repeat(40)}"`);
  });

  it("keeps the letters of any script, and the marks that belong to them", () => {
    expect(echoOf("مرحبا")).toBe('"مرحبا"');
    expect(echoOf("é")).toBe('"é"');
  });
});
