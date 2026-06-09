import type {NextConfig} from "next"

const nextConfig: NextConfig = {
    // @vercel/otel handles its own externalization. Just our spike-verify
    // chain needs to stay out of the server bundle (transitively pulls in
    // raw OTel via @agenta/sdk → @agenta/api-client which bundles fine
    // anywhere but doesn't need to live in Next's server bundle).
    serverExternalPackages: [
        "@vercel/otel",
        "@agenta/spike-verify",
        "@agenta/sdk",
        "@agenta/api-client",
    ],
}

export default nextConfig
