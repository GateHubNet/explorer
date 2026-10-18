// A PNG decoder for the tests of the link-preview images: enough of the format (8-bit grey, RGB and RGBA, no interlacing) to read the
// size and the colour of any pixel of what resvg draws. Not for the app: the Worker only writes PNGs.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface Png {
  width: number;
  height: number;
  /** The colour of a pixel, `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];
}

/** The size in the IHDR chunk, after checking the signature: the cheap check that an answer is a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || SIGNATURE.some((byte, i) => bytes[i] !== byte)) throw new Error("not a PNG: wrong signature");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = String.fromCharCode(...bytes.slice(12, 16));
  if (type !== "IHDR") throw new Error(`not a PNG: the first chunk is ${type}`);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodePng(bytes: Uint8Array): Promise<Png> {
  const { width, height } = pngSize(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlace = bytes[28];
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported PNG: ${bitDepth}-bit, interlace ${interlace}`);
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType!];
  if (channels === undefined) throw new Error(`unsupported PNG colour type ${colorType}`);

  const chunks: Uint8Array[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.slice(at + 4, at + 8));
    if (type === "IDAT") chunks.push(bytes.slice(at + 8, at + 8 + length));
    if (type === "IEND") break;
    at += 12 + length;
  }
  const compressed = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  const raw = await inflate(compressed);

  // Undo the scanline filters.
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? pixels[y * stride + i - channels]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i]! : 0;
      const upLeft = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
      pixels[y * stride + i] = (line[i]! + predicted) & 0xff;
    }
  }

  return {
    width,
    height,
    pixel(x, y) {
      const at = y * stride + x * channels;
      if (channels === 1) return [pixels[at]!, pixels[at]!, pixels[at]!, 255];
      if (channels === 2) return [pixels[at]!, pixels[at]!, pixels[at]!, pixels[at + 1]!];
      return [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!, channels === 4 ? pixels[at + 3]! : 255];
    },
  };
}

/** `#RRGGBB` of a pixel. */
export function hex([r, g, b]: [number, number, number, number]): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
