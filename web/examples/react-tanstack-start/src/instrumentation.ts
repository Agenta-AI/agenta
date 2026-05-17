/**
 * TanStack Start OTel instrumentation (raw OTel, Node runtime).
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Critical TanStack Start specific: this file MUST be imported│
 *   │ as the very first line of `src/server.ts` — there's no      │
 *   │ Next.js-style `register()` auto-discovery. Import order in  │
 *   │ server.ts is the seam.                                      │
 *   │                                                             │
 *   │ Same OTel wiring as Phase 1 / 2a / 3a: raw OTLP/proto       │
 *   │ exporter against Agenta's /api/otlp/v1/traces, with         │
 *   │ SimpleSpanProcessor (per P-NODE-02: BatchSpanProcessor      │
 *   │ silently loses AI SDK v6 streamText spans).                 │
 *   │                                                             │
 *   │ TanStack Start has NO documented edge runtime opt-in        │
 *   │ (runtime is selected at the Nitro preset level, not         │
 *   │ per-route like Next 15's `export const runtime = "edge"`).  │
 *   │ Captured as P-TANSTACK-01.                                  │
 *   └─────────────────────────────────────────────────────────────┘
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
const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "tanstack-start"
const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY
const BRAINTRUST_OTLP_URL =
    process.env.BRAINTRUST_OTLP_URL || "https://api.braintrust.dev/otel/v1/traces"
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY
const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com"

if (!AGENTA_API_KEY) {
    console.error("instrumentation: AGENTA_API_KEY is required — traces will not export")
} else {
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

    // Optional Langfuse tri-export. Auth is Basic base64(public:secret) per
    // their OTel docs (https://langfuse.com/docs/opentelemetry/get-started).
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

    // Assertion-4 sentinel: per-app namespace prevents cross-app collision in
    // monorepo dev mode where multiple spike apps may share a Node process.
    const instrKey = `__agenta_instr_${APP_NAME}` as const
    ;(globalThis as Record<string, unknown>)[instrKey] = Date.now()

    // Force-flush hook used by route handlers before they return. With
    // SimpleSpanProcessor this is a no-op for ended spans, but it costs
    // nothing to call defensively (and IS load-bearing for streamText
    // which ends async per P-NODE-02).
    ;(globalThis as Record<string, unknown>).__agenta_flush_traces = async () => {
        const tp = trace.getTracerProvider() as {forceFlush?: () => Promise<void>}
        if (typeof tp.forceFlush === "function") await tp.forceFlush()
    }

    console.log(`instrumentation: registered service.name="${SERVICE_NAME}" → ${otlpUrl}`)
    if (BRAINTRUST_API_KEY) {
        console.log(`instrumentation: + Braintrust dual-export → ${BRAINTRUST_OTLP_URL}`)
    }
    if (LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY) {
        console.log(
            `instrumentation: + Langfuse tri-export → ${LANGFUSE_BASE_URL}/api/public/otel/v1/traces`,
        )
    }
}
