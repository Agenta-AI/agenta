const isDevelopment = process.env.NODE_ENV === "development"

const COMMON_CONFIG = {
    output: "standalone",
    reactStrictMode: true,
    pageExtensions: ["ts", "tsx", "js", "jsx"],
    transpilePackages: [
        "@lobehub/icons",
        "@lobehub/fluent-emoji",
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
    productionBrowserSourceMaps: true,
    images: {
        remotePatterns: [{hostname: "fps.cdnpk.net"}],
    },
    async redirects() {
        return [
            {
                source: "/",
                destination: "/apps",
                permanent: true,
            },
        ]
    },
}

if (isDevelopment) {
    module.exports = COMMON_CONFIG
} else {
    const withBundleAnalyzer = require("@next/bundle-analyzer")({
        enabled: process.env.ANALYZE === "true",
    })

    const prodConfig = {
        ...COMMON_CONFIG,
        typescript: {
            ignoreBuildErrors: true,
        },
        ...(process.env.NEXT_PUBLIC_FF === "cloud" && {
            experimental: {
                instrumentationHook: true,
            },
        }),
        webpack: (config, {webpack, isServer}) => {
            const envs = {}

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

            if (process.env.NEXT_PUBLIC_FF === "cloud") {
                config.plugins.push(
                    new webpack.DefinePlugin({
                        __SENTRY_DEBUG__: false,
                        __SENTRY_TRACING__: true,
                        __RRWEB_EXCLUDE_IFRAME__: true,
                        __RRWEB_EXCLUDE_SHADOW_DOM__: true,
                        __SENTRY_EXCLUDE_REPLAY_WORKER__: true,
                    }),
                )
            }
            return config
        },
    }

    if (process.env.NEXT_PUBLIC_FF === "cloud") {
        const {withSentryConfig} = require("@sentry/nextjs")
        module.exports = withBundleAnalyzer(
            withSentryConfig(
                prodConfig,
                {
                    silent: true,
                    org: "agenta-ai",
                    project: "javascript-nextjs",
                },
                {
                    widenClientFileUpload: true,
                    transpileClientSDK: true,
                    tunnelRoute: "/monitoring",
                    hideSourceMaps: true,
                    disableLogger: true,
                },
            ),
        )
    } else {
        module.exports = withBundleAnalyzer(prodConfig)
    }
}
