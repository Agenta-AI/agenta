import path from "path"

import type {NextConfig} from "next"

const isDevelopment = process.env.NODE_ENV === "development"

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
    reactStrictMode: true,
    pageExtensions: ["ts", "tsx"],
    productionBrowserSourceMaps: true,
    // Workspace root, so standalone output nests as .next/standalone/mobile/
    // (same pattern as web/oss).
    outputFileTracingRoot: path.resolve(__dirname, ".."),
    // Same policy as web/oss: lint/type gates run as dedicated turbo tasks,
    // not inside `next build`.
    eslint: {
        ignoreDuringBuilds: true,
    },
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
    ...(isDevelopment
        ? {
              turbopack: {
                  root: path.resolve(__dirname, ".."),
              },
          }
        : {}),
}

export default nextConfig
