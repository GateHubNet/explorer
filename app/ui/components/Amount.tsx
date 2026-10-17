import { formatAmount, formatCurrency } from "../../domain/format";
import { cx } from "../cx";

/**
 * An amount: the value through `formatAmount` (thousands separators, every digit kept, exponent notation written out) and
 * the currency through `formatCurrency` (a 40-hex code as text, "LP token" or its first 8 digits; the code and the issuer
 * are on hover). Always render amounts through this, never `{value} {currency}`.
 *
 * `signed` is for changes: a gain gets a plus and the success colour, a loss keeps its minus sign.
 */
export function Amount({
  value,
  currency,
  issuer,
  signed,
  className,
}: {
  value: string;
  currency: string;
  issuer?: string;
  signed?: boolean;
  className?: string;
}) {
  const formatted = formatAmount(value);
  const shown = formatCurrency(currency);
  const gain = signed === true && !formatted.startsWith("−") && /[1-9]/.test(formatted);

  const code = shown !== currency ? currency : undefined;
  const title = issuer ? `${code ?? currency} issued by ${issuer}` : code;

  return (
    <span className={cx("amt", gain && "amt--pos", className)} title={title}>
      {gain ? "+" : ""}
      {formatted} {shown}
    </span>
  );
}
