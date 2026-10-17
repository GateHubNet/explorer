// Preloads for the two fonts, so text does not wait for the stylesheet to be parsed before the download starts. The files
// are the ones fonts.css names (Vite gives both the same hashed asset), from the `geist` package, served by this site.

import type { LinkDescriptor } from "react-router";

import mono from "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2?url";
import sans from "../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2?url";

// A font preload must say `crossorigin` even for the same origin, or the browser downloads the file twice.
export const FONT_PRELOADS: LinkDescriptor[] = [sans, mono].map((href) => ({
  rel: "preload",
  href,
  as: "font",
  type: "font/woff2",
  crossOrigin: "anonymous",
}));
