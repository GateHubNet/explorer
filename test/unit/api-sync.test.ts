import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runApiSync } from "../../scripts/api-sync";

// OpenAPI documents the way data-api-new writes them: quoted path keys, parameters, and no response schemas.
const DOCUMENT = `openapi: 3.0.0
paths:
  "/v2/last_validated":
    get:
      operationId: LedgersController_lastValidated
      parameters: []
      responses:
        '200':
          description: The newest validated ledger
  "/v2/ledgers/{ledger_param}":
    get:
      operationId: LedgersController_ledger
      parameters:
        - name: ledger_param
          required: true
          in: path
          schema:
            type: string
        - name: expand
          required: false
          in: query
          schema:
            type: boolean
      responses:
        '200':
          description: A ledger
servers: []
components: {}
`;

const WITH_ONE_MORE_PATH = DOCUMENT.replace(
  "servers: []",
  `  "/v2/network/fees":
    get:
      operationId: FeesController_fees
      parameters: []
      responses:
        '200':
          description: Fees
servers: []`,
);

let base: string;
let repo: string; // stands for data-api-new
let project: string; // stands for x-explorer
let output: string[];

const log = (line: string) => output.push(line);
const run = (args: string[] = [], env: Record<string, string | undefined> = { DATA_API_REPO: repo }) =>
  runApiSync({ args, env, root: project, log });
const read = (path: string) => readFileSync(join(project, path), "utf8");

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "api-sync-test-"));
  repo = join(base, "data-api-new");
  project = join(base, "x-explorer");
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(project);
  writeFileSync(join(repo, "docs", "openapi.yaml"), DOCUMENT);
  output = [];
});

afterEach(() => {
  // Only the directory this test made.
  rmSync(base, { recursive: true, force: true });
});

describe("pnpm api:sync", () => {
  it("copies $DATA_API_REPO/docs/openapi.yaml into api/openapi.yaml and regenerates app/server/openapi.d.ts", async () => {
    expect(await run()).toBe(0);

    expect(read("api/openapi.yaml")).toBe(DOCUMENT);
    const types = read("app/server/openapi.d.ts");
    expect(types).toContain("export interface paths");
    expect(types).toContain('"/v2/last_validated"');
    expect(types).toContain('"/v2/ledgers/{ledger_param}"');
    expect(types).not.toContain("/v2/network/fees");
  });

  it("generates the same file every time", async () => {
    await run();
    const first = read("app/server/openapi.d.ts");
    await run();
    expect(read("app/server/openapi.d.ts")).toBe(first);
  });

  it("replaces an older copy and its types", async () => {
    await run();
    writeFileSync(join(repo, "docs", "openapi.yaml"), WITH_ONE_MORE_PATH);

    expect(await run()).toBe(0);

    expect(read("api/openapi.yaml")).toBe(WITH_ONE_MORE_PATH);
    expect(read("app/server/openapi.d.ts")).toContain('"/v2/network/fees"');
  });

  it("looks for ../data-api-new next to the project when $DATA_API_REPO is not set", async () => {
    expect(await run([], {})).toBe(0);
    expect(read("api/openapi.yaml")).toBe(DOCUMENT);
  });

  it("names the commit the copy comes from, when the source is a git checkout", async () => {
    // A throwaway repository, in the temp directory this test made.
    const { execFileSync } = await import("node:child_process");
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "--quiet");
    git("add", "docs/openapi.yaml");
    const identity = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"];
    git(...identity, "commit", "--quiet", "-m", "openapi");
    const sha = git("rev-parse", "HEAD");

    await run();

    expect(output.join("\n")).toContain(sha);
  });

  it("changes nothing and says where it looked when the document is missing", async () => {
    rmSync(join(repo, "docs", "openapi.yaml"));

    expect(await run()).toBe(1);

    expect(output.join("\n")).toContain(join(repo, "docs", "openapi.yaml"));
    expect(output.join("\n")).toContain("DATA_API_REPO");
    expect(existsSync(join(project, "api"))).toBe(false);
    expect(existsSync(join(project, "app"))).toBe(false);
  });

  it("keeps the committed copy and types when the new document does not parse", async () => {
    await run();
    writeFileSync(join(repo, "docs", "openapi.yaml"), "openapi: 3.0.0\npaths: [this is: not: valid\n");

    expect(await run()).toBe(1);

    expect(read("api/openapi.yaml")).toBe(DOCUMENT);
    expect(read("app/server/openapi.d.ts")).toContain('"/v2/last_validated"');
  });
});

describe("pnpm api:check", () => {
  it("passes when app/server/openapi.d.ts is what api/openapi.yaml generates", async () => {
    await run();
    expect(await run(["--check"], {})).toBe(0);
  });

  it("does not need data-api-new, and writes nothing", async () => {
    await run();
    const before = [read("api/openapi.yaml"), read("app/server/openapi.d.ts")];
    rmSync(repo, { recursive: true, force: true });

    expect(await run(["--check"], {})).toBe(0);

    expect([read("api/openapi.yaml"), read("app/server/openapi.d.ts")]).toEqual(before);
  });

  it("fails when the committed copy changed and the types were not regenerated", async () => {
    await run();
    writeFileSync(join(project, "api", "openapi.yaml"), WITH_ONE_MORE_PATH);

    expect(await run(["--check"], {})).toBe(1);

    expect(output.join("\n")).toContain("pnpm api:sync");
  });

  it("fails when the committed types were edited by hand", async () => {
    await run();
    writeFileSync(join(project, "app", "server", "openapi.d.ts"), `${read("app/server/openapi.d.ts")}\n// edited\n`);

    expect(await run(["--check"], {})).toBe(1);
  });

  it("fails when the types are missing", async () => {
    await run();
    rmSync(join(project, "app", "server", "openapi.d.ts"));

    expect(await run(["--check"], {})).toBe(1);
    expect(output.join("\n")).toContain("openapi.d.ts");
  });

  it("fails when the copy is missing", async () => {
    expect(await run(["--check"], {})).toBe(1);
    expect(output.join("\n")).toContain("api/openapi.yaml");
  });
});

describe("arguments", () => {
  it("refuses an option it does not know", async () => {
    expect(await run(["--chek"])).toBe(2);
    expect(output.join("\n")).toContain("--chek");
    expect(existsSync(join(project, "api"))).toBe(false);
  });
});
