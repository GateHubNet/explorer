// The command of the API description: `tsx scripts/api-sync.ts [--check]` (`pnpm api:sync`, `pnpm api:check`; the check is the first step of
// `pnpm verify`). What it does is in api-sync-core.ts. This file does nothing but run it, every time it is run, however it was reached (a link,
// a relative path, another working directory): a gate that cannot tell whether it is the command must fail, not pass, so it does not try to tell.

import { runApiSync } from "./api-sync-core";

process.exitCode = await runApiSync({ args: process.argv.slice(2), env: process.env });
