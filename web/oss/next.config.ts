import path from "path"

import type {NextConfig} from "next"

const isDevelopment = process.env.NODE_ENV === "development"

const COMMON_CONFIG: NextConfig = {
    output: "standalone",
    reactStrictMode: true,
    pageExtensions: ["ts", "tsx", "js", "jsx"],
    productionBrowserSourceMaps: true,
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
                source: "/",
                destination: "/apps",
                permanent: true,
            },
            {
                source: "/apps/:app_id",
                destination: "/apps/:app_id/overview/",
                permanent: true,
            },
        ]
    },
    ...(!isDevelopment
        ? {
              transpilePackages: [
                  "rc-util",
                  "antd",
                  "rc-pagination",
                  "rc-picker",
                  "rc-tree",
                  "rc-input",
                  "rc-table",
                  "@ant-design/icons",
                  "@ant-design/icons-svg",
              ],
              webpack: (config, {webpack, isServer}) => {
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
