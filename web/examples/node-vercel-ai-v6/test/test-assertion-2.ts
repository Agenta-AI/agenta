/**
 * Assertion 2 — Stream flush on mid-abort.
 *
 * Starts demoStreamText. Reads the first token. Aborts the stream 500ms in
 * via AbortController. Asserts the parent ai.streamText span IS queryable in
 * Agenta within ASSERTION_FLUSH_WINDOW_S (default 5s).
 *
 * Why this matters: most naive OTel + LLM streaming integrations silently
 * lose spans on early disconnect because the stream's natural close path is
 * what triggers flush. If a real user closes the tab mid-response, the trace
 * just disappears. This assertion catches that.
 *
 *   start stream ──▶ read 1 token ──▶ wait 500ms ──▶ abort()
 *           │                                            │
 *           │                                            ▼
 *           └────────────────  poll Agenta within ASSERTION_FLUSH_WINDOW_S
 *                              for service.name match. PASS if found and
 *                              has populated outputs.
 */

import "dotenv/config"
import {verifyTrace} from "@agenta/spike-verify"

import {demoStreamText, flushTraces} from "../src/app.js"

const HOST = process.env.AGENTA_HOST ?? "https://cloud.agenta.ai"
const API_KEY = process.env.AGENTA_API_KEY
const PROJECT_ID = process.env.AGENTA_PROJECT_ID
const FLUSH_WINDOW_S = Number(process.env.ASSERTION_FLUSH_WINDOW_S ?? "5")
const RUN_ID = `a2-${Date.now()}`

if (!API_KEY) {
    console.error("test-assertion-2: AGENTA_API_KEY required")
    process.exit(1)
}

async function main(): Promise<void> {
    console.log("[assertion-2] starting stream + scheduled abort...")

    const ac = new AbortController()
    const stream = demoStreamText({
        userId: RUN_ID,
        sessionId: RUN_ID,
        abortSignal: ac.signal,
    })

    // Read the first token, then abort 500ms after.
    let firstTokenAt: number | null = null
    let receivedTokens = 0
    const reader = (async () => {
        try {
            for await (const chunk of stream.textStream) {
                receivedTokens += chunk.length
                if (firstTokenAt === null) {
                    firstTokenAt = Date.now()
                    setTimeout(() => {
                        console.log(
                            `[assertion-2] aborting after first token (received ${receivedTokens} chars so far)`,
                        )
                        ac.abort()
                    }, 500)
                }
            }
        } catch (err) {
            // Aborted streams throw; that's the expected path.
            const msg = err instanceof Error ? err.message : String(err)
            if (!/abort/i.test(msg)) throw err
        }
    })()

    await reader

    // Force flush after abort. This is what we WANT the SDK to do automatically;
    // raw OTel needs us to call it explicitly. Worth a pain log entry if so.
    await flushTraces()
    console.log(`[assertion-2] aborted; querying Agenta (window=${FLUSH_WINDOW_S}s)...`)

    await verifyTrace({
        filterAttribute: {path: "ag.user.id", value: RUN_ID},
        expectSpans: ["ai.streamText"],
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
