import { useEffect, useId, useState, type KeyboardEvent } from "react";

import { cx } from "../cx";
import { CopyTextButton } from "./CopyTextButton";

export interface RawTab {
  id: string;
  label: string;
  /** The raw text. A tab has either this or a `note`. */
  text?: string;
  /** Said instead of the text, for a tab that has none to show (the binary form that could not be loaded). */
  note?: string;
  /** Wrap the text at the edge of the panel instead of scrolling it sideways (a blob of hex has nowhere to break). */
  wrap?: boolean;
}

function Panel({ tab }: { tab: RawTab }) {
  if (tab.text === undefined) return <p className="rawtabs__note">{tab.note}</p>;
  return (
    <pre className={cx("code", tab.wrap && "code--wrap")} tabIndex={0} role="region" aria-label={tab.label}>
      {tab.text}
    </pre>
  );
}

/**
 * The raw data of a page as tabs (Transaction / Metadata / Binary). The page as the server prints it, and as the browser first
 * draws it, has every panel one under the other under a heading of its name: tabs need script to switch, and a page that is
 * stored for a year must not hide two thirds of itself from a browser that never runs it. Once the browser has run the page
 * the panels become a tab list of real buttons (arrow keys, Home and End move) with one panel and a Copy button.
 */
export function RawTabs({ label, tabs }: { label: string; tabs: readonly RawTab[] }) {
  const base = useId();
  // False on the server and on the first client render, so that the markup hydrates as it was printed.
  const [enhanced, setEnhanced] = useState(false);
  const [selected, setSelected] = useState(tabs[0]?.id);
  useEffect(() => setEnhanced(true), []);

  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;

  if (!enhanced) {
    return (
      <div className="rawtabs">
        {tabs.map((tab) => (
          <div key={tab.id} className="rawtabs__section">
            <h3 className="rawtabs__heading">{tab.label}</h3>
            <Panel tab={tab} />
          </div>
        ))}
      </div>
    );
  }

  const current = tabs.find((tab) => tab.id === selected) ?? tabs[0];
  if (!current) return null;

  function move(event: KeyboardEvent<HTMLButtonElement>, from: number) {
    const last = tabs.length - 1;
    const to =
      event.key === "ArrowRight" ? (from === last ? 0 : from + 1) : event.key === "ArrowLeft" ? (from === 0 ? last : from - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : undefined;
    if (to === undefined) return;
    event.preventDefault();
    const target = tabs[to]!;
    setSelected(target.id);
    document.getElementById(tabId(target.id))?.focus();
  }

  return (
    <div className="rawtabs">
      <div className="rawtabs__bar">
        <div role="tablist" aria-label={label} className="rawtabs__list">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              className="rawtabs__tab"
              aria-selected={tab.id === current.id}
              aria-controls={panelId}
              tabIndex={tab.id === current.id ? 0 : -1}
              onClick={() => setSelected(tab.id)}
              onKeyDown={(event) => move(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {current.text !== undefined && <CopyTextButton getText={() => current.text ?? ""}>Copy</CopyTextButton>}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(current.id)}>
        <Panel tab={current} />
      </div>
    </div>
  );
}
