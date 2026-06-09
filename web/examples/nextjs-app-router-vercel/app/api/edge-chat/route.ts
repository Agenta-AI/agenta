/**
 * Edge runtime route — `@vercel/otel` variant.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ A/B counterpart to nextjs-app-router-raw's edge-chat route. │
 *   │ Critical Phase 2b verdict: does @vercel/otel ship spans     │
 *   │ from edge that raw OTel + manual setup cannot?              │
 *   │                                                             │
 *   │ This route deliberately has NO provider setup of its own.   │
 *   │ @vercel/otel claims to handle edge-runtime instrumentation  │
 *   │ from the single `instrumentation.ts` register() call.       │
 *   └─────────────────────────────────────────────────────────────┘
 */

import {openai} from "@ai-sdk/openai"
import {generateText} from "ai"
import {NextResponse, type NextRequest} from "next/server"

export const runtime = "edge"

export async function POST(req: NextRequest): Promise<Response> {
    // Per-runtime first-handler sentinel (edge realm).
    const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "app-router-vercel"
    const handlerKey = `__agenta_first_handler_${APP_NAME}_edge`
    const g = globalThis as Record<string, unknown>
    if (g[handlerKey] === undefined) g[handlerKey] = Date.now()

    // Loud-fail if the runtime isn't actually edge — Next can silently
    // downgrade if a transitive dep uses Node-only APIs.
    if (process.env.NEXT_RUNTIME !== "edge") {
        return NextResponse.json(
            {
                error: "edge-runtime-downgrade",
                actualRuntime: process.env.NEXT_RUNTIME,
                hint: "Next.js silently switched this route to nodejs.",
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
        // No explicit waitUntil/forceFlush here — @vercel/otel claims to
        // handle that itself via the registerOTel() lifecycle. If spans
        // don't arrive, that claim is wrong and we capture another pain
        // entry.
        return NextResponse.json({text: result.text, runId, runtime: "edge"})
    } catch (err) {
        return NextResponse.json(
            {error: err instanceof Error ? err.message : String(err)},
            {status: 500},
        )
    }
}
