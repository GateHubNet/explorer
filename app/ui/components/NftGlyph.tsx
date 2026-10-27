import { cx } from "../cx";

/**
 * The two characters in the box that stands in front of a collection or an NFT (the board's glyph). It is decoration, `aria-hidden`: the NFT or the collection is named
 * beside it. `large` is the collection's header card.
 */
export function NftGlyph({ chars, large }: { chars: string; large?: boolean }) {
  return (
    <span className={cx("nft-glyph", large && "nft-glyph--large")} aria-hidden="true">
      {chars}
    </span>
  );
}

/** A collection's glyph: its issuer's characters 2 and 3 (`LU` of `rLULtF…`; the box draws them in capitals). */
export function collectionGlyph(issuer: string): string {
  return issuer.slice(1, 3);
}

/** An NFT's glyph: its serial's last two digits, zero-padded (`27` of 4,127; `05` of 5), and for an NFT without a serial (a URIToken) the id's first two characters. */
export function nftGlyph(id: string, serial?: number): string {
  return serial === undefined ? id.slice(0, 2) : String(serial).padStart(2, "0").slice(-2);
}
