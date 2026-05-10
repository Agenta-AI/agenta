import type {NextConfig} from "next"

const nextConfig: NextConfig = {
    // Mark OTel + Agenta packages as external so Next doesn't try to bundle
    // their Node-only deps (async_hooks, fs, etc.) into the server runtime.
    // Required pattern for any OTel-instrumented Next 15 app.
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
