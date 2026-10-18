// The command of the client bundle check: `tsx scripts/check-bundle.ts [dir]` (`pnpm check:bundle`, the last step of `pnpm verify`). What
// it checks is in bundle-budget.ts. This file does nothing but run it, every time it is run, however it was reached (a link, a relative
// path, another working directory): a gate that cannot tell whether it is the command must fail, not pass, so it does not try to tell.

import { basename, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { checkBundle, formatReport } from "./bundle-budget";

const dir = process.argv[2] ?? fileURLToPath(new URL("../build/client", import.meta.url));
const report = checkBundle(dir);
console.log(formatReport(report));
if (report.problems.length > 0) process.exit(1);
console.log(`\nbundle check passed: ${relative(process.cwd(), dir) || basename(dir)}`);
