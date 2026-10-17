import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { configDefaults, defineConfig } from "vitest/config";

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

// `~/` is `app/`, as in tsconfig.cloudflare.json. The projects below are not built from vite.config.ts, so
// they do not see its `resolve.tsconfigPaths`; each lists the alias itself.
const resolve = { alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) } };

export default defineConfig({
  test: {
    projects: [
      {
        // Pure code: Node. (The components of app/ui need a DOM and are the `components` project.)
        resolve,
        test: {
          name: "unit",
          environment: "node",
          include: ["app/**/*.test.ts", "scripts/**/*.test.ts", "test/unit/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "app/ui/**"],
        },
      },
      {
        // Components and the browser-side code of app/ui: happy-dom.
        resolve,
        test: {
          name: "components",
          environment: "happy-dom",
          include: ["app/ui/**/*.test.{ts,tsx}"],
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
        resolve,
        test: {
          name: "worker",
          include: ["test/worker/**/*.spec.ts"],
          // Process the stylesheet, so that `styles.css?url` in root.tsx is a real URL as it is in the build.
          css: true,
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
