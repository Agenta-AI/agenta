/**
 * Sentinel inspection endpoint — Nuxt 3/4 edition.
 *
 * Returns the per-app instrumentation + first-handler timestamps so
 * assertion-4 can compare register order.
 */

export default defineEventHandler(() => {
    const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "nuxt-raw"
    const g = globalThis as Record<string, unknown>
    return {
        appName: APP_NAME,
        runtime: "nodejs",
        instrumentationAt: g[`__agenta_instr_${APP_NAME}`] ?? null,
        firstHandlerAt: g[`__agenta_first_handler_${APP_NAME}`] ?? null,
    }
})
