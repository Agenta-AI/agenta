import type {NextConfig} from "next"

const isDevelopment = process.env.NODE_ENV === "development"

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
}

export default config
