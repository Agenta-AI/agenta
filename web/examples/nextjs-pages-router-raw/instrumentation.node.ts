/**
 * Node-runtime OTel setup for the Pages Router spike.
 *
 * Identical to nextjs-app-router-raw's instrumentation.node.ts —
 * deliberately so. The point of this app is to test whether the SAME
 * raw-OTel wiring that works in App Router also works in Pages Router.
 * Any divergence we find belongs in the pain log.
 *
 * Per P-NODE-02: SimpleSpanProcessor (not BatchSpanProcessor) — Batch +
 * AI SDK v6 streamText silently loses spans. Per SDK-REQ-03: project_id
 * appended to OTLP URL as query param.
 */

import {trace} from "@opentelemetry/api"
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
const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY
const BRAINTRUST_OTLP_URL =
    process.env.BRAINTRUST_OTLP_URL || "https://api.braintrust.dev/otel/v1/traces"
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY
const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com"

if (!AGENTA_API_KEY) {
    console.error("instrumentation.node: AGENTA_API_KEY is required")
    process.exit(1)
}
if (!APP_NAME) {
    console.error(
        "instrumentation.node: AGENTA_SPIKE_APP_NAME is required (used by assertion-4 sentinel)",
    )
    process.exit(1)
}

const SERVICE_NAME = `vercel-ai-spike-${APP_NAME}`

const otlpUrl = AGENTA_PROJECT_ID
    ? `${AGENTA_HOST}${AGENTA_OTLP_PATH}?project_id=${encodeURIComponent(AGENTA_PROJECT_ID)}`
    : `${AGENTA_HOST}${AGENTA_OTLP_PATH}`

const agentaExporter = new OTLPTraceExporter({
    url: otlpUrl,
    headers: {
        Authorization: `ApiKey ${AGENTA_API_KEY}`,
    },
})

// Optional Braintrust dual-export. Same OTel data fans out to both backends.
const spanProcessors = [new SimpleSpanProcessor(agentaExporter)]
if (BRAINTRUST_API_KEY) {
    const braintrustExporter = new OTLPTraceExporter({
        url: BRAINTRUST_OTLP_URL,
        headers: {
            Authorization: `Bearer ${BRAINTRUST_API_KEY}`,
            "x-bt-parent": `project_name:${SERVICE_NAME}`,
        },
    })
    spanProcessors.push(new SimpleSpanProcessor(braintrustExporter))
}

// Optional Langfuse tri-export. Auth is Basic base64(public:secret) per their
// OTel docs (https://langfuse.com/docs/opentelemetry/get-started).
if (LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY) {
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
    spanProcessors,
})

provider.register()

const instrKey = `__agenta_instr_${APP_NAME}` as const
;(globalThis as Record<string, unknown>)[instrKey] = Date.now()
;(globalThis as Record<string, unknown>).__agenta_flush_traces = async () => {
    const tp = trace.getTracerProvider() as {forceFlush?: () => Promise<void>}
    if (typeof tp.forceFlush === "function") await tp.forceFlush()
}

console.log(`instrumentation.node: registered service.name="${SERVICE_NAME}" → ${otlpUrl}`)
if (BRAINTRUST_API_KEY) {
    console.log(`instrumentation.node: + Braintrust dual-export → ${BRAINTRUST_OTLP_URL}`)
}
if (LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY) {
    console.log(
        `instrumentation.node: + Langfuse tri-export → ${LANGFUSE_BASE_URL}/api/public/otel/v1/traces`,
    )
}
