// The home page's own `onScreen` (on-screen.ts): what the page keeps when a refresh does not work, and the two answers it will not draw: one
// that is older than the ledger on screen, and one from another build than the page's own (README, "Live updates").

import type { HomeLoaderData } from "../server/home-view";
import { createOnScreen, type OnScreen } from "./on-screen";

/** Where this tab remembers the pairs of builds it has reloaded for (`sessionStorage`, a JSON list of `from>to`). */
const MARKER = "explorer:build-reloads";

export interface HomeLiveDeps {
  /** `window.location.reload()`. */
  reload?: () => void;
  /** `window.sessionStorage`: it may throw, or be absent, where the visitor blocks storage. */
  storage?: () => Storage | undefined;
}

/** The kinds of `<input>` that are not for typing text into. */
const NOT_FOR_TYPING = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"]);

/** Whether `element` is something the visitor types text into: a textarea, a text-like input, an editable element. */
function isForTyping(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !NOT_FOR_TYPING.has(element.type.toLowerCase());
  return element instanceof HTMLElement && element.isContentEditable === true;
}

const textOf = (element: Element): string =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : (element.textContent ?? "");

/**
 * Whether the visitor is typing: a field for text has focus (`focus`, which is where focus is, or is going), or any field on the page holds
 * text. A reload would throw away what is in it, the hero's search box or any other.
 */
function visitorIsTyping(focus: EventTarget | null): boolean {
  if (focus instanceof Element && isForTyping(focus)) return true;
  for (const element of document.querySelectorAll("input, textarea, [contenteditable]")) {
    if (isForTyping(element) && textOf(element) !== "") return true;
  }
  return false;
}

/** The pairs of builds this tab has reloaded for, from its `sessionStorage` (`undefined`: it cannot be read or written, so nothing can be remembered). */
function reloadedFor(storage: () => Storage | undefined): { box: Storage; done: string[] } | undefined {
  try {
    const box = storage();
    if (!box) return undefined;
    const text = box.getItem(MARKER);
    try {
      const parsed: unknown = text === null ? [] : JSON.parse(text);
      return { box, done: Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [] };
    } catch {
      // Not what this wrote: no pair is known.
      return { box, done: [] };
    }
  } catch {
    return undefined;
  }
}

/** Notes that the page reloads for `pair` and reloads. Not where the note cannot be made. */
function reloadNow(pair: string, { reload, storage }: Required<HomeLiveDeps>): void {
  const known = reloadedFor(storage);
  if (!known || known.done.includes(pair)) return;
  try {
    known.box.setItem(MARKER, JSON.stringify([...known.done, pair]));
  } catch {
    return;
  }
  reload();
}

/**
 * A deploy while the page is open: the Worker that answers is of a new build and the code in the browser is the old one, and data of a new
 * shape must not be drawn by old code. The page reloads, and does so once for a pair of builds (the marker of the tab), so that a skew that
 * stays (a rollout in progress, an old copy somewhere) cannot make a loop. Where the marker cannot be written the page does not reload at all:
 * a loop is worse than an old page.
 *
 * Not while the visitor is typing, in the hero's search box or in any field of the page (a reload would throw the text away): the page waits
 * until no field has focus and all are empty, or until the tab is hidden, and then reloads. The wait is one for each pair of builds however
 * many answers of the new build come meanwhile, and ends when it has reloaded.
 */
function reloadOnce(from: string, to: string, deps: Required<HomeLiveDeps>, waiting: Set<string>): void {
  const pair = `${from}>${to}`;
  if (waiting.has(pair) || reloadedFor(deps.storage)?.done.includes(pair)) return;
  if (document.visibilityState === "hidden" || !visitorIsTyping(document.activeElement)) {
    reloadNow(pair, deps);
    return;
  }

  waiting.add(pair);
  const events = ["focusout", "input", "change"] as const;
  const check = (event?: Event) => {
    // On its way out of a field, focus is not where it is going yet in every browser: `relatedTarget` says where it is going.
    const focus = event?.type === "focusout" ? (event as FocusEvent).relatedTarget : document.activeElement;
    if (document.visibilityState !== "hidden" && visitorIsTyping(focus)) return;
    for (const name of events) document.removeEventListener(name, check);
    document.removeEventListener("visibilitychange", check);
    waiting.delete(pair);
    reloadNow(pair, deps);
  };
  for (const name of events) document.addEventListener(name, check);
  document.addEventListener("visibilitychange", check);
}

export function createHomeOnScreen(deps: HomeLiveDeps = {}): OnScreen<HomeLoaderData> {
  const resolved: Required<HomeLiveDeps> = {
    reload: deps.reload ?? (() => window.location.reload()),
    storage: deps.storage ?? (() => window.sessionStorage),
  };
  /** The pairs of builds the page is waiting to reload for, until the visitor has stopped typing. */
  const waiting = new Set<string>();
  return createOnScreen<HomeLoaderData>({
    // Not to be drawn: an answer of another build (the document is reloaded, once), and an older one (the edge serves a stored copy, whatever
    // its age, when a render fails; the scope of `reload` is the network, so another network's ledger is not compared).
    refuse: (next, shown) => {
      if (next.build !== shown.build) {
        reloadOnce(shown.build, next.build, resolved, waiting);
        return true;
      }
      return next.latest.index < shown.latest.index;
    },
  });
}
