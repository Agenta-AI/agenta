import type {NextConfig} from "next"

const nextConfig: NextConfig = {
    // @vercel/otel handles the OTel package externalization itself; we only
    // need to mark the spike-verify chain external because it transitively
    // imports raw OTel deps via @agenta/sdk → @agenta/api-client (which
    // bundles fine in any context but doesn't need to live in the Next
    // server bundle).
    serverExternalPackages: [
        "@vercel/otel",
        "@agenta/spike-verify",
        "@agenta/sdk",
        "@agenta/api-client",
    ],
}

export default nextConfig
