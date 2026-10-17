import { describe, expect, it } from "vitest";

import { resolveBuildId } from "./build-id";

/** A fake `git` for a repository at commit `sha`, with `status` as the output of `git status --porcelain`. */
function repo(sha: string, status: string) {
  return (...args: string[]) => {
    if (args[0] === "rev-parse") return `${sha}\n`;
    if (args[0] === "status") return status;
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

const noGit = () => {
  throw new Error("git: command not found");
};

describe("resolveBuildId", () => {
  it("is the short commit of a clean tree", () => {
    expect(resolveBuildId({ env: {}, git: repo("0822c3a1b864", "") })).toBe("0822c3a1b864");
  });

  it("marks a tree with uncommitted changes", () => {
    expect(resolveBuildId({ env: {}, git: repo("0822c3a1b864", " M vite.config.ts\n?? scripts/\n") })).toBe(
      "0822c3a1b864-dirty",
    );
  });

  it("refuses to build for a Cloudflare environment when there is no commit to name the build", () => {
    expect(() => resolveBuildId({ env: { CLOUDFLARE_ENV: "production" }, git: noGit })).toThrow(/BUILD_ID/);
  });

  it("is 'dev' for local work without git", () => {
    expect(resolveBuildId({ env: {}, git: noGit })).toBe("dev");
  });

  it("takes an explicit BUILD_ID, even without git", () => {
    expect(resolveBuildId({ env: { BUILD_ID: "ci-1234", CLOUDFLARE_ENV: "production" }, git: noGit })).toBe("ci-1234");
  });
});
