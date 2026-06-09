import type {NextConfig} from "next"

const nextConfig: NextConfig = {
    // Same externalization as the App Router raw spike — keep Node-only OTel
    // libs out of the client bundle and our spike-verify chain external from
    // the server bundle.
    serverExternalPackages: [
        "@opentelemetry/sdk-trace-node",
        "@opentelemetry/sdk-trace-base",
        "@opentelemetry/exporter-trace-otlp-proto",
        "@opentelemetry/exporter-trace-otlp-http",
        "@opentelemetry/resources",
        "@opentelemetry/api",
        "@opentelemetry/semantic-conventions",
        "@agenta/spike-verify",
        "@agenta/sdk",
        "@agenta/api-client",
    ],
}

export default nextConfig
