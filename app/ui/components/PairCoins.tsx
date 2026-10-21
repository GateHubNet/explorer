import { cx } from "../cx";

/** The first three characters of a currency's display code, in a coin. */
const coinText = (code: string) => [...code].slice(0, 3).join("");

/**
 * The two coins of an AMM pool's pair (the pools list's rows, the pool page's card): each the first three characters of its display code, the second
 * overlapping the first. They are decorative, `aria-hidden`: the pair is said in full beside them. `className` sizes them (the pool page's are the board's 34 px).
 */
export function PairCoins({ codes, className }: { codes: readonly string[]; className?: string }) {
  return (
    <span className={cx("amm__coins", className)} aria-hidden="true">
      {codes.map((code, at) => (
        <span key={at} className="amm__coin">
          {coinText(code)}
        </span>
      ))}
    </span>
  );
}
