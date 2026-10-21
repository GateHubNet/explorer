import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { configDefaults, defineConfig } from "vitest/config";

import { FEATURE_VARS, type FeatureVar } from "./app/ui/features.ts";

// The switches at the top level of wrangler.jsonc, which the `worker` project runs with (README, "Switches"). A switch is "on" here from
// the moment the code it gates is built (`VALIDATORS`, `AMM_DATA`, `MARKETS`, `ACCOUNT_ANALYTICS`). The `satisfies` fails until a new switch is
// listed. The `worker-off` project does not read this: it sets every switch of `FEATURE_VARS` "off".
const TOP_LEVEL_SWITCHES = { VALIDATORS: "on", AMM_DATA: "on", MARKETS: "on", ACCOUNT_ANALYTICS: "on" } satisfies Record<FeatureVar, "on" | "off">;

// Pinned for the worker projects, so that a developer's .dev.vars (a real key, a Sentry DSN, a local
// data API) cannot change what the tests do or where they send requests.
const testBindings = {
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  SENTRY_DSN: "",
  BUILD_ID: "test-build",
  ...TOP_LEVEL_SWITCHES,
};

// `~/` is `app/`, as in tsconfig.cloudflare.json. The projects below are not built from vite.config.ts, so
// they do not see its `resolve.tsconfigPaths`; each lists the alias itself.
const resolve = { alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) } };

// The `worker-off` project's bindings: the same, with every switch of `FEATURE_VARS` "off".
const offBindings = { ...testBindings, ...Object.fromEntries(FEATURE_VARS.map((name) => [name, "off"])) };

export default defineConfig({
  // The root config is the Worker projects' (`worker` and `worker-off`, below): they share its one Vite server, and so its one React Router
  // plugin. That plugin removes and rewrites `.react-router/types` each time a server starts, and two of them starting together raced on the
  // directory (ENOTEMPTY, EINVAL: `pnpm test` sometimes failed to start). What tells the two projects apart is the `workerBindings` each is
  // `provide`d, which the Workers plugin reads for its Miniflare. `unit` and `components` have servers of their own and do not extend this.
  plugins: [
    cloudflareTest(({ inject }) => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: inject<Record<string, string>>("workerBindings") },
    })),
    reactRouter(),
  ],
  resolve,
  test: {
    // Process the stylesheet, so that `styles.css?url` in root.tsx is a real URL as it is in the build.
    css: true,
    // Every dependency goes through Vite: workerd cannot load what Node would (extensionless imports inside node_modules, such as
    // @opentelemetry/api's, which @sentry/cloudflare needs). The Workers plugin sets this on its own project; the children here share the
    // root's server and read the root's test options, so it is written out.
    server: { deps: { inline: true } },
    // CommonJS packages that require() ES modules cannot be loaded as they are in workerd, so
    // Vite pre-bundles them, as it does in the production build.
    deps: {
      optimizer: {
        ssr: { enabled: true, include: ["ripple-address-codec"] },
      },
    },
    projects: [
      {
        // Pure code: Node. (The components of app/ui need a DOM and are the `components` project.)
        extends: false,
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
        extends: false,
        resolve,
        test: {
          name: "components",
          environment: "happy-dom",
          include: ["app/ui/**/*.test.{ts,tsx}"],
        },
      },
      {
        // Loaders and the Worker entry: the Workers runtime (workerd), on the app's own Worker config.
        test: {
          name: "worker",
          include: ["test/worker/**/*.spec.ts"],
          // The files of the project below.
          exclude: [...configDefaults.exclude, "test/worker/**/*-off.spec.ts"],
          provide: { workerBindings: testBindings },
        },
      },
      {
        // The same Worker with every switch "off" (spec 6.1): the off-case of a page or a feature, in files named `*-off.spec.ts`.
        test: {
          name: "worker-off",
          include: ["test/worker/**/*-off.spec.ts"],
          provide: { workerBindings: offBindings },
        },
      },
    ],
  },
});
