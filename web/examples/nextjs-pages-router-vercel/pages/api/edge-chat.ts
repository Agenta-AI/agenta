/**
 * Edge runtime route — Pages Router + `@vercel/otel`.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ A/B counterpart to nextjs-pages-router-raw's omitted edge   │
 *   │ route (P-PAGES-RAW-01: raw OTel exporter fails Pages-Router │
 *   │ edge static dynamic-code-eval check at build time).         │
 *   │                                                             │
 *   │ Critical Phase 3b verdict: does @vercel/otel ship an        │
 *   │ edge-safe bundle that passes Next's strict check on Pages?  │
 *   │                                                             │
 *   │ Same single-line opinionated approach as the App Router     │
 *   │ vercel variant — no inline provider setup, no manual flush. │
 *   │ instrumentation.ts owns it for both runtimes.               │
 *   └─────────────────────────────────────────────────────────────┘
 */

import {openai} from "@ai-sdk/openai"
import {generateText} from "ai"

export const config = {runtime: "edge"}

export default async function handler(req: Request): Promise<Response> {
    const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "pages-vercel"
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
                functionId: "pages-router-edge-generate",
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
