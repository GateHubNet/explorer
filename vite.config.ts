import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

import { analyticsKitCopy } from "./scripts/analytics-kit-copy.ts";
import { resolveBuildId } from "./scripts/build-id";
import { shellChunks } from "./scripts/shell-chunks.ts";

export default defineConfig({
  plugins: [
    // The analytics view's own copy of the chart kit, in its lazy chunk: the network route keeps its kit to itself, at the cost of about 8.5 KB more on a first analytics view after the network page (scripts/analytics-kit-copy.ts).
    analyticsKitCopy({ appDirectory: fileURLToPath(new URL("./app", import.meta.url)) }),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // Merged into the vars of the selected Cloudflare environment.
      config: { vars: { BUILD_ID: resolveBuildId() } },
    }),
    reactRouter(),
    // What every page loads, and what every page of the budget loads, in one file instead of about nine: scripts/shell-chunks.ts.
    shellChunks({ appDirectory: fileURLToPath(new URL("./app", import.meta.url)) }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
