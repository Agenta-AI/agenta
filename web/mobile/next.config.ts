import path from "path"

import type {NextConfig} from "next"

/**
 * The hostnames this app's dev server accepts hot-reload connections from.
 *
 * A Next 16 dev server refuses a hot-reload upgrade whose Origin is not allow-listed, and the
 * client then falls back to reloading the whole page. A dev stack reached through a hostname
 * rather than localhost therefore needs that hostname listed, so the deployment's own web URL
 * is read for it. `allowedDevOrigins` is read by `next dev` and has no effect on a build.
 */
const allowedDevOrigins = (): string[] => {
    const origins = new Set(["localhost", "127.0.0.1", "[::1]"])
    const configured = process.env.AGENTA_WEB_URL
    if (configured) {
        try {
            origins.add(new URL(configured).hostname)
        } catch {
            // An unparseable value leaves the local origins in place rather than failing the run.
        }
    }
    return [...origins]
}

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
        "@agenta/automation-ui",
        "@agenta/navigation",
        "@agenta/navigation-ui",
        "@agenta/sessions",
        "@agenta/sessions-ui",
        "@agenta/skills",
        "@agenta/skills-ui",
        "@agenta/settings",
        "@agenta/settings-ui",
        "@agenta/home-ui",
        "@agenta/observability",
        "@agenta/playground",
        "@agenta/playground-ui",
        "@agenta/chat",
    ],
    allowedDevOrigins: allowedDevOrigins(),
    reactStrictMode: true,
    pageExtensions: ["ts", "tsx"],
    productionBrowserSourceMaps: true,
    // Workspace root, so standalone output nests as .next/standalone/mobile/
    // (same pattern as web/oss).
    outputFileTracingRoot: path.resolve(__dirname, ".."),
    // Next 16.3.1 loads the ESM SWC helpers at runtime, but its standalone tracer
    // currently keeps only the CommonJS helper files. Include the ESM helpers so
    // the production image can start.
    outputFileTracingIncludes: {
        "/*": ["../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/esm/**/*"],
    },
    // Same policy as web/oss: the type gate runs as a dedicated turbo task, not inside
    // `next build`. (Next 16 removed the `eslint` option; `next build` no longer lints.)
    typescript: {
        ignoreBuildErrors: true,
    },
    async redirects() {
        return [
            {
                // The providers' ONE registered redirect URI is the desktop `/auth/callback/<id>`;
                // in production the desktop middleware hands a mobile-started landing to
                // `/m/auth/callback/<id>` (see decideDesktopGate), and behind Traefik this app
                // never sees the bare path. On a direct-port dev run (`next dev` on the origin
                // the URI is registered against, no desktop in front) the landing arrives
                // here and would 404, killing every OAuth sign-in. Mirror the hand-off so
                // the dev loop completes; Next carries the `code`/`state` query along.
                source: "/auth/callback/:provider",
                destination: "/m/auth/callback/:provider",
                basePath: false,
                permanent: false,
            },
        ]
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
