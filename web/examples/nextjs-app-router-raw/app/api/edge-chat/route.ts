/**
 * Edge runtime route — generateText on Vercel Edge / Cloudflare Workers
 * shape (no async_hooks, no Buffer, fetch-based exporter only).
 *
 * The instrumentation hook in `instrumentation.ts` only runs for the
 * `nodejs` runtime (Node-only OTel libs can't load on edge). So this
 * route owns its OWN OTel provider setup, scoped to the edge runtime
 * instance. Each cold start re-initializes — that's the trade-off of
 * edge-runtime tracing.
 *
 * Exporter fallback chain (per design doc Phase 2a):
 *   (1) @opentelemetry/exporter-trace-otlp-http with keepAlive: true
 *       and a BasicTracerProvider from sdk-trace-base. The HTTP exporter
 *       is fetch-based (works on edge); the proto exporter uses Buffer
 *       (doesn't).
 *   (2) wrap each request with waitUntil(forceFlush()) so spans flush
 *       before the edge function freezes.
 *   (3) (deferred to vercel-otel variant) use @vercel/otel.
 *
 * KILL SWITCH: if neither (1) nor (2) flushes reliably, log a high-
 * severity pain entry, mark this route as runtime='nodejs', and move on.
 */

import {openai} from "@ai-sdk/openai"
import {trace} from "@opentelemetry/api"
import {OTLPTraceExporter} from "@opentelemetry/exporter-trace-otlp-http"
import {resourceFromAttributes} from "@opentelemetry/resources"
import {BasicTracerProvider, SimpleSpanProcessor} from "@opentelemetry/sdk-trace-base"
import {ATTR_SERVICE_NAME} from "@opentelemetry/semantic-conventions"
import {generateText} from "ai"
import {NextResponse, type NextRequest} from "next/server"
import {after} from "next/server"

export const runtime = "edge"

// One-time per cold start. Module-scope so subsequent requests in the
// same edge instance reuse the provider.
let providerInitialized = false

function ensureProvider(): void {
    if (providerInitialized) return
    providerInitialized = true

    const AGENTA_HOST = process.env.AGENTA_HOST || "https://cloud.agenta.ai"
    const AGENTA_API_KEY = process.env.AGENTA_API_KEY
    const AGENTA_PROJECT_ID = process.env.AGENTA_PROJECT_ID
    const AGENTA_OTLP_PATH = process.env.AGENTA_OTLP_PATH || "/api/otlp/v1/traces"
    const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "app-router-raw"

    if (!AGENTA_API_KEY) {
        console.error("[edge-chat] AGENTA_API_KEY missing — traces will not be exported")
        return
    }

    const otlpUrl = AGENTA_PROJECT_ID
        ? `${AGENTA_HOST}${AGENTA_OTLP_PATH}?project_id=${encodeURIComponent(AGENTA_PROJECT_ID)}`
        : `${AGENTA_HOST}${AGENTA_OTLP_PATH}`

    const exporter = new OTLPTraceExporter({
        url: otlpUrl,
        headers: {Authorization: `ApiKey ${AGENTA_API_KEY}`},
        keepAlive: true,
    })

    const provider = new BasicTracerProvider({
        resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: `vercel-ai-spike-${APP_NAME}`,
        }),
        spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    // OTel v2 dropped BasicTracerProvider.register() — set the global
    // tracer provider directly. (NodeTracerProvider still has .register()
    // because it sets up async-hooks-based context propagation; on edge
    // we don't have async_hooks anyway, so manual setGlobalTracerProvider
    // is the right primitive.)
    trace.setGlobalTracerProvider(provider)

    // Edge-runtime sentinel for assertion-4. The Node sentinel set in
    // instrumentation.node.ts won't be visible from edge (different
    // realm), so each runtime stamps its own.
    const instrKey = `__agenta_instr_${APP_NAME}_edge`
    ;(globalThis as Record<string, unknown>)[instrKey] = Date.now()
}

export async function POST(req: NextRequest): Promise<Response> {
    ensureProvider()

    // Mark the per-runtime first-handler sentinel.
    const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "app-router-raw"
    const handlerKey = `__agenta_first_handler_${APP_NAME}_edge`
    const g = globalThis as Record<string, unknown>
    if (g[handlerKey] === undefined) g[handlerKey] = Date.now()

    // Loud-fail if the runtime isn't actually edge — Next can silently
    // downgrade if a transitive dep uses Node-only APIs. Captured as
    // an assertion in tests too, but worth surfacing on every request.
    if (process.env.NEXT_RUNTIME !== "edge") {
        return NextResponse.json(
            {
                error: "edge-runtime-downgrade",
                actualRuntime: process.env.NEXT_RUNTIME,
                hint: "Next.js silently switched this route to nodejs. Check next build output for 'fell back to' warnings.",
            },
            {status: 500},
        )
    }

    const runId = req.headers.get("x-agenta-run-id") ?? `edge-${Date.now()}`
    const body = await req.json().catch(() => ({}))
    const prompt = (body as {prompt?: string}).prompt ?? "Say hi in one short sentence."

    try {
        const result = await generateText({
            model: openai("gpt-4o-mini"),
            messages: [{role: "user", content: prompt}],
            experimental_telemetry: {
                isEnabled: true,
                functionId: "app-router-edge-generate",
                metadata: {userId: runId, sessionId: runId},
            },
        })

        // waitUntil(forceFlush) — survives the edge freeze. `after` is the
        // Next 15 primitive that wraps waitUntil under the hood.
        after(async () => {
            const tp = trace.getTracerProvider() as {forceFlush?: () => Promise<void>}
            if (typeof tp.forceFlush === "function") await tp.forceFlush()
        })

        return NextResponse.json({text: result.text, runId, runtime: "edge"})
    } catch (err) {
        return NextResponse.json(
            {error: err instanceof Error ? err.message : String(err)},
            {status: 500},
        )
    }
}
