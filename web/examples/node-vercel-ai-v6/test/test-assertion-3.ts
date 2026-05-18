/**
 * Assertion 3 — Request metadata round-trips.
 *
 * Sends generateText + tool call with custom userId, sessionId in
 * `experimental_telemetry.metadata`. Asserts those values come back in the
 * Agenta-side trace as `ag.user.id`, `ag.session.id`.
 *
 *  Phase 1 LOCK condition: if Agenta's adapter has drifted on metadata key
 *  names (e.g. expects `userID` not `userId`) this assertion fails loudly
 *  and gets a new pain-log entry.
 */

import "dotenv/config"
import {verifyTrace} from "@agenta/spike-verify"

import {demoToolCall, flushTraces} from "../src/app.js"

const HOST = process.env.AGENTA_HOST ?? "https://cloud.agenta.ai"
const API_KEY = process.env.AGENTA_API_KEY
const PROJECT_ID = process.env.AGENTA_PROJECT_ID

if (!API_KEY) {
    console.error("test-assertion-3: AGENTA_API_KEY required")
    process.exit(1)
}

const UNIQUE_USER = `a3-user-${Date.now()}`
const UNIQUE_SESSION = `a3-session-${Date.now()}`

async function main(): Promise<void> {
    console.log(
        `[assertion-3] tool-call with metadata user=${UNIQUE_USER} session=${UNIQUE_SESSION}`,
    )
    await demoToolCall({userId: UNIQUE_USER, sessionId: UNIQUE_SESSION})
    await flushTraces()
    console.log("[assertion-3] flushed; querying Agenta...")

    await verifyTrace({
        filterAttribute: {path: "ag.user.id", value: UNIQUE_USER},
        expectSpans: ["ai.generateText"],
        expectAttributes: {
            "ag.user.id": UNIQUE_USER,
            "ag.session.id": UNIQUE_SESSION,
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
