// What the page specs of test/worker/ share: asking the real Worker for a page, reading the HTML as text and as
// anchors, and looking at the copy the edge cache stored (its class and TTL are internal headers that visitors never
// see, so the specs read the Cache API directly, as edge-cache.spec.ts does).

import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";

import { edgeCacheKey } from "../../app/server/edge-cache";
import { cacheGeneration } from "../../app/server/env";
import { warmWorker } from "./warm-worker";

const ORIGIN = "https://explorer.test";

/**
 * A client for one spec file. The visitor limit is per address, so each file takes its own range of the documentation
 * addresses (RFC 5737) and every request its own address.
 */
export function pageClient(addressPrefix: string) {
  warmWorker();
  let visitors = 0;

  const get = (path: string, headers: Record<string, string> = {}) =>
    exports.default.fetch(`${ORIGIN}${path}`, {
      headers: { "CF-Connecting-IP": `${addressPrefix}.${++visitors}`, ...headers },
      redirect: "manual",
    });

  /** The answer to a HEAD of `path`. */
  const head = (path: string, headers: Record<string, string> = {}) =>
    exports.default.fetch(`${ORIGIN}${path}`, {
      method: "HEAD",
      headers: { "CF-Connecting-IP": `${addressPrefix}.${++visitors}`, ...headers },
      redirect: "manual",
    });

  /** The HTML of a page; fails with the start of the body when the status is not the expected one. */
  async function page(path: string, status = 200) {
    const response = await get(path);
    const html = await response.text();
    expect(response.status, html.slice(0, 400)).toBe(status);
    return { response, html };
  }

  /** The copy the edge cache stored for `path` (it is stored behind the answer, in waitUntil). */
  async function stored(path: string): Promise<Response | undefined> {
    const key = edgeCacheKey(`${ORIGIN}${path}`, cacheGeneration(env));
    for (let tries = 0; tries < 80; tries += 1) {
      const hit = await caches.default.match(key);
      if (hit) return hit;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return undefined;
  }

  /** The class and TTL the entry stored `path` under. */
  async function storedAs(path: string) {
    const copy = await stored(path);
    expect(copy, `nothing stored for ${path}`).toBeDefined();
    return { cls: copy!.headers.get("X-Edge-Class"), ttl: Number(copy!.headers.get("X-Edge-Ttl")) };
  }

  return { get, head, page, stored, storedAs };
}

/** The anchors of some HTML: their attributes as written and the text inside them. */
export function anchors(html: string): Array<{ attrs: string; text: string }> {
  return [...html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    attrs: match[1]!,
    text: textOf(match[2]!),
  }));
}

/** The `href`s of the anchors. */
export function hrefs(html: string): string[] {
  return anchors(html).flatMap((a) => /href="([^"]*)"/.exec(a.attrs)?.[1] ?? []);
}

/** The visible text of some HTML: no scripts, styles or tags, entities decoded, white space collapsed. */
export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The text of the first element whose `class` has `className`, with its tags taken out and nothing put in their place, so
 * that a sentence made of inline pieces reads as the visitor reads it (`textOf` puts a space where a tag was).
 */
export function elementText(html: string, className: string): string | undefined {
  const open = new RegExp(`<(\\w+)\\s[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`).exec(html);
  if (!open) return undefined;
  const name = open[1]!;
  const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, "g");
  tags.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[1] === "/" ? -1 : 1;
    if (depth === 0) {
      const inner = html.slice(open.index + open[0].length, tag.index);
      return inner.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    }
  }
  return undefined;
}

/**
 * The rows of the table named `label` (its `role="row"` elements, header included) as arrays of cell texts. A cell holds
 * no `div`, so a row ends at its first `</div>`.
 */
export function tableRows(html: string, label: string): string[][] {
  const start = html.indexOf(`role="table" aria-label="${label}"`);
  if (start < 0) return [];
  const end = html.indexOf('role="table"', start + 10);
  const section = html.slice(start, end < 0 ? undefined : end);
  return [...section.matchAll(/<div role="row"[^>]*>([\s\S]*?)<\/div>/g)].map((row) =>
    row[1]!
      .split(/role="(?:cell|columnheader)"/)
      .slice(1)
      // A chunk ends where the next cell's tag was cut: `<span class="table__cell" `.
      .map((chunk) => textOf(chunk.slice(chunk.indexOf(">") + 1).replace(/<span\s[^>]*$/, ""))),
  );
}
