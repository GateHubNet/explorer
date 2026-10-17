// The light/dark theme. The page follows `prefers-color-scheme` unless the visitor has chosen: the choice is `light` or
// `dark` in localStorage, applied as `data-theme` on <html> by THEME_SCRIPT, an inline script in <head> that runs before
// the stylesheet is applied, so nothing flashes and the server sends the same HTML to everyone (tokens.css has the rules
// for both).

export const THEME_STORAGE_KEY = "theme";

export type Theme = "light" | "dark";

/** Inlined in <head>, ahead of the stylesheet. Storage can be blocked (private windows, site data off): then the system decides. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/** The theme the page shows now: the visitor's choice, else the system's. Browser only. */
export function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Shows `theme` and remembers the choice. The page changes even when storage is blocked. Browser only. */
export function chooseTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Blocked storage: the choice lasts until the page is left.
  }
}
