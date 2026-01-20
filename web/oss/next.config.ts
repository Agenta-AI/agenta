import {createRequire} from "module"
import path from "path"

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
    // Always transpile workspace packages to ensure proper module resolution
    transpilePackages: [
        "@agenta/entities",
        "@agenta/shared",
        "@agenta/ui",
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

export default COMMON_CONFIG
