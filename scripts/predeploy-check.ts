// The command of the pre-deploy guard: `tsx scripts/predeploy-check.ts <staging|production> [project root]`. `pnpm deploy:staging` and
// `pnpm deploy:production` run it between `react-router build` and `wrangler deploy`, and the second stops if this exits non-zero.
// What it checks is in predeploy-guard.ts. This file does nothing but run it, every time it is run, however it was reached (a link, a relative
// path, another working directory): a gate that cannot tell whether it is the command must fail, not pass, so it does not try to tell.
//
//   exit 0  the build may be deployed as the environment asked for
//   exit 1  it may not (every reason is printed), or the check itself could not be made
//   exit 2  the command was used wrongly

import { fileURLToPath } from "node:url";

import { checkBuild, ENVIRONMENTS } from "./predeploy-guard";

const [asked, root = fileURLToPath(new URL("..", import.meta.url)), ...extra] = process.argv.slice(2);

if (asked === undefined || !(ENVIRONMENTS as readonly string[]).includes(asked) || extra.length > 0) {
  console.error(`predeploy-check: usage: predeploy-check <${ENVIRONMENTS.join("|")}> [project root]`);
  process.exit(2);
}

let result;
try {
  result = checkBuild(root, asked);
} catch (error) {
  // Whatever goes wrong, the build is not known to be good.
  console.error(`predeploy-check: refusing to deploy for ${asked}: the check failed (${error instanceof Error ? error.message : String(error)})`);
  process.exit(1);
}

if (result.problems.length > 0) {
  console.error(`predeploy-check: refusing to deploy the build for ${asked}:`);
  for (const problem of result.problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`predeploy-check: ${result.summary}`);
