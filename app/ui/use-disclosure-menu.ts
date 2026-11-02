import { type RefObject, useEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * What a header menu does once the page is live (supply spec 2.4). The menu is a `<details>` with its links: it opens and closes with Enter, Space and a click and Tab moves through
 * it, all before any script and without one. This adds what a disclosure does not do by itself, and no more (it is no ARIA `menu`, and has no arrow keys):
 *
 * - **Escape** while it is open and focus is in it (the summary or an item): it closes, and focus goes to the summary;
 * - **a pointer down outside** while it is open: it closes, and focus stays where it was;
 * - **focus leaving**, a `focusout` whose `relatedTarget` is an element outside it: it closes. A window blur has no `relatedTarget` (`null`), and leaves the menu as it was;
 * - **a navigation**, a change of the location's pathname or search: it closes, so that the panel does not stay over the new page. The first run is the page as the server drew it,
 *   not a navigation: a visitor who opened the menu before the page was live keeps it open;
 * - **a link chosen in the panel**, a click on an `a` inside it: it closes, and the click goes on to follow the link. This goes beyond spec 2.4 (the final review's finding 4): choosing the
 *   page you are on is no navigation, so the rule above leaves the panel open, and to the visitor the click did nothing. On such a link (`aria-current="page"`) focus also goes to the summary,
 *   since the panel closes with focus on a link that is hidden now and no navigation follows to take it out of there; on any other link the page that follows starts focus over;
 * - **opening one menu closes the others** (`details[data-menu]`).
 *
 * Hovering opens nothing. Its own file, so that the shell imports nothing else (the budget of the network page, supply spec 13: it moves into Header.tsx if that page goes over).
 */
export function useDisclosureMenu(ref: RefObject<HTMLDetailsElement | null>): void {
  const { pathname, search } = useLocation();
  const where = useRef(`${pathname}${search}`);

  useEffect(() => {
    const here = `${pathname}${search}`;
    if (where.current === here) return;
    where.current = here;
    if (ref.current) ref.current.open = false;
  }, [pathname, search, ref]);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (details.open && next instanceof Node && !details.contains(next)) details.open = false;
    };
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || !details.contains(link)) return;
      details.open = false;
      if (link.getAttribute("aria-current") === "page") details.querySelector("summary")?.focus();
    };
    const onToggle = () => {
      if (!details.open) return;
      for (const other of document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]")) {
        if (other !== details) other.open = false;
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (details.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
    };

    details.addEventListener("keydown", onKeyDown);
    details.addEventListener("focusout", onFocusOut);
    details.addEventListener("click", onClick);
    details.addEventListener("toggle", onToggle);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      details.removeEventListener("keydown", onKeyDown);
      details.removeEventListener("focusout", onFocusOut);
      details.removeEventListener("click", onClick);
      details.removeEventListener("toggle", onToggle);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [ref]);
}
