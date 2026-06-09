/**
 * Assertion 3 — Per-call metadata round-trips through TanStack Start.
 *
 * Same shape as App Router/Pages Router: HTTP route's `x-agenta-run-id`
 * header → `runStreamChat({metadata: {userId, sessionId}})` → AI SDK →
 * OTel span → Agenta storage.
 */

import {verifyTrace} from "@agenta/spike-verify"

import {APP_BASE, HOST, PROJECT_ID, newRunId, requireApiKey} from "./_helpers"

const API_KEY = requireApiKey("test-assertion-3")
const RUN_ID = newRunId("a3")

async function main(): Promise<void> {
    console.log(`[assertion-3] /api/chat with metadata user=${RUN_ID}`)
    const res = await fetch(`${APP_BASE}/api/chat`, {
        method: "POST",
        headers: {"Content-Type": "application/json", "x-agenta-run-id": RUN_ID},
        body: JSON.stringify({
            messages: [
                {
                    id: "m1",
                    role: "user",
                    parts: [{type: "text", text: "Reply with: ok."}],
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
    console.log("[assertion-3] stream done; querying Agenta...")

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
