import { decodeAccountID } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import { allTxs, type FixtureSet } from "../../test/support/ledgers";
import { NFT_FLAG_LABELS, decodeNftId, uriText } from "./nft-id";
import type { TxMeta } from "./parse/types";

/** An id of the mainnet (Clio `nft_info` of `s1.ripple.com`, 2026-10-24; D3's recorded id): flags 8, fee 5000, taxon 500, serial 106293080. */
const RECORDED_ID = "00081388AF09C1D4B4D1E8031467F3508DFFADABEA73255FA9ECC9070655E758";
const RECORDED_ISSUER = "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu";
const ISSUER = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";

const hex = (n: number, digits: number) => n.toString(16).toUpperCase().padStart(digits, "0");
const bytesOf = (text: string) => Array.from(new TextEncoder().encode(text), (byte) => hex(byte, 2)).join("");

/** An id written from its fields, with the taxon scrambled by the exact integer formula (BigInt), not by the code under test. */
function idOf(f: { flags: number; transferFee: number; issuer: string; taxon: number; serial: number }): string {
  const issuer = Array.from(decodeAccountID(f.issuer), (byte) => hex(byte, 2)).join("");
  const scrambled = Number(BigInt(f.taxon) ^ ((384160001n * BigInt(f.serial) + 2459n) % 2n ** 32n));
  return `${hex(f.flags, 4)}${hex(f.transferFee, 4)}${issuer}${hex(scrambled, 8)}${hex(f.serial, 8)}`;
}

describe("decodeNftId", () => {
  it("decodes a recorded id", () => {
    expect(decodeNftId(RECORDED_ID)).toEqual({
      flags: 8,
      transferFee: 5000,
      issuer: RECORDED_ISSUER,
      scrambledTaxon: 0xa9ecc907,
      taxon: 500,
      serial: 106293080,
    });
  });

  it("reads the id in any case, as the same NFT", () => {
    expect(decodeNftId(RECORDED_ID.toLowerCase())).toEqual(decodeNftId(RECORDED_ID));
  });

  it("unscrambles exactly for a serial above 2^24, where the product is past 2^53 and a double product is off by a few units", () => {
    const { scrambledTaxon, serial, taxon } = decodeNftId(RECORDED_ID);
    expect(serial).toBeGreaterThan(2 ** 24);
    expect(384160001 * serial).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    const inexact = (scrambledTaxon ^ ((384160001 * serial + 2459) % 2 ** 32)) >>> 0;
    expect(inexact).not.toBe(500);
    expect(taxon).toBe(500);
  });

  it("unscrambles as the exact integer formula for serials and taxons of every size", () => {
    for (const serial of [0, 1, 2, 2 ** 24 - 1, 2 ** 24, 2 ** 24 + 1, 23_456_789, 106293080, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1]) {
      for (const taxon of [0, 1, 500, 589, 0x7fffffff, 0x80000000, 4294967294, 4294967295]) {
        const decoded = decodeNftId(idOf({ flags: 8, transferFee: 5000, issuer: ISSUER, taxon, serial }));
        expect([serial, taxon, decoded.taxon, decoded.serial]).toEqual([serial, taxon, taxon, serial]);
      }
    }
  });

  it("gives a taxon that is an unsigned number: the high bit does not make it negative", () => {
    const decoded = decodeNftId(idOf({ flags: 0, transferFee: 0, issuer: ISSUER, taxon: 4294967295, serial: 7 }));
    expect(decoded.taxon).toBe(4294967295);
    expect(decoded.scrambledTaxon).toBeGreaterThanOrEqual(0);
  });

  it("splits the fields at their bytes: flags 2, transfer fee 2, issuer 20, scrambled taxon 4, sequence 4", () => {
    expect(decodeNftId("0".repeat(64))).toEqual({
      flags: 0,
      transferFee: 0,
      issuer: "rrrrrrrrrrrrrrrrrrrrrhoLvTp",
      scrambledTaxon: 0,
      taxon: 2459,
      serial: 0,
    });
    const full = decodeNftId("F".repeat(64));
    expect(full).toMatchObject({ flags: 65535, transferFee: 65535, scrambledTaxon: 4294967295, serial: 4294967295 });
    expect(full.issuer).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
    const fields = { flags: 0x0a, transferFee: 11000, issuer: ISSUER, taxon: 589, serial: 1234 };
    expect(decodeNftId(idOf(fields))).toMatchObject(fields);
  });

  it("refuses an id that is not 64 hex digits, with a RangeError", () => {
    for (const bad of [
      RECORDED_ID.slice(1),
      `${RECORDED_ID}0`,
      `0x${RECORDED_ID.slice(2)}`,
      `G${RECORDED_ID.slice(1)}`,
      ` ${RECORDED_ID.slice(1)}`,
      `${RECORDED_ID}\n`,
      "",
      "1".repeat(48),
      "1".repeat(1000),
    ]) {
      expect(() => decodeNftId(bad)).toThrow(RangeError);
    }
  });

  it("does not put what it refuses in its message: the text may be long and is not the caller's to show", () => {
    expect(() => decodeNftId("x".repeat(500))).toThrow(/64 hex digits/);
    try {
      decodeNftId("x".repeat(500));
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(100);
    }
  });
});

