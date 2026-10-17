/** A transaction type (`Payment`, `OfferCreate`) as a small tag. */
export function TypeTag({ type }: { type: string }) {
  return <span className="type">{type}</span>;
}
