/**
 * Assertion 4 — Instrumentation runs before first handler.
 *
 * The instrumentation hook (--import ./src/instrumentation.ts) sets a per-app
 * sentinel: globalThis[`__agenta_instr_${APP_NAME}`] = Date.now() at
 * provider-register time. The first call to one of the demo functions sets
 * globalThis[`__agenta_first_handler_${APP_NAME}`] = Date.now() once.
 *
 * Test: run a demo. Then read both sentinels and assert
 *   instr_at < first_handler_at
 *
 * If instrumentation registered AFTER any handler ran, OTel context isn't
 * propagated through that first request — and traces from cold-start hits
 * are silently dropped or orphaned. This catches that.
 *
 * Per-app namespace prevents cross-app collision when multiple spike apps
 * share a Node process during testing (e.g. monorepo dev mode).
 */

import "dotenv/config"
import {demoGenerateText, flushTraces} from "../src/app.js"

const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "node"
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

    // Trigger the first handler. The demo function sets the handler sentinel
    // exactly once (idempotent on subsequent calls).
    console.log("[assertion-4] triggering first handler...")
    await demoGenerateText()

    const handlerAt = g[HANDLER_KEY]
    if (typeof handlerAt !== "number") {
        throw new Error(
            `First-handler sentinel ${HANDLER_KEY} is not set after running demoGenerateText.`,
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
