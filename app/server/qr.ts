// A QR code encoder, small enough to read in one sitting, for the account page's QR code of an address. Worker-only code: it
// is imported by the view builder, and the page gets the finished picture (`qrPath`) as data, so no encoder reaches the
// browser bundle. No I/O.
//
// What it does: byte mode (the text as UTF-8), error correction level M (15% of the codewords can be lost), versions 1 to 9
// (up to 21 + 4 * 8 = 53 modules a side; 180 bytes with level M). That is far more than an address needs: 25 to 35 characters
// are version 2 or 3. A longer text throws a `RangeError`.
//
// The method is the standard one (ISO/IEC 18004), as in Project Nayuki's QR Code generator, whose structure this follows:
// function patterns, the data and its Reed-Solomon codewords interleaved by block, placed in a zigzag, and the mask of the eight
// with the lowest penalty. app/server/qr.test.ts checks the structure and decodes what it makes with a decoder of its own.

export interface QrCode {
  /** Modules per side. */
  size: number;
  /** `modules[y][x]` is true for a dark module; no quiet zone. */
  modules: boolean[][];
}

const MAX_VERSION = 9;
/** Error correction codewords per block, and the number of blocks, by version, for level M (index 0 is unused). */
const ECC_CODEWORDS_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5];
/** The two bits level M puts in the format information. */
const FORMAT_BITS_M = 0;

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

const bit = (value: number, index: number): boolean => ((value >>> index) & 1) !== 0;

/** The codewords (bytes) of a version that carry data, once the error correction ones are taken out. */
function dataCodewords(version: number): number {
  return rawCodewords(version) - ECC_CODEWORDS_PER_BLOCK[version]! * NUM_BLOCKS[version]!;
}

/** All the codewords of a version: the modules that are not function patterns, in whole bytes. */
function rawCodewords(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    modules -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) modules -= 36;
  }
  return Math.floor(modules / 8);
}

/** The positions (rows and columns) of the alignment patterns of a version, ascending. */
function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let position = size - 7; positions.length < count; position -= step) positions.splice(1, 0, position);
  return positions;
}

// ---- Reed-Solomon over GF(2^8) with x^8 + x^4 + x^3 + x^2 + 1 -------------------------------------------------------------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** The coefficients (without the leading 1) of the product of (x - 2^0) ... (x - 2^(degree-1)). */
function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] = result[i]! ^ gfMultiply(coefficient, factor);
    });
  }
  return result;
}

// ---- The data ---------------------------------------------------------------------------------------------------------

/** The data codewords of `bytes` in byte mode: mode, count, bytes, terminator, then the pad bytes 0xEC and 0x11. */
function dataBits(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8); // 8 bits count characters in versions 1 to 9
  for (const byte of bytes) push(byte, 8);

  const capacityBits = dataCodewords(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  return codewords;
}

/** The data codewords with their error correction codewords, split into blocks and interleaved. */
function withErrorCorrection(data: readonly number[], version: number): number[] {
  const blocks = NUM_BLOCKS[version]!;
  const eccLength = ECC_CODEWORDS_PER_BLOCK[version]!;
  const raw = rawCodewords(version);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);

  const divisor = reedSolomonDivisor(eccLength);
  const all: number[][] = [];
  for (let i = 0, start = 0; i < blocks; i += 1) {
    const part = data.slice(start, start + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    start += part.length;
    const ecc = reedSolomonRemainder(part, divisor);
    // A short block gets a placeholder where the long ones have their extra data byte; it is skipped when interleaving.
    if (i < shortBlocks) part.push(0);
    all.push([...part, ...ecc]);
  }

  const result: number[] = [];
  for (let i = 0; i < all[0]!.length; i += 1) {
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

// ---- The matrix -------------------------------------------------------------------------------------------------------

class Matrix {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  private setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.isFunction[y]![x] = true;
  }

  drawFunctionPatterns(): void {
    const { size } = this;
    for (let i = 0; i < size; i += 1) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(size - 4, 3);
    this.finder(3, size - 4);

    const positions = alignmentPositions(this.version, size);
    const last = positions.length - 1;
    for (let i = 0; i <= last; i += 1) {
      for (let j = 0; j <= last; j += 1) {
        // Not on top of a finder pattern.
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        this.alignment(positions[i]!, positions[j]!);
      }
    }
    // The format bits are written for real once the mask is known; this reserves their modules.
    this.formatBits(0);
    this.versionBits();
  }

  private finder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && px < this.size && py >= 0 && py < this.size) this.setFunction(px, py, distance !== 2 && distance !== 4);
      }
    }
  }

  private alignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) this.setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  /** The 15 format bits (level M, `mask`), in their two places, and the one dark module. */
  formatBits(mask: number): void {
    const { size } = this;
    const data = (FORMAT_BITS_M << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;

    for (let i = 0; i <= 5; i += 1) this.setFunction(8, i, bit(bits, i));
    this.setFunction(8, 7, bit(bits, 6));
    this.setFunction(8, 8, bit(bits, 7));
    this.setFunction(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i += 1) this.setFunction(14 - i, 8, bit(bits, i));

    for (let i = 0; i < 8; i += 1) this.setFunction(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i += 1) this.setFunction(8, size - 15 + i, bit(bits, i));
    this.setFunction(8, size - 8, true);
  }

  /** The 18 version bits of versions 7 and up. */
  private versionBits(): void {
    if (this.version < 7) return;
    let remainder = this.version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (this.version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const dark = bit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  /** Puts the codewords in the modules that are not function patterns, two columns at a time from the right, up and down. */
  placeCodewords(codewords: readonly number[]): void {
    const { size } = this;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      // The vertical timing pattern is in column 6: the columns after it are shifted by one.
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!this.isFunction[y]![x] && i < codewords.length * 8) {
            this.modules[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
            i += 1;
          }
          // Modules left over (remainder bits) stay light.
        }
      }
    }
  }

  /** Flips the data modules the mask selects; applying a mask twice undoes it. */
  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!this.isFunction[y]![x] && invert) this.modules[y]![x] = !this.modules[y]![x];
      }
    }
  }

  /** How badly the pattern would scan (ISO 18004, 8.8.2): runs, 2x2 blocks, finder-like patterns, balance of dark and light. */
  penalty(): number {
    const { size, modules } = this;
    let result = 0;

    const lines = (at: (line: number, index: number) => boolean) => {
      for (let line = 0; line < size; line += 1) {
        let runColor = false;
        let runLength = 0;
        const history = [0, 0, 0, 0, 0, 0, 0];
        for (let index = 0; index < size; index += 1) {
          const color = at(line, index);
          if (color === runColor) {
            runLength += 1;
            if (runLength === 5) result += PENALTY_N1;
            else if (runLength > 5) result += 1;
          } else {
            addHistory(runLength, history, size);
            if (!runColor) result += countFinderLike(history) * PENALTY_N3;
            runColor = color;
            runLength = 1;
          }
        }
        // The line ends at the quiet zone, which is light.
        if (runColor) {
          addHistory(runLength, history, size);
          runLength = 0;
        }
        runLength += size;
        addHistory(runLength, history, size);
        result += countFinderLike(history) * PENALTY_N3;
      }
    };
    lines((y, x) => modules[y]![x]!);
    lines((x, y) => modules[y]![x]!);

    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const color = modules[y]![x];
        if (color === modules[y]![x + 1] && color === modules[y + 1]![x] && color === modules[y + 1]![x + 1]) result += PENALTY_N2;
      }
    }

    let dark = 0;
    for (const row of modules) for (const module of row) if (module) dark += 1;
    const total = size * size;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * PENALTY_N4;
    return result;
  }
}

