// Keeps the explorer's copy of the data API's OpenAPI document, and the types generated from it, up to date. This file is what the command
// (api-sync.ts) and its tests share; the command does nothing but call `runApiSync`, every time it is run.
//
//   pnpm api:sync    copy $DATA_API_REPO/docs/openapi.yaml (default ../data-api-new) to api/openapi.yaml and
//                    regenerate app/server/openapi.d.ts from it
//   pnpm api:check   regenerate the types from the committed api/openapi.yaml into a temporary file and fail when
//                    app/server/openapi.d.ts differs from it (no data-api-new needed; part of `pnpm verify`)
//
// The document lists paths and parameters but no response schemas (response types are hand-written in
// app/server/api-types.ts), so the generated types serve one purpose: app/server/data-api.ts checks its
// endpoint paths against `paths`, and a path that leaves the API fails `pnpm typecheck`.
//
// (The command used to be this file, and ran only "when run as a script", which it decided by comparing the URL of the module with
// `process.argv[1]`. Through a link to the file or to its directory they differ, and then `pnpm api:check` printed nothing and passed.)

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the document sits in the data API repository, and where its copy and the generated types sit here. */
const SOURCE_DOCUMENT = join("docs", "openapi.yaml");
const COPY = join("api", "openapi.yaml");
const TYPES = join("app", "server", "openapi.d.ts");

/** The command line of openapi-typescript, which this project's devDependencies hold (not the target project's). */
function openapiTypescriptCli(): string {
  const manifest = createRequire(import.meta.url).resolve("openapi-typescript/package.json");
  return join(dirname(manifest), "bin", "cli.js");
}

/**
 * The text of app/server/openapi.d.ts for an OpenAPI document. The same document always gives the same text.
 *
 * Uses the command line rather than the Node API: its default configuration refuses a document with repeated
 * `operationId`s, which the Nest-generated document has (an alias route shares its controller method), and
 * the command line's does not. It runs in a throwaway directory so that no `redocly.yaml` lying around changes
 * the result.
 */
function generateTypes(document: string): string {
  const scratch = mkdtempSync(join(tmpdir(), "api-sync-"));
  try {
    const output = join(scratch, "openapi.d.ts");
    try {
      execFileSync(process.execPath, [openapiTypescriptCli(), document, "--output", output], {
        cwd: scratch,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const { stdout, stderr } = error as { stdout?: string; stderr?: string };
      throw new Error(`openapi-typescript could not read ${document}:\n${(stderr || stdout || String(error)).trim()}`);
    }
    return readFileSync(output, "utf8");
  } finally {
    // The directory made above, and nothing else.
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The commit that last changed the document in a git checkout of the data API, if `repo` is one. */
function sourceCommit(repo: string): string | undefined {
  try {
    const sha = execFileSync("git", ["-C", repo, "log", "-1", "--format=%H", "--", SOURCE_DOCUMENT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha || undefined;
  } catch {
    return undefined;
  }
}

export interface ApiSyncOptions {
  /** Command line arguments after the script name. */
  args: string[];
  /** The environment: `DATA_API_REPO` is read from it. */
  env: Record<string, string | undefined>;
  /** The project to update. */
  root?: string;
  /** Where messages go. */
  log?: (line: string) => void;
}

/** Runs the script; the result is its exit code. */
export async function runApiSync({ args, env, root = ROOT, log = console.log }: ApiSyncOptions): Promise<number> {
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    log(`api-sync: unknown option ${unknown.join(" ")} (usage: api-sync [--check])`);
    return 2;
  }

  try {
    return args.includes("--check") ? check(root, log) : sync(root, env.DATA_API_REPO, log);
  } catch (error) {
    log(`api-sync: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function sync(root: string, repoSetting: string | undefined, log: (line: string) => void): number {
  const repo = repoSetting ? resolve(repoSetting) : resolve(root, "..", "data-api-new");
  const source = join(repo, SOURCE_DOCUMENT);
  if (!existsSync(source)) {
    log(`api-sync: ${source} does not exist. Check out the data API next to this project, or set DATA_API_REPO to its path.`);
    return 1;
  }

  // Generate first, so that a document that does not parse leaves the committed files as they are.
  const types = generateTypes(source);

  mkdirSync(join(root, "api"), { recursive: true });
  mkdirSync(join(root, "app", "server"), { recursive: true });
  copyFileSync(source, join(root, COPY));
  writeFileSync(join(root, TYPES), types);

  const commit = sourceCommit(repo);
  log(`api-sync: copied ${source}${commit ? ` (last changed in data-api-new commit ${commit})` : ""} to ${COPY}`);
  log(`api-sync: regenerated ${TYPES}`);
  return 0;
}

function check(root: string, log: (line: string) => void): number {
  for (const file of [COPY, TYPES]) {
    if (!existsSync(join(root, file))) {
      log(`api-sync: ${file} is missing. Run pnpm api:sync.`);
      return 1;
    }
  }

  if (readFileSync(join(root, TYPES), "utf8") !== generateTypes(join(root, COPY))) {
    log(`api-sync: ${TYPES} is not what ${COPY} generates. Run pnpm api:sync, and commit both files.`);
    return 1;
  }
  log(`api-sync: ${TYPES} is up to date with ${COPY}`);
  return 0;
}
