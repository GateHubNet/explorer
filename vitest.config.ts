import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { configDefaults, defineConfig } from "vitest/config";

import { FEATURE_VARS, type FeatureVar } from "./app/ui/features";

// The switches at the top level of wrangler.jsonc, which the `worker` project runs with (README, "Switches"). A switch is "on" here from
// the moment the code it gates is built; `VALIDATORS` is "off" until E6 builds its pages. The `satisfies` fails until a new switch is
// listed. The `worker-off` project does not read this: it sets every switch of `FEATURE_VARS` "off".
const TOP_LEVEL_SWITCHES = { VALIDATORS: "off", AMM_DATA: "on" } satisfies Record<FeatureVar, "on" | "off">;

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

/** A project that runs its specs on the real Worker in workerd, with `bindings` instead of the vars of wrangler.jsonc. */
function workerProject({ name, bindings, include, exclude }: { name: string; bindings: Record<string, string>; include: string[]; exclude?: string[] }) {
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings },
      }),
      reactRouter(),
    ],
    resolve,
    test: {
      name,
      include,
      ...(exclude ? { exclude } : {}),
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
  };
}

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
      workerProject({
        // Loaders and the Worker entry: the Workers runtime (workerd), on the app's own Worker config.
        name: "worker",
        bindings: testBindings,
        include: ["test/worker/**/*.spec.ts"],
        // The files of the project below.
        exclude: [...configDefaults.exclude, "test/worker/**/*-off.spec.ts"],
      }),
      workerProject({
        // The same Worker with every switch "off" (spec 6.1): the off-case of a page or a feature, in files named `*-off.spec.ts`.
        name: "worker-off",
        bindings: { ...testBindings, ...Object.fromEntries(FEATURE_VARS.map((name) => [name, "off"])) },
        include: ["test/worker/**/*-off.spec.ts"],
      }),
    ],
  },
});
