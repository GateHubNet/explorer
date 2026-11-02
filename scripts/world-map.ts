// The command of the validators map: `tsx scripts/world-map.ts [--check]` (`pnpm map:sync`, `pnpm map:check`). What the files are made of is in world-map-core.ts and
// world-map-data.ts, which the test (world-map.test.ts) imports too; a module that runs when it is imported cannot be, so this file does nothing but the command.
//
//   pnpm map:sync    write app/ui/map/world-dots.svg (the dots, a static asset) and app/server/countries.ts (the 250 countries' names, points and order)
//   pnpm map:check   change nothing; name the files that are missing or differ from what map:sync would write, and exit 1 when there is one
//
// The check is also a test (world-map.test.ts), so `pnpm test` fails when the outputs and the data part ways. Nothing here needs the network.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OUTPUTS, staleOutputs } from "./world-map-core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function main(argv: string[]): number {
  if (argv.includes("--check")) {
    const stale = staleOutputs(ROOT);
    for (const path of stale) console.error(`stale: ${path}`);
    if (stale.length > 0) {
      console.error(`${stale.length} generated map file(s) out of date: run pnpm map:sync`);
      return 1;
    }
    console.log(`${OUTPUTS.length} generated map files are up to date`);
    return 0;
  }
  for (const { path, text } of OUTPUTS) {
    const target = join(ROOT, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text());
    console.log(`wrote ${path}`);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
