import type {NextConfig} from "next"
import {withWorkflow} from "@workflow/next"

const nextConfig: NextConfig = {
    // Same external packages as other Next.js spike apps — OTel + Agenta
    // libs must stay outside the bundler so their Node-only deps resolve
    // at runtime.
    //
    // IMPORTANT: `workflow` and `@workflow/ai` must NOT be in this list.
    // Their compiled output contains `"use step"` directives that the
    // Workflow DevKit SWC plugin scans at build time to register steps
    // in the deployment manifest. Externalizing them hides those
    // directives from the compiler and produces StepNotRegisteredError
    // at runtime (specifically: `step//@workflow/ai@.../doStreamStep`,
    // `step//@workflow/ai/agent@.../closeStream`).
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

export default withWorkflow(nextConfig)
