/**
 * Minimal Next config so @storybook/nextjs treats this as a Next project. Workspace TS
 * packages are source-only, so they must be transpiled.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
    reactStrictMode: false,
    transpilePackages: [
        "@agenta/ui",
        "@agenta/shared",
        "@agenta/entities",
        "@agenta/entity-ui",
        "@agenta/skills",
        "@agenta/skills-ui",
    ],
}

export default nextConfig
