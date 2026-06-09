/**
 * Assertion 4 — Instrumentation registers before the first request handler.
 *
 * Browser/server can't share the same Node `globalThis` (different
 * processes). The dev server exposes `/api/sentinels` which reports the
 * server-side timestamps; this test fires one warm-up request to ensure
 * a handler runs, then GETs /api/sentinels and asserts ordering.
 */

import {APP_BASE} from "./_helpers"

async function main(): Promise<void> {
    console.log("[assertion-4] firing warm-up request to /api/sentinels...")
    // First call may itself BE the first handler — calling /api/sentinels
    // directly stamps the first-handler sentinel via the route handler.
    const res = await fetch(`${APP_BASE}/api/sentinels`)
    if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`/api/sentinels returned ${res.status}: ${text.slice(0, 200)}`)
    }
    const sentinels = (await res.json()) as {
        appName: string
        runtime: string | null
        instrumentationAt: number | null
        firstHandlerAt: number | null
    }
    console.log(`  appName=${sentinels.appName} runtime=${sentinels.runtime}`)
    console.log(
        `  instrumentationAt=${
            sentinels.instrumentationAt
                ? new Date(sentinels.instrumentationAt).toISOString()
                : "null"
        }`,
    )
    console.log(
        `  firstHandlerAt=${
            sentinels.firstHandlerAt ? new Date(sentinels.firstHandlerAt).toISOString() : "null"
        }`,
    )

    if (sentinels.instrumentationAt === null) {
        throw new Error(
            "instrumentation sentinel never set — instrumentation.node.ts may not have loaded",
        )
    }
    // The /api/sentinels handler doesn't itself stamp `__agenta_first_handler_*`
    // (that sentinel is stamped by the AI demo helpers in lib/ai.ts on their
    // first call). If the dev server has been hit by an earlier assertion or a
    // browser visit, firstHandlerAt is set; otherwise it's null. Treat null
    // as "no AI call yet, can't verify order — re-run after assertion-1/3".
    if (sentinels.firstHandlerAt === null) {
        console.warn(
            "[assertion-4] firstHandlerAt is null — no AI handler has run yet on this server.",
        )
        console.warn("  (run pnpm test:assertion-1 first; then re-run assertion-4)")
        process.exit(2)
    }

    if (sentinels.instrumentationAt >= sentinels.firstHandlerAt) {
        throw new Error(
            `Order violation: instrumentation registered at ${sentinels.instrumentationAt} ` +
                `but first AI handler ran at ${sentinels.firstHandlerAt}. ` +
                `instrumentation should be strictly earlier.`,
        )
    }

    const delta = sentinels.firstHandlerAt - sentinels.instrumentationAt
    console.log(`  Δ = ${delta}ms — instrumentation registered first ✓`)
    console.log("[assertion-4] ✅ PASS")
}

main().catch((err) => {
    console.error("[assertion-4] ❌ FAIL")
    console.error(err)
    process.exit(1)
})
