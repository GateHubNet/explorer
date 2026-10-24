import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The deployed test environment is the sandbox (GLOSSARY.md, D14). The old word stays out of the code, the scripts, the tests and the README, so that the rename stays
// complete; GLOSSARY.md, docs/ and the git history keep it. This file builds the word from two halves, so that it does not find itself.

const root = new URL("../../", import.meta.url);

const WORD = new RegExp(`\\b${"stag"}${"ing"}\\b`, "i");

// What is walked: directories (every file under them) and single files. test/fixtures (recorded responses) and node_modules are skipped.
const PLACES = [
  "app",
  "workers",
  "scripts",
  "test",
  ".github",
  "README.md",
  "wrangler.jsonc",
  "package.json",
  "playwright.config.ts",
  "vitest.config.ts",
  "vite.config.ts",
];
const SKIPPED = (path: string) => /(^|\/)node_modules(\/|$)/.test(path) || /^test\/fixtures(\/|$)/.test(path);

// The numbers (from 1) of the lines of `text` that hold the word.
const hits = (text: string) => text.split("\n").flatMap((line, index) => (WORD.test(line) ? [index + 1] : []));

// Every file of PLACES, as a path from the root. A file with a NUL byte (a font, an image) is not text and is not read.
const filesOf = (place: string): string[] => {
  if (SKIPPED(place)) return [];
  if (statSync(new URL(place, root)).isFile()) return [place];
  return readdirSync(new URL(place, root), { recursive: true, encoding: "utf8" })
    .map((file) => `${place}/${file}`)
    .filter((path) => !SKIPPED(path) && statSync(new URL(path, root)).isFile());
};

// "README.md:12", … for each line of each file that holds the word.
const allHits = () =>
  PLACES.flatMap(filesOf).flatMap((path) => {
    const bytes = readFileSync(new URL(path, root));
    if (bytes.includes(0)) return [];
    return hits(bytes.toString("utf8")).map((line) => `${path}:${line}`);
  });

describe("the old name of the sandbox", () => {
  it("finds the word where it is", () => {
    expect(hits("a\nb " + "stag" + "ing c\n")).toEqual([2]);
  });

  it("finds the word in a longer name and in capitals, and not inside another word", () => {
    expect(hits(`x-explorer-${"stag"}${"ing"}\n${"Stag"}${"ing"}\nre${"stag"}${"ing"}\n`)).toEqual([1, 2]);
  });

  it("is not in the code, the scripts, the tests or the README", () => {
    expect(allHits()).toEqual([]);
  });
});
