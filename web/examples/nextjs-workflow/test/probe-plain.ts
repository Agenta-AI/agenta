/**
 * Probe: fire the plain workflow once + verify what lands in Agenta.
 *
 * Not a full assertion suite — just observes the trace shape so we can
 * answer empirical questions about Workflow DevKit tracing behavior.
 *   1. Do we get the `ai.generateText` span?
 *   2. Does it carry the userId/sessionId from experimental_telemetry?
 *   3. Is the workflow execution itself instrumented, or just the AI call?
 *   4. Are step boundaries visible as spans?
 */

import "dotenv/config"

const APP_BASE = process.env.APP_BASE_URL ?? "http://localhost:3107"
const RUN_ID = `wf-plain-${Date.now()}`

async function main(): Promise<void> {
    console.log(`[probe-plain] firing workflow (runId=${RUN_ID})...`)
    const res = await fetch(`${APP_BASE}/api/start-plain`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-agenta-run-id": RUN_ID,
        },
        body: JSON.stringify({prompt: "Reply with: ok."}),
    })
    if (!res.ok) {
        console.error(`[probe-plain] HTTP ${res.status}: ${await res.text()}`)
        process.exit(1)
    }
    const body = await res.json()
    console.log(`[probe-plain] queued: ${JSON.stringify(body)}`)
    console.log(`[probe-plain] waiting 15s for workflow to complete and spans to flush...`)
    await new Promise((r) => setTimeout(r, 15_000))
    console.log(`[probe-plain] done. Inspect Agenta for spans tagged with user.id=${RUN_ID}`)
    console.log(`[probe-plain] (or workflowRunId=${body.workflowRunId} via workflow CLI)`)
}

main().catch((err) => {
    console.error("[probe-plain] ERROR:", err)
    process.exit(1)
})
