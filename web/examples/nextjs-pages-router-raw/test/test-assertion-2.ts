/**
 * Assertion 2 — Mid-stream client abort flushes the streamText span (Pages Router).
 *
 * Same client-side abort as App Router test. Pages Router's streaming
 * happens via res.write(...) under the hood (pipeUIMessageStreamToResponse),
 * which is a different write path than App Router's Response stream — so
 * abort handling MAY differ. This test verifies the same 5s flush
 * guarantee holds.
 */

import {verifyTrace} from "@agenta/spike-verify"

import {APP_BASE, HOST, PROJECT_ID, newRunId, requireApiKey} from "./_helpers"

const API_KEY = requireApiKey("test-assertion-2")
const RUN_ID = newRunId("a2")
const FLUSH_WINDOW_S = Number(process.env.ASSERTION_FLUSH_WINDOW_S ?? "5")

async function main(): Promise<void> {
    console.log(`[assertion-2] starting stream + scheduled abort (run=${RUN_ID})...`)
    const ac = new AbortController()
    const reqPromise = fetch(`${APP_BASE}/api/chat`, {
        method: "POST",
        headers: {"Content-Type": "application/json", "x-agenta-run-id": RUN_ID},
        body: JSON.stringify({
            messages: [
                {
                    id: "m1",
                    role: "user",
                    parts: [
                        {
                            type: "text",
                            text: "Tell me a long story about a robot learning to paint, in three paragraphs.",
                        },
                    ],
                },
            ],
        }),
        signal: ac.signal,
    })

    let aborted = false
    try {
        const res = await reqPromise
        if (!res.body) throw new Error("no response body")
        const reader = res.body.getReader()
        const {done: firstDone} = await reader.read()
        if (firstDone) console.log("[assertion-2] stream ended before abort fired")

        setTimeout(() => {
            console.log("[assertion-2] aborting client request")
            ac.abort()
            aborted = true
        }, 500)

        try {
            while (true) {
                const {done} = await reader.read()
                if (done) break
            }
        } catch {
            // expected on abort
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!/abort/i.test(msg)) throw err
    }
    console.log(`[assertion-2] aborted=${aborted}; querying Agenta (window=${FLUSH_WINDOW_S}s)...`)

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