describe("every NFTokenMint of the recorded XRPL ledgers", () => {
  const SETS: FixtureSet[] = ["xrpl", "xrpl-amm", "xrpl-extra"];

  /** The ids a transaction added to the ledger: those the NFTokenPage nodes hold after it and none held before it (D3 2.1; a page split moves ids, it adds none). */
  function addedIds(meta: TxMeta): string[] {
    const before = new Set<string>();
    const after = new Set<string>();
    const idsOf = (fields: Record<string, unknown> | undefined) =>
      ((fields?.NFTokens ?? []) as { NFToken: { NFTokenID: string } }[]).map((entry) => entry.NFToken.NFTokenID);
    for (const node of meta.AffectedNodes) {
      const body = Object.values(node)[0]!;
      if (body.LedgerEntryType !== "NFTokenPage") continue;
      if ("CreatedNode" in node) {
        idsOf(body.NewFields).forEach((id) => after.add(id));
      } else if ("ModifiedNode" in node) {
        idsOf(body.FinalFields).forEach((id) => after.add(id));
        idsOf(body.PreviousFields?.NFTokens === undefined ? body.FinalFields : body.PreviousFields).forEach((id) => before.add(id));
      } else {
        idsOf(body.FinalFields).forEach((id) => before.add(id));
      }
    }
    return [...after].filter((id) => !before.has(id));
  }

  const mints = SETS.flatMap((set) =>
    allTxs(set).filter(({ tx, meta }) => tx.TransactionType === "NFTokenMint" && meta.TransactionResult === "tesSUCCESS"),
  );

  it("are in the recordings: the test is not empty", () => {
    expect(mints.length).toBeGreaterThanOrEqual(6);
  });

  it("each add one NFT, whose id decodes to the mint's taxon, transfer fee, issuer and flags", () => {
    for (const { tx, meta } of mints) {
      const ids = addedIds(meta);
      expect([tx.hash, ids.length]).toEqual([tx.hash, 1]);
      const decoded = decodeNftId(ids[0]!);
      expect([tx.hash, decoded.taxon]).toEqual([tx.hash, tx.NFTokenTaxon]);
      expect([tx.hash, decoded.transferFee]).toEqual([tx.hash, (tx.TransferFee as number | undefined) ?? 0]);
      expect([tx.hash, decoded.issuer]).toEqual([tx.hash, (tx.Issuer as string | undefined) ?? tx.Account]);
      expect([tx.hash, decoded.flags]).toEqual([tx.hash, ((tx.Flags as number | undefined) ?? 0) & 0xffff]);
      expect(decoded.serial).toBeGreaterThan(0);
      expect(decoded.scrambledTaxon).not.toBe(decoded.taxon);
    }
  });

  it("have a URI that uriText decodes to the text of an ipfs link", () => {
    for (const { tx } of mints) {
      const uri = tx.URI as string;
      const { text, decoded } = uriText(uri);
      expect([tx.hash, decoded]).toEqual([tx.hash, true]);
      expect(text).toMatch(/^ipfs:\/\/\w+/);
      expect(bytesOf(text)).toBe(uri);
    }
  });
});

