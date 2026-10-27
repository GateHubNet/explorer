// What an NFT's id says of itself, and how a URI is read (E8). Worker-only: it value-imports `ripple-address-codec` (the address of the issuer inside an id), so a page never
// imports it; the NFT page's builder, the fixture scripts and the tests do, and the page receives the words they make. Types are imported, and erased.

import { encodeAccountID } from "ripple-address-codec";

import type { NetworkId } from "../server/networks";

/** An NFT id is 32 bytes: 64 hex digits, in either case. */
const HEX_256 = /^[0-9a-fA-F]{64}$/;

/** What an XRPL `NFTokenID` encodes: `Flags (2) | TransferFee (2) | Issuer (20) | scrambled Taxon (4) | Sequence (4)` bytes. */
export interface DecodedNftId {
  flags: number;
  /** In 1/100000: 5000 is 5%. */
  transferFee: number;
  /** The classic address of the issuer. */
  issuer: string;
  /** The taxon as the id stores it. */
  scrambledTaxon: number;
  taxon: number;
  /** The id's sequence: the serial of the NFT among its issuer's mints. */
  serial: number;
}

/**
 * The taxon behind an id's scrambled one: `scrambled XOR ((384160001 × serial + 2459) mod 2^32)`, as rippled unscrambles it. The product is taken exactly, with `Math.imul` (the
 * low 32 bits of the product of two 32-bit values): a double product is past 2^53 for a serial above about 23 million and loses its low bits. `^` reads its operands as 32-bit
 * integers, so the sum needs no wrapping of its own, and `>>> 0` makes the result the unsigned number a taxon is.
 */
function unscrambleTaxon(scrambled: number, serial: number): number {
  return (scrambled ^ (Math.imul(384160001, serial) + 2459)) >>> 0;
}

/**
 * Splits an XRPL NFT id into the fields it encodes (D3's `decodeNFTokenId`, written again for the explorer). Throws a `RangeError` unless `id` is 64 hex digits, in either case.
 * A URIToken's id is no `NFTokenID`: it encodes nothing, and the Xahau pages do not decode it.
 */
export function decodeNftId(id: string): DecodedNftId {
  if (!HEX_256.test(id)) throw new RangeError("an NFT id must be 64 hex digits");
  const scrambledTaxon = parseInt(id.slice(48, 56), 16);
  const serial = parseInt(id.slice(56, 64), 16);
  const issuer = Uint8Array.from({ length: 20 }, (_, at) => parseInt(id.slice(8 + 2 * at, 10 + 2 * at), 16));
  return {
    flags: parseInt(id.slice(0, 4), 16),
    transferFee: parseInt(id.slice(4, 8), 16),
    issuer: encodeAccountID(issuer),
    scrambledTaxon,
    taxon: unscrambleTaxon(scrambledTaxon, serial),
    serial,
  };
}

/** One flag of an NFT: the bit of the id's (or the entry's) `flags`, its label in the details and its tag in the lists. */
export interface NftFlagLabel {
  mask: number;
  label: string;
  tag: string;
}

/**
 * The flags each network's NFTs carry, in the order the details list them: an XRPL id holds `lsfBurnable`, `lsfOnlyXRP`, `lsfTransferable` and `lsfMutable` (`lsfTrustLine`, 0x4, is
 * not shown), a Xahau URIToken the burnable flag alone.
 */
export const NFT_FLAG_LABELS: Record<NetworkId, readonly NftFlagLabel[]> = {
  xrpl: [
    { mask: 0x1, label: "Burnable by issuer", tag: "burnable" },
    { mask: 0x2, label: "Only XRP", tag: "only XRP" },
    { mask: 0x8, label: "Transferable", tag: "transferable" },
    { mask: 0x10, label: "Mutable URI", tag: "mutable" },
  ],
  xahau: [{ mask: 0x1, label: "Burnable by issuer", tag: "burnable" }],
};

/** Decodes bytes as UTF-8 and refuses what is not (a `TypeError`), instead of putting U+FFFD where a byte is wrong. */
const UTF8 = new TextDecoder("utf-8", { fatal: true });
/** A control character: C0 (U+0000 to U+001F), DEL and C1 (U+0080 to U+009F). */
const CONTROL = /\p{Cc}/u;
const HEX_BYTES = /^(?:[0-9a-fA-F]{2})*$/;

/**
 * A URI as the ledger holds it (hex) in the words the pages show: the hex decoded as UTF-8 with a fatal decoder, `decoded: true` only when it decodes and holds no control
 * character (C0, DEL or C1); otherwise the hex as given and `decoded: false`. An empty URI is `{ text: "", decoded: false }`, and so is a text that is no hex (an odd number of
 * digits, a character that is no digit) as it is given. The text is text: it is no link whatever it says (`javascript:alert(1);`, `ipfs://…`), and the pages do not make one or fetch
 * it.
 */
export function uriText(hex: string): { text: string; decoded: boolean } {
  if (hex === "" || !HEX_BYTES.test(hex)) return { text: hex, decoded: false };
  const bytes = Uint8Array.from({ length: hex.length / 2 }, (_, at) => parseInt(hex.slice(2 * at, 2 * at + 2), 16));
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    return { text: hex, decoded: false };
  }
  return CONTROL.test(text) ? { text: hex, decoded: false } : { text, decoded: true };
}
