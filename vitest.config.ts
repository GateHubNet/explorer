import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vitest/config";

// Pinned for the worker project, so that a developer's .dev.vars (a real key, a Sentry DSN, a local
// data API) cannot change what the tests do or where they send requests.
const testBindings = {
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  SENTRY_DSN: "",
  BUILD_ID: "test-build",
};

export default defineConfig({
  test: {
    projects: [
      {
        // Pure code and components: Node.
        test: {
          name: "unit",
          environment: "node",
          include: ["app/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "test/unit/**/*.test.ts"],
        },
      },
      {
        // Loaders and the Worker entry: the Workers runtime (workerd), on the app's own Worker config.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: testBindings },
          }),
          reactRouter(),
        ],
        test: {
          name: "worker",
          include: ["test/worker/**/*.spec.ts"],
          // CommonJS packages that require() ES modules cannot be loaded as they are in workerd, so
          // Vite pre-bundles them, as it does in the production build.
          deps: {
            optimizer: {
              ssr: { enabled: true, include: ["ripple-address-codec"] },
            },
          },
        },
      },
    ],
  },
});