describe("uriText", () => {
  it("decodes the hex of a URI as UTF-8 text", () => {
    expect(uriText("697066733A2F2F6261667962656963696A356672347537666F7975623537")).toEqual({ text: "ipfs://bafybeicij5fr4u7foyub57", decoded: true });
    expect(uriText(bytesOf("https://example.com/a?b=c&d=é"))).toEqual({ text: "https://example.com/a?b=c&d=é", decoded: true });
  });

  it("gives text and nothing more for a text that looks like a link or a script: the pages decide that it is shown as text and never fetched", () => {
    expect(uriText("6A6176617363726970743A616C6572742831293B")).toEqual({ text: "javascript:alert(1);", decoded: true });
    expect(uriText(bytesOf("<script>alert(1)</script>"))).toEqual({ text: "<script>alert(1)</script>", decoded: true });
    expect(uriText(bytesOf("data:text/html;base64,PHNjcmlwdD4="))).toEqual({ text: "data:text/html;base64,PHNjcmlwdD4=", decoded: true });
  });

  it("decodes multi-byte text", () => {
    expect(uriText("C3A9")).toEqual({ text: "é", decoded: true });
    expect(uriText("E282AC")).toEqual({ text: "€", decoded: true });
    expect(uriText("F09F9880")).toEqual({ text: "\u{1F600}", decoded: true });
  });

  it("gives the hex as it was given, not decoded, for bytes that are not UTF-8", () => {
    expect(uriText("00FF10")).toEqual({ text: "00FF10", decoded: false });
    expect(uriText("FF")).toEqual({ text: "FF", decoded: false });
    expect(uriText("C328")).toEqual({ text: "C328", decoded: false });
    expect(uriText("E282")).toEqual({ text: "E282", decoded: false });
    expect(uriText("C080")).toEqual({ text: "C080", decoded: false });
    expect(uriText("EDA080")).toEqual({ text: "EDA080", decoded: false });
    expect(uriText("F4908080")).toEqual({ text: "F4908080", decoded: false });
  });

  it("gives the hex, not decoded, for text with a control character: C0, DEL or C1", () => {
    expect(uriText("00")).toEqual({ text: "00", decoded: false });
    expect(uriText("410A42")).toEqual({ text: "410A42", decoded: false });
    expect(uriText("41094255")).toEqual({ text: "41094255", decoded: false });
    expect(uriText("411B5B31")).toEqual({ text: "411B5B31", decoded: false });
    expect(uriText("1F")).toEqual({ text: "1F", decoded: false });
    expect(uriText("417F42")).toEqual({ text: "417F42", decoded: false });
    expect(uriText("C285")).toEqual({ text: "C285", decoded: false });
    expect(uriText("C29F")).toEqual({ text: "C29F", decoded: false });
  });

  it("gives the hex, not decoded, for text that is not printable: a format character, a line or paragraph separator", () => {
    // U+202E is a right-to-left override: it would show what follows it reversed. U+200B is a zero-width space, U+2028 and U+2029 are line and paragraph separators.
    expect(uriText("E280AE")).toEqual({ text: "E280AE", decoded: false });
    expect(uriText("E2808B")).toEqual({ text: "E2808B", decoded: false });
    expect(uriText("E280A8")).toEqual({ text: "E280A8", decoded: false });
    expect(uriText("E280A9")).toEqual({ text: "E280A9", decoded: false });
    expect(uriText("E2808E")).toEqual({ text: "E2808E", decoded: false });
    expect(uriText("C2AD")).toEqual({ text: "C2AD", decoded: false });
    expect(uriText("E2808D")).toEqual({ text: "E2808D", decoded: false });
    const hexOfSpoof = bytesOf("ipfs://a") + "E280AE" + bytesOf("gpj.exe");
    expect(uriText(hexOfSpoof)).toEqual({ text: hexOfSpoof, decoded: false });
  });

  it("keeps a leading byte order mark in the bytes it decodes, and so gives the hex: the text would not match the ledger's bytes", () => {
    // EF BB BF is U+FEFF, which a decoder strips from the start of its input by default: "ipfs://x" would then stand for bytes it does not equal.
    expect(uriText("EFBBBF697066733A2F2F78")).toEqual({ text: "EFBBBF697066733A2F2F78", decoded: false });
    expect(uriText("EFBBBF")).toEqual({ text: "EFBBBF", decoded: false });
    expect(uriText("41EFBBBF42")).toEqual({ text: "41EFBBBF42", decoded: false });
    expect(uriText("efbbbf697066733a2f2f78")).toEqual({ text: "efbbbf697066733a2f2f78", decoded: false });
  });

  it("decodes the characters next to the controls: a space, U+00A0 and U+00A1", () => {
    expect(uriText("20")).toEqual({ text: " ", decoded: true });
    expect(uriText("C2A0")).toEqual({ text: " ", decoded: true });
    expect(uriText("C2A1")).toEqual({ text: "¡", decoded: true });
    expect(uriText("7E")).toEqual({ text: "~", decoded: true });
    // a combining mark and a variation selector are marks (Mn), not format characters
    expect(uriText("65CC81")).toEqual({ text: "e\u0301", decoded: true });
    expect(uriText("E29D8CEFB88F")).toEqual({ text: "\u274c\ufe0f", decoded: true });
  });

  it("decodes a URI of the longest length, 256 bytes", () => {
    const text = `ipfs://${"a".repeat(249)}`;
    expect(text).toHaveLength(256);
    expect(uriText(bytesOf(text))).toEqual({ text, decoded: true });
    const wide = "é".repeat(128);
    expect(uriText(bytesOf(wide))).toEqual({ text: wide, decoded: true });
  });

  it("gives an empty text for an empty URI, not decoded", () => {
    expect(uriText("")).toEqual({ text: "", decoded: false });
  });

  it("reads the hex in either case and gives it back as it was given", () => {
    expect(uriText("6a6176617363726970743a616c6572742831293b")).toEqual({ text: "javascript:alert(1);", decoded: true });
    expect(uriText("00ff10")).toEqual({ text: "00ff10", decoded: false });
    expect(uriText("c3a9")).toEqual({ text: "é", decoded: true });
  });

  it("gives what is no hex as it was given, not decoded: an odd number of digits, or a character that is no digit", () => {
    expect(uriText("ABC")).toEqual({ text: "ABC", decoded: false });
    expect(uriText("4")).toEqual({ text: "4", decoded: false });
    expect(uriText("ZZ")).toEqual({ text: "ZZ", decoded: false });
    expect(uriText("41 42")).toEqual({ text: "41 42", decoded: false });
    expect(uriText("0x4142")).toEqual({ text: "0x4142", decoded: false });
    expect(uriText("4142\n")).toEqual({ text: "4142\n", decoded: false });
  });
});

