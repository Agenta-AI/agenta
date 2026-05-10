/**
 * Phase 1 / App 1 instrumentation — raw OpenTelemetry SDK setup.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ ENTRY POINT: tsx --import ./src/instrumentation.ts src/app  │
 *   │                                                             │
 *   │ Loaded BEFORE any app code runs. Registers a NodeTracer     │
 *   │ Provider with an OTLP/proto exporter pointed at Agenta.     │
 *   │                                                             │
 *   │ Sets two namespaced globalThis sentinels (per-app, not      │
 *   │ shared across multiple spike apps in the same process):     │
 *   │   __agenta_instr_<APP_NAME>     = ms when register() done   │
 *   │   __agenta_first_handler_<APP_NAME> = set later by app.ts   │
 *   │                                                             │
 *   │ Assertion #4 reads both and asserts instr < first-handler.  │
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

// Fail loudly on missing required env, NOT silently degrade.
// Running the app without these is always a misconfiguration.
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

// Agenta reads `project_id` from QUERY PARAMS (not headers), even on the OTLP
// ingest endpoint. Project-scoped API keys make this implicit, but explicit
// is safer and self-documenting. See P-NODE-06 for the SDK-side gap.
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
    // SimpleSpanProcessor: exports each span as it ends (no batching).
    // The published v4 example uses this. Tested 2026-05-10: switching from
    // BatchSpanProcessor to SimpleSpanProcessor in v6 made `ai.streamText`
    // spans actually arrive in Agenta. See P-NODE-02 in the pain log.
    spanProcessors: [new SimpleSpanProcessor(exporter)],
})

provider.register()

// Per-app namespaced sentinel (per outside voice fix in design doc).
// String key avoids the cross-app collision we'd hit with `globalThis.__INSTR_AT__`.
const instrKey = `__agenta_instr_${APP_NAME}` as const
;(globalThis as Record<string, unknown>)[instrKey] = Date.now()

console.log(`instrumentation: registered for service.name="${SERVICE_NAME}" → ${otlpUrl}`)
