// The command that writes the generated upstream fixtures (data API and node answers for the recorded ledgers) into test/fixtures/http/, or
// checks that they are what the recordings and the generator in http-fixtures.ts give.
//
//   pnpm fixtures:sync    write the files; names the committed files that no longer belong
//   pnpm fixtures:check   change nothing; fail when a file differs, is missing, or no longer belongs
//
// The check is also a test (http-fixtures.test.ts), so `pnpm test` fails when the fixtures and the generator part ways.
// Nothing is ever deleted here: a stale file is reported, and removed by hand.
//
// This file does nothing but run the command, every time it is run, however it was reached (a link, a relative path, another working
// directory): a gate that cannot tell whether it is the command must fail, not pass, so it does not try to tell. (It used to run "only when
// run as a script", decided by comparing the URL of the module with `process.argv[1]`, and through a link it printed nothing and passed.)
// What the test and the command share, `compare`, is in http-fixtures.ts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { compare, generate, HTTP } from "./http-fixtures";

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

process.exitCode = main(process.argv.slice(2));
