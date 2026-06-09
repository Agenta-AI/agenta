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

// Optional Braintrust dual-export. Same OTel data fans out to both backends
// so we can directly compare what each platform displays for IDENTICAL trace
// input. Braintrust accepts OTLP at `/otel/v1/traces` with Bearer auth + an
// `x-bt-parent` header naming the destination project. (Their canonical TS
// integration is wrapper-based `wrapAISDK`, but OTel is supported and is
// the cleanest dual-export shape for the spike's purposes — single source
// of trace data, fans out to N backends.)
const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY
const BRAINTRUST_OTLP_URL =
    process.env.BRAINTRUST_OTLP_URL || "https://api.braintrust.dev/otel/v1/traces"

// Optional Langfuse tri-export. Langfuse uses Basic auth with
// base64(public_key:secret_key) per their OTel docs
// (https://langfuse.com/docs/opentelemetry/get-started). Endpoint is
// `${LANGFUSE_BASE_URL}/api/public/otel/v1/traces`. Adding the optional
// `x-langfuse-ingestion-version: 4` header enables real-time preview.
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY
const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com"

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
// is safer and self-documenting. See SDK-REQ-03 in status.md for the SDK-side gap.
const otlpUrl = AGENTA_PROJECT_ID
    ? `${AGENTA_HOST}${AGENTA_OTLP_PATH}?project_id=${encodeURIComponent(AGENTA_PROJECT_ID)}`
    : `${AGENTA_HOST}${AGENTA_OTLP_PATH}`

const agentaExporter = new OTLPTraceExporter({
    url: otlpUrl,
    headers: {
        Authorization: `ApiKey ${AGENTA_API_KEY}`,
    },
})

// Build the span processor list. Always include Agenta. Optionally include
// Braintrust when BRAINTRUST_API_KEY is set — same SpanProcessor pattern,
// so a single ended span fans out to both exporters.
const spanProcessors = [new SimpleSpanProcessor(agentaExporter)]

if (BRAINTRUST_API_KEY) {
    const braintrustExporter = new OTLPTraceExporter({
        url: BRAINTRUST_OTLP_URL,
        headers: {
            Authorization: `Bearer ${BRAINTRUST_API_KEY}`,
            // `x-bt-parent` controls which Braintrust project (or experiment)
            // receives the spans. Using project_name keeps the wiring
            // declarative — Braintrust auto-creates the project on first
            // span if it doesn't exist.
            "x-bt-parent": `project_name:${SERVICE_NAME}`,
        },
    })
    spanProcessors.push(new SimpleSpanProcessor(braintrustExporter))
}

if (LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY) {
    // Langfuse OTLP needs base64(public:secret) in Basic auth header.
    const auth = Buffer.from(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`).toString("base64")
    const langfuseExporter = new OTLPTraceExporter({
        url: `${LANGFUSE_BASE_URL}/api/public/otel/v1/traces`,
        headers: {
            Authorization: `Basic ${auth}`,
            "x-langfuse-ingestion-version": "4",
        },
    })
    spanProcessors.push(new SimpleSpanProcessor(langfuseExporter))
}

const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: SERVICE_NAME,
    }),
    // SimpleSpanProcessor: exports each span as it ends (no batching).
    // The published v4 example uses this. Tested 2026-05-10: switching from
    // BatchSpanProcessor to SimpleSpanProcessor in v6 made `ai.streamText`
    // spans actually arrive in Agenta. See P-NODE-02 in the pain log.
    spanProcessors,
})

provider.register()

// Per-app namespaced sentinel (per outside voice fix in design doc).
// String key avoids the cross-app collision we'd hit with `globalThis.__INSTR_AT__`.
const instrKey = `__agenta_instr_${APP_NAME}` as const
;(globalThis as Record<string, unknown>)[instrKey] = Date.now()

console.log(`instrumentation: registered for service.name="${SERVICE_NAME}" → ${otlpUrl}`)
if (BRAINTRUST_API_KEY) {
    console.log(`instrumentation: + Braintrust dual-export → ${BRAINTRUST_OTLP_URL}`)
}
if (LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY) {
    console.log(
        `instrumentation: + Langfuse tri-export → ${LANGFUSE_BASE_URL}/api/public/otel/v1/traces`,
    )
}
