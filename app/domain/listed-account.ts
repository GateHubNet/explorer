// How a list in the chart kit draws an account (E9, spec 4.3): the label, the sublabel under it and the marks after it, written once for the view builders (the market pair's traders, an
// AMM pool's votes) and for the pair page's merge of a beat, which writes a beat's bars again with the names the page keeps. A module of its own, beside names.ts and not in it: every
// page that draws an account loads names.ts, and the one page that merges a beat's bars is the only browser code that needs this.

import { shortAddress } from "./format";
import { linkTextOf, type NameKind, type NameMap } from "./names";

/** What a chart's list draws of an account (`BarListData.items[]`): the label, the sublabel under it, and the marks after it. */
export interface ListedAccount {
  label: string;
  sublabel?: string;
  mark?: { kind?: NameKind; labels: string[] };
}

/**
 * How a list in the chart kit draws an account (display names spec 4.3), for the view builders that write its `label`, `sublabel` and `mark`. An account with a name: its link text for
 * the label, its short address for the sublabel, and the mark of how the name is known and of its labels. An account with labels only: the short address as it was, and the labels'
 * mark. Any other, an account network name alone included (the link has no name to draw), is the short address and nothing else.
 */
export function listedAccount(address: string, names: NameMap): ListedAccount {
  const view = names[address];
  const short = shortAddress(address);
  if (!view) return { label: short };
  const text = linkTextOf(view);
  if (view.name && text !== "") return { label: text, sublabel: short, mark: { kind: view.name.kind, labels: [...view.labels] } };
  return view.labels.length > 0 ? { label: short, mark: { labels: [...view.labels] } } : { label: short };
}
