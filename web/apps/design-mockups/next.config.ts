import path from "node:path"
import type {NextConfig} from "next"

const isDevelopment = process.env.NODE_ENV === "development"

// Dedupe single-instance libraries. The workspace's pnpm graph resolves react
// to two different versions (19.2.5 + 19.2.6) and jotai to three. Without
// aliases, transpiled workspace packages (@agenta/ui, @agenta/oss, etc.) can
// pick a different react/jotai than the host app, producing the classic
// "null dispatcher.useContext" runtime error and "Multiple Jotai instances"
// warning. Pin everyone to the copies the design-mockups app sees.
const dedupe = (request: string) =>
    path.resolve(__dirname, "node_modules", request)

const config: NextConfig = {
    reactStrictMode: true,
    pageExtensions: ["ts", "tsx"],
    eslint: {
        ignoreDuringBuilds: true,
    },
    typescript: {
        ignoreBuildErrors: true,
    },
    transpilePackages: [
        "@agenta/oss",
        "@agenta/shared",
        "@agenta/ui",
        "@agenta/entities",
        "@agenta/entity-ui",
        ...(!isDevelopment
            ? ["antd", "rc-util", "rc-pagination", "rc-picker", "rc-tree", "rc-input", "rc-table"]
            : []),
    ],
    webpack: (webpackConfig) => {
        webpackConfig.resolve = webpackConfig.resolve ?? {}
        webpackConfig.resolve.alias = {
            ...(webpackConfig.resolve.alias ?? {}),
            react: dedupe("react"),
            "react-dom": dedupe("react-dom"),
            "react/jsx-runtime": dedupe("react/jsx-runtime.js"),
            "react/jsx-dev-runtime": dedupe("react/jsx-dev-runtime.js"),
            jotai: dedupe("jotai"),
        }
        return webpackConfig
    },
}

export default config
