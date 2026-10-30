import { afterEach, describe, expect, it, vi } from "vitest";

import { loadChunk, reloadKey, type ChunkPage } from "./lazy-chunk";

// The chunks of the account page (its list panels and the analytics view) load through `loadChunk`: a chunk that will not load reloads the page once (a deploy
// took the build away), a second failure goes to the error boundary, and on the server it is the plain import.

/** A tab of the browser: its session storage, and the reloads asked of it. */
function tab(stored: Record<string, string> = {}): ChunkPage & { stored: Map<string, string>; reloads: () => number } {
  const map = new Map(Object.entries(stored));
  const reload = vi.fn();
  return {
    stored: map,
    reloads: () => reload.mock.calls.length,
    reload,
    storage: { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value), removeItem: (key) => void map.delete(key) },
  };
}

const gone = new Error("Failed to fetch dynamically imported module: /assets/AccountListPanels-old.js");
const KEY = reloadKey("AccountListPanels");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadChunk", () => {
  it("reloads the page on the first failure, and keeps the guard for the page that comes back; what waited for the chunk never settles", async () => {
    const page = tab();
    let settled = false;
    void loadChunk("AccountListPanels", () => Promise.reject(gone), page).finally(() => (settled = true));
    await vi.waitFor(() => expect(page.reloads()).toBe(1));
    expect(page.stored.get(KEY)).toBe("1");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
  });

  it("rejects on a second failure, without reloading again: the error reaches the boundary", async () => {
    const page = tab({ [KEY]: "1" });
    await expect(loadChunk("AccountListPanels", () => Promise.reject(gone), page)).rejects.toBe(gone);
    expect(page.reloads()).toBe(0);
  });

  it("forgets the guard when the chunk loads, so that a later deploy gets its reload too; each module has its own", async () => {
    const other = reloadKey("AccountAnalytics");
    const page = tab({ [KEY]: "1", [other]: "1" });
    const module = { default: () => null };
    await expect(loadChunk("AccountListPanels", () => Promise.resolve(module), page)).resolves.toBe(module);
    expect(page.stored.has(KEY)).toBe(false);
    expect(page.stored.get(other)).toBe("1");
    expect(page.reloads()).toBe(0);
  });

  it("rejects without a reload when the storage cannot keep the guard: never a loop of reloads", async () => {
    const page = tab();
    page.storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    await expect(loadChunk("AccountListPanels", () => Promise.reject(gone), page)).rejects.toThrow("QuotaExceededError");
    expect(page.reloads()).toBe(0);
  });

  it("is the plain import where there is no window (the server): the failure rejects, the module resolves", async () => {
    vi.stubGlobal("window", undefined);
    await expect(loadChunk("AccountListPanels", () => Promise.reject(gone))).rejects.toBe(gone);
    const module = { default: () => null };
    await expect(loadChunk("AccountListPanels", () => Promise.resolve(module))).resolves.toBe(module);
  });
});
