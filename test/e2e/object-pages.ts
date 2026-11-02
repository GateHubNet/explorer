// What the specs of the ledger object pages and of the Delegation tab share (ledger-objects.spec.ts, delegation.spec.ts and a11y.spec.ts's block of them): the objects and the transactions
// they look at, found in the fixtures' files by the rules of test/support/object-case-rules.ts, never from a table of IDs. The Worker's specs find the same cases with the same rules
// (test/support/object-cases.ts), but through `import.meta.glob`, which only Vite knows, so the Playwright process reads the files itself, with Node's `fs`. The delegated Payment, the
// delegated `tec`, the empty `DelegateSet` and the failed one are synthetic (test/fixtures/PROVENANCE.md, "Ledger object answers": D5's `delegatedFrom` and `delegate_set_empty` over
// recorded transactions), the escrows, checks and channels are D5's recordings and the generator's synthetic ones: nothing here calls any of them "recorded" but the one `DelegateSet` the
// recordings hold (`recordedDelegateSet`).

import { readdirSync, readFileSync } from "node:fs";

import type { Locator, Page } from "@playwright/test";

import type { DelegationsPage, ObjectAnswer, ObjectApiKind, ObjectEvent, ObjectHistoryPage, TxObject } from "../../app/server/api-types";
import { type ObjectCase, type ObjectCaseResult, type ObjectSources, resolveObjectCase } from "../support/object-case-rules";
import type { Net } from "./names-pages";

export type { ObjectCase, ObjectCaseResult };

const ROOT = new URL("../fixtures/http/", import.meta.url);
const KINDS: Readonly<Record<string, ObjectApiKind>> = { escrows: "escrow", checks: "check", payment_channels: "payment_channel" };

const json = <T>(url: URL): T => JSON.parse(readFileSync(url, "utf8")) as T;
const namesIn = (directory: URL): string[] => {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
};

const cache = new Map<Net, ObjectSources>();

/** What the rules read, from the network's files; read once. The transactions are only those the delegation rules could take (a `Delegate` or a `DelegateSet` in the text). */
function sourcesOf(net: Net): ObjectSources {
  let sources = cache.get(net);
  if (sources === undefined) {
    const answers = new Map<string, { kind: ObjectApiKind; answer: ObjectAnswer }>();
    const histories = new Map<string, Map<string, ObjectHistoryPage>>();
    for (const [route, kind] of Object.entries(KINDS)) {
      const directory = new URL(`${net}/data-api/${route}/`, ROOT);
      for (const name of namesIn(directory)) {
        if (/^[0-9A-F]{64}\.json$/.test(name)) answers.set(name.slice(0, 64), { kind, answer: json<ObjectAnswer>(new URL(name, directory)) });
        else if (/^[0-9A-F]{64}$/.test(name)) {
          const pages = new Map<string, ObjectHistoryPage>();
          for (const file of namesIn(new URL(`${name}/`, directory))) {
            const match = /^history@descending=true&limit=\d+&marker=([^&]+)\.json$/.exec(file);
            if (match !== null) pages.set(match[1]!, json<ObjectHistoryPage>(new URL(`${name}/${file}`, directory)));
          }
          if (pages.size > 0) histories.set(name, pages);
        }
      }
    }
    const nodes = new Map<string, Record<string, unknown>>();
    const entries = new URL(`${net}/node/ledger_entry/`, ROOT);
    for (const name of namesIn(entries)) {
      if (/^[0-9A-F]{64}\.json$/.test(name)) nodes.set(name.slice(0, 64), json<{ result: { node: Record<string, unknown> } }>(new URL(name, entries)).result.node);
    }
    const transactions = new Map<string, TxObject>();
    const served = new URL(`${net}/data-api/transactions/`, ROOT);
    for (const name of namesIn(served)) {
      if (!/^[0-9A-F]{64}\.json$/.test(name)) continue;
      const text = readFileSync(new URL(name, served), "utf8");
      if (text.includes('"Delegate"') || text.includes('"DelegateSet"')) transactions.set(name.slice(0, 64), (JSON.parse(text) as { transaction: TxObject }).transaction);
    }
    sources = { answers, histories, nodes, transactions };
    cache.set(net, sources);
  }
  return sources;
}

