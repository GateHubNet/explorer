import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../support/value-imports";

// The merge of a beat of a live page (display names spec 3.4) is browser code: the route's `clientLoader` runs it on every beat, so the file that works it out is loaded with the page. It
// reads the Worker's page data by its types alone (erased by the compiler) and imports two pure files; a value of `app/server` would bring the Worker's code, and the address codec, to
// the page. (Run in Node, which the walk of the files needs: the `components` project's URLs are not files.)

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

describe.each(["ui/pages/home-beat.ts", "ui/pages/pair-beat.ts", "ui/pages/validator-beat.ts"])("%s, the merge of a beat", (file) => {
  it("imports no value from app/server", () => {
    expect(valueImports(read(file)).filter((from) => /(^|\/)server(\/|$)/.test(from))).toEqual([]);
  });

  it("loads no file of app/server, nor the address codec, through any of its imports", () => {
    expect(staticClosure(appDir, file).filter((path) => path.startsWith("server/"))).toEqual([]);
    for (const path of staticClosure(appDir, file)) expect(valueImports(read(path)).filter((from) => /ripple-/.test(from)), path).toEqual([]);
  });
});
