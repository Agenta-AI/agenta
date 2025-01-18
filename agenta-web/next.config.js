/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    reactStrictMode: true,
    pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
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

module.exports = nextConfig
