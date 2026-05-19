/**
 * Node-runtime OTel setup for the Workflow DevKit spike.
 *
 * Mirrors the other Next.js spike apps' setup pattern: NodeTracerProvider
 * + OTLP/proto exporter + SimpleSpanProcessor pointed at Agenta. No
 * Braintrust/Langfuse fan-out — single backend keeps the verification
 * narrow for this quick spike.
 *
 * Workflow DevKit's `"use workflow"` functions run in a sandboxed VM where
 * `fetch` and Node modules are unavailable. AI calls live inside `"use step"`
 * functions, which have full Node access — so the global OTel provider
 * registered here applies to spans emitted from steps, just like any other
 * Node-runtime Next.js app.
 *
 * What we want to verify here:
 *   - Standard `ai.*` / `gen_ai.*` spans land in Agenta from AI calls inside steps.
 *   - `DurableAgent` from @workflow/ai produces equivalent OTel spans.
 *   - Whether `traceparent` propagates across `sleep()` / checkpoint boundaries.
 */

import "dotenv/config"

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

if (!AGENTA_API_KEY) {
    console.error("instrumentation.node: AGENTA_API_KEY is required")
    process.exit(1)
}
if (!APP_NAME) {
    console.error("instrumentation.node: AGENTA_SPIKE_APP_NAME is required")
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

;(globalThis as Record<string, unknown>).__agenta_flush_traces = async () => {
    const tp = trace.getTracerProvider() as {forceFlush?: () => Promise<void>}
    if (typeof tp.forceFlush === "function") await tp.forceFlush()
}

console.log(`instrumentation.node: registered service.name="${SERVICE_NAME}" → ${otlpUrl}`)
