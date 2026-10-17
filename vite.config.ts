import { execFileSync } from "node:child_process";

import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

/** The commit being built. It keys the edge cache, so a deploy never serves the previous build's pages. */
function buildId(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // Merged into the vars of the selected Cloudflare environment.
      config: { vars: { BUILD_ID: buildId() } },
    }),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
