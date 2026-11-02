// The names of a page's addresses (E9, spec 4): the context its loader data fills, which `AccountLink` reads by address. A page puts its `NamesPart`'s
// map in a `NamesProvider`; a component that draws an account asks `useNameOf`. Outside a provider there is nothing to ask, so a page that is not given
// names draws addresses as it always did. Types only from the domain: the view is a plain object the Worker made, and this file is in every page that
// draws an account.

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { NameMap, NameView } from "../domain/names";

/** No names: what a component outside every provider reads. Frozen, because it is shared. */
const NO_NAMES_IN_CONTEXT: NameMap = Object.freeze({});

const NamesContext = createContext<NameMap>(NO_NAMES_IN_CONTEXT);

/**
 * Gives the components below it `names` to draw. A provider inside another adds to its map: the outer entries stay, and an address that both have
 * takes the inner one (a card that has fresher names than the page). A provider with nothing to add leaves the outer map as it is.
 */
export function NamesProvider({ names, children }: { names: NameMap; children: ReactNode }) {
  const outer = useContext(NamesContext);
  const merged = useMemo(() => (Object.keys(names).length === 0 ? outer : outer === NO_NAMES_IN_CONTEXT ? names : { ...outer, ...names }), [outer, names]);
  return <NamesContext.Provider value={merged}>{children}</NamesContext.Provider>;
}

/** The view of `address` in the page's names; `undefined` for an address nothing is known of, and for any address outside a provider. */
export function useNameOf(address: string): NameView | undefined {
  const names = useContext(NamesContext);
  // An own key only: an address is never `constructor`, but a map is a plain object and nothing here is a name.
  return Object.hasOwn(names, address) ? names[address] : undefined;
}
