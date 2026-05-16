/**
 * Assertion 1 — Cold-start trace completeness via Mastra agent.generate().
 *
 * Updated for Path B (after Path A/B-cheap proved AI SDK telemetry is
 * silent under Mastra). We now expect Mastra-native span names ("agent
 * run: ..." and "llm: ...") emitted through Mastra's ObservabilityBus
 * and translated to OTLP by AgentaMastraExporter.
 *
 * Metadata path: `tracingOptions.metadata.userId/sessionId` set in
 * src/app.ts. The exporter maps these to `ag.user.id` / `ag.session.id`
 * so spike-verify can filter on them like every other phase.
 */

import {verifyTrace} from "@agenta/spike-verify"

import {demoChatGenerate, flushTraces} from "../src/app"

import {HOST, PROJECT_ID, newRunId, requireApiKey} from "./_helpers"

const API_KEY = requireApiKey("test-assertion-1")
const RUN_ID = newRunId("mastra-a1")

async function main(): Promise<void> {
    console.log(`[assertion-1] demoChatGenerate (run=${RUN_ID})...`)
    const text = await demoChatGenerate({runId: RUN_ID})
    console.log(`  → ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`)
    await flushTraces()
    console.log("[assertion-1] flushed; querying Agenta...")

    // We query on ag.user.id (set by our manual parent span). The verifier
    // accepts any span matching the filter — could be our wrapper span, could
    // be a Mastra span, could be the AI SDK ai.generateText itself if Mastra
    // propagates the attr. The trace-hierarchy probe afterwards inspects WHICH
    // span carries which attribute, so we learn the shape empirically.
    await verifyTrace({
        filterAttribute: {path: "ag.user.id", value: RUN_ID},
        // Mastra-native span name (set by Mastra's own ObservabilityBus, then
        // shipped to Agenta via AgentaMastraExporter). The agent's `name` field
        // ("chat-agent") gets prefixed with "agent run: " by Mastra.
        expectSpans: ["agent run: 'chat-agent'"],
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
    console.log("[assertion-1] ✅ PASS")
}

main().catch((err) => {
    console.error("[assertion-1] ❌ FAIL")
    console.error(err)
    process.exit(1)
})
