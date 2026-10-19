import { act } from "@testing-library/react";
import type { ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, vi } from "vitest";

// What every test of the chart kit starts from: the page as the Worker prints it, then the browser taking it over. The cached HTML has
// every mark, so a component that renders something else on its first client render is a hydration mismatch, and React reports it
// through `console.error` or `onRecoverableError`; both are collected in `errors` for the test to expect `[]`.

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

// A test file that imports this helper gets its containers removed after each test, as Testing Library's `render` does for its own.
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

/** `ui` as `renderToString` prints it, put in a container of the document and hydrated there. */
export async function serverThenHydrated(ui: ReactElement): Promise<{ html: string; container: HTMLDivElement; errors: string[] }> {
  const html = renderToString(ui);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);

  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  try {
    await act(async () => {
      const root = hydrateRoot(container, ui, { onRecoverableError: (error) => errors.push(String(error)) });
      mounted.push({ root, container });
    });
  } finally {
    spy.mockRestore();
  }
  return { html, container, errors };
}
