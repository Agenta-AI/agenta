/**
 * Assertion 4 — Instrumentation registers before the first request handler
 * (TanStack Start).
 *
 * Critical TanStack Start specific: there's no Next.js-style `register()`
 * auto-discovery hook. Instrumentation fires by virtue of being the FIRST
 * import in `src/server.ts`. This assertion catches the regression where
 * a refactor moves the import below something that calls AI SDK first —
 * silent loss of all traces (P-TANSTACK-01).
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
            "instrumentation sentinel never set — src/instrumentation.ts didn't fire " +
                "(check that src/server.ts imports it as the FIRST line)",
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
    console.log(`  Δ = ${delta}ms — instrumentation registered first ✓`)
    console.log("[assertion-4] ✅ PASS")
}

main().catch((err) => {
    console.error("[assertion-4] ❌ FAIL")
    console.error(err)
    process.exit(1)
})
