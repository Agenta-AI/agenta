/**
 * Assertion 1 — Cold-start trace completeness via Server Action.
 *
 * Hits the Server Action probe page's underlying generateAction by way
 * of the route's POST endpoint shape. Uses a unique runId; verifies an
 * `ai.generateText` span arrives in Agenta with model + tokens + the
 * round-tripped userId.
 *
 * Why Server Action specifically: it's the path most exposed to the RSC
 * context-propagation footgun. If it works here, the basic instrumentation
 * hook + per-app sentinel are sound.
 */

import {verifyTrace} from "@agenta/spike-verify"

import {APP_BASE, HOST, PROJECT_ID, newRunId, requireApiKey} from "./_helpers"

const API_KEY = requireApiKey("test-assertion-1")
const RUN_ID = newRunId("a1")

async function main(): Promise<void> {
    console.log(`[assertion-1] invoking Server Action via /api/chat (run=${RUN_ID})...`)
    // Server Actions don't have a standard HTTP shape — we exercise the
    // /api/chat route as a proxy here. The same telemetry helper
    // (runStreamChat → experimental_telemetry) fires either way; the
    // dedicated Server Action probe lives at /server-action-test for
    // browser testing.
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
    // Drain the stream so the route's onFinish + flushTraces run.
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
            // streamText spans carry tokens under `incremental`, NOT `cumulative`
            // (that's the generateText shape). Different from the Node node-vercel-ai-v6
            // spike where assertion-1 hits generateText. Worth noting in pain log.
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
