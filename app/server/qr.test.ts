import { describe, expect, it } from "vitest";

import { encodeQr, qrPath, type QrCode } from "./qr";

// The encoder was checked against two independent programs when it was written (neither is a dependency):
//
//  - qrencode 4.1.1 (`qrencode -8 -l M -m 0 -t ASCII`): the REFERENCE rows below are its output, and the encoder gives the same
//    modules, byte for byte, when it is told the mask qrencode chose (the two programs score masks by slightly different rules, so
//    on their own they pick another mask for about half the inputs, and any mask is a valid code).
//  - Apple's Vision framework (VNDetectBarcodesRequest), which decoded the code the encoder makes for 35 inputs, the two addresses
//    of the fixtures, a version 9 code of 180 bytes and non-ASCII text among them, back to the text it was given.

/** A code as one hex word per row (the leftmost module is the highest bit). */
const rowsOf = (code: QrCode): string[] =>
  code.modules.map((row) => parseInt(row.map((dark) => (dark ? "1" : "0")).join(""), 2).toString(16).padStart(Math.ceil(row.length / 4), "0"));

const dark = (code: QrCode, x: number, y: number) => code.modules[y]![x]!;

/** The 15 bits of the first copy of the format information, unmasked: 2 bits of error correction level, 3 of mask, 10 of BCH. */
function formatOf(code: QrCode, copy: 1 | 2): number {
  const { size } = code;
  const cells: Array<[number, number]> = [];
  if (copy === 1) {
    for (let i = 0; i <= 5; i += 1) cells.push([8, i]);
    cells.push([8, 7], [8, 8], [7, 8]);
    for (let i = 9; i < 15; i += 1) cells.push([14 - i, 8]);
  } else {
    for (let i = 0; i < 8; i += 1) cells.push([size - 1 - i, 8]);
    for (let i = 8; i < 15; i += 1) cells.push([8, size - 15 + i]);
  }
  return cells.reduce((bits, [x, y], i) => bits | ((dark(code, x, y) ? 1 : 0) << i), 0) ^ 0x5412;
}

/** Whether 15 bits are a codeword of the BCH(15,5) code of the format information (remainder 0 modulo 0x537). */
function validFormat(bits: number): boolean {
  let remainder = bits;
  for (let i = 14; i >= 10; i -= 1) if ((remainder >>> i) & 1) remainder ^= 0x537 << (i - 10);
  return remainder === 0;
}

const maskOf = (code: QrCode) => (formatOf(code, 1) >>> 10) & 7;

