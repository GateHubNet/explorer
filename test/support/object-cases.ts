// The ledger objects of the fixtures (scripts/object-fixtures.ts, `pnpm fixtures:sync`) that the worker specs need: an escrow, a check or a payment channel of each case the object pages
// draw, the markers of the long channel's pages, the objects only the node has, and the delegation transactions. Each case is found in the files' data by its rule in
// object-case-rules.ts (the rules the fixtures test checks the generator with), never from a table of IDs, so a change of the generator's seeds moves nothing here. Read from the
// fixture files themselves (Vite bundles them, as nft-cases.ts and ledger-hashes.ts do), not through the client under test.

import type { ObjectAnswer, ObjectApiKind, ObjectHistoryPage, TxObject } from "../../app/server/api-types";
import type { NetworkId } from "../../app/server/networks";
import { resolveObjectCase, type ObjectCase, type ObjectCaseResult, type ObjectSources } from "./object-case-rules";

export { OBJECT_CASES, type ObjectCase, type ObjectCaseResult } from "./object-case-rules";

const ROOT = "../fixtures/http/";
type Loaders = Record<string, () => Promise<string>>;
const answers = import.meta.glob(["../fixtures/http/*/data-api/escrows/*.json", "../fixtures/http/*/data-api/checks/*.json", "../fixtures/http/*/data-api/payment_channels/*.json"], {
  query: "?raw",
  import: "default",
}) as Loaders;
const histories = import.meta.glob(
  ["../fixtures/http/*/data-api/escrows/*/history@*.json", "../fixtures/http/*/data-api/checks/*/history@*.json", "../fixtures/http/*/data-api/payment_channels/*/history@*.json"],
  { query: "?raw", import: "default" },
) as Loaders;
const nodeEntries = import.meta.glob("../fixtures/http/*/node/ledger_entry/*.json", { query: "?raw", import: "default" }) as Loaders;
const transactions = import.meta.glob("../fixtures/http/*/data-api/transactions/*.json", { query: "?raw", import: "default" }) as Loaders;

const KINDS: Readonly<Record<string, ObjectApiKind>> = { escrows: "escrow", checks: "check", payment_channels: "payment_channel" };

/** The files of `loaders` that are the network's and match `pattern`, with its groups. */
function filesOf(loaders: Loaders, net: NetworkId, pattern: RegExp): Array<{ path: string; groups: string[] }> {
  return Object.keys(loaders).flatMap((path) => {
    const match = path.startsWith(`${ROOT}${net}/`) ? pattern.exec(path.slice(`${ROOT}${net}/`.length)) : null;
    return match === null ? [] : [{ path, groups: match.slice(1) }];
  });
}

const read = async <T>(loaders: Loaders, path: string): Promise<T> => JSON.parse(await loaders[path]!()) as T;

const cache = new Map<NetworkId, Promise<ObjectSources>>();

/** What the rules read, from the network's files; read once. The transactions are only those the delegation rules could take (a `Delegate` or a `DelegateSet` in the text). */
function sourcesOf(net: NetworkId): Promise<ObjectSources> {
  let sources = cache.get(net);
  if (sources === undefined) {
    sources = (async (): Promise<ObjectSources> => {
      const answered = new Map<string, { kind: ObjectApiKind; answer: ObjectAnswer }>();
      for (const { path, groups } of filesOf(answers, net, /^data-api\/(escrows|checks|payment_channels)\/([0-9A-F]{64})\.json$/)) {
        answered.set(groups[1]!, { kind: KINDS[groups[0]!]!, answer: await read<ObjectAnswer>(answers, path) });
      }
      const paged = new Map<string, Map<string, ObjectHistoryPage>>();
      for (const { path, groups } of filesOf(histories, net, /^data-api\/(?:escrows|checks|payment_channels)\/([0-9A-F]{64})\/history@descending=true&limit=\d+&marker=([^&]+)\.json$/)) {
        const pages = paged.get(groups[0]!) ?? new Map<string, ObjectHistoryPage>();
        pages.set(groups[1]!, await read<ObjectHistoryPage>(histories, path));
        paged.set(groups[0]!, pages);
      }
      const nodes = new Map<string, Record<string, unknown>>();
      for (const { path, groups } of filesOf(nodeEntries, net, /^node\/ledger_entry\/([0-9A-F]{64})\.json$/)) {
        nodes.set(groups[0]!, (await read<{ result: { node: Record<string, unknown> } }>(nodeEntries, path)).result.node);
      }
      const delegated = new Map<string, TxObject>();
      for (const { path, groups } of filesOf(transactions, net, /^data-api\/transactions\/([0-9A-F]{64})\.json$/)) {
        const text = await transactions[path]!();
        if (text.includes('"Delegate"') || text.includes('"DelegateSet"')) delegated.set(groups[0]!, (JSON.parse(text) as { transaction: TxObject }).transaction);
      }
      return { answers: answered, histories: paged, nodes, transactions: delegated };
    })();
    cache.set(net, sources);
  }
  return sources;
}

/** The object (or the delegation transaction) of `which` on `net`. Throws when the network's fixtures hold none. */
export async function objectCase(net: NetworkId, which: ObjectCase): Promise<ObjectCaseResult> {
  const found = resolveObjectCase(which, await sourcesOf(net));
  if (found === undefined) throw new Error(`the ${net} fixtures have no ${which} object`);
  return found;
}
