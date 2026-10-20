import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

import { resolveBuildId } from "./scripts/build-id";
import { shellChunks } from "./scripts/shell-chunks.ts";

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // Merged into the vars of the selected Cloudflare environment.
      config: { vars: { BUILD_ID: resolveBuildId() } },
    }),
    reactRouter(),
    // What every page loads, in two files (the packages, the app's shell) instead of about nine: scripts/shell-chunks.ts.
    shellChunks({ appDirectory: fileURLToPath(new URL("./app", import.meta.url)) }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
