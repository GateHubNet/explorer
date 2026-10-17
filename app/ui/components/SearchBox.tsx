import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Form, Link } from "react-router";

import type { classify as Classify, SearchKind } from "../../domain/search";
import { cx } from "../cx";
import type { NetworkBrief } from "../networks";
import { hintsFor } from "../search-hints";
import { ArrowRightIcon, SearchIcon } from "./icons";
import { TypeTag } from "./TypeTag";

/** The code that tells what an input is pulls in the address codec; it is fetched on first focus, not with the page. */
const loadClassifier = () => import("../../domain/search").then((module) => module.classify);

/** Whether a key press landed in something the visitor types in, where "/" is a character. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable === true ||
    target.closest("[contenteditable='true']") !== null
  );
}

/**
 * The search box. A GET form to `/{net}/search?q=...`, so it works before JavaScript loads; with JavaScript it shows what the
 * input looks like as you type (a ledger, an account, a hash, a CTID), without any request. `/` focuses it from anywhere on
 * the page except while another field has focus.
 *
 * `variant="header"` is the compact box of the header; `"hero"` the large one with a Search button. A second box on the same
 * page (the 404 page has the header's and its own) passes `shortcut={false}`, so that it does not claim the `/` key, and
 * `landmark={false}`, so that the page has one search landmark, not two of the same name.
 */
export function SearchBox({
  net,
  variant = "header",
  shortcut = true,
  landmark = true,
  initialQuery = "",
}: {
  net: NetworkBrief;
  variant?: "header" | "hero";
  shortcut?: boolean;
  landmark?: boolean;
  initialQuery?: string;
}) {
  const inputId = useId();
  const hintsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [classify, setClassify] = useState<typeof Classify | undefined>(undefined);

  const prepareHints = useCallback(() => {
    void loadClassifier().then((loaded) => setClassify(() => loaded));
  }, []);

  useEffect(() => {
    if (!shortcut) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented) {
        return;
      }
      if (isTyping(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcut]);

  const trimmed = query.trim();
  const found: SearchKind | undefined = open && classify && trimmed ? classify(trimmed) : undefined;
  const hints = found ? hintsFor(found, net.id) : [];

  return (
    <Form
      method="get"
      action={`/${net.id}/search`}
      role={landmark ? "search" : undefined}
      className={cx("search", `search--${variant}`)}
      onBlur={(event) => {
        // Focus moved out of the form (not just from the box to a hint): the hints are done.
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      // The page the search leads to is on its way: the hints are done (the box is still there, in the header).
      onSubmit={() => setOpen(false)}
    >
      <label htmlFor={inputId} className="sr">
        Search {net.name}
      </label>
      <div className="search__field">
        <SearchIcon className="search__icon" />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          name="q"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            prepareHints();
          }}
          onFocus={() => {
            setOpen(true);
            prepareHints();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          className={cx("search__input", variant === "hero" && "mono")}
          placeholder={variant === "hero" ? "Address, transaction hash, ledger index or CTID" : "Address, hash, ledger or CTID"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby={hintsId}
        />
        {variant === "header" && (
          <kbd className="search__key" aria-hidden="true">
            /
          </kbd>
        )}
        {variant === "hero" && (
          <button type="submit" className="search__submit">
            Search
          </button>
        )}
      </div>
      <div id={hintsId} className="search__hints" aria-live="polite">
        {hints.length > 0 && (
          // Pressing a hint must not take focus from the box: the blur would close the hints before the press became a click.
          // Once it has been a click, the hints (and a phone's keyboard) go.
          <ul
            className="hits"
            aria-label="Matches"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setOpen(false);
              inputRef.current?.blur();
            }}
          >
            {hints.map((hint) => (
              <li key={hint.href}>
                <Link to={hint.href} className="hit">
                  <TypeTag type={hint.kind} /> <span className="hit__detail">{hint.detail}</span>{" "}
                  <span className="hit__net">on {net.name}</span>
                  <ArrowRightIcon className="hit__go" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {found?.kind === "none" && (
          <p className="search__empty">
            Nothing on {net.name} looks like that. Enter an address (r&hellip;), a 64-character transaction or ledger hash, a
            ledger index, or a CTID (C followed by 15 hex digits).
          </p>
        )}
      </div>
    </Form>
  );
}
