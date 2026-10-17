// Writes the generated upstream fixtures (data API and node answers for the recorded ledgers) into
// test/fixtures/http/, or checks that they are what the recordings and the generator in http-fixtures.ts give.
//
//   pnpm fixtures:sync    write the files; names the committed files that no longer belong
//   pnpm fixtures:check   change nothing; fail when a file differs, is missing, or no longer belongs
//
// The check is also a test (http-fixtures.test.ts), so `pnpm test` fails when the fixtures and the generator part ways.
// Nothing is ever deleted here: a stale file is reported, and removed by hand.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { generate, HTTP, isHandWritten } from "./http-fixtures";

/** Every file below `dir`, as paths relative to it. */
function filesBelow(dir: URL, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...filesBelow(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`));
    else found.push(`${prefix}${entry.name}`);
  }
  return found;
}

export interface Differences {
  /** Generated files that are not on disk. */
  missing: string[];
  /** Generated files whose text differs from the disk's. */
  changed: string[];
  /** Files on disk that are neither generated nor written by hand. */
  stale: string[];
}

export function compare(generated: Map<string, string>): Differences {
  const missing: string[] = [];
  const changed: string[] = [];
  for (const [path, text] of generated) {
    let onDisk: string;
    try {
      onDisk = readFileSync(new URL(path, HTTP), "utf8");
    } catch {
      missing.push(path);
      continue;
    }
    if (onDisk !== text) changed.push(path);
  }
  let present: string[] = [];
  try {
    present = filesBelow(HTTP);
  } catch {
    // No fixtures directory yet.
  }
  const stale = present.filter((path) => !generated.has(path) && !isHandWritten(path));
  return { missing: missing.sort(), changed: changed.sort(), stale: stale.sort() };
}

function main(argv: string[]): number {
  const generated = generate();
  const differences = compare(generated);
  const problems = (label: string, paths: string[]) => paths.forEach((path) => console.error(`${label}: ${path}`));

  if (argv.includes("--check")) {
    problems("missing", differences.missing);
    problems("differs", differences.changed);
    problems("stale", differences.stale);
    const count = differences.missing.length + differences.changed.length + differences.stale.length;
    if (count > 0) {
      console.error(`${count} fixture file(s) out of date: run pnpm fixtures:sync`);
      return 1;
    }
    console.log(`${generated.size} generated fixture files are up to date`);
    return 0;
  }

  let written = 0;
  for (const path of [...differences.missing, ...differences.changed]) {
    const target = fileURLToPath(new URL(path, HTTP));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, generated.get(path)!);
    written++;
  }
  console.log(`${written} written, ${generated.size - written} unchanged`);
  problems("stale (remove by hand)", differences.stale);
  return 0;
}

// Run as a script, not when a test imports `compare`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
