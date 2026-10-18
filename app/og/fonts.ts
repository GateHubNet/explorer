// The fonts of the link-preview images: Geist for text and Geist Mono for amounts, accounts, hashes and indexes (spec 8), bundled with the
// Worker and never fetched at runtime. Satori reads TTF, OTF and WOFF but not the WOFF2 the pages use, so these are the `geist` package's
// TTF files, copied to app/og/fonts/ under the extension the Cloudflare Vite plugin turns into an ArrayBuffer (`.bin`; it has no
// rule for `.ttf`). test/unit/og-fonts.test.ts keeps the copies the package's own bytes. The weights are the ones the board uses (the
// board's 650 is the nearest static weight, 600).
//
// Only app/og/render.ts imports this file, and when it draws its first image: the 660 KB of the fonts are not loaded when the Worker starts.

import geistMedium from "./fonts/Geist-Medium.bin";
import geistRegular from "./fonts/Geist-Regular.bin";
import geistSemiBold from "./fonts/Geist-SemiBold.bin";
import geistMonoMedium from "./fonts/GeistMono-Medium.bin";
import geistMonoRegular from "./fonts/GeistMono-Regular.bin";

export const FONTS = [
  { name: "Geist", data: geistRegular, weight: 400, style: "normal" },
  { name: "Geist", data: geistMedium, weight: 500, style: "normal" },
  { name: "Geist", data: geistSemiBold, weight: 600, style: "normal" },
  { name: "Geist Mono", data: geistMonoRegular, weight: 400, style: "normal" },
  { name: "Geist Mono", data: geistMonoMedium, weight: 500, style: "normal" },
] as const;
