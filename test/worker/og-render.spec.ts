import { afterEach, describe, expect, it, vi } from "vitest";

import type { CardData } from "../../app/og/types";

// The renderer's seam with workers-og (app/og/render.ts), in the Workers runtime where it runs. `workers-og` is wrapped, not replaced:
// every call still draws, and the options it was given are kept for the tests to look at.

const calls: Array<{ fonts: unknown }> = [];
/** What the next call to `ImageResponse` does instead of drawing, if a test sets it. */
let failWith: Error | undefined;

vi.mock("workers-og", async (importOriginal) => {
  const real = await importOriginal<typeof import("workers-og")>();
  return {
    ...real,
    ImageResponse: class {
      constructor(element: unknown, options: { fonts?: unknown }) {
        calls.push({ fonts: options.fonts });
        if (failWith) {
          const error = failWith;
          // The renderer answers with a stream that draws when it is read; a card it cannot draw fails the stream.
          return new Response(new ReadableStream({ start: (controller) => controller.error(error) }));
        }
        return new real.ImageResponse(element as never, options as never);
      }
    },
  };
});

import { FONTS } from "../../app/og/fonts";
import { renderCard } from "../../app/og/render";
import { pngSize } from "../support/png";

const CARD: CardData = {
  network: "xrpl",
  networkLabel: "XRPL mainnet",
  kind: "Ledger",
  headline: { text: "#107,720,688", mono: true },
  note: "66 transactions",
  footer: [{ text: "Closed " }, { text: "17 Oct 2026, 15:42 UTC" }],
  footerEnd: "11EF78…BC02",
};

afterEach(() => {
  failWith = undefined;
  calls.length = 0;
});

describe("renderCard", () => {
  it("draws a PNG of 1200 × 630", async () => {
    const bytes = new Uint8Array(await renderCard(CARD));
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
  });

  it("gives the renderer the same array of fonts every time: it keeps what it parsed of them under that array, which is 660 KB of TrueType", async () => {
    await renderCard(CARD);
    await renderCard({ ...CARD, headline: { text: "#107,720,689", mono: true } });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.fonts).toBe(calls[1]!.fonts);
    // It is the one array fonts.ts exports, with its five fonts.
    expect(calls[0]!.fonts).toBe(FONTS);
    expect(FONTS.map((font) => `${font.name} ${font.weight}`)).toEqual(["Geist 400", "Geist 500", "Geist 600", "Geist Mono 400", "Geist Mono 500"]);
  });

  it("rejects when the renderer cannot draw the card, with its own error", async () => {
    failWith = new Error("the renderer cannot draw this");
    await expect(renderCard(CARD)).rejects.toThrow("the renderer cannot draw this");
  });
});
