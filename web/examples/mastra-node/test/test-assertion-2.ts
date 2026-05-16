/**
 * Assertion 2 — Mid-stream client abort flushes the streamText span via Mastra.
 *
 * Mirror of Phase 1's assertion-2. Schedules an abort 500ms into the stream
 * and asserts the streamText span lands in Agenta within 5s.
 *
 * Phase 6 risk: Mastra wraps `streamText` internally, and we don't know yet
 * whether abortSignal propagates cleanly through Mastra → AI SDK → OpenAI.
 * If it doesn't (cf. P-NUXT-01's H3 abort story), span ends only when model
 * completes naturally and assertion fails at 5s but passes at 30s.
 */

import {verifyTrace} from "@agenta/spike-verify"

import {demoChatStream, flushTraces} from "../src/app"

import {HOST, PROJECT_ID, newRunId, requireApiKey} from "./_helpers"

const API_KEY = requireApiKey("test-assertion-2")
const RUN_ID = newRunId("mastra-a2")
const FLUSH_WINDOW_S = Number(process.env.ASSERTION_FLUSH_WINDOW_S ?? "5")

async function main(): Promise<void> {
    console.log(`[assertion-2] starting stream + scheduled abort (run=${RUN_ID})...`)
    const ac = new AbortController()

    // Schedule the abort 500ms in. The streamText span should end shortly
    // after that, regardless of whether the model finishes generating.
    setTimeout(() => {
        console.log("[assertion-2] aborting")
        ac.abort()
    }, 500)

    try {
        await demoChatStream({runId: RUN_ID, abortSignal: ac.signal})
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!/abort/i.test(msg)) throw err
    }
    await flushTraces()
    console.log(`[assertion-2] querying Agenta (window=${FLUSH_WINDOW_S}s)...`)

    await verifyTrace({
        filterAttribute: {path: "ag.user.id", value: RUN_ID},
        // Mastra-native span name (no AI SDK ai.streamText — see P-MASTRA-01).
        expectSpans: ["agent run: 'chat-agent'"],
        expectAttributes: {
            "ag.user.id": RUN_ID,
            "ag.session.id": RUN_ID,
        },
        host: HOST,
        apiKey: API_KEY,
        projectId: PROJECT_ID,
        timeoutMs: FLUSH_WINDOW_S * 1000,
        pollIntervalMs: 1000,
    })
    console.log("[assertion-2] ✅ PASS")
}

main().catch((err) => {
    console.error("[assertion-2] ❌ FAIL")
    console.error(err)
    process.exit(1)
})