// Output of qrencode 4.1.1, see above.
const REFERENCE: Array<{ text: string; version: number; rows: string[] }> = [
  {
    text: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh",
    version: 3,
    rows: ["1fc6937f", "1048e041", "17429a5d", "1742e35d", "1744d05d", "1058c641", "1fd5557f", "00074800", "12dc35a0", "03966d40", "1fd20a42", "0d8c67df", "185032d9", "1d1f0d4a", "02541cd7", "0626c933", "08e5ebb8", "0527126a", "11598dff", "0417ab6a", "14f641f5", "00198511", "1fc8d55e", "10549317", "17414df5", "175f6752", "17470e19", "10491dc2", "1fd06bca"],
  },
  {
    text: "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto",
    version: 3,
    rows: ["1fd10c7f", "10461f41", "174ab95d", "1752745d", "1754d65d", "1056e341", "1fd5557f", "00144800", "1178e2f9", "1b370cd7", "05dee941", "011888c8", "15f1a2b9", "183ef935", "09f43975", "1c126a3b", "0ffadbad", "138934f4", "044ce1cd", "02aea92a", "1b52adf4", "0013f317", "1fdc2d59", "104a7f1a", "175cc3f8", "1745b4ad", "174c3047", "104d5cbb", "1fd5618a"],
  },
  {
    text: "hello",
    version: 1,
    rows: ["1fcc7f", "104c41", "17495d", "17465d", "174d5d", "105341", "1fd57f", "000300", "12d8a0", "058443", "03798d", "1d920b", "0d6550", "001a35", "1fc4ae", "1057b0", "174271", "175a2f", "174d15", "104cc0", "1fdf2a"],
  },
  {
    text: "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh?dt=104882",
    version: 4,
    rows: ["1fcccd77f", "104ee9441", "17539e05d", "175771d5d", "175e2c95d", "105035141", "1fd55557f", "001364b00", "17c6fc47c", "018f51ce9", "1fce24926", "1a1c40fbd", "026b06a15", "053df9fe0", "116606986", "032b57d55", "025b12e88", "049f7d240", "1b6f69416", "0204de32d", "197b13e18", "1029a43eb", "15fb39dea", "15a3609cc", "137dec3f3", "001313d10", "1fc674b52", "105f82f1d", "1758649fc", "1750f9d9d", "1753c6884", "104f97eac", "1fd58b12a"],
  },
  {
    text: "XVMgJSRJAMekfCw3mHHsRUbqYqWuZ2qXW7DhMWWpGmjhqyr",
    version: 4,
    rows: ["1fda9ae7f", "1055c7141", "1754d0a5d", "17487585d", "175338c5d", "1047baf41", "1fd55557f", "0005f0500", "13f949397", "0cb38ca7e", "006db0af9", "1f17861d7", "11d0aa15d", "03bec762d", "0462ef1c8", "1ab5d533d", "1ff5301cc", "118aab032", "08f46f6c5", "1e19330cf", "13e674d13", "1d838067f", "11d08f24f", "15236b2a7", "1ee9c91f8", "0017da91d", "1fd9aa358", "1056ddf1f", "175afaffd", "175594db9", "174b2e8df", "10444345f", "1fd1eab64"],
  },
];

// The fixture's two addresses are the ones the account page draws.
const ADDRESSES = ["rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto"];

