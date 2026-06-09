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

import {SimpleSpanProcessor} from "@opentelemetry/sdk-trace-base"
import {registerOTel, OTLPHttpProtoTraceExporter} from "@vercel/otel"

const AGENTA_HOST = process.env.AGENTA_HOST || "https://cloud.agenta.ai"
const AGENTA_API_KEY = process.env.AGENTA_API_KEY
const AGENTA_PROJECT_ID = process.env.AGENTA_PROJECT_ID
const AGENTA_OTLP_PATH = process.env.AGENTA_OTLP_PATH || "/api/otlp/v1/traces"
const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "pages-vercel"
const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY
const BRAINTRUST_OTLP_URL =
    process.env.BRAINTRUST_OTLP_URL || "https://api.braintrust.dev/otel/v1/traces"
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY
const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com"

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

    // Both exporters wrapped in `SimpleSpanProcessor` to match the Agenta
    // docs' canonical example (`docs/docs/integrations/frameworks/
    // vercel-ai-sdk/observability.mdx` uses SimpleSpanProcessor).
    //
    // P-PAGES-VERCEL-01 note: this was originally documented under
    // `@vercel/otel`'s default (BatchSpanProcessor wrapping the exporter),
    // where the `CompositeSpanProcessor.onEnd` force-end race produces
    // empty `ag.metrics.tokens`. Switching to `SimpleSpanProcessor` per
    // Agenta docs may sidestep the race — assertion-1 was loosened earlier
    // to drop the token-attr check; re-verifying with this config post-fix.
    const spanProcessors = [new SimpleSpanProcessor(agentaExporter)]
    if (BRAINTRUST_API_KEY) {
        const braintrustExporter = new OTLPHttpProtoTraceExporter({
            url: BRAINTRUST_OTLP_URL,
            headers: {
                Authorization: `Bearer ${BRAINTRUST_API_KEY}`,
                "x-bt-parent": `project_name:${serviceName}`,
            },
        })
        spanProcessors.push(new SimpleSpanProcessor(braintrustExporter))
    }
    // Optional Langfuse tri-export. Auth is Basic base64(public:secret) per
    // their OTel docs (https://langfuse.com/docs/opentelemetry/get-started).
    if (LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY) {
        const auth = Buffer.from(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`).toString("base64")
        const langfuseExporter = new OTLPHttpProtoTraceExporter({
            url: `${LANGFUSE_BASE_URL}/api/public/otel/v1/traces`,
            headers: {
                Authorization: `Basic ${auth}`,
                "x-langfuse-ingestion-version": "4",
            },
        })
        spanProcessors.push(new SimpleSpanProcessor(langfuseExporter))
    }
    registerOTel({serviceName, spanProcessors})

    if (process.env.NEXT_RUNTIME === "nodejs") {
        const instrKey = `__agenta_instr_${APP_NAME}` as const
        ;(globalThis as Record<string, unknown>)[instrKey] = Date.now()
        console.log(
            `instrumentation: registered (@vercel/otel) for service.name="${serviceName}" → ${otlpUrl}`,
        )
        if (BRAINTRUST_API_KEY) {
            console.log(`instrumentation: + Braintrust dual-export → ${BRAINTRUST_OTLP_URL}`)
        }
        if (LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY) {
            console.log(
                `instrumentation: + Langfuse tri-export → ${LANGFUSE_BASE_URL}/api/public/otel/v1/traces`,
            )
        }
    }
}
