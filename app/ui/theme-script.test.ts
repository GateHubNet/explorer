import { afterEach, describe, expect, it } from "vitest";

import { THEME_SCRIPT, THEME_STORAGE_KEY } from "./theme-script";

// The inline script of the <head> that applies a stored theme before first paint. It runs as text, so the test
// runs it as text.

function run() {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(THEME_SCRIPT)();
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
});

describe("THEME_SCRIPT", () => {
  it("applies a stored dark or light theme to <html>", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    run();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("leaves <html> alone when nothing, or something else, is stored (the system theme decides)", () => {
    run();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    run();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("does not throw when storage cannot be read", () => {
    const real = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(run).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", real);
    }
  });

  it("is small enough to sit in every page", () => {
    expect(THEME_SCRIPT.length).toBeLessThan(250);
  });
});
