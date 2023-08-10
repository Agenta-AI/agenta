const withMDX = require('@next/mdx')({
    extension: /\.mdx?$/,
    options: {
      remarkPlugins: [],
      rehypePlugins: [],
    },
  })

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    reactStrictMode: true,
    pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],

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

module.exports = withMDX(nextConfig)
