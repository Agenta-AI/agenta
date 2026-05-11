/**
 * Next.js 15 instrumentation hook — `@vercel/otel` variant.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Phase 2b A/B counterpart to nextjs-app-router-raw.          │
 *   │ Same app shape, different OTel wiring.                      │
 *   │                                                             │
 *   │ The point of @vercel/otel: it claims to handle the four     │
 *   │ pain points users hit on raw OTel + Next 15:                │
 *   │   1. instrumentation.ts register hook ergonomics            │
 *   │   2. edge runtime exporter selection                        │
 *   │   3. waitUntil(forceFlush()) for serverless flush guarantees│
 *   │   4. Resource attribute defaults (service.name, etc.)       │
 *   │                                                             │
 *   │ Single-line setup vs the raw variant's multi-file scaffold. │
 *   │ One opinionated registerOTel() call covers Node + edge.     │
 *   └─────────────────────────────────────────────────────────────┘
 */

import {registerOTel, OTLPHttpProtoTraceExporter} from "@vercel/otel"
import {BatchSpanProcessor} from "@opentelemetry/sdk-trace-base"

const AGENTA_HOST = process.env.AGENTA_HOST || "https://cloud.agenta.ai"
const AGENTA_API_KEY = process.env.AGENTA_API_KEY
const AGENTA_PROJECT_ID = process.env.AGENTA_PROJECT_ID
const AGENTA_OTLP_PATH = process.env.AGENTA_OTLP_PATH || "/api/otlp/v1/traces"
const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "app-router-vercel"
const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY
const BRAINTRUST_OTLP_URL =
    process.env.BRAINTRUST_OTLP_URL || "https://api.braintrust.dev/otel/v1/traces"

const otlpUrl = AGENTA_PROJECT_ID
    ? `${AGENTA_HOST}${AGENTA_OTLP_PATH}?project_id=${encodeURIComponent(AGENTA_PROJECT_ID)}`
    : `${AGENTA_HOST}${AGENTA_OTLP_PATH}`

export function register(): void {
    if (!AGENTA_API_KEY) {
        console.error("instrumentation: AGENTA_API_KEY missing — traces will not be exported")
        return
    }

    const serviceName = `vercel-ai-spike-${APP_NAME}`
    const agentaExporter = new OTLPHttpProtoTraceExporter({
        url: otlpUrl,
        headers: {Authorization: `ApiKey ${AGENTA_API_KEY}`},
    })

    // Optional Braintrust dual-export. `@vercel/otel`'s `spanProcessors` array
    // accepts standard OTel SpanProcessor — we wrap both exporters in
    // BatchSpanProcessor to match `@vercel/otel`'s DEFAULT behaviour when
    // `traceExporter` is used. This preserves the baseline P-APP-VERCEL-01
    // failure mode (mid-stream-abort streamText loss) — switching to
    // SimpleSpanProcessor here would silently fix it and hide the pain
    // entry we're trying to keep reproducible. See pain-log.md.
    if (BRAINTRUST_API_KEY) {
        const braintrustExporter = new OTLPHttpProtoTraceExporter({
            url: BRAINTRUST_OTLP_URL,
            headers: {
                Authorization: `Bearer ${BRAINTRUST_API_KEY}`,
                "x-bt-parent": `project_name:${serviceName}`,
            },
        })
        registerOTel({
            serviceName,
            spanProcessors: [
                new BatchSpanProcessor(agentaExporter),
                new BatchSpanProcessor(braintrustExporter),
            ],
        })
    } else {
        registerOTel({
            serviceName,
            traceExporter: agentaExporter,
        })
    }

    // Per-app sentinel for assertion-4 (same pattern as the raw variant).
    // We only stamp this from the nodejs runtime register() — edge runtime
    // register() runs in a different realm. Each runtime owns its own
    // sentinel; assertion-4 reads them via the /api/sentinels probe.
    if (process.env.NEXT_RUNTIME === "nodejs") {
        const instrKey = `__agenta_instr_${APP_NAME}` as const
        ;(globalThis as Record<string, unknown>)[instrKey] = Date.now()
        console.log(
            `instrumentation: registered (@vercel/otel) for service.name="${serviceName}" → ${otlpUrl}`,
        )
        if (BRAINTRUST_API_KEY) {
            console.log(`instrumentation: + Braintrust dual-export → ${BRAINTRUST_OTLP_URL}`)
        }
    }
}
