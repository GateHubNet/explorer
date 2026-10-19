import { createContext, useSyncExternalStore, type ComponentType, type ReactNode, type RefObject } from "react";

import type { Placement } from "./placement";

// What a plot needs of its cursor before the cursor is there (spec 2.1), and so what loads with the page: whether the page is hydrated, the place
// the cursor hands its tooltip to (`Tip`, `TipSlot`) and the host that draws it (`TipHost`), with the view that Cursor.tsx gives it when it
// loads. Everything else the cursors share is in cursor-state.tsx, which the cursor and the forms that have one of their own import; nothing in
// this file imports either.

const noSubscription = () => () => {};

/**
 * False in the Worker's HTML and during hydration, true from the render after: a thing that only a script can do is left out of both, so
 * that they match (the same rule as `LiveToggle`). `Plot.tsx` exports it for the forms; it lives here, with the rest of what the cursors need.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

/** What a cursor has to show as its tooltip: the bucket, and the content `tooltip(bucket)` gave. */
export interface Tip {
  bucket: number;
  node: ReactNode;
}

/**
 * A place outside the cursor to draw its tooltip in. A plot whose region scrolls clips whatever is inside it, the tooltip with it, so the
 * plot (Plot.tsx) draws the tooltip beside the region and the cursor hands it over here. A cursor with none draws it in the plot, as the
 * mock does.
 */
export interface TipSlot {
  show(tip: Tip | null): void;
  get(): Tip | null;
  subscribe(listener: () => void): () => void;
}

export function createTipSlot(): TipSlot {
  let tip: Tip | null = null;
  const listeners = new Set<() => void>();
  return {
    show(next) {
      if (next === null && tip === null) return;
      tip = next;
      for (const listener of listeners) listener();
    },
    get: () => tip,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const TipSlotContext = createContext<TipSlot | null>(null);

/** What a tooltip is drawn from: the tip, and the boxes of the plot it is placed by (see `PlotTip`, in Cursor.tsx). */
export interface TipViewProps {
  tip: Tip;
  frame: RefObject<HTMLDivElement | null>;
  region: RefObject<HTMLDivElement | null>;
  plot: RefObject<HTMLDivElement | null>;
  count: number;
  placement: Placement;
}

let tipView: ComponentType<TipViewProps> | undefined;

/** Cursor.tsx says how a tooltip is drawn when it is loaded: the code that places one is the cursor's, and a page loads it with the cursor. */
export function setTipView(view: ComponentType<TipViewProps>): void {
  tipView = view;
}

/**
 * Where a plot has its tooltip: in the frame, beside the region that scrolls (which would clip it). It reads the slot the cursor hands its tip
 * to, and draws it with the view the cursor's file gave when it loaded. There is no tip before the cursor, so there is nothing to draw
 * before there is a view.
 */
export function TipHost({ slot, ...boxes }: { slot: TipSlot } & Omit<TipViewProps, "tip">) {
  const tip = useSyncExternalStore(slot.subscribe, slot.get, () => null);
  const View = tipView;
  return tip && View ? <View tip={tip} {...boxes} /> : null;
}
