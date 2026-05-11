/**
 * Assertion 3 — Per-call metadata round-trips, via Mastra agent + tool call.
 *
 * Phase 1's assertion-3 set userId/sessionId via AI SDK's
 * `experimental_telemetry.metadata`. Mastra doesn't expose that knob to
 * callers, so we instead set the attrs on our manual parent span (the
 * "agenta.run.weather-tool" wrapper inside demoWeatherToolCall). The
 * verifier checks for ag.user.id matching the runId.
 *
 * Phase 6 expectation: if Mastra propagates the OTel context (parent span
 * → child Mastra spans → AI SDK spans), the AI SDK's ai.generateText span
 * inherits the trace_id but NOT the parent span's attributes (OTel doesn't
 * cascade attrs by design). So we'll query on our wrapper span's attrs,
 * not the AI SDK span's. The hierarchy probe afterwards confirms.
 */

import {verifyTrace} from "@agenta/spike-verify"

import {demoWeatherToolCall, flushTraces} from "../src/app"

import {HOST, PROJECT_ID, newRunId, requireApiKey} from "./_helpers"

const API_KEY = requireApiKey("test-assertion-3")
const RUN_ID = newRunId("mastra-a3")

async function main(): Promise<void> {
    console.log(`[assertion-3] demoWeatherToolCall (run=${RUN_ID})...`)
    const text = await demoWeatherToolCall({runId: RUN_ID})
    console.log(`  → ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`)
    await flushTraces()
    console.log("[assertion-3] flushed; querying Agenta...")

    await verifyTrace({
        filterAttribute: {path: "ag.user.id", value: RUN_ID},
        // Mastra agent run span for the weather agent. Mastra wraps a
        // tool-call workflow inside this same span (the inner Mastra
        // model_generation, tool_call, etc. are nested children).
        expectSpans: ["agent run: 'weather-agent'"],
        expectAttributes: {
            "ag.user.id": RUN_ID,
            "ag.session.id": RUN_ID,
        },
        host: HOST,
        apiKey: API_KEY,
        projectId: PROJECT_ID,
        timeoutMs: 30_000,
        pollIntervalMs: 1000,
    })
    console.log("[assertion-3] ✅ PASS")
}

main().catch((err) => {
    console.error("[assertion-3] ❌ FAIL")
    console.error(err)
    process.exit(1)
})
