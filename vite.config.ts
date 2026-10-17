import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

import { resolveBuildId } from "./scripts/build-id";

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // Merged into the vars of the selected Cloudflare environment.
      config: { vars: { BUILD_ID: resolveBuildId() } },
    }),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