describe("NFT_FLAG_LABELS", () => {
  it("has the flags an XRPL id carries, with the label of the details and the tag of the lists", () => {
    expect(NFT_FLAG_LABELS.xrpl).toEqual([
      { mask: 0x1, label: "Burnable by issuer", tag: "burnable" },
      { mask: 0x2, label: "Only XRP", tag: "only XRP" },
      { mask: 0x8, label: "Transferable", tag: "transferable" },
      { mask: 0x10, label: "Mutable URI", tag: "mutable" },
    ]);
  });

  it("has the one flag a URIToken carries", () => {
    expect(NFT_FLAG_LABELS.xahau).toEqual([{ mask: 0x1, label: "Burnable by issuer", tag: "burnable" }]);
  });

  it("is for the two networks, and nothing else", () => {
    expect(Object.keys(NFT_FLAG_LABELS).sort()).toEqual(["xahau", "xrpl"]);
  });

  it("has a single bit for each mask, and none twice", () => {
    for (const labels of Object.values(NFT_FLAG_LABELS)) {
      const masks = labels.map(({ mask }) => mask);
      expect(new Set(masks).size).toBe(masks.length);
      for (const mask of masks) expect(mask & (mask - 1)).toBe(0);
    }
  });

  it("names the flags a decoded id has", () => {
    const flagsOf = (flags: number) => NFT_FLAG_LABELS.xrpl.filter(({ mask }) => (flags & mask) !== 0).map(({ tag }) => tag);
    expect(flagsOf(decodeNftId(RECORDED_ID).flags)).toEqual(["transferable"]);
    expect(flagsOf(0x0a)).toEqual(["only XRP", "transferable"]);
    expect(flagsOf(0x1b)).toEqual(["burnable", "only XRP", "transferable", "mutable"]);
    expect(flagsOf(0)).toEqual([]);
  });
});
