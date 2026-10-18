// Draws a card (app/og/card.tsx) as a PNG of 1200 × 630 with workers-og: Satori lays the elements out and draws them as SVG, resvg
// (WebAssembly) makes the PNG. Worker-only code, and the only place that names the renderer.
//
// The renderer (about 1.5 MB with its two WebAssembly modules) and the fonts are imported when the first image is drawn, so they are no
// weight on the Worker's start or on any other route, and never reach the browser (test/unit/og-bundle.test.ts). The renderer
// logs a line to the console on each call (its own, `init RESVG`); that is the library's, not ours.

import { card } from "./card";
import { CARD_HEIGHT, CARD_WIDTH, type CardData } from "./types";

/** The PNG of a card. Rejects if the renderer cannot draw it. */
export async function renderCard(data: CardData): Promise<ArrayBuffer> {
  const [{ ImageResponse }, { FONTS }] = await Promise.all([import("workers-og"), import("./fonts")]);
  const image = new ImageResponse(card(data), { width: CARD_WIDTH, height: CARD_HEIGHT, format: "png", fonts: [...FONTS] });
  // The renderer answers with a stream that starts drawing when it is read; a card it cannot draw fails here.
  const bytes = await image.arrayBuffer();
  if (!image.ok) throw new Error(`the renderer answered ${image.status}`);
  return bytes;
}
