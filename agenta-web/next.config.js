const withBundleAnalyzer = require("@next/bundle-analyzer")({
    enabled: process.env.ANALYZE === "true",
})

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    reactStrictMode: true,
    pageExtensions: ["ts", "tsx", "js", "jsx"],
    productionBrowserSourceMaps: true,
    transpilePackages: [
        "@lobehub/ui",
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
    typescript: {
        ignoreBuildErrors: true,
    },
    swcMinify: true,
    images: {
        remotePatterns: [{hostname: "fps.cdnpk.net"}],
    },
    ...(process.env.NEXT_PUBLIC_FF === "cloud" && {
        experimental: {
            instrumentationHook: true,
        },
    }),

    async redirects() {
        return [
            {
                source: "/",
                destination: "/apps",
                permanent: true,
            },
        ]
    },

    webpack: (config, {webpack, isServer}) => {
        const envs = {}

        Object.keys(process.env).forEach((env) => {
            if (env.startsWith("NEXT_PUBLIC_")) {
                envs[env] = process.env[env]
            }
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
            nextConfig,
            {
                // For all available options, see:
                // https://github.com/getsentry/sentry-webpack-plugin#options

                // Suppresses source map uploading logs during build
                silent: true,
                org: "agenta-ai",
                project: "javascript-nextjs",
            },
            {
                // For all available options, see:
                // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

                // Upload a larger set of source maps for prettier stack traces (increases build time)
                widenClientFileUpload: true,

                // Transpiles SDK to be compatible with IE11 (increases bundle size)
                transpileClientSDK: true,

                // Routes browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers (increases server load)
                tunnelRoute: "/monitoring",

                // Hides source maps from generated client bundles
                hideSourceMaps: true,

                // Automatically tree-shake Sentry logger statements to reduce bundle size
                disableLogger: true,
            },
        ),
    )
} else {
    module.exports = withBundleAnalyzer(nextConfig)
}
