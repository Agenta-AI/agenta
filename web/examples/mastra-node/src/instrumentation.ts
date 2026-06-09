/**
 * Phase 6 (Mastra) instrumentation — raw OpenTelemetry SDK setup.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ ENTRY POINT: tsx --import ./src/instrumentation.ts src/...  │
 *   │                                                             │
 *   │ Mirrors Phase 1 (node-vercel-ai-v6) exactly: same exporter, │
 *   │ same SimpleSpanProcessor, same per-app sentinel.            │
 *   │                                                             │
 *   │ Key Phase 6 question: does Mastra register its own          │
 *   │ NodeTracerProvider that conflicts with ours? @mastra/core   │
 *   │ ships ./observability and ./telemetry/otel-vendor exports,  │
 *   │ which suggests it has internal OTel wiring. If both         │
 *   │ providers race for global registration, only one wins and   │
 *   │ AI SDK spans land via that one. The assertions probe this   │
 *   │ empirically by checking which spans land in Agenta.         │
 *   └─────────────────────────────────────────────────────────────┘
 */

import "dotenv/config"

import {OTLPTraceExporter} from "@opentelemetry/exporter-trace-otlp-proto"
import {resourceFromAttributes} from "@opentelemetry/resources"
import {SimpleSpanProcessor} from "@opentelemetry/sdk-trace-base"
import {NodeTracerProvider} from "@opentelemetry/sdk-trace-node"
import {ATTR_SERVICE_NAME} from "@opentelemetry/semantic-conventions"

const AGENTA_HOST = process.env.AGENTA_HOST || "https://cloud.agenta.ai"
const AGENTA_API_KEY = process.env.AGENTA_API_KEY
const AGENTA_PROJECT_ID = process.env.AGENTA_PROJECT_ID
const AGENTA_OTLP_PATH = process.env.AGENTA_OTLP_PATH || "/api/otlp/v1/traces"
const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME

if (!AGENTA_API_KEY) {
    console.error("instrumentation: AGENTA_API_KEY is required")
    process.exit(1)
}
if (!APP_NAME) {
    console.error(
        "instrumentation: AGENTA_SPIKE_APP_NAME is required (used by assertion-4 sentinel)",
    )
    process.exit(1)
}

const SERVICE_NAME = `vercel-ai-spike-${APP_NAME}`

const otlpUrl = AGENTA_PROJECT_ID
    ? `${AGENTA_HOST}${AGENTA_OTLP_PATH}?project_id=${encodeURIComponent(AGENTA_PROJECT_ID)}`
    : `${AGENTA_HOST}${AGENTA_OTLP_PATH}`

const exporter = new OTLPTraceExporter({
    url: otlpUrl,
    headers: {
        Authorization: `ApiKey ${AGENTA_API_KEY}`,
    },
})

const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: SERVICE_NAME,
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
})

provider.register()

const instrKey = `__agenta_instr_${APP_NAME}` as const
;(globalThis as Record<string, unknown>)[instrKey] = Date.now()

console.log(`instrumentation: registered for service.name="${SERVICE_NAME}" → ${otlpUrl}`)
