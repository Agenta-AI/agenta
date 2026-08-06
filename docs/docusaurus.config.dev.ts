// @ts-check
import type { Config } from "@docusaurus/types";

import createBaseConfig from "./docusaurus.config";

/**
 * Local development config, used by `pnpm start`.
 *
 * It reuses the production config and overrides only what has to differ on a
 * developer machine: the site URL and base path, the third-party analytics
 * scripts, and the PostHog settings. Navigation, sidebars, redirects and
 * plugins deliberately live in docusaurus.config.ts alone, so the local site
 * always shows the same structure as production.
 */
export default async function createDevConfig(): Promise<Config> {
  const baseConfig = await createBaseConfig();

  return {
    ...baseConfig,

    url: "http://localhost:5000",
    // Production serves the docs under /docs/; locally they sit at the root.
    baseUrl: "/",

    // No Google Analytics or Hotjar locally.
    scripts: [],

    plugins: (baseConfig.plugins ?? []).map((plugin) =>
      Array.isArray(plugin) && plugin[0] === "posthog-docusaurus"
        ? [
            plugin[0],
            {
              ...(plugin[1] as Record<string, unknown>),
              apiKey: "dummy",
              appUrl: "http://localhost:5000",
            },
          ]
        : plugin,
    ),
  };
}
