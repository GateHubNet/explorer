import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// test/e2e/stack.ts, run as the command it is, over a stand-in project root (E2E_STACK_ROOT): a build that is only a file, and a `wrangler`
// that is a script of the test's choosing. What is looked at is the Worker's variables file, which holds the key, and what becomes of it.

const stack = fileURLToPath(new URL("../e2e/stack.ts", import.meta.url));
const repository = fileURLToPath(new URL("../../", import.meta.url));

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0).reverse()) undo();
});

/** A project root with a build and the given script as `wrangler`, and a temporary directory of its own for the stack to work in. */
function standIn(wrangler: string | null) {
  const root = mkdtempSync(join(tmpdir(), "t15b-stack-root-"));
  const tmp = mkdtempSync(join(tmpdir(), "t15b-stack-tmp-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => rmSync(tmp, { recursive: true, force: true }));
  mkdirSync(join(root, "build/server"), { recursive: true });
  writeFileSync(join(root, "build/server/wrangler.json"), "{}");
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  if (wrangler !== null) {
    writeFileSync(join(root, "node_modules/.bin/wrangler"), `#!/bin/sh\n${wrangler}\n`);
    chmodSync(join(root, "node_modules/.bin/wrangler"), 0o755);
  } else {
    // Not executable: spawn fails with EACCES.
    writeFileSync(join(root, "node_modules/.bin/wrangler"), "#!/bin/sh\n");
    chmodSync(join(root, "node_modules/.bin/wrangler"), 0o644);
  }
  return { root, tmp };
}

const workdirsIn = (tmp: string) => readdirSync(tmp).filter((name) => name.startsWith("x-explorer-e2e-"));

function start(root: string, tmp: string, extra: Record<string, string> = {}) {
  const output: string[] = [];
  const child = spawn("node", ["--import", "tsx", stack], {
    cwd: repository,
    env: { ...process.env, E2E_STACK_ROOT: root, E2E_SKIP_BUILD: "1", TMPDIR: tmp, E2E_PORT: "8890", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (chunk) => output.push(String(chunk)));
  child.stderr!.on("data", (chunk) => output.push(String(chunk)));
  cleanup.push(() => child.kill("SIGKILL"));
  const exited = new Promise<{ code: number | null; signal: string | null; at: number }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal, at: Date.now() }));
  });
  return { child, output, exited, startedAt: Date.now() };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`gave up waiting for ${what}`);
}

describe("the end-to-end stack", () => {
  it("fails, saying so, and leaves no directory with the key in it, when wrangler cannot be started", async () => {
    const { root, tmp } = standIn(null);
    const run = start(root, tmp);
    const { code } = await run.exited;
    expect(code).toBe(1);
    expect(run.output.join("")).toMatch(/wrangler could not be started/);
    expect(workdirsIn(tmp)).toEqual([]);
  }, 30_000);

  it("fails, and removes its directory, when wrangler ends at once", async () => {
    const { root, tmp } = standIn("exit 3");
    const run = start(root, tmp);
    const { code } = await run.exited;
    expect(code).toBe(1);
    expect(run.output.join("")).toMatch(/wrangler dev ended \(3\)/);
    expect(workdirsIn(tmp)).toEqual([]);
  }, 30_000);

  it("does not wait for a wrangler that has been killed by a signal to say that it has exited", async () => {
    // What Playwright's SIGTERM to the whole process group does to wrangler before the stack has seen it: `signalCode` set, `exitCode` null,
    // and no further 'exit' event to wait for.
    const { root, tmp } = standIn("kill -TERM $$\nsleep 5");
    const run = start(root, tmp);
    const { code, at } = await run.exited;
    expect(code).toBe(1);
    expect(run.output.join("")).toMatch(/wrangler dev ended \(SIGTERM\)/);
    expect(workdirsIn(tmp)).toEqual([]);
    // The stack waits up to 5 s for a wrangler that is still alive; this one is not.
    expect(at - run.startedAt).toBeLessThan(4000);
  }, 30_000);

  it("gives wrangler the variables in a private file that reads back as written, and removes it with its directory on SIGTERM", async () => {
    const { root, tmp } = standIn("sleep 30");
    const key = 'pa$$word$HOME"quoted"';
    const run = start(root, tmp, { E2E_DATA_API_URL: "http://127.0.0.1:1/{net}", E2E_NODE_URL: "http://127.0.0.1:2/{net}-node", E2E_DATA_API_KEY: key });
    await until(() => workdirsIn(tmp).length === 1 && existsSync(join(tmp, workdirsIn(tmp)[0]!, "worker.env")), "the variables file");
    const file = join(tmp, workdirsIn(tmp)[0]!, "worker.env");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("XRPL_DATA_API_URL=\"http://127.0.0.1:1/xrpl\"");
    expect(text).toContain("XAHAU_NODE_URL=\"http://127.0.0.1:2/xahau-node\"");
    // A `$` is escaped, so that wrangler's dotenv-expand reads it back as a `$`.
    expect(text).toContain("DATA_API_KEY='pa\\$\\$word\\$HOME\"quoted\"'");

    (run.child as ChildProcess).kill("SIGTERM");
    const { code } = await run.exited;
    expect(code).toBe(0);
    expect(workdirsIn(tmp)).toEqual([]);
  }, 30_000);
});