/** The object (or the delegation transaction) of `which` on `net`: its ID (a transaction's hash), its owner (the transaction's `Account`), its sequence and the markers of its history's pages. Throws when the fixtures hold none. */
export function objectCase(net: Net, which: ObjectCase): ObjectCaseResult {
  const found = resolveObjectCase(which, sourcesOf(net));
  if (found === undefined) throw new Error(`the ${net} fixtures have no ${which} object`);
  return found;
}

/**
 * How many events each page of an object's history holds, newest page first: the answer's own page, then the page behind each of the case's markers. The long channel has three
 * (50, 50 and 20), which the page's Older and Newer walk through.
 */
export function historyPageSizes(net: Net, which: ObjectCase): number[] {
  const { id, markers = [] } = objectCase(net, which);
  const sources = sourcesOf(net);
  const pages = sources.histories.get(id);
  return [sources.answers.get(id)!.answer.history.length, ...markers.map((marker) => pages!.get(marker)!.history.length)];
}

/** The events of the answer's own page of an object's history, newest first, as the data API gives them. */
export function historyOf(net: Net, which: ObjectCase): ObjectEvent[] {
  return sourcesOf(net).answers.get(objectCase(net, which).id)!.answer.history;
}

/** The transaction that removed an object from the ledger (`removed` of the data API's object): its hash and its type. `undefined` for one still in it. */
export function removedBy(net: Net, which: ObjectCase): { hash: string; txType: string } | undefined {
  const { answer } = sourcesOf(net).answers.get(objectCase(net, which).id)!;
  const object = ("escrow" in answer ? answer.escrow : "check" in answer ? answer.check : answer.payment_channel) as { removed?: { tx_hash: string; tx_type: string } };
  return object.removed === undefined ? undefined : { hash: object.removed.tx_hash, txType: object.removed.tx_type };
}

/** The transaction of a delegation case or of `recordedDelegateSet`, as the fixtures hold it. */
export function transactionOf(net: Net, hash: string): TxObject {
  const found = sourcesOf(net).transactions.get(hash);
  if (found === undefined) throw new Error(`the ${net} fixtures have no delegation transaction ${hash}`);
  return found;
}

/**
 * The one `DelegateSet` the recordings hold that succeeded and gave permissions: D5's recorded delegation, ledger 107,558,036. (The empty one and the failed one are synthetic, the cases
 * `delegate-set-empty` and `delegate-set-failed`.) Found by what it is, as the cases are.
 */
export function recordedDelegateSet(): ObjectCaseResult {
  const sources = sourcesOf("xrpl");
  const hash = [...sources.transactions.keys()].sort().find((each) => {
    const { tx, meta } = sources.transactions.get(each)!;
    return tx.TransactionType === "DelegateSet" && Array.isArray(tx.Permissions) && tx.Permissions.length > 0 && meta.TransactionResult === "tesSUCCESS";
  });
  if (hash === undefined) throw new Error("the xrpl fixtures have no successful DelegateSet that gave permissions");
  return { id: hash, owner: String(sources.transactions.get(hash)!.tx.Account) };
}

/** What the fixtures answer to `GET /v2/accounts/{address}/delegations?direction=…&limit=200` on XRPL (files written by hand for the active account and two others). */
export function delegationsOf(address: string, direction: "given" | "held"): DelegationsPage {
  return json<DelegationsPage>(new URL(`xrpl/data-api/accounts/${address}/delegations@direction=${direction}&limit=200.json`, ROOT));
}

/** The value of a row of a details list (an object's Details card, a transaction's), by its label: the `<dd>` that follows the `<dt>` the label begins. */
export const rowValue = (page: Page, label: string): Locator => page.locator("dl dt", { hasText: new RegExp(`^${label}`) }).locator("xpath=following-sibling::dd[1]");
