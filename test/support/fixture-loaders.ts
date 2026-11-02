// The fixture files of test/fixtures/http/, bundled by Vite into the test module graph (the Workers runtime has no disk to read): a loader for each, by its path from this folder. Imported by
// upstream.ts at run time with an import that Vite does not follow (`LOADERS_MODULE` there), never with a static one: see upstream.ts for why.

export const loaders = import.meta.glob("../fixtures/http/**/*.json", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
