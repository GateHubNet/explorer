// Edits of the recorded ledgers for the tests of the scripts that derive from them (scripts/derived-trades.test.ts, scripts/amm-info-fixtures.test.ts). Nothing
// here reads a file or imports app code: the ledgers are passed in, as `readLedgers` (scripts/http-fixtures.ts) gives them, and a type that has `ledger.transactions`
// and a `hash` for each is all it asks of them. It is in tsconfig.node.json beside the other support files the scripts use.

/** A copy of the ledgers where the transaction `hash` is changed by `change`; the ledgers given are not touched. */
export function withTx<L extends { ledger: { transactions: Array<{ hash: string }> } }>(
  ledgers: readonly L[],
  hash: string,
  change: (tx: L["ledger"]["transactions"][number]) => void,
): L[] {
  const copy = structuredClone([...ledgers]);
  for (const raw of copy) {
    const found = raw.ledger.transactions.find((tx) => tx.hash === hash);
    if (found) change(found);
  }
  return copy;
}
