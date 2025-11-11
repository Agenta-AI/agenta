import path from "path"

import ossConfig from "@agenta/oss/next.config"

const config = {
    ...ossConfig,
    outputFileTracingRoot: path.join(__dirname, "../"),
    turbopack: {
        root: path.resolve(__dirname, ".."),
        resolveAlias: {
            "@/oss/*": ["@/agenta-oss-common/*"],
            "@/@agenta/ee/*": ["../ee/src/*"],
        },
    },
    experimental: {
        optimizePackageImports: ["@agenta/oss"],
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
}

export default config
