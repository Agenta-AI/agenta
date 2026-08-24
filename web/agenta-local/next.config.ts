import path from "node:path"

import type {NextConfig} from "next"

const nextConfig: NextConfig = {
    output: "export",
    trailingSlash: true,
    reactStrictMode: true,
    pageExtensions: ["ts", "tsx"],
    transpilePackages: ["@agenta/shared", "@agenta/ui"],
    outputFileTracingRoot: path.resolve(__dirname, ".."),
    turbopack: {root: path.resolve(__dirname, "..")},
}

export default nextConfig
