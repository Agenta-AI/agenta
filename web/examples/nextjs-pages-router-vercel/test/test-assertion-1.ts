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
            // Token verification: query the consumer-facing `cumulative.prompt`
            // path. This is what evaluations/service.py:137 and the metrics
            // endpoint at tracing/service.py:94 actually read.
            //
            // KNOWN-FAILING TODAY (expected): this check fails because the
            // backend's incremental→cumulative tree-walker (trees.py:237-437)
            // is invoked only at INGEST time (service.py:146) and is scoped
            // to spans within a single OTLP batch. With SimpleSpanProcessor
            // (Agenta-recommended), each ended span is exported as its own
            // OTLP request, so `ai.streamText.doStream` (child, has tokens)
            // and `ai.streamText` (parent, force-ended by @vercel/otel before
            // tokens land) never arrive together. The walker can't roll up
            // across batches, parent's `cumulative` stays unset.
            //
            // The fix is a READ-TIME post-query enricher that re-runs the
            // walker on the assembled trace before returning it to consumers
            // — see docs/design/ts-sdk/rfc.md §4.4 and §11.4.
            //
            // This test is the regression check: it will PASS once the
            // read-time enricher ships. Until then it documents the gap.
            "ag.metrics.tokens.cumulative.prompt": (n: unknown) =>
                typeof n === "number" && n > 0,
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
