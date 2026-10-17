import { describe, expect, it } from "vitest";

import { resultText } from "./results";

describe("resultText", () => {
  it("says a success is final", () => {
    expect(resultText("tesSUCCESS")).toEqual({
      ok: true,
      text: "The transaction was applied and is final.",
    });
  });

  it("explains a known tec code in plain language", () => {
    expect(resultText("tecPATH_DRY")).toEqual({
      ok: false,
      text: "No path had enough liquidity to deliver the amount.",
    });
  });

  it.each([
    "tecPATH_DRY",
    "tecPATH_PARTIAL",
    "tecUNFUNDED_OFFER",
    "tecUNFUNDED_PAYMENT",
    "tecNO_DST",
    "tecNO_DST_INSUF_XRP",
    "tecNO_LINE",
    "tecINSUF_RESERVE_LINE",
    "tecINSUF_RESERVE_OFFER",
    "tecKILLED",
    "tecNO_PERMISSION",
    "tecDST_TAG_NEEDED",
    "tecEXPIRED",
    "tecHAS_OBLIGATIONS",
    "tecOVERSIZE",
    "tecAMM_BALANCE",
    "tecAMM_FAILED",
  ])("has its own sentence for %s", (code) => {
    const { ok, text } = resultText(code);
    expect(ok).toBe(false);
    expect(text.length).toBeGreaterThan(10);
    // A specific sentence, not the class fallback.
    expect(text).not.toContain(`tec code ${code}`);
    expect(text).not.toBe(resultText("tecNOT_A_REAL_CODE").text);
    // Plain language ends like a sentence.
    expect(text.endsWith(".")).toBe(true);
  });

  it("falls back to the class sentence for an unknown tec code", () => {
    expect(resultText("tecFOO")).toEqual({
      ok: false,
      text: "Failed, but the fee was charged (tec code tecFOO).",
    });
  });

  it.each(["tefBAR", "telX", "temX", "terX"])(
    "says an unknown %s code was not applied",
    (code) => {
      const { ok, text } = resultText(code);
      expect(ok).toBe(false);
      expect(text).toContain("was not applied");
      expect(text).toContain(code);
    },
  );

  it("gives each class its own sentence", () => {
    const sentences = ["tefBAR", "telX", "temX", "terX", "tecFOO"].map((c) => resultText(c).text);
    expect(new Set(sentences).size).toBe(5);
  });

  it("treats an unknown tes code as applied", () => {
    expect(resultText("tesFOO")).toEqual({
      ok: true,
      text: "The transaction was applied (tes code tesFOO).",
    });
  });

  it("does not claim to know a code of no class", () => {
    expect(resultText("whatever")).toEqual({ ok: false, text: "Unknown result code whatever." });
    expect(resultText("")).toEqual({ ok: false, text: "Unknown result code." });
  });

  it("is case sensitive: result codes are not", () => {
    expect(resultText("TESSUCCESS").ok).toBe(false);
  });
});
