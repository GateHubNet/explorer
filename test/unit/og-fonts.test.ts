import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The link-preview images are drawn with Geist and Geist Mono (spec 8, 9), bundled with the Worker and never fetched at runtime. Satori reads TTF
// but not the WOFF2 the pages use, and the Cloudflare plugin turns an imported `.bin` file into an ArrayBuffer (it has no rule for `.ttf`),
// so app/og/fonts/ holds the package's TTF files under that extension. These tests keep them the package's own bytes.

const here = (path: string) => new URL(`../../${path}`, import.meta.url);

/** The bundled file and the file of the `geist` package it is a copy of. */
const COPIES: Record<string, string> = {
  "Geist-Regular.bin": "node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf",
  "Geist-Medium.bin": "node_modules/geist/dist/fonts/geist-sans/Geist-Medium.ttf",
  "Geist-SemiBold.bin": "node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf",
  "GeistMono-Regular.bin": "node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.ttf",
  "GeistMono-Medium.bin": "node_modules/geist/dist/fonts/geist-mono/GeistMono-Medium.ttf",
};

describe("the fonts of the images", () => {
  it("are the bytes of the geist package's TTF files, and nothing else is in the folder but the licence", () => {
    const folder = readdirSync(here("app/og/fonts")).sort();
    expect(folder).toEqual([...Object.keys(COPIES), "LICENSE.txt"].sort());
    for (const [copy, original] of Object.entries(COPIES)) {
      const bytes = readFileSync(here(`app/og/fonts/${copy}`));
      expect(bytes.equals(readFileSync(here(original))), copy).toBe(true);
    }
  });

  it("are TrueType fonts, which is what Satori reads", () => {
    for (const copy of Object.keys(COPIES)) {
      const bytes = readFileSync(here(`app/og/fonts/${copy}`));
      expect([...bytes.subarray(0, 4)], copy).toEqual([0x00, 0x01, 0x00, 0x00]);
    }
  });

  it("come with the licence of the package (SIL Open Font License), as it requires", () => {
    expect(readFileSync(here("app/og/fonts/LICENSE.txt"), "utf8")).toBe(readFileSync(here("node_modules/geist/LICENSE.txt"), "utf8"));
    expect(readFileSync(here("app/og/fonts/LICENSE.txt"), "utf8")).toMatch(/SIL OPEN FONT LICENSE/i);
  });

  it("are all imported by app/og/fonts.ts", () => {
    const source = readFileSync(here("app/og/fonts.ts"), "utf8");
    for (const copy of Object.keys(COPIES)) expect(source, copy).toContain(`./fonts/${copy}`);
  });
});
