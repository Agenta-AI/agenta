/**
 * Edge runtime route — Pages Router + raw OpenTelemetry.
 *
 * P-PAGES-RAW-01 verification probe (Next.js 16):
 *
 *   Original Phase 3a finding (on Next.js 15.5.15):
 *     - Pages Router edge runtime applied stricter static dynamic-code-eval
 *       analysis than App Router. `@opentelemetry/exporter-trace-otlp-http`
 *       contained code patterns Pages-edge rejected. This route could NOT
 *       be built — `next build` failed with a static-analysis error.
 *     - App Router edge accepted the same import (Phase 2a builds fine).
 *     - So the only edge tracing option for Pages Router users on Next 15
 *       was `@vercel/otel`'s eval-free bundle (Phase 3b).
 *
 *   This route exists to re-test on Next.js 16. Same shape as Phase 2a's
 *   App Router edge route — inline OTel provider setup with raw OTel
 *   exporter imports — but on Pages Router.
 *
 *   If this file builds: P-PAGES-RAW-01 is FIXED on Next.js 16.
 *   If `next build` rejects it: P-PAGES-RAW-01 persists.
 */

import {openai} from "@ai-sdk/openai"
import {trace} from "@opentelemetry/api"
import {OTLPTraceExporter} from "@opentelemetry/exporter-trace-otlp-http"
import {resourceFromAttributes} from "@opentelemetry/resources"
import {BasicTracerProvider, SimpleSpanProcessor} from "@opentelemetry/sdk-trace-base"
import {ATTR_SERVICE_NAME} from "@opentelemetry/semantic-conventions"
import {generateText} from "ai"

export const config = {runtime: "edge"}

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
    const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "pages-raw"

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
    trace.setGlobalTracerProvider(provider)

    const instrKey = `__agenta_instr_${APP_NAME}_edge`
    ;(globalThis as Record<string, unknown>)[instrKey] = Date.now()
}

export default async function handler(req: Request): Promise<Response> {
    ensureProvider()

    const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "pages-raw"
    const handlerKey = `__agenta_first_handler_${APP_NAME}_edge`
    const g = globalThis as Record<string, unknown>
    if (g[handlerKey] === undefined) g[handlerKey] = Date.now()

    if (process.env.NEXT_RUNTIME !== "edge") {
        return new Response(
            JSON.stringify({
                error: "edge-runtime-downgrade",
                actualRuntime: process.env.NEXT_RUNTIME,
            }),
            {status: 500, headers: {"content-type": "application/json"}},
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
                functionId: "pages-router-raw-edge-generate",
                metadata: {userId: runId, sessionId: runId},
            },
        })
        return new Response(JSON.stringify({text: result.text, runId, runtime: "edge"}), {
            headers: {"content-type": "application/json"},
        })
    } catch (err) {
        return new Response(
            JSON.stringify({error: err instanceof Error ? err.message : String(err)}),
            {status: 500, headers: {"content-type": "application/json"}},
        )
    }
}
