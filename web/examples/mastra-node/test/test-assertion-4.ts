/**
 * Assertion 4 — Instrumentation runs before first Mastra handler.
 *
 * Phase 6 question: does Mastra's module-load (importing `@mastra/core/agent`
 * and constructing `new Agent({...})`) emit any spans BEFORE our first
 * demo call? If yes, the assertion would fail (Mastra's init time would
 * predate our first-handler marker). If no, this passes cleanly like
 * Phase 1.
 */

import "dotenv/config"
import {demoChatGenerate, flushTraces} from "../src/app"

const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "mastra-node"
const INSTR_KEY = `__agenta_instr_${APP_NAME}`
const HANDLER_KEY = `__agenta_first_handler_${APP_NAME}`

async function main(): Promise<void> {
    console.log(`[assertion-4] reading sentinels for app="${APP_NAME}"`)

    const g = globalThis as Record<string, unknown>
    const instrAt = g[INSTR_KEY]
    if (typeof instrAt !== "number") {
        throw new Error(
            `Instrumentation sentinel ${INSTR_KEY} is not set. ` +
                `Did you launch via "tsx --import ./src/instrumentation.ts"?`,
        )
    }
    console.log(`  instrumentation registered at: ${new Date(instrAt).toISOString()}`)

    console.log("[assertion-4] triggering first handler...")
    await demoChatGenerate({runId: `a4-${Date.now()}`})

    const handlerAt = g[HANDLER_KEY]
    if (typeof handlerAt !== "number") {
        throw new Error(
            `First-handler sentinel ${HANDLER_KEY} is not set after running demoChatGenerate.`,
        )
    }
    console.log(`  first handler ran at:        ${new Date(handlerAt).toISOString()}`)

    if (instrAt >= handlerAt) {
        throw new Error(
            `Order violation: instrumentation registered at ${instrAt} but first handler at ${handlerAt} ` +
                `(instr should be strictly earlier). Difference: ${instrAt - handlerAt}ms.`,
        )
    }
    console.log(`  Δ = ${handlerAt - instrAt}ms — instrumentation registered first ✓`)

    await flushTraces()
    console.log("[assertion-4] ✅ PASS")
}

main().catch((err) => {
    console.error("[assertion-4] ❌ FAIL")
    console.error(err)
    process.exit(1)
})
