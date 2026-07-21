// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";

// Static-first (pure SSG). This is deliberate — see
// docs/design/marketing-website/plan.md.
//
// Do NOT add @astrojs/cloudflare here. That adapter silently flips the project
// to Workers SSR (output becomes server-rendered) and breaks the static build.
// The site deploys to Cloudflare Workers Static Assets via Workers Builds; the
// asset binding lives in wrangler.jsonc, not in an Astro adapter.
//
// - @astrojs/react : future interactive islands (the landing's template explorer
//                    is the first one).
// - @astrojs/mdx   : the future blog (post bodies authored as MDX).
export default defineConfig({
  output: "static",
  site: "https://agenta.ai",
  integrations: [react(), mdx()],
  vite: {
    // Pin the dev dependency optimizer to development. If the dev server inherits
    // NODE_ENV=production from the shell, esbuild pre-bundles React's *production*
    // jsx-dev-runtime (where jsxDEV is a no-op), which throws "jsxDEV is not a
    // function" on hydration and blanks every client:visible island. This define
    // only affects the dev pre-bundle; `astro build` uses Rollup and ignores it.
    optimizeDeps: {
      esbuildOptions: {
        define: { "process.env.NODE_ENV": '"development"' },
      },
    },
  },
});
