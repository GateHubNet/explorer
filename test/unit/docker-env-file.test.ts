import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// docker/write-env-file.sh writes the env file the container image's `wrangler dev --env-file` reads (docker/entrypoint.sh). It must carry
// each value over as it is, the way scripts/e2e-env.ts formatEnvFile does for the end-to-end suite: wrangler reads the file with dotenv,
// then dotenv-expand, which rewrites `$NAME` and `${NAME}`.

const SCRIPT = join(import.meta.dirname, "../../docker/write-env-file.sh");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workdir(): string {
  const dir = mkdtempSync(join(tmpdir(), "docker-env-file-"));
  dirs.push(dir);
  return dir;
}

/** Runs the script with exactly `values` (and PATH) as its environment, writing to a new file. */
function write(values: Record<string, string>): { dir: string; file: string; status: number | null; stderr: string } {
  const dir = workdir();
  const file = join(dir, "worker.env");
  const run = spawnSync("sh", [SCRIPT, file], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...values }, encoding: "utf8" });
  return { dir, file, status: run.status, stderr: run.stderr };
}

/** What `wrangler dev --env-file <file>` makes of the file: wrangler's own loader (dotenv, then dotenv-expand). */
async function throughWrangler(dir: string, file: string): Promise<Record<string, string>> {
  const { unstable_getVarsForDev } = await import("wrangler");
  const vars = unstable_getVarsForDev(join(dir, "wrangler.json"), [file], {}, undefined, true);
  return Object.fromEntries(Object.entries(vars).map(([name, binding]) => [name, String((binding as { value: unknown }).value)]));
}

describe("docker/write-env-file.sh", () => {
  // Values a key or a URL may hold that dotenv-expand would rewrite, quotes of every kind, and a `#` that is not a comment.
  const TRICKY = {
    DATA_API_KEY: "pa$$word$XRPL_NODE_URL${HOME}end",
    XRPL_NODE_URL: "https://node.example/a?b=1&c=$d#frag",
    XAHAU_NODE_URL: 'say "hi" it\'s # not a comment $x',
    SENTRY_DSN: 'a "b" `c` $d',
    XRPL_DATA_API_URL: "  padded  ",
    XAHAU_DATA_API_URL: "plain",
    AMM_PAGES: "off",
  };

  it("is read back by wrangler as it was written, whatever the value holds", async () => {
    const { dir, file, status } = write(TRICKY);
    expect(status).toBe(0);
    expect(await throughWrangler(dir, file)).toEqual(TRICKY);
  });

  it("writes only the Worker's own names, and none that is empty", async () => {
    const { dir, file, status } = write({ DATA_API_KEY: "k", MARKETS: "", HOME: "/home/node", NODE_ENV: "production" });
    expect(status).toBe(0);
    expect(await throughWrangler(dir, file)).toEqual({ DATA_API_KEY: "k" });
  });

  it.each([
    ["a backslash", "a\\nb"],
    ["a line break", "a\nb"],
    // A command substitution drops trailing line breaks: the script must still see this one, not pass the key on shortened.
    ["a trailing line break", "key\n"],
    ["every kind of quote", "\"'`"],
  ])("refuses a value with %s, by name, rather than corrupt it", (_what, value) => {
    const { file, status, stderr } = write({ DATA_API_KEY: value });
    expect(status).toBe(1);
    expect(stderr).toContain("DATA_API_KEY");
    expect(() => readFileSync(file, "utf8")).toThrow();
  });
});
