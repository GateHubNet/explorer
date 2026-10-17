import { useEffect, useState } from "react";

import { chooseTheme, currentTheme } from "../theme-script";
import { MoonIcon, SunIcon } from "./icons";

/**
 * Light or dark, overriding the system's choice (stored in localStorage; the inline script in <head> applies it before first
 * paint). The markup is the same for every visitor, so the cached HTML can be shared: both icons are rendered and the CSS
 * shows the one that fits the theme (tokens.css), and `aria-pressed` is set only once the browser knows the theme.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    setDark(currentTheme() === "dark");
    // The system theme can change while the page is open, and matters when the visitor has not chosen.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => setDark(currentTheme() === "dark");
    media.addEventListener?.("change", follow);
    return () => media.removeEventListener?.("change", follow);
  }, []);

  function toggle() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    chooseTheme(next);
    setDark(next === "dark");
  }

  return (
    <button type="button" className="icon-btn theme-toggle" aria-label="Dark theme" aria-pressed={dark} onClick={toggle}>
      <SunIcon className="theme-toggle__sun" />
      <MoonIcon className="theme-toggle__moon" />
    </button>
  );
}
