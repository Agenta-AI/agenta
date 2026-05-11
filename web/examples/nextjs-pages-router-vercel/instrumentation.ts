/**
 * Next.js 15 instrumentation hook — Pages Router + `@vercel/otel`.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ A/B counterpart to nextjs-pages-router-raw. Same Pages app  │
 *   │ shape, single-line OTel wiring instead of multi-file scaff. │
 *   │                                                             │
 *   │ Critical Phase 3b verdict: does @vercel/otel get past the   │
 *   │ Pages-Router-edge static dynamic-code-eval check that       │
 *   │ raw OTel hits (P-PAGES-RAW-01)? If yes, edge tracing is     │
 *   │ achievable on Pages Router via @vercel/otel and the SDK     │
 *   │ wraps it. If no, Pages-edge tracing is fundamentally        │
 *   │ broken on raw + on @vercel/otel — different SDK strategy.   │
 *   └─────────────────────────────────────────────────────────────┘
 */

import {registerOTel, OTLPHttpProtoTraceExporter} from "@vercel/otel"

const AGENTA_HOST = process.env.AGENTA_HOST || "https://cloud.agenta.ai"
const AGENTA_API_KEY = process.env.AGENTA_API_KEY
const AGENTA_PROJECT_ID = process.env.AGENTA_PROJECT_ID
const AGENTA_OTLP_PATH = process.env.AGENTA_OTLP_PATH || "/api/otlp/v1/traces"
const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "pages-vercel"

const otlpUrl = AGENTA_PROJECT_ID
    ? `${AGENTA_HOST}${AGENTA_OTLP_PATH}?project_id=${encodeURIComponent(AGENTA_PROJECT_ID)}`
    : `${AGENTA_HOST}${AGENTA_OTLP_PATH}`

export function register(): void {
    if (!AGENTA_API_KEY) {
        console.error("instrumentation: AGENTA_API_KEY missing — traces will not be exported")
        return
    }

    registerOTel({
        serviceName: `vercel-ai-spike-${APP_NAME}`,
        traceExporter: new OTLPHttpProtoTraceExporter({
            url: otlpUrl,
            headers: {Authorization: `ApiKey ${AGENTA_API_KEY}`},
        }),
    })

    if (process.env.NEXT_RUNTIME === "nodejs") {
        const instrKey = `__agenta_instr_${APP_NAME}` as const
        ;(globalThis as Record<string, unknown>)[instrKey] = Date.now()
        console.log(
            `instrumentation: registered (@vercel/otel) for service.name="vercel-ai-spike-${APP_NAME}" → ${otlpUrl}`,
        )
    }
}
