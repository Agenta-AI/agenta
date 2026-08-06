/**
 * Agenta SDK Tracing — Initialization.
 *
 * Call `initAgentaTracing()` once in your `instrumentation.ts` to set up
 * the global OTel provider with the Agenta exporter pipeline.
 *
 * ```ts
 * // instrumentation.ts
 * import { initAgentaTracing } from "./lib/agenta-sdk/tracing";
 *
 * export function register() {
 *   initAgentaTracing();
 * }
 * ```
 */

import type {InitAgentaTracingOptions} from "./types"

let _initialized = false

/**
 * Initialize Agenta tracing.
 *
 * Sets up a global NodeTracerProvider with the AgentaExporter pipeline.
 * AI SDK spans are automatically captured and exported to Agenta.
 *
 * No-op if AGENTA_API_KEY is not set (tracing disabled gracefully).
 * Safe to call multiple times — only initializes once.
 */
export function initAgentaTracing(options?: InitAgentaTracingOptions): void {
    if (_initialized) return

    const host =
        options?.host ??
        process.env.AGENTA_HOST ??
        process.env.NEXT_PUBLIC_AGENTA_HOST ??
        "http://localhost"
    const apiKey =
        options?.apiKey ?? process.env.AGENTA_API_KEY ?? process.env.NEXT_PUBLIC_AGENTA_API_KEY

    if (!apiKey) {
        console.log("[Agenta Tracing] AGENTA_API_KEY not set — tracing disabled")
        return
    }

    const serviceName = options?.serviceName ?? "agenta-app"
    const serviceVersion = options?.serviceVersion ?? "0.1.0"
    const batchDelayMs = options?.batchDelayMs ?? 2000
    const maxBatchSize = options?.maxBatchSize ?? 50

    // Dynamic imports to avoid bundling OTel in client builds
    // (these are server-only packages)
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {NodeTracerProvider, BatchSpanProcessor} = require("@opentelemetry/sdk-trace-node")

        // Use protobuf format — Agenta's OTLP endpoint expects application/x-protobuf
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {OTLPTraceExporter} = require("@opentelemetry/exporter-trace-otlp-proto")
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {resourceFromAttributes} = require("@opentelemetry/resources")

        /* eslint-disable @typescript-eslint/no-require-imports */
        const {
            ATTR_SERVICE_NAME,
            ATTR_SERVICE_VERSION,
        } = require("@opentelemetry/semantic-conventions")
        /* eslint-enable @typescript-eslint/no-require-imports */
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {AgentaExporter} = require("./exporter")
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {createMapper} = require("./mappers/index")

        const framework = options?.framework ?? "auto"
        const mapper = createMapper(framework)

        const otlpExporter = new OTLPTraceExporter({
            url: `${host}/api/otlp/v1/traces`,
            headers: {Authorization: apiKey},
        })

        const resource = resourceFromAttributes({
            [ATTR_SERVICE_NAME]: serviceName,
            [ATTR_SERVICE_VERSION]: serviceVersion,
        })

        const provider = new NodeTracerProvider({
            resource,
            spanProcessors: [
                new BatchSpanProcessor(new AgentaExporter(otlpExporter, mapper), {
                    scheduledDelayMillis: batchDelayMs,
                    maxExportBatchSize: maxBatchSize,
                }),
            ],
        })

        provider.register()
        _initialized = true

        console.log(`[Agenta Tracing] Initialized — exporting to ${host}/api/otlp/v1/traces`)
    } catch (error) {
        console.warn(
            "[Agenta Tracing] Failed to initialize — OTel packages may not be installed:",
            error instanceof Error ? error.message : error,
        )
    }
}

/**
 * Check if Agenta tracing has been initialized.
 */
export function isTracingInitialized(): boolean {
    return _initialized
}
