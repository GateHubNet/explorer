// The command of the client bundle check: `tsx scripts/check-bundle.ts [dir]` (`pnpm check:bundle`, the last step of `pnpm verify`). What
// it checks is in bundle-budget.ts, and, in the same route manifest, that the build has the chunk every page loads (`shell`, with the
// packages in it: shell-chunks.ts), and in the same files that the analytics view loads none beyond the account page's but its own chunk
// (analytics-kit-copy.ts). This file does nothing but run them, every time it is run, however it was reached (a link, a relative path,
// another working directory): a gate that cannot tell whether it is the command must fail, not pass, so it does not try to tell. A missing
// build or manifest fails, and says so.

import { basename, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { kitCopyProblems } from "./analytics-kit-copy";
import { checkBundle, formatReport, readManifest } from "./bundle-budget";
import { shellManifestProblems } from "./shell-chunks";

const dir = process.argv[2] ?? fileURLToPath(new URL("../build/client", import.meta.url));
const report = checkBundle(dir);
// What is wrong with the manifest itself is in the report already.
const found = readManifest(dir, []);
if (found) report.problems.push(...shellManifestProblems(found.manifest));
report.problems.push(...kitCopyProblems(report));
console.log(formatReport(report));
if (report.problems.length > 0) process.exit(1);
console.log(`\nbundle check passed: ${relative(process.cwd(), dir) || basename(dir)}`);
