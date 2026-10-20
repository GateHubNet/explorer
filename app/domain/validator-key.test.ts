import { codec, encodeNodePublic } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import { isNodePublicKey, parseValidatorKey } from "./validator-key";

/** A node public key made from a first byte and 32 bytes of 0x11. */
const keyOf = (first: number) => encodeNodePublic(Uint8Array.from([first, ...Array(32).fill(0x11)]));
const ED = keyOf(0xed);
const K02 = keyOf(0x02);
const K03 = keyOf(0x03);

const bytesOf = (hex: string) => Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16)); // no Buffer: app/ has no Node types

describe("parseValidatorKey", () => {
  it("accepts base58 master and signing keys", () => {
    expect(parseValidatorKey(ED)).toEqual({ key: ED });
    expect(parseValidatorKey(K02)).toEqual({ key: K02 });
    expect(parseValidatorKey(K03)).toEqual({ key: K03 });
  });

  it("answers a base58 key without a `from`, so a converted key is not converted again", () => {
    expect(parseValidatorKey(ED)).not.toHaveProperty("from");
    const converted = parseValidatorKey("ED" + "11".repeat(32));
    expect(parseValidatorKey(converted!.key)).toEqual({ key: converted!.key });
  });

  it.each([
    ["a wrong checksum", ED.slice(0, -1) + (ED.endsWith("a") ? "b" : "a")],
    ["a classic address", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"],
    ["a truncated key", ED.slice(0, 20)],
    ["a 32-byte key", codec.encode(new Uint8Array(32).fill(7), { versions: [0x1c], expectedLength: 32 })],
    ["a key with another first byte", keyOf(0x04)],
    ["a key with another version byte", codec.encode(Uint8Array.from([0xed, ...Array(32).fill(0x11)]), { versions: [0x23], expectedLength: 33 })],
    ["a key with spaces around it", ` ${ED} `],
    ["a character that is not base58", ED.slice(0, -1) + "0"],
    ["summary", "summary"],
    ["empty", ""],
  ])("refuses %s", (_, k) => expect(parseValidatorKey(k)).toBeNull());

  it.each(["02", "03", "ED"])("converts 66 hex with prefix %s in either case", (p) => {
    const bytes = bytesOf(p + "44".repeat(32));
    expect(parseValidatorKey((p + "44".repeat(32)).toLowerCase())).toEqual({ key: encodeNodePublic(bytes), from: "hex" });
    expect(parseValidatorKey(p + "44".repeat(32))).toEqual({ key: encodeNodePublic(bytes), from: "hex" });
  });

  it("converts a hex key to the base58 key it spells", () => {
    expect(parseValidatorKey("ED" + "11".repeat(32))).toEqual({ key: ED, from: "hex" });
    expect(parseValidatorKey("02" + "11".repeat(32))).toEqual({ key: K02, from: "hex" });
    expect(parseValidatorKey("03" + "11".repeat(32))).toEqual({ key: K03, from: "hex" });
  });

  it("refuses another prefix and 64 or 68 hex", () => {
    expect(parseValidatorKey("04" + "44".repeat(32))).toBeNull(); // another prefix
    expect(parseValidatorKey("00" + "44".repeat(32))).toBeNull();
    expect(parseValidatorKey("44".repeat(32))).toBeNull(); // 64 hex
    expect(parseValidatorKey("02" + "44".repeat(31))).toBeNull(); // 64 hex with a good prefix
    expect(parseValidatorKey("02" + "44".repeat(33))).toBeNull(); // 68 hex
    expect(parseValidatorKey("ED" + "44".repeat(33))).toBeNull();
  });

  it("refuses 66 characters that are not all hex digits", () => {
    expect(parseValidatorKey("02" + "44".repeat(31) + "4g")).toBeNull();
    expect(parseValidatorKey("02" + "44".repeat(31) + "44\n")).toBeNull();
  });
});

describe("isNodePublicKey", () => {
  it("is true for a base58 node public key whose first byte is 0x02, 0x03 or 0xED", () => {
    expect(isNodePublicKey(ED)).toBe(true);
    expect(isNodePublicKey(K02)).toBe(true);
    expect(isNodePublicKey(K03)).toBe(true);
  });

  it("is false for anything else, and never throws", () => {
    expect(isNodePublicKey(keyOf(0x04))).toBe(false);
    expect(isNodePublicKey("ED" + "11".repeat(32))).toBe(false); // hex is not base58
    expect(isNodePublicKey("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh")).toBe(false);
    expect(isNodePublicKey("")).toBe(false);
    expect(isNodePublicKey("n")).toBe(false);
    expect(isNodePublicKey("0OIl")).toBe(false);
  });
});
