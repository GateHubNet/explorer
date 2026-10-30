import { lazy, type ComponentType, type LazyExoticComponent } from "react";

// A chunk the browser loads with `import()` can be gone: a deploy replaced the build the page was drawn with, and its hashed files with it. Reloading gets
// the new build's page. `lazyChunk` reloads the page once when a chunk will not load, and lets the next failure through to the page's error boundary, as a
// failed `import()` always did; a load that works forgets the reload, so that a later deploy gets one too. On the server it is the plain import.

/** What a chunk's load needs of the browser: the tab's storage, which holds the guard across the reload, and the reload. */
export interface ChunkPage {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  reload: () => void;
}

/** The guard of a chunk in `sessionStorage`: one key per module. */
export const reloadKey = (name: string) => `chunk-reload:${name}`;

function browserPage(): ChunkPage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.sessionStorage;
    return storage ? { storage, reload: () => window.location.reload() } : null;
  } catch {
    // Storage that cannot be named (site data blocked) or is not there cannot keep the reload to one: the plain import.
    return null;
  }
}

/**
 * `load()`, and on its first failure in this tab a reload of the page. A second failure rejects, and so does a storage that cannot keep the guard (it throws):
 * never a loop of reloads.
 */
export async function loadChunk<T>(name: string, load: () => Promise<T>, page: ChunkPage | null = browserPage()): Promise<T> {
  if (page === null) return load();
  const key = reloadKey(name);
  let loaded: T;
  try {
    loaded = await load();
  } catch (error) {
    if (page.storage.getItem(key) !== null) throw error;
    page.storage.setItem(key, "1");
    page.reload();
    // The page is going: what was waiting for the chunk waits for the new page.
    return new Promise<T>(() => {});
  }
  page.storage.removeItem(key);
  return loaded;
}

/** `React.lazy` of a chunk, through `loadChunk`: `name` is the module's, for its guard. */
export function lazyChunk<P extends object>(name: string, load: () => Promise<{ default: ComponentType<P> }>): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => loadChunk(name, load));
}
