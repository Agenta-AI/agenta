import path from "path"
import {createRequire} from "module"

import ossConfig from "@agenta/oss/next.config"

const require = createRequire(import.meta.url)
const reduxToolkitCjsEntry = path.join(
    path.dirname(require.resolve("@reduxjs/toolkit/package.json")),
    "dist/cjs/index.js",
)

const config = {
    ...ossConfig,
    outputFileTracingRoot: path.resolve(__dirname, ".."),
    turbopack: {
        root: path.resolve(__dirname, ".."),
        resolveAlias: {
            "@/oss/*": ["@/agenta-oss-common/*"],
        },
    },
    experimental: {
        ...(ossConfig.experimental ?? {}),
        optimizePackageImports: [
            "@agenta/oss",
            "@agenta/shared",
            "@agenta/ui",
            "@agenta/entities",
            "@agenta/entity-ui",
            "@agenta/playground",
            "@agenta/playground-ui",
        ],
    },
    typescript: {
        ignoreBuildErrors: true,
    },
    webpack: (webpackConfig: any, options: any) => {
        const baseConfig =
            typeof ossConfig.webpack === "function"
                ? ossConfig.webpack(webpackConfig, options)
                : webpackConfig

        baseConfig.resolve ??= {}
        baseConfig.resolve.alias = {
            ...(baseConfig.resolve.alias ?? {}),
            "@reduxjs/toolkit": reduxToolkitCjsEntry,
        }

        return baseConfig
    },
    async redirects() {
        return [
            {
                source: "/apps",
                destination: "/w",
                permanent: true,
            },
            {
                source: "/apps/:app_id",
                destination: "/w",
                permanent: true,
            },
            {
                source: "/apps/:app_id/:path*",
                destination: "/w",
                permanent: true,
            },
            {
                source: "/",
                destination: "/w",
                permanent: true,
            },
            {
                source: "/:workspace_id/apps/:app_id",
                destination: "/:workspace_id/apps/:app_id/overview/",
                permanent: true,
            },
        ]
    },
}

export default config
