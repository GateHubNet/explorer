import { execFileSync } from "node:child_process";

type Git = (...args: string[]) => string;

const git: Git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/**
 * The id of the build, which vite.config.ts puts in `BUILD_ID`. The edge cache key includes it, so
 * a deploy never serves the previous build's pages; two different builds must never share one.
 *
 * - `BUILD_ID` in the environment wins (a CI run can name the build).
 * - Otherwise the short commit, with `-dirty` when the tree has uncommitted changes.
 * - Without a commit: `dev` for local work, but an error when a Cloudflare environment is selected
 *   (`CLOUDFLARE_ENV`, set by `deploy:staging` and `deploy:production`), where a constant would make
 *   every deploy share cache keys.
 */
export function resolveBuildId({
  env = process.env,
  git: run = git,
}: { env?: Record<string, string | undefined>; git?: Git } = {}): string {
  if (env.BUILD_ID) return env.BUILD_ID;
  try {
    const commit = run("rev-parse", "--short=12", "HEAD").trim();
    if (commit) return run("status", "--porcelain").trim() ? `${commit}-dirty` : commit;
  } catch {
    // No git, or not a repository: handled below.
  }
  if (env.CLOUDFLARE_ENV) {
    throw new Error(
      `Cannot name the build of the "${env.CLOUDFLARE_ENV}" environment: no git commit found. ` +
        "Build inside the repository, or set BUILD_ID.",
    );
  }
  return "dev";
}
