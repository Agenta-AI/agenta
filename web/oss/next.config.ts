import {createRequire} from "module"
import path from "path"

import bundleAnalyzer from "@next/bundle-analyzer"
import type {NextConfig} from "next"

const require = createRequire(import.meta.url)
const reduxToolkitCjsEntry = path.join(
    path.dirname(require.resolve("@reduxjs/toolkit/package.json")),
    "dist/cjs/index.js",
)
const isDevelopment = process.env.NODE_ENV === "development"

const COMMON_CONFIG: NextConfig = {
    output: "standalone",
    reactStrictMode: true,
    pageExtensions: ["ts", "tsx", "js", "jsx"],
    productionBrowserSourceMaps: true,
    outputFileTracingRoot: path.resolve(__dirname, ".."),
    images: {
        remotePatterns: [{hostname: "fps.cdnpk.net"}],
    },
    eslint: {
        ignoreDuringBuilds: true,
    },
    typescript: {
        ignoreBuildErrors: true,
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
    // Enable package import optimization for workspace packages and icon libraries
    experimental: {
        optimizePackageImports: [
            "@agenta/oss",
            "@agenta/shared",
            "@agenta/ui",
            "@agenta/entities",
            "@agenta/entity-ui",
            "@agenta/playground",
            "@agenta/playground-ui",
            // Icon libraries - ensure tree-shaking works for individual icon imports
            "@phosphor-icons/react",
            "lucide-react",
        ],
    },
    // Always transpile workspace packages to ensure proper module resolution
    transpilePackages: [
        "@agenta/shared",
        "@agenta/ui",
        "@agenta/entities",
        "@agenta/entity-ui",
        "@agenta/playground",
        "@agenta/playground-ui",
        ...(!isDevelopment
            ? [
                  "rc-util",
                  "antd",
                  "rc-pagination",
                  "rc-picker",
                  "rc-tree",
                  "rc-input",
                  "rc-table",
                  "@ant-design/icons",
                  "@ant-design/icons-svg",
              ]
            : []),
    ],
    ...(!isDevelopment
        ? {
              webpack: (config, {webpack, isServer}) => {
                  config.resolve ??= {}
                  config.resolve.alias = {
                      ...(config.resolve.alias ?? {}),
                      "@reduxjs/toolkit": reduxToolkitCjsEntry,
                  }

                  const envs: Record<string, string | undefined> = {}
                  config.cache = false

                  Object.keys(process.env).forEach((env) => {
                      if (env.startsWith("NEXT_PUBLIC_")) {
                          envs[env] = process.env[env]
                      }
                  })

                  config.module.rules.push({
                      test: /\.d\.ts$/,
                      loader: "swc-loader",
                  })

                  // Ignore problematic ESM imports from @ant-design/x that we don't use
                  // This prevents build errors for mermaid and refractor packages
                  config.plugins.push(
                      new webpack.IgnorePlugin({
                          resourceRegExp: /^mermaid$/,
                          contextRegExp: /@ant-design[\\/]x/,
                      }),
                      new webpack.IgnorePlugin({
                          resourceRegExp: /^refractor\/.+$/,
                          contextRegExp: /react-syntax-highlighter/,
                      }),
                  )

                  if (!isServer) {
                      config.plugins.push(
                          new webpack.DefinePlugin({
                              "process.env": JSON.stringify(envs),
                          }),
                      )
                  }

                  return config
              },
          }
        : {
              turbopack: {
                  root: path.resolve(__dirname, ".."),
              },
          }),
}

const withBundleAnalyzer = bundleAnalyzer({
    enabled: process.env.ANALYZE === "true",
})

export default withBundleAnalyzer(COMMON_CONFIG)