/** Pushes a run on the history of the last seven; the first run of a line has the quiet zone's light before it. */
function addHistory(runLength: number, history: number[], size: number): void {
  const length = history[0] === 0 ? runLength + size : runLength;
  history.pop();
  history.unshift(length);
}

/** How many times the runs in `history` (newest first) are a finder-like 1:1:3:1:1 pattern with four light modules beside it. */
function countFinderLike(history: readonly number[]): number {
  const n = history[1]!;
  const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  return (core && history[0]! >= n * 4 && history[6]! >= n ? 1 : 0) + (core && history[6]! >= n * 4 && history[0]! >= n ? 1 : 0);
}

/**
 * The QR code of `text` (UTF-8, byte mode, error correction level M), in the smallest version it fits. Throws a `RangeError`
 * for a text of more than 180 bytes. `options.mask` (0 to 7) forces the mask instead of choosing the one with the lowest penalty;
 * for tests, which compare the result with another encoder's.
 */
export function encodeQr(text: string, options: { mask?: number } = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  // The mode (4 bits) and the count (8) come before the bytes.
  while (version <= MAX_VERSION && 4 + 8 + bytes.length * 8 > dataCodewords(version) * 8) version += 1;
  if (version > MAX_VERSION) throw new RangeError(`${bytes.length} bytes do not fit a QR code of version ${MAX_VERSION}`);

  const matrix = new Matrix(version);
  matrix.drawFunctionPatterns();
  matrix.placeCodewords(withErrorCorrection(dataBits(bytes, version), version));

  if (options.mask !== undefined && !(Number.isInteger(options.mask) && options.mask >= 0 && options.mask < 8)) {
    throw new RangeError(`${options.mask} is not a QR mask (0 to 7)`);
  }
  let best = options.mask ?? 0;
  if (options.mask === undefined) {
    let lowest = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask += 1) {
      matrix.applyMask(mask);
      matrix.formatBits(mask);
      const penalty = matrix.penalty();
      if (penalty < lowest) {
        best = mask;
        lowest = penalty;
      }
      matrix.applyMask(mask);
    }
  }
  matrix.applyMask(best);
  matrix.formatBits(best);
  return { size: matrix.size, modules: matrix.modules };
}

/**
 * The code as an SVG path (`d` of a `<path>`) in module units: one `M x y h n v1 h-n z` rectangle for each horizontal run of dark
 * modules, so the picture is a few hundred bytes. Draw it in a `viewBox` of `-4 -4 size+8 size+8` for the quiet zone the standard
 * asks for.
 */
export function qrPath(code: QrCode): string {
  const parts: string[] = [];
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; ) {
      if (!code.modules[y]![x]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < code.size && code.modules[y]![end]) end += 1;
      parts.push(`M${x} ${y}h${end - x}v1h${x - end}z`);
      x = end;
    }
  }
  return parts.join("");
}
