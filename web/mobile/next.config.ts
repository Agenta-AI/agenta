import path from "path"

import type {NextConfig} from "next"

const nextConfig: NextConfig = {
    // Path mount: Traefik routes PathPrefix(`/m`) here with NO stripprefix —
    // the app itself owns the prefix (assets, links, and routes all under /m).
    basePath: "/m",
    output: "standalone",
    // Workspace packages ship TS source (main: ./src/index.ts) — Next must
    // transpile the full dependency closure (chat → entities/playground/shared;
    // entities → sdk/api-client/shared/ui). Same mechanism as web/oss.
    transpilePackages: [
        "@agenta/auth",
        "@agenta/auth-ui",
        "@agenta/sdk",
        "@agentaai/api-client",
        "@agenta/shared",
        "@agenta/ui",
        "@agenta/entities",
        "@agenta/entity-ui",
        "@agenta/navigation",
        "@agenta/navigation-ui",
        "@agenta/sessions",
        "@agenta/sessions-ui",
        "@agenta/settings",
        "@agenta/settings-ui",
        "@agenta/home-ui",
        "@agenta/observability",
        "@agenta/playground",
        "@agenta/playground-ui",
        "@agenta/chat",
    ],
    // Next 16 appends a managed "nextjs-agent-rules" block to AGENTS.md on every
    // `next dev`. This repo curates its own agent instructions (see the root
    // AGENTS.md compartmentalization playbook), so keep the framework out of that
    // file — otherwise every mobile dev run dirties a tracked file.
    agentRules: false,
    reactStrictMode: true,
    pageExtensions: ["ts", "tsx"],
    productionBrowserSourceMaps: true,
    // Workspace root, so standalone output nests as .next/standalone/mobile/
    // (same pattern as web/oss).
    outputFileTracingRoot: path.resolve(__dirname, ".."),
    // Same policy as web/oss: the type gate runs as a dedicated turbo task, not inside
    // `next build`. (Next 16 removed the `eslint` option; `next build` no longer lints.)
    typescript: {
        ignoreBuildErrors: true,
    },
    async headers() {
        return [
            {
                // `__env.js` is per-deployment RUNTIME config (regenerated on each
                // container start by web/entrypoint.sh), not an immutable build
                // asset — force it uncacheable. `source` is basePath-relative,
                // so this matches /m/__env.js. Mirrors web/oss/next.config.ts.
                source: "/__env.js",
                headers: [{key: "Cache-Control", value: "no-store, must-revalidate"}],
            },
        ]
    },
    // Turbopack drives both `next dev` and `next build` in Next 16, so this is no longer
    // dev-only: the build needs the same workspace root to resolve the monorepo.
    turbopack: {
        root: path.resolve(__dirname, ".."),
        // Optional zod-alternative peers the AI SDK guards with try/catch. Resolving them
        // to an empty module keeps the unused adapters out of the graph.
        resolveAlias: {
            effect: "./src/lib/emptyModule.ts",
            arktype: "./src/lib/emptyModule.ts",
            "@valibot/to-json-schema": "./src/lib/emptyModule.ts",
        },
    },
}

export default nextConfig
