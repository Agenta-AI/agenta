/**
 * Assertion 4 — Nitro plugin runs before the first request handler.
 *
 * Unlike Next.js's `instrumentation.ts` (which has a register hook), Nuxt
 * relies on Nitro plugins under `server/plugins/*.ts` that fire at server
 * init. This assertion verifies the plugin stamps its sentinel BEFORE any
 * AI handler runs.
 */

import {APP_BASE} from "./_helpers"

async function main(): Promise<void> {
    console.log("[assertion-4] firing warm-up request to /api/sentinels...")
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
            "instrumentation sentinel never set — server/plugins/otel.ts didn't run (or AGENTA_API_KEY missing)",
        )
    }
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
    console.log(`  Δ = ${delta}ms — Nitro plugin registered first ✓`)
    console.log("[assertion-4] ✅ PASS")
}

main().catch((err) => {
    console.error("[assertion-4] ❌ FAIL")
    console.error(err)
    process.exit(1)
})
