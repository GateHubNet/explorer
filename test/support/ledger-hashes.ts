// The transaction hashes of the recorded ledgers, in ledger order, read from the fixture files themselves
// (test/fixtures/http/<net>/data-api/ledgers/<index>@transactions=true.json) and not through the client under test.
// For the Workers runtime: Vite bundles the files, as it does for upstream.ts.

import type { NetworkId } from "../../app/server/networks";

const files = import.meta.glob("../fixtures/http/*/data-api/ledgers/*@transactions=true.json", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

/** The hashes of a recorded ledger in the order of its transactions. Throws for a ledger that was not recorded. */
export async function recordedHashes(net: NetworkId, index: number): Promise<string[]> {
  const load = files[`../fixtures/http/${net}/data-api/ledgers/${index}@transactions=true.json`];
  if (!load) throw new Error(`no fixture for ${net} ledger ${index}`);
  return (JSON.parse(await load()) as { ledger: { transactions: string[] } }).ledger.transactions;
}
