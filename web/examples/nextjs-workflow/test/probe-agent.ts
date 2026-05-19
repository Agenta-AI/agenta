/**
 * Probe: fire the DurableAgent workflow once + verify what lands.
 */

import "dotenv/config"

const APP_BASE = process.env.APP_BASE_URL ?? "http://localhost:3107"
const RUN_ID = `wf-agent-${Date.now()}`

async function main(): Promise<void> {
    console.log(`[probe-agent] firing workflow (runId=${RUN_ID})...`)
    const res = await fetch(`${APP_BASE}/api/start-agent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-agenta-run-id": RUN_ID,
        },
        body: JSON.stringify({message: "What's the weather in Berlin?"}),
    })
    if (!res.ok) {
        console.error(`[probe-agent] HTTP ${res.status}: ${await res.text()}`)
        process.exit(1)
    }
    const body = await res.json()
    console.log(`[probe-agent] queued: ${JSON.stringify(body)}`)
    console.log(`[probe-agent] waiting 30s for agent loop + tool-call to complete...`)
    await new Promise((r) => setTimeout(r, 30_000))
    console.log(`[probe-agent] done. Inspect Agenta for spans tagged with user.id=${RUN_ID}`)
    console.log(`[probe-agent] (or workflowRunId=${body.workflowRunId} via workflow CLI)`)
}

main().catch((err) => {
    console.error("[probe-agent] ERROR:", err)
    process.exit(1)
})