describe("encodeQr", () => {
  it.each(REFERENCE)("makes the modules qrencode makes for $text, given its mask", ({ text, version, rows }) => {
    const reference = rows.map((row) => row);
    const referenceMask = (() => {
      // The mask qrencode chose, from its own format information.
      const modules = rows.map((row) => [...parseInt(row, 16).toString(2).padStart(row.length * 4, "0").slice(-(version * 4 + 17))].map((bit) => bit === "1"));
      return maskOf({ size: modules.length, modules });
    })();

    const code = encodeQr(text, { mask: referenceMask });
    expect(code.size).toBe(version * 4 + 17);
    expect(rowsOf(code)).toEqual(reference);
  });

  it("chooses the mask itself, and the same one every time", () => {
    for (const { text } of REFERENCE) {
      const first = encodeQr(text);
      expect(rowsOf(encodeQr(text))).toEqual(rowsOf(first));
      expect(maskOf(first)).toBeGreaterThanOrEqual(0);
    }
    // Where qrencode's scoring and the encoder's agree, so do the codes.
    expect(rowsOf(encodeQr(ADDRESSES[1]!))).toEqual(REFERENCE[1]!.rows);
  });

  it("takes the smallest version that holds the text: 14 bytes for version 1, 26 for 2, 42 for 3, 62 for 4, 180 for 9", () => {
    const sizeFor = (bytes: number) => encodeQr("x".repeat(bytes)).size;
    expect([1, 14].map(sizeFor)).toEqual([21, 21]);
    expect([15, 26].map(sizeFor)).toEqual([25, 25]);
    expect([27, 42].map(sizeFor)).toEqual([29, 29]);
    expect([43, 62].map(sizeFor)).toEqual([33, 33]);
    expect(sizeFor(63)).toBe(37);
    expect(sizeFor(180)).toBe(53);
    // An address is 25 to 35 characters: version 2 or 3.
    for (const length of [25, 26, 27, 34, 35]) expect([25, 29]).toContain(sizeFor(length));
  });

  it("reads the text as UTF-8 bytes, so that one character can be several", () => {
    expect(encodeQr("é".repeat(7)).size).toBe(21); // 14 bytes
    expect(encodeQr("é".repeat(8)).size).toBe(25); // 16 bytes
    expect(() => encodeQr("😀".repeat(46))).toThrow(RangeError); // 184 bytes
  });

  it("refuses more than version 9 holds, and a mask there is not", () => {
    expect(() => encodeQr("x".repeat(181))).toThrow(RangeError);
    expect(() => encodeQr("x", { mask: 8 })).toThrow(/mask/);
    expect(() => encodeQr("x", { mask: -1 })).toThrow(/mask/);
    expect(() => encodeQr("x", { mask: 1.5 })).toThrow(/mask/);
  });

  describe.each(ADDRESSES)("the code of %s", (address) => {
    const code = encodeQr(address);

    it("has the three finder patterns, with their separators", () => {
      const corners = [
        [0, 0],
        [code.size - 7, 0],
        [0, code.size - 7],
      ] as const;
      for (const [x0, y0] of corners) {
        for (let dy = 0; dy < 7; dy += 1) {
          for (let dx = 0; dx < 7; dx += 1) {
            const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
            expect(dark(code, x0 + dx, y0 + dy), `${x0},${y0}+${dx},${dy}`).toBe(ring !== 2);
          }
        }
      }
      // The light line beside the top left one.
      for (let i = 0; i < 8; i += 1) {
        expect(dark(code, 7, i)).toBe(false);
        expect(dark(code, i, 7)).toBe(false);
      }
    });

    it("has the timing patterns, the alignment pattern and the one dark module", () => {
      for (let i = 8; i < code.size - 8; i += 1) {
        expect(dark(code, i, 6)).toBe(i % 2 === 0);
        expect(dark(code, 6, i)).toBe(i % 2 === 0);
      }
      // Version 3: one alignment pattern, centred at (22, 22).
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) expect(dark(code, 22 + dx, 22 + dy)).toBe(Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
      expect(dark(code, 8, code.size - 8)).toBe(true);
    });

    it("has format information that says level M and a mask, twice, and is a codeword of the BCH code", () => {
      const first = formatOf(code, 1);
      expect(formatOf(code, 2)).toBe(first);
      expect(validFormat(first)).toBe(true);
      expect(first >>> 13).toBe(0); // level M is 00
    });
  });

  it("has format information that is a codeword for every mask, and the version bits of a version 7 code", () => {
    for (let mask = 0; mask < 8; mask += 1) {
      const code = encodeQr(ADDRESSES[0]!, { mask });
      expect(maskOf(code)).toBe(mask);
      expect(validFormat(formatOf(code, 1))).toBe(true);
      expect(formatOf(code, 2)).toBe(formatOf(code, 1));
    }
    // Version 7 has its version information in two 6x3 blocks, as 18 bits (7 << 12 | BCH): 0x07C94.
    const big = encodeQr("x".repeat(110)); // level M holds 106 bytes in version 6 and 122 in version 7
    expect(big.size).toBe(45);
    let bits = 0;
    for (let i = 0; i < 18; i += 1) {
      const a = big.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      expect(dark(big, a, b)).toBe(dark(big, b, a));
      bits |= (dark(big, a, b) ? 1 : 0) << i;
    }
    expect(bits).toBe(0x07c94);
  });
});

describe("qrPath", () => {
  it("draws exactly the dark modules, as rectangles one module high", () => {
    const code = encodeQr(ADDRESSES[0]!);
    const path = qrPath(code);
    expect(path).toMatch(/^M\d+ \d+h\d+v1h-\d+z(?:M\d+ \d+h\d+v1h-\d+z)*$/);

    const painted = Array.from({ length: code.size }, () => new Array<boolean>(code.size).fill(false));
    for (const [, x, y, width] of [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)].map((m) => m.map(Number))) {
      for (let i = 0; i < width!; i += 1) {
        expect(painted[y!]![x! + i]).toBe(false); // no module twice
        painted[y!]![x! + i] = true;
      }
    }
    expect(painted).toEqual(code.modules);
  });

  it("is small: a few hundred bytes for an address", () => {
    expect(qrPath(encodeQr(ADDRESSES[0]!)).length).toBeLessThan(3000);
  });

  it("is empty for a code with no dark module", () => {
    expect(qrPath({ size: 2, modules: [[false, false], [false, false]] })).toBe("");
  });
});
