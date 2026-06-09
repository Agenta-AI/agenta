/**
 * Assertion 1 — Cold-start trace completeness via /api/chat (Pages Router).
 *
 * Same shape as the App Router version: hit /api/chat with a chat-style
 * payload, drain the stream, then poll Agenta for an ai.streamText span
 * tagged with this run's userId.
 */

import {verifyTrace} from "@agenta/spike-verify"

import {APP_BASE, HOST, PROJECT_ID, newRunId, requireApiKey} from "./_helpers"

const API_KEY = requireApiKey("test-assertion-1")
const RUN_ID = newRunId("a1")

async function main(): Promise<void> {
    console.log(`[assertion-1] POST /api/chat (run=${RUN_ID})...`)
    const res = await fetch(`${APP_BASE}/api/chat`, {
        method: "POST",
        headers: {"Content-Type": "application/json", "x-agenta-run-id": RUN_ID},
        body: JSON.stringify({
            messages: [
                {
                    id: "m1",
                    role: "user",
                    parts: [{type: "text", text: "Reply with: hello world."}],
                },
            ],
        }),
    })
    if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "")
        throw new Error(`/api/chat returned ${res.status}: ${text.slice(0, 300)}`)
    }
    const reader = res.body.getReader()
    while (true) {
        const {done} = await reader.read()
        if (done) break
    }
    console.log("[assertion-1] stream complete; querying Agenta...")

    await verifyTrace({
        filterAttribute: {path: "ag.user.id", value: RUN_ID},
        expectSpans: ["ai.streamText"],
        expectAttributes: {
            // streamText carries tokens under `incremental` (not cumulative).
            "ag.metrics.tokens.incremental.prompt": (n: unknown) => typeof n === "number" && n > 0,
            "ag.user.id": RUN_ID,
            "ag.session.id": RUN_ID,
            "ag.meta.request.model": "gpt-4o-mini",
        },
        host: HOST,
        apiKey: API_KEY,
        projectId: PROJECT_ID,
        timeoutMs: 30_000,
        pollIntervalMs: 1000,
    })
    console.log("[assertion-1] ✅ PASS")
}

main().catch((err) => {
    console.error("[assertion-1] ❌ FAIL")
    console.error(err)
    process.exit(1)
})
