/**
 * Minimal Next config so @storybook/nextjs treats this as a Next project (enables
 * next/font/google used inside ThemeContextProvider). Workspace TS packages are
 * source-only, so they must be transpiled.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
    reactStrictMode: false,
    transpilePackages: [
        "@agenta/oss",
        "@agenta/ui",
        "@agenta/shared",
        "@agenta/entities",
        "@agenta/entity-ui",
    ],
}

export default nextConfig
